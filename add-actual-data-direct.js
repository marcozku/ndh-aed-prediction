/**
 * 直接添加實際數據到數據庫並計算準確度
 * 使用方式: node add-actual-data-direct.js
 */

require('dotenv').config();

// 直接初始化數據庫連接池（複製自 database.js）
function initPool() {
    if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL 環境變數未設置');
        return null;
    }

    const { Pool } = require('pg');
    return new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_URL.includes('localhost') ? false : {
            rejectUnauthorized: false
        }
    });
}

// 實際數據（1/12 到 12/12）
const actualData = [
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

async function addActualDataDirect() {
    const pool = initPool();
    if (!pool) {
        console.error('❌ 無法初始化數據庫連接池');
        process.exit(1);
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        console.log('📊 開始添加實際數據...');
        console.log('數據列表:');
        actualData.forEach(item => {
            console.log(`  ${item.date}: ${item.patient_count} 人`);
        });
        console.log('');

        const results = [];
        let successCount = 0;
        let errorCount = 0;

        for (const data of actualData) {
            try {
                // 插入或更新實際數據
                const insertQuery = `
                    INSERT INTO actual_data (date, patient_count, source, notes)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (date) DO UPDATE SET
                        patient_count = EXCLUDED.patient_count,
                        source = EXCLUDED.source,
                        notes = EXCLUDED.notes
                    RETURNING *
                `;
                const insertResult = await client.query(insertQuery, [
                    data.date,
                    data.patient_count,
                    'manual_upload',
                    'Added via script on ' + new Date().toISOString()
                ]);
                results.push(insertResult.rows[0]);
                successCount++;

                // 計算準確度（如果有預測數據）
                try {
                    const accuracyQuery = `
                        SELECT 
                            COALESCE(
                                (SELECT predicted_count FROM final_daily_predictions WHERE target_date = $1),
                                (SELECT predicted_count FROM daily_predictions WHERE target_date = $1 ORDER BY created_at DESC LIMIT 1),
                                (SELECT predicted_count FROM predictions WHERE target_date = $1 ORDER BY created_at DESC LIMIT 1)
                            ) as predicted_count,
                            COALESCE(
                                (SELECT ci80_low FROM final_daily_predictions WHERE target_date = $1),
                                (SELECT ci80_low FROM daily_predictions WHERE target_date = $1 ORDER BY created_at DESC LIMIT 1),
                                (SELECT ci80_low FROM predictions WHERE target_date = $1 ORDER BY created_at DESC LIMIT 1)
                            ) as ci80_low,
                            COALESCE(
                                (SELECT ci80_high FROM final_daily_predictions WHERE target_date = $1),
                                (SELECT ci80_high FROM daily_predictions WHERE target_date = $1 ORDER BY created_at DESC LIMIT 1),
                                (SELECT ci80_high FROM predictions WHERE target_date = $1 ORDER BY created_at DESC LIMIT 1)
                            ) as ci80_high,
                            COALESCE(
                                (SELECT ci95_low FROM final_daily_predictions WHERE target_date = $1),
                                (SELECT ci95_low FROM daily_predictions WHERE target_date = $1 ORDER BY created_at DESC LIMIT 1),
                                (SELECT ci95_low FROM predictions WHERE target_date = $1 ORDER BY created_at DESC LIMIT 1)
                            ) as ci95_low,
                            COALESCE(
                                (SELECT ci95_high FROM final_daily_predictions WHERE target_date = $1),
                                (SELECT ci95_high FROM daily_predictions WHERE target_date = $1 ORDER BY created_at DESC LIMIT 1),
                                (SELECT ci95_high FROM predictions WHERE target_date = $1 ORDER BY created_at DESC LIMIT 1)
                            ) as ci95_high
                    `;
                    const accuracyResult = await client.query(accuracyQuery, [data.date]);
                    const prediction = accuracyResult.rows[0];

                    if (prediction.predicted_count) {
                        const predicted = parseInt(prediction.predicted_count);
                        const actual = data.patient_count;
                        const error = actual - predicted;
                        const errorPct = ((error / predicted) * 100).toFixed(2);
                        const ci80_low = prediction.ci80_low ? parseInt(prediction.ci80_low) : null;
                        const ci80_high = prediction.ci80_high ? parseInt(prediction.ci80_high) : null;
                        const ci95_low = prediction.ci95_low ? parseInt(prediction.ci95_low) : null;
                        const ci95_high = prediction.ci95_high ? parseInt(prediction.ci95_high) : null;

                        const inCI80 = ci80_low && ci80_high && actual >= ci80_low && actual <= ci80_high;
                        const inCI95 = ci95_low && ci95_high && actual >= ci95_low && actual <= ci95_high;

                        const accuracyQuery2 = `
                            INSERT INTO prediction_accuracy (date, actual_count, predicted_count, error, error_pct, ci80_low, ci80_high, ci95_low, ci95_high, in_ci80, in_ci95)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                            ON CONFLICT (date) DO UPDATE SET
                                actual_count = EXCLUDED.actual_count,
                                predicted_count = EXCLUDED.predicted_count,
                                error = EXCLUDED.error,
                                error_pct = EXCLUDED.error_pct,
                                ci80_low = EXCLUDED.ci80_low,
                                ci80_high = EXCLUDED.ci80_high,
                                ci95_low = EXCLUDED.ci95_low,
                                ci95_high = EXCLUDED.ci95_high,
                                in_ci80 = EXCLUDED.in_ci80,
                                in_ci95 = EXCLUDED.in_ci95,
                                updated_at = CURRENT_TIMESTAMP
                        `;
                        await client.query(accuracyQuery2, [
                            data.date,
                            actual,
                            predicted,
                            error,
                            parseFloat(errorPct),
                            ci80_low,
                            ci80_high,
                            ci95_low,
                            ci95_high,
                            inCI80,
                            inCI95
                        ]);
                        console.log(`  ✅ ${data.date}: 實際 ${actual} 人, 預測 ${predicted} 人, 誤差 ${error > 0 ? '+' : ''}${error} (${errorPct}%)`);
                        
                        // 如果該日期有 daily_predictions，計算最終預測
                        try {
                            const finalPredQuery = `
                                SELECT COUNT(*) as count FROM daily_predictions WHERE target_date = $1
                            `;
                            const finalPredCheck = await client.query(finalPredQuery, [data.date]);
                            if (parseInt(finalPredCheck.rows[0].count) > 0) {
                                // 計算最終預測（平均所有預測）
                                const avgQuery = `
                                    SELECT 
                                        AVG(predicted_count)::INTEGER as avg_predicted,
                                        AVG(ci80_low)::INTEGER as avg_ci80_low,
                                        AVG(ci80_high)::INTEGER as avg_ci80_high,
                                        AVG(ci95_low)::INTEGER as avg_ci95_low,
                                        AVG(ci95_high)::INTEGER as avg_ci95_high,
                                        COUNT(*) as prediction_count,
                                        MAX(model_version) as model_version
                                    FROM daily_predictions
                                    WHERE target_date = $1
                                `;
                                const avgResult = await client.query(avgQuery, [data.date]);
                                const avg = avgResult.rows[0];
                                
                                const insertFinalQuery = `
                                    INSERT INTO final_daily_predictions (
                                        target_date, predicted_count, ci80_low, ci80_high, ci95_low, ci95_high,
                                        prediction_count, model_version
                                    )
                                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                                    ON CONFLICT (target_date) DO UPDATE SET
                                        predicted_count = EXCLUDED.predicted_count,
                                        ci80_low = EXCLUDED.ci80_low,
                                        ci80_high = EXCLUDED.ci80_high,
                                        ci95_low = EXCLUDED.ci95_low,
                                        ci95_high = EXCLUDED.ci95_high,
                                        prediction_count = EXCLUDED.prediction_count,
                                        model_version = EXCLUDED.model_version,
                                        calculated_at = CURRENT_TIMESTAMP
                                `;
                                await client.query(insertFinalQuery, [
                                    data.date,
                                    avg.avg_predicted,
                                    avg.avg_ci80_low,
                                    avg.avg_ci80_high,
                                    avg.avg_ci95_low,
                                    avg.avg_ci95_high,
                                    parseInt(avg.prediction_count),
                                    avg.model_version
                                ]);
                                console.log(`  📊 ${data.date}: 已計算最終預測（基於 ${avg.prediction_count} 次預測的平均值）`);
                            }
                        } catch (finalPredError) {
                            // 忽略錯誤，繼續處理
                            console.log(`  ℹ️  ${data.date}: 計算最終預測時出錯（可能沒有足夠的預測數據）`);
                        }
                    } else {
                        console.log(`  ⚠️  ${data.date}: 已添加實際數據，但沒有找到預測數據`);
                    }
                } catch (accError) {
                    console.error(`  ⚠️  ${data.date}: 計算準確度時出錯:`, accError.message);
                }
            } catch (err) {
                console.error(`  ❌ ${data.date}: 添加失敗:`, err.message);
                errorCount++;
            }
        }

        await client.query('COMMIT');
        
        console.log('');
        console.log(`✅ 成功添加 ${successCount} 筆數據`);
        if (errorCount > 0) {
            console.log(`⚠️  ${errorCount} 筆數據添加失敗`);
        }
        console.log('');
        console.log('📊 比較結果摘要：');
        for (const data of actualData) {
            try {
                const accuracyResult = await client.query(
                    'SELECT * FROM prediction_accuracy WHERE target_date = $1',
                    [data.date]
                );
                if (accuracyResult.rows.length > 0) {
                    const acc = accuracyResult.rows[0];
                    const inCI80 = acc.within_ci80 ? '✅' : '❌';
                    const inCI95 = acc.within_ci95 ? '✅' : '❌';
                    console.log(`  ${data.date}: 實際 ${data.patient_count} 人, 預測 ${acc.predicted_count} 人, 誤差 ${acc.error > 0 ? '+' : ''}${acc.error} (${acc.error_percentage}%), CI80: ${inCI80}, CI95: ${inCI95}`);
                }
            } catch (err) {
                // 忽略錯誤
            }
        }
        console.log('');
        console.log('💡 數據已添加並自動計算準確度');
        console.log('💡 你可以在網頁上查看「實際 vs 預測對比」圖表和「詳細比較數據」表格');

        return results;
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 添加數據時發生錯誤:', error.message);
        throw error;
    } finally {
        client.release();
        pool.end();
    }
}

// 主函數
async function main() {
    try {
        await addActualDataDirect();
        process.exit(0);
    } catch (error) {
        console.error('❌ 執行失敗:', error);
        process.exit(1);
    }
}

// 執行
if (require.main === module) {
    main();
}

module.exports = { addActualDataDirect, actualData };
