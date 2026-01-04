-- Migration: Dual-Track Prediction System
-- Purpose: Store both production and experimental predictions for AI factor validation
-- Author: Ma Tsz Kiu
-- Date: 2026-01-05

-- Add dual-track columns to daily_predictions table
ALTER TABLE daily_predictions ADD COLUMN IF NOT EXISTS prediction_production DECIMAL(10,2);
ALTER TABLE daily_predictions ADD COLUMN IF NOT EXISTS prediction_experimental DECIMAL(10,2);
ALTER TABLE daily_predictions ADD COLUMN IF NOT EXISTS ai_factor DECIMAL(5,3);
ALTER TABLE daily_predictions ADD COLUMN IF NOT EXISTS weather_factor DECIMAL(5,3);
ALTER TABLE daily_predictions ADD COLUMN IF NOT EXISTS xgboost_base DECIMAL(10,2);

-- Add validation metrics columns
ALTER TABLE daily_predictions ADD COLUMN IF NOT EXISTS production_error DECIMAL(10,2);
ALTER TABLE daily_predictions ADD COLUMN IF NOT EXISTS experimental_error DECIMAL(10,2);
ALTER TABLE daily_predictions ADD COLUMN IF NOT EXISTS better_model VARCHAR(20);
ALTER TABLE daily_predictions ADD COLUMN IF NOT EXISTS validation_date TIMESTAMP;

-- Create index for validation queries
CREATE INDEX IF NOT EXISTS idx_predictions_validation 
ON daily_predictions(prediction_date, validation_date) 
WHERE actual_attendance IS NOT NULL;

-- Create weight optimization history table
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
);

-- Create AI factor validation table
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
);

-- Create system adaptation log
CREATE TABLE IF NOT EXISTS system_adaptation_log (
    id SERIAL PRIMARY KEY,
    adaptation_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    adaptation_type VARCHAR(50) NOT NULL, -- 'weight_update', 'ai_enabled', 'ai_disabled'
    trigger_reason TEXT NOT NULL,
    
    -- Changes made
    changes_json JSONB NOT NULL,
    
    -- Impact
    expected_improvement DECIMAL(5,2),
    actual_improvement DECIMAL(5,2),
    
    -- Evidence
    evidence_summary TEXT,
    
    -- Status
    status VARCHAR(20) DEFAULT 'active' -- 'active', 'reverted', 'superseded'
);

-- Create materialized view for quick validation stats
CREATE MATERIALIZED VIEW IF NOT EXISTS validation_stats_summary AS
SELECT 
    COUNT(*) as total_predictions,
    COUNT(CASE WHEN actual_attendance IS NOT NULL THEN 1 END) as validated_predictions,
    AVG(production_error) as avg_production_error,
    AVG(experimental_error) as avg_experimental_error,
    AVG(CASE WHEN experimental_error < production_error THEN 1 ELSE 0 END) as experimental_win_rate,
    STDDEV(production_error) as std_production_error,
    STDDEV(experimental_error) as std_experimental_error,
    MIN(prediction_date) as first_prediction,
    MAX(prediction_date) as last_prediction,
    MAX(validation_date) as last_validation
FROM daily_predictions
WHERE prediction_date >= CURRENT_DATE - INTERVAL '90 days'
  AND actual_attendance IS NOT NULL;

-- Create index for quick access
CREATE INDEX IF NOT EXISTS idx_validation_stats ON daily_predictions(prediction_date DESC, actual_attendance);
CREATE INDEX IF NOT EXISTS idx_weight_history ON weight_optimization_history(optimization_date DESC);
CREATE INDEX IF NOT EXISTS idx_ai_validation ON ai_factor_validation(prediction_date DESC, validated_at);

-- Insert initial weight record
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
);

COMMENT ON TABLE weight_optimization_history IS 'Tracks all weight optimization decisions with statistical evidence';
COMMENT ON TABLE ai_factor_validation IS 'Stores dual-track predictions for AI factor validation';
COMMENT ON TABLE system_adaptation_log IS 'Logs all intelligent system adaptations with reasoning';
COMMENT ON MATERIALIZED VIEW validation_stats_summary IS 'Quick summary stats for validation dashboard';

