#!/usr/bin/env python3
"""
Continuous Learning Engine
自動學習天氣和 AI 因素對 attendance 的影響

Daily Cron Job:
1. 獲取昨日實際數據
2. 獲取昨日預測
3. 計算誤差
4. 分析天氣條件
5. 分析 AI 因素
6. 更新學習記錄

Version: 4.0.00
Author: Ma Tsz Kiu
Date: 2026-01-18
"""

import os
import sys
import psycopg2
import pandas as pd
import numpy as np
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from weather_data_loader import get_weather_data_for_date, has_core_weather_fields

# HKT = UTC+8
HKT = timezone(timedelta(hours=8))
import json

# Fix Windows encoding
if sys.platform == 'win32':
    try:
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except:
        pass

# ============================================================
# Configuration
# ============================================================

HKO_WEATHER_API = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=tc"
ANOMALY_THRESHOLD = 15.0  # 誤差 > 15 人視為異常
HIGH_ANOMALY_THRESHOLD = 30.0  # 誤差 > 30 人視為高異常

# ============================================================
# Database Connection
# ============================================================

def get_db_connection():
    """獲取數據庫連接"""
    load_dotenv()
    database_url = os.getenv('DATABASE_URL')
    if database_url:
        conn = psycopg2.connect(database_url)
    else:
        conn = psycopg2.connect(
            host=os.getenv('PGHOST'),
            database=os.getenv('PGDATABASE'),
            user=os.getenv('PGUSER'),
            password=os.getenv('PGPASSWORD'),
        )
    return conn

def normalize_ai_factor_payload(ai_data):
    """相容 type/event_type 與 impactFactor/factor 欄位"""
    if not ai_data:
        return None

    if isinstance(ai_data, list):
        ai_data = ai_data[0] if len(ai_data) > 0 else None
    if not isinstance(ai_data, dict):
        return None

    normalized = dict(ai_data)
    event_type = normalized.get('event_type') or normalized.get('eventType') or normalized.get('type')
    factor = normalized.get('factor', normalized.get('impactFactor'))

    try:
        factor = float(factor) if factor is not None else None
    except (TypeError, ValueError):
        factor = None

    normalized['event_type'] = event_type
    normalized['type'] = event_type
    normalized['factor'] = factor
    if factor is not None:
        normalized['impactFactor'] = factor

    return normalized

# ============================================================
# Data Collection
# ============================================================

def fetch_hko_weather(date):
    """從本地快取或 HKO Daily Extract 載入指定日期歷史天氣"""
    try:
        return get_weather_data_for_date(date)
    except Exception as e:
        print(f"   ⚠️ Failed to fetch HKO weather: {e}")
        return None


def upsert_weather_history(cur, date, weather):
    """寫入或修補 weather_history 單日資料"""
    cur.execute("""
        INSERT INTO weather_history (
            date, temp_min, temp_max, temp_mean,
            humidity_pct, rainfall_mm, wind_kmh,
            pressure_hpa, visibility_km, cloud_pct,
            sunshine_hrs, dew_point, typhoon_signal,
            rainstorm_warning, cold_warning, hot_warning,
            is_very_cold, is_very_hot, is_heavy_rain,
            is_strong_wind, is_low_humidity, is_high_pressure,
            data_fetch_time
        ) VALUES (
            %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            NOW()
        )
        ON CONFLICT (date) DO UPDATE SET
            temp_min = EXCLUDED.temp_min,
            temp_max = EXCLUDED.temp_max,
            temp_mean = EXCLUDED.temp_mean,
            humidity_pct = EXCLUDED.humidity_pct,
            rainfall_mm = EXCLUDED.rainfall_mm,
            wind_kmh = EXCLUDED.wind_kmh,
            pressure_hpa = EXCLUDED.pressure_hpa,
            visibility_km = EXCLUDED.visibility_km,
            cloud_pct = EXCLUDED.cloud_pct,
            sunshine_hrs = EXCLUDED.sunshine_hrs,
            dew_point = EXCLUDED.dew_point,
            typhoon_signal = EXCLUDED.typhoon_signal,
            rainstorm_warning = EXCLUDED.rainstorm_warning,
            cold_warning = EXCLUDED.cold_warning,
            hot_warning = EXCLUDED.hot_warning,
            is_very_cold = EXCLUDED.is_very_cold,
            is_very_hot = EXCLUDED.is_very_hot,
            is_heavy_rain = EXCLUDED.is_heavy_rain,
            is_strong_wind = EXCLUDED.is_strong_wind,
            is_low_humidity = EXCLUDED.is_low_humidity,
            is_high_pressure = EXCLUDED.is_high_pressure,
            data_fetch_time = NOW()
    """, (
        date,
        weather.get('temp_min'),
        weather.get('temp_max'),
        weather.get('temp_mean'),
        weather.get('humidity_pct'),
        weather.get('rainfall_mm'),
        weather.get('wind_kmh'),
        weather.get('pressure_hpa'),
        weather.get('visibility_km'),
        weather.get('cloud_pct'),
        weather.get('sunshine_hrs'),
        weather.get('dew_point'),
        weather.get('typhoon_signal'),
        weather.get('rainstorm_warning'),
        weather.get('cold_warning'),
        weather.get('hot_warning'),
        weather.get('is_very_cold'),
        weather.get('is_very_hot'),
        weather.get('is_heavy_rain'),
        weather.get('is_strong_wind'),
        weather.get('is_low_humidity'),
        weather.get('is_high_pressure'),
    ))

def fetch_yesterday_data(date):
    """獲取指定日期的所有相關數據"""

    conn = get_db_connection()
    cur = conn.cursor()

    data = {
        'date': date,
        'actual': None,
        'prediction': None,
        'ai_factor': None,
        'weather': None
    }

    # 1. 獲取實際 attendance
    cur.execute("""
        SELECT patient_count
        FROM actual_data
        WHERE date = %s
    """, (date,))
    result = cur.fetchone()
    if result:
        data['actual'] = result[0]
        print(f"   ✅ Actual attendance: {data['actual']}")

    # 2. 獲取預測值（target_date 是 UTC 時間，需要用範圍查詢匹配 HKT 日期）
    from datetime import timedelta
    # date 參數可能是字符串或 date 對象
    if isinstance(date, str):
        date_obj = datetime.strptime(date, '%Y-%m-%d').date()
    else:
        date_obj = date
    # HKT 日期對應的 UTC 範圍：前一天 16:00 到當天 16:00
    utc_start = datetime.combine(date_obj - timedelta(days=1), datetime.min.time()) + timedelta(hours=16)
    utc_end = datetime.combine(date_obj, datetime.min.time()) + timedelta(hours=16)

    print(f"   🔍 Querying UTC range: {utc_start} to {utc_end}")

    cur.execute("""
        SELECT
            xgboost_base,
            prediction_production,
            prediction_experimental,
            ai_factor,
            weather_factor
        FROM daily_predictions
        WHERE target_date >= %s AND target_date < %s
        ORDER BY created_at DESC
        LIMIT 1
    """, (utc_start, utc_end))
    result = cur.fetchone()
    if result:
        data['prediction'] = {
            'xgboost_base': float(result[0]) if result[0] else None,
            'production': float(result[1]) if result[1] else None,
            'experimental': float(result[2]) if result[2] else None,
            'ai_factor': float(result[3]) if result[3] else None,
            'weather_factor': float(result[4]) if result[4] else None,
        }
        print(f"   ✅ Prediction: {data['prediction']['production']:.1f}")

    # 3. 獲取 AI factor 詳情（從 ai_factors JSONB 欄位，使用相同的 UTC 範圍）
    cur.execute("""
        SELECT
            ai_factors,
            weather_data
        FROM daily_predictions
        WHERE target_date >= %s AND target_date < %s
        ORDER BY created_at DESC
        LIMIT 1
    """, (utc_start, utc_end))
    result = cur.fetchone()
    if result and result[0]:
        import json
        ai_data = normalize_ai_factor_payload(result[0])
        data['ai_factor'] = ai_data
        print(f"   ✅ AI Factors: {json.dumps(ai_data, ensure_ascii=False)}")

    # 4. 獲取或獲取天氣數據
    cur.execute("""
        SELECT
            temp_min, temp_max, temp_mean,
            humidity_pct, rainfall_mm, wind_kmh,
            pressure_hpa, visibility_km,
            is_very_cold, is_very_hot, is_heavy_rain,
            is_strong_wind, typhoon_signal
        FROM weather_history
        WHERE date = %s
    """, (date,))
    result = cur.fetchone()
    if result:
        stored_weather = {
            'temp_min': float(result[0]) if result[0] else None,
            'temp_max': float(result[1]) if result[1] else None,
            'temp_mean': float(result[2]) if result[2] else None,
            'humidity_pct': float(result[3]) if result[3] else None,
            'rainfall_mm': float(result[4]) if result[4] else None,
            'wind_kmh': float(result[5]) if result[5] else None,
            'pressure_hpa': float(result[6]) if result[6] else None,
            'visibility_km': float(result[7]) if result[7] else None,
            'is_very_cold': result[8],
            'is_very_hot': result[9],
            'is_heavy_rain': result[10],
            'is_strong_wind': result[11],
            'typhoon_signal': result[12]
        }
        if has_core_weather_fields(stored_weather):
            data['weather'] = stored_weather

    if not data['weather']:
        print("   📡 Fetching historical weather from HKO Daily Extract...")
        fetched_weather = fetch_hko_weather(date)
        if fetched_weather and has_core_weather_fields(fetched_weather):
            upsert_weather_history(cur, date, fetched_weather)
            conn.commit()
            data['weather'] = fetched_weather
        else:
            print(f"   ⚠️ Historical weather unavailable for {date}")

    cur.close()
    conn.close()

    return data

# ============================================================
# Learning Engine
# ============================================================

def calculate_error_metrics(actual, predicted):
    """計算誤差指標"""
    error = actual - predicted
    error_pct = (error / actual * 100) if actual > 0 else 0
    return {
        'error': error,
        'error_pct': error_pct,
        'abs_error': abs(error)
    }

def detect_anomaly(error, std_threshold=2.5):
    """檢測是否為異常值"""
    return {
        'is_anomaly': abs(error) > ANOMALY_THRESHOLD,
        'is_high_anomaly': abs(error) > HIGH_ANOMALY_THRESHOLD,
        'severity': 'high' if abs(error) > HIGH_ANOMALY_THRESHOLD else 'medium' if abs(error) > ANOMALY_THRESHOLD else 'none'
    }

def analyze_weather_impact(data, error):
    """分析天氣對誤差的影響"""
    if not data.get('weather'):
        return None

    weather = data['weather']

    # 基於當前已知影響分析
    impact = {
        'temperature_effect': 0,
        'rain_effect': 0,
        'wind_effect': 0,
        'total_effect': 0
    }

    # 溫度效應
    if weather.get('is_very_cold'):
        impact['temperature_effect'] = -6.8  # 從歷史分析
    elif weather.get('is_very_hot'):
        impact['temperature_effect'] = 1.2

    # 雨效應
    if weather.get('is_heavy_rain'):
        impact['rain_effect'] = -4.9

    # 風效應
    if weather.get('is_strong_wind'):
        impact['wind_effect'] = -2.8

    # 總效應
    impact['total_effect'] = impact['temperature_effect'] + impact['rain_effect'] + impact['wind_effect']

    return impact

def analyze_ai_impact(data, error):
    """分析 AI 因素對誤差的影響"""
    if not data.get('ai_factor'):
        return None

    ai = normalize_ai_factor_payload(data['ai_factor'])
    if not ai:
        return None

    # 如果 AI factor 存在，檢查它是否改善了預測
    prediction = data.get('prediction', {})
    prediction_without_ai = prediction.get('production', 0)
    prediction_with_ai = prediction.get('experimental')

    impact = {
        'ai_factor': ai.get('factor'),
        'event_type': ai.get('event_type'),
        'improved': False,
        'improvement_amount': 0
    }

    if prediction_with_ai and data.get('actual'):
        error_without_ai = abs(data['actual'] - prediction_without_ai)
        error_with_ai = abs(data['actual'] - prediction_with_ai)
        impact['improved'] = error_with_ai < error_without_ai
        impact['improvement_amount'] = error_without_ai - error_with_ai

    return impact

# ============================================================
# Database Update
# ============================================================

def save_learning_record(conn, data, metrics, anomaly, weather_impact, ai_impact):
    """保存學習記錄到數據庫"""
    cur = conn.cursor()

    prediction = data.get('prediction', {})
    weather = data.get('weather', {})
    ai = normalize_ai_factor_payload(data.get('ai_factor'))

    cur.execute("""
        INSERT INTO learning_records (
            date,
            xgboost_base_pred,
            final_prediction,
            actual_attendance,
            prediction_error,
            error_pct,

            -- 天氣條件
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
            typhoon_signal,

            -- AI 因素
            ai_factor,
            ai_event_type,
            ai_description,

            -- 學習結果
            weather_impact_learned,
            ai_impact_learned,
            is_anomaly
        ) VALUES (
            %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s
        )
        ON CONFLICT (date) DO UPDATE SET
            xgboost_base_pred = EXCLUDED.xgboost_base_pred,
            final_prediction = EXCLUDED.final_prediction,
            actual_attendance = EXCLUDED.actual_attendance,
            prediction_error = EXCLUDED.prediction_error,
            error_pct = EXCLUDED.error_pct,
            temp_min = EXCLUDED.temp_min,
            temp_max = EXCLUDED.temp_max,
            rainfall_mm = EXCLUDED.rainfall_mm,
            wind_kmh = EXCLUDED.wind_kmh,
            humidity_pct = EXCLUDED.humidity_pct,
            pressure_hpa = EXCLUDED.pressure_hpa,
            is_very_cold = EXCLUDED.is_very_cold,
            is_very_hot = EXCLUDED.is_very_hot,
            is_heavy_rain = EXCLUDED.is_heavy_rain,
            is_strong_wind = EXCLUDED.is_strong_wind,
            typhoon_signal = EXCLUDED.typhoon_signal,
            ai_factor = EXCLUDED.ai_factor,
            ai_event_type = EXCLUDED.ai_event_type,
            ai_description = EXCLUDED.ai_description,
            weather_impact_learned = EXCLUDED.weather_impact_learned,
            ai_impact_learned = EXCLUDED.ai_impact_learned,
            is_anomaly = EXCLUDED.is_anomaly,
            processed = FALSE
    """, (
        data['date'],
        prediction.get('xgboost_base'),
        prediction.get('production'),
        data.get('actual'),
        metrics.get('error'),
        metrics.get('error_pct'),

        weather.get('temp_min'),
        weather.get('temp_max'),
        weather.get('rainfall_mm'),
        weather.get('wind_kmh'),
        weather.get('humidity_pct'),
        weather.get('pressure_hpa'),
        weather.get('is_very_cold') if weather else None,
        weather.get('is_very_hot') if weather else None,
        weather.get('is_heavy_rain') if weather else None,
        weather.get('is_strong_wind') if weather else None,
        weather.get('typhoon_signal') if weather else None,

        ai.get('factor') if ai else None,
        ai.get('event_type') if ai else None,
        ai.get('description') if ai else None,

        weather_impact.get('total_effect') if weather_impact else None,
        ai_impact.get('improvement_amount') if ai_impact else None,
        anomaly.get('is_anomaly', False)
    ))

    conn.commit()
    cur.close()

def update_anomaly_if_needed(conn, data, metrics, anomaly):
    """如果檢測到異常，記錄到異常表"""
    if not anomaly.get('is_anomaly'):
        return

    cur = conn.cursor()

    weather = data.get('weather', {})
    conditions = {
        'temp_min': weather.get('temp_min'),
        'temp_max': weather.get('temp_max'),
        'rainfall_mm': weather.get('rainfall_mm'),
        'is_very_cold': weather.get('is_very_cold', False) if weather else False,
        'is_heavy_rain': weather.get('is_heavy_rain', False) if weather else False
    }

    # 判斷異常類型
    anomaly_type = 'unknown'
    if weather and weather.get('typhoon_signal'):
        anomaly_type = 'weather'
    elif weather and (weather.get('is_very_cold') or weather.get('is_heavy_rain')):
        anomaly_type = 'weather'
    elif data.get('ai_factor'):
        anomaly_type = 'ai'

    cur.execute("""
        INSERT INTO anomaly_events (
            date,
            anomaly_type,
            prediction_error,
            conditions_json,
            requires_review
        ) VALUES (
            %s, %s, %s, %s, %s
        )
        ON CONFLICT (date) DO UPDATE SET
            prediction_error = EXCLUDED.prediction_error,
            conditions_json = EXCLUDED.conditions_json
    """, (
        data['date'],
        anomaly_type,
        metrics.get('error'),
        json.dumps(conditions),
        anomaly.get('severity') == 'high'
    ))

    conn.commit()
    cur.close()

# ============================================================
# Main Learning Loop
# ============================================================

def process_date(date):
    """處理單日數據"""
    print(f"Processing date: {date}")

    # 1. 獲取數據
    data = fetch_yesterday_data(date)

    if not data.get('actual'):
        print(f"   ⚠️ No actual data for {date}")
        return False

    if not data.get('prediction'):
        print(f"   ⚠️ No prediction data for {date}")
        return False

    # 2. 計算誤差
    metrics = calculate_error_metrics(
        data['actual'],
        data['prediction']['production']
    )

    print(f"   Error: {metrics['error']:.1f} ({metrics['error_pct']:.1f}%)")

    # 3. 檢測異常
    anomaly = detect_anomaly(metrics['error'])
    if anomaly['is_anomaly']:
        print(f"   ⚠️ Anomaly detected! Severity: {anomaly['severity']}")

    # 4. 分析天氣影響
    weather_impact = analyze_weather_impact(data, metrics['error'])
    if weather_impact and weather_impact['total_effect'] != 0:
        print(f"   Weather impact: {weather_impact['total_effect']:.1f}")

    # 5. 分析 AI 影響
    ai_impact = analyze_ai_impact(data, metrics['error'])
    if ai_impact and ai_impact.get('improved'):
        print(f"   ✅ AI improved prediction by {ai_impact['improvement_amount']:.1f}")

    # 6. 保存到數據庫
    conn = get_db_connection()
    try:
        save_learning_record(conn, data, metrics, anomaly, weather_impact, ai_impact)
        update_anomaly_if_needed(conn, data, metrics, anomaly)
        print(f"   ✅ Saved to database")
    except Exception as e:
        print(f"   ❌ Error saving: {e}")
    finally:
        conn.close()

    return True

def get_yesterday_hkt():
    """HKT 昨天（避免 server 在 UTC 時跑錯日）"""
    now_hkt = datetime.now(HKT)
    return (now_hkt - timedelta(days=1)).date()


def run_catch_up(conn, end_date):
    """補跑：從 last_learning_date+1 到 end_date 之間，有 actual 但無 learning_record 的日期"""
    cur = conn.cursor()
    cur.execute("""
        SELECT ad.date
        FROM actual_data ad
        LEFT JOIN learning_records lr ON lr.date = ad.date
        WHERE lr.date IS NULL
          AND ad.date > (SELECT COALESCE(MAX(date), '1900-01-01')::date FROM learning_records)
          AND ad.date <= %s
        ORDER BY ad.date
    """, (end_date,))
    rows = cur.fetchall()
    cur.close()
    return [r[0] for r in rows]


def main():
    """主函數 - 處理 HKT 昨天的數據；--catch-up 時一併補跑缺口日"""
    yesterday = get_yesterday_hkt()
    do_catch_up = '--catch-up' in (sys.argv or [])

    print("=" * 60)
    print("Continuous Learning Engine v4.0.00")
    print("=" * 60)
    print(f"Processing (HKT yesterday): {yesterday}")
    if do_catch_up:
        print("   --catch-up: 補跑缺口日")
    print()

    success = process_date(yesterday)

    if do_catch_up:
        conn = get_db_connection()
        try:
            gap_dates = run_catch_up(conn, yesterday)
        except Exception as e:
            print(f"   ⚠️ Catch-up query error: {e}")
            gap_dates = []
        finally:
            try:
                conn.close()
            except Exception:
                pass
        for d in (gap_dates or []):
            if d != yesterday:  # 已處理
                process_date(d)

    print()
    if success:
        print("✅ Learning complete")
    else:
        print("⚠️ Learning incomplete - missing data")

if __name__ == '__main__':
    main()
