-- 添加 1/12 到 12/12 的實際數據並計算準確度
-- 在 Railway 數據庫控制台執行此腳本

-- 插入或更新實際數據
INSERT INTO actual_data (date, patient_count, source, notes)
VALUES 
    ('2025-12-01', 276, 'manual_upload', 'Added via SQL script'),
    ('2025-12-02', 285, 'manual_upload', 'Added via SQL script'),
    ('2025-12-03', 253, 'manual_upload', 'Added via SQL script'),
    ('2025-12-04', 234, 'manual_upload', 'Added via SQL script'),
    ('2025-12-05', 262, 'manual_upload', 'Added via SQL script'),
    ('2025-12-06', 234, 'manual_upload', 'Added via SQL script'),
    ('2025-12-07', 244, 'manual_upload', 'Added via SQL script'),
    ('2025-12-08', 293, 'manual_upload', 'Added via SQL script'),
    ('2025-12-09', 253, 'manual_upload', 'Added via SQL script'),
    ('2025-12-10', 219, 'manual_upload', 'Added via SQL script'),
    ('2025-12-11', 275, 'manual_upload', 'Added via SQL script'),
    ('2025-12-12', 248, 'manual_upload', 'Added via SQL script')
ON CONFLICT (date) DO UPDATE SET
    patient_count = EXCLUDED.patient_count,
    source = EXCLUDED.source,
    notes = EXCLUDED.notes;

-- 計算準確度（對於每個日期）
-- 注意：這需要手動執行，因為需要查找預測數據

-- 對於每個日期，執行以下查詢來計算準確度：
-- 1. 查找預測數據
-- 2. 計算誤差和誤差百分比
-- 3. 檢查是否在置信區間內
-- 4. 插入或更新 prediction_accuracy 表

-- 示例：為 2025-12-01 計算準確度
DO $$
DECLARE
    target_date DATE;
    actual_count INTEGER;
    predicted_count INTEGER;
    predicted_count_found INTEGER;
    ci80_low_val INTEGER;
    ci80_high_val INTEGER;
    ci95_low_val INTEGER;
    ci95_high_val INTEGER;
    error_val INTEGER;
    error_pct DECIMAL(5,2);
    in_ci80 BOOLEAN;
    in_ci95 BOOLEAN;
BEGIN
    -- 處理每個日期
    FOR target_date IN 
        SELECT date FROM actual_data 
        WHERE date BETWEEN '2025-12-01' AND '2025-12-12'
        ORDER BY date
    LOOP
        -- 獲取實際數據
        SELECT patient_count INTO actual_count
        FROM actual_data WHERE date = target_date;
        
        -- 獲取預測數據（優先使用 final_daily_predictions）
        SELECT 
            COALESCE(
                (SELECT predicted_count FROM final_daily_predictions WHERE target_date = target_date),
                (SELECT predicted_count FROM daily_predictions WHERE target_date = target_date ORDER BY created_at DESC LIMIT 1),
                (SELECT predicted_count FROM predictions WHERE target_date = target_date ORDER BY created_at DESC LIMIT 1)
            ),
            COALESCE(
                (SELECT ci80_low FROM final_daily_predictions WHERE target_date = target_date),
                (SELECT ci80_low FROM daily_predictions WHERE target_date = target_date ORDER BY created_at DESC LIMIT 1),
                (SELECT ci80_low FROM predictions WHERE target_date = target_date ORDER BY created_at DESC LIMIT 1)
            ),
            COALESCE(
                (SELECT ci80_high FROM final_daily_predictions WHERE target_date = target_date),
                (SELECT ci80_high FROM daily_predictions WHERE target_date = target_date ORDER BY created_at DESC LIMIT 1),
                (SELECT ci80_high FROM predictions WHERE target_date = target_date ORDER BY created_at DESC LIMIT 1)
            ),
            COALESCE(
                (SELECT ci95_low FROM final_daily_predictions WHERE target_date = target_date),
                (SELECT ci95_low FROM daily_predictions WHERE target_date = target_date ORDER BY created_at DESC LIMIT 1),
                (SELECT ci95_low FROM predictions WHERE target_date = target_date ORDER BY created_at DESC LIMIT 1)
            ),
            COALESCE(
                (SELECT ci95_high FROM final_daily_predictions WHERE target_date = target_date),
                (SELECT ci95_high FROM daily_predictions WHERE target_date = target_date ORDER BY created_at DESC LIMIT 1),
                (SELECT ci95_high FROM predictions WHERE target_date = target_date ORDER BY created_at DESC LIMIT 1)
            )
        INTO predicted_count_found, ci80_low_val, ci80_high_val, ci95_low_val, ci95_high_val;
        
        -- 如果找到預測數據，計算準確度
        IF predicted_count_found IS NOT NULL THEN
            error_val := predicted_count_found - actual_count;
            error_pct := ROUND((error_val::DECIMAL / predicted_count_found * 100)::NUMERIC, 2);
            in_ci80 := (ci80_low_val IS NOT NULL AND ci80_high_val IS NOT NULL AND actual_count >= ci80_low_val AND actual_count <= ci80_high_val);
            in_ci95 := (ci95_low_val IS NOT NULL AND ci95_high_val IS NOT NULL AND actual_count >= ci95_low_val AND actual_count <= ci95_high_val);
            
            -- 插入或更新準確度記錄
            INSERT INTO prediction_accuracy (
                target_date, predicted_count, actual_count, 
                error_percentage, within_ci80, within_ci95
            )
            VALUES (
                target_date, predicted_count_found, actual_count,
                error_pct, in_ci80, in_ci95
            )
            ON CONFLICT (target_date) DO UPDATE SET
                predicted_count = EXCLUDED.predicted_count,
                actual_count = EXCLUDED.actual_count,
                error_percentage = EXCLUDED.error_percentage,
                within_ci80 = EXCLUDED.within_ci80,
                within_ci95 = EXCLUDED.in_ci95,
                updated_at = CURRENT_TIMESTAMP;
        END IF;
    END LOOP;
END $$;

-- 查看結果
SELECT 
    pa.target_date,
    pa.actual_count,
    pa.predicted_count,
    pa.error_percentage,
    pa.within_ci80,
    pa.within_ci95,
    CASE 
        WHEN pa.within_ci95 THEN '✅ 在 95% CI 內'
        WHEN pa.within_ci80 THEN '⚠️ 在 80% CI 內'
        ELSE '❌ 在 CI 外'
    END as accuracy_status
FROM prediction_accuracy pa
WHERE pa.target_date BETWEEN '2025-12-01' AND '2025-12-12'
ORDER BY pa.target_date;
