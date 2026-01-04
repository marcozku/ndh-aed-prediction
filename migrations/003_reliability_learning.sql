-- ============================================================
-- Migration 003: Reliability Learning System
-- 實時可靠度學習系統
-- ============================================================

-- 可靠度歷史表
CREATE TABLE IF NOT EXISTS reliability_history (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    actual_attendance INTEGER NOT NULL,
    
    -- 各來源預測值
    xgboost_prediction NUMERIC(10,2),
    ai_prediction NUMERIC(10,2),
    weather_prediction NUMERIC(10,2),
    
    -- 各來源誤差
    xgboost_error NUMERIC(10,2),
    ai_error NUMERIC(10,2),
    weather_error NUMERIC(10,2),
    
    -- 更新後的可靠度
    xgboost_reliability NUMERIC(5,4) DEFAULT 0.95,
    ai_reliability NUMERIC(5,4) DEFAULT 0.00,
    weather_reliability NUMERIC(5,4) DEFAULT 0.05,
    
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(date)
);

-- 當前可靠度狀態表（單行，始終保持最新）
CREATE TABLE IF NOT EXISTS reliability_state (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    xgboost_reliability NUMERIC(5,4) DEFAULT 0.95,
    ai_reliability NUMERIC(5,4) DEFAULT 0.00,
    weather_reliability NUMERIC(5,4) DEFAULT 0.05,
    learning_rate NUMERIC(5,4) DEFAULT 0.10,
    base_std NUMERIC(10,2) DEFAULT 15.00,
    total_samples INTEGER DEFAULT 0,
    last_updated TIMESTAMP DEFAULT NOW()
);

-- 初始化可靠度狀態
INSERT INTO reliability_state (id, xgboost_reliability, ai_reliability, weather_reliability, learning_rate, base_std, total_samples)
VALUES (1, 0.95, 0.00, 0.05, 0.10, 15.00, 0)
ON CONFLICT (id) DO NOTHING;

-- 創建索引
CREATE INDEX IF NOT EXISTS idx_reliability_history_date ON reliability_history(date DESC);

-- 視圖：可靠度學習統計
CREATE OR REPLACE VIEW reliability_stats AS
SELECT 
    COUNT(*) as total_samples,
    AVG(xgboost_error) as avg_xgboost_error,
    AVG(ai_error) as avg_ai_error,
    AVG(weather_error) as avg_weather_error,
    (SELECT xgboost_reliability FROM reliability_state WHERE id = 1) as current_xgboost_reliability,
    (SELECT ai_reliability FROM reliability_state WHERE id = 1) as current_ai_reliability,
    (SELECT weather_reliability FROM reliability_state WHERE id = 1) as current_weather_reliability
FROM reliability_history
WHERE date >= CURRENT_DATE - INTERVAL '90 days';

