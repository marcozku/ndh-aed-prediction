/**
 * NDH AED 預測系統 - Service Worker
 * 提供離線支援和快取管理
 * v2.6.6
 */

const CACHE_NAME = 'ndh-aed-v3.0.73';
const STATIC_CACHE = 'ndh-static-v3.0.73';
const DYNAMIC_CACHE = 'ndh-dynamic-v3.0.73';

// 靜態資源（始終快取）
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/prediction.js',
    '/modules/ui-enhancements.js',
    '/modules/api.js',
    '/modules/datetime.js',
    '/modules/status.js',
    '/modules/weather.js',
    '/favicon.svg',
    '/manifest.json'
];

// API 路由（動態快取）
const API_ROUTES = [
    '/api/predictions',
    '/api/ai-analysis',
    '/api/comparison',
    '/api/status'
];

// 安裝事件
self.addEventListener('install', (event) => {
    console.log('[SW] 安裝中...');
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => {
                console.log('[SW] 快取靜態資源');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => self.skipWaiting())
            .catch((err) => console.error('[SW] 安裝失敗:', err))
    );
});

// 啟動事件
self.addEventListener('activate', (event) => {
    console.log('[SW] 啟動中...');
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name.startsWith('ndh-') && name !== STATIC_CACHE && name !== DYNAMIC_CACHE)
                        .map((name) => {
                            console.log('[SW] 刪除舊快取:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => self.clients.claim())
    );
});

// 請求攔截
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);
    
    // 跳過非 HTTP 請求
    if (!url.protocol.startsWith('http')) return;
    
    // 跳過 POST 請求（Cache API 不支援 POST）
    if (request.method !== 'GET') return;
    
    // API 請求 - 網絡優先，失敗時使用快取
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(networkFirstStrategy(request));
        return;
    }
    
    // 靜態資源 - 快取優先
    event.respondWith(cacheFirstStrategy(request));
});

// 快取優先策略
async function cacheFirstStrategy(request) {
    // 只處理 GET 請求（額外保護）
    if (request.method !== 'GET') {
        return fetch(request);
    }
    
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
        // 後台更新快取
        fetch(request)
            .then((response) => {
                if (response.ok) {
                    caches.open(STATIC_CACHE).then((cache) => {
                        cache.put(request, response.clone());
                    });
                }
            })
            .catch(() => {});
        return cachedResponse;
    }
    
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        // 返回離線頁面
        return caches.match('/index.html');
    }
}

// 網絡優先策略
async function networkFirstStrategy(request) {
    try {
        const response = await fetch(request);
        // 只緩存 GET 請求（額外保護，避免 POST 到達這裡）
        if (response.ok && request.method === 'GET') {
            const cache = await caches.open(DYNAMIC_CACHE);
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            console.log('[SW] 使用 API 快取:', request.url);
            return cachedResponse;
        }
        // 返回離線 JSON
        return new Response(
            JSON.stringify({ 
                error: 'Offline', 
                message: '網絡不可用，請稍後重試',
                cached: true
            }),
            { 
                status: 503, 
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
}

// 後台同步
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-data') {
        console.log('[SW] 後台同步觸發');
        event.waitUntil(syncData());
    }
});

async function syncData() {
    try {
        // 重新獲取並快取最新預測數據
        const response = await fetch('/api/predictions');
        if (response.ok) {
            const cache = await caches.open(DYNAMIC_CACHE);
            cache.put('/api/predictions', response);
            console.log('[SW] 數據同步完成');
        }
    } catch (error) {
        console.error('[SW] 同步失敗:', error);
    }
}

// 推送通知
self.addEventListener('push', (event) => {
    const data = event.data?.json() || {
        title: 'NDH AED 預測',
        body: '有新的預測數據更新',
        icon: '/favicon.svg'
    };
    
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: data.icon || '/favicon.svg',
            badge: '/favicon.svg',
            vibrate: [200, 100, 200],
            tag: 'ndh-notification',
            renotify: true,
            data: data.url || '/'
        })
    );
});

// 通知點擊
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                if (clientList.length > 0) {
                    return clientList[0].focus();
                }
                return clients.openWindow(event.notification.data || '/');
            })
    );
});

console.log('[SW] Service Worker 已載入 v3.0.70');

