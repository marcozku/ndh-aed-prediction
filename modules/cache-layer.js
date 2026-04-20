/**
 * modules/cache-layer.js - v5.2.0
 *
 * Centralised in-memory cache layer built on lru-cache, with:
 *  - Named caches that have independent TTL + max-size budgets
 *  - Request coalescing (concurrent requests for the same key
 *    wait for a single in-flight computation — avoids stampedes)
 *  - Per-cache hit/miss/set/stale counters so Railway logs can
 *    surface where caching actually pays off
 *  - Explicit invalidation helpers for mutation paths
 *
 * Design rationale:
 *  We only cache READ-heavy, time-stable responses:
 *    model-comparison, model-performance, recent-accuracy,
 *    accuracy-history, weather-correlation, weather-impact,
 *    performance-comparison, future-predictions, ai-factors-cache.
 *  Mutations (POST /api/predictions, actual-data, generate-predictions)
 *  explicitly invalidate the affected buckets so the next read
 *  returns fresh data.
 *
 *  Fallbacks are always safe: if this module fails to load or a
 *  cache lookup throws, handlers execute the original computation.
 */

const { LRUCache } = require('lru-cache');

const caches = new Map();
const stats = new Map();
const pending = new Map();
const startedAt = Date.now();

function createCache(name, options = {}) {
    const cache = new LRUCache({
        max: options.max || 200,
        ttl: options.ttl || 60_000,
        updateAgeOnGet: false,
        allowStale: false,
        ...options
    });
    caches.set(name, cache);
    stats.set(name, { hits: 0, misses: 0, sets: 0, errors: 0, coalesced: 0, ttlMs: options.ttl || 60_000 });
    return cache;
}

// Register named buckets with sensible defaults.
// TTL should be long enough to be useful but short enough that stale
// data does not confuse operators. Mutations invalidate explicitly,
// so TTL is mostly a safety net.
createCache('api-short',    { max: 300, ttl:   60_000 }); // 1 min
createCache('api-medium',   { max: 200, ttl:  300_000 }); // 5 min
createCache('api-long',     { max: 100, ttl:  900_000 }); // 15 min
createCache('weather-ext',  { max:  50, ttl:  600_000 }); // 10 min (HKO)
createCache('ai-analysis',  { max: 100, ttl: 2 * 60 * 60_000 }); // 2 hr

function getCache(name) {
    const c = caches.get(name);
    if (!c) throw new Error(`[cache] unknown bucket: ${name}`);
    return c;
}

function bump(name, field) {
    const s = stats.get(name);
    if (s) s[field] = (s[field] || 0) + 1;
}

/**
 * getOrCompute(bucket, key, computeFn, { ttl? })
 *   Returns cached value for key, or runs computeFn() to populate it.
 *   Concurrent calls for the same key are coalesced — only ONE
 *   computeFn runs, and all callers receive the same resolution.
 */
async function getOrCompute(bucket, key, computeFn, opts = {}) {
    const cache = getCache(bucket);

    const hit = cache.get(key);
    if (hit !== undefined) {
        bump(bucket, 'hits');
        return hit;
    }
    bump(bucket, 'misses');

    // Coalesce concurrent misses
    const pendKey = `${bucket}::${key}`;
    if (pending.has(pendKey)) {
        bump(bucket, 'coalesced');
        return pending.get(pendKey);
    }

    const p = Promise.resolve()
        .then(() => computeFn())
        .then(result => {
            if (result !== undefined) {
                cache.set(key, result, opts.ttl ? { ttl: opts.ttl } : undefined);
                bump(bucket, 'sets');
            }
            return result;
        })
        .catch(err => {
            bump(bucket, 'errors');
            throw err;
        })
        .finally(() => {
            pending.delete(pendKey);
        });

    pending.set(pendKey, p);
    return p;
}

/**
 * Wraps an Express-style async handler so identical GET requests are
 * coalesced and their JSON responses cached. The body the handler
 * passes to sendJson is snapshotted. Errors bypass the cache.
 */
function cachedJsonHandler(bucket, keyFn, handler) {
    return async function cachedHandler(req, res) {
        const key = keyFn(req);

        // Hit path: reconstruct the response
        const cache = getCache(bucket);
        const cached = cache.get(key);
        if (cached !== undefined) {
            bump(bucket, 'hits');
            if (!res.headersSent) {
                res.writeHead(cached.status, {
                    ...cached.headers,
                    'X-Cache': 'HIT',
                    'X-Cache-Bucket': bucket
                });
                res.end(cached.body);
            }
            return;
        }
        bump(bucket, 'misses');

        // Coalesce concurrent misses so only one upstream call runs
        const pendKey = `${bucket}::${key}`;
        if (pending.has(pendKey)) {
            bump(bucket, 'coalesced');
            const shared = await pending.get(pendKey);
            if (!res.headersSent && shared) {
                res.writeHead(shared.status, {
                    ...shared.headers,
                    'X-Cache': 'COALESCED',
                    'X-Cache-Bucket': bucket
                });
                res.end(shared.body);
            }
            return;
        }

        // Miss path: wrap res to capture the successful body
        let captured = null;
        const originalWriteHead = res.writeHead.bind(res);
        const originalEnd = res.end.bind(res);
        const chunks = [];
        let statusCode = 200;
        let headers = {};

        res.writeHead = function (status, hdrs) {
            statusCode = status;
            headers = hdrs || {};
            return originalWriteHead(status, hdrs);
        };
        res.end = function (chunk) {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
            const body = Buffer.concat(chunks);
            // Only cache 2xx responses
            if (statusCode >= 200 && statusCode < 300) {
                captured = { status: statusCode, headers, body };
                cache.set(bucket === 'ai-analysis' ? key : key, captured);
                bump(bucket, 'sets');
            }
            return originalEnd(chunk);
        };

        const p = (async () => {
            try {
                await handler(req, res);
                return captured;
            } catch (err) {
                bump(bucket, 'errors');
                throw err;
            } finally {
                pending.delete(pendKey);
            }
        })();

        pending.set(pendKey, p);
        try {
            await p;
        } catch (err) {
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: err.message || 'Internal error' }));
            }
        }
    };
}

function invalidate(bucket, key) {
    const cache = caches.get(bucket);
    if (!cache) return 0;
    if (key === undefined || key === null) {
        const size = cache.size;
        cache.clear();
        return size;
    }
    return cache.delete(key) ? 1 : 0;
}

function invalidateAll() {
    let total = 0;
    for (const [, c] of caches) {
        total += c.size;
        c.clear();
    }
    pending.clear();
    return total;
}

/**
 * Invalidate common read buckets after a data mutation.
 * Keeps cache invalidation concentrated instead of sprinkled.
 */
function invalidateOnDataChange() {
    const buckets = ['api-short', 'api-medium'];
    let n = 0;
    for (const b of buckets) n += invalidate(b);
    return n;
}

function getStats() {
    const out = {
        uptime_sec: Math.round((Date.now() - startedAt) / 1000),
        buckets: {},
        totals: { hits: 0, misses: 0, sets: 0, errors: 0, coalesced: 0 }
    };
    for (const [name, s] of stats) {
        const c = caches.get(name);
        const totalReads = s.hits + s.misses;
        const hitRate = totalReads === 0 ? 0 : +(s.hits / totalReads).toFixed(3);
        out.buckets[name] = {
            size: c.size,
            max: c.max,
            ttl_ms: s.ttlMs,
            hits: s.hits,
            misses: s.misses,
            sets: s.sets,
            errors: s.errors,
            coalesced: s.coalesced,
            hit_rate: hitRate
        };
        out.totals.hits += s.hits;
        out.totals.misses += s.misses;
        out.totals.sets += s.sets;
        out.totals.errors += s.errors;
        out.totals.coalesced += s.coalesced;
    }
    const tr = out.totals.hits + out.totals.misses;
    out.totals.hit_rate = tr === 0 ? 0 : +(out.totals.hits / tr).toFixed(3);
    return out;
}

// Periodic log so Railway surfaces cache efficacy without a request
let loggerHandle = null;
function startPeriodicLog(intervalMs = 10 * 60_000) {
    if (loggerHandle) return;
    loggerHandle = setInterval(() => {
        const s = getStats();
        if (s.totals.hits + s.totals.misses === 0) return;
        console.log(`📊 [cache] uptime=${s.uptime_sec}s hits=${s.totals.hits} misses=${s.totals.misses} hit_rate=${(s.totals.hit_rate * 100).toFixed(1)}% coalesced=${s.totals.coalesced}`);
    }, intervalMs).unref?.();
}

function stopPeriodicLog() {
    if (loggerHandle) {
        clearInterval(loggerHandle);
        loggerHandle = null;
    }
}

module.exports = {
    createCache,
    getCache,
    getOrCompute,
    cachedJsonHandler,
    invalidate,
    invalidateAll,
    invalidateOnDataChange,
    getStats,
    startPeriodicLog,
    stopPeriodicLog
};
