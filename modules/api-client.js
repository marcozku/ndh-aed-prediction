/**
 * API 客戶端模組
 * 統一處理所有 API 請求
 */

/**
 * 通用 API 請求函數
 */
async function apiRequest(url, options = {}) {
    try {
        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error(`API 請求失敗 (${url}):`, error);
        throw error;
    }
}

/**
 * 獲取歷史數據
 */
export async function fetchHistoricalData(startDate = null, endDate = null) {
    const params = new URLSearchParams();
    if (startDate) params.append('start', startDate);
    if (endDate) params.append('end', endDate);

    const url = `/api/actual-data${params.toString() ? '?' + params.toString() : ''}`;
    return await apiRequest(url);
}

/**
 * 獲取對比數據
 */
export async function fetchComparisonData(limit = 100, refresh = false) {
    const params = new URLSearchParams();
    params.append('limit', limit);
    if (refresh) params.append('refresh', 'true');

    const url = `/api/comparison?${params.toString()}`;
    return await apiRequest(url);
}

/**
 * 獲取未來預測
 */
export async function fetchFuturePredictions(days = 7) {
    const params = new URLSearchParams();
    params.append('days', days);

    const url = `/api/future-predictions?${params.toString()}`;
    return await apiRequest(url);
}

/**
 * 觸發預測
 */
export async function triggerPrediction(source = 'manual') {
    return await apiRequest('/api/trigger-prediction', {
        method: 'POST',
        body: JSON.stringify({ source })
    });
}

/**
 * 檢查數據庫狀態
 */
export async function checkDatabaseStatus() {
    try {
        const result = await apiRequest('/api/db-status');
        return {
            connected: result.connected || false,
            tables: result.tables || 0,
            totalRecords: result.totalRecords || 0
        };
    } catch (error) {
        console.error('數據庫狀態檢查失敗:', error);
        return {
            connected: false,
            tables: 0,
            totalRecords: 0
        };
    }
}

/**
 * 檢查 AI 狀態
 */
export async function checkAIStatus() {
    try {
        const result = await apiRequest('/api/ai-status');
        return {
            available: result.available || false,
            model: result.model || 'N/A',
            lastUpdate: result.lastUpdate || null
        };
    } catch (error) {
        console.error('AI 狀態檢查失敗:', error);
        return {
            available: false,
            model: 'N/A',
            lastUpdate: null
        };
    }
}

/**
 * 檢查自動預測狀態
 */
export async function checkAutoPredictStatus() {
    try {
        const result = await apiRequest('/api/auto-predict-stats');
        return {
            enabled: result.enabled || false,
            nextRun: result.nextRun || null,
            lastRun: result.lastRun || null,
            totalRuns: result.totalRuns || 0
        };
    } catch (error) {
        console.error('自動預測狀態檢查失敗:', error);
        return {
            enabled: false,
            nextRun: null,
            lastRun: null,
            totalRuns: 0
        };
    }
}

/**
 * 獲取訓練狀態
 */
export async function fetchTrainingStatus() {
    try {
        const result = await apiRequest('/api/training-status');
        return result;
    } catch (error) {
        console.error('訓練狀態獲取失敗:', error);
        return null;
    }
}

/**
 * 獲取平滑預測
 */
export async function fetchSmoothedPrediction(targetDate) {
    try {
        const result = await apiRequest(`/api/smoothed-prediction?date=${targetDate}`);
        return result;
    } catch (error) {
        console.error('平滑預測獲取失敗:', error);
        return null;
    }
}

/**
 * 保存每日預測
 */
export async function saveDailyPrediction(prediction, weatherData, aiFactor) {
    try {
        const result = await apiRequest('/api/daily-predictions', {
            method: 'POST',
            body: JSON.stringify({
                target_date: prediction.date,
                predicted_count: prediction.predicted,
                ci80_lower: prediction.ci80.lower,
                ci80_upper: prediction.ci80.upper,
                ci95_lower: prediction.ci95.lower,
                ci95_upper: prediction.ci95.upper,
                weather_data: weatherData,
                ai_factor: aiFactor,
                metadata: prediction.metadata || {}
            })
        });
        return result;
    } catch (error) {
        console.error('保存每日預測失敗:', error);
        throw error;
    }
}

/**
 * 獲取 AI 因素
 */
export async function fetchAIFactors(force = false) {
    try {
        const params = new URLSearchParams();
        if (force) params.append('force', 'true');

        const url = `/api/ai-factors${params.toString() ? '?' + params.toString() : ''}`;
        const result = await apiRequest(url);
        return result;
    } catch (error) {
        console.error('AI 因素獲取失敗:', error);
        return null;
    }
}

/**
 * 強制刷新 AI 因素
 */
export async function forceRefreshAI() {
    try {
        const result = await apiRequest('/api/ai-factors?force=true');
        return result;
    } catch (error) {
        console.error('強制刷新 AI 失敗:', error);
        throw error;
    }
}

/**
 * 獲取準確度歷史
 */
export async function fetchAccuracyHistory(days = 30) {
    try {
        const params = new URLSearchParams();
        params.append('days', days);

        const url = `/api/accuracy-history?${params.toString()}`;
        const result = await apiRequest(url);
        return result;
    } catch (error) {
        console.error('準確度歷史獲取失敗:', error);
        return null;
    }
}

/**
 * 獲取波動率數據
 */
export async function fetchVolatilityData(targetDate = null) {
    try {
        const params = new URLSearchParams();
        if (targetDate) params.append('date', targetDate);

        const url = `/api/volatility${params.toString() ? '?' + params.toString() : ''}`;
        const result = await apiRequest(url);
        return result;
    } catch (error) {
        console.error('波動率數據獲取失敗:', error);
        return null;
    }
}

/**
 * 獲取雙軌預測數據
 */
export async function fetchDualTrackData() {
    try {
        const result = await apiRequest('/api/dual-track/summary');
        return result;
    } catch (error) {
        console.error('雙軌預測數據獲取失敗:', error);
        return null;
    }
}

/**
 * 獲取實時可靠性
 */
export async function fetchRealtimeReliability() {
    try {
        const result = await apiRequest('/api/realtime-reliability');
        return result;
    } catch (error) {
        console.error('實時可靠性獲取失敗:', error);
        return null;
    }
}
