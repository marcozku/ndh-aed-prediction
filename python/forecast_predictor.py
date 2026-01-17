#!/usr/bin/env python3
"""
天氣預報預測整合
Weather Forecast Integrated Prediction

使用天氣預報和學習到的影響參數調整預測

Version: 4.0.00
Author: Ma Tsz Kiu
Date: 2026-01-18
"""

import psycopg2
import requests
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import os
from dotenv import load_dotenv
import json
import sys

HKO_FORECAST_API = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=tc"

def fetch_weather_forecast():
    """獲取 HKO 9 天天氣預報"""
    try:
        response = requests.get(HKO_FORECAST_API, timeout=30)
        response.raise_for_status()
        data = response.json()

        forecasts = []
        for day in data.get('weatherForecast', []):
            forecasts.append({
                'date': datetime.strptime(day['forecastDate'], '%Y%m%d').date(),
                'temp_min': int(day.get('forecastMintemp', '20').replace('°C', '').strip()),
                'temp_max': int(day.get('forecastMaxtemp', '28').replace('°C', '').strip()),
                'humidity': day.get('forecastHumidity', ''),
                'rain_prob': day.get('PSR', 'Low'),
                'desc': day.get('ForecastDesc', '')
            })

        return forecasts
    except Exception as e:
        print(f"❌ Failed to fetch forecast: {e}", file=sys.stderr)
        return []

def get_learned_impacts(conn):
    """從數據庫獲取學習到的影響參數"""
    cur = conn.cursor()

    cur.execute("""
        SELECT parameter_name, parameter_value, sample_count
        FROM weather_impact_parameters
        WHERE is_active = TRUE
    """)

    impacts = {row[0]: {'value': float(row[1]), 'n': int(row[2])} for row in cur.fetchall()}
    cur.close()

    return impacts

def get_combination_impacts(conn):
    """從數據庫獲取條件組合影響"""
    cur = conn.cursor()

    cur.execute("""
        SELECT conditions_json, impact_absolute, sample_count
        FROM weather_combination_impacts
        WHERE is_significant = TRUE
        ORDER BY ABS(impact_absolute) DESC
    """)

    impacts = []
    for row in cur.fetchall():
        conditions = json.loads(row[0])
        impacts.append({
            'condition': conditions.get('condition', 'unknown'),
            'impact': float(row[1]),
            'n': int(row[2])
        })

    cur.close()
    return impacts

def calculate_weather_adjustment(forecast, impacts, combination_impacts):
    """基於預報計算調整值"""

    adjustment = 0
    factors = []

    temp_min = forecast['temp_min']
    temp_max = forecast['temp_max']
    rain_prob = forecast['rain_prob']

    # 1. 溫度調整
    if temp_min <= 12:
        cold_impact = impacts.get('is_very_cold', {}).get('value', -6.8)
        adjustment += cold_impact
        factors.append(f'寒冷天氣 ({cold_impact:+.1f})')

    elif temp_max >= 33:
        hot_impact = impacts.get('is_very_hot', {}).get('value', 1.2)
        adjustment += hot_impact
        factors.append(f'炎熱天氣 ({hot_impact:+.1f})')

    # 2. 降雨調整
    if rain_prob in ['High', 'Very High']:
        rain_impact = impacts.get('is_heavy_rain', {}).get('value', -4.9)
        adjustment += rain_impact
        factors.append(f'大雨預報 ({rain_impact:+.1f})')

    # 3. 檢查組合影響
    for combo in combination_impacts:
        if combo['condition'] == 'very_cold' and temp_min <= 12:
            adjustment += combo['impact'] * 0.5  # 組合影響權重較低

    return adjustment, factors

def predict_with_forecast(target_date, base_prediction):
    """使用天氣預報生成調整後的預測"""

    load_dotenv()
    conn = psycopg2.connect(os.getenv('DATABASE_URL'))

    # 1. 獲取天氣預報
    forecasts = fetch_weather_forecast()

    # 2. 獲取學習到的影響
    impacts = get_learned_impacts(conn)
    combination_impacts = get_combination_impacts(conn)

    # 3. 找到目標日期的預報
    target_forecast = None
    for f in forecasts:
        if f['date'] == target_date:
            target_forecast = f
            break

    conn.close()

    if not target_forecast:
        # 沒有預報，返回基礎預測
        return {
            'date': str(target_date),
            'base_prediction': base_prediction,
            'final_prediction': base_prediction,
            'adjustment': 0,
            'factors': ['無天氣預報'],
            'has_forecast': False
        }

    # 4. 計算調整
    adjustment, factors = calculate_weather_adjustment(target_forecast, impacts, combination_impacts)

    return {
        'date': str(target_date),
        'base_prediction': base_prediction,
        'final_prediction': base_prediction + adjustment,
        'adjustment': adjustment,
        'factors': factors,
        'forecast': target_forecast,
        'has_forecast': True
    }

def cache_forecast_data(conn):
    """緩存天氣預報數據到數據庫"""
    forecasts = fetch_weather_forecast()
    if not forecasts:
        return 0

    cur = conn.cursor()
    cached_count = 0

    for f in forecasts:
        # 預測影響
        impacts = get_learned_impacts(conn)
        adjustment, _ = calculate_weather_adjustment(f, impacts, [])

        cur.execute("""
            INSERT INTO weather_forecast_cache (
                forecast_date,
                temp_min_forecast,
                temp_max_forecast,
                rain_prob_forecast,
                weather_desc,
                predicted_impact_absolute,
                confidence_level
            ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (forecast_date, fetch_date) DO NOTHING
        """, (
            f['date'],
            f['temp_min'],
            f['temp_max'],
            f['rain_prob'],
            f['desc'],
            adjustment,
            'medium' if abs(adjustment) > 5 else 'low'
        ))
        cached_count += 1

    conn.commit()
    cur.close()

    return cached_count

def main():
    """測試或緩存預報"""
    if len(sys.argv) > 1 and sys.argv[1] == '--cache':
        # 緩存模式
        load_dotenv()
        conn = psycopg2.connect(os.getenv('DATABASE_URL'))
        count = cache_forecast_data(conn)
        conn.close()
        print(f"✅ Cached {count} days of forecast")
    else:
        # 測試模式
        target_date = (datetime.now() + timedelta(days=1)).date()
        base_pred = 250

        result = predict_with_forecast(target_date, base_pred)

        print("=" * 60)
        print("Weather Forecast Prediction v4.0.00")
        print("=" * 60)
        print(f"Target Date: {result['date']}")
        print(f"Base Prediction: {result['base_prediction']:.0f}")
        print(f"Adjustment: {result['adjustment']:+.1f}")
        print(f"Final Prediction: {result['final_prediction']:.0f}")
        if result.get('forecast'):
            print(f"\nForecast: {result['forecast']['temp_min']}°C - {result['forecast']['temp_max']}°C, {result['forecast']['rain_prob']} rain")
        if result.get('factors'):
            print(f"\nFactors: {', '.join(result['factors'])}")

if __name__ == '__main__':
    main()
