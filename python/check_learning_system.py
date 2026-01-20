# -*- coding: utf-8 -*-
"""
檢查自動學習系統狀態
"""
import sys
import io
import psycopg2
from datetime import datetime
import os

if sys.platform == 'win32':
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except:
        pass

DATABASE_URL = os.environ.get('DATABASE_URL',
    'postgresql://postgres:nIdJPREHqkBdMgUifrazOsVlWbxsmDGq@tramway.proxy.rlwy.net:45703/railway')

print("🔍 檢查自動學習系統狀態...")
print(f"數據庫: {DATABASE_URL.split('@')[1] if '@' in DATABASE_URL else 'unknown'}\n")

try:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # 1. 檢查學習記錄
    print("📊 1. 學習記錄 (learning_records)")
    try:
        cur.execute("SELECT COUNT(*) FROM learning_records")
        count = cur.fetchone()[0]
        print(f"   總記錄數: {count}")

        if count > 0:
            cur.execute("""
                SELECT date, xgboost_base_pred, final_prediction, actual_attendance,
                       prediction_error, error_pct, created_at
                FROM learning_records
                ORDER BY date DESC
                LIMIT 5
            """)
            records = cur.fetchall()
            print(f"   最近 {len(records)} 筆記錄:")
            for r in records:
                print(f"     {r[0]}: 實際={r[3]}, 預測={r[2]}, 誤差={r[4]:.1f} ({r[5]:.1f}%)")
        else:
            print("   ⚠️  沒有學習記錄")
    except Exception as e:
        print(f"   ❌ 表不存在或查詢失敗: {e}")

    print()

    # 2. 檢查天氣影響參數
    print("🌤️  2. 天氣影響參數 (weather_impact_parameters)")
    try:
        cur.execute("SELECT COUNT(*) FROM weather_impact_parameters")
        count = cur.fetchone()[0]
        print(f"   總參數數: {count}")

        cur.execute("""
            SELECT parameter_name, parameter_value, sample_count, last_updated
            FROM weather_impact_parameters
            ORDER BY ABS(parameter_value::float) DESC
            LIMIT 5
        """)
        params = cur.fetchall()
        print(f"   影響最大的 {len(params)} 個參數:")
        for p in params:
            print(f"     {p[0]}: {p[1]} (n={p[2]}, 更新於 {p[3].strftime('%Y-%m-%d')})")
    except Exception as e:
        print(f"   ❌ 表不存在或查詢失敗: {e}")

    print()

    # 3. 檢查異常事件
    print("⚠️  3. 異常事件 (anomaly_events)")
    try:
        cur.execute("SELECT COUNT(*) FROM anomaly_events")
        count = cur.fetchone()[0]
        print(f"   總異常數: {count}")

        if count > 0:
            cur.execute("""
                SELECT event_date, anomaly_type, magnitude, description
                FROM anomaly_events
                ORDER BY event_date DESC
                LIMIT 5
            """)
            anomalies = cur.fetchall()
            print(f"   最近 {len(anomalies)} 個異常:")
            for a in anomalies:
                print(f"     {a[0]}: {a[1]} ({a[2]:.1f}x) - {a[3]}")
        else:
            print("   ✅ 沒有異常事件")
    except Exception as e:
        print(f"   ❌ 表不存在或查詢失敗: {e}")

    print()

    # 4. 檢查天氣預報緩存
    print("📡 4. 天氣預報緩存 (weather_forecast_cache)")
    try:
        cur.execute("SELECT COUNT(*) FROM weather_forecast_cache")
        count = cur.fetchone()[0]
        print(f"   緩存記錄數: {count}")

        if count > 0:
            cur.execute("""
                SELECT forecast_date, cache_date, temperature_min, temperature_max
                FROM weather_forecast_cache
                ORDER BY cache_date DESC
                LIMIT 3
            """)
            forecasts = cur.fetchall()
            print(f"   最近緩存:")
            for f in forecasts:
                print(f"     預報日期 {f[0]}, 緩存於 {f[1].strftime('%Y-%m-%d %H:%M')}")
        else:
            print("   ⚠️  沒有預報緩存")
    except Exception as e:
        print(f"   ❌ 表不存在或查詢失敗: {e}")

    print()

    # 5. 檢查表是否存在
    print("📋 5. 學習系統表檢查")
    tables = [
        'learning_records',
        'weather_impact_parameters',
        'weather_combination_impacts',
        'ai_event_learning',
        'weather_forecast_cache',
        'anomaly_events',
        'weather_history'
    ]
    for table in tables:
        try:
            cur.execute(f"SELECT 1 FROM {table} LIMIT 1")
            print(f"   ✅ {table}")
        except:
            print(f"   ❌ {table} (不存在)")

    cur.close()
    conn.close()

except Exception as e:
    print(f"\n❌ 連接失敗: {e}")
