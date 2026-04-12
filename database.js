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
        
        // v3.0.86: Add dual-track columns for production/experimental predictions
        await client.query(`ALTER TABLE daily_predictions ADD COLUMN IF NOT EXISTS prediction_production DECIMAL(10,2)`);
        await client.query(`ALTER TABLE daily_predictions ADD COLUMN IF NOT EXISTS prediction_experimental DECIMAL(10,2)`);
        await client.query(`ALTER TABLE daily_predictions ADD COLUMN IF NOT EXISTS xgboost_base DECIMAL(10,2)`);
        await client.query(`ALTER TABLE daily_predictions ADD COLUMN IF NOT EXISTS ai_factor DECIMAL(5,3)`);
        await client.query(`ALTER TABLE daily_predictions ADD COLUMN IF NOT EXISTS weather_factor DECIMAL(5,3)`);
        console.log('✅ Dual-track columns added to daily_predictions');
        
        // v3.0.87: Reliability learning tables
        await client.query(`
            CREATE TABLE IF NOT EXISTS reliability_state (
                id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
                xgboost_reliability NUMERIC(5,4) DEFAULT 0.95,
                ai_reliability NUMERIC(5,4) DEFAULT 0.00,
                weather_reliability NUMERIC(5,4) DEFAULT 0.05,
                learning_rate NUMERIC(5,4) DEFAULT 0.10,
                base_std NUMERIC(10,2) DEFAULT 15.00,
                total_samples INTEGER DEFAULT 0,
                last_updated TIMESTAMP DEFAULT NOW()
            )
        `);
        await client.query(`
            INSERT INTO reliability_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS reliability_history (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL,
                actual_attendance INTEGER NOT NULL,
                xgboost_prediction NUMERIC(10,2),
                ai_prediction NUMERIC(10,2),
                weather_prediction NUMERIC(10,2),
                xgboost_error NUMERIC(10,2),
                ai_error NUMERIC(10,2),
                weather_error NUMERIC(10,2),
                xgboost_reliability NUMERIC(5,4),
                ai_reliability NUMERIC(5,4),
                weather_reliability NUMERIC(5,4),
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(date)
            )
        `);
        console.log('✅ Reliability tables initialized');

        // v4.0.28: Per-model prediction comparison table
        await client.query(`
            CREATE TABLE IF NOT EXISTS model_prediction_runs (
                id SERIAL PRIMARY KEY,
                prediction_date DATE NOT NULL DEFAULT CURRENT_DATE,
                target_date DATE NOT NULL,
                horizon_days INTEGER DEFAULT 0,
                model_name VARCHAR(50) NOT NULL,
                model_version VARCHAR(50),
                predicted_count NUMERIC(10,2) NOT NULL,
                actual_count NUMERIC(10,2),
                abs_error NUMERIC(10,2),
                mape NUMERIC(10,4),
                prompt_version VARCHAR(50),
                input_snapshot JSONB,
                metadata JSONB,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(target_date, model_name)
            )
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_model_prediction_runs_target_date
            ON model_prediction_runs(target_date DESC)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_model_prediction_runs_model_name
            ON model_prediction_runs(model_name, target_date DESC)
        `);
        console.log('✅ Model comparison table initialized');

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
        
        // v3.0.65: Add source column to distinguish auto vs manual predictions
        await client.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'intraday_predictions' AND column_name = 'source') THEN
                    ALTER TABLE intraday_predictions ADD COLUMN source VARCHAR(20) DEFAULT 'auto';
                END IF;
            END $$;
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

        try {
            await client.query(`
                UPDATE model_prediction_runs
                SET
                    actual_count = $2,
                    abs_error = ABS(predicted_count - $2),
                    mape = CASE
                        WHEN $2 IS NULL OR $2 = 0 THEN NULL
                        ELSE ABS(predicted_count - $2) / $2 * 100
                    END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE target_date = $1
            `, [targetDate, actualCount]);
        } catch (err) {
            console.warn(`⚠️ 同步 model_prediction_runs 實際值失敗 (${targetDate}):`, err.message);
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
            -- v3.0.80: 直接計算 error，不依賴可能過時的 prediction_accuracy 表
            (COALESCE(
                fdp.predicted_count,
                (SELECT predicted_count FROM daily_predictions 
                 WHERE target_date = a.date 
                 ORDER BY created_at DESC LIMIT 1),
                p.predicted_count
            ) - a.patient_count)::numeric as error,
            ROUND(
                ((COALESCE(
                    fdp.predicted_count,
                    (SELECT predicted_count FROM daily_predictions 
                     WHERE target_date = a.date 
                     ORDER BY created_at DESC LIMIT 1),
                    p.predicted_count
                ) - a.patient_count)::numeric / NULLIF(a.patient_count, 0) * 100)::numeric, 
                2
            ) as error_percentage
        FROM actual_data a
        LEFT JOIN final_daily_predictions fdp ON a.date = fdp.target_date
        LEFT JOIN predictions p ON a.date = p.target_date
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
// v3.0.65: 新增 source 參數區分自動預測 vs 手動刷新
// v3.0.86: 新增 dualTrack 參數存儲雙軌預測
async function insertDailyPrediction(targetDate, predictedCount, ci80, ci95, modelVersion = '1.0.0', weatherData = null, aiFactors = null, source = 'auto', dualTrack = null) {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }
    
    // v3.0.86: 如果有雙軌數據，使用擴展查詢
    const query = `
        INSERT INTO daily_predictions (
            target_date, predicted_count, ci80_low, ci80_high, ci95_low, ci95_high, 
            model_version, weather_data, ai_factors,
            prediction_production, prediction_experimental, xgboost_base, ai_factor, weather_factor
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (target_date) DO UPDATE SET
            predicted_count = EXCLUDED.predicted_count,
            ci80_low = EXCLUDED.ci80_low,
            ci80_high = EXCLUDED.ci80_high,
            ci95_low = EXCLUDED.ci95_low,
            ci95_high = EXCLUDED.ci95_high,
            model_version = EXCLUDED.model_version,
            weather_data = EXCLUDED.weather_data,
            ai_factors = EXCLUDED.ai_factors,
            prediction_production = COALESCE(EXCLUDED.prediction_production, daily_predictions.prediction_production),
            prediction_experimental = COALESCE(EXCLUDED.prediction_experimental, daily_predictions.prediction_experimental),
            xgboost_base = COALESCE(EXCLUDED.xgboost_base, daily_predictions.xgboost_base),
            ai_factor = COALESCE(EXCLUDED.ai_factor, daily_predictions.ai_factor),
            weather_factor = COALESCE(EXCLUDED.weather_factor, daily_predictions.weather_factor),
            created_at = CURRENT_TIMESTAMP
        RETURNING *
    `;
    // 確保所有數值都是整數（四捨五入）
    const toInt = (val) => val != null ? Math.round(val) : null;
    const toDecimal = (val) => val != null ? parseFloat(val) : null;
    
    const result = await queryWithRetry(query, [
        targetDate,
        toInt(predictedCount),
        toInt(ci80?.low),
        toInt(ci80?.high),
        toInt(ci95?.low),
        toInt(ci95?.high),
        modelVersion,
        weatherData ? JSON.stringify(weatherData) : null,
        aiFactors ? JSON.stringify(aiFactors) : null,
        toDecimal(dualTrack?.production),
        toDecimal(dualTrack?.experimental),
        toDecimal(dualTrack?.xgboostBase),
        toDecimal(dualTrack?.aiFactor),
        toDecimal(dualTrack?.weatherFactor)
    ]);
    
    // v2.9.88: Also insert into intraday_predictions for history tracking
    // v3.0.14: Only insert for TODAY (not future dates) to track prediction volatility
    // v3.0.66: 恢復記錄未來 7 天的預測，以追蹤預測收斂過程
    try {
        // 獲取今天的日期（HKT）
        const now = new Date();
        const hkOffset = 8 * 60 * 60 * 1000;
        const hkNow = new Date(now.getTime() + hkOffset);
        const todayStr = hkNow.toISOString().split('T')[0];
        
        // 計算目標日期與今天的天數差
        const targetDateObj = new Date(targetDate);
        const todayDateObj = new Date(todayStr);
        const diffDays = Math.round((targetDateObj - todayDateObj) / (24 * 60 * 60 * 1000));
        
        // 記錄未來 7 天的預測（包括今天）
        if (diffDays >= 0 && diffDays <= 7) {
            await insertIntradayPrediction(targetDate, predictedCount, ci80, ci95, modelVersion, weatherData, aiFactors, source);
            const dayLabel = diffDays === 0 ? '今日' : `+${diffDays}天`;
            console.log(`📊 已記錄 intraday 預測 (${source}, ${dayLabel}): ${targetDate} = ${Math.round(predictedCount)} 人`);
        }
    } catch (err) {
        console.warn('⚠️ 無法保存 intraday 預測記錄:', err.message);
    }
    
    return result.rows[0];
}

function normalizeModelPredictionNumber(value) {
    if (value == null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

async function upsertModelPredictionRun({
    predictionDate = null,
    targetDate,
    horizonDays = 0,
    modelName,
    modelVersion = null,
    predictedCount,
    actualCount = null,
    promptVersion = null,
    inputSnapshot = null,
    metadata = null
}) {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }

    if (!targetDate || !modelName) {
        throw new Error('targetDate and modelName are required');
    }

    const normalizedPredicted = normalizeModelPredictionNumber(predictedCount);
    if (normalizedPredicted == null) {
        throw new Error(`Invalid predictedCount for ${modelName} on ${targetDate}`);
    }

    const normalizedActual = normalizeModelPredictionNumber(actualCount);
    const absError = normalizedActual == null ? null : Math.abs(normalizedPredicted - normalizedActual);
    const mape = normalizedActual == null || normalizedActual === 0
        ? null
        : Math.abs(normalizedPredicted - normalizedActual) / normalizedActual * 100;

    const query = `
        INSERT INTO model_prediction_runs (
            prediction_date,
            target_date,
            horizon_days,
            model_name,
            model_version,
            predicted_count,
            actual_count,
            abs_error,
            mape,
            prompt_version,
            input_snapshot,
            metadata
        )
        VALUES (
            COALESCE($1::date, CURRENT_DATE),
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12
        )
        ON CONFLICT (target_date, model_name) DO UPDATE SET
            prediction_date = EXCLUDED.prediction_date,
            horizon_days = EXCLUDED.horizon_days,
            model_version = COALESCE(EXCLUDED.model_version, model_prediction_runs.model_version),
            predicted_count = EXCLUDED.predicted_count,
            actual_count = COALESCE(EXCLUDED.actual_count, model_prediction_runs.actual_count),
            abs_error = COALESCE(EXCLUDED.abs_error,
                CASE
                    WHEN model_prediction_runs.actual_count IS NULL THEN model_prediction_runs.abs_error
                    ELSE ABS(EXCLUDED.predicted_count - model_prediction_runs.actual_count)
                END
            ),
            mape = COALESCE(EXCLUDED.mape,
                CASE
                    WHEN model_prediction_runs.actual_count IS NULL OR model_prediction_runs.actual_count = 0 THEN model_prediction_runs.mape
                    ELSE ABS(EXCLUDED.predicted_count - model_prediction_runs.actual_count) / model_prediction_runs.actual_count * 100
                END
            ),
            prompt_version = COALESCE(EXCLUDED.prompt_version, model_prediction_runs.prompt_version),
            input_snapshot = COALESCE(EXCLUDED.input_snapshot, model_prediction_runs.input_snapshot),
            metadata = COALESCE(EXCLUDED.metadata, model_prediction_runs.metadata),
            updated_at = CURRENT_TIMESTAMP
        RETURNING *
    `;

    const result = await queryWithRetry(query, [
        predictionDate,
        targetDate,
        Math.max(0, Number.parseInt(horizonDays, 10) || 0),
        modelName,
        modelVersion,
        normalizedPredicted,
        normalizedActual,
        absError,
        mape,
        promptVersion,
        inputSnapshot ? JSON.stringify(inputSnapshot) : null,
        metadata ? JSON.stringify(metadata) : null
    ]);

    return result.rows[0];
}

async function syncModelPredictionActuals(targetDate = null) {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }

    const params = [];
    const extraWhere = targetDate ? `AND mpr.target_date = $1` : '';
    if (targetDate) {
        params.push(targetDate);
    }

    const query = `
        UPDATE model_prediction_runs mpr
        SET
            actual_count = ad.patient_count,
            abs_error = ABS(mpr.predicted_count - ad.patient_count),
            mape = CASE
                WHEN ad.patient_count IS NULL OR ad.patient_count = 0 THEN NULL
                ELSE ABS(mpr.predicted_count - ad.patient_count) / ad.patient_count * 100
            END,
            updated_at = CURRENT_TIMESTAMP
        FROM actual_data ad
        WHERE ad.date = mpr.target_date
        ${extraWhere}
        RETURNING mpr.*
    `;

    const result = await queryWithRetry(query, params);
    return result.rows;
}

async function getModelPredictionRuns(startDate = null, endDate = null) {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }

    const params = [];
    const conditions = [];

    if (startDate) {
        params.push(startDate);
        conditions.push(`target_date >= $${params.length}`);
    }

    if (endDate) {
        params.push(endDate);
        conditions.push(`target_date <= $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
        SELECT
            prediction_date,
            target_date,
            horizon_days,
            model_name,
            model_version,
            predicted_count,
            actual_count,
            abs_error,
            mape,
            prompt_version,
            input_snapshot,
            metadata,
            created_at,
            updated_at
        FROM model_prediction_runs
        ${whereClause}
        ORDER BY target_date DESC, model_name ASC
    `;

    const result = await queryWithRetry(query, params);
    return result.rows;
}

async function backfillHistoricalModelPredictionRuns() {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const result = await client.query(`
            SELECT
                dp.target_date::date AS target_date,
                GREATEST((dp.target_date::date - COALESCE(dp.created_at::date, dp.target_date::date)), 0) AS horizon_days,
                dp.model_version,
                COALESCE(dp.xgboost_base, dp.prediction_production, fdp.predicted_count, dp.predicted_count)::numeric AS xgboost_pred,
                COALESCE(dp.prediction_experimental, fdp.predicted_count, dp.predicted_count)::numeric AS xgboost_ai_pred,
                ad.patient_count::numeric AS actual_count
            FROM daily_predictions dp
            LEFT JOIN final_daily_predictions fdp
                ON fdp.target_date = dp.target_date
            LEFT JOIN actual_data ad
                ON ad.date = dp.target_date
            WHERE COALESCE(dp.xgboost_base, dp.prediction_production, fdp.predicted_count, dp.predicted_count) IS NOT NULL
        `);

        let upserted = 0;
        for (const row of result.rows) {
            const payloads = [
                {
                    modelName: 'xgboost',
                    predictedCount: row.xgboost_pred
                },
                {
                    modelName: 'xgboost_ai',
                    predictedCount: row.xgboost_ai_pred
                }
            ];

            for (const payload of payloads) {
                const normalizedPredicted = normalizeModelPredictionNumber(payload.predictedCount);
                if (normalizedPredicted == null) {
                    continue;
                }

                const normalizedActual = normalizeModelPredictionNumber(row.actual_count);
                const absError = normalizedActual == null ? null : Math.abs(normalizedPredicted - normalizedActual);
                const mape = normalizedActual == null || normalizedActual === 0
                    ? null
                    : Math.abs(normalizedPredicted - normalizedActual) / normalizedActual * 100;

                await client.query(`
                    INSERT INTO model_prediction_runs (
                        prediction_date,
                        target_date,
                        horizon_days,
                        model_name,
                        model_version,
                        predicted_count,
                        actual_count,
                        abs_error,
                        mape,
                        metadata
                    )
                    VALUES (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6,
                        $7,
                        $8,
                        $9,
                        $10
                    )
                    ON CONFLICT (target_date, model_name) DO UPDATE SET
                        prediction_date = EXCLUDED.prediction_date,
                        horizon_days = EXCLUDED.horizon_days,
                        model_version = COALESCE(EXCLUDED.model_version, model_prediction_runs.model_version),
                        predicted_count = EXCLUDED.predicted_count,
                        actual_count = COALESCE(EXCLUDED.actual_count, model_prediction_runs.actual_count),
                        abs_error = COALESCE(EXCLUDED.abs_error, model_prediction_runs.abs_error),
                        mape = COALESCE(EXCLUDED.mape, model_prediction_runs.mape),
                        metadata = COALESCE(EXCLUDED.metadata, model_prediction_runs.metadata),
                        updated_at = CURRENT_TIMESTAMP
                `, [
                    row.target_date,
                    row.target_date,
                    Math.max(0, Number.parseInt(row.horizon_days, 10) || 0),
                    payload.modelName,
                    row.model_version || null,
                    normalizedPredicted,
                    normalizedActual,
                    absError,
                    mape,
                    JSON.stringify({ source: 'historical_backfill' })
                ]);
                upserted += 1;
            }
        }

        await client.query('COMMIT');
        return { upserted };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function backfillLearningRecordsAIEventType() {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }

    const query = `
        UPDATE learning_records lr
        SET
            ai_factor = COALESCE(
                lr.ai_factor,
                COALESCE(
                    (dp.ai_factors->>'factor')::numeric,
                    (dp.ai_factors->>'impactFactor')::numeric,
                    dp.ai_factor
                )
            ),
            ai_event_type = COALESCE(
                NULLIF(lr.ai_event_type, ''),
                NULLIF(COALESCE(dp.ai_factors->>'event_type', dp.ai_factors->>'type'), '')
            ),
            ai_description = COALESCE(
                NULLIF(lr.ai_description, ''),
                NULLIF(dp.ai_factors->>'description', '')
            ),
            processed = FALSE
        FROM daily_predictions dp
        WHERE lr.date = dp.target_date
          AND dp.ai_factors IS NOT NULL
          AND (
              lr.ai_event_type IS NULL
              OR lr.ai_event_type = ''
              OR lr.ai_description IS NULL
              OR lr.ai_factor IS NULL
          )
        RETURNING lr.date, lr.ai_event_type
    `;

    const result = await queryWithRetry(query);
    return result.rows;
}

async function rebuildAIEventLearning() {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('TRUNCATE TABLE ai_event_learning RESTART IDENTITY');

        const result = await client.query(`
            INSERT INTO ai_event_learning (
                event_type,
                event_pattern,
                total_occurrences,
                avg_ai_factor,
                avg_actual_impact,
                avg_actual_impact_pct,
                correct_predictions,
                prediction_accuracy,
                confidence_level,
                last_occurrence,
                last_updated
            )
            SELECT
                lr.ai_event_type AS event_type,
                lr.ai_event_type AS event_pattern,
                COUNT(*) AS total_occurrences,
                AVG(lr.ai_factor) AS avg_ai_factor,
                AVG(lr.prediction_error) AS avg_actual_impact,
                AVG(
                    CASE
                        WHEN lr.actual_attendance IS NULL OR lr.actual_attendance = 0 THEN NULL
                        ELSE lr.prediction_error / lr.actual_attendance * 100
                    END
                ) AS avg_actual_impact_pct,
                SUM(
                    CASE
                        WHEN (lr.ai_factor < 1 AND lr.prediction_error < 0)
                          OR (lr.ai_factor > 1 AND lr.prediction_error > 0)
                          OR (ABS(COALESCE(lr.ai_factor, 1) - 1) < 0.01 AND ABS(COALESCE(lr.prediction_error, 0)) < 5)
                        THEN 1 ELSE 0
                    END
                ) AS correct_predictions,
                AVG(
                    CASE
                        WHEN (lr.ai_factor < 1 AND lr.prediction_error < 0)
                          OR (lr.ai_factor > 1 AND lr.prediction_error > 0)
                          OR (ABS(COALESCE(lr.ai_factor, 1) - 1) < 0.01 AND ABS(COALESCE(lr.prediction_error, 0)) < 5)
                        THEN 1.0 ELSE 0.0
                    END
                ) AS prediction_accuracy,
                CASE
                    WHEN COUNT(*) >= 20 THEN 'high'
                    WHEN COUNT(*) >= 10 THEN 'medium'
                    ELSE 'low'
                END AS confidence_level,
                MAX(lr.date) AS last_occurrence,
                NOW() AS last_updated
            FROM learning_records lr
            WHERE lr.ai_event_type IS NOT NULL
              AND lr.actual_attendance IS NOT NULL
            GROUP BY lr.ai_event_type
        `);

        await client.query('COMMIT');
        return { inserted: result.rowCount };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// v2.9.88: Insert intraday prediction (NO UNIQUE - keeps all predictions throughout the day)
// v3.0.50: 加入 25 分鐘間隔檢查，防止重複預測（伺服器重啟/多實例問題）
// v3.0.65: 新增 source 參數區分自動預測 vs 手動刷新
const MIN_PREDICTION_INTERVAL_MINUTES = 25;

async function insertIntradayPrediction(targetDate, predictedCount, ci80, ci95, modelVersion = '1.0.0', weatherData = null, aiFactors = null, source = 'auto') {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }
    
    // v3.0.50: 檢查是否在過去 25 分鐘內已有預測（只對自動預測生效，手動刷新不受限）
    if (source === 'auto') {
        try {
            const recentCheck = await queryWithRetry(`
                SELECT prediction_time 
                FROM intraday_predictions 
                WHERE target_date = $1 
                AND prediction_time > NOW() - INTERVAL '${MIN_PREDICTION_INTERVAL_MINUTES} minutes'
                ORDER BY prediction_time DESC
                LIMIT 1
            `, [targetDate]);
            
            if (recentCheck.rows.length > 0) {
                const lastTime = new Date(recentCheck.rows[0].prediction_time);
                const minutesAgo = Math.round((Date.now() - lastTime.getTime()) / 60000);
                console.log(`⏳ 跳過 intraday 記錄：${targetDate} 在 ${minutesAgo} 分鐘前已有預測（間隔需 ≥${MIN_PREDICTION_INTERVAL_MINUTES} 分鐘）`);
                return null; // 跳過插入
            }
        } catch (err) {
            console.warn('⚠️ 檢查最近預測時出錯，繼續插入:', err.message);
        }
    }
    
    // v3.0.65: 嘗試添加 source 欄位（如果不存在則使用舊格式）
    let query;
    let params;
    const toInt = (val) => val != null ? Math.round(val) : null;
    
    try {
        query = `
            INSERT INTO intraday_predictions (target_date, predicted_count, ci80_low, ci80_high, ci95_low, ci95_high, model_version, weather_data, ai_factors, prediction_time, source)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, $10)
            RETURNING *
        `;
        params = [
            targetDate,
            toInt(predictedCount),
            toInt(ci80?.low),
            toInt(ci80?.high),
            toInt(ci95?.low),
            toInt(ci95?.high),
            modelVersion,
            weatherData ? JSON.stringify(weatherData) : null,
            aiFactors ? JSON.stringify(aiFactors) : null,
            source
        ];
        const result = await queryWithRetry(query, params);
        return result.rows[0];
    } catch (err) {
        // 如果 source 欄位不存在，使用舊格式
        if (err.message.includes('source')) {
            query = `
                INSERT INTO intraday_predictions (target_date, predicted_count, ci80_low, ci80_high, ci95_low, ci95_high, model_version, weather_data, ai_factors, prediction_time)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
                RETURNING *
            `;
            params = [
                targetDate,
                toInt(predictedCount),
                toInt(ci80?.low),
                toInt(ci80?.high),
                toInt(ci95?.low),
                toInt(ci95?.high),
                modelVersion,
                weatherData ? JSON.stringify(weatherData) : null,
                aiFactors ? JSON.stringify(aiFactors) : null
            ];
            const result = await queryWithRetry(query, params);
            return result.rows[0];
        }
        throw err;
    }
}

// v3.0.50: 清理重複的 intraday predictions（保留每 30 分鐘一筆）
async function cleanupDuplicateIntradayPredictions(targetDate = null) {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 獲取需要清理的日期
        let dates = [];
        if (targetDate) {
            dates = [targetDate];
        } else {
            const datesResult = await client.query(`
                SELECT DISTINCT target_date FROM intraday_predictions ORDER BY target_date
            `);
            dates = datesResult.rows.map(r => r.target_date);
        }
        
        let totalDeleted = 0;
        const results = [];
        
        for (const date of dates) {
            const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];
            
            // 獲取該日期的所有預測
            const predictions = await client.query(`
                SELECT id, prediction_time 
                FROM intraday_predictions 
                WHERE target_date = $1 
                ORDER BY prediction_time
            `, [dateStr]);
            
            // v3.0.65: 移除 <= 48 的跳過邏輯，改為始終檢查時間間隔
            // 找出需要保留的 ID（保留每 25 分鐘間隔的預測）
            const idsToKeep = [];
            let lastKeptTime = null;
            
            for (const pred of predictions.rows) {
                const predTime = new Date(pred.prediction_time);
                if (!lastKeptTime || (predTime - lastKeptTime) >= 25 * 60 * 1000) {
                    idsToKeep.push(pred.id);
                    lastKeptTime = predTime;
                }
            }
            
            // 刪除不需要的記錄
            if (idsToKeep.length < predictions.rows.length) {
                const deleteResult = await client.query(`
                    DELETE FROM intraday_predictions 
                    WHERE target_date = $1 AND id NOT IN (${idsToKeep.join(',')})
                `, [dateStr]);
                
                const deleted = deleteResult.rowCount;
                totalDeleted += deleted;
                results.push({ 
                    date: dateStr, 
                    before: predictions.rows.length, 
                    after: idsToKeep.length, 
                    deleted 
                });
                console.log(`🧹 ${dateStr}: 清理 ${deleted} 筆重複預測 (${predictions.rows.length} → ${idsToKeep.length})`);
            } else {
                // 無需清理
                results.push({ date: dateStr, before: predictions.rows.length, after: predictions.rows.length, deleted: 0 });
            }
        }
        
        await client.query('COMMIT');
        return { success: true, totalDeleted, details: results };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// v2.9.88: Get all intraday predictions for a date
async function getIntradayPredictions(targetDate) {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }
    // v3.0.65: 加入 source 欄位
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
            prediction_time,
            COALESCE(source, 'auto') as source
        FROM intraday_predictions
        WHERE target_date = $1
        ORDER BY prediction_time ASC
    `;
    const result = await queryWithRetry(query, [targetDate]);
    return result.rows;
}

// v2.9.88: Get intraday predictions for multiple dates (for chart)
// v3.0.65: 加入 source 欄位
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
            COALESCE(ip.source, 'auto') as source,
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
// v3.0.25: 移除不存在的 confidence_score 欄位
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
            prediction_time as created_at
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

// ============================================================
// v3.0.83: Reliability Learning System
// 實時可靠度學習系統
// ============================================================

// 獲取當前可靠度狀態
async function getReliabilityState() {
    if (!pool) return null;
    try {
        // 確保表存在
        await pool.query(`
            CREATE TABLE IF NOT EXISTS reliability_state (
                id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
                xgboost_reliability NUMERIC(5,4) DEFAULT 0.95,
                ai_reliability NUMERIC(5,4) DEFAULT 0.00,
                weather_reliability NUMERIC(5,4) DEFAULT 0.05,
                learning_rate NUMERIC(5,4) DEFAULT 0.10,
                base_std NUMERIC(10,2) DEFAULT 15.00,
                total_samples INTEGER DEFAULT 0,
                last_updated TIMESTAMP DEFAULT NOW()
            )
        `);
        
        // 確保有初始數據
        await pool.query(`
            INSERT INTO reliability_state (id, xgboost_reliability, ai_reliability, weather_reliability)
            VALUES (1, 0.95, 0.00, 0.05)
            ON CONFLICT (id) DO NOTHING
        `);
        
        const result = await pool.query('SELECT * FROM reliability_state WHERE id = 1');
        return result.rows[0] || {
            xgboost_reliability: 0.95,
            ai_reliability: 0.00,
            weather_reliability: 0.05,
            learning_rate: 0.10,
            base_std: 15.00,
            total_samples: 0
        };
    } catch (error) {
        console.error('❌ 獲取可靠度狀態失敗:', error.message);
        return {
            xgboost_reliability: 0.95,
            ai_reliability: 0.00,
            weather_reliability: 0.05,
            learning_rate: 0.10,
            base_std: 15.00,
            total_samples: 0
        };
    }
}

// 更新可靠度學習（當實際數據到達時調用）
async function updateReliabilityLearning(date, actual, predictions) {
    if (!pool) return null;
    try {
        const state = await getReliabilityState();
        const learningRate = parseFloat(state.learning_rate) || 0.10;
        const baseStd = parseFloat(state.base_std) || 15.00;
        
        // 計算各來源誤差
        const xgboostError = predictions.xgboost ? Math.abs(predictions.xgboost - actual) : null;
        const aiError = predictions.ai ? Math.abs(predictions.ai - actual) : null;
        const weatherError = predictions.weather ? Math.abs(predictions.weather - actual) : null;
        
        // 當前可靠度
        let xgboostRel = parseFloat(state.xgboost_reliability) || 0.95;
        let aiRel = parseFloat(state.ai_reliability) || 0.00;
        let weatherRel = parseFloat(state.weather_reliability) || 0.05;
        
        // 更新 XGBoost 可靠度
        if (xgboostError !== null && predictions.xgboost) {
            const expectedError = baseStd / xgboostRel;
            if (xgboostError < expectedError) {
                xgboostRel = Math.min(0.98, xgboostRel + learningRate * (1 - xgboostRel));
            } else {
                xgboostRel = Math.max(0.50, xgboostRel - learningRate * xgboostRel * 0.3);
            }
        }
        
        // 更新 AI 可靠度（只有當 AI 預測存在且不同於 XGBoost 時）
        if (aiError !== null && predictions.ai && predictions.ai !== predictions.xgboost) {
            const expectedError = baseStd / (aiRel + 0.01);
            if (aiError < expectedError && aiError < (xgboostError || Infinity)) {
                // AI 比 XGBoost 更準確，增加 AI 可靠度
                aiRel = Math.min(0.30, aiRel + learningRate * 0.5);
                console.log(`📈 AI 可靠度提升: ${aiRel.toFixed(3)} (AI 誤差 ${aiError.toFixed(1)} < XGBoost 誤差 ${xgboostError?.toFixed(1)})`);
            } else {
                aiRel = Math.max(0.00, aiRel - learningRate * 0.2);
            }
        }
        
        // 更新 Weather 可靠度
        if (weatherError !== null && predictions.weather) {
            const expectedError = baseStd / (weatherRel + 0.01);
            if (weatherError < expectedError) {
                weatherRel = Math.min(0.15, weatherRel + learningRate * 0.3);
            } else {
                weatherRel = Math.max(0.02, weatherRel - learningRate * 0.2);
            }
        }
        
        // 正規化確保總和 = 1
        const total = xgboostRel + aiRel + weatherRel;
        xgboostRel = xgboostRel / total;
        aiRel = aiRel / total;
        weatherRel = weatherRel / total;
        
        // 保存歷史記錄
        await pool.query(`
            CREATE TABLE IF NOT EXISTS reliability_history (
                id SERIAL PRIMARY KEY,
                date DATE NOT NULL,
                actual_attendance INTEGER NOT NULL,
                xgboost_prediction NUMERIC(10,2),
                ai_prediction NUMERIC(10,2),
                weather_prediction NUMERIC(10,2),
                xgboost_error NUMERIC(10,2),
                ai_error NUMERIC(10,2),
                weather_error NUMERIC(10,2),
                xgboost_reliability NUMERIC(5,4),
                ai_reliability NUMERIC(5,4),
                weather_reliability NUMERIC(5,4),
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(date)
            )
        `);
        
        await pool.query(`
            INSERT INTO reliability_history 
                (date, actual_attendance, xgboost_prediction, ai_prediction, weather_prediction,
                 xgboost_error, ai_error, weather_error,
                 xgboost_reliability, ai_reliability, weather_reliability)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (date) DO UPDATE SET
                actual_attendance = EXCLUDED.actual_attendance,
                xgboost_prediction = EXCLUDED.xgboost_prediction,
                ai_prediction = EXCLUDED.ai_prediction,
                weather_prediction = EXCLUDED.weather_prediction,
                xgboost_error = EXCLUDED.xgboost_error,
                ai_error = EXCLUDED.ai_error,
                weather_error = EXCLUDED.weather_error,
                xgboost_reliability = EXCLUDED.xgboost_reliability,
                ai_reliability = EXCLUDED.ai_reliability,
                weather_reliability = EXCLUDED.weather_reliability,
                created_at = NOW()
        `, [date, actual, predictions.xgboost, predictions.ai, predictions.weather,
            xgboostError, aiError, weatherError, xgboostRel, aiRel, weatherRel]);
        
        // 更新當前狀態
        await pool.query(`
            UPDATE reliability_state SET
                xgboost_reliability = $1,
                ai_reliability = $2,
                weather_reliability = $3,
                total_samples = total_samples + 1,
                last_updated = NOW()
            WHERE id = 1
        `, [xgboostRel, aiRel, weatherRel]);
        
        console.log(`📊 可靠度學習更新 [${date}]: XGB=${(xgboostRel*100).toFixed(1)}%, AI=${(aiRel*100).toFixed(1)}%, Weather=${(weatherRel*100).toFixed(1)}%`);
        
        return {
            xgboost: xgboostRel,
            ai: aiRel,
            weather: weatherRel,
            errors: { xgboost: xgboostError, ai: aiError, weather: weatherError }
        };
    } catch (error) {
        console.error('❌ 更新可靠度學習失敗:', error.message);
        return null;
    }
}

// 獲取可靠度學習歷史
async function getReliabilityHistory(days = 90) {
    if (!pool) return [];
    try {
        const result = await pool.query(`
            SELECT * FROM reliability_history
            WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
            ORDER BY date DESC
        `);
        return result.rows;
    } catch (error) {
        console.error('❌ 獲取可靠度歷史失敗:', error.message);
        return [];
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
    upsertModelPredictionRun,
    syncModelPredictionActuals,
    getModelPredictionRuns,
    backfillHistoricalModelPredictionRuns,
    backfillLearningRecordsAIEventType,
    rebuildAIEventLearning,
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
    // v3.0.50: Cleanup duplicates
    cleanupDuplicateIntradayPredictions,
    // v2.9.90: Auto predict stats (persisted)
    getAutoPredictStats,
    saveAutoPredictStats,
    getAutoPredictCumulativeStats,
    // v3.0.83: Reliability learning
    getReliabilityState,
    updateReliabilityLearning,
    getReliabilityHistory
};

