/**
 * 自動學習系統模組 - v4.0.00
 * 顯示學習狀態、天氣影響參數、異常事件等
 */

import { API } from './api.js';

const Learning = {
    data: {
        summary: null,
        weatherImpacts: null,
        anomalies: null,
        aiEvents: null,
        schedulerStatus: null
    },

    /**
     * 初始化學習系統
     */
    async init() {
        console.log('🧠 初始化自動學習系統...');
        await this.loadAllData();
    },

    /**
     * 加載所有學習數據
     */
    async loadAllData() {
        try {
            // 並行加載所有數據
            const [summary, weatherImpacts, anomalies, aiEvents, schedulerStatus] = await Promise.all([
                this.fetchSummary(),
                this.fetchWeatherImpacts(),
                this.fetchAnomalies(),
                this.fetchAIEvents(),
                this.fetchSchedulerStatus()
            ]);

            this.data.summary = summary;
            this.data.weatherImpacts = weatherImpacts;
            this.data.anomalies = anomalies;
            this.data.aiEvents = aiEvents;
            this.data.schedulerStatus = schedulerStatus;

            this.render();
        } catch (error) {
            console.error('加載學習數據失敗:', error);
            this.renderError(error.message);
        }
    },

    /**
     * 獲取學習摘要
     */
    async fetchSummary() {
        const response = await fetch('/api/learning/summary');
        if (!response.ok) throw new Error('獲取學習摘要失敗');
        const data = await response.json();
        return data.success ? data.data : null;
    },

    /**
     * 獲取天氣影響參數
     */
    async fetchWeatherImpacts() {
        const response = await fetch('/api/learning/weather-impacts');
        if (!response.ok) throw new Error('獲取天氣影響失敗');
        const data = await response.json();
        return data.success ? data.data : null;
    },

    /**
     * 獲取異常事件
     */
    async fetchAnomalies() {
        const response = await fetch('/api/learning/anomalies?limit=10');
        if (!response.ok) throw new Error('獲取異常事件失敗');
        const data = await response.json();
        return data.success ? data.data : null;
    },

    /**
     * 獲取 AI 事件學習
     */
    async fetchAIEvents() {
        const response = await fetch('/api/learning/ai-events');
        if (!response.ok) throw new Error('獲取 AI 事件失敗');
        const data = await response.json();
        return data.success ? data.data : null;
    },

    /**
     * 獲取調度器狀態
     */
    async fetchSchedulerStatus() {
        const response = await fetch('/api/learning/scheduler-status');
        if (!response.ok) throw new Error('獲取調度器狀態失敗');
        const data = await response.json();
        return data.success ? data.data : null;
    },

    /**
     * 手動觸發學習更新
     */
    async triggerUpdate(type = 'all') {
        try {
            const response = await fetch('/api/learning/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type })
            });
            const data = await response.json();
            if (data.success) {
                // 重新加載數據
                await this.loadAllData();
                return { success: true, message: data.message };
            }
            return { success: false, message: data.error || '更新失敗' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    },

    /**
     * 渲染學習儀表板
     */
    render() {
        const container = document.getElementById('learning-dashboard');
        if (!container) return;

        // 隱藏 loading
        const loading = document.getElementById('learning-loading');
        if (loading) loading.style.display = 'none';

        // 檢查是否已初始化（數據庫表可能不存在）
        if (!this.data.summary && !this.data.weatherImpacts) {
            container.innerHTML = this.renderNotReady();
            return;
        }

        container.innerHTML = `
            <div class="learning-grid">
                ${this.renderSummaryCard()}
                ${this.renderWeatherImpactsCard()}
                ${this.renderAnomaliesCard()}
                ${this.renderAIEventsCard()}
                ${this.renderSchedulerCard()}
            </div>
        `;

        // 添加事件監聽器
        this.attachEventListeners();
    },

    /**
     * 渲染摘要卡片
     */
    renderSummaryCard() {
        const s = this.data.summary || {};
        const learningDays = s.total_learning_days || 0;
        const avgError = s.average_error ? s.average_error.toFixed(2) : '-';
        const anomalyCount = s.anomaly_count || 0;
        const lastUpdate = s.last_learning_date || '-';

        return `
            <div class="learning-card summary-card">
                <div class="card-header">
                    <h3>📊 學習摘要</h3>
                    <button class="refresh-btn" data-action="refresh" title="刷新數據">🔄</button>
                </div>
                <div class="learning-stats">
                    <div class="stat-item">
                        <span class="stat-label">學習天數</span>
                        <span class="stat-value">${learningDays}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">平均誤差</span>
                        <span class="stat-value">${avgError} 人</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">異常事件</span>
                        <span class="stat-value ${anomalyCount > 0 ? 'stat-warning' : ''}">${anomalyCount}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">最後更新</span>
                        <span class="stat-value stat-small">${lastUpdate}</span>
                    </div>
                </div>
            </div>
        `;
    },

    /**
     * 渲染天氣影響卡片
     */
    renderWeatherImpactsCard() {
        const impacts = this.data.weatherImpacts?.parameters || [];

        let impactsHTML = '';
        if (impacts.length === 0) {
            impactsHTML = '<div class="empty-state">暫無天氣影響數據</div>';
        } else {
            impactsHTML = impacts.map(p => `
                <div class="impact-item">
                    <span class="impact-name">${this.formatParameterName(p.parameter_name)}</span>
                    <span class="impact-value ${p.parameter_value > 0 ? 'positive' : p.parameter_value < 0 ? 'negative' : ''}">
                        ${p.parameter_value > 0 ? '+' : ''}${p.parameter_value.toFixed(2)}
                    </span>
                    <span class="impact-samples">n=${p.sample_count}</span>
                </div>
            `).join('');
        }

        return `
            <div class="learning-card weather-card">
                <div class="card-header">
                    <h3>🌤️ 天氣影響參數</h3>
                </div>
                <div class="impacts-list">
                    ${impactsHTML}
                </div>
            </div>
        `;
    },

    /**
     * 渲染異常事件卡片
     */
    renderAnomaliesCard() {
        const anomalies = this.data.anomalies?.anomalies || [];

        let anomaliesHTML = '';
        if (anomalies.length === 0) {
            anomaliesHTML = '<div class="empty-state">🎉 無異常事件</div>';
        } else {
            anomaliesHTML = anomalies.map(a => `
                <div class="anomaly-item">
                    <span class="anomaly-date">${a.date}</span>
                    <span class="anomaly-type">${a.anomaly_type || '未知'}</span>
                    <span class="anomaly-error">${a.prediction_error?.toFixed(1) || '-'} 人</span>
                </div>
            `).join('');
        }

        return `
            <div class="learning-card anomalies-card">
                <div class="card-header">
                    <h3>⚠️ 最近異常事件</h3>
                </div>
                <div class="anomalies-list">
                    ${anomaliesHTML}
                </div>
            </div>
        `;
    },

    /**
     * 渲染 AI 事件卡片
     */
    renderAIEventsCard() {
        const events = this.data.aiEvents?.events || [];

        let eventsHTML = '';
        if (events.length === 0) {
            eventsHTML = '<div class="empty-state">暫無 AI 事件數據</div>';
        } else {
            eventsHTML = events.map(e => `
                <div class="ai-event-item">
                    <span class="ai-event-name">${e.ai_event || '未知'}</span>
                    <span class="ai-event-impact ${e.avg_impact > 0 ? 'positive' : e.avg_impact < 0 ? 'negative' : ''}">
                        ${e.avg_impact > 0 ? '+' : ''}${(e.avg_impact || 0).toFixed(1)}
                    </span>
                    <span class="ai-event-count">${e.event_count || 0} 次</span>
                </div>
            `).join('');
        }

        return `
            <div class="learning-card ai-events-card">
                <div class="card-header">
                    <h3>🤖 AI 因素學習</h3>
                </div>
                <div class="ai-events-list">
                    ${eventsHTML}
                </div>
            </div>
        `;
    },

    /**
     * 渲染調度器卡片
     */
    renderSchedulerCard() {
        const status = this.data.schedulerStatus || {};
        const isRunning = status.is_running || false;
        const lastRun = status.last_run || '-';
        const nextRun = status.next_run || '-';

        return `
            <div class="learning-card scheduler-card">
                <div class="card-header">
                    <h3>⏰ 調度器狀態</h3>
                    <button class="action-btn" data-action="run-learning" title="立即執行學習">▶️ 執行</button>
                </div>
                <div class="scheduler-info">
                    <div class="scheduler-item">
                        <span class="scheduler-label">狀態</span>
                        <span class="scheduler-status ${isRunning ? 'running' : 'stopped'}">
                            ${isRunning ? '🟢 運行中' : '⚪ 已停止'}
                        </span>
                    </div>
                    <div class="scheduler-item">
                        <span class="scheduler-label">上次執行</span>
                        <span class="scheduler-value">${lastRun}</span>
                    </div>
                    <div class="scheduler-item">
                        <span class="scheduler-label">下次執行</span>
                        <span class="scheduler-value">${nextRun}</span>
                    </div>
                    <div class="scheduler-schedule">
                        <small>每日 00:30 HKT 自動學習</small>
                    </div>
                </div>
            </div>
        `;
    },

    /**
     * 渲染未準備狀態
     */
    renderNotReady() {
        return `
            <div class="learning-not-ready">
                <div class="not-ready-icon">🧠</div>
                <h3>自動學習系統</h3>
                <p>學習系統需要數據庫支持。請確保已執行 migration。</p>
                <div class="not-ready-actions">
                    <button class="btn-primary" onclick="window.Learning?.triggerUpdate()">
                        檢查狀態
                    </button>
                </div>
            </div>
        `;
    },

    /**
     * 渲染錯誤狀態
     */
    renderError(message) {
        const container = document.getElementById('learning-dashboard');
        if (!container) return;

        const loading = document.getElementById('learning-loading');
        if (loading) loading.style.display = 'none';

        container.innerHTML = `
            <div class="learning-error">
                <div class="error-icon">❌</div>
                <h3>加載失敗</h3>
                <p>${message}</p>
                <button class="btn-secondary" onclick="window.Learning?.loadAllData()">
                    重試
                </button>
            </div>
        `;
    },

    /**
     * 格式化參數名稱
     */
    formatParameterName(name) {
        const names = {
            'very_cold_impact': '嚴寒',
            'very_hot_impact': '酷熱',
            'heavy_rain_impact': '大雨',
            'strong_wind_impact': '強風',
            'low_humidity_impact': '低濕',
            'high_pressure_impact': '高氣壓',
            'typhoon_signal_impact': '颱風',
            'rainstorm_warning_impact': '暴雨警告'
        };
        return names[name] || name;
    },

    /**
     * 添加事件監聽器
     */
    attachEventListeners() {
        // 刷新按鈕
        document.querySelectorAll('[data-action="refresh"]').forEach(btn => {
            btn.addEventListener('click', () => this.loadAllData());
        });

        // 執行學習按鈕
        document.querySelectorAll('[data-action="run-learning"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                btn.textContent = '⏳ 執行中...';

                const result = await this.triggerUpdate('all');

                if (result.success) {
                    btn.textContent = '✅ 完成';
                    setTimeout(() => {
                        btn.disabled = false;
                        btn.textContent = '▶️ 執行';
                    }, 2000);
                } else {
                    btn.textContent = '❌ 失敗';
                    setTimeout(() => {
                        btn.disabled = false;
                        btn.textContent = '▶️ 執行';
                    }, 2000);
                }
            });
        });
    }
};

// 導出供外部使用
window.Learning = Learning;
export { Learning };
