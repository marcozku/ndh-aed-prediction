/**
 * 狀態監控模組
 */
import { API } from './api.js';

export class Status {
    static async init() {
        await this.check();
        setInterval(() => this.check(), 300000); // 每5分鐘
    }

    static async check() {
        await this.checkDatabase();
        await this.checkAI();
    }

    static async checkDatabase() {
        const status = await API.getDBStatus();
        const el = document.getElementById('db-status');
        if (el) {
            el.className = `status-badge db-status ${status.connected ? 'connected' : 'disconnected'}`;
            el.innerHTML = `
                <span class="status-icon">${status.connected ? '✅' : '❌'}</span>
                <span class="status-text">${status.connected ? '數據庫已連接' : '數據庫未連接'}</span>
            `;
        }
    }

    static async checkAI() {
        const status = await API.getAIStatus();
        const el = document.getElementById('ai-status');
        if (el) {
            el.className = `status-badge ai-status ${status.connected ? 'connected' : 'disconnected'}`;
            if (status.connected) {
                const modelName = status.currentModel || '未知';
                const tierNames = { premium: '高級', standard: '中級', basic: '基礎' };
                const tierName = tierNames[status.modelTier] || '';
                el.innerHTML = `
                    <span class="status-icon">🤖</span>
                    <span class="status-text">${tierName} ${modelName}</span>
                `;
            } else {
                el.innerHTML = `
                    <span class="status-icon">❌</span>
                    <span class="status-text">AI 未連接</span>
                `;
            }
        }
    }
}
