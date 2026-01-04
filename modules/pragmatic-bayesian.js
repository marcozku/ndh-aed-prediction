/**
 * Pragmatic Bayesian Predictor
 * 
 * 結合 XGBoost、AI 因素、天氣因素的貝葉斯融合預測器
 * 使用 precision-weighted Gaussian fusion（封閉解，快速）
 * 
 * @version 1.0.0
 * @date 2026-01-04 HKT
 */

class PragmaticBayesianPredictor {
    constructor(options = {}) {
        // 各來源的初始可靠度 (0-1) - v3.0.81: 統計優化後的權重
        this.reliability = {
            xgboost: options.xgboostReliability || 0.95,   // 統計驗證：MAPE=2.42%, EWMA7=86.89%
            weather: options.weatherReliability || 0.05,   // 統計驗證：|r|<0.12 (weak correlations)
            ai: options.aiReliability || 0.00              // 無歷史驗證數據，暫時排除
        };
        
        // 基礎標準差（根據歷史 MAE 估計）
        this.baseStd = options.baseStd || 15;
        
        // 可靠度學習率
        this.learningRate = options.learningRate || 0.1;
        
        // 歷史記錄（用於學習）
        this.history = [];
        this.maxHistorySize = options.maxHistorySize || 90; // 保留 90 天
        
        // 預測記錄（用於回測）
        this.lastPrediction = null;
        
        // v3.0.81: 統計驗證說明
        this.optimizationNote = 'Weights optimized from 688 test days. See bayesian_weights_optimized.json';
    }
    
    /**
     * 執行 Pragmatic Bayesian 預測
     * 
     * @param {number} xgboostBase - XGBoost 基礎預測
     * @param {number} aiFactor - AI 影響因子 (0.7-1.3)
     * @param {number} weatherFactor - 天氣影響因子 (0.85-1.15)
     * @returns {Object} 預測結果
     */
    predict(xgboostBase, aiFactor = 1.0, weatherFactor = 1.0) {
        if (!xgboostBase || isNaN(xgboostBase)) {
            throw new Error('Invalid xgboostBase');
        }
        
        // 正規化因子到合理範圍
        aiFactor = Math.max(0.7, Math.min(1.3, aiFactor || 1.0));
        weatherFactor = Math.max(0.85, Math.min(1.15, weatherFactor || 1.0));
        
        // === 1. 定義各來源的 "觀測" ===
        const observations = [
            {
                source: 'xgboost',
                mean: xgboostBase,
                // 方差 = (baseStd / reliability)^2
                variance: Math.pow(this.baseStd / this.reliability.xgboost, 2)
            },
            {
                source: 'ai',
                mean: xgboostBase * aiFactor,
                // AI 因子越極端，不確定性越大
                variance: Math.pow(this.baseStd / this.reliability.ai, 2) * 
                          (1 + Math.abs(aiFactor - 1) * 3)
            },
            {
                source: 'weather',
                mean: xgboostBase * weatherFactor,
                // 天氣因子較穩定，但極端值也增加不確定性
                variance: Math.pow(this.baseStd / this.reliability.weather, 2) *
                          (1 + Math.abs(weatherFactor - 1) * 2)
            }
        ];
        
        // === 2. Bayesian 融合（高斯假設下的封閉解）===
        let precisionSum = 0;
        let weightedMeanSum = 0;
        const weights = {};
        
        for (const obs of observations) {
            const precision = 1 / obs.variance;
            precisionSum += precision;
            weightedMeanSum += precision * obs.mean;
            weights[obs.source] = precision; // 暫存，稍後正規化
        }
        
        // 正規化權重
        for (const source in weights) {
            weights[source] = weights[source] / precisionSum;
        }
        
        const posteriorMean = weightedMeanSum / precisionSum;
        const posteriorVariance = 1 / precisionSum;
        const posteriorStd = Math.sqrt(posteriorVariance);
        
        // === 3. 計算置信區間 ===
        const ci80 = {
            low: Math.round(posteriorMean - 1.28 * posteriorStd),
            high: Math.round(posteriorMean + 1.28 * posteriorStd)
        };
        const ci95 = {
            low: Math.round(posteriorMean - 1.96 * posteriorStd),
            high: Math.round(posteriorMean + 1.96 * posteriorStd)
        };
        
        // === 4. 計算各來源貢獻 ===
        const contributions = {
            xgboost: {
                value: xgboostBase,
                weight: weights.xgboost,
                contribution: weights.xgboost * xgboostBase
            },
            ai: {
                value: xgboostBase * aiFactor,
                factor: aiFactor,
                weight: weights.ai,
                contribution: weights.ai * xgboostBase * aiFactor,
                adjustment: weights.ai * xgboostBase * (aiFactor - 1)
            },
            weather: {
                value: xgboostBase * weatherFactor,
                factor: weatherFactor,
                weight: weights.weather,
                contribution: weights.weather * xgboostBase * weatherFactor,
                adjustment: weights.weather * xgboostBase * (weatherFactor - 1)
            }
        };
        
        // 保存預測記錄
        this.lastPrediction = {
            timestamp: new Date(),
            prediction: Math.round(posteriorMean),
            xgboostBase,
            aiFactor,
            weatherFactor,
            weights,
            contributions
        };
        
        return {
            prediction: Math.round(posteriorMean),
            rawPrediction: posteriorMean,
            std: posteriorStd,
            ci80,
            ci95,
            weights,
            contributions,
            reliability: { ...this.reliability },
            method: 'pragmatic_bayesian'
        };
    }
    
    /**
     * 使用殘差加法模式（備選方法）
     * Final = base + α × AI_residual + β × Weather_residual
     */
    predictAdditive(xgboostBase, aiFactor = 1.0, weatherFactor = 1.0) {
        aiFactor = Math.max(0.7, Math.min(1.3, aiFactor || 1.0));
        weatherFactor = Math.max(0.85, Math.min(1.15, weatherFactor || 1.0));
        
        // 殘差計算
        const aiResidual = (aiFactor - 1.0) * xgboostBase;
        const weatherResidual = (weatherFactor - 1.0) * xgboostBase;
        
        // 自適應權重（從可靠度推導）
        const alpha = this.reliability.ai / this.reliability.xgboost;
        const beta = this.reliability.weather / this.reliability.xgboost;
        
        // 加權組合
        const final = xgboostBase + alpha * aiResidual + beta * weatherResidual;
        
        // 置信區間根據調整幅度擴展
        const adjustmentMagnitude = Math.abs(alpha * aiResidual) + Math.abs(beta * weatherResidual);
        const ciExpansion = 1.0 + (adjustmentMagnitude / xgboostBase) * 0.5;
        
        const std = this.baseStd * ciExpansion;
        
        return {
            prediction: Math.round(final),
            rawPrediction: final,
            std,
            ci80: {
                low: Math.round(final - 1.28 * std),
                high: Math.round(final + 1.28 * std)
            },
            ci95: {
                low: Math.round(final - 1.96 * std),
                high: Math.round(final + 1.96 * std)
            },
            weights: { alpha, beta },
            contributions: {
                base: xgboostBase,
                aiContribution: alpha * aiResidual,
                weatherContribution: beta * weatherResidual
            },
            method: 'additive_residual'
        };
    }
    
    /**
     * 每日結束後更新可靠度
     * 
     * @param {number} actual - 實際人數
     * @param {Object} predictions - 各來源的預測值
     */
    updateReliability(actual, predictions) {
        if (!actual || !predictions) return;
        
        const alpha = this.learningRate;
        
        for (const source of ['xgboost', 'ai', 'weather']) {
            if (predictions[source] === undefined) continue;
            
            const error = Math.abs(predictions[source] - actual);
            const expectedError = this.baseStd / this.reliability[source];
            
            // 如果誤差比預期小，增加可靠度
            if (error < expectedError) {
                this.reliability[source] = Math.min(0.95, 
                    this.reliability[source] + alpha * (1 - this.reliability[source]));
            } else {
                this.reliability[source] = Math.max(0.3,
                    this.reliability[source] - alpha * this.reliability[source] * 0.5);
            }
        }
        
        // 記錄歷史
        this.history.push({
            date: new Date().toISOString().split('T')[0],
            actual,
            predictions,
            reliability: { ...this.reliability }
        });
        
        // 限制歷史大小
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        }
        
        console.log(`📊 Bayesian 可靠度更新: XGBoost=${this.reliability.xgboost.toFixed(2)}, AI=${this.reliability.ai.toFixed(2)}, Weather=${this.reliability.weather.toFixed(2)}`);
        
        return this.reliability;
    }
    
    /**
     * 從歷史數據重新學習可靠度
     * 
     * @param {Array} historicalData - [{actual, xgboostPred, aiPred, weatherPred}, ...]
     */
    learnFromHistory(historicalData) {
        if (!historicalData || historicalData.length === 0) return;
        
        // 計算每個來源的歷史 MAE
        const errors = { xgboost: [], ai: [], weather: [] };
        
        for (const day of historicalData) {
            if (day.actual && day.xgboostPred) {
                errors.xgboost.push(Math.abs(day.xgboostPred - day.actual));
            }
            if (day.actual && day.aiPred) {
                errors.ai.push(Math.abs(day.aiPred - day.actual));
            }
            if (day.actual && day.weatherPred) {
                errors.weather.push(Math.abs(day.weatherPred - day.actual));
            }
        }
        
        // 計算 MAE 並轉換為可靠度
        for (const source in errors) {
            if (errors[source].length > 10) {
                const mae = errors[source].reduce((a, b) => a + b, 0) / errors[source].length;
                // 可靠度 = baseStd / (mae + baseStd) ，範圍 0.3-0.95
                this.reliability[source] = Math.max(0.3, Math.min(0.95, 
                    this.baseStd / (mae + this.baseStd)));
            }
        }
        
        console.log(`📚 從 ${historicalData.length} 天歷史數據學習完成`);
        console.log(`   可靠度: XGBoost=${this.reliability.xgboost.toFixed(2)}, AI=${this.reliability.ai.toFixed(2)}, Weather=${this.reliability.weather.toFixed(2)}`);
        
        return this.reliability;
    }
    
    /**
     * 獲取當前狀態
     */
    getState() {
        return {
            reliability: { ...this.reliability },
            baseStd: this.baseStd,
            learningRate: this.learningRate,
            historySize: this.history.length,
            lastPrediction: this.lastPrediction
        };
    }
    
    /**
     * 設置狀態（用於持久化恢復）
     */
    setState(state) {
        if (state.reliability) {
            this.reliability = { ...state.reliability };
        }
        if (state.baseStd) {
            this.baseStd = state.baseStd;
        }
        if (state.history) {
            this.history = state.history;
        }
    }
}

// ============================================================
// 最佳每日預測選擇器
// 從一天中的多次預測中選出最準確的代表值
// ============================================================

class OptimalDailyPredictionSelector {
    constructor(options = {}) {
        // 時段權重（基於歷史準確度）
        this.timeSlotWeights = options.timeSlotWeights || null;
        
        // 預設時段權重（較晚的預測通常更準確）
        this.defaultTimeWeights = {
            '00-06': 0.7,   // 凌晨：信息不完整
            '06-12': 0.9,   // 上午：較多信息
            '12-18': 1.0,   // 下午：信息完整
            '18-24': 1.1    // 晚間：最完整，但可能過擬合
        };
        
        // 異常值閾值（Z-score）
        this.outlierThreshold = options.outlierThreshold || 2.0;
        
        // 最小預測數量（少於此數量時使用簡單平均）
        this.minPredictions = options.minPredictions || 5;
    }
    
    /**
     * 選擇最佳每日預測
     * 
     * @param {Array} predictions - [{predicted_count, created_at, ...}, ...]
     * @param {Object} options - 選項
     * @returns {Object} 最佳預測結果
     */
    selectBest(predictions, options = {}) {
        if (!predictions || predictions.length === 0) {
            return null;
        }
        
        const values = predictions.map(p => p.predicted_count);
        
        // 預測數量太少時使用簡單平均
        if (predictions.length < this.minPredictions) {
            const avg = this.mean(values);
            return {
                value: Math.round(avg),
                method: 'simple_average',
                reason: `預測數量不足 (${predictions.length} < ${this.minPredictions})`,
                confidence: 'low',
                stats: this.calculateStats(values)
            };
        }
        
        // === 方法 1: 時間加權平均 ===
        const timeWeighted = this.timeWeightedAverage(predictions);
        
        // === 方法 2: 異常值過濾後的平均 ===
        const outlierFiltered = this.outlierFilteredAverage(values);
        
        // === 方法 3: 穩定性加權（低方差時段權重更高）===
        const stabilityWeighted = this.stabilityWeightedAverage(predictions);
        
        // === 方法 4: 最後 N 次預測的平均（假設越晚越準）===
        const lastN = Math.min(10, Math.ceil(predictions.length * 0.3));
        const lastNAvg = this.lastNAverage(predictions, lastN);
        
        // === 方法 5: 收斂值（當預測開始收斂時的值）===
        const converged = this.findConvergenceValue(predictions);
        
        // === 元方法：根據歷史準確度選擇最佳方法 ===
        const methods = {
            timeWeighted,
            outlierFiltered,
            stabilityWeighted,
            lastNAvg,
            converged
        };
        
        // 計算各方法的一致性分數
        const methodValues = Object.values(methods).filter(m => m && m.value).map(m => m.value);
        const consensus = this.mean(methodValues);
        const methodStd = this.standardDeviation(methodValues);
        
        // 選擇最接近共識的方法（穩健選擇）
        let bestMethod = 'timeWeighted';
        let minDistance = Infinity;
        
        for (const [name, result] of Object.entries(methods)) {
            if (result && result.value) {
                const distance = Math.abs(result.value - consensus);
                if (distance < minDistance) {
                    minDistance = distance;
                    bestMethod = name;
                }
            }
        }
        
        // 計算最終值（加權組合）
        const finalValue = this.weightedEnsemble(methods);
        
        // 計算穩定性評分
        const stats = this.calculateStats(values);
        const cv = stats.stdDev / stats.mean;
        let confidence = 'medium';
        if (cv < 0.05) confidence = 'high';
        else if (cv > 0.15) confidence = 'low';
        
        return {
            value: Math.round(finalValue),
            method: 'optimal_ensemble',
            bestSingleMethod: bestMethod,
            methods,
            confidence,
            stats,
            cv: (cv * 100).toFixed(1) + '%',
            consensus: Math.round(consensus),
            methodAgreement: methodStd < 5 ? 'high' : (methodStd < 15 ? 'medium' : 'low')
        };
    }
    
    /**
     * 時間加權平均
     */
    timeWeightedAverage(predictions) {
        let weightedSum = 0;
        let weightSum = 0;
        
        for (const pred of predictions) {
            const hour = new Date(pred.created_at).getHours();
            let weight = 1.0;
            
            // 使用時段權重
            if (this.timeSlotWeights && this.timeSlotWeights[hour]) {
                weight = this.timeSlotWeights[hour];
            } else {
                // 使用預設時段權重
                if (hour < 6) weight = this.defaultTimeWeights['00-06'];
                else if (hour < 12) weight = this.defaultTimeWeights['06-12'];
                else if (hour < 18) weight = this.defaultTimeWeights['12-18'];
                else weight = this.defaultTimeWeights['18-24'];
            }
            
            weightedSum += pred.predicted_count * weight;
            weightSum += weight;
        }
        
        return {
            value: Math.round(weightedSum / weightSum),
            method: 'time_weighted'
        };
    }
    
    /**
     * 異常值過濾後的平均
     */
    outlierFilteredAverage(values) {
        const mean = this.mean(values);
        const std = this.standardDeviation(values);
        
        const filtered = values.filter(v => 
            Math.abs(v - mean) / std <= this.outlierThreshold
        );
        
        if (filtered.length === 0) {
            return { value: Math.round(mean), method: 'outlier_filtered', outliers: values.length };
        }
        
        return {
            value: Math.round(this.mean(filtered)),
            method: 'outlier_filtered',
            outliers: values.length - filtered.length
        };
    }
    
    /**
     * 穩定性加權平均（將一天分成時段，低方差時段權重更高）
     */
    stabilityWeightedAverage(predictions) {
        // 將預測分成 4 個時段
        const slots = [[], [], [], []];
        
        for (const pred of predictions) {
            const hour = new Date(pred.created_at).getHours();
            const slotIndex = Math.floor(hour / 6);
            slots[slotIndex].push(pred.predicted_count);
        }
        
        // 計算每個時段的統計
        const slotStats = slots.map(slot => {
            if (slot.length === 0) return null;
            const mean = this.mean(slot);
            const std = this.standardDeviation(slot);
            const cv = std / mean;
            // 權重 = 1 / (cv + 0.01) ，低變異係數 = 高權重
            const weight = 1 / (cv + 0.01);
            return { mean, std, cv, weight, count: slot.length };
        });
        
        // 加權平均
        let weightedSum = 0;
        let weightSum = 0;
        
        for (const stat of slotStats) {
            if (stat) {
                weightedSum += stat.mean * stat.weight;
                weightSum += stat.weight;
            }
        }
        
        return {
            value: Math.round(weightedSum / weightSum),
            method: 'stability_weighted',
            slotStats
        };
    }
    
    /**
     * 最後 N 次預測的平均
     */
    lastNAverage(predictions, n) {
        const sorted = [...predictions].sort((a, b) => 
            new Date(b.created_at) - new Date(a.created_at)
        );
        const lastN = sorted.slice(0, n);
        const values = lastN.map(p => p.predicted_count);
        
        return {
            value: Math.round(this.mean(values)),
            method: 'last_n_average',
            n,
            lastPredictionTime: lastN[0]?.created_at
        };
    }
    
    /**
     * 找到預測收斂的值
     */
    findConvergenceValue(predictions) {
        const sorted = [...predictions].sort((a, b) => 
            new Date(a.created_at) - new Date(b.created_at)
        );
        
        const values = sorted.map(p => p.predicted_count);
        
        // 計算滾動標準差，找到開始穩定的點
        const windowSize = Math.min(5, Math.floor(values.length / 4));
        let convergenceIndex = values.length - 1;
        let minStd = Infinity;
        
        for (let i = windowSize; i < values.length; i++) {
            const window = values.slice(i - windowSize, i);
            const std = this.standardDeviation(window);
            if (std < minStd) {
                minStd = std;
                convergenceIndex = i;
            }
        }
        
        // 使用收斂點之後的預測
        const convergedValues = values.slice(Math.max(0, convergenceIndex - windowSize));
        
        return {
            value: Math.round(this.mean(convergedValues)),
            method: 'convergence',
            convergenceTime: sorted[convergenceIndex]?.created_at,
            convergenceStd: minStd
        };
    }
    
    /**
     * 加權組合所有方法
     */
    weightedEnsemble(methods) {
        // 預設權重（可從歷史準確度學習）
        const weights = {
            timeWeighted: 0.25,
            outlierFiltered: 0.20,
            stabilityWeighted: 0.20,
            lastNAvg: 0.20,
            converged: 0.15
        };
        
        let weightedSum = 0;
        let weightSum = 0;
        
        for (const [name, result] of Object.entries(methods)) {
            if (result && result.value && weights[name]) {
                weightedSum += result.value * weights[name];
                weightSum += weights[name];
            }
        }
        
        return weightedSum / weightSum;
    }
    
    // === 統計工具函數 ===
    
    mean(values) {
        if (!values || values.length === 0) return 0;
        return values.reduce((a, b) => a + b, 0) / values.length;
    }
    
    standardDeviation(values) {
        if (!values || values.length < 2) return 0;
        const avg = this.mean(values);
        const squaredDiffs = values.map(v => Math.pow(v - avg, 2));
        return Math.sqrt(this.mean(squaredDiffs));
    }
    
    median(values) {
        if (!values || values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
    
    calculateStats(values) {
        return {
            count: values.length,
            min: Math.min(...values),
            max: Math.max(...values),
            mean: this.mean(values),
            median: this.median(values),
            stdDev: this.standardDeviation(values),
            range: Math.max(...values) - Math.min(...values)
        };
    }
    
    /**
     * 從歷史數據學習時段權重
     * 
     * @param {Array} historicalData - [{predictions: [...], actual}, ...]
     */
    learnTimeSlotWeights(historicalData) {
        const slotErrors = {};
        
        for (let h = 0; h < 24; h++) {
            slotErrors[h] = [];
        }
        
        for (const day of historicalData) {
            if (!day.actual || !day.predictions) continue;
            
            for (const pred of day.predictions) {
                const hour = new Date(pred.created_at).getHours();
                const error = Math.abs(pred.predicted_count - day.actual);
                slotErrors[hour].push(error);
            }
        }
        
        // 計算每小時的 MAE 並轉換為權重
        this.timeSlotWeights = {};
        let maxMAE = 0;
        
        for (let h = 0; h < 24; h++) {
            if (slotErrors[h].length > 0) {
                const mae = this.mean(slotErrors[h]);
                maxMAE = Math.max(maxMAE, mae);
                this.timeSlotWeights[h] = mae;
            }
        }
        
        // 反轉：低 MAE = 高權重
        for (let h = 0; h < 24; h++) {
            if (this.timeSlotWeights[h]) {
                this.timeSlotWeights[h] = maxMAE / this.timeSlotWeights[h];
            } else {
                this.timeSlotWeights[h] = 1.0;
            }
        }
        
        console.log('📊 時段權重學習完成:', this.timeSlotWeights);
        
        return this.timeSlotWeights;
    }
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        PragmaticBayesianPredictor,
        OptimalDailyPredictionSelector,
        getPragmaticBayesian: (options) => new PragmaticBayesianPredictor(options),
        getOptimalSelector: (options) => new OptimalDailyPredictionSelector(options)
    };
}

// Export for browser
if (typeof window !== 'undefined') {
    window.PragmaticBayesianPredictor = PragmaticBayesianPredictor;
    window.OptimalDailyPredictionSelector = OptimalDailyPredictionSelector;
}

