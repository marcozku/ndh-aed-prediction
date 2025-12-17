/**
 * 預測器模組
 * 包含所有預測邏輯
 */

// 從原始 prediction.js 提取的預測類
export class Predictor {
    constructor(historicalData = null) {
        // 這裡將包含完整的預測邏輯
        // 為了保持功能完整，我們需要從原始文件複製完整的類定義
        this.data = historicalData || this.getDefaultData();
        this.globalMean = 0;
        this.stdDev = 0;
        this.dowFactors = {};
        this.monthFactors = {};
        this.monthDowFactors = {};
        this.fluSeasonFactor = 1.004;
        this.rollingWindowDays = 180;
        this.recentWindowDays = 30;
        
        this._calculateFactors();
    }
    
    getDefaultData() {
        // 返回默認歷史數據（從原始文件）
        return [
            { date: '2024-12-03', attendance: 269 },
            { date: '2024-12-04', attendance: 230 },
            // ... 更多數據
        ];
    }
    
    updateData(newData) {
        if (newData && Array.isArray(newData) && newData.length > 0) {
            this.data = newData.map(d => ({
                date: d.date || d.Date,
                attendance: d.attendance || d.patient_count || d.Attendance
            })).filter(d => d.date && d.attendance != null);
            
            this._calculateFactors();
        }
    }
    
    _calculateFactors() {
        // 計算因子的邏輯（從原始文件複製）
        const recentData = this.data.length > this.rollingWindowDays 
            ? this.data.slice(-this.rollingWindowDays)
            : this.data;
        
        const attendances = recentData.map(d => d.attendance);
        
        // 計算加權平均
        const weights = recentData.map((_, i) => {
            const daysAgo = recentData.length - i - 1;
            const decay = 0.02;
            return Math.exp(-decay * daysAgo);
        });
        
        this.globalMean = this._weightedMean(attendances, weights);
        this.stdDev = this._weightedStdDev(attendances, this.globalMean, weights);
        
        // 計算星期因子、月份因子等...
        // （這裡需要完整的實現）
    }
    
    _weightedMean(values, weights) {
        if (values.length === 0) return 0;
        if (values.length !== weights.length) {
            return values.reduce((a, b) => a + b, 0) / values.length;
        }
        const weightedSum = values.reduce((sum, val, i) => sum + val * weights[i], 0);
        const weightSum = weights.reduce((a, b) => a + b, 0);
        return weightSum > 0 ? weightedSum / weightSum : 0;
    }
    
    _weightedStdDev(values, mean, weights) {
        if (values.length === 0) return 0;
        const squaredDiffs = values.map((v, i) => {
            const weight = weights && weights[i] ? weights[i] : 1;
            return weight * Math.pow(v - mean, 2);
        });
        const weightedVariance = squaredDiffs.reduce((a, b) => a + b, 0) / 
            (weights ? weights.reduce((a, b) => a + b, 0) : values.length);
        return Math.sqrt(Math.max(0, weightedVariance));
    }
    
    predict(date, weatherData = null, aiFactors = null) {
        // 預測邏輯（簡化版本，需要完整實現）
        const basePrediction = this.globalMean;
        // ... 應用各種因子
        return {
            predicted: Math.round(basePrediction),
            ci80: { low: Math.round(basePrediction - 32), high: Math.round(basePrediction + 32) },
            ci95: { low: Math.round(basePrediction - 49), high: Math.round(basePrediction + 49) }
        };
    }
    
    getStats() {
        const attendances = this.data.map(d => d.attendance);
        return {
            mean: this.globalMean,
            max: Math.max(...attendances),
            min: Math.min(...attendances),
            std: this.stdDev
        };
    }
}
