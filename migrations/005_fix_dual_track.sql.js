/**
 * Migration: Fix Dual-Track System Tables
 * Purpose: Add missing dual-track tables and columns
 * Date: 2026-01-27
 */

const pg = require('pg');
require('dotenv').config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        console.log('🔧 Fixing Dual-Track System tables...');

        // 1. Add validation columns to daily_predictions
        console.log('  → Adding validation columns to daily_predictions...');

        const columnsToAdd = [
            'actual_attendance DECIMAL(10,2)',
            'production_error DECIMAL(10,2)',
            'experimental_error DECIMAL(10,2)',
            'better_model VARCHAR(20)',
            'validation_date TIMESTAMP'
        ];

        for (const col of columnsToAdd) {
            const [colName] = col.split(' ');
            try {
                await client.query(`ALTER TABLE daily_predictions ADD COLUMN IF NOT EXISTS ${col}`);
                console.log(`    ✅ Added ${colName}`);
            } catch (e) {
                console.log(`    ⚠️  ${colName}: ${e.message}`);
            }
        }

        // 2. Create ai_factor_validation table
        console.log('  → Creating ai_factor_validation table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS ai_factor_validation (
                id SERIAL PRIMARY KEY,
                prediction_date DATE NOT NULL,
                event_type VARCHAR(100),
                event_description TEXT,

                -- Predictions
                xgboost_base DECIMAL(10,2) NOT NULL,
                production_pred DECIMAL(10,2) NOT NULL,
                experimental_pred DECIMAL(10,2) NOT NULL,
                actual_attendance DECIMAL(10,2),

                -- Factors
                ai_factor DECIMAL(5,3),
                weather_factor DECIMAL(5,3),

                -- Errors (calculated after actual data arrives)
                production_error DECIMAL(10,2),
                experimental_error DECIMAL(10,2),
                improvement DECIMAL(10,2),

                -- Metadata
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                validated_at TIMESTAMP,

                UNIQUE(prediction_date)
            )
        `);
        console.log('    ✅ ai_factor_validation created');

        // 3. Create weight_optimization_history table
        console.log('  → Creating weight_optimization_history table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS weight_optimization_history (
                id SERIAL PRIMARY KEY,
                optimization_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                evaluation_period_days INTEGER NOT NULL,
                samples_evaluated INTEGER NOT NULL,

                -- Current weights
                w_base_old DECIMAL(5,3) NOT NULL,
                w_weather_old DECIMAL(5,3) NOT NULL,
                w_ai_old DECIMAL(5,3) NOT NULL,

                -- New optimized weights
                w_base_new DECIMAL(5,3) NOT NULL,
                w_weather_new DECIMAL(5,3) NOT NULL,
                w_ai_new DECIMAL(5,3) NOT NULL,

                -- Performance metrics
                production_mae DECIMAL(10,3),
                experimental_mae DECIMAL(10,3),
                improvement_percentage DECIMAL(5,2),

                -- Statistical validation
                p_value DECIMAL(10,6),
                statistically_significant BOOLEAN,

                -- Decision
                weights_updated BOOLEAN DEFAULT FALSE,
                recommendation TEXT,

                CONSTRAINT weights_sum_check CHECK (
                    ABS((w_base_new + w_weather_new + w_ai_new) - 1.0) < 0.001
                )
            )
        `);
        console.log('    ✅ weight_optimization_history created');

        // 4. Create indexes
        console.log('  → Creating indexes...');
        await client.query(`CREATE INDEX IF NOT EXISTS idx_predictions_validation
            ON daily_predictions(target_date, validation_date)
            WHERE actual_attendance IS NOT NULL`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_weight_history
            ON weight_optimization_history(optimization_date DESC)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_ai_validation
            ON ai_factor_validation(prediction_date DESC, validated_at)`);
        console.log('    ✅ Indexes created');

        // 5. Insert initial weight record if not exists
        const existing = await client.query('SELECT COUNT(*) FROM weight_optimization_history');
        if (parseInt(existing.rows[0].count) === 0) {
            await client.query(`
                INSERT INTO weight_optimization_history (
                    evaluation_period_days,
                    samples_evaluated,
                    w_base_old, w_weather_old, w_ai_old,
                    w_base_new, w_weather_new, w_ai_new,
                    weights_updated,
                    recommendation
                ) VALUES (
                    0, 0,
                    0.95, 0.05, 0.00,
                    0.95, 0.05, 0.00,
                    FALSE,
                    'Initial baseline: AI factor disabled pending validation data collection'
                )
            `);
            console.log('    ✅ Initial weight record inserted');
        }

        await client.query('COMMIT');
        console.log('✅ Dual-Track System migration complete!');

    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Migration failed:', e);
        throw e;
    } finally {
        client.release();
        await pool.end();
    }
}

migrate().catch(console.error);
