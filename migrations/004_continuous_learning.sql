-- ============================================================
-- Migration 004: Continuous Learning System
-- 自動學習系統數據庫結構
--
-- Purpose:
--   1. 記錄每天的預測、實際、條件和學習結果
--   2. 動態更新天氣影響參數
--   3. 學習天氣條件組合影響
--   4. AI 事件模式學習
--   5. 異常事件追蹤
--
-- Author: Ma Tsz Kiu
-- Date: 2026-01-18
-- Version: 4.0.00
-- ============================================================

-- ============================================================
-- 1. 天氣歷史數據表 (用於快速查詢)
-- ============================================================
CREATE TABLE IF NOT EXISTS weather_history (
    date DATE PRIMARY KEY,
    temp_min NUMERIC(5,2),
    temp_max NUMERIC(5,2),
    temp_mean NUMERIC(5,2),
    humidity_pct NUMERIC(5,2),
    rainfall_mm NUMERIC(6,2),
    wind_kmh NUMERIC(5,2),
    pressure_hpa NUMERIC(7,2),
    visibility_km NUMERIC(5,2),
    cloud_pct NUMERIC(5,2),
    sunshine_hrs NUMERIC(4,2),
    dew_point NUMERIC(5,2),

    -- 天氣警告
    typhoon_signal VARCHAR(10),      -- T1, T3, T8, T8NE, T8NW, T8SE, T8SW, T9, T10
    rainstorm_warning VARCHAR(20),   -- AMBER, RED, BLACK
    cold_warning BOOLEAN,
    hot_warning BOOLEAN,

    -- 極端條件標記 (計算欄位)
    is_very_cold BOOLEAN,            -- temp_min <= 12
    is_very_hot BOOLEAN,             -- temp_max >= 33
    is_heavy_rain BOOLEAN,           -- rainfall_mm > 25
    is_strong_wind BOOLEAN,          -- wind_kmh > 30
    is_low_humidity BOOLEAN,         -- humidity_pct < 50
    is_high_pressure BOOLEAN,        -- pressure_hpa > 1020

    data_fetch_time TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 2. 學習記錄表 (核心學習數據)
-- ============================================================
CREATE TABLE IF NOT EXISTS learning_records (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,

    -- 預測 vs 實際
    xgboost_base_pred NUMERIC(10,2),
    final_prediction NUMERIC(10,2),
    actual_attendance NUMERIC(10,2),
    prediction_error NUMERIC(10,2),
    error_pct NUMERIC(6,2),

    -- 天氣條件
    temp_min NUMERIC(5,2),
    temp_max NUMERIC(5,2),
    rainfall_mm NUMERIC(6,2),
    wind_kmh NUMERIC(5,2),
    humidity_pct NUMERIC(5,2),
    pressure_hpa NUMERIC(7,2),

    -- 極端天氣標記
    is_very_cold BOOLEAN,
    is_very_hot BOOLEAN,
    is_heavy_rain BOOLEAN,
    is_strong_wind BOOLEAN,
    typhoon_signal VARCHAR(10),

    -- AI 因素
    ai_factor NUMERIC(5,3),
    ai_event_type VARCHAR(100),
    ai_description TEXT,

    -- 學習結果
    weather_impact_learned NUMERIC(6,3),     -- 學習到的天氣影響
    ai_impact_learned NUMERIC(6,3),          -- 學習到的 AI 影響
    is_anomaly BOOLEAN,                      -- 是否為異常值
    anomaly_reason TEXT,                     -- 異常原因

    -- 元數據
    created_at TIMESTAMP DEFAULT NOW(),
    processed BOOLEAN DEFAULT FALSE          -- 是否已被學習模型處理
);

-- ============================================================
-- 3. 天氣影響參數表 (動態更新)
-- ============================================================
CREATE TABLE IF NOT EXISTS weather_impact_parameters (
    id SERIAL PRIMARY KEY,
    parameter_name VARCHAR(50) NOT NULL,
    parameter_value NUMERIC(8,4) NOT NULL,
    sample_count INTEGER NOT NULL,
    confidence_interval_lower NUMERIC(8,4),
    confidence_interval_upper NUMERIC(8,4),
    p_value NUMERIC(8,6),
    last_updated TIMESTAMP DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(parameter_name)
);

-- ============================================================
-- 4. 天氣條件組合影響表
-- ============================================================
CREATE TABLE IF NOT EXISTS weather_combination_impacts (
    id SERIAL PRIMARY KEY,

    -- 條件組合 (JSON 格式)
    -- 例: {"is_very_cold": true, "is_heavy_rain": true}
    conditions_json JSONB NOT NULL,

    -- 統計數據
    sample_count INTEGER NOT NULL,
    mean_attendance NUMERIC(10,2),
    std_attendance NUMERIC(10,2),
    baseline_mean NUMERIC(10,2),
    impact_factor NUMERIC(6,3),           -- 平均 attendance / baseline
    impact_absolute NUMERIC(8,2),         -- mean - baseline

    -- 統計顯著性
    t_statistic NUMERIC(8,4),
    p_value NUMERIC(8,6),
    is_significant BOOLEAN DEFAULT FALSE,

    last_seen DATE,
    last_updated TIMESTAMP DEFAULT NOW(),

    -- 唯一約束: 相同條件組合
    UNIQUE(conditions_json)
);

-- ============================================================
-- 5. AI 事件學習表
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_event_learning (
    id SERIAL PRIMARY KEY,

    -- 事件分類
    event_type VARCHAR(100) NOT NULL,
    event_pattern VARCHAR(200),           -- 事件模式 (如 "marathon", "holiday")

    -- 統計數據
    total_occurrences INTEGER NOT NULL,
    avg_ai_factor NUMERIC(6,3),
    avg_actual_impact NUMERIC(8,2),      -- 實際平均影響 (人數)
    avg_actual_impact_pct NUMERIC(6,3),  -- 實際平均影響 (%)

    -- 預測準確性
    correct_predictions INTEGER,          -- AI 方向正確的次數
    prediction_accuracy NUMERIC(5,3),     -- 正確率

    -- 信度
    confidence_level VARCHAR(20),         -- 'high', 'medium', 'low'
    min_sample_threshold INTEGER DEFAULT 10,

    last_occurrence DATE,
    last_updated TIMESTAMP DEFAULT NOW(),

    UNIQUE(event_type, event_pattern)
);

-- ============================================================
-- 6. 天氣預報緩存表
-- ============================================================
CREATE TABLE IF NOT EXISTS weather_forecast_cache (
    id SERIAL PRIMARY KEY,
    forecast_date DATE NOT NULL,
    fetch_date TIMESTAMP DEFAULT NOW(),

    -- 預報數據 (來自 HKO 9-Day Forecast)
    temp_min_forecast NUMERIC(5,2),
    temp_max_forecast NUMERIC(5,2),
    rain_prob_forecast VARCHAR(20),       -- Low, Medium, High, Very High
    weather_desc TEXT,

    -- 預測的天氣影響
    predicted_impact_factor NUMERIC(6,3),
    predicted_impact_absolute NUMERIC(8,2),
    confidence_level VARCHAR(20),

    -- 驗證 (之後更新)
    actual_temp_min NUMERIC(5,2),
    actual_temp_max NUMERIC(5,2),
    forecast_error_temp NUMERIC(5,2),
    forecast_accuracy BOOLEAN,

    UNIQUE(forecast_date, fetch_date)
);

-- ============================================================
-- 7. 異常事件日誌
-- ============================================================
CREATE TABLE IF NOT EXISTS anomaly_events (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    anomaly_type VARCHAR(50) NOT NULL,    -- 'weather', 'ai', 'unknown'

    -- 異常詳情
    prediction_error NUMERIC(10,2),
    error_std_deviations NUMERIC(6,2),   -- 誤差是標準差的幾倍

    -- 當日條件
    conditions_json JSONB,

    -- 處理狀態
    is_explained BOOLEAN DEFAULT FALSE,
    explanation TEXT,
    requires_review BOOLEAN DEFAULT TRUE,

    -- 後續追蹤
    similar_event_count INTEGER,          -- 類似事件發生次數
    next_similar_date DATE,

    created_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP
);

-- ============================================================
-- 索引優化
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_learning_records_date ON learning_records(date DESC);
CREATE INDEX IF NOT EXISTS idx_learning_records_anomaly ON learning_records(is_anomaly, date DESC);
CREATE INDEX IF NOT EXISTS idx_learning_records_processed ON learning_records(processed, date) WHERE processed = FALSE;
CREATE INDEX IF NOT EXISTS idx_weather_history_date ON weather_history(date DESC);
CREATE INDEX IF NOT EXISTS idx_weather_conditions ON weather_history(is_very_cold, is_very_hot, is_heavy_rain);
CREATE INDEX IF NOT EXISTS idx_weather_combo_conditions ON weather_combination_impacts USING GIN(conditions_json);
CREATE INDEX IF NOT EXISTS idx_ai_event_pattern ON ai_event_learning(event_type, event_pattern);
CREATE INDEX IF NOT EXISTS idx_forecast_date ON weather_forecast_cache(forecast_date DESC);
CREATE INDEX IF NOT EXISTS idx_anomaly_type ON anomaly_events(anomaly_type, is_explained);

-- ============================================================
-- 視圖: 當前天氣影響參數摘要
-- ============================================================
CREATE OR REPLACE VIEW current_weather_impacts AS
SELECT
    parameter_name,
    parameter_value,
    sample_count,
    confidence_interval_lower,
    confidence_interval_upper,
    p_value,
    CASE
        WHEN p_value < 0.001 THEN '***'
        WHEN p_value < 0.01 THEN '**'
        WHEN p_value < 0.05 THEN '*'
        ELSE 'n.s.'
    END as significance,
    last_updated
FROM weather_impact_parameters
WHERE is_active = TRUE
ORDER BY ABS(parameter_value) DESC;

-- ============================================================
-- 視圖: AI 事件學習摘要
-- ============================================================
CREATE OR REPLACE VIEW ai_learning_summary AS
SELECT
    event_type,
    event_pattern,
    total_occurrences,
    avg_ai_factor,
    avg_actual_impact_pct,
    prediction_accuracy,
    confidence_level,
    last_occurrence
FROM ai_event_learning
WHERE total_occurrences >= 5
ORDER BY total_occurrences DESC;

-- ============================================================
-- 視圖: 異常統計
-- ============================================================
CREATE OR REPLACE VIEW anomaly_stats AS
SELECT
    COUNT(*) as total_anomalies,
    COUNT(CASE WHEN is_explained THEN 1 END) as explained_anomalies,
    COUNT(CASE WHEN requires_review THEN 1 END) as pending_review,
    AVG(prediction_error) as avg_error,
    MAX(date) as latest_anomaly
FROM anomaly_events
WHERE created_at >= CURRENT_DATE - INTERVAL '90 days';

-- ============================================================
-- 視圖: 學習系統狀態
-- ============================================================
CREATE OR REPLACE VIEW learning_system_status AS
SELECT
    (SELECT COUNT(*) FROM learning_records) as total_records,
    (SELECT COUNT(*) FROM learning_records WHERE date >= CURRENT_DATE - INTERVAL '30 days') as recent_records,
    (SELECT COUNT(*) FROM learning_records WHERE is_anomaly = TRUE) as total_anomalies,
    (SELECT COUNT(*) FROM learning_records WHERE is_anomaly = TRUE AND date >= CURRENT_DATE - INTERVAL '30 days') as recent_anomalies,
    (SELECT COUNT(*) FROM weather_impact_parameters WHERE is_active = TRUE) as active_weather_params,
    (SELECT COUNT(*) FROM ai_event_learning WHERE total_occurrences >= 5) as learned_ai_events,
    (SELECT MAX(date) FROM learning_records) as last_learning_date,
    (SELECT MAX(last_updated) FROM weather_impact_parameters) as last_parameter_update;

-- ============================================================
-- 註解
-- ============================================================
COMMENT ON TABLE learning_records IS '核心學習記錄表，記錄每天的預測、實際、條件和學習結果';
COMMENT ON TABLE weather_impact_parameters IS '動態更新的天氣影響參數';
COMMENT ON TABLE weather_combination_impacts IS '天氣條件組合對 attendance 的影響';
COMMENT ON TABLE ai_event_learning IS 'AI 事件模式學習結果';
COMMENT ON TABLE weather_forecast_cache IS '天氣預報緩存，用於預測調整';
COMMENT ON TABLE anomaly_events IS '異常事件記錄和追蹤';
COMMENT ON TABLE weather_history IS '天氣歷史數據，用於快速查詢和分析';

COMMENT ON VIEW current_weather_impacts IS '當前有效的天氣影響參數，按影響大小排序';
COMMENT ON VIEW ai_learning_summary IS 'AI 事件學習摘要，只顯示有足夠樣本的事件';
COMMENT ON VIEW anomaly_stats IS '異常事件統計摘要，過去 90 天';
COMMENT ON VIEW learning_system_status IS '學習系統整體狀態概覽';

-- ============================================================
-- 初始化默認天氣影響參數 (基於歷史分析)
-- ============================================================
INSERT INTO weather_impact_parameters (
    parameter_name,
    parameter_value,
    sample_count,
    is_active
) VALUES
    ('is_very_cold', -6.8, 128, TRUE),
    ('is_heavy_rain', -4.9, 232, TRUE),
    ('is_low_humidity', -4.7, 94, TRUE),
    ('is_strong_wind', -2.8, 789, TRUE),
    ('is_high_pressure', -1.5, 581, TRUE),
    ('is_very_hot', 1.2, 1064, TRUE),
    ('is_rain_day', -1.0, 1212, TRUE)
ON CONFLICT (parameter_name) DO NOTHING;
