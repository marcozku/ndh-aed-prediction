/**
 * Main browser entry point.
 * prediction.js owns the prediction UI bootstrap and data refresh flow.
 */
import './prediction.js';
import { Learning } from './modules/learning.js';
import { initUIEnhancements, AlertManager, Toast } from './modules/ui-enhancements.js';

async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        return;
    }

    try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        console.log('✅ Service Worker 已註冊:', registration.scope);

        setInterval(() => {
            registration.update().catch(() => {});
        }, 5 * 60 * 1000);

        registration.update().catch(() => {});

        registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (!newWorker) {
                return;
            }

            newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    console.log('🔄 新版本已安裝，自動更新...');
                    newWorker.postMessage('SKIP_WAITING');

                    if (typeof Toast !== 'undefined') {
                        Toast.show('正在更新到新版本...', 'info');
                    }

                    navigator.serviceWorker.addEventListener('controllerchange', () => {
                        console.log('🔄 SW 控制權已切換，刷新頁面');
                        window.location.reload();
                    }, { once: true });
                }
            });
        });
    } catch (error) {
        console.warn('⚠️ Service Worker 註冊失敗:', error);
    }
}

window.AlertManager = AlertManager;
window.Toast = Toast;

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🏥 NDH AED 增強模組初始化...');

    registerServiceWorker();
    initUIEnhancements();

    try {
        await Learning.init();
    } catch (error) {
        console.error('❌ 學習模組初始化失敗:', error);
    }
});
