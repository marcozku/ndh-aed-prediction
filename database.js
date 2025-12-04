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
            database: pgDatabase
        };

        // Only enable SSL for external connections
        if (!pgHost.includes('.railway.internal')) {
            poolConfig.ssl = { rejectUnauthorized: false };
        }
        
        console.log(`📍 Connecting to ${poolConfig.host}:${poolConfig.port}/${poolConfig.database}`);
        return new Pool(poolConfig);
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
                database: url.pathname.slice(1)
            };

            if (!url.hostname.includes('.railway.internal')) {
                poolConfig.ssl = { rejectUnauthorized: false };
            }
            
            console.log(`📍 Connecting to ${poolConfig.host}:${poolConfig.port}/${poolConfig.database}`);
            return new Pool(poolConfig);
        } catch (err) {
            console.error('❌ Failed to parse DATABASE_URL:', err.message);
        }
    }
    
    console.log('⚠️ No valid database configuration found');
    console.log('   Set PGHOST, PGUSER, PGPASSWORD, PGDATABASE or DATABASE_URL');
    return null;
}

pool = initPool();

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
    const query = `
        INSERT INTO predictions (prediction_date, target_date, predicted_count, ci80_low, ci80_high, ci95_low, ci95_high, model_version)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
    `;
    const result = await pool.query(query, [
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
    let query = 'SELECT * FROM actual_data';
    const params = [];
    
    if (startDate && endDate) {
        query += ' WHERE date BETWEEN $1 AND $2';
        params.push(startDate, endDate);
    } else if (startDate) {
        query += ' WHERE date >= $1';
        params.push(startDate);
    } else if (endDate) {
        query += ' WHERE date <= $1';
        params.push(endDate);
    }
    
    query += ' ORDER BY date DESC';
    const result = await pool.query(query, params);
    return result.rows;
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
        
        // Get the most recent prediction for that date
        const predictionResult = await client.query(
            'SELECT * FROM predictions WHERE target_date = $1 ORDER BY created_at DESC LIMIT 1',
            [targetDate]
        );
        
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
async function getComparisonData(limit = 30) {
    const query = `
        SELECT 
            a.date,
            a.patient_count as actual,
            p.predicted_count as predicted,
            p.ci80_low,
            p.ci80_high,
            pa.error,
            pa.error_percentage
        FROM actual_data a
        LEFT JOIN predictions p ON a.date = p.target_date
        LEFT JOIN prediction_accuracy pa ON a.date = pa.target_date
        ORDER BY a.date DESC
        LIMIT $1
    `;
    const result = await pool.query(query, [limit]);
    return result.rows;
}

module.exports = {
    pool,
    initDatabase,
    insertActualData,
    insertBulkActualData,
    insertPrediction,
    getActualData,
    getPredictions,
    calculateAccuracy,
    getAccuracyStats,
    getComparisonData
};

