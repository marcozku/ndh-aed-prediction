/**
 * 運行模型性能指標遷移腳本
 * 創建 model_metrics 表並插入 v3.2.01 正確數據
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// 數據庫配置 - Railway 生產環境
const pool = new Pool({
    host: 'tramway.proxy.rlwy.net',
    port: 45703,
    database: 'railway',
    user: 'postgres',
    password: 'nIdJPREHqkBdMgUifrazOsVlWbxsmDGq',
    ssl: {
        rejectUnauthorized: false
    }
});

async function runMigration() {
    console.log('🚀 開始運行模型性能指標遷移...\n');

    try {
        // 讀取遷移 SQL
        const migrationPath = path.join(__dirname, 'migrations', '006_model_metrics.sql');
        const sql = fs.readFileSync(migrationPath, 'utf8');

        console.log('📄 讀取遷移文件: migrations/006_model_metrics.sql');
        console.log('📊 執行 SQL...\n');

        // 執行遷移
        await pool.query(sql);

        console.log('✅ 遷移執行成功！\n');

        // 驗證數據
        console.log('🔍 驗證插入的數據...\n');
        const result = await pool.query(`
            SELECT
                model_name,
                version,
                mae,
                rmse,
                mape,
                r2,
                training_date,
                n_features,
                optimization_method
            FROM model_metrics
            WHERE version = 'v3.2.01'
        `);

        if (result.rows.length > 0) {
            const row = result.rows[0];
            console.log('📊 模型性能數據 (v3.2.01):');
            console.log(`   模型名稱: ${row.model_name}`);
            console.log(`   版本: ${row.version}`);
            console.log(`   MAE: ${parseFloat(row.mae).toFixed(2)} 人`);
            console.log(`   RMSE: ${parseFloat(row.rmse).toFixed(2)} 人`);
            console.log(`   MAPE: ${parseFloat(row.mape).toFixed(2)}%`);
            console.log(`   R²: ${(parseFloat(row.r2) * 100).toFixed(2)}%`);
            console.log(`   特徵數: ${row.n_features}`);
            console.log(`   優化方法: ${row.optimization_method}`);
            console.log(`   訓練日期: ${row.training_date}`);
            console.log('\n✅ 數據驗證成功！');
        } else {
            console.log('⚠️ 警告: 未找到 v3.2.01 數據');
        }

        // 測試視圖
        console.log('\n🔍 測試 v_model_performance 視圖...\n');
        const viewResult = await pool.query('SELECT * FROM v_model_performance LIMIT 1');

        if (viewResult.rows.length > 0) {
            console.log('✅ v_model_performance 視圖正常工作');
        } else {
            console.log('⚠️ 警告: v_model_performance 視圖無數據');
        }

    } catch (error) {
        console.error('❌ 遷移失敗:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await pool.end();
    }

    console.log('\n🎉 遷移完成！');
}

// 執行遷移
runMigration();
