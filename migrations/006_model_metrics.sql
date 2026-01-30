-- ============================================================
-- Migration 006: Model Metrics Table
-- 模型性能指標表
--
-- Purpose: 存儲模型訓練性能指標，供前端動態顯示
-- Author: Ma Tsz Kiu
-- Date: 2026-01-30
-- Version: v3.2.01
-- ============================================================

-- 創建模型性能指標表
CREATE TABLE IF NOT EXISTS model_metrics (
    id SERIAL PRIMARY KEY,
    model_name VARCHAR(100) NOT NULL,
    version VARCHAR(20),

    -- 性能指標
    mae NUMERIC(10,4) NOT NULL,
    rmse NUMERIC(10,4),
    mape NUMERIC(10,4),
    r2 NUMERIC(10,6),

    -- 訓練信息
    training_date TIMESTAMP,
    data_count INTEGER,
    train_size INTEGER,
    test_size INTEGER,

    -- 特徵信息
    n_features INTEGER,
    features JSONB,

    -- 優化信息
    optimization_method VARCHAR(100),
    hyperparameters JSONB,

    -- 元數據
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- 唯一約束：同一模型名稱和版本只能有一條記錄
    UNIQUE(model_name, version)
);

-- 創建索引
CREATE INDEX IF NOT EXISTS idx_model_metrics_model_name ON model_metrics(model_name);
CREATE INDEX IF NOT EXISTS idx_model_metrics_version ON model_metrics(version);
CREATE INDEX IF NOT EXISTS idx_model_metrics_created_at ON model_metrics(created_at DESC);

-- 插入 v3.2.01 模型性能數據（從 xgboost_opt10_metrics.json）
INSERT INTO model_metrics (
    model_name,
    version,
    mae,
    rmse,
    mape,
    r2,
    training_date,
    data_count,
    train_size,
    test_size,
    n_features,
    features,
    optimization_method,
    hyperparameters
) VALUES (
    'xgboost',
    'v3.2.01',
    2.8510,
    4.5353,
    1.1741,
    0.971761,
    '2026-01-18 01:49:04'::TIMESTAMP,
    3734,
    2987,
    747,
    10,
    '["Attendance_EWMA7","Daily_Change","Attendance_EWMA14","Weekly_Change","Day_of_Week","Attendance_Lag7","Attendance_Lag1","Is_Weekend","DayOfWeek_sin","DayOfWeek_cos"]'::JSONB,
    'Optuna (30 trials)',
    '{"max_depth":9,"learning_rate":0.045,"min_child_weight":6,"subsample":0.67,"colsample_bytree":0.92,"gamma":0.84,"reg_alpha":1.35,"reg_lambda":0.79,"objective":"reg:squarederror","tree_method":"hist","eval_metric":"mae"}'::JSONB
)
ON CONFLICT (model_name, version)
DO UPDATE SET
    mae = EXCLUDED.mae,
    rmse = EXCLUDED.rmse,
    mape = EXCLUDED.mape,
    r2 = EXCLUDED.r2,
    training_date = EXCLUDED.training_date,
    data_count = EXCLUDED.data_count,
    train_size = EXCLUDED.train_size,
    test_size = EXCLUDED.test_size,
    n_features = EXCLUDED.n_features,
    features = EXCLUDED.features,
    optimization_method = EXCLUDED.optimization_method,
    hyperparameters = EXCLUDED.hyperparameters,
    updated_at = NOW();

-- 創建或替換性能視圖
CREATE OR REPLACE VIEW v_model_performance AS
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
ORDER BY created_at DESC;

-- 添加註釋
COMMENT ON TABLE model_metrics IS '模型性能指標表 - 存儲訓練模型的性能數據';
COMMENT ON COLUMN model_metrics.mae IS '平均絕對誤差 (Mean Absolute Error)';
COMMENT ON COLUMN model_metrics.rmse IS '均方根誤差 (Root Mean Square Error)';
COMMENT ON COLUMN model_metrics.mape IS '平均絕對百分比誤差 (Mean Absolute Percentage Error)';
COMMENT ON COLUMN model_metrics.r2 IS 'R² 決定係數 (Coefficient of Determination)';
