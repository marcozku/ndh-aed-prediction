/**
 * 數據庫 API 模組
 * 處理與數據庫相關的 API 請求
 */

/**
 * 獲取數據庫狀態
 */
export async function checkDatabaseStatus() {
    try {
        const response = await fetch('/api/db-status');
        const result = await response.json();

        return {
            connected: result.connected || false,
            host: result.host || 'N/A',
            database: result.database || 'N/A',
            tables: result.tables || 0,
            totalRecords: result.totalRecords || 0
        };
    } catch (error) {
        console.error('數據庫狀態檢查失敗:', error);
        return {
            connected: false,
            host: 'N/A',
            database: 'N/A',
            tables: 0,
            totalRecords: 0
        };
    }
}

/**
 * 獲取歷史數據
 */
export async function fetchHistoricalData(startDate = null, endDate = null) {
    try {
        const params = new URLSearchParams();
        if (startDate) params.append('start', startDate);
        if (endDate) params.append('end', endDate);

        const url = `/api/actual-data${params.toString() ? '?' + params.toString() : ''}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        return result.data || [];
    } catch (error) {
        console.error('獲取歷史數據失敗:', error);
        return [];
    }
}

/**
 * 獲取對比數據
 */
export async function fetchComparisonData(limit = 100, refresh = false) {
    try {
        const params = new URLSearchParams();
        params.append('limit', limit);
        if (refresh) params.append('refresh', 'true');

        const url = `/api/comparison?${params.toString()}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        return result.data || [];
    } catch (error) {
        console.error('獲取對比數據失敗:', error);
        return [];
    }
}

/**
 * 添加實際數據
 */
export async function addActualData(date, attendance) {
    try {
        const response = await fetch('/api/actual-data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                date: date,
                attendance: attendance
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        return {
            success: result.success || false,
            message: result.message || '添加成功'
        };
    } catch (error) {
        console.error('添加實際數據失敗:', error);
        return {
            success: false,
            message: error.message
        };
    }
}

/**
 * 批量上傳數據
 */
export async function uploadBatchData(data) {
    try {
        const response = await fetch('/api/actual-data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ data: data })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        return {
            success: result.success || false,
            inserted: result.inserted || 0,
            updated: result.updated || 0,
            message: result.message || '上傳成功'
        };
    } catch (error) {
        console.error('批量上傳數據失敗:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * 獲取準確度數據
 */
export async function fetchAccuracyData() {
    try {
        const response = await fetch('/api/accuracy');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        return result.data || null;
    } catch (error) {
        console.error('獲取準確度數據失敗:', error);
        return null;
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
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        return result.data || [];
    } catch (error) {
        console.error('獲取準確度歷史失敗:', error);
        return [];
    }
}

/**
 * 獲取模型性能指標
 */
export async function fetchModelMetrics() {
    try {
        const response = await fetch('/api/model-metrics');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        return result.data || null;
    } catch (error) {
        console.error('獲取模型性能指標失敗:', error);
        return null;
    }
}

/**
 * 獲取訓練狀態
 */
export async function fetchTrainingStatus() {
    try {
        const response = await fetch('/api/training-status');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        return result.data || null;
    } catch (error) {
        console.error('獲取訓練狀態失敗:', error);
        return null;
    }
}

/**
 * 觸發模型訓練
 */
export async function triggerTraining() {
    try {
        const response = await fetch('/api/trigger-training', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        return {
            success: result.success || false,
            message: result.message || '訓練已觸發'
        };
    } catch (error) {
        console.error('觸發訓練失敗:', error);
        return {
            success: false,
            message: error.message
        };
    }
}
