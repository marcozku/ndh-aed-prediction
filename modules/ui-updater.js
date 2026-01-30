/**
 * UI 更新模組
 * 包含所有 UI 更新相關函數
 */

import { formatDateDDMM, getHKTime } from './data-processor.js';

/**
 * 更新統計卡片
 */
export function updateStatsCard(predictor) {
    if (!predictor) return;

    try {
        const stats = predictor.getStatistics();

        const meanEl = document.getElementById('stat-mean');
        const maxEl = document.getElementById('stat-max');
        const minEl = document.getElementById('stat-min');
        const stdEl = document.getElementById('stat-std');

        if (meanEl) meanEl.textContent = Math.round(stats.globalMean);
        if (maxEl) maxEl.textContent = stats.max.value;
        if (minEl) minEl.textContent = stats.min.value;
        if (stdEl) stdEl.textContent = stats.stdDev.toFixed(1);

        console.log(`📊 統計摘要已更新: 均值=${Math.round(stats.globalMean)}, 最高=${stats.max.value}, 最低=${stats.min.value}`);
    } catch (e) {
        console.warn('統計摘要更新失敗:', e);
    }
}

/**
 * 更新載入進度
 */
export function updateSectionProgress(sectionId, percent) {
    const progressBar = document.querySelector(`#${sectionId} .progress-bar`);
    if (progressBar) {
        progressBar.style.width = `${percent}%`;
    }
}

/**
 * 更新數據源頁腳
 */
export function updateDataSourceFooter(dateRange) {
    const footerEl = document.getElementById('data-source-footer');
    if (footerEl && dateRange) {
        footerEl.textContent = `數據來源: ${dateRange.start} 至 ${dateRange.end} (${dateRange.days} 天)`;
    }
}

/**
 * 更新歷史日期範圍
 */
export function updateHistoryDateRange(startDate, endDate, range) {
    const rangeEl = document.getElementById('history-date-range');
    if (rangeEl) {
        rangeEl.textContent = `${formatDateDDMM(startDate, true)} - ${formatDateDDMM(endDate, true)}`;
    }
}

/**
 * 更新歷史導航按鈕
 */
export function updateHistoryNavigationButtons(range, pageOffset, historicalData) {
    const prevBtn = document.getElementById('history-prev');
    const nextBtn = document.getElementById('history-next');

    if (!prevBtn || !nextBtn) return;

    // 禁用/啟用按鈕
    if (pageOffset <= 0) {
        prevBtn.disabled = true;
        prevBtn.classList.add('disabled');
    } else {
        prevBtn.disabled = false;
        prevBtn.classList.remove('disabled');
    }

    // 檢查是否還有更多歷史數據
    const hasMoreData = historicalData && historicalData.length > 0;
    if (!hasMoreData) {
        nextBtn.disabled = true;
        nextBtn.classList.add('disabled');
    } else {
        nextBtn.disabled = false;
        nextBtn.classList.remove('disabled');
    }
}

/**
 * 更新天氣顯示
 */
export function updateWeatherDisplay(weatherData) {
    if (!weatherData) return;

    const tempEl = document.getElementById('weather-temp');
    const humidityEl = document.getElementById('weather-humidity');
    const rainfallEl = document.getElementById('weather-rainfall');
    const iconEl = document.getElementById('weather-icon');

    if (tempEl) tempEl.textContent = `${weatherData.temperature}°C`;
    if (humidityEl) humidityEl.textContent = `${weatherData.humidity}%`;
    if (rainfallEl) rainfallEl.textContent = `${weatherData.rainfall}mm`;
    if (iconEl && weatherData.icon) {
        iconEl.className = `weather-icon ${weatherData.icon}`;
    }
}

/**
 * 更新 AQHI 警告
 */
export function updateAQHIWarning(aqhi) {
    const warningEl = document.getElementById('aqhi-warning');
    if (!warningEl) return;

    if (aqhi >= 7) {
        warningEl.innerHTML = `
            <div class="alert alert-warning">
                <i class="fas fa-exclamation-triangle"></i>
                空氣質量健康指數: ${aqhi} (${getAQHIRiskLabel(aqhi)})
            </div>
        `;
        warningEl.style.display = 'block';
    } else {
        warningEl.style.display = 'none';
    }
}

/**
 * 獲取 AQHI 風險標籤
 */
export function getAQHIRiskLabel(value) {
    if (value <= 3) return '低';
    if (value <= 6) return '中';
    if (value <= 7) return '高';
    if (value <= 10) return '甚高';
    return '嚴重';
}

/**
 * 更新自動預測顯示
 */
export function updateAutoPredictDisplay(data) {
    const statusEl = document.getElementById('auto-predict-status');
    const nextRunEl = document.getElementById('auto-predict-next-run');
    const lastRunEl = document.getElementById('auto-predict-last-run');

    if (statusEl) {
        statusEl.textContent = data.enabled ? '啟用' : '停用';
        statusEl.className = data.enabled ? 'status-enabled' : 'status-disabled';
    }

    if (nextRunEl && data.nextRun) {
        nextRunEl.textContent = data.nextRun;
    }

    if (lastRunEl && data.lastRun) {
        lastRunEl.textContent = data.lastRun;
    }
}

/**
 * 更新自動預測倒計時
 */
export function updateAutoPredictCountdown() {
    const countdownEl = document.getElementById('auto-predict-countdown');
    if (!countdownEl) return;

    // 計算距離下次自動預測的時間
    const now = getHKTime();
    const nextRun = new Date(now);
    nextRun.setHours(8, 0, 0, 0);

    if (now.getHours() >= 8) {
        nextRun.setDate(nextRun.getDate() + 1);
    }

    const diff = nextRun - now;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    countdownEl.textContent = `${hours}小時${minutes}分鐘`;
}

/**
 * 更新 AI 因素倒計時
 */
export function updateAIFactorsCountdown() {
    const countdownEl = document.getElementById('ai-factors-countdown');
    if (!countdownEl) return;

    const lastUpdate = window.lastAIFactorsUpdate || Date.now();
    const nextUpdate = lastUpdate + (30 * 60 * 1000); // 30分鐘
    const now = Date.now();
    const diff = nextUpdate - now;

    if (diff <= 0) {
        countdownEl.textContent = '即將更新...';
        return;
    }

    const minutes = Math.floor(diff / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    countdownEl.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * 更新因素載入進度
 */
export function updateFactorsLoadingProgress(percent, statusText = null) {
    const progressBar = document.querySelector('.factors-loading .progress-bar');
    const statusEl = document.querySelector('.factors-loading .status-text');

    if (progressBar) {
        progressBar.style.width = `${percent}%`;
    }

    if (statusEl && statusText) {
        statusEl.textContent = statusText;
    }
}

/**
 * 更新實時因素
 */
export function updateRealtimeFactors(aiAnalysisData = null) {
    if (!aiAnalysisData) return;

    const factorsContainer = document.getElementById('realtime-factors');
    if (!factorsContainer) return;

    let html = '<div class="factors-grid">';

    if (aiAnalysisData.factors && Array.isArray(aiAnalysisData.factors)) {
        aiAnalysisData.factors.forEach(factor => {
            const impact = factor.impact || 0;
            const impactClass = impact > 0 ? 'positive' : impact < 0 ? 'negative' : 'neutral';

            html += `
                <div class="factor-card ${impactClass}">
                    <div class="factor-icon">${factor.icon || '📊'}</div>
                    <div class="factor-name">${factor.name}</div>
                    <div class="factor-impact">${impact > 0 ? '+' : ''}${impact.toFixed(1)}%</div>
                    <div class="factor-desc">${factor.description || ''}</div>
                </div>
            `;
        });
    }

    html += '</div>';
    factorsContainer.innerHTML = html;
}

/**
 * 更新 Bayesian 分解顯示
 */
export function updateBayesianBreakdown(todayPred) {
    const breakdownEl = document.getElementById('bayesian-breakdown');
    if (!breakdownEl) return;

    if (todayPred.bayesian && todayPred.bayesian.weights) {
        const weights = todayPred.bayesian.weights;
        breakdownEl.innerHTML = `
            <div class="bayesian-item">
                <span class="bayesian-label">基礎預測</span>
                <span class="bayesian-value">${todayPred.bayesian.base}</span>
                <span class="bayesian-weight">權重: ${(weights.base * 100).toFixed(1)}%</span>
            </div>
            <div class="bayesian-item">
                <span class="bayesian-label">AI 因素</span>
                <span class="bayesian-value">×${todayPred.bayesian.aiMultiplier.toFixed(3)}</span>
                <span class="bayesian-weight">權重: ${(weights.ai * 100).toFixed(1)}%</span>
            </div>
            <div class="bayesian-item">
                <span class="bayesian-label">天氣因素</span>
                <span class="bayesian-value">×${todayPred.bayesian.weatherMultiplier.toFixed(3)}</span>
                <span class="bayesian-weight">權重: ${(weights.weather * 100).toFixed(1)}%</span>
            </div>
            <div class="bayesian-result">
                <span class="bayesian-label">融合結果</span>
                <span class="bayesian-value">${todayPred.predicted} 人</span>
            </div>
        `;
        breakdownEl.style.display = 'block';
    } else {
        breakdownEl.style.display = 'none';
    }
}

/**
 * 更新訓練狀態顯示
 */
export function updateTrainingStatus(status) {
    const statusEl = document.getElementById('training-status');
    if (!statusEl) return;

    statusEl.innerHTML = `
        <div class="training-info">
            <div class="training-progress">
                <div class="progress-bar" style="width: ${status.progress || 0}%"></div>
            </div>
            <div class="training-details">
                <span class="training-stage">${status.stage || '準備中'}</span>
                <span class="training-time">${status.elapsed || '0s'}</span>
            </div>
        </div>
    `;
}

/**
 * 更新波動率日期選擇器
 */
export function updateVolatilityDateSelect(data, selectedDate) {
    const selectEl = document.getElementById('volatility-date-select');
    if (!selectEl || !data) return;

    selectEl.innerHTML = '';
    data.forEach(item => {
        const option = document.createElement('option');
        option.value = item.date;
        option.textContent = formatDateDDMM(item.date, true);
        if (item.date === selectedDate) {
            option.selected = true;
        }
        selectEl.appendChild(option);
    });
}

/**
 * 更新波動率統計
 */
export function updateVolatilityStats(data) {
    const statsEl = document.getElementById('volatility-stats');
    if (!statsEl || !data) return;

    const avgVolatility = data.reduce((sum, d) => sum + d.volatility, 0) / data.length;
    const maxVolatility = Math.max(...data.map(d => d.volatility));
    const minVolatility = Math.min(...data.map(d => d.volatility));

    statsEl.innerHTML = `
        <div class="stat-item">
            <span class="stat-label">平均波動率</span>
            <span class="stat-value">${avgVolatility.toFixed(2)}%</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">最高波動率</span>
            <span class="stat-value">${maxVolatility.toFixed(2)}%</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">最低波動率</span>
            <span class="stat-value">${minVolatility.toFixed(2)}%</span>
        </div>
    `;
}
