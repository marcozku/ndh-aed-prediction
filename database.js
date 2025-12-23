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
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            )
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
                calculated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(target_date)
            )
        `);

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
    const result = await queryWithRetry(query, [
        predictionDate,
        targetDate,
        predictedCount,
        ci80?.low,
        ci80?.high,
        ci95?.low,
        ci95?.high,
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

// Insert daily prediction (each update throughout the day)
async function insertDailyPrediction(targetDate, predictedCount, ci80, ci95, modelVersion = '1.0.0', weatherData = null, aiFactors = null) {
    if (!pool) {
        throw new Error('Database pool not initialized');
    }
    const query = `
        INSERT INTO daily_predictions (target_date, predicted_count, ci80_low, ci80_high, ci95_low, ci95_high, model_version, weather_data, ai_factors)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
    `;
    const result = await queryWithRetry(query, [
        targetDate,
        predictedCount,
        ci80?.low,
        ci80?.high,
        ci95?.low,
        ci95?.high,
        modelVersion,
        weatherData ? JSON.stringify(weatherData) : null,
        aiFactors ? JSON.stringify(aiFactors) : null
    ]);
    return result.rows[0];
}

// Calculate and save final daily prediction (average of all predictions for that day)
async function calculateFinalDailyPrediction(targetDate) {
    const client = await pool.connect();
    try {
        // Get all predictions for the target date
        const predictionsResult = await client.query(`
            SELECT 
                predicted_count,
                ci80_low,
                ci80_high,
                ci95_low,
                ci95_high,
                model_version
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

        // Calculate averages
        const avgPredicted = Math.round(
            predictions.reduce((sum, p) => sum + p.predicted_count, 0) / count
        );
        const avgCi80Low = Math.round(
            predictions.reduce((sum, p) => sum + (p.ci80_low || 0), 0) / count
        );
        const avgCi80High = Math.round(
            predictions.reduce((sum, p) => sum + (p.ci80_high || 0), 0) / count
        );
        const avgCi95Low = Math.round(
            predictions.reduce((sum, p) => sum + (p.ci95_low || 0), 0) / count
        );
        const avgCi95High = Math.round(
            predictions.reduce((sum, p) => sum + (p.ci95_high || 0), 0) / count
        );

        // Get most recent model version
        const latestModelVersion = predictions[predictions.length - 1].model_version;

        // Insert or update final prediction
        const query = `
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
            RETURNING *
        `;
        const result = await client.query(query, [
            targetDate,
            avgPredicted,
            avgCi80Low,
            avgCi80High,
            avgCi95Low,
            avgCi95High,
            count,
            latestModelVersion
        ]);

        console.log(`✅ 已計算並保存 ${targetDate} 的最終預測（基於 ${count} 次預測的平均值）`);
        return result.rows[0];
    } finally {
        client.release();
    }
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
    clearAllData
};

