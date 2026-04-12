/**
 * XGBoost API helpers for the browser.
 */

let xgboostAvailable = null;

export async function checkXGBoostAvailability() {
    if (xgboostAvailable !== null) return xgboostAvailable;

    try {
        const response = await fetch('/api/ensemble-status');
        const result = await response.json();
        xgboostAvailable = Boolean(
            result?.data?.runtime?.ready ??
            result?.data?.available ??
            result?.data?.models?.xgboost
        );
        console.log(`XGBoost availability: ${xgboostAvailable ? 'ready' : 'not ready'}`);
        return xgboostAvailable;
    } catch (error) {
        console.error('Failed to check XGBoost availability:', error);
        xgboostAvailable = false;
        return false;
    }
}

export async function getXGBoostPrediction(targetDate) {
    try {
        const response = await fetch('/api/ensemble-predict', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_date: targetDate })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        if (!result.success || !result.data) {
            throw new Error(result.error || 'XGBoost prediction failed');
        }

        return {
            predicted: result.data.prediction,
            ci80: result.data.ci80,
            ci95: result.data.ci95,
            metadata: result.data.metadata || {}
        };
    } catch (error) {
        console.error('XGBoost prediction error:', error);
        throw error;
    }
}

export async function getXGBoostPredictionWithMetadata(dateStr, predictorInstance, weatherData = null, aiFactor = null) {
    try {
        const prediction = await getXGBoostPrediction(dateStr);

        return {
            date: dateStr,
            predicted: prediction.predicted,
            ci80: prediction.ci80,
            ci95: prediction.ci95,
            source: 'xgboost',
            weatherData,
            aiFactor,
            metadata: prediction.metadata
        };
    } catch (error) {
        console.error(`XGBoost prediction failed (${dateStr}):`, error);
        return null;
    }
}

export function resetXGBoostAvailability() {
    xgboostAvailable = null;
}
