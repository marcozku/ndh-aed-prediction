/**
 * 預測平滑模組 - Daily Prediction Smoothing Methods
 * 
 * 將每日48次預測（每30分鐘）平滑為一個最終預測值
 * 用於準確度比較分析
 * 
 * @version 2.5.2
 * @date 2025-12-27 21:00 HKT
 */

class PredictionSmoother {
    constructor(options = {}) {
        // EWMA alpha 參數（0.6-0.7 給予較晚預測更多權重）
        this.ewmaAlpha = options.ewmaAlpha || 0.65;
        
        // Kalman Filter 參數
        this.kalmanProcessNoise = options.kalmanProcessNoise || 1.0;
        this.kalmanMeasurementNoise = options.kalmanMeasurementNoise || 10.0;
        
        // Trimmed Mean 參數（移除頂部和底部的百分比）
        this.trimPercent = options.trimPercent || 0.10; // 10%
        
        // Variance-Based Filtering 參數
        this.varianceThreshold = options.varianceThreshold || 1.5; // 1.5 SD
        
        // 歷史時段準確度數據（用於 Time-Window Weighted）
        this.historicalAccuracyByTimeSlot = options.historicalAccuracyByTimeSlot || null;
        
        // Ensemble Meta-Method 權重
        this.metaWeights = options.metaWeights || {
            ewma: 0.30,
            timeWindowWeighted: 0.25,
            trimmedMean: 0.20,
            kalman: 0.25
        };
    }

    /**
     * 執行所有平滑方法並返回結果
     * @param {Array} predictions - 48次預測數據 [{predicted_count, ci80_low, ci80_high, ci95_low, ci95_high, created_at, confidence?}]
     * @returns {Object} 所有平滑方法的結果
     */
    smoothAll(predictions) {
        if (!predictions || predictions.length === 0) {
            return null;
        }

        // 提取預測值數組
        const values = predictions.map(p => p.predicted_count);
        const confidences = predictions.map(p => p.confidence || 1.0);
        const timestamps = predictions.map(p => new Date(p.created_at));

        // 計算穩定性分析
        const stabilityAnalysis = this.calculateStabilityAnalysis(values);

        // 執行所有平滑方法
        const results = {
            // 1. Simple Moving Average (Baseline)
            simpleAverage: this.simpleMovingAverage(values),
            
            // 2. EWMA (Exponentially Weighted Moving Average)
            ewma: this.exponentiallyWeightedMovingAverage(values),
            
            // 3. Weighted by Prediction Confidence
            confidenceWeighted: this.confidenceWeightedAverage(values, confidences),
            
            // 4. Time-Window Weighted Ensemble
            timeWindowWeighted: this.timeWindowWeightedEnsemble(values, timestamps),
            
            // 5. Trimmed Mean
            trimmedMean: this.trimmedMean(values),
            
            // 6. Variance-Based Filtering
            varianceFiltered: this.varianceBasedFiltering(values),
            
            // 7. Kalman Filter Smoothing
            kalman: this.kalmanFilterSmoothing(values),
            
            // 8. Ensemble Meta-Method
            ensembleMeta: null, // 稍後計算（依賴其他方法的結果）
            
            // 9. Stability Analysis
            stability: stabilityAnalysis,
            
            // 原始數據統計
            rawStats: {
                count: values.length,
                min: Math.min(...values),
                max: Math.max(...values),
                mean: this.mean(values),
                median: this.median(values),
                stdDev: this.standardDeviation(values)
            }
        };

        // 計算 Ensemble Meta-Method（使用其他方法的結果）
        results.ensembleMeta = this.ensembleMetaMethod({
            ewma: results.ewma.value,
            timeWindowWeighted: results.timeWindowWeighted.value,
            trimmedMean: results.trimmedMean.value,
            kalman: results.kalman.value
        });

        // 計算平滑後的 CI
        results.smoothedCI = this.calculateSmoothedCI(predictions, results);

        return results;
    }

    /**
     * 獲取推薦的最終預測值
     * @param {Object} smoothedResults - smoothAll() 的結果
     * @returns {Object} 推薦的預測值和方法
     */
    getRecommendedPrediction(smoothedResults) {
        if (!smoothedResults) return null;

        const stability = smoothedResults.stability;
        
        // 根據穩定性選擇方法
        if (stability.cv < 0.05) {
            // 高穩定性：使用簡單平均
            return {
                value: smoothedResults.simpleAverage.value,
                method: 'simpleAverage',
                confidence: 'high',
                reason: '預測穩定（CV < 5%），使用簡單平均'
            };
        } else if (stability.cv > 0.15) {
            // 低穩定性：使用穩健方法
            return {
                value: smoothedResults.varianceFiltered.value,
                method: 'varianceFiltered',
                confidence: 'low',
                reason: '預測波動大（CV > 15%），使用方差過濾法移除異常值'
            };
        } else {
            // 中等穩定性：使用 Ensemble Meta-Method
            return {
                value: smoothedResults.ensembleMeta.value,
                method: 'ensembleMeta',
                confidence: 'medium',
                reason: '預測中等穩定，使用集成元方法綜合多種平滑結果'
            };
        }
    }

    // ============================================================
    // 方法 1: Simple Moving Average (Baseline)
    // ============================================================
    simpleMovingAverage(values) {
        const avg = this.mean(values);
        return {
            value: Math.round(avg),
            rawValue: avg,
            method: 'Simple Moving Average',
            description: '所有48次預測的簡單算術平均值'
        };
    }

    // ============================================================
    // 方法 2: EWMA (Exponentially Weighted Moving Average)
    // ============================================================
    exponentiallyWeightedMovingAverage(values) {
        if (values.length === 0) return { value: 0, rawValue: 0 };
        
        let smoothed = values[0];
        const alpha = this.ewmaAlpha;
        
        for (let i = 1; i < values.length; i++) {
            smoothed = alpha * values[i] + (1 - alpha) * smoothed;
        }
        
        return {
            value: Math.round(smoothed),
            rawValue: smoothed,
            method: 'EWMA',
            alpha: alpha,
            description: `指數加權移動平均（α=${alpha}），較晚的預測權重更高`
        };
    }

    // ============================================================
    // 方法 3: Weighted Average by Prediction Confidence
    // ============================================================
    confidenceWeightedAverage(values, confidences) {
        if (values.length === 0) return { value: 0, rawValue: 0 };
        
        // 將信心度轉換為權重（反向：不確定性越低，權重越高）
        // 假設 confidence 是 0-1 的值，越高表示越有信心
        const weights = confidences.map(c => {
            const conf = Math.max(0.1, Math.min(1.0, c || 1.0));
            return conf;
        });
        
        let weightedSum = 0;
        let weightSum = 0;
        
        for (let i = 0; i < values.length; i++) {
            weightedSum += values[i] * weights[i];
            weightSum += weights[i];
        }
        
        const result = weightSum > 0 ? weightedSum / weightSum : this.mean(values);
        
        return {
            value: Math.round(result),
            rawValue: result,
            method: 'Confidence Weighted',
            description: '根據預測信心度加權平均，信心度越高權重越大'
        };
    }

    // ============================================================
    // 方法 4: Time-Window Weighted Ensemble
    // ============================================================
    timeWindowWeightedEnsemble(values, timestamps) {
        if (values.length === 0) return { value: 0, rawValue: 0 };
        
        // 如果有歷史準確度數據，使用它來計算權重
        if (this.historicalAccuracyByTimeSlot) {
            return this._timeWindowWithHistoricalAccuracy(values, timestamps);
        }
        
        // 否則，使用時間順序權重（較晚的預測權重較高）
        const n = values.length;
        const weights = values.map((_, i) => {
            // 線性增加權重：第一個預測權重為1，最後一個為2
            return 1 + (i / (n - 1));
        });
        
        let weightedSum = 0;
        let weightSum = 0;
        
        for (let i = 0; i < values.length; i++) {
            weightedSum += values[i] * weights[i];
            weightSum += weights[i];
        }
        
        const result = weightSum > 0 ? weightedSum / weightSum : this.mean(values);
        
        return {
            value: Math.round(result),
            rawValue: result,
            method: 'Time-Window Weighted',
            description: '根據預測時間加權，較晚的預測（包含更新資訊）權重較高'
        };
    }

    _timeWindowWithHistoricalAccuracy(values, timestamps) {
        const weights = timestamps.map(ts => {
            const hour = ts.getHours();
            const minute = ts.getMinutes();
            const timeSlot = `${hour.toString().padStart(2, '0')}:${minute < 30 ? '00' : '30'}`;
            
            // 從歷史數據獲取該時段的 MAE
            const mae = this.historicalAccuracyByTimeSlot[timeSlot]?.mae || 10;
            
            // 權重 = 1 / MAE（MAE 越低，權重越高）
            return 1 / Math.max(1, mae);
        });
        
        let weightedSum = 0;
        let weightSum = 0;
        
        for (let i = 0; i < values.length; i++) {
            weightedSum += values[i] * weights[i];
            weightSum += weights[i];
        }
        
        const result = weightSum > 0 ? weightedSum / weightSum : this.mean(values);
        
        return {
            value: Math.round(result),
            rawValue: result,
            method: 'Time-Window Weighted (Historical)',
            description: '根據歷史準確度加權，過去表現較好的時段權重較高'
        };
    }

    // ============================================================
    // 方法 5: Trimmed Mean (Outlier Removal)
    // ============================================================
    trimmedMean(values) {
        if (values.length === 0) return { value: 0, rawValue: 0 };
        
        const sorted = [...values].sort((a, b) => a - b);
        const n = sorted.length;
        
        // 計算要移除的數量（頂部和底部各10%）
        const trimCount = Math.floor(n * this.trimPercent);
        
        // 如果數據太少，至少保留一半
        const actualTrimCount = Math.min(trimCount, Math.floor(n / 4));
        
        // 移除異常值
        const trimmed = sorted.slice(actualTrimCount, n - actualTrimCount);
        
        const result = this.mean(trimmed);
        
        return {
            value: Math.round(result),
            rawValue: result,
            method: 'Trimmed Mean',
            originalCount: n,
            trimmedCount: trimmed.length,
            trimPercent: this.trimPercent,
            description: `移除頂部和底部${Math.round(this.trimPercent * 100)}%的預測後取平均`
        };
    }

    // ============================================================
    // 方法 6: Variance-Based Filtering
    // ============================================================
    varianceBasedFiltering(values) {
        if (values.length === 0) return { value: 0, rawValue: 0 };
        
        const med = this.median(values);
        const stdDev = this.standardDeviation(values);
        const threshold = this.varianceThreshold;
        
        // 過濾掉超過閾值的預測
        const filtered = values.filter(v => 
            Math.abs(v - med) <= threshold * stdDev
        );
        
        // 如果過濾後太少數據，使用中位數
        if (filtered.length < values.length * 0.5) {
            return {
                value: Math.round(med),
                rawValue: med,
                method: 'Variance-Based Filtering (Fallback)',
                description: '過濾後數據不足，使用中位數'
            };
        }
        
        // 對過濾後的數據使用 EWMA
        const ewmaResult = this.exponentiallyWeightedMovingAverage(filtered);
        
        return {
            value: ewmaResult.value,
            rawValue: ewmaResult.rawValue,
            method: 'Variance-Based Filtering',
            originalCount: values.length,
            filteredCount: filtered.length,
            threshold: threshold,
            description: `排除超過${threshold}σ的異常預測後，使用EWMA平滑`
        };
    }

    // ============================================================
    // 方法 7: Kalman Filter Smoothing
    // ============================================================
    kalmanFilterSmoothing(values) {
        if (values.length === 0) return { value: 0, rawValue: 0 };
        
        // Kalman Filter 狀態
        let x = values[0]; // 狀態估計（預測的真實就診人數）
        let p = 1.0; // 估計誤差協方差
        
        const q = this.kalmanProcessNoise; // 過程噪音（系統變化）
        const r = this.kalmanMeasurementNoise; // 測量噪音（預測不確定性）
        
        const states = [x];
        
        for (let i = 1; i < values.length; i++) {
            // 預測步驟
            const xPred = x; // 假設狀態不變
            const pPred = p + q;
            
            // 更新步驟
            const k = pPred / (pPred + r); // Kalman 增益
            x = xPred + k * (values[i] - xPred);
            p = (1 - k) * pPred;
            
            states.push(x);
        }
        
        // 最終狀態即為平滑後的預測
        const result = x;
        
        return {
            value: Math.round(result),
            rawValue: result,
            method: 'Kalman Filter',
            finalGain: p / (p + r),
            description: '使用 Kalman 濾波器平滑所有預測，將其視為對真實值的帶噪測量'
        };
    }

    // ============================================================
    // 方法 8: Ensemble Meta-Method
    // ============================================================
    ensembleMetaMethod(methodResults) {
        const weights = this.metaWeights;
        
        let weightedSum = 0;
        let weightSum = 0;
        
        for (const [method, value] of Object.entries(methodResults)) {
            if (weights[method] && value != null && !isNaN(value)) {
                weightedSum += value * weights[method];
                weightSum += weights[method];
            }
        }
        
        const result = weightSum > 0 ? weightedSum / weightSum : 0;
        
        return {
            value: Math.round(result),
            rawValue: result,
            method: 'Ensemble Meta-Method',
            weights: weights,
            components: methodResults,
            description: '綜合多種平滑方法的加權結果'
        };
    }

    // ============================================================
    // 方法 9: Prediction Stability Analysis
    // ============================================================
    calculateStabilityAnalysis(values) {
        if (values.length === 0) {
            return {
                cv: 0,
                confidenceLevel: 'unknown',
                flagForReview: false
            };
        }
        
        const mean = this.mean(values);
        const stdDev = this.standardDeviation(values);
        
        // 變異係數 = StdDev / Mean
        const cv = mean > 0 ? stdDev / mean : 0;
        
        // 確定信心水平
        let confidenceLevel;
        let flagForReview = false;
        
        if (cv < 0.05) {
            confidenceLevel = 'high';
        } else if (cv < 0.10) {
            confidenceLevel = 'medium-high';
        } else if (cv < 0.15) {
            confidenceLevel = 'medium';
        } else {
            confidenceLevel = 'low';
            flagForReview = true;
        }
        
        return {
            cv: cv,
            cvPercent: cv * 100,
            confidenceLevel: confidenceLevel,
            flagForReview: flagForReview,
            mean: mean,
            stdDev: stdDev,
            description: `CV=${(cv * 100).toFixed(2)}%，預測${confidenceLevel === 'low' ? '波動大，需要審查' : '穩定'}`
        };
    }

    // ============================================================
    // 輔助方法：計算平滑後的 CI
    // ============================================================
    calculateSmoothedCI(predictions, smoothedResults) {
        // 使用 Ensemble Meta-Method 的結果作為中心點
        const center = smoothedResults.ensembleMeta.rawValue;
        
        // 計算原始 CI 的平均寬度
        const ci80Widths = predictions.map(p => 
            (p.ci80_high || 0) - (p.ci80_low || 0)
        ).filter(w => w > 0);
        
        const ci95Widths = predictions.map(p => 
            (p.ci95_high || 0) - (p.ci95_low || 0)
        ).filter(w => w > 0);
        
        const avgCi80Width = ci80Widths.length > 0 ? this.mean(ci80Widths) : 64;
        const avgCi95Width = ci95Widths.length > 0 ? this.mean(ci95Widths) : 98;
        
        // 根據穩定性調整 CI 寬度
        const stabilityFactor = 1 + smoothedResults.stability.cv;
        
        return {
            ci80: {
                low: Math.round(center - (avgCi80Width / 2) * stabilityFactor),
                high: Math.round(center + (avgCi80Width / 2) * stabilityFactor)
            },
            ci95: {
                low: Math.round(center - (avgCi95Width / 2) * stabilityFactor),
                high: Math.round(center + (avgCi95Width / 2) * stabilityFactor)
            }
        };
    }

    // ============================================================
    // 統計輔助函數
    // ============================================================
    mean(values) {
        if (values.length === 0) return 0;
        return values.reduce((a, b) => a + b, 0) / values.length;
    }

    median(values) {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    standardDeviation(values) {
        if (values.length <= 1) return 0;
        const avg = this.mean(values);
        const squareDiffs = values.map(v => Math.pow(v - avg, 2));
        const avgSquareDiff = this.mean(squareDiffs);
        return Math.sqrt(avgSquareDiff);
    }

    // ============================================================
    // 更新歷史準確度數據
    // ============================================================
    updateHistoricalAccuracy(timeSlot, mae) {
        if (!this.historicalAccuracyByTimeSlot) {
            this.historicalAccuracyByTimeSlot = {};
        }
        
        if (!this.historicalAccuracyByTimeSlot[timeSlot]) {
            this.historicalAccuracyByTimeSlot[timeSlot] = {
                mae: mae,
                count: 1,
                history: [mae]
            };
        } else {
            const slot = this.historicalAccuracyByTimeSlot[timeSlot];
            slot.history.push(mae);
            
            // 只保留最近30天的數據
            if (slot.history.length > 30) {
                slot.history.shift();
            }
            
            // 計算30天滾動 MAE
            slot.mae = this.mean(slot.history);
            slot.count = slot.history.length;
        }
    }

    // ============================================================
    // 導出配置
    // ============================================================
    getConfig() {
        return {
            ewmaAlpha: this.ewmaAlpha,
            kalmanProcessNoise: this.kalmanProcessNoise,
            kalmanMeasurementNoise: this.kalmanMeasurementNoise,
            trimPercent: this.trimPercent,
            varianceThreshold: this.varianceThreshold,
            metaWeights: this.metaWeights
        };
    }

    // ============================================================
    // 更新配置
    // ============================================================
    updateConfig(options) {
        if (options.ewmaAlpha !== undefined) {
            this.ewmaAlpha = Math.max(0.1, Math.min(0.9, options.ewmaAlpha));
        }
        if (options.kalmanProcessNoise !== undefined) {
            this.kalmanProcessNoise = Math.max(0.1, options.kalmanProcessNoise);
        }
        if (options.kalmanMeasurementNoise !== undefined) {
            this.kalmanMeasurementNoise = Math.max(1, options.kalmanMeasurementNoise);
        }
        if (options.trimPercent !== undefined) {
            this.trimPercent = Math.max(0.01, Math.min(0.25, options.trimPercent));
        }
        if (options.varianceThreshold !== undefined) {
            this.varianceThreshold = Math.max(1, Math.min(3, options.varianceThreshold));
        }
        if (options.metaWeights !== undefined) {
            this.metaWeights = { ...this.metaWeights, ...options.metaWeights };
            // 正規化權重使總和為1
            const sum = Object.values(this.metaWeights).reduce((a, b) => a + b, 0);
            if (sum > 0) {
                for (const key in this.metaWeights) {
                    this.metaWeights[key] /= sum;
                }
            }
        }
    }
}

// 創建單例實例
let smootherInstance = null;

function getPredictionSmoother(options = {}) {
    if (!smootherInstance) {
        smootherInstance = new PredictionSmoother(options);
    }
    return smootherInstance;
}

module.exports = {
    PredictionSmoother,
    getPredictionSmoother
};
