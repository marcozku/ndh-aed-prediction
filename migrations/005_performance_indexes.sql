-- ============================================
-- Performance Optimization Indexes
-- Migration 005 - 2026-01-30
-- ============================================

-- 1. actual_data 表索引優化
CREATE INDEX IF NOT EXISTS idx_actual_data_date ON actual_data(date DESC);
CREATE INDEX IF NOT EXISTS idx_actual_data_created_at ON actual_data(created_at DESC);

-- 2. predictions 表索引優化
CREATE INDEX IF NOT EXISTS idx_predictions_target_date ON predictions(target_date DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_created_at ON predictions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_target_created ON predictions(target_date, created_at DESC);

-- 3. prediction_accuracy 表索引優化
CREATE INDEX IF NOT EXISTS idx_prediction_accuracy_target_date ON prediction_accuracy(target_date DESC);
CREATE INDEX IF NOT EXISTS idx_prediction_accuracy_created_at ON prediction_accuracy(created_at DESC);

-- 4. final_daily_predictions 表索引優化
CREATE INDEX IF NOT EXISTS idx_final_daily_predictions_target_date ON final_daily_predictions(target_date DESC);
CREATE INDEX IF NOT EXISTS idx_final_daily_predictions_calculated_at ON final_daily_predictions(calculated_at DESC);

-- 5. reliability_history 表索引優化
CREATE INDEX IF NOT EXISTS idx_reliability_history_date ON reliability_history(date DESC);
CREATE INDEX IF NOT EXISTS idx_reliability_history_created_at ON reliability_history(created_at DESC);

-- 6. timeslot_accuracy 表索引優化（複合索引）
CREATE INDEX IF NOT EXISTS idx_timeslot_accuracy_slot_date ON timeslot_accuracy(time_slot, target_date DESC);

-- 7. training_status 表索引優化
CREATE INDEX IF NOT EXISTS idx_training_status_updated_at ON training_status(updated_at DESC);

-- 8. model_metrics 表索引優化
CREATE INDEX IF NOT EXISTS idx_model_metrics_updated_at ON model_metrics(updated_at DESC);

-- 9. auto_predict_stats 表索引優化
CREATE INDEX IF NOT EXISTS idx_auto_predict_stats_stat_date ON auto_predict_stats(stat_date DESC);

-- 10. ai_factors_cache 表索引優化
CREATE INDEX IF NOT EXISTS idx_ai_factors_cache_updated_at ON ai_factors_cache(updated_at DESC);

-- 11. smoothing_config 表索引優化
CREATE INDEX IF NOT EXISTS idx_smoothing_config_active ON smoothing_config(is_active) WHERE is_active = true;

-- ============================================
-- 查詢性能分析視圖
-- ============================================

-- 創建視圖：最近預測準確度
CREATE OR REPLACE VIEW v_recent_accuracy AS
SELECT
    pa.target_date,
    pa.predicted_count,
    pa.actual_count,
    pa.error,
    pa.error_percentage,
    pa.within_ci80,
    pa.within_ci95,
    pa.created_at
FROM prediction_accuracy pa
ORDER BY pa.target_date DESC
LIMIT 100;

-- 創建視圖：模型性能摘要
CREATE OR REPLACE VIEW v_model_performance AS
SELECT
    model_name,
    mae,
    rmse,
    mape,
    r2,
    training_date,
    data_count,
    updated_at
FROM model_metrics
ORDER BY updated_at DESC;

-- ============================================
-- 性能優化說明
-- ============================================

-- 索引策略：
-- 1. 所有日期欄位都添加降序索引（最新數據查詢最頻繁）
-- 2. 複合索引用於常見的多欄位查詢
-- 3. 部分索引用於條件查詢（如 is_active = true）
-- 4. 視圖用於簡化常見查詢

-- 預期改進：
-- - 查詢速度提升 50-80%
-- - 減少全表掃描
-- - 優化 JOIN 操作
-- - 加快排序和分組查詢

COMMENT ON INDEX idx_actual_data_date IS '優化實際數據日期查詢';
COMMENT ON INDEX idx_predictions_target_created IS '優化預測數據複合查詢';
COMMENT ON INDEX idx_timeslot_accuracy_slot_date IS '優化時段準確度查詢';
COMMENT ON VIEW v_recent_accuracy IS '最近100筆預測準確度視圖';
COMMENT ON VIEW v_model_performance IS '模型性能摘要視圖';
