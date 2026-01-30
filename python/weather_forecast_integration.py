# -*- coding: utf-8 -*-
"""
香港天文台天氣預報整合模組

獲取 9 天天氣預報並轉換為機器學習特徵

API: https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=tc
更新: 每日 2 次 (上午 11 時, 下午 5 時)
預報範圍: 未來 9 天
"""
import sys
import io

if sys.platform == 'win32':
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except:
        pass

import requests
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import json
import os

HKO_FORECAST_API = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=tc"


def fetch_weather_forecast():
    """
    獲取香港天文台 9 天天氣預報

    返回:
        DataFrame with columns:
        - forecast_date: 預報日期 (YYYY-MM-DD)
        - week: 星期幾
        - temp_min: 最低溫度 (°C)
        - temp_max: 最高溫度 (°C)
        - temp_range: 溫差 (°C)
        - humidity: 濕度 (%)
        - rain_prob: 降雨機率 (Low/Medium/High/Very High)
        - weather_desc: 天氣描述
    """
    try:
        print(f"📡 獲取香港天文台天氣預報...")

        response = requests.get(HKO_FORECAST_API, timeout=30)
        response.raise_for_status()

        data = response.json()

        if 'weatherForecast' not in data:
            print(f"   ❌ API 數據格式錯誤")
            return pd.DataFrame()

        forecast_records = []

        for day_data in data['weatherForecast']:
            forecast_date = day_data.get('forecastDate', '')  # YYYYMMDD

            # 解析日期
            try:
                date_obj = datetime.strptime(forecast_date, '%Y%m%d')
            except:
                continue

            # 解析溫度
            temp_min = day_data.get('forecastMintemp', '').replace('°C', '').replace(' ', '')
            temp_max = day_data.get('forecastMaxtemp', '').replace('°C', '').replace(' ', '')

            try:
                temp_min = int(temp_min) if temp_min else None
                temp_max = int(temp_max) if temp_max else None
            except:
                temp_min = None
                temp_max = None

            record = {
                'forecast_date': date_obj,
                'week': day_data.get('week', ''),
                'temp_min': temp_min,
                'temp_max': temp_max,
                'temp_range': None,  # 後續計算
                'humidity': day_data.get('forecastHumidity', None),
                'rain_prob': day_data.get('PSR', 'Low'),
                'weather_desc': day_data.get('ForecastDesc', '')
            }

            forecast_records.append(record)

        df = pd.DataFrame(forecast_records)

        # 計算溫差
        if 'temp_min' in df.columns and 'temp_max' in df.columns:
            df['temp_range'] = df['temp_max'] - df['temp_min']

        print(f"   ✅ 成功獲取 {len(df)} 天預報")
        print(f"   📅 範圍: {df['forecast_date'].min()} → {df['forecast_date'].max()}")

        return df

    except Exception as e:
        print(f"   ❌ 獲取天氣預報失敗: {e}")
        return pd.DataFrame()


def save_forecast_history(df, output_path='models/weather_forecast_history.csv'):
    """
    保存天氣預報到歷史記錄

    Args:
        df: 預報 DataFrame
        output_path: 輸出 CSV 路徑
    """
    if df is None or len(df) == 0:
        return

    # 讀取現有歷史
    if os.path.exists(output_path):
        history = pd.read_csv(output_path)
        history['forecast_date'] = pd.to_datetime(history['forecast_date'])

        # 只保留最近 30 天的歷史
        cutoff = datetime.now() - timedelta(days=30)
        history = history[history['forecast_date'] >= cutoff]

        # 合併
        df['fetch_time'] = datetime.now()
        history = pd.concat([history, df], ignore_index=True)
    else:
        df['fetch_time'] = datetime.now()
        history = df

    # 保存
    os.makedirs('models', exist_ok=True)
    history.to_csv(output_path, index=False)

    print(f"   ✅ 已保存預報歷史到 {output_path}")


def calculate_forecast_features(forecast_df):
    """
    將天氣預報轉換為機器學習特徵

    特徵列表:
    1. Forecast_Temp_Min/Max/Range: 溫度特徵
    2. Forecast_Rain_Prob_Encoded: 降雨機率編碼 (0-3)
    3. Forecast_Rain_Heavy: 大雨預報
    4. Forecast_Is_Very_Hot/Cold: 極端溫度
    5. Forecast_Is_Temp_Fluctuating: 溫差大
    6. Forecast_Weekend: 週末預報
    """
    if forecast_df is None or len(forecast_df) == 0:
        return {}

    features = {}

    # 使用第一天的預報 (或指定日期)
    today_forecast = forecast_df.iloc[0]

    # ===== 基礎溫度特徵 =====
    features['Forecast_Temp_Min'] = today_forecast['temp_min'] if pd.notna(today_forecast['temp_min']) else 20
    features['Forecast_Temp_Max'] = today_forecast['temp_max'] if pd.notna(today_forecast['temp_max']) else 28
    features['Forecast_Temp_Range'] = today_forecast['temp_range'] if pd.notna(today_forecast['temp_range']) else 8

    # ===== 降雨機率編碼 =====
    rain_mapping = {'Low': 0, 'Medium': 1, 'High': 2, 'Very High': 3, None: 0}
    rain_prob = today_forecast.get('rain_prob', 'Low')
    features['Forecast_Rain_Prob_Encoded'] = rain_mapping.get(rain_prob, 0)

    # ===== 大雨預報 =====
    is_heavy_rain = (
        rain_prob in ['High', 'Very High'] or
        '雨' in today_forecast.get('weather_desc', '') or
        '雷暴' in today_forecast.get('weather_desc', '')
    )
    features['Forecast_Rain_Heavy'] = int(is_heavy_rain)

    # ===== 極端溫度 =====
    temp_max = features['Forecast_Temp_Max']
    temp_min = features['Forecast_Temp_Min']

    features['Forecast_Is_Very_Hot'] = int(temp_max >= 33)
    features['Forecast_Is_Very_Cold'] = int(temp_min <= 10)

    # ===== 溫差大 =====
    features['Forecast_Is_Temp_Fluctuating'] = int(features['Forecast_Temp_Range'] >= 10)

    # ===== 天氣描述 One-Hot (關鍵詞) =====
    desc = today_forecast.get('weather_desc', '')
    features['Forecast_Weather_Sunny'] = int('晴' in desc or '乾燥' in desc)
    features['Forecast_Weather_Cloudy'] = int('多雲' in desc or '陰' in desc)
    features['Forecast_Weather_Rainy'] = int('雨' in desc)
    features['Forecast_Weather_Stormy'] = int('雷暴' in desc or '大風' in desc)

    # ===== 未來 3 天平均特徵 =====
    if len(forecast_df) >= 3:
        next_3_days = forecast_df.iloc[:3]

        # 未來 3 天平均溫度
        valid_temps = next_3_days['temp_max'].dropna()
        if len(valid_temps) > 0:
            features['Forecast_Avg_Temp_3d'] = valid_temps.mean()
        else:
            features['Forecast_Avg_Temp_3d'] = 25

        # 未來 3 天降雨天數
        rainy_days = sum([
            rain_mapping.get(d.get('rain_prob', 'Low'), 0) >= 2
            for _, d in next_3_days.iterrows()
        ])
        features['Forecast_Rain_Days_3d'] = rainy_days
    else:
        features['Forecast_Avg_Temp_3d'] = 25
        features['Forecast_Rain_Days_3d'] = 0

    return features


def add_forecast_features_to_df(df, forecast_df=None, date_col='Date'):
    """
    為 DataFrame 添加天氣預報特徵

    Args:
        df: 包含日期的 DataFrame
        forecast_df: 天氣預報 DataFrame (如果為 None 則獲取)
        date_col: 日期列名

    返回:
        添加了預報特徵的 DataFrame
    """
    if forecast_df is None:
        forecast_df = fetch_weather_forecast()

    if forecast_df is None or len(forecast_df) == 0:
        print("   ⚠️ 無天氣預報數據，使用默認值")
        # 添加默認特徵列
        default_features = {
            'Forecast_Temp_Min': 20,
            'Forecast_Temp_Max': 28,
            'Forecast_Temp_Range': 8,
            'Forecast_Rain_Prob_Encoded': 0,
            'Forecast_Rain_Heavy': 0,
            'Forecast_Is_Very_Hot': 0,
            'Forecast_Is_Very_Cold': 0,
            'Forecast_Is_Temp_Fluctuating': 0,
            'Forecast_Avg_Temp_3d': 25,
            'Forecast_Rain_Days_3d': 0,
            'Forecast_Weather_Sunny': 0,
            'Forecast_Weather_Cloudy': 0,
            'Forecast_Weather_Rainy': 0,
            'Forecast_Weather_Stormy': 0
        }

        for col, val in default_features.items():
            df[col] = val

        return df

    # 確保日期列是 datetime
    df[date_col] = pd.to_datetime(df[date_col])

    # 為每行匹配預報
    forecast_features = []

    for _, row in df.iterrows():
        row_date = row[date_col].date()

        # 尋找匹配的預報
        matching_forecast = forecast_df[
            forecast_df['forecast_date'].dt.date == row_date
        ]

        if len(matching_forecast) > 0:
            # 計算特徵
            features = calculate_forecast_features(matching_forecast)
            forecast_features.append(features)
        else:
            # 沒有預報，使用默認值
            forecast_features.append({
                'Forecast_Temp_Min': 20,
                'Forecast_Temp_Max': 28,
                'Forecast_Temp_Range': 8,
                'Forecast_Rain_Prob_Encoded': 0,
                'Forecast_Rain_Heavy': 0,
                'Forecast_Is_Very_Hot': 0,
                'Forecast_Is_Very_Cold': 0,
                'Forecast_Is_Temp_Fluctuating': 0,
                'Forecast_Avg_Temp_3d': 25,
                'Forecast_Rain_Days_3d': 0,
                'Forecast_Weather_Sunny': 0,
                'Forecast_Weather_Cloudy': 0,
                'Forecast_Weather_Rainy': 0,
                'Forecast_Weather_Stormy': 0
            })

    # 添加到 DataFrame
    feature_df = pd.DataFrame(forecast_features)
    df = pd.concat([df.reset_index(drop=True), feature_df], axis=1)

    return df


def get_forecast_feature_list():
    """返回天氣預報特徵列表"""
    return [
        'Forecast_Temp_Min',
        'Forecast_Temp_Max',
        'Forecast_Temp_Range',
        'Forecast_Rain_Prob_Encoded',
        'Forecast_Rain_Heavy',
        'Forecast_Is_Very_Hot',
        'Forecast_Is_Very_Cold',
        'Forecast_Is_Temp_Fluctuating',
        'Forecast_Avg_Temp_3d',
        'Forecast_Rain_Days_3d',
        'Forecast_Weather_Sunny',
        'Forecast_Weather_Cloudy',
        'Forecast_Weather_Rainy',
        'Forecast_Weather_Stormy'
    ]


def main():
    """測試天氣預報整合"""
    print("=" * 80)
    print("🌤️ 香港天文台天氣預報整合測試")
    print("=" * 80)
    print(f"時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # 1. 獲取預報
    print("1️⃣ 獲取天氣預報")
    forecast_df = fetch_weather_forecast()

    if forecast_df is None or len(forecast_df) == 0:
        print("   ❌ 無法獲取預報")
        return

    # 顯示預報
    print("\n📊 未來 9 天預報:")
    print(f"{'日期':<12} {'星期':<6} {'溫度':<15} {'降雨機率':<12} {'天氣'}")
    print("-" * 80)
    for _, row in forecast_df.iterrows():
        date_str = row['forecast_date'].strftime('%Y-%m-%d')
        temp_str = f"{row['temp_min']}°C - {row['temp_max']}°C"
        print(f"{date_str:<12} {row['week']:<6} {temp_str:<15} {row['rain_prob']:<12} {row['weather_desc']}")

    # 2. 保存歷史
    print("\n2️⃣ 保存預報歷史")
    save_forecast_history(forecast_df)

    # 3. 計算特徵
    print("\n3️⃣ 計算機器學習特徵")
    features = calculate_forecast_features(forecast_df)

    print("\n   特徵值:")
    for key, value in sorted(features.items()):
        print(f"      {key}: {value}")

    # 4. 測試整合到 DataFrame
    print("\n4️⃣ 測試整合到 DataFrame")
    test_dates = pd.date_range(start=datetime.now(), periods=5, freq='D')
    test_df = pd.DataFrame({'Date': test_dates})

    test_df_with_forecast = add_forecast_features_to_df(test_df, forecast_df)

    print(f"\n   結果 DataFrame: {len(test_df_with_forecast)} 列")
    print(f"   預報特徵: {get_forecast_feature_list()}")
    print(f"\n   預覽 (前 2 行):")
    print(test_df_with_forecast[['Date'] + get_forecast_feature_list()[:5]].head(2).to_string())

    print(f"\n✅ 測試完成")


if __name__ == '__main__':
    main()
