/**
 * 應用平滑處理到歷史預測數據
 * 這個腳本會在部署時自動運行一次
 * 
 * @version 2.5.0
 * @date 2025-12-27 HKT
 */

const db = require('./database.js');

async function applySmoothing() {
    console.log('🔄 開始應用平滑處理到歷史預測數據...');
    
    if (!db.pool) {
        console.log('⚠️ 數據庫未連接，跳過平滑處理');
        return { success: false, reason: 'Database not connected' };
    }
    
    try {
        // 獲取所有有預測數據但尚未平滑的日期
        const datesResult = await db.pool.query(`
            SELECT DISTINCT dp.target_date 
            FROM daily_predictions dp
            LEFT JOIN final_daily_predictions fdp ON dp.target_date = fdp.target_date
            WHERE fdp.smoothing_method IS NULL OR fdp.smoothing_method = ''
            ORDER BY dp.target_date DESC
        `);
        
        const dates = datesResult.rows.map(r => r.target_date.toISOString().split('T')[0]);
        
        if (dates.length === 0) {
            console.log('✅ 所有預測數據已經平滑處理過');
            return { success: true, processed: 0 };
        }
        
        console.log(`📊 找到 ${dates.length} 個日期需要平滑處理`);
        
        const results = [];
        let successCount = 0;
        let failCount = 0;
        
        for (const dateStr of dates) {
            try {
                const result = await db.calculateFinalDailyPrediction(dateStr);
                if (result) {
                    successCount++;
                    results.push({
                        date: dateStr,
                        predicted: result.predicted_count,
                        method: result.smoothing_method,
                        stability: result.stability_cv,
                        success: true
                    });
                    console.log(`  ✅ ${dateStr}: ${result.predicted_count} (${result.smoothing_method})`);
                } else {
                    failCount++;
                    results.push({ date: dateStr, success: false, reason: 'No predictions' });
                    console.log(`  ⚠️ ${dateStr}: 沒有足夠的預測數據`);
                }
            } catch (err) {
                failCount++;
                results.push({ date: dateStr, success: false, reason: err.message });
                console.error(`  ❌ ${dateStr}: ${err.message}`);
            }
        }
        
        console.log(`\n📈 平滑處理完成: ${successCount} 成功, ${failCount} 失敗`);
        
        return {
            success: true,
            processed: successCount,
            failed: failCount,
            results: results
        };
        
    } catch (error) {
        console.error('❌ 平滑處理失敗:', error);
        return { success: false, error: error.message };
    }
}

// 如果直接運行此腳本
if (require.main === module) {
    db.initDatabase().then(() => {
        applySmoothing().then(result => {
            console.log('\n結果:', JSON.stringify(result, null, 2));
            process.exit(result.success ? 0 : 1);
        });
    }).catch(err => {
        console.error('初始化失敗:', err);
        process.exit(1);
    });
}

module.exports = { applySmoothing };
