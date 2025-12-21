/**
 * 分析預測準確度
 * 分析為什麼預測不準確，找出問題所在
 */

require('dotenv').config();
const db = require('./database');

// 實際數據（1/12 到 12/12）
const ACTUAL_DATA = [
    { date: '2025-12-01', patient_count: 276 },
    { date: '2025-12-02', patient_count: 285 },
    { date: '2025-12-03', patient_count: 253 },
    { date: '2025-12-04', patient_count: 234 },
    { date: '2025-12-05', patient_count: 262 },
    { date: '2025-12-06', patient_count: 234 },
    { date: '2025-12-07', patient_count: 244 },
    { date: '2025-12-08', patient_count: 293 },
    { date: '2025-12-09', patient_count: 253 },
    { date: '2025-12-10', patient_count: 219 },
    { date: '2025-12-11', patient_count: 275 },
    { date: '2025-12-12', patient_count: 248 }
];

async function analyzeAccuracy() {
    if (!db || !db.pool) {
        console.error('❌ 數據庫未配置');
        process.exit(1);
    }

    console.log('📊 開始分析預測準確度...\n');
    console.log('='.repeat(80));
    console.log('實際數據 vs 預測數據比較分析');
    console.log('='.repeat(80));
    console.log('');

    const results = [];
    let totalError = 0;
    let totalAbsError = 0;
    let totalErrorPct = 0;
    let inCI80Count = 0;
    let inCI95Count = 0;

    for (const actual of ACTUAL_DATA) {
        const date = actual.date;
        const actualCount = actual.patient_count;
        
        // 獲取預測數據
        let prediction = null;
        let predictionSource = '';
        
        // 嘗試獲取最終預測
        const finalPred = await db.pool.query(
            'SELECT * FROM final_daily_predictions WHERE target_date = $1',
            [date]
        );
        
        if (finalPred.rows.length > 0) {
            prediction = finalPred.rows[0];
            predictionSource = 'final_daily_predictions';
        } else {
            // 嘗試獲取最新每日預測
            const dailyPred = await db.pool.query(
                'SELECT * FROM daily_predictions WHERE target_date = $1 ORDER BY created_at DESC LIMIT 1',
                [date]
            );
            
            if (dailyPred.rows.length > 0) {
                prediction = dailyPred.rows[0];
                predictionSource = 'daily_predictions';
            } else {
                // 嘗試獲取預測
                const pred = await db.pool.query(
                    'SELECT * FROM predictions WHERE target_date = $1 ORDER BY created_at DESC LIMIT 1',
                    [date]
                );
                
                if (pred.rows.length > 0) {
                    prediction = pred.rows[0];
                    predictionSource = 'predictions';
                }
            }
        }

        if (!prediction) {
            console.log(`⚠️  ${date}: 沒有找到預測數據`);
            continue;
        }

        const predicted = prediction.predicted_count;
        const error = predicted - actualCount;
        const absError = Math.abs(error);
        const errorPct = ((error / actualCount) * 100).toFixed(2);
        const absErrorPct = Math.abs(parseFloat(errorPct));
        
        const ci80_low = prediction.ci80_low;
        const ci80_high = prediction.ci80_high;
        const ci95_low = prediction.ci95_low;
        const ci95_high = prediction.ci95_high;
        
        const inCI80 = ci80_low && ci80_high && actualCount >= ci80_low && actualCount <= ci80_high;
        const inCI95 = ci95_low && ci95_high && actualCount >= ci95_low && actualCount <= ci95_high;
        
        if (inCI80) inCI80Count++;
        if (inCI95) inCI95Count++;
        
        totalError += error;
        totalAbsError += absError;
        totalErrorPct += absErrorPct;

        // 獲取日期信息
        const dateObj = new Date(date);
        const dayOfWeek = dateObj.getDay();
        const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        
        results.push({
            date,
            dayOfWeek: dayNames[dayOfWeek],
            isWeekend,
            actual: actualCount,
            predicted,
            error,
            absError,
            errorPct: parseFloat(errorPct),
            absErrorPct,
            inCI80,
            inCI95,
            ci80_low,
            ci80_high,
            ci95_low,
            ci95_high,
            predictionSource
        });
    }

    // 顯示詳細比較
    console.log('📋 詳細比較數據：');
    console.log('-'.repeat(80));
    console.log('日期\t\t星期\t實際\t預測\t誤差\t誤差%\tCI80\tCI95');
    console.log('-'.repeat(80));
    
    for (const r of results) {
        const ci80Status = r.inCI80 ? '✅' : '❌';
        const ci95Status = r.inCI95 ? '✅' : '❌';
        const errorSign = r.error > 0 ? '+' : '';
        console.log(`${r.date}\t${r.dayOfWeek}\t${r.actual}\t${r.predicted}\t${errorSign}${r.error}\t${r.errorPct}%\t${ci80Status}\t${ci95Status}`);
    }
    
    console.log('-'.repeat(80));
    console.log('');

    // 統計分析
    const avgError = (totalError / results.length).toFixed(2);
    const avgAbsError = (totalAbsError / results.length).toFixed(2);
    const avgErrorPct = (totalErrorPct / results.length).toFixed(2);
    const ci80Accuracy = ((inCI80Count / results.length) * 100).toFixed(1);
    const ci95Accuracy = ((inCI95Count / results.length) * 100).toFixed(1);

    console.log('📊 統計分析：');
    console.log('-'.repeat(80));
    console.log(`平均誤差: ${avgError > 0 ? '+' : ''}${avgError} 人`);
    console.log(`平均絕對誤差: ${avgAbsError} 人`);
    console.log(`平均誤差百分比: ${avgErrorPct}%`);
    console.log(`80% CI 準確率: ${ci80Accuracy}% (${inCI80Count}/${results.length})`);
    console.log(`95% CI 準確率: ${ci95Accuracy}% (${inCI95Count}/${results.length})`);
    console.log('-'.repeat(80));
    console.log('');

    // 誤差模式分析
    console.log('🔍 誤差模式分析：');
    console.log('-'.repeat(80));
    
    const overPredictions = results.filter(r => r.error > 0);
    const underPredictions = results.filter(r => r.error < 0);
    const accuratePredictions = results.filter(r => Math.abs(r.error) <= 10);
    
    console.log(`高估次數: ${overPredictions.length} (${((overPredictions.length / results.length) * 100).toFixed(1)}%)`);
    console.log(`低估次數: ${underPredictions.length} (${((underPredictions.length / results.length) * 100).toFixed(1)}%)`);
    console.log(`準確預測 (誤差 ≤ 10): ${accuratePredictions.length} (${((accuratePredictions.length / results.length) * 100).toFixed(1)}%)`);
    console.log('');
    
    if (overPredictions.length > 0) {
        const avgOverError = (overPredictions.reduce((sum, r) => sum + r.error, 0) / overPredictions.length).toFixed(2);
        console.log(`平均高估: +${avgOverError} 人`);
    }
    
    if (underPredictions.length > 0) {
        const avgUnderError = (underPredictions.reduce((sum, r) => sum + r.error, 0) / underPredictions.length).toFixed(2);
        console.log(`平均低估: ${avgUnderError} 人`);
    }
    console.log('');

    // 星期效應分析
    console.log('📅 星期效應分析：');
    console.log('-'.repeat(80));
    
    const weekdayErrors = {};
    for (const r of results) {
        if (!weekdayErrors[r.dayOfWeek]) {
            weekdayErrors[r.dayOfWeek] = { count: 0, totalError: 0, totalAbsError: 0 };
        }
        weekdayErrors[r.dayOfWeek].count++;
        weekdayErrors[r.dayOfWeek].totalError += r.error;
        weekdayErrors[r.dayOfWeek].totalAbsError += r.absError;
    }
    
    for (const [day, stats] of Object.entries(weekdayErrors)) {
        const avgError = (stats.totalError / stats.count).toFixed(2);
        const avgAbsError = (stats.totalAbsError / stats.count).toFixed(2);
        console.log(`星期${day}: 平均誤差 ${avgError > 0 ? '+' : ''}${avgError} 人, 平均絕對誤差 ${avgAbsError} 人 (${stats.count} 天)`);
    }
    console.log('');

    // 問題診斷
    console.log('🔬 問題診斷：');
    console.log('='.repeat(80));
    
    const issues = [];
    
    if (Math.abs(parseFloat(avgError)) > 15) {
        if (parseFloat(avgError) > 0) {
            issues.push(`⚠️ 系統性高估：平均高估 ${avgError} 人，可能需要調整基準值或因子`);
        } else {
            issues.push(`⚠️ 系統性低估：平均低估 ${Math.abs(parseFloat(avgError))} 人，可能需要調整基準值或因子`);
        }
    }
    
    if (parseFloat(avgErrorPct) > 10) {
        issues.push(`⚠️ 平均誤差百分比較高 (${avgErrorPct}%)，預測模型可能需要優化`);
    }
    
    if (parseFloat(ci80Accuracy) < 50) {
        issues.push(`⚠️ 80% CI 準確率較低 (${ci80Accuracy}%)，置信區間可能設置過窄`);
    }
    
    if (parseFloat(ci95Accuracy) < 80) {
        issues.push(`⚠️ 95% CI 準確率較低 (${ci95Accuracy}%)，置信區間可能設置過窄或標準差估計不準確`);
    }
    
    // 檢查是否有特定日期的異常誤差
    const largeErrors = results.filter(r => r.absErrorPct > 15);
    if (largeErrors.length > 0) {
        issues.push(`⚠️ 發現 ${largeErrors.length} 天誤差超過 15%：`);
        for (const err of largeErrors) {
            issues.push(`   - ${err.date} (星期${err.dayOfWeek}): 實際 ${err.actual} 人, 預測 ${err.predicted} 人, 誤差 ${err.errorPct > 0 ? '+' : ''}${err.errorPct}%`);
        }
    }
    
    if (issues.length === 0) {
        console.log('✅ 未發現明顯問題，預測準確度良好');
    } else {
        for (const issue of issues) {
            console.log(issue);
        }
    }
    
    console.log('='.repeat(80));
    console.log('');

    // 改進建議
    console.log('💡 改進建議：');
    console.log('-'.repeat(80));
    
    const suggestions = [];
    
    if (Math.abs(parseFloat(avgError)) > 10) {
        suggestions.push('1. 調整全局平均值或月份因子，修正系統性偏差');
    }
    
    if (parseFloat(avgErrorPct) > 8) {
        suggestions.push('2. 重新計算標準差，調整置信區間範圍');
        suggestions.push('3. 檢查並優化星期因子，特別是誤差較大的星期');
    }
    
    if (largeErrors.length > 0) {
        suggestions.push('4. 檢查異常日期（誤差 > 15%）是否有特殊事件未考慮');
        suggestions.push('5. 改進天氣因子和 AI 因子的計算邏輯');
    }
    
    if (parseFloat(ci95Accuracy) < 90) {
        suggestions.push('6. 擴大置信區間範圍，或重新評估標準差計算方法');
    }
    
    if (suggestions.length === 0) {
        console.log('✅ 預測模型表現良好，無需重大調整');
    } else {
        for (const suggestion of suggestions) {
            console.log(suggestion);
        }
    }
    
    console.log('-'.repeat(80));

    await db.pool.end();
}

// 執行分析
db.initDatabase().then(() => {
    return analyzeAccuracy();
}).then(() => {
    process.exit(0);
}).catch(err => {
    console.error('❌ 分析失敗:', err);
    process.exit(1);
});
