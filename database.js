const { Pool } = require('pg');

// Railway PostgreSQL connection
let pool = null;

function initPool() {
    // Try individual environment variables first (Railway sets these)
    const pgHost = process.env.PGHOST;
    const pgUser = process.env.PGUSER || process.env.POSTGRES_USER;
    const pgPassword = process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD;
    const pgDatabase = process.env.PGDATABASE || process.env.POSTGRES_DB;
    const pgPort = process.env.PGPORT || 5432;
    
    // Or try DATABASE_URL
    const dbUrl = process.env.DATABASE_URL;
    
    // Debug: show which variables are set
    console.log('🔍 環境變數檢查:');
    console.log(`   PGHOST: ${pgHost ? '✅ 已設定' : '❌ 未設定'}`);
    console.log(`   PGUSER: ${pgUser ? '✅ 已設定' : '❌ 未設定'}`);
    console.log(`   PGPASSWORD: ${pgPassword ? '✅ 已設定' : '❌ 未設定'}`);
    console.log(`   PGDATABASE: ${pgDatabase ? '✅ 已設定' : '❌ 未設定'}`);
    console.log(`   DATABASE_URL: ${dbUrl ? (dbUrl.includes('${{') ? '⚠️ 包含未解析變數' : '✅ 已設定') : '❌ 未設定'}`);
    
    if (pgHost && pgUser && pgPassword && pgDatabase) {
        console.log('📡 Using individual PG environment variables...');
        const poolConfig = {
            user: pgUser,
            password: pgPassword,
            host: pgHost,
            port: parseInt(pgPort),
            database: pgDatabase,
            // 連接池配置
            max: 20, // 最大連接數
            idleTimeoutMillis: 30000, // 空閒連接超時（30秒）
            connectionTimeoutMillis: 20000 // 連接超時（20秒，增加以應對網絡延遲）
        };

        // Only enable SSL for external connections
        if (!pgHost.includes('.railway.internal')) {
            poolConfig.ssl = { rejectUnauthorized: false };
        }
        
        console.log(`📍 Connecting to ${poolConfig.host}:${poolConfig.port}/${poolConfig.database}`);
        const pool = new Pool(poolConfig);
        
        // 設置連接編碼為 UTF-8
        pool.on('connect', async (client) => {
            try {
                await client.query('SET client_encoding TO \'UTF8\'');
            } catch (err) {
                console.warn('⚠️ 設置數據庫編碼失敗:', err.message);
            }
        });
        
        // 添加連接錯誤處理
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
                // 連接池配置
                max: 20, // 最大連接數
                idleTimeoutMillis: 30000, // 空閒連接超時（30秒）
                connectionTimeoutMillis: 20000 // 連接超時（20秒，增加以應對網絡延遲）
            };

            if (!url.hostname.includes('.railway.internal')) {
                poolConfig.ssl = { rejectUnauthorized: false };
            }
            
            console.log(`📍 Connecting to ${poolConfig.host}:${poolConfig.port}/${poolConfig.database}`);
            const pool = new Pool(poolConfig);
            
            // 設置連接編碼為 UTF-8
            pool.on('connect', async (client) => {
                try {
                    await client.query('SET client_encoding TO \'UTF8\'');
                } catch (err) {
                    console.warn('⚠️ 設置數據庫編碼失敗:', err.message);
                }
            });
            
            // 添加連接錯誤處理
            pool.on('error', (err) => {
                console.error('❌ 數據庫連接池錯誤:', err.message);
            });
            
            return pool;
        } catch (err) {
            console.error('❌ Failed to parse DATABASE_URL:', err.message);
        }
    }
    
    console.log('⚠️ No valid database configuration found');
    console.log('   Set PGHOST, PGUSER, PGPASSWORD, PGDATABASE or DATABASE_URL');
    return null;
}

pool = initPool();

// 帶重試的查詢函數
async function queryWithRetry(query, params = [], maxRetries = 3) {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }
    
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await pool.query(query, params);
            return result;
        } catch (error) {
            lastError = error;
            // 如果是連接錯誤，等待後重試
            if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                if (attempt < maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // 指數退避，最多5秒
                    console.warn(`⚠️ 數據庫連接失敗 (嘗試 ${attempt}/${maxRetries})，${delay}ms 後重試...`, error.message);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
            }
            // 其他錯誤或已達最大重試次數，直接拋出
            throw error;
        }
    }
    throw lastError;
}

// Initialize database tables
async function initDatabase() {
    if (!pool) {
        console.log('⚠️ Database pool not initialized, skipping table creation');
        return;
    }
    
    let client;
    try {
        client = await pool.connect();
    } catch (err) {
        console.error('❌ 數據庫連接失敗:', err.message);
        pool = null; // Reset pool so status shows disconnected
        return;
    }
    try {
        // Table for actual/real patient data (uploaded by user)
        await client.query(`
            CREATE TABLE IF NOT EXISTS actual_data (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL,
                patient_count INTEGER NOT NULL,
                source VARCHAR(100) DEFAULT 'manual_upload',
                notes TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(date)
            )
        `);

        // Table for predictions made by the system
        await client.query(`
            CREATE TABLE IF NOT EXISTS predictions (
                id SERIAL PRIMARY KEY,
                prediction_date DATE NOT NULL,
                target_date DATE NOT NULL,
                predicted_count INTEGER NOT NULL,
                ci80_low INTEGER,
                ci80_high INTEGER,
                ci95_low INTEGER,
                ci95_high INTEGER,
                model_version VARCHAR(50) DEFAULT '1.0.0',
                algorithm_notes TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Table for comparison/accuracy tracking
        await client.query(`
            CREATE TABLE IF NOT EXISTS prediction_accuracy (
                id SERIAL PRIMARY KEY,
                target_date DATE NOT NULL,
                predicted_count INTEGER NOT NULL,
                actual_count INTEGER NOT NULL,
                error INTEGER GENERATED ALWAYS AS (predicted_count - actual_count) STORED,
                error_percentage DECIMAL(5,2),
                within_ci80 BOOLEAN,
                within_ci95 BOOLEAN,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(target_date)
            )
        `);

        // Table for model parameters history
        await client.query(`
            CREATE TABLE IF NOT EXISTS model_parameters (
                id SERIAL PRIMARY KEY,
                version VARCHAR(50) NOT NULL,
                base_value DECIMAL(10,2),
                weekday_factors JSONB,
                holiday_factors JSONB,
                seasonal_factors JSONB,
                notes TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Table for AI factors cache and update tracking
        await client.query(`
            CREATE TABLE IF NOT EXISTS ai_factors_cache (
                id SERIAL PRIMARY KEY,
                last_update_time BIGINT NOT NULL,
                factors_cache JSONB NOT NULL,
                analysis_data JSONB,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(id)
            )
        `);

        // Table for storing each prediction update throughout the day
        await client.query(`
            CREATE TABLE IF NOT EXISTS daily_predictions (
                id SERIAL PRIMARY KEY,
                target_date DATE NOT NULL,
                predicted_count INTEGER NOT NULL,
                ci80_low INTEGER,
                ci80_high INTEGER,
                ci95_low INTEGER,
                ci95_high INTEGER,
                model_version VARCHAR(50) DEFAULT '1.0.0',
                weather_data JSONB,
                ai_factors JSONB,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(target_date)
            )
        `);
        
        // Migration: Add unique constraint if table exists but constraint doesn't
        await client.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint 
                    WHERE conname = 'daily_predictions_target_date_key'
                ) THEN
                    -- 刪除重複的舊記錄，只保留最新的
                    DELETE FROM daily_predictions a
                    USING daily_predictions b
                    WHERE a.id < b.id AND a.target_date = b.target_date;
                    
                    -- 添加唯一約束
                    ALTER TABLE daily_predictions ADD CONSTRAINT daily_predictions_target_date_key UNIQUE (target_date);
                END IF;
            END $$;
        `);
        
        // Create indexes for daily_predictions
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_daily_predictions_target_date ON daily_predictions(target_date)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_daily_predictions_created_at ON daily_predictions(created_at)
        `);

        // Table for final daily averaged predictions (calculated at end of day)
        await client.query(`
            CREATE TABLE IF NOT EXISTS final_daily_predictions (
                id SERIAL PRIMARY KEY,
                target_date DATE NOT NULL,
                predicted_count INTEGER NOT NULL,
                ci80_low INTEGER,
                ci80_high INTEGER,
                ci95_low INTEGER,
                ci95_high INTEGER,
                prediction_count INTEGER NOT NULL,
                model_version VARCHAR(50) DEFAULT '1.0.0',
                smoothing_method VARCHAR(50) DEFAULT 'simpleAverage',
                smoothing_details JSONB,
                stability_cv DECIMAL(6,4),
                stability_level VARCHAR(20),
                calculated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(target_date)
            )
        `);
        
        // Migration: Add missing columns to final_daily_predictions if they don't exist
        await client.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'final_daily_predictions' AND column_name = 'smoothing_method') THEN
                    ALTER TABLE final_daily_predictions ADD COLUMN smoothing_method VARCHAR(50) DEFAULT 'simpleAverage';
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'final_daily_predictions' AND column_name = 'smoothing_details') THEN
                    ALTER TABLE final_daily_predictions ADD COLUMN smoothing_details JSONB;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'final_daily_predictions' AND column_name = 'stability_cv') THEN
                    ALTER TABLE final_daily_predictions ADD COLUMN stability_cv DECIMAL(6,4);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'final_daily_predictions' AND column_name = 'stability_level') THEN
                    ALTER TABLE final_daily_predictions ADD COLUMN stability_level VARCHAR(20);
                END IF;
            END $$;
        `);

        // v2.9.88: Intraday predictions history (tracks all predictions throughout the day)
        await client.query(`
            CREATE TABLE IF NOT EXISTS intraday_predictions (
                id SERIAL PRIMARY KEY,
                target_date DATE NOT NULL,
                predicted_count INTEGER NOT NULL,
                ci80_low INTEGER,
                ci80_high INTEGER,
                ci95_low INTEGER,
                ci95_high INTEGER,
                model_version VARCHAR(50) DEFAULT '1.0.0',
                weather_data JSONB,
                ai_factors JSONB,
                prediction_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Create indexes for intraday_predictions
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_intraday_predictions_target_date ON intraday_predictions(target_date)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_intraday_predictions_time ON intraday_predictions(prediction_time)
        `);

        // Table for time-slot accuracy history (for Time-Window Weighted smoothing)
        await client.query(`
            CREATE TABLE IF NOT EXISTS timeslot_accuracy (
                id SERIAL PRIMARY KEY,
                time_slot VARCHAR(5) NOT NULL,
                target_date DATE NOT NULL,
                predicted_count INTEGER NOT NULL,
                actual_count INTEGER,
                error INTEGER,
                abs_error INTEGER,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(time_slot, target_date)
            )
        `);
        
        // Create index for timeslot_accuracy
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_timeslot_accuracy_time_slot ON timeslot_accuracy(time_slot)
        `);
        
        // Table for smoothing configuration and history
        await client.query(`
            CREATE TABLE IF NOT EXISTS smoothing_config (
                id SERIAL PRIMARY KEY,
                config_name VARCHAR(50) NOT NULL DEFAULT 'default',
                ewma_alpha DECIMAL(4,3) DEFAULT 0.650,
                kalman_process_noise DECIMAL(6,3) DEFAULT 1.000,
                kalman_measurement_noise DECIMAL(6,3) DEFAULT 10.000,
                trim_percent DECIMAL(4,3) DEFAULT 0.100,
                variance_threshold DECIMAL(4,2) DEFAULT 1.50,
                meta_weights JSONB DEFAULT '{"ewma":0.30,"timeWindowWeighted":0.25,"trimmedMean":0.20,"kalman":0.25}',
                is_active BOOLEAN DEFAULT true,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(config_name)
            )
        `);
        
        // Initialize smoothing config if empty
        const smoothingConfigCheck = await client.query('SELECT COUNT(*) FROM smoothing_config');
        if (parseInt(smoothingConfigCheck.rows[0].count) === 0) {
            await client.query(`
                INSERT INTO smoothing_config (config_name, is_active)
                VALUES ('default', true)
            `);
        }

        // Table for XGBoost training status (persists across deploys)
        await client.query(`
            CREATE TABLE IF NOT EXISTS training_status (
                id SERIAL PRIMARY KEY,
                status_key VARCHAR(50) NOT NULL DEFAULT 'xgboost',
                is_training BOOLEAN DEFAULT false,
                last_training_date TIMESTAMP WITH TIME ZONE,
                last_data_count INTEGER DEFAULT 0,
                training_start_time TIMESTAMP WITH TIME ZONE,
                last_training_output TEXT,
                last_training_error TEXT,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(status_key)
            )
        `);

        // v2.9.90: Table for auto predict stats (persists across deploys)
        await client.query(`
            CREATE TABLE IF NOT EXISTS auto_predict_stats (
                id SERIAL PRIMARY KEY,
                stat_date DATE NOT NULL,
                today_count INTEGER DEFAULT 0,
                last_run_time TIMESTAMP WITH TIME ZONE,
                last_run_success BOOLEAN,
                last_run_duration INTEGER,
                total_success_count INTEGER DEFAULT 0,
                total_fail_count INTEGER DEFAULT 0,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(stat_date)
            )
        `);

        // Initialize training_status if empty
        const trainingStatusCheck = await client.query('SELECT COUNT(*) FROM training_status');
        if (parseInt(trainingStatusCheck.rows[0].count) === 0) {
            await client.query(`
                INSERT INTO training_status (status_key, is_training, last_data_count)
                VALUES ('xgboost', false, 0)
            `);
        }

        // Table for model metrics (persists across deploys)
        await client.query(`
            CREATE TABLE IF NOT EXISTS model_metrics (
                id SERIAL PRIMARY KEY,
                model_name VARCHAR(50) NOT NULL DEFAULT 'xgboost',
                mae DECIMAL(10,6),
                rmse DECIMAL(10,6),
                mape DECIMAL(10,6),
                r2 DECIMAL(10,6),
                training_date TIMESTAMP WITH TIME ZONE,
                data_count INTEGER,
                train_count INTEGER,
                test_count INTEGER,
                feature_count INTEGER,
                ai_factors_count INTEGER DEFAULT 0,
                extra_metrics JSONB,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(model_name)
            )
        `);

        // Initialize model_metrics if empty
        const modelMetricsCheck = await client.query('SELECT COUNT(*) FROM model_metrics');
        if (parseInt(modelMetricsCheck.rows[0].count) === 0) {
            await client.query(`
                INSERT INTO model_metrics (model_name, mae, rmse, mape)
                VALUES ('xgboost', NULL, NULL, NULL)
            `);
        }

        // Initialize with default record if empty
        const checkResult = await client.query('SELECT COUNT(*) FROM ai_factors_cache');
        if (parseInt(checkResult.rows[0].count) === 0) {
            await client.query(`
                INSERT INTO ai_factors_cache (id, last_update_time, factors_cache, analysis_data)
                VALUES (1, 0, '{}'::jsonb, '{}'::jsonb)
            `);
        }

        console.log('📊 Database tables initialized successfully');
    } catch (error) {
        console.error('❌ Database initialization error:', error.message);
        pool = null; // Reset pool so status shows disconnected
    } finally {
        if (client) client.release();
    }
}

// Insert actual patient data
async function insertActualData(date, patientCount, source = 'manual_upload', notes = null) {
    const query = `
        INSERT INTO actual_data (date, patient_count, source, notes)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (date) DO UPDATE SET
            patient_count = EXCLUDED.patient_count,
            source = EXCLUDED.source,
            notes = EXCLUDED.notes
        RETURNING *
    `;
    const result = await pool.query(query, [date, patientCount, source, notes]);
    
    // 觸發自動訓練檢查（異步，不阻塞）
    try {
        const { getAutoTrainManager } = require('./modules/auto-train-manager');
        const trainManager = getAutoTrainManager();
        trainManager.triggerTrainingCheck({ pool }).catch(err => {
            console.warn('自動訓練檢查失敗:', err.message);
        });
    } catch (e) {
        // 如果模組不可用，忽略
    }
    
    return result.rows[0];
}

// Insert bulk actual data
async function insertBulkActualData(dataArray) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const results = [];
        for (const data of dataArray) {
            const query = `
                INSERT INTO actual_data (date, patient_count, source, notes)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (date) DO UPDATE SET
                    patient_count = EXCLUDED.patient_count,
                    source = EXCLUDED.source,
                    notes = EXCLUDED.notes
                RETURNING *
            `;
            const result = await client.query(query, [
                data.date,
                data.patient_count,
                data.source || 'bulk_upload',
                data.notes || null
            ]);
            results.push(result.rows[0]);
        }
        await client.query('COMMIT');
        
        // 觸發自動訓練檢查（異步，不阻塞）
        try {
            const { getAutoTrainManager } = require('./modules/auto-train-manager');
            const trainManager = getAutoTrainManager();
            trainManager.triggerTrainingCheck({ pool }).catch(err => {
                console.warn('自動訓練檢查失敗:', err.message);
            });
        } catch (e) {
            // 如果模組不可用，忽略
        }
        
        return results;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// Insert prediction
async function insertPrediction(predictionDate, targetDate, predictedCount, ci80, ci95, modelVersion = '1.0.0') {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }
    const query = `
        INSERT INTO predictions (prediction_date, target_date, predicted_count, ci80_low, ci80_high, ci95_low, ci95_high, model_version)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
    `;
    // 確保所有數值都是整數（四捨五入）
    const toInt = (val) => val != null ? Math.round(val) : null;
    const result = await queryWithRetry(query, [
        predictionDate,
        targetDate,
        toInt(predictedCount),
        toInt(ci80?.low),
        toInt(ci80?.high),
        toInt(ci95?.low),
        toInt(ci95?.high),
        modelVersion
    ]);
    return result.rows[0];
}

// Get all actual data
async function getActualData(startDate = null, endDate = null) {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }
    
    let query = 'SELECT * FROM actual_data';
    const params = [];
    
    if (startDate && endDate) {
        query += ' WHERE date >= $1 AND date <= $2';
        params.push(startDate, endDate);
        console.log(`🔍 數據庫查詢: WHERE date >= '${startDate}' AND date <= '${endDate}'`);
    } else if (startDate) {
        query += ' WHERE date >= $1';
        params.push(startDate);
        console.log(`🔍 數據庫查詢: WHERE date >= '${startDate}'`);
    } else if (endDate) {
        query += ' WHERE date <= $1';
        params.push(endDate);
        console.log(`🔍 數據庫查詢: WHERE date <= '${endDate}'`);
    } else {
        console.log(`⚠️ 數據庫查詢: 沒有日期範圍限制，將返回所有數據`);
    }
    
    query += ' ORDER BY date DESC';
    try {
        const result = await queryWithRetry(query, params);
        console.log(`✅ 數據庫返回 ${result.rows.length} 筆數據`);
        return result.rows;
    } catch (error) {
        console.error('❌ getActualData 查詢失敗:', error);
        throw error;
    }
}

// Get predictions
async function getPredictions(startDate = null, endDate = null) {
    let query = 'SELECT * FROM predictions';
    const params = [];
    
    if (startDate && endDate) {
        query += ' WHERE target_date BETWEEN $1 AND $2';
        params.push(startDate, endDate);
    }
    
    query += ' ORDER BY target_date DESC, created_at DESC';
    const result = await pool.query(query, params);
    return result.rows;
}

// Calculate and store prediction accuracy when actual data becomes available
async function calculateAccuracy(targetDate) {
    const client = await pool.connect();
    try {
        // Get actual data for the date
        const actualResult = await client.query(
            'SELECT patient_count FROM actual_data WHERE date = $1',
            [targetDate]
        );
        
        if (actualResult.rows.length === 0) {
            return null; // No actual data yet
        }
        
        const actualCount = actualResult.rows[0].patient_count;
        
        // Try to get final daily prediction first (preferred)
        let predictionResult = await client.query(
            'SELECT * FROM final_daily_predictions WHERE target_date = $1',
            [targetDate]
        );
        
        // Fallback to most recent daily prediction if no final prediction exists
        if (predictionResult.rows.length === 0) {
            predictionResult = await client.query(
                'SELECT * FROM daily_predictions WHERE target_date = $1 ORDER BY created_at DESC LIMIT 1',
                [targetDate]
            );
        }
        
        // Last fallback to predictions table
        if (predictionResult.rows.length === 0) {
            predictionResult = await client.query(
                'SELECT * FROM predictions WHERE target_date = $1 ORDER BY created_at DESC LIMIT 1',
                [targetDate]
            );
        }
        
        if (predictionResult.rows.length === 0) {
            return null; // No prediction found
        }
        
        const prediction = predictionResult.rows[0];
        const predictedCount = prediction.predicted_count;
        const errorPercentage = ((predictedCount - actualCount) / actualCount * 100).toFixed(2);
        const withinCi80 = actualCount >= prediction.ci80_low && actualCount <= prediction.ci80_high;
        const withinCi95 = actualCount >= prediction.ci95_low && actualCount <= prediction.ci95_high;
        
        // Insert or update accuracy record
        const query = `
            INSERT INTO prediction_accuracy (target_date, predicted_count, actual_count, error_percentage, within_ci80, within_ci95)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (target_date) DO UPDATE SET
                predicted_count = EXCLUDED.predicted_count,
                actual_count = EXCLUDED.actual_count,
                error_percentage = EXCLUDED.error_percentage,
                within_ci80 = EXCLUDED.within_ci80,
                within_ci95 = EXCLUDED.within_ci95
            RETURNING *
        `;
        const result = await client.query(query, [
            targetDate,
            predictedCount,
            actualCount,
            errorPercentage,
            withinCi80,
            withinCi95
        ]);
        
        // 更新時段準確度（用於 Time-Window Weighted 平滑）
        try {
            await updateTimeslotAccuracy(targetDate, actualCount);
        } catch (err) {
            console.warn(`⚠️ 更新時段準確度失敗 (${targetDate}):`, err.message);
        }
        
        return result.rows[0];
    } finally {
        client.release();
    }
}

// Get accuracy statistics
async function getAccuracyStats() {
    const query = `
        SELECT 
            COUNT(*) as total_comparisons,
            AVG(ABS(error_percentage)) as mean_absolute_error_pct,
            AVG(error_percentage) as mean_error_pct,
            STDDEV(error_percentage) as stddev_error_pct,
            SUM(CASE WHEN within_ci80 THEN 1 ELSE 0 END)::FLOAT / COUNT(*) * 100 as ci80_accuracy_pct,
            SUM(CASE WHEN within_ci95 THEN 1 ELSE 0 END)::FLOAT / COUNT(*) * 100 as ci95_accuracy_pct,
            MIN(target_date) as earliest_date,
            MAX(target_date) as latest_date
        FROM prediction_accuracy
    `;
    const result = await pool.query(query);
    return result.rows[0];
}

// Get comparison data for visualization
async function getComparisonData(limit = 100) {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }
    
    // 優先使用 final_daily_predictions（每日平均），然後使用 daily_predictions 的最新預測，最後使用 predictions
    // 改進查詢：使用子查詢來獲取預測數據，確保能找到所有有實際數據的日期
    const query = `
        SELECT 
            a.date::text as date,
            a.patient_count::integer as actual,
            COALESCE(
                fdp.predicted_count,
                (SELECT predicted_count FROM daily_predictions 
                 WHERE target_date = a.date 
                 ORDER BY created_at DESC LIMIT 1),
                p.predicted_count
            )::integer as predicted,
            COALESCE(
                fdp.ci80_low,
                (SELECT ci80_low FROM daily_predictions 
                 WHERE target_date = a.date 
                 ORDER BY created_at DESC LIMIT 1),
                p.ci80_low
            )::integer as ci80_low,
            COALESCE(
                fdp.ci80_high,
                (SELECT ci80_high FROM daily_predictions 
                 WHERE target_date = a.date 
                 ORDER BY created_at DESC LIMIT 1),
                p.ci80_high
            )::integer as ci80_high,
            COALESCE(
                fdp.ci95_low,
                (SELECT ci95_low FROM daily_predictions 
                 WHERE target_date = a.date 
                 ORDER BY created_at DESC LIMIT 1),
                p.ci95_low
            )::integer as ci95_low,
            COALESCE(
                fdp.ci95_high,
                (SELECT ci95_high FROM daily_predictions 
                 WHERE target_date = a.date 
                 ORDER BY created_at DESC LIMIT 1),
                p.ci95_high
            )::integer as ci95_high,
            pa.error::numeric as error,
            pa.error_percentage::numeric as error_percentage
        FROM actual_data a
        LEFT JOIN final_daily_predictions fdp ON a.date = fdp.target_date
        LEFT JOIN predictions p ON a.date = p.target_date
        LEFT JOIN prediction_accuracy pa ON a.date = pa.target_date
        WHERE 
            -- 確保至少有一個預測數據來源（使用子查詢檢查 daily_predictions）
            (
                fdp.predicted_count IS NOT NULL
                OR EXISTS (
                    SELECT 1 FROM daily_predictions dp
                    WHERE dp.target_date = a.date
                    AND dp.predicted_count IS NOT NULL
                )
                OR p.predicted_count IS NOT NULL
            )
            -- 確保預測值不為空（COALESCE 可能返回 NULL）
            AND COALESCE(
                fdp.predicted_count,
                (SELECT predicted_count FROM daily_predictions 
                 WHERE target_date = a.date 
                 ORDER BY created_at DESC LIMIT 1),
                p.predicted_count
            ) IS NOT NULL
        ORDER BY a.date DESC
        LIMIT $1
    `;
    
    try {
        const result = await queryWithRetry(query, [limit]);
        console.log(`📊 比較數據查詢: 找到 ${result.rows.length} 筆有效數據`);
        
        // 調試：檢查第一筆數據的結構
        if (result.rows.length > 0) {
            const firstRow = result.rows[0];
            console.log('🔍 數據庫返回的第一筆數據:', {
                date: firstRow.date,
                dateType: typeof firstRow.date,
                actual: firstRow.actual,
                actualType: typeof firstRow.actual,
                allKeys: Object.keys(firstRow)
            });
        }
        
        return result.rows;
    } catch (error) {
        console.error('❌ 查詢比較數據失敗:', error);
        throw error;
    }
}

// Get AI factors cache
async function getAIFactorsCache() {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }
    
    const query = `
        SELECT last_update_time, factors_cache, analysis_data, updated_at
        FROM ai_factors_cache
        WHERE id = 1
    `;
    try {
        const result = await queryWithRetry(query);
        if (result.rows.length === 0) {
            return {
                last_update_time: 0,
                factors_cache: {},
                analysis_data: {},
                updated_at: null
            };
        }
        return {
            last_update_time: parseInt(result.rows[0].last_update_time) || 0,
            factors_cache: result.rows[0].factors_cache || {},
            analysis_data: result.rows[0].analysis_data || {},
            updated_at: result.rows[0].updated_at
        };
    } catch (error) {
        console.error('❌ getAIFactorsCache 查詢失敗:', error);
        throw error;
    }
}

// Update AI factors cache
async function updateAIFactorsCache(updateTime, factorsCache, analysisData = null) {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }
    const query = `
        UPDATE ai_factors_cache
        SET last_update_time = $1,
            factors_cache = $2,
            analysis_data = COALESCE($3, analysis_data),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
        RETURNING *
    `;
    const result = await queryWithRetry(query, [
        updateTime.toString(),
        JSON.stringify(factorsCache),
        analysisData ? JSON.stringify(analysisData) : null
    ]);
    return result.rows[0];
}

// Insert or update daily prediction (UPSERT - each update throughout the day replaces old prediction)
// v2.9.88: Also inserts into intraday_predictions for history tracking
async function insertDailyPrediction(targetDate, predictedCount, ci80, ci95, modelVersion = '1.0.0', weatherData = null, aiFactors = null) {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }
    const query = `
        INSERT INTO daily_predictions (target_date, predicted_count, ci80_low, ci80_high, ci95_low, ci95_high, model_version, weather_data, ai_factors)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (target_date) DO UPDATE SET
            predicted_count = EXCLUDED.predicted_count,
            ci80_low = EXCLUDED.ci80_low,
            ci80_high = EXCLUDED.ci80_high,
            ci95_low = EXCLUDED.ci95_low,
            ci95_high = EXCLUDED.ci95_high,
            model_version = EXCLUDED.model_version,
            weather_data = EXCLUDED.weather_data,
            ai_factors = EXCLUDED.ai_factors,
            created_at = CURRENT_TIMESTAMP
        RETURNING *
    `;
    // 確保所有數值都是整數（四捨五入）
    const toInt = (val) => val != null ? Math.round(val) : null;
    const result = await queryWithRetry(query, [
        targetDate,
        toInt(predictedCount),
        toInt(ci80?.low),
        toInt(ci80?.high),
        toInt(ci95?.low),
        toInt(ci95?.high),
        modelVersion,
        weatherData ? JSON.stringify(weatherData) : null,
        aiFactors ? JSON.stringify(aiFactors) : null
    ]);
    
    // v2.9.88: Also insert into intraday_predictions for history tracking
    // v3.0.14: Only insert for TODAY (not future dates) to track prediction volatility
    try {
        // 獲取今天的日期（HKT）
        const now = new Date();
        const hkOffset = 8 * 60 * 60 * 1000;
        const hkNow = new Date(now.getTime() + hkOffset);
        const todayStr = hkNow.toISOString().split('T')[0];
        
        // 只為今天插入 intraday 記錄
        if (targetDate === todayStr) {
            await insertIntradayPrediction(targetDate, predictedCount, ci80, ci95, modelVersion, weatherData, aiFactors);
            console.log(`📊 已記錄今日 intraday 預測: ${targetDate} = ${Math.round(predictedCount)} 人`);
        }
    } catch (err) {
        console.warn('⚠️ 無法保存 intraday 預測記錄:', err.message);
    }
    
    return result.rows[0];
}

// v2.9.88: Insert intraday prediction (NO UNIQUE - keeps all predictions throughout the day)
async function insertIntradayPrediction(targetDate, predictedCount, ci80, ci95, modelVersion = '1.0.0', weatherData = null, aiFactors = null) {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }
    const query = `
        INSERT INTO intraday_predictions (target_date, predicted_count, ci80_low, ci80_high, ci95_low, ci95_high, model_version, weather_data, ai_factors, prediction_time)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
        RETURNING *
    `;
    const toInt = (val) => val != null ? Math.round(val) : null;
    const result = await queryWithRetry(query, [
        targetDate,
        toInt(predictedCount),
        toInt(ci80?.low),
        toInt(ci80?.high),
        toInt(ci95?.low),
        toInt(ci95?.high),
        modelVersion,
        weatherData ? JSON.stringify(weatherData) : null,
        aiFactors ? JSON.stringify(aiFactors) : null
    ]);
    return result.rows[0];
}

// v2.9.88: Get all intraday predictions for a date
async function getIntradayPredictions(targetDate) {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }
    const query = `
        SELECT 
            id,
            target_date,
            predicted_count,
            ci80_low,
            ci80_high,
            ci95_low,
            ci95_high,
            model_version,
            prediction_time
        FROM intraday_predictions
        WHERE target_date = $1
        ORDER BY prediction_time ASC
    `;
    const result = await queryWithRetry(query, [targetDate]);
    return result.rows;
}

// v2.9.88: Get intraday predictions for multiple dates (for chart)
async function getIntradayPredictionsRange(startDate, endDate) {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }
    const query = `
        SELECT 
            ip.id,
            ip.target_date,
            ip.predicted_count,
            ip.ci80_low,
            ip.ci80_high,
            ip.prediction_time,
            fdp.predicted_count as final_predicted,
            a.patient_count as actual
        FROM intraday_predictions ip
        LEFT JOIN final_daily_predictions fdp ON ip.target_date = fdp.target_date
        LEFT JOIN actual_data a ON ip.target_date = a.date
        WHERE ip.target_date >= $1 AND ip.target_date <= $2
        ORDER BY ip.target_date, ip.prediction_time ASC
    `;
    const result = await queryWithRetry(query, [startDate, endDate]);
    return result.rows;
}

// Calculate and save final daily prediction using smoothing methods
async function calculateFinalDailyPrediction(targetDate, options = {}) {
    const { getPredictionSmoother } = require('./modules/prediction-smoother');
    const client = await pool.connect();
    
    try {
        // Get all predictions for the target date with timestamps
        const predictionsResult = await client.query(`
            SELECT 
                predicted_count,
                ci80_low,
                ci80_high,
                ci95_low,
                ci95_high,
                model_version,
                created_at
            FROM daily_predictions
            WHERE target_date = $1
            ORDER BY created_at
        `, [targetDate]);

        if (predictionsResult.rows.length === 0) {
            console.log(`⚠️ 沒有找到 ${targetDate} 的預測數據`);
            return null;
        }

        const predictions = predictionsResult.rows;
        const count = predictions.length;

        // Get historical time-slot accuracy for weighted smoothing
        let historicalAccuracyByTimeSlot = null;
        try {
            const accuracyResult = await client.query(`
                SELECT 
                    time_slot,
                    AVG(abs_error) as mae,
                    COUNT(*) as count
                FROM timeslot_accuracy
                WHERE actual_count IS NOT NULL
                GROUP BY time_slot
            `);
            if (accuracyResult.rows.length > 0) {
                historicalAccuracyByTimeSlot = {};
                for (const row of accuracyResult.rows) {
                    historicalAccuracyByTimeSlot[row.time_slot] = {
                        mae: parseFloat(row.mae) || 10,
                        count: parseInt(row.count) || 1
                    };
                }
            }
        } catch (err) {
            console.warn('⚠️ 無法獲取時段準確度歷史:', err.message);
        }

        // Get smoothing config
        let smootherOptions = {};
        try {
            const configResult = await client.query(`
                SELECT * FROM smoothing_config WHERE is_active = true LIMIT 1
            `);
            if (configResult.rows.length > 0) {
                const config = configResult.rows[0];
                smootherOptions = {
                    ewmaAlpha: parseFloat(config.ewma_alpha) || 0.65,
                    kalmanProcessNoise: parseFloat(config.kalman_process_noise) || 1.0,
                    kalmanMeasurementNoise: parseFloat(config.kalman_measurement_noise) || 10.0,
                    trimPercent: parseFloat(config.trim_percent) || 0.10,
                    varianceThreshold: parseFloat(config.variance_threshold) || 1.5,
                    metaWeights: config.meta_weights || { ewma: 0.30, timeWindowWeighted: 0.25, trimmedMean: 0.20, kalman: 0.25 }
                };
            }
        } catch (err) {
            console.warn('⚠️ 無法獲取平滑配置，使用默認值:', err.message);
        }

        // Add historical accuracy data to smoother options
        if (historicalAccuracyByTimeSlot) {
            smootherOptions.historicalAccuracyByTimeSlot = historicalAccuracyByTimeSlot;
        }

        // Initialize smoother and run all methods
        const smoother = getPredictionSmoother(smootherOptions);
        const smoothedResults = smoother.smoothAll(predictions);
        
        // Get recommended prediction
        const recommended = smoother.getRecommendedPrediction(smoothedResults);
        
        // Determine which method to use
        const method = options.method || recommended.method;
        let finalPrediction;
        let smoothingMethod = method;
        
        switch (method) {
            case 'simpleAverage':
                finalPrediction = smoothedResults.simpleAverage.value;
                break;
            case 'ewma':
                finalPrediction = smoothedResults.ewma.value;
                break;
            case 'confidenceWeighted':
                finalPrediction = smoothedResults.confidenceWeighted.value;
                break;
            case 'timeWindowWeighted':
                finalPrediction = smoothedResults.timeWindowWeighted.value;
                break;
            case 'trimmedMean':
                finalPrediction = smoothedResults.trimmedMean.value;
                break;
            case 'varianceFiltered':
                finalPrediction = smoothedResults.varianceFiltered.value;
                break;
            case 'kalman':
                finalPrediction = smoothedResults.kalman.value;
                break;
            case 'ensembleMeta':
            default:
                finalPrediction = smoothedResults.ensembleMeta.value;
                smoothingMethod = 'ensembleMeta';
                break;
        }

        // Get smoothed CI
        const smoothedCI = smoothedResults.smoothedCI;
        const stability = smoothedResults.stability;

        // Get most recent model version
        const latestModelVersion = predictions[predictions.length - 1].model_version;

        // Prepare smoothing details for storage
        const smoothingDetails = {
            allMethods: {
                simpleAverage: smoothedResults.simpleAverage.value,
                ewma: smoothedResults.ewma.value,
                confidenceWeighted: smoothedResults.confidenceWeighted.value,
                timeWindowWeighted: smoothedResults.timeWindowWeighted.value,
                trimmedMean: smoothedResults.trimmedMean.value,
                varianceFiltered: smoothedResults.varianceFiltered.value,
                kalman: smoothedResults.kalman.value,
                ensembleMeta: smoothedResults.ensembleMeta.value
            },
            recommended: recommended,
            rawStats: smoothedResults.rawStats,
            smootherConfig: smoother.getConfig()
        };

        // Insert or update final prediction
        const query = `
            INSERT INTO final_daily_predictions (
                target_date, predicted_count, ci80_low, ci80_high, ci95_low, ci95_high,
                prediction_count, model_version, smoothing_method, smoothing_details,
                stability_cv, stability_level
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (target_date) DO UPDATE SET
                predicted_count = EXCLUDED.predicted_count,
                ci80_low = EXCLUDED.ci80_low,
                ci80_high = EXCLUDED.ci80_high,
                ci95_low = EXCLUDED.ci95_low,
                ci95_high = EXCLUDED.ci95_high,
                prediction_count = EXCLUDED.prediction_count,
                model_version = EXCLUDED.model_version,
                smoothing_method = EXCLUDED.smoothing_method,
                smoothing_details = EXCLUDED.smoothing_details,
                stability_cv = EXCLUDED.stability_cv,
                stability_level = EXCLUDED.stability_level,
                calculated_at = CURRENT_TIMESTAMP
            RETURNING *
        `;
        // 確保所有數值都是整數（四捨五入）
        const toInt = (val) => val != null ? Math.round(val) : null;
        const result = await client.query(query, [
            targetDate,
            toInt(finalPrediction),
            toInt(smoothedCI.ci80.low),
            toInt(smoothedCI.ci80.high),
            toInt(smoothedCI.ci95.low),
            toInt(smoothedCI.ci95.high),
            count,
            latestModelVersion,
            smoothingMethod,
            JSON.stringify(smoothingDetails),
            stability.cv,
            stability.confidenceLevel
        ]);

        console.log(`✅ 已計算並保存 ${targetDate} 的最終預測（${count}次預測，方法: ${smoothingMethod}，CV: ${(stability.cv * 100).toFixed(2)}%）`);
        
        // Return result with all smoothing details
        return {
            ...result.rows[0],
            smoothingResults: smoothedResults,
            recommendedMethod: recommended
        };
    } finally {
        client.release();
    }
}

// Get daily predictions for a target date (all intraday predictions for smoothing)
// v3.0.21: 修復 - 使用 intraday_predictions 而非 daily_predictions
async function getDailyPredictions(targetDate) {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }
    // 從 intraday_predictions 獲取所有當日預測記錄（用於平滑計算）
    const query = `
        SELECT 
            id,
            target_date,
            predicted_count,
            ci80_low,
            ci80_high,
            ci95_low,
            ci95_high,
            prediction_time as created_at,
            confidence_score
        FROM intraday_predictions
        WHERE target_date = $1
        ORDER BY prediction_time
    `;
    const result = await queryWithRetry(query, [targetDate]);
    return result.rows;
}

// Update time-slot accuracy after actual data is known
async function updateTimeslotAccuracy(targetDate, actualCount) {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }
    
    const client = await pool.connect();
    try {
        // Get all predictions for the target date with their time slots
        const predictions = await client.query(`
            SELECT 
                predicted_count,
                TO_CHAR(created_at AT TIME ZONE 'Asia/Hong_Kong', 'HH24:') || 
                CASE WHEN EXTRACT(MINUTE FROM created_at AT TIME ZONE 'Asia/Hong_Kong') < 30 
                     THEN '00' ELSE '30' END as time_slot
            FROM daily_predictions
            WHERE target_date = $1
        `, [targetDate]);

        let updatedCount = 0;
        for (const pred of predictions.rows) {
            const error = pred.predicted_count - actualCount;
            const absError = Math.abs(error);
            
            await client.query(`
                INSERT INTO timeslot_accuracy (time_slot, target_date, predicted_count, actual_count, error, abs_error)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (time_slot, target_date) DO UPDATE SET
                    actual_count = EXCLUDED.actual_count,
                    error = EXCLUDED.error,
                    abs_error = EXCLUDED.abs_error
            `, [pred.time_slot, targetDate, pred.predicted_count, actualCount, error, absError]);
            updatedCount++;
        }
        
        console.log(`📊 已更新 ${updatedCount} 筆時段準確度記錄（${targetDate}）`);
        return updatedCount;
    } finally {
        client.release();
    }
}

// Get time-slot accuracy statistics
async function getTimeslotAccuracyStats() {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }
    
    const query = `
        SELECT 
            time_slot,
            COUNT(*) as prediction_count,
            AVG(abs_error) as mae,
            AVG(error) as me,
            STDDEV(error) as stddev_error,
            MIN(abs_error) as min_error,
            MAX(abs_error) as max_error
        FROM timeslot_accuracy
        WHERE actual_count IS NOT NULL
        GROUP BY time_slot
        ORDER BY time_slot
    `;
    const result = await queryWithRetry(query);
    return result.rows;
}

// Get or update smoothing config
async function getSmoothingConfig() {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }
    
    const query = `SELECT * FROM smoothing_config WHERE is_active = true LIMIT 1`;
    const result = await queryWithRetry(query);
    return result.rows[0] || null;
}

async function updateSmoothingConfig(config) {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }
    
    const query = `
        UPDATE smoothing_config
        SET ewma_alpha = COALESCE($1, ewma_alpha),
            kalman_process_noise = COALESCE($2, kalman_process_noise),
            kalman_measurement_noise = COALESCE($3, kalman_measurement_noise),
            trim_percent = COALESCE($4, trim_percent),
            variance_threshold = COALESCE($5, variance_threshold),
            meta_weights = COALESCE($6, meta_weights),
            updated_at = CURRENT_TIMESTAMP
        WHERE is_active = true
        RETURNING *
    `;
    const result = await queryWithRetry(query, [
        config.ewmaAlpha,
        config.kalmanProcessNoise,
        config.kalmanMeasurementNoise,
        config.trimPercent,
        config.varianceThreshold,
        config.metaWeights ? JSON.stringify(config.metaWeights) : null
    ]);
    return result.rows[0];
}

// Get final daily predictions
async function getFinalDailyPredictions(startDate = null, endDate = null) {
    let query = 'SELECT * FROM final_daily_predictions';
    const params = [];
    
    if (startDate && endDate) {
        query += ' WHERE target_date BETWEEN $1 AND $2';
        params.push(startDate, endDate);
    } else if (startDate) {
        query += ' WHERE target_date >= $1';
        params.push(startDate);
    } else if (endDate) {
        query += ' WHERE target_date <= $1';
        params.push(endDate);
    }
    
    query += ' ORDER BY target_date DESC';
    const result = await pool.query(query, params);
    return result.rows;
}

// Clear all data from tables (for reimport)
async function clearAllData() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 按順序清除（考慮外鍵約束）
        await client.query('TRUNCATE TABLE prediction_accuracy CASCADE');
        await client.query('TRUNCATE TABLE final_daily_predictions CASCADE');
        await client.query('TRUNCATE TABLE daily_predictions CASCADE');
        await client.query('TRUNCATE TABLE predictions CASCADE');
        await client.query('TRUNCATE TABLE actual_data CASCADE');
        
        // 保留 ai_factors_cache（不需要清除）
        
        await client.query('COMMIT');
        return { success: true, message: '所有數據已清除' };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// Get model metrics from database
async function getModelMetrics(modelName = 'xgboost') {
    if (!pool) return null;
    try {
        const result = await pool.query(
            'SELECT * FROM model_metrics WHERE model_name = $1',
            [modelName]
        );
        if (result.rows.length > 0) {
            return result.rows[0];
        }
        return null;
    } catch (error) {
        console.error('❌ 獲取模型指標失敗:', error.message);
        return null;
    }
}

// Save model metrics to database
async function saveModelMetrics(modelName = 'xgboost', metrics) {
    if (!pool) return null;
    try {
        const result = await pool.query(
            `INSERT INTO model_metrics 
             (model_name, mae, rmse, mape, r2, training_date, data_count, 
              train_count, test_count, feature_count, ai_factors_count, extra_metrics, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
             ON CONFLICT (model_name) DO UPDATE SET
                mae = EXCLUDED.mae,
                rmse = EXCLUDED.rmse,
                mape = EXCLUDED.mape,
                r2 = COALESCE(EXCLUDED.r2, model_metrics.r2),
                training_date = EXCLUDED.training_date,
                data_count = COALESCE(EXCLUDED.data_count, model_metrics.data_count),
                train_count = COALESCE(EXCLUDED.train_count, model_metrics.train_count),
                test_count = COALESCE(EXCLUDED.test_count, model_metrics.test_count),
                feature_count = COALESCE(EXCLUDED.feature_count, model_metrics.feature_count),
                ai_factors_count = COALESCE(EXCLUDED.ai_factors_count, model_metrics.ai_factors_count),
                extra_metrics = COALESCE(EXCLUDED.extra_metrics, model_metrics.extra_metrics),
                updated_at = NOW()
             RETURNING *`,
            [
                modelName,
                metrics.mae || null,
                metrics.rmse || null,
                metrics.mape || null,
                metrics.r2 || null,
                metrics.training_date || new Date().toISOString(),
                metrics.data_count || null,
                metrics.train_count || null,
                metrics.test_count || null,
                metrics.feature_count || null,
                metrics.ai_factors_count || 0,
                metrics.extra_metrics ? JSON.stringify(metrics.extra_metrics) : null
            ]
        );
        console.log('✅ 模型指標已保存到數據庫:', {
            model: modelName,
            mae: metrics.mae?.toFixed(4),
            mape: metrics.mape?.toFixed(4)
        });
        return result.rows[0];
    } catch (error) {
        console.error('❌ 保存模型指標失敗:', error.message);
        return null;
    }
}

// Get training status from database
async function getTrainingStatus(statusKey = 'xgboost') {
    if (!pool) return null;
    try {
        const result = await pool.query(
            'SELECT * FROM training_status WHERE status_key = $1',
            [statusKey]
        );
        if (result.rows.length > 0) {
            const row = result.rows[0];
            // 檢查是否訓練超時（1小時）
            if (row.is_training && row.training_start_time) {
                const startTime = new Date(row.training_start_time).getTime();
                const elapsed = Date.now() - startTime;
                const TRAINING_TIMEOUT = 3600000; // 1 hour
                if (elapsed > TRAINING_TIMEOUT) {
                    // 超時了，重置訓練狀態
                    await pool.query(
                        `UPDATE training_status SET 
                            is_training = false, 
                            training_start_time = NULL,
                            updated_at = NOW()
                         WHERE status_key = $1`,
                        [statusKey]
                    );
                    row.is_training = false;
                    row.training_start_time = null;
                    console.log('⚠️ 訓練狀態已超時，自動重置');
                }
            }
            return row;
        }
        return null;
    } catch (error) {
        console.error('❌ 獲取訓練狀態失敗:', error.message);
        return null;
    }
}

// Save training status to database
async function saveTrainingStatus(statusKey = 'xgboost', status) {
    if (!pool) return null;
    try {
        const result = await pool.query(
            `INSERT INTO training_status 
             (status_key, is_training, last_training_date, last_data_count, 
              training_start_time, last_training_output, last_training_error, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             ON CONFLICT (status_key) DO UPDATE SET
                is_training = EXCLUDED.is_training,
                last_training_date = COALESCE(EXCLUDED.last_training_date, training_status.last_training_date),
                last_data_count = COALESCE(EXCLUDED.last_data_count, training_status.last_data_count),
                training_start_time = EXCLUDED.training_start_time,
                last_training_output = COALESCE(EXCLUDED.last_training_output, training_status.last_training_output),
                last_training_error = COALESCE(EXCLUDED.last_training_error, training_status.last_training_error),
                updated_at = NOW()
             RETURNING *`,
            [
                statusKey,
                status.isTraining || false,
                status.lastTrainingDate || null,
                status.lastDataCount || 0,
                status.trainingStartTime || null,
                status.lastTrainingOutput || null,
                status.lastTrainingError || null
            ]
        );
        return result.rows[0];
    } catch (error) {
        console.error('❌ 保存訓練狀態失敗:', error.message);
        return null;
    }
}

// v2.9.90: Get auto predict stats from database
async function getAutoPredictStats(dateStr) {
    if (!pool) return null;
    try {
        const result = await pool.query(
            'SELECT * FROM auto_predict_stats WHERE stat_date = $1',
            [dateStr]
        );
        return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
        console.error('❌ 獲取自動預測統計失敗:', error.message);
        return null;
    }
}

// v2.9.90: Save auto predict stats to database
async function saveAutoPredictStats(dateStr, stats) {
    if (!pool) return null;
    try {
        const result = await pool.query(
            `INSERT INTO auto_predict_stats 
             (stat_date, today_count, last_run_time, last_run_success, last_run_duration, 
              total_success_count, total_fail_count, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             ON CONFLICT (stat_date) DO UPDATE SET
                today_count = EXCLUDED.today_count,
                last_run_time = EXCLUDED.last_run_time,
                last_run_success = EXCLUDED.last_run_success,
                last_run_duration = EXCLUDED.last_run_duration,
                total_success_count = EXCLUDED.total_success_count,
                total_fail_count = EXCLUDED.total_fail_count,
                updated_at = NOW()
             RETURNING *`,
            [
                dateStr,
                stats.todayCount || 0,
                stats.lastRunTime || null,
                stats.lastRunSuccess,
                stats.lastRunDuration || null,
                stats.totalSuccessCount || 0,
                stats.totalFailCount || 0
            ]
        );
        return result.rows[0];
    } catch (error) {
        console.error('❌ 保存自動預測統計失敗:', error.message);
        return null;
    }
}

// v2.9.90: Get cumulative stats (for total counts across all days)
async function getAutoPredictCumulativeStats() {
    if (!pool) return null;
    try {
        const result = await pool.query(`
            SELECT 
                SUM(total_success_count) as total_success,
                SUM(total_fail_count) as total_fail
            FROM auto_predict_stats
        `);
        return result.rows[0];
    } catch (error) {
        console.error('❌ 獲取累計統計失敗:', error.message);
        return null;
    }
}

module.exports = {
    get pool() { return pool; },
    initDatabase,
    insertActualData,
    insertBulkActualData,
    insertPrediction,
    getActualData,
    getPredictions,
    calculateAccuracy,
    getAccuracyStats,
    getComparisonData,
    getAIFactorsCache,
    updateAIFactorsCache,
    insertDailyPrediction,
    calculateFinalDailyPrediction,
    getFinalDailyPredictions,
    clearAllData,
    // 新增：平滑相關函數
    getDailyPredictions,
    updateTimeslotAccuracy,
    getTimeslotAccuracyStats,
    getSmoothingConfig,
    updateSmoothingConfig,
    // 新增：訓練狀態函數
    getTrainingStatus,
    saveTrainingStatus,
    // 新增：模型指標函數
    getModelMetrics,
    saveModelMetrics,
    // v2.9.88: Intraday predictions
    insertIntradayPrediction,
    getIntradayPredictions,
    getIntradayPredictionsRange,
    // v2.9.90: Auto predict stats (persisted)
    getAutoPredictStats,
    saveAutoPredictStats,
    getAutoPredictCumulativeStats
};

