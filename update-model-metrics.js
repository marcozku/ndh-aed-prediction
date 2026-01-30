/**
 * 更新模型性能指標到 v3.2.01
 * 直接更新現有 model_metrics 表的數據
 */

const { Pool } = require('pg');

// Railway 數據庫配置
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

async function updateMetrics() {
    console.log('🚀 開始更新模型性能指標到 v3.2.01...\n');

    try {
        // 1. 添加 version 列（如果不存在）
        console.log('📊 檢查並添加 version 列...');
        await pool.query(`
            ALTER TABLE model_metrics
            ADD COLUMN IF NOT EXISTS version VARCHAR(20);
        `);
        console.log('✅ version 列已就緒\n');

        // 2. 添加其他缺失的列
        console.log('📊 檢查並添加其他必要列...');
        await pool.query(`
            ALTER TABLE model_metrics
            ADD COLUMN IF NOT EXISTS n_features INTEGER,
            ADD COLUMN IF NOT EXISTS features JSONB,
            ADD COLUMN IF NOT EXISTS optimization_method VARCHAR(100),
            ADD COLUMN IF NOT EXISTS hyperparameters JSONB,
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
        `);
        console.log('✅ 表結構已更新\n');

        // 3. 更新現有數據到 v3.2.01
        console.log('📊 更新模型性能數據到 v3.2.01...');
        const result = await pool.query(`
            UPDATE model_metrics
            SET
                version = 'v3.2.01',
                mae = 2.8510,
                rmse = 4.5353,
                mape = 1.1741,
                r2 = 0.971761,
                training_date = '2026-01-18 01:49:04'::TIMESTAMP,
                data_count = 3734,
                train_count = 2987,
                test_count = 747,
                feature_count = 10,
                n_features = 10,
                features = '["Attendance_EWMA7","Daily_Change","Attendance_EWMA14","Weekly_Change","Day_of_Week","Attendance_Lag7","Attendance_Lag1","Is_Weekend","DayOfWeek_sin","DayOfWeek_cos"]'::JSONB,
                optimization_method = 'Optuna (30 trials)',
                hyperparameters = '{"max_depth":9,"learning_rate":0.045,"min_child_weight":6,"subsample":0.67,"colsample_bytree":0.92,"gamma":0.84,"reg_alpha":1.35,"reg_lambda":0.79,"objective":"reg:squarederror","tree_method":"hist","eval_metric":"mae"}'::JSONB,
                updated_at = NOW()
            WHERE model_name = 'xgboost';
        `);

        console.log(`✅ 已更新 ${result.rowCount} 筆記錄\n`);

        // 4. 驗證更新結果
        console.log('🔍 驗證更新結果...\n');
        const verification = await pool.query(`
            SELECT
                model_name,
                version,
                mae,
                rmse,
                mape,
                r2,
                training_date,
                data_count,
                train_count,
                test_count,
                n_features,
                optimization_method
            FROM model_metrics
            WHERE model_name = 'xgboost';
        `);

        if (verification.rows.length > 0) {
            const row = verification.rows[0];
            console.log('📊 更新後的模型性能數據:');
            console.log(`   模型名稱: ${row.model_name}`);
            console.log(`   版本: ${row.version}`);
            console.log(`   MAE: ${parseFloat(row.mae).toFixed(2)} 人`);
            console.log(`   RMSE: ${parseFloat(row.rmse).toFixed(2)} 人`);
            console.log(`   MAPE: ${parseFloat(row.mape).toFixed(2)}%`);
            console.log(`   R²: ${(parseFloat(row.r2) * 100).toFixed(2)}%`);
            console.log(`   訓練集: ${row.train_count} 筆`);
            console.log(`   測試集: ${row.test_count} 筆`);
            console.log(`   特徵數: ${row.n_features}`);
            console.log(`   優化方法: ${row.optimization_method}`);
            console.log(`   訓練日期: ${row.training_date}`);
            console.log('\n✅ 數據驗證成功！');
        }

        // 5. 重新創建視圖
        console.log('\n📊 重新創建 v_model_performance 視圖...');
        await pool.query(`
            DROP VIEW IF EXISTS v_model_performance;

            CREATE VIEW v_model_performance AS
            SELECT
                model_name,
                version,
                mae,
                rmse,
                mape,
                r2,
                training_date,
                data_count,
                n_features,
                optimization_method,
                created_at,
                updated_at
            FROM model_metrics
            ORDER BY updated_at DESC;
        `);
        console.log('✅ 視圖已重新創建\n');

    } catch (error) {
        console.error('❌ 更新失敗:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await pool.end();
    }

    console.log('🎉 更新完成！');
}

// 執行更新
updateMetrics();
