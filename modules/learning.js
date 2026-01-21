/**
 * 自動學習系統模組 - v4.0.01
 * 顯示學習狀態、天氣影響參數、異常事件等；每 60 秒輪詢，有新資料自動更新
 */

import { API } from './api.js';

const Learning = {
    data: {
        summary: null,
        weatherImpacts: null,
        anomalies: null,
        aiEvents: null,
        schedulerStatus: null,
        errors: []
    },

    // API 請求超時時間（毫秒）
    timeout: 10000,

    // 輪詢間隔（毫秒），0=不輪詢；有新資料時自動跟上
    pollIntervalMs: 60000,

    _pollTimer: null,

    /**
     * 初始化學習系統
     */
    init() {
        console.log('🧠 初始化自動學習系統...');
        setTimeout(async () => {
            await this.loadAllData();
            this._startPolling();
            this._setupVisibilityListener();
        }, 500);
    },

    _startPolling() {
        if (this._pollTimer) clearInterval(this._pollTimer);
        if (!this.pollIntervalMs) return;
        this._pollTimer = setInterval(() => {
            if (document.hidden) return;
            this.loadAllData();
        }, this.pollIntervalMs);
    },

    _stopPolling() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    },

    _setupVisibilityListener() {
        if (this._visibilityListenerBound) return;
        this._visibilityListenerBound = true;
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this.loadAllData();
                this._startPolling();
            } else {
                this._stopPolling();
            }
        });
    },

    formatDateHKT(v) {
        if (v == null || v === '') return '';
        const d = new Date(v);
        return isNaN(d.getTime()) ? '' : d.toLocaleDateString('zh-HK', { timeZone: 'Asia/Hong_Kong' });
    },

    formatDateTimeHKT(v) {
        if (v == null || v === '') return '';
        const d = new Date(v);
        return isNaN(d.getTime()) ? '' : d.toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' });
    },

    /**
     * 帶超時的 fetch
     */
    async fetchWithTimeout(url, options = {}) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('請求超時');
            }
            throw error;
        }
    },

    /**
     * 加載所有學習數據（獨立處理每個請求）
     */
    async loadAllData() {
        this.data.errors = [];

        // 獨立加載每個數據源，一個失敗不影響其他
        const loadSummary = this.safeFetch('summary', () => this.fetchSummary());
        const loadWeatherImpacts = this.safeFetch('weatherImpacts', () => this.fetchWeatherImpacts());
        const loadAnomalies = this.safeFetch('anomalies', () => this.fetchAnomalies());
        const loadAIEvents = this.safeFetch('aiEvents', () => this.fetchAIEvents());
        const loadSchedulerStatus = this.safeFetch('schedulerStatus', () => this.fetchSchedulerStatus());

        // 等待所有請求完成（無論成功或失敗）
        await Promise.all([
            loadSummary,
            loadWeatherImpacts,
            loadAnomalies,
            loadAIEvents,
            loadSchedulerStatus
        ]);

        this.render();
    },

    /**
     * 安全加載數據（捕獲錯誤但不中斷）
     */
    async safeFetch(key, fetchFn) {
        try {
            const result = await fetchFn();
            if (result) {
                this.data[key] = result;
                console.log(`✅ 學習系統 ${key} 加載成功`);
            } else {
                console.warn(`⚠️ 學習系統 ${key} 返回空數據`);
            }
        } catch (error) {
            console.error(`❌ 學習系統 ${key} 加載失敗:`, error.message);
            this.data.errors.push({ key, error: error.message });
        }
    },

    /**
     * 獲取學習摘要
     */
    _okOrThrow(response) {
        if (response.ok) return;
        if (response.status === 502 || response.status === 503) throw new Error('學習服務暫時不可用');
        throw new Error(`HTTP ${response.status}`);
    },

    async fetchSummary() {
        const response = await this.fetchWithTimeout('/api/learning/summary');
        if (response.status === 404) return null;
        this._okOrThrow(response);
        const data = await response.json();
        return data.success ? data.data : null;
    },

    async fetchWeatherImpacts() {
        const response = await this.fetchWithTimeout('/api/learning/weather-impacts');
        if (response.status === 404) return null;
        this._okOrThrow(response);
        const data = await response.json();
        return data.success ? data.data : null;
    },

    async fetchAnomalies() {
        const response = await this.fetchWithTimeout('/api/learning/anomalies?limit=10');
        if (response.status === 404) return null;
        this._okOrThrow(response);
        const data = await response.json();
        return data.success ? data.data : null;
    },

    async fetchAIEvents() {
        const response = await this.fetchWithTimeout('/api/learning/ai-events');
        if (response.status === 404) return null;
        this._okOrThrow(response);
        const data = await response.json();
        return data.success ? data.data : null;
    },

    async fetchSchedulerStatus() {
        const response = await this.fetchWithTimeout('/api/learning/scheduler-status');
        if (response.status === 404) return null;
        this._okOrThrow(response);
        const data = await response.json();
        return data.success ? data.data : null;
    },

    /**
     * 手動觸發學習更新（執行按鈕：改走 scheduler-run 以更新上次執行時間）
     */
    async triggerUpdate(type = 'all') {
        try {
            // 執行按鈕的 daily/all 改走 scheduler-run，確保 lastRunTime 會更新
            if (type === 'all' || type === 'daily') {
                const r = await fetch('/api/learning/scheduler-run', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ task: 'daily' })
                });
                const data = await r.json();
                if (data.success) {
                    await this.loadAllData();
                    return { success: true, message: data.message };
                }
                return { success: false, message: data.error || '觸發失敗' };
            }
            const response = await fetch('/api/learning/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type })
            });
            const data = await response.json();
            if (data.success) {
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

        // 檢查是否有任何數據
        const hasData = this.data.summary || this.data.weatherImpacts ||
                       this.data.anomalies || this.data.aiEvents || this.data.schedulerStatus;

        // 檢查是否所有請求都失敗了
        const allFailed = this.data.errors.length >= 5;

        if (allFailed) {
            container.innerHTML = this.renderNotReady(this.data.errors);
            return;
        }

        if (!hasData) {
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
        const avgError = (s.average_error != null && s.average_error !== '') ? Number(s.average_error).toFixed(2) : '-';
        const anomalyCount = s.anomaly_count || 0;
        const lastLearning = s.last_learning_date ? this.formatDateHKT(s.last_learning_date) : '尚無記錄';

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
                        <span class="stat-value">${avgError === '-' ? '-' : avgError + ' 人'}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">異常事件</span>
                        <span class="stat-value ${anomalyCount > 0 ? 'stat-warning' : ''}">${anomalyCount}</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">最後學習日</span>
                        <span class="stat-value stat-small">${lastLearning}</span>
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
            impactsHTML = impacts.map(p => {
                const num = (p.parameter_value != null && p.parameter_value !== '') ? Number(p.parameter_value) : NaN;
                const disp = Number.isFinite(num) ? `${num > 0 ? '+' : ''}${num.toFixed(2)}` : '-';
                return `
                <div class="impact-item">
                    <span class="impact-name">${this.formatParameterName(p.parameter_name)}</span>
                    <span class="impact-value ${num > 0 ? 'positive' : num < 0 ? 'negative' : ''}">
                        ${disp}
                    </span>
                    <span class="impact-samples">n=${p.sample_count ?? '-'}</span>
                </div>
            `;
            }).join('');
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
                    <span class="anomaly-error">${(a.prediction_error != null && a.prediction_error !== '') ? Number(a.prediction_error).toFixed(1) : '-'} 人</span>
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
                    <span class="ai-event-impact ${Number(e.avg_impact || 0) > 0 ? 'positive' : Number(e.avg_impact || 0) < 0 ? 'negative' : ''}">
                        ${Number(e.avg_impact || 0) > 0 ? '+' : ''}${Number(e.avg_impact || 0).toFixed(1)}
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
        const taskRunning = status.is_running || false;
        const schedulerActive = status.scheduler_active ?? ((status.scheduled_tasks || 0) > 0);
        const statusText = taskRunning ? '🟢 執行中' : (schedulerActive ? '🟢 運行中' : '⚪ 已停止');
        const lastRun = status.last_run_time ? this.formatDateTimeHKT(status.last_run_time) : '從未執行';
        const nextRun = status.next_run || '每日 00:30 HKT';

        return `
            <div class="learning-card scheduler-card">
                <div class="card-header">
                    <h3>⏰ 調度器狀態</h3>
                    <button class="action-btn" data-action="run-learning" title="立即執行學習">▶️ 執行</button>
                </div>
                <div class="scheduler-info">
                    <div class="scheduler-item">
                        <span class="scheduler-label">狀態</span>
                        <span class="scheduler-status ${schedulerActive || taskRunning ? 'running' : 'stopped'}">
                            ${statusText}
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
    renderNotReady(errors = null) {
        let message = '<p>學習系統需要數據庫支持。請確保已執行 migration。</p>';

        if (errors && errors.length > 0) {
            const errorMsgs = errors.map(e => e.error).filter(e => e).join(', ');
            if (errorMsgs) {
                message = `<p class="error-detail">錯誤：${errorMsgs}</p>`;
            }
        }

        return `
            <div class="learning-not-ready">
                <div class="not-ready-icon">🧠</div>
                <h3>自動學習系統</h3>
                ${message}
                <div class="not-ready-actions">
                    <button class="btn-primary" onclick="window.Learning?.loadAllData()">
                        重新載入
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
