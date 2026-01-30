/**
 * XGBoost 預測 API 模組
 * 處理與 XGBoost 模型的所有交互
 */

let xgboostAvailable = null; // null = 未檢查, true = 可用, false = 不可用

/**
 * 檢查 XGBoost 是否可用
 */
export async function checkXGBoostAvailability() {
    if (xgboostAvailable !== null) return xgboostAvailable;

    try {
        const response = await fetch('/api/ensemble-status');
        const result = await response.json();
        xgboostAvailable = result.xgboost?.available || false;
        console.log(`🤖 XGBoost 可用性: ${xgboostAvailable ? '✅ 可用' : '❌ 不可用'}`);
        return xgboostAvailable;
    } catch (error) {
        console.error('檢查 XGBoost 可用性失敗:', error);
        xgboostAvailable = false;
        return false;
    }
}

/**
 * 獲取 XGBoost 預測
 */
export async function getXGBoostPrediction(targetDate) {
    try {
        const response = await fetch('/api/ensemble-predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetDate })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'XGBoost 預測失敗');
        }

        return {
            predicted: result.prediction,
            ci80: result.ci80,
            ci95: result.ci95,
            metadata: result.metadata || {}
        };
    } catch (error) {
        console.error('XGBoost 預測錯誤:', error);
        throw error;
    }
}

/**
 * 獲取帶完整元數據的 XGBoost 預測
 */
export async function getXGBoostPredictionWithMetadata(dateStr, predictorInstance, weatherData = null, aiFactor = null) {
    try {
        const prediction = await getXGBoostPrediction(dateStr);

        return {
            date: dateStr,
            predicted: prediction.predicted,
            ci80: prediction.ci80,
            ci95: prediction.ci95,
            source: 'xgboost',
            weatherData: weatherData,
            aiFactor: aiFactor,
            metadata: prediction.metadata
        };
    } catch (error) {
        console.error(`XGBoost 預測失敗 (${dateStr}):`, error);
        return null;
    }
}

/**
 * 重置 XGBoost 可用性狀態（用於重新檢查）
 */
export function resetXGBoostAvailability() {
    xgboostAvailable = null;
}
