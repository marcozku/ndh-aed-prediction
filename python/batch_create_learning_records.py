#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
批量創建學習記錄 - 最近 10 天有實際數據的日期
"""
import os
import sys
import io
import psycopg2
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Fix Windows encoding FIRST
if sys.platform == 'win32':
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except:
        pass

# Load environment
load_dotenv()
DATABASE_URL = os.environ.get('DATABASE_URL',
    'postgresql://postgres:nIdJPREHqkBdMgUifrazOsVlWbxsmDGq@tramway.proxy.rlwy.net:45703/railway')

print("=" * 60)
print("批量創建學習記錄 - 最近 10 天")
print("=" * 60)
print()

try:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # 1. 找出最近有實際數據和預測的日期
    print("1️⃣ 查找有實際數據和預測的日期...")
    cur.execute("""
        SELECT a.date, a.patient_count, p.xgboost_base, p.prediction_production,
               p.ai_factor, p.weather_factor
        FROM actual_data a
        INNER JOIN daily_predictions p ON a.date = p.target_date
        ORDER BY a.date DESC
        LIMIT 10
    """)

    rows = cur.fetchall()
    if not rows:
        print("   ❌ 沒有找到匹配的數據")
        sys.exit(1)

    print(f"   ✅ 找到 {len(rows)} 筆數據\n")

    # 2. 批量創建學習記錄
    print("2️⃣ 創建學習記錄...")
    created = 0
    skipped = 0

    for row in rows:
        date_str, actual, xgb_base, prod_pred, ai_factor, weather_factor = row

        # 計算誤差
        prod_pred = float(prod_pred) if prod_pred else float(xgb_base)
        error = abs(actual - prod_pred)
        error_pct = (error / actual * 100) if actual > 0 else 0

        # 獲取天氣數據
        cur.execute("""
            SELECT temp_min, temp_max, rainfall_mm, wind_kmh,
                   humidity_pct, pressure_hpa
            FROM weather_history
            WHERE date = %s
            LIMIT 1
        """, (date_str,))
        weather_result = cur.fetchone()

        temp_min, temp_max, rain, wind, humidity, pressure = weather_result if weather_result else (None,) * 6

        # 插入學習記錄
        try:
            cur.execute("""
                INSERT INTO learning_records (
                    date, xgboost_base_pred, final_prediction, actual_attendance,
                    prediction_error, error_pct,
                    temp_min, temp_max, rainfall_mm, wind_kmh, humidity_pct, pressure_hpa,
                    is_very_cold, is_very_hot, is_heavy_rain, is_strong_wind,
                    ai_factor
                ) VALUES (
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s
                )
                ON CONFLICT (date) DO UPDATE SET
                    actual_attendance = EXCLUDED.actual_attendance,
                    prediction_error = EXCLUDED.prediction_error,
                    error_pct = EXCLUDED.error_pct
            """, (
                date_str, xgb_base, prod_pred, actual, error, error_pct,
                temp_min, temp_max, rain, wind, humidity, pressure,
                (temp_min < 10) if temp_min else False,
                (temp_max > 32) if temp_max else False,
                (rain > 30) if rain else False,
                (wind > 40) if wind else False,
                ai_factor
            ))
            created += 1
            print(f"   ✅ {date_str}: 實際={actual}, 預測={prod_pred:.0f}, 誤差={error:.1f} ({error_pct:.1f}%)")

        except Exception as e:
            skipped += 1
            print(f"   ⚠️  {date_str}: 跳過 ({e})")

    conn.commit()

    print()
    print(f"   創建: {created} 筆")
    print(f"   跳過: {skipped} 筆")

    # 3. 驗證
    print()
    print("3️⃣ 驗證總學習記錄數...")
    cur.execute("SELECT COUNT(*) FROM learning_records")
    total = cur.fetchone()[0]
    print(f"   ✅ 總學習記錄數: {total}")

    # 4. 計算平均誤差
    print()
    print("4️⃣ 計算平均誤差...")
    cur.execute("""
        SELECT AVG(prediction_error), AVG(error_pct)
        FROM learning_records
        WHERE actual_attendance IS NOT NULL
    """)
    result = cur.fetchone()
    if result and result[0]:
        avg_error = float(result[0])
        avg_pct = float(result[1])
        print(f"   ✅ 平均絕對誤差: {avg_error:.2f} 人")
        print(f"   ✅ 平均百分比誤差: {avg_pct:.2f}%")

    cur.close()
    conn.close()

    print()
    print("=" * 60)
    print("✅ 批量創建完成！")
    print("=" * 60)

except Exception as e:
    print(f"\n❌ 錯誤: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
