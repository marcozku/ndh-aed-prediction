/**
 * CSV 數據導入腳本
 * 從 CSV 文件導入歷史數據到 PostgreSQL 數據庫
 */

const fs = require('fs');
const path = require('path');

// 使用共享的數據庫連接（如果可用）
let pool = null;

// 初始化數據庫連接（使用與 database.js 相同的邏輯）
function initPool() {
    if (pool) return pool;
    
    const { Pool } = require('pg');
    // Try individual environment variables first (Railway sets these)
    const pgHost = process.env.PGHOST;
    const pgUser = process.env.PGUSER || process.env.POSTGRES_USER;
    const pgPassword = process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD;
    const pgDatabase = process.env.PGDATABASE || process.env.POSTGRES_DB;
    const pgPort = process.env.PGPORT || 5432;
    
    // Or try DATABASE_URL
    const dbUrl = process.env.DATABASE_URL;
    
    if (pgHost && pgUser && pgPassword && pgDatabase) {
        console.log('📡 Using individual PG environment variables...');
        const poolConfig = {
            user: pgUser,
            password: pgPassword,
            host: pgHost,
            port: parseInt(pgPort),
            database: pgDatabase,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 20000
        };

        // Only enable SSL for external connections
        if (!pgHost.includes('.railway.internal')) {
            poolConfig.ssl = { rejectUnauthorized: false };
        }
        
        pool = new Pool(poolConfig);
        pool.on('error', (err) => {
            console.error('❌ 數據庫連接池錯誤:', err.message);
        });
        
        return pool;
    }
    
    if (dbUrl && !dbUrl.includes('${{')) {
        console.log('📡 Using DATABASE_URL...');
        try {
            const url = new URL(dbUrl);
            const poolConfig = {
                user: url.username,
                password: decodeURIComponent(url.password),
                host: url.hostname,
                port: parseInt(url.port) || 5432,
                database: url.pathname.slice(1),
                max: 20,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 20000
            };

            if (!url.hostname.includes('.railway.internal')) {
                poolConfig.ssl = { rejectUnauthorized: false };
            }
            
            pool = new Pool(poolConfig);
            pool.on('error', (err) => {
                console.error('❌ 數據庫連接池錯誤:', err.message);
            });
            
            return pool;
        } catch (err) {
            console.error('❌ Failed to parse DATABASE_URL:', err.message);
        }
    }
    
    console.log('⚠️ No valid database configuration found');
    return null;
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
                source: 'csv_import',
                notes: `從 CSV 文件導入的歷史數據 (${new Date().toISOString()})`
            });
        } else {
            console.warn(`⚠️ 跳過無效行 ${i}: ${line}`);
        }
    }
    
    console.log(`📊 解析 CSV: 總行數 ${lines.length - 1}, 有效數據 ${data.length} 筆`);
    return data;
}

// 批量導入數據
async function importCSVData(csvFilePath, dbModule = null) {
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
        
        // 如果提供了數據庫模塊，使用它的連接池
        let client;
        
        if (dbModule && dbModule.pool) {
            // 使用現有的數據庫連接
            client = await dbModule.pool.connect();
        } else {
            // 初始化並連接數據庫
            const dbPool = initPool();
            client = await dbPool.connect();
        }
        
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
            
            // 保存成功導入的日期列表，用於後續計算準確度
            const importedDates = data.map(r => r.date);
            
            return { success: true, count: successCount, errors: errorCount, importedDates };
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
            // 不關閉 pool，因為可能被其他地方使用
        }
    } catch (error) {
        console.error('❌ 導入 CSV 數據失敗:', error);
        return { success: false, count: 0, error: error.message };
    }
}

// 主函數
async function main() {
    const csvFilePath = process.argv[2];
    
    if (!csvFilePath) {
        console.error('❌ 請提供 CSV 文件路徑');
        console.log('使用方法: node import-csv-data.js <csv-file-path>');
        process.exit(1);
    }
    
    if (!fs.existsSync(csvFilePath)) {
        console.error(`❌ 文件不存在: ${csvFilePath}`);
        process.exit(1);
    }
    
    const result = await importCSVData(csvFilePath);
    
    if (result.success) {
        console.log(`\n✅ 導入完成！成功導入 ${result.count} 筆數據`);
        process.exit(0);
    } else {
        console.error(`\n❌ 導入失敗: ${result.error}`);
        process.exit(1);
    }
}

// 如果直接運行此腳本
if (require.main === module) {
    main().catch(err => {
        console.error('❌ 執行失敗:', err);
        process.exit(1);
    });
}

module.exports = { importCSVData, parseCSV };



