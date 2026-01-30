#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
直接執行學習記錄創建 - 使用 2026-01-17
"""
import os
import sys
import io
import psycopg2
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from dotenv import load_dotenv
import json
import requests

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
print("測試學習記錄創建: 2026-01-17")
print("=" * 60)
print()

try:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    date = "2026-01-17"

    # 1. 獲取實際數據
    print(f"1️⃣ 獲取實際數據...")
    cur.execute("""
        SELECT patient_count
        FROM actual_data
        WHERE date = %s
    """, (date,))
    actual_result = cur.fetchone()
    if not actual_result:
        print(f"   ❌ 沒有實際數據")
        sys.exit(1)
    actual = actual_result[0]
    print(f"   ✅ 實際就診: {actual} 人")

    # 2. 獲取預測數據
    print(f"2️⃣ 獲取預測數據...")
    cur.execute("""
        SELECT
            xgboost_base,
            prediction_production,
            prediction_experimental,
            ai_factor,
            weather_factor
        FROM daily_predictions
        WHERE target_date = %s
        ORDER BY created_at DESC
        LIMIT 1
    """, (date,))
    pred_result = cur.fetchone()
    if not pred_result:
        print(f"   ❌ 沒有預測數據")
        sys.exit(1)
    xgb_base, prod_pred, exp_pred, ai_factor, weather_factor = pred_result
    print(f"   ✅ XGBoost: {xgb_base}, 生產預測: {prod_pred}")

    # 3. 計算誤差
    print(f"3️⃣ 計算誤差...")
    error = abs(actual - float(prod_pred))
    error_pct = (error / actual * 100) if actual > 0 else 0
    print(f"   誤差: {error:.1f} 人 ({error_pct:.1f}%)")

    # 4. 獲取天氣數據
    print(f"4️⃣ 獲取天氣數據...")
    cur.execute("""
        SELECT
            temp_min, temp_max, rainfall_mm, wind_kmh,
            humidity_pct, pressure_hpa
        FROM weather_history
        WHERE date = %s
        LIMIT 1
    """, (date,))
    weather_result = cur.fetchone()
    if weather_result:
        temp_min, temp_max, rain, wind, humidity, pressure = weather_result
        print(f"   ✅ 溫度: {temp_min}°C-{temp_max}°C, 雨量: {rain}mm")

    # 5. 插入學習記錄
    print(f"5️⃣ 插入學習記錄...")
    cur.execute("""
        INSERT INTO learning_records (
            date,
            xgboost_base_pred,
            final_prediction,
            actual_attendance,
            prediction_error,
            error_pct,
            temp_min,
            temp_max,
            rainfall_mm,
            wind_kmh,
            humidity_pct,
            pressure_hpa,
            is_very_cold,
            is_very_hot,
            is_heavy_rain,
            is_strong_wind,
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
        date, xgb_base, prod_pred, actual, error, error_pct,
        temp_min if weather_result else None,
        temp_max if weather_result else None,
        rain if weather_result else None,
        wind if weather_result else None,
        humidity if weather_result else None,
        pressure if weather_result else None,
        (temp_min < 10) if weather_result else False,
        (temp_max > 32) if weather_result else False,
        (rain > 30) if weather_result else False,
        (wind > 40) if weather_result else False,
        ai_factor
    ))

    conn.commit()
    print(f"   ✅ 學習記錄已保存！")

    # 6. 驗證
    print(f"6️⃣ 驗證記錄...")
    cur.execute("SELECT COUNT(*) FROM learning_records")
    count = cur.fetchone()[0]
    print(f"   ✅ 總學習記錄數: {count}")

    cur.close()
    conn.close()

    print()
    print("=" * 60)
    print("✅ 測試成功！學習記錄已創建")
    print("=" * 60)

except Exception as e:
    print(f"\n❌ 錯誤: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
