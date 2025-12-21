-- 簡化版本：只插入實際數據，準確度計算由應用程序自動完成
-- 在 Railway 數據庫控制台執行此腳本

-- 插入或更新實際數據（1/12 到 12/12）
INSERT INTO actual_data (date, patient_count, source, notes)
VALUES 
    ('2025-12-01', 276, 'manual_upload', 'Added via SQL script on 2025-12-15'),
    ('2025-12-02', 285, 'manual_upload', 'Added via SQL script on 2025-12-15'),
    ('2025-12-03', 253, 'manual_upload', 'Added via SQL script on 2025-12-15'),
    ('2025-12-04', 234, 'manual_upload', 'Added via SQL script on 2025-12-15'),
    ('2025-12-05', 262, 'manual_upload', 'Added via SQL script on 2025-12-15'),
    ('2025-12-06', 234, 'manual_upload', 'Added via SQL script on 2025-12-15'),
    ('2025-12-07', 244, 'manual_upload', 'Added via SQL script on 2025-12-15'),
    ('2025-12-08', 293, 'manual_upload', 'Added via SQL script on 2025-12-15'),
    ('2025-12-09', 253, 'manual_upload', 'Added via SQL script on 2025-12-15'),
    ('2025-12-10', 219, 'manual_upload', 'Added via SQL script on 2025-12-15'),
    ('2025-12-11', 275, 'manual_upload', 'Added via SQL script on 2025-12-15'),
    ('2025-12-12', 248, 'manual_upload', 'Added via SQL script on 2025-12-15')
ON CONFLICT (date) DO UPDATE SET
    patient_count = EXCLUDED.patient_count,
    source = EXCLUDED.source,
    notes = EXCLUDED.notes;

-- 驗證數據已插入
SELECT 
    date,
    patient_count,
    source,
    created_at
FROM actual_data
WHERE date BETWEEN '2025-12-01' AND '2025-12-12'
ORDER BY date;

-- 注意：準確度計算會在下一次應用程序運行時自動完成
-- 或者可以通過 API 端點觸發：POST /api/calculate-accuracy?date=2025-12-01
