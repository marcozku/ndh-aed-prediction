/**
 * 清除並重新導入數據腳本
 * 清除所有數據庫數據，然後重新導入CSV數據
 */

const fs = require('fs');
const { Pool } = require('pg');

// 初始化數據庫連接
function initPool() {
    const pool = new Pool({
        host: process.env.DB_HOST || process.env.PGHOST || 'localhost',
        port: process.env.DB_PORT || process.env.PGPORT || 5432,
        database: process.env.DB_NAME || process.env.PGDATABASE || 'ndh_aed',
        user: process.env.DB_USER || process.env.PGUSER || 'postgres',
        password: process.env.DB_PASSWORD || process.env.PGPASSWORD || '',
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DB_SSL === 'true' || process.env.DATABASE_URL?.includes('sslmode=require') 
            ? { rejectUnauthorized: false } 
            : false
    });
    return pool;
}

// 讀取並解析 CSV 文件
function parseCSV(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    const data = [];
    
    // 跳過標題行
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // 處理 CSV（可能包含引號）
        const parts = line.split(',');
        if (parts.length < 2) continue;
        
        const date = parts[0].trim().replace(/^"|"$/g, '');
        const attendance = parts[1].trim().replace(/^"|"$/g, '');
        
        if (date && attendance && !isNaN(parseInt(attendance, 10))) {
            data.push({
                date: date,
                patient_count: parseInt(attendance, 10),
                source: 'csv_reimport',
                notes: `從 CSV 文件重新導入的歷史數據 (${new Date().toISOString()})`
            });
        } else {
            console.warn(`⚠️ 跳過無效行 ${i}: ${line}`);
        }
    }
    
    console.log(`📊 解析 CSV: 總行數 ${lines.length - 1}, 有效數據 ${data.length} 筆`);
    return data;
}

// 清除所有數據
async function clearAllData(pool) {
    const client = await pool.connect();
    try {
        console.log('🗑️  開始清除所有數據...');
        await client.query('BEGIN');
        
        // 按順序清除（考慮外鍵約束）
        await client.query('TRUNCATE TABLE prediction_accuracy CASCADE');
        console.log('  ✅ 已清除 prediction_accuracy');
        
        await client.query('TRUNCATE TABLE final_daily_predictions CASCADE');
        console.log('  ✅ 已清除 final_daily_predictions');
        
        await client.query('TRUNCATE TABLE daily_predictions CASCADE');
        console.log('  ✅ 已清除 daily_predictions');
        
        await client.query('TRUNCATE TABLE predictions CASCADE');
        console.log('  ✅ 已清除 predictions');
        
        await client.query('TRUNCATE TABLE actual_data CASCADE');
        console.log('  ✅ 已清除 actual_data');
        
        // 保留 ai_factors_cache（不需要清除）
        // await client.query('TRUNCATE TABLE ai_factors_cache CASCADE');
        
        await client.query('COMMIT');
        console.log('✅ 所有數據已清除');
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// 批量導入數據
async function importCSVData(pool, csvFilePath) {
    console.log('📊 開始導入 CSV 數據...');
    console.log(`📁 文件路徑: ${csvFilePath}`);
    
    try {
        // 讀取並解析 CSV
        const data = parseCSV(csvFilePath);
        console.log(`📈 解析到 ${data.length} 筆數據`);
        
        if (data.length === 0) {
            console.warn('⚠️ CSV 文件中沒有有效數據');
            return { success: false, count: 0, error: '沒有有效數據' };
        }
        
        // 檢查日期範圍
        const dates = data.map(d => d.date).sort();
        if (dates.length > 0) {
            console.log(`📅 日期範圍: ${dates[0]} 至 ${dates[dates.length - 1]}`);
        }
        
        const client = await pool.connect();
        let successCount = 0;
        let errorCount = 0;
        
        try {
            await client.query('BEGIN');
            
            // 批量導入以提高性能（每批1000筆）
            const batchSize = 1000;
            for (let i = 0; i < data.length; i += batchSize) {
                const batch = data.slice(i, i + batchSize);
                const batchNum = Math.floor(i / batchSize) + 1;
                const totalBatches = Math.ceil(data.length / batchSize);
                
                for (const record of batch) {
                    try {
                        const query = `
                            INSERT INTO actual_data (date, patient_count, source, notes)
                            VALUES ($1, $2, $3, $4)
                            ON CONFLICT (date) DO UPDATE SET
                                patient_count = EXCLUDED.patient_count,
                                source = EXCLUDED.source,
                                notes = EXCLUDED.notes,
                                updated_at = CURRENT_TIMESTAMP
                            RETURNING *
                        `;
                        const result = await client.query(query, [
                            record.date,
                            record.patient_count,
                            record.source,
                            record.notes
                        ]);
                        successCount++;
                    } catch (err) {
                        console.error(`❌ 導入失敗 ${record.date}:`, err.message);
                        errorCount++;
                    }
                }
                
                // 每批完成後顯示進度
                if (batchNum % 5 === 0 || batchNum === totalBatches) {
                    console.log(`  📊 進度: ${Math.min(i + batchSize, data.length)}/${data.length} (${Math.round((Math.min(i + batchSize, data.length) / data.length) * 100)}%)`);
                }
            }
            
            await client.query('COMMIT');
            console.log(`✅ 成功導入 ${successCount} 筆數據`);
            if (errorCount > 0) {
                console.warn(`⚠️ ${errorCount} 筆數據導入失敗`);
            }
            
            return { success: true, count: successCount, errors: errorCount };
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('❌ 導入 CSV 數據失敗:', error);
        return { success: false, count: 0, error: error.message };
    }
}

// 主函數
async function main() {
    const csvFilePath = process.argv[2] || '/Users/yoyoau/Library/Containers/net.whatsapp.WhatsApp/Data/tmp/documents/86448351-FEDA-406E-B465-B7D0B0753234/NDH_AED_Attendance_Minimal.csv';
    
    if (!fs.existsSync(csvFilePath)) {
        console.error(`❌ 文件不存在: ${csvFilePath}`);
        console.log('使用方法: node clear-and-reimport.js [csv-file-path]');
        process.exit(1);
    }
    
    const pool = initPool();
    
    try {
        // 1. 清除所有數據
        await clearAllData(pool);
        
        // 2. 重新導入 CSV 數據
        const result = await importCSVData(pool, csvFilePath);
        
        if (result.success) {
            console.log(`\n✅ 重新導入完成！成功導入 ${result.count} 筆數據`);
            
            // 3. 顯示統計信息
            const statsClient = await pool.connect();
            try {
                const actualCount = await statsClient.query('SELECT COUNT(*) FROM actual_data');
                console.log(`\n📊 數據庫統計:`);
                console.log(`   實際數據: ${actualCount.rows[0].count} 筆`);
            } finally {
                statsClient.release();
            }
            
            process.exit(0);
        } else {
            console.error(`\n❌ 導入失敗: ${result.error}`);
            process.exit(1);
        }
    } catch (err) {
        console.error('❌ 執行失敗:', err);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// 如果直接運行此腳本
if (require.main === module) {
    main().catch(err => {
        console.error('❌ 執行失敗:', err);
        process.exit(1);
    });
}

module.exports = { clearAllData, importCSVData, parseCSV };
