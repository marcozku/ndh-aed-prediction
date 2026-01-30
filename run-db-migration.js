/**
 * 自動運行數據庫遷移腳本
 * 用於 Railway 部署後自動執行 migrations/005_performance_indexes.sql
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    console.log('🚀 開始數據庫遷移...');

    // 檢查環境變數
    const hasDbConfig = process.env.DATABASE_URL ||
                       (process.env.PGHOST && process.env.PGUSER && process.env.PGPASSWORD && process.env.PGDATABASE);

    if (!hasDbConfig) {
        console.error('❌ 數據庫環境變數未設置');
        process.exit(1);
    }

    // 創建連接池
    let pool;
    if (process.env.DATABASE_URL) {
        const url = new URL(process.env.DATABASE_URL);
        pool = new Pool({
            user: url.username,
            password: decodeURIComponent(url.password),
            host: url.hostname,
            port: parseInt(url.port) || 5432,
            database: url.pathname.slice(1),
            ssl: url.hostname.includes('.railway.internal') ? false : { rejectUnauthorized: false }
        });
    } else {
        pool = new Pool({
            user: process.env.PGUSER,
            password: process.env.PGPASSWORD,
            host: process.env.PGHOST,
            port: parseInt(process.env.PGPORT) || 5432,
            database: process.env.PGDATABASE,
            ssl: process.env.PGHOST.includes('.railway.internal') ? false : { rejectUnauthorized: false }
        });
    }

    const client = await pool.connect();

    try {
        // 讀取遷移文件
        const migrationPath = path.join(__dirname, 'migrations', '005_performance_indexes.sql');
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

        console.log('📄 讀取遷移文件: migrations/005_performance_indexes.sql');

        // 執行遷移
        await client.query('BEGIN');
        console.log('🔄 開始執行遷移...');

        await client.query(migrationSQL);

        await client.query('COMMIT');
        console.log('✅ 遷移執行成功！');

        // 驗證索引
        const indexResult = await client.query(`
            SELECT
                tablename,
                indexname
            FROM pg_indexes
            WHERE schemaname = 'public'
            AND indexname LIKE 'idx_%'
            ORDER BY tablename, indexname
        `);

        console.log(`\n📊 已創建 ${indexResult.rows.length} 個索引：`);
        indexResult.rows.forEach(row => {
            console.log(`   - ${row.tablename}.${row.indexname}`);
        });

        // 驗證視圖
        const viewResult = await client.query(`
            SELECT viewname
            FROM pg_views
            WHERE schemaname = 'public'
            AND viewname LIKE 'v_%'
        `);

        console.log(`\n📊 已創建 ${viewResult.rows.length} 個視圖：`);
        viewResult.rows.forEach(row => {
            console.log(`   - ${row.viewname}`);
        });

        console.log('\n🎉 數據庫遷移完成！');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 遷移失敗:', error.message);
        console.error('詳細錯誤:', error.stack);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

// 執行遷移
runMigration().catch(err => {
    console.error('❌ 執行遷移時出錯:', err);
    process.exit(1);
});
