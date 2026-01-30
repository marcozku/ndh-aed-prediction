/**
 * Railway Migration Runner (Node.js版)
 * 運行 004_continuous_learning.sql migration
 *
 * 用法：
 * 1. Railway Console → 新建 → CLI
 * 2. 執行: node run-migration.js
 */

const { Client } = require('pg');

async function runMigration() {
    console.log('🔌 Connecting to Railway database...');

    const client = new Client({
        connectionString: process.env.DATABASE_URL
    });

    try {
        await client.connect();
        console.log('✅ Connected successfully');

        // 讀取 SQL 文件
        const fs = require('fs');
        const sql = fs.readFileSync('./migrations/004_continuous_learning.sql', 'utf8');

        console.log('🔧 Running migration 004_continuous_learning.sql...');

        // 執行 migration
        await client.query(sql);

        // 驗證表
        const tablesResult = await client.query(`
            SELECT tablename FROM pg_tables
            WHERE schemaname = 'public'
            AND (tablename LIKE '%learning%' OR tablename LIKE '%weather%' OR tablename LIKE '%anomaly%')
            ORDER BY tablename
        `);

        console.log(`\n✅ Migration complete! ${tablesResult.rows.length} tables created:`);
        tablesResult.rows.forEach(t => console.log(`   - ${t.tablename}`));

        // 檢查視圖
        const viewsResult = await client.query(`
            SELECT viewname FROM pg_views
            WHERE schemaname = 'public'
            AND (viewname LIKE '%learning%' OR viewname LIKE '%anomaly%' OR viewname LIKE '%weather%')
            ORDER BY viewname
        `);

        if (viewsResult.rows.length > 0) {
            console.log(`\n📊 ${viewsResult.rows.length} views created:`);
            viewsResult.rows.forEach(v => console.log(`   - ${v.viewname}`));
        }

        // 驗證默認參數
        const paramsResult = await client.query('SELECT COUNT(*) FROM weather_impact_parameters');
        console.log(`\n📊 Default parameters: ${paramsResult.rows[0].count} records`);

        console.log('\n🎉 v4.0.00 Continuous Learning System is ready!');

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        throw error;
    } finally {
        await client.end();
    }
}

runMigration().catch(console.error);
