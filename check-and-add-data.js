/**
 * 檢查並添加實際數據
 * 檢查數據庫中是否已有 1/12 到 12/12 的實際數據，如果沒有則添加
 */

require('dotenv').config();

// 直接初始化數據庫連接池
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

async function checkAndAddData() {
    const pool = initPool();
    if (!pool) {
        console.error('❌ 無法初始化數據庫連接池');
        process.exit(1);
    }

    const client = await pool.connect();
    try {
        console.log('📊 檢查數據庫中的實際數據...\n');
        
        // 檢查哪些日期已有數據
        const existingDates = new Set();
        for (const data of actualData) {
            const result = await client.query(
                'SELECT date, patient_count FROM actual_data WHERE date = $1',
                [data.date]
            );
            if (result.rows.length > 0) {
                existingDates.add(data.date);
                console.log(`  ✅ ${data.date}: 已有數據 (${result.rows[0].patient_count} 人)`);
            } else {
                console.log(`  ⚠️  ${data.date}: 缺少數據`);
            }
        }

        // 找出需要添加的數據
        const dataToAdd = actualData.filter(d => !existingDates.has(d.date));
        
        if (dataToAdd.length === 0) {
            console.log('\n✅ 所有數據已存在於數據庫中！');
            console.log('📊 開始檢查比較數據...\n');
            
            // 檢查比較數據
            for (const data of actualData) {
                const accuracyResult = await client.query(
                    'SELECT * FROM prediction_accuracy WHERE target_date = $1',
                    [data.date]
                );
                
                const predResult = await client.query(`
                    SELECT 
                        COALESCE(
                            (SELECT predicted_count FROM final_daily_predictions WHERE target_date = $1),
                            (SELECT predicted_count FROM daily_predictions WHERE target_date = $1 ORDER BY created_at DESC LIMIT 1),
                            (SELECT predicted_count FROM predictions WHERE target_date = $1 ORDER BY created_at DESC LIMIT 1)
                        ) as predicted_count
                `, [data.date]);
                
                if (accuracyResult.rows.length > 0) {
                    const acc = accuracyResult.rows[0];
                    console.log(`  ✅ ${data.date}: 實際 ${data.patient_count} 人, 預測 ${acc.predicted_count || 'N/A'} 人, 誤差 ${acc.error || 'N/A'} (${acc.error_percentage || 'N/A'}%)`);
                } else if (predResult.rows[0]?.predicted_count) {
                    console.log(`  ⚠️  ${data.date}: 有預測數據但未計算準確度，正在計算...`);
                    // 計算準確度
                    await require('./database').calculateAccuracy(data.date);
                    console.log(`  ✅ ${data.date}: 準確度已計算`);
                } else {
                    console.log(`  ⚠️  ${data.date}: 沒有預測數據，無法進行比較`);
                }
            }
            
            client.release();
            pool.end();
            return;
        }

        console.log(`\n📊 需要添加 ${dataToAdd.length} 筆數據...\n`);
        
        await client.query('BEGIN');
        
        let successCount = 0;
        let errorCount = 0;

        for (const data of dataToAdd) {
            try {
                // 插入實際數據
                const insertQuery = `
                    INSERT INTO actual_data (date, patient_count, source, notes)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (date) DO UPDATE SET
                        patient_count = EXCLUDED.patient_count,
                        source = EXCLUDED.source,
                        notes = EXCLUDED.notes
                    RETURNING *
                `;
                await client.query(insertQuery, [
                    data.date,
                    data.patient_count,
                    'manual_upload',
                    'Added via script on ' + new Date().toISOString()
                ]);
                successCount++;

                // 計算準確度
                try {
                    await require('./database').calculateAccuracy(data.date);
                    console.log(`  ✅ ${data.date}: 已添加並計算準確度`);
                } catch (accError) {
                    console.log(`  ⚠️  ${data.date}: 已添加但計算準確度時出錯: ${accError.message}`);
                }
            } catch (err) {
                console.error(`  ❌ ${data.date}: 添加失敗:`, err.message);
                errorCount++;
            }
        }

        await client.query('COMMIT');
        
        console.log(`\n✅ 成功添加 ${successCount} 筆數據`);
        if (errorCount > 0) {
            console.log(`⚠️  ${errorCount} 筆數據添加失敗`);
        }
        console.log('💡 數據已添加並自動計算準確度');
        console.log('💡 你可以在網頁上查看「實際 vs 預測對比」圖表和「詳細比較數據」表格');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 處理數據時發生錯誤:', error.message);
        throw error;
    } finally {
        client.release();
        pool.end();
    }
}

// 主函數
async function main() {
    try {
        await checkAndAddData();
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

module.exports = { checkAndAddData };
