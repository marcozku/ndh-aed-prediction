/**
 * NDH AED 預測系統 - 主入口文件
 * 模組化架構，世界級設計
 * 
 * 此文件作為包裝層，載入原始的 prediction.js 以保留所有功能
 */

// 動態載入原始預測邏輯（保留所有功能）
import('./prediction.js').then(() => {
    console.log('✅ 原始預測邏輯已載入');
}).catch(error => {
    console.error('❌ 載入預測邏輯失敗:', error);
    // 如果載入失敗，直接執行原始初始化邏輯
    if (typeof NDHAttendancePredictor !== 'undefined') {
        console.log('✅ 使用全局預測器類');
    }
});

// 導入模組化組件
import { API } from './modules/api.js';
import { DateTime } from './modules/datetime.js';
import { Status } from './modules/status.js';
import { Weather } from './modules/weather.js';
import { Learning } from './modules/learning.js';
import { initUIEnhancements, AlertManager, Toast } from './modules/ui-enhancements.js';

// 註冊 Service Worker (改進 iOS Safari PWA 更新)
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
            console.log('✅ Service Worker 已註冊:', registration.scope);
            
            // 定期檢查更新 (每 5 分鐘，iOS Safari PWA 需要)
            setInterval(() => {
                registration.update().catch(() => {});
            }, 5 * 60 * 1000);
            
            // 立即檢查更新
            registration.update().catch(() => {});
            
            // 檢查更新
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                if (!newWorker) return;
                
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed') {
                        if (navigator.serviceWorker.controller) {
                            // 有新版本 - 自動跳過等待並刷新 (iOS Safari PWA)
                            console.log('🔄 新版本已安裝，自動更新...');
                            newWorker.postMessage('SKIP_WAITING');
                            
                            // 顯示通知
                            if (typeof Toast !== 'undefined') {
                                Toast.show('正在更新到新版本...', 'info');
                            }
                            
                            // 等待控制權切換後刷新
                            navigator.serviceWorker.addEventListener('controllerchange', () => {
                                console.log('🔄 SW 控制權已切換，刷新頁面');
                                window.location.reload();
                            }, { once: true });
                        }
                    }
                });
            });
        } catch (error) {
            console.warn('⚠️ Service Worker 註冊失敗:', error);
        }
    }
}

// 應用程式主類
class App {
    constructor() {
        this.predictor = null;
        this.initialized = false;
    }

    async init() {
        console.log('🏥 NDH AED 預測系統初始化（模組化版本 v2.9.4）...');
        
        // 註冊 Service Worker（離線支援）
        registerServiceWorker();
        
        try {
            // 初始化 UI 增強功能
            initUIEnhancements();
            
            // 初始化日期時間
            DateTime.init();
            
            // 初始化狀態監控
            await Status.init();
            
            // 等待原始 prediction.js 載入完成
            // 原始文件會在 DOMContentLoaded 時自動初始化
            // 這裡我們只是確保模組化組件已準備好
            
            // 初始化天氣
            await Weather.init();

            // 初始化學習系統
            await Learning.init();

            this.initialized = true;
            console.log('✅ NDH AED 預測系統模組化組件就緒');
        } catch (error) {
            console.error('❌ 初始化失敗:', error);
        }
    }
}

// 導出 AlertManager 和 Toast 供 prediction.js 使用
window.AlertManager = AlertManager;
window.Toast = Toast;

// 全局函數（用於 HTML onclick）
window.triggerAddActualData = async () => {
    try {
        const result = await API.addActualData();
        if (result.success) {
            alert('✅ 實際數據已成功添加！');
            // 使用統一的圖表刷新函數刷新所有圖表
            if (typeof window.refreshAllChartsAfterDataUpdate === 'function') {
                await window.refreshAllChartsAfterDataUpdate();
            } else {
                // 後備方案：手動刷新圖表
                if (typeof initHistoryChart === 'function') {
                    await initHistoryChart();
                }
                if (typeof initComparisonChart === 'function') {
                    await initComparisonChart();
                }
                if (typeof initComparisonTable === 'function') {
                    await initComparisonTable();
                }
            }
        } else {
            alert('❌ 添加數據失敗：' + (result.error || '未知錯誤'));
        }
    } catch (error) {
        console.error('添加實際數據失敗:', error);
        alert('❌ 添加數據時發生錯誤：' + error.message);
    }
};

// 初始化應用程式（與原始初始化並行運行）
document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
});
