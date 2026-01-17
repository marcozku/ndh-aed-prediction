#!/usr/bin/env python3
"""
異常檢測與分析模組
Anomaly Detection and Analysis

功能:
1. 檢測預測異常
2. 分類異常原因 (天氣/AI/未知)
3. 尋找類似歷史事件
4. 生成異常報告

Version: 4.0.00
Author: Ma Tsz Kiu
Date: 2026-01-18
"""

import psycopg2
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from dotenv import load_dotenv
import os
import json

# ============================================================
# Anomaly Detection
# ============================================================

def calculate_baseline_stats(conn, days=90):
    """計算基線統計 (過去 N 天的誤差分佈)"""
    cur = conn.cursor()

    cur.execute("""
        SELECT
            AVG(prediction_error) as mean_error,
            STDDEV(prediction_error) as std_error,
            MIN(prediction_error) as min_error,
            MAX(prediction_error) as max_error,
            COUNT(*) as sample_count
        FROM learning_records
        WHERE date >= CURRENT_DATE - INTERVAL '%s days'
          AND actual_attendance IS NOT NULL
    """ % days)

    result = cur.fetchone()
    cur.close()

    if not result or result[4] < 10:
        return {
            'mean': 0,
            'std': 10,
            'min': -30,
            'max': 30,
            'count': 0
        }

    return {
        'mean': float(result[0]) if result[0] else 0,
        'std': float(result[1]) if result[1] else 10,
        'min': float(result[2]) if result[2] else -30,
        'max': float(result[3]) if result[3] else 30,
        'count': int(result[4])
    }

def classify_anomaly(conn, date, error, weather=None, ai_factor=None):
    """分類異常原因"""

    classification = {
        'type': 'unknown',
        'confidence': 'low',
        'reason': [],
        'suggested_adjustment': 0
    }

    # 1. 檢查是否為天氣異常
    if weather:
        weather_causes = []

        if weather.get('is_very_cold'):
            weather_causes.append('very_cold')
            classification['suggested_adjustment'] -= 6.8

        if weather.get('is_heavy_rain'):
            weather_causes.append('heavy_rain')
            classification['suggested_adjustment'] -= 4.9

        if weather.get('typhoon_signal') and weather['typhoon_signal'] in ['T8', 'T9', 'T10']:
            weather_causes.append('typhoon')
            classification['suggested_adjustment'] -= 12.0

        if len(weather_causes) > 0:
            classification['type'] = 'weather'
            classification['confidence'] = 'high' if len(weather_causes) >= 2 else 'medium'
            classification['reason'] = weather_causes

    # 2. 檢查是否為 AI 事件異常
    if ai_factor and abs(ai_factor.get('factor', 1.0) - 1.0) > 0.05:
        if classification['type'] == 'unknown':
            classification['type'] = 'ai'
            classification['reason'] = [ai_factor.get('event_type', 'unknown_ai_event')]
            classification['confidence'] = 'medium'

    return classification

def find_similar_events(conn, current_weather, current_ai, limit=10):
    """尋找類似的歷史事件"""
    cur = conn.cursor()

    conditions = []
    params = []

    if current_weather:
        if current_weather.get('is_very_cold'):
            conditions.append("is_very_cold = TRUE")
        if current_weather.get('is_heavy_rain'):
            conditions.append("is_heavy_rain = TRUE")
        if current_weather.get('is_strong_wind'):
            conditions.append("is_strong_wind = TRUE")

    if current_ai:
        if current_ai.get('event_type'):
            conditions.append("ai_event_type = %s")
            params.append(current_ai['event_type'])

    where_clause = " AND ".join(conditions) if conditions else "TRUE"

    query = f"""
        SELECT
            date,
            actual_attendance,
            prediction_error,
            is_very_cold,
            is_heavy_rain,
            is_strong_wind,
            ai_event_type
        FROM learning_records
        WHERE {where_clause}
          AND actual_attendance IS NOT NULL
        ORDER BY date DESC
        LIMIT %s
    """

    cur.execute(query, params + [limit])
    results = cur.fetchall()
    cur.close()

    return [
        {
            'date': str(r[0]),
            'actual': float(r[1]),
            'error': float(r[2]),
            'conditions': {
                'is_very_cold': r[3],
                'is_heavy_rain': r[4],
                'is_strong_wind': r[5],
                'ai_event': r[6]
            }
        }
        for r in results
    ]

def generate_anomaly_report(conn, date):
    """生成異常報告"""

    cur = conn.cursor()

    cur.execute("""
        SELECT
            date,
            actual_attendance,
            final_prediction,
            prediction_error,
            temp_min,
            temp_max,
            rainfall_mm,
            is_very_cold,
            is_heavy_rain,
            ai_factor,
            ai_event_type
        FROM learning_records
        WHERE date = %s
    """, (date,))

    result = cur.fetchone()
    if not result:
        return None

    cur.close()

    report = {
        'date': str(result[0]),
        'actual': float(result[1]),
        'predicted': float(result[2]),
        'error': float(result[3]),
        'error_pct': (float(result[3]) / float(result[1]) * 100) if result[1] else 0,

        'conditions': {
            'temp_min': float(result[4]) if result[4] else None,
            'temp_max': float(result[5]) if result[5] else None,
            'rainfall_mm': float(result[6]) if result[6] else None,
            'is_very_cold': result[7],
            'is_heavy_rain': result[8]
        },

        'ai_factor': {
            'factor': float(result[9]) if result[9] else None,
            'event_type': result[10]
        }
    }

    return report

def update_anomaly_classifications(conn):
    """更新所有未分類的異常"""
    cur = conn.cursor()

    # 獲取所有未解釋的異常
    cur.execute("""
        SELECT
            ae.date,
            ae.prediction_error,
            ae.conditions_json,
            lr.is_very_cold,
            lr.is_heavy_rain,
            lr.is_strong_wind,
            lr.typhoon_signal,
            lr.ai_event_type,
            lr.ai_factor
        FROM anomaly_events ae
        LEFT JOIN learning_records lr ON lr.date = ae.date
        WHERE ae.is_explained = FALSE
        ORDER BY ae.date DESC
    """)

    anomalies = cur.fetchall()

    updated_count = 0

    for row in anomalies:
        date = row[0]
        error = row[1]
        conditions_json = row[2]

        # 解析條件
        conditions = json.loads(conditions_json) if conditions_json else {}

        # 構建天氣和 AI 對象
        weather = {
            'is_very_cold': row[4] or conditions.get('is_very_cold', False),
            'is_heavy_rain': row[5] or conditions.get('is_heavy_rain', False),
            'is_strong_wind': row[6] or conditions.get('is_strong_wind', False),
            'typhoon_signal': row[7]
        }

        ai_factor = {
            'event_type': row[9],
            'factor': float(row[10]) if row[10] else None
        } if row[9] else None

        # 分類
        classification = classify_anomaly(conn, date, error, weather, ai_factor)

        # 更新
        cur.execute("""
            UPDATE anomaly_events
            SET
                anomaly_type = %s,
                is_explained = TRUE,
                explanation = %s
            WHERE date = %s
        """, (
            classification['type'],
            json.dumps({
                'confidence': classification['confidence'],
                'reason': classification['reason'],
                'suggested_adjustment': classification['suggested_adjustment']
            }),
            date
        ))

        updated_count += 1

    conn.commit()
    cur.close()

    return updated_count

# ============================================================
# Main
# ============================================================

def main():
    """檢測並報告最近的異常"""
    load_dotenv()
    conn = psycopg2.connect(os.getenv('DATABASE_URL'))

    # 計算基線
    baseline = calculate_baseline_stats(conn)

    print("=" * 60)
    print("Anomaly Detection Report v4.0.00")
    print("=" * 60)
    print(f"Baseline (last 90 days):")
    print(f"  Mean Error: {baseline['mean']:.2f}")
    print(f"  Std Dev: {baseline['std']:.2f}")
    print(f"  Sample Count: {baseline['count']}")
    print()

    # 更新異常分類
    updated = update_anomaly_classifications(conn)
    print(f"✅ Classified {updated} anomalies")
    print()

    # 獲取異常統計
    cur = conn.cursor()
    cur.execute("""
        SELECT
            anomaly_type,
            COUNT(*) as count,
            AVG(prediction_error) as avg_error
        FROM anomaly_events
        WHERE created_at >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY anomaly_type
        ORDER BY count DESC
    """)

    print("Anomaly Summary (last 90 days):")
    print(f"{'Type':<15} {'Count':>10} {'Avg Error':>12}")
    print("-" * 40)
    for row in cur.fetchall():
        print(f"{row[0]:<15} {row[1]:>10} {row[2]:>10.1f}")

    cur.close()
    conn.close()

    print()
    print("✅ Anomaly detection complete")

if __name__ == '__main__':
    main()
