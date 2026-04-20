/**
 * modules/circuit-breaker.js - v5.2.0
 *
 * Opossum-based circuit breakers for slow/unreliable dependencies:
 *  - AI service (GPT-5.4 calls can time out or 5xx)
 *  - HKO weather external API
 *  - Python child-process predictions
 *
 * A breaker protects the server from cascading slowdowns when an
 * upstream dependency starts failing. When too many calls fail (or
 * time out), the breaker "opens" and fast-fails subsequent calls
 * for a cool-down period, letting the app respond to users
 * immediately with a fallback (cached, empty, or degraded) instead
 * of piling up on a dying upstream.
 *
 * Every breaker logs state transitions to stdout so Railway logs
 * make the failure mode visible without extra tooling.
 */

const CircuitBreaker = require('opossum');

const breakers = new Map();

/**
 * createBreaker(name, asyncFn, options)
 *   options.timeout       — max ms per call (default 10s)
 *   options.errorThresholdPercentage — % errors before opening (default 50)
 *   options.resetTimeout  — ms before half-open probe (default 30s)
 *   options.fallback      — async fn called when breaker is open / times out
 *   options.volumeThreshold — minimum calls in window before opening (default 5)
 */
function createBreaker(name, asyncFn, options = {}) {
    const breaker = new CircuitBreaker(asyncFn, {
        timeout: options.timeout ?? 10_000,
        errorThresholdPercentage: options.errorThresholdPercentage ?? 50,
        resetTimeout: options.resetTimeout ?? 30_000,
        rollingCountTimeout: options.rollingCountTimeout ?? 60_000,
        rollingCountBuckets: options.rollingCountBuckets ?? 10,
        volumeThreshold: options.volumeThreshold ?? 5,
        name
    });

    if (options.fallback) {
        breaker.fallback(options.fallback);
    }

    breaker.on('open',     () => console.warn(`🔴 [breaker] OPEN ${name} — fast-failing for ${breaker.options.resetTimeout}ms`));
    breaker.on('halfOpen', () => console.log(`🟡 [breaker] HALF_OPEN ${name} — probing upstream`));
    breaker.on('close',    () => console.log(`🟢 [breaker] CLOSED ${name} — upstream recovered`));
    breaker.on('reject',   () => console.warn(`⛔ [breaker] ${name} call rejected (breaker open)`));
    breaker.on('timeout',  () => console.warn(`⏱ [breaker] ${name} timed out`));
    breaker.on('failure',  (err) => console.warn(`⚠ [breaker] ${name} failure: ${err?.message || err}`));

    breakers.set(name, breaker);
    return breaker;
}

function getBreaker(name) {
    return breakers.get(name);
}

function getBreakerStats() {
    const out = {};
    for (const [name, b] of breakers) {
        const s = b.stats;
        out[name] = {
            state: b.opened ? 'open' : (b.halfOpen ? 'half_open' : 'closed'),
            fires: s.fires,
            successes: s.successes,
            failures: s.failures,
            timeouts: s.timeouts,
            rejects: s.rejects,
            fallbacks: s.fallbacks,
            // success rate only counts calls that actually executed (not rejected)
            success_rate: s.fires === 0 ? null : +((s.successes / Math.max(1, s.fires - s.rejects)).toFixed(3))
        };
    }
    return out;
}

function shutdownAll() {
    for (const [, b] of breakers) {
        try { b.shutdown(); } catch (_) { /* noop */ }
    }
    breakers.clear();
}

module.exports = { createBreaker, getBreaker, getBreakerStats, shutdownAll };
