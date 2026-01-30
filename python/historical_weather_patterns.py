# -*- coding: utf-8 -*-
"""
歷史天氣模式分析模組

分析過去天氣變化對就診的影響模式
1. 突發天氣變化（溫度、濕度、降雨的突然變化）
2. 天氣因子組合（寒冷+下雨、酷熱+高濕）
3. 極端天氣事件（颱風、暴雨警告）
4. 年度同期比較（去年同期的天氣-就診關係）
"""
import sys
import io

if sys.platform == 'win32':
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except:
        pass

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import os


def calculate_weather_change_features(df):
    """
    計算天氣變化特徵

    特徵:
    1. Temp_Change_1d/2d/3d: 1-3 天溫度變化
    2. Temp_Change_Abs_1d: 絕對溫度變化（突變）
    3. Humidity_Change_1d/2d: 濕度變化
    4. Rain_Change_1d/2d: 降雨變化
    5. Is_Sudden_Temp_Drop: 溫度驟降（24h 內下降 > 5°C）
    6. Is_Sudden_Temp_Rise: 溫度驟升（24h 內上升 > 5°C）
    7. Weather_Stability_Index: 天氣穩定指數 (0-1)
    """
    df = df.copy()
    df = df.sort_values('Date').reset_index(drop=True)

    # 確保必要的列存在
    required_cols = ['mean_temp', 'mean_relative_humidity', 'total_rainfall']
    for col in required_cols:
        if col not in df.columns:
            print(f"   ⚠️ 缺少列: {col}")
            return df

    # ===== 溫度變化 =====
    # 1-3 天變化
    df['Temp_Change_1d'] = df['mean_temp'].diff(1)
    df['Temp_Change_2d'] = df['mean_temp'].diff(2)
    df['Temp_Change_3d'] = df['mean_temp'].diff(3)

    # 絕對變化（幅度）
    df['Temp_Change_Abs_1d'] = df['Temp_Change_1d'].abs()
    df['Temp_Change_Abs_2d'] = df['Temp_Change_2d'].abs()

    # 溫度驟變（24 小時內變化 > 5°C）
    df['Is_Sudden_Temp_Drop'] = (df['Temp_Change_1d'] < -5).astype(int)
    df['Is_Sudden_Temp_Rise'] = (df['Temp_Change_1d'] > 5).astype(int)

    # 溫度連續變化（3 天累積變化）
    df['Temp_Change_3d_Accum'] = df['mean_temp'].diff(3)

    # ===== 濕度變化 =====
    df['Humidity_Change_1d'] = df['mean_relative_humidity'].diff(1)
    df['Humidity_Change_Abs_1d'] = df['Humidity_Change_1d'].abs()

    # 濕度驟變（24 小時內變化 > 20%）
    df['Is_Sudden_Humidity_Drop'] = (df['Humidity_Change_1d'] < -20).astype(int)
    df['Is_Sudden_Humidity_Rise'] = (df['Humidity_Change_1d'] > 20).astype(int)

    # ===== 降雨變化 =====
    df['Rain_Change_1d'] = df['total_rainfall'].diff(1)
    df['Rain_Change_2d'] = df['total_rainfall'].diff(2)

    # 突發降雨（從無雨到大雨）
    df['Is_Sudden_Rain'] = ((df['total_rainfall'].shift(1) == 0) &
                            (df['total_rainfall'] > 10)).astype(int)

    # 雨停（從大雨到無雨）
    df['Is_Rain_Stop'] = ((df['total_rainfall'].shift(1) > 10) &
                          (df['total_rainfall'] < 1)).astype(int)

    # ===== 天氣組合 =====
    # 寒冷 + 下雨
    df['Is_Cold_Rainy'] = ((df['mean_temp'] < 15) &
                           (df['total_rainfall'] > 5)).astype(int)

    # 酷熱 + 高濕
    df['Is_Hot_Humid'] = ((df['mean_temp'] > 30) &
                          (df['mean_relative_humidity'] > 80)).astype(int)

    # 陰冷（低溫 + 高濕）
    df['Is_Cold_Damp'] = ((df['mean_temp'] < 15) &
                          (df['mean_relative_humidity'] > 80)).astype(int)

    # ===== 天氣穩定指數 =====
    # 計算過去 3 天的溫度、濕度、降雨變化標準差
    rolling_temp_std = df['mean_temp'].rolling(3).std()
    rolling_humidity_std = df['mean_relative_humidity'].rolling(3).std()

    # 標準化變化量（0 = 穩定，1 = 極不穩定）
    temp_stability = rolling_temp_std / 10  # 假設 10°C 標準差 = 完全不穩定
    humidity_stability = rolling_humidity_std / 30  # 假設 30% 標準差 = 完全不穩定

    df['Weather_Stability_Index'] = (temp_stability + humidity_stability) / 2
    df['Weather_Stability_Index'] = df['Weather_Stability_Index'].fillna(0.5)
    df['Weather_Stability_Index'] = df['Weather_Stability_Index'].clip(0, 1)

    # 高不穩定天氣
    df['Is_Weather_Unstable'] = (df['Weather_Stability_Index'] > 0.6).astype(int)

    # 填補缺失值
    change_cols = [c for c in df.columns if 'Change' in c or 'Sudden' in c or
                   c.startswith('Is_') and 'Weather' in c or
                   c in ['Weather_Stability_Index']]
    df[change_cols] = df[change_cols].fillna(0)

    print(f"   ✅ 添加 {len(change_cols)} 個天氣變化特徵")

    return df


def calculate_extreme_weather_features(df):
    """
    計算極端天氣事件特徵

    特徵:
    1. 極端溫度（< 10°C 或 > 32°C）
    2. 暴雨（日降雨 > 50mm）
    3. 強風（如數據有）
    4. 颱風影響（從日期判斷）
    """
    df = df.copy()

    # 極端低溫
    df['Is_Extreme_Cold'] = (df['mean_temp'] < 10).astype(int)

    # 極端高溫
    df['Is_Extreme_Hot'] = (df['mean_temp'] > 32).astype(int)

    # 暴雨
    df['Is_Heavy_Rain'] = (df['total_rainfall'] > 50).astype(int)

    # 大雨
    df['Is_Moderate_Rain'] = ((df['total_rainfall'] >= 10) &
                              (df['total_rainfall'] <= 50)).astype(int)

    # 連續降雨天數（累積效應）
    df['Rainy_Streak_Days'] = 0
    current_streak = 0
    for i in range(len(df)):
        if df.loc[i, 'total_rainfall'] > 0:
            current_streak += 1
        else:
            current_streak = 0
        df.loc[i, 'Rainy_Streak_Days'] = current_streak

    # 連續乾旱天數（反彈效應）
    df['Dry_Streak_Days'] = 0
    current_streak = 0
    for i in range(len(df)):
        if df.loc[i, 'total_rainfall'] == 0:
            current_streak += 1
        else:
            current_streak = 0
        df.loc[i, 'Dry_Streak_Days'] = current_streak

    # 連續寒冷天數
    df['Cold_Streak_Days'] = 0
    current_streak = 0
    for i in range(len(df)):
        if df.loc[i, 'mean_temp'] < 15:
            current_streak += 1
        else:
            current_streak = 0
        df.loc[i, 'Cold_Streak_Days'] = current_streak

    # 連續炎熱天數
    df['Hot_Streak_Days'] = 0
    current_streak = 0
    for i in range(len(df)):
        if df.loc[i, 'mean_temp'] > 30:
            current_streak += 1
        else:
            current_streak = 0
        df.loc[i, 'Hot_Streak_Days'] = current_streak

    extreme_cols = [c for c in df.columns if 'Extreme' in c or 'Streak' in c or
                    'Heavy_Rain' in c or 'Moderate_Rain' in c]

    print(f"   ✅ 添加 {len(extreme_cols)} 個極端天氣特徵")

    return df


def calculate_year_over_year_features(df, attendance_df):
    """
    計算年度同期比較特徵

    特徵:
    1. 去年同期的平均就診人數
    2. 去年同期的天氣條件 vs 就診關係
    3. 同日過去 N 年的就診趨勢
    """
    df = df.copy()
    attendance_df = attendance_df.copy()

    # 確保日期列
    df['Date'] = pd.to_datetime(df['Date'])
    attendance_df['Date'] = pd.to_datetime(attendance_df['Date'])

    # 合併
    merged = pd.merge(
        df,
        attendance_df[['Date', 'patient_count']],
        on='Date',
        how='left'
    )

    # 添加月份和日期
    merged['Month'] = merged['Date'].dt.month
    merged['Day'] = merged['Date'].dt.day
    merged['Day_of_Year'] = merged['Date'].dt.dayofyear

    # 計算去年同期平均（簡化：使用相同月份-日期的歷史平均）
    historical_avg_by_day = merged.groupby(['Month', 'Day'])['patient_count'].transform('mean')

    merged['Same_Day_Last_Year_Avg'] = historical_avg_by_day

    # 計算與去年同期的偏差
    merged['Deviation_From_Last_Year'] = (
        merged['patient_count'] - merged['Same_Day_Last_Year_Avg']
    )

    # 計算去年同期天氣相似日的就診
    # 找出溫度相似（±2°C）且濕度相似（±10%）的歷史日期
    merged['Weather_Match_Attendance_Avg'] = 0

    for i in range(len(merged)):
        if i < 30:  # 跳過前 30 天（數據不足）
            continue

        current_temp = merged.loc[i, 'mean_temp']
        current_humidity = merged.loc[i, 'mean_relative_humidity']

        # 尋找相似天氣的歷史日期
        similar_days = merged[
            (abs(merged['mean_temp'] - current_temp) <= 2) &
            (abs(merged['mean_relative_humidity'] - current_humidity) <= 10) &
            (merged.index < i - 7)  # 只使用 7 天前的數據
        ]

        if len(similar_days) > 0:
            merged.loc[i, 'Weather_Match_Attendance_Avg'] = similar_days['patient_count'].mean()
        else:
            merged.loc[i, 'Weather_Match_Attendance_Avg'] = merged['patient_count'].median()

    # 天氣季節性（每週同期的平均）
    merged['Week_of_Year'] = merged['Date'].dt.isocalendar().week
    weekly_avg = merged.groupby('Week_of_Year')['patient_count'].transform('mean')
    merged['Weekly_Seasonal_Avg'] = weekly_avg

    yoy_cols = ['Same_Day_Last_Year_Avg', 'Deviation_From_Last_Year',
                'Weather_Match_Attendance_Avg', 'Weekly_Seasonal_Avg']

    # 填補缺失值
    merged[yoy_cols] = merged[yoy_cols].fillna(0)

    print(f"   ✅ 添加 {len(yoy_cols)} 個年度同期特徵")

    # 移除臨時列
    cols_to_drop = ['Month', 'Day', 'Day_of_Year', 'Week_of_Year']
    merged = merged.drop(columns=[c for c in cols_to_drop if c in merged.columns])

    return merged


def add_historical_weather_pattern_features(df, weather_df, attendance_df=None):
    """
    添加完整的歷史天氣模式特徵

    Args:
        df: 主 DataFrame（包含 Date 列）
        weather_df: 歷史天氣數據
        attendance_df: 就診數據（可選）

    Returns:
        添加了特徵的 DataFrame
    """
    print("\n📊 添加歷史天氣模式特徵...")

    if weather_df is None:
        print("   ⚠️ 無天氣數據，跳過")
        return df

    # 合併天氣數據
    df['Date'] = pd.to_datetime(df['Date'])
    weather_df['Date'] = pd.to_datetime(weather_df['Date'])

    df = df.merge(
        weather_df[['Date', 'mean_temp', 'mean_relative_humidity', 'total_rainfall']],
        on='Date',
        how='left'
    )

    # 填補缺失值
    df['mean_temp'] = df['mean_temp'].fillna(df['mean_temp'].median())
    df['mean_relative_humidity'] = df['mean_relative_humidity'].fillna(df['mean_relative_humidity'].median())
    df['total_rainfall'] = df['total_rainfall'].fillna(0)

    # 1. 天氣變化特徵
    df = calculate_weather_change_features(df)

    # 2. 極端天氣特徵
    df = calculate_extreme_weather_features(df)

    # 3. 年度同期特徵（如果有就診數據）
    if attendance_df is not None:
        df = calculate_year_over_year_features(df, attendance_df)

    # 移除中間計算列
    if 'patient_count' in df.columns and 'patient_count' not in attendance_df.columns:
        # 如果 attendance_df 有 patient_count 但 df 原本沒有，移除它
        pass

    return df


def get_historical_weather_feature_list():
    """返回歷史天氣模式特徵列表"""
    return [
        # 天氣變化
        'Temp_Change_1d', 'Temp_Change_2d', 'Temp_Change_3d',
        'Temp_Change_Abs_1d', 'Temp_Change_Abs_2d',
        'Temp_Change_3d_Accum',
        'Is_Sudden_Temp_Drop', 'Is_Sudden_Temp_Rise',
        'Humidity_Change_1d', 'Humidity_Change_Abs_1d',
        'Is_Sudden_Humidity_Drop', 'Is_Sudden_Humidity_Rise',
        'Rain_Change_1d', 'Rain_Change_2d',
        'Is_Sudden_Rain', 'Is_Rain_Stop',

        # 天氣組合
        'Is_Cold_Rainy', 'Is_Hot_Humid', 'Is_Cold_Damp',
        'Weather_Stability_Index', 'Is_Weather_Unstable',

        # 極端天氣
        'Is_Extreme_Cold', 'Is_Extreme_Hot',
        'Is_Heavy_Rain', 'Is_Moderate_Rain',
        'Rainy_Streak_Days', 'Dry_Streak_Days',
        'Cold_Streak_Days', 'Hot_Streak_Days',

        # 年度同期
        'Same_Day_Last_Year_Avg', 'Deviation_From_Last_Year',
        'Weather_Match_Attendance_Avg', 'Weekly_Seasonal_Avg'
    ]


def main():
    """測試歷史天氣模式特徵"""
    print("=" * 80)
    print("🌡️ 歷史天氣模式特徵測試")
    print("=" * 80)

    # 模擬數據
    dates = pd.date_range(start='2023-01-01', end='2023-12-31', freq='D')

    # 模擬天氣數據
    weather_df = pd.DataFrame({
        'Date': dates,
        'mean_temp': 20 + 5 * np.sin(np.arange(len(dates)) * 2 * np.pi / 365) + np.random.randn(len(dates)) * 2,
        'mean_relative_humidity': 75 + 10 * np.sin(np.arange(len(dates)) * 2 * np.pi / 365) + np.random.randn(len(dates)) * 5,
        'total_rainfall': np.random.exponential(5, len(dates))
    })

    # 模擬就診數據
    attendance_df = pd.DataFrame({
        'Date': dates,
        'patient_count': 200 + 30 * np.sin(np.arange(len(dates)) * 2 * np.pi / 7) + np.random.randn(len(dates)) * 20
    })

    # 測試特徵
    test_df = pd.DataFrame({'Date': dates})

    print("\n1️⃣ 添加天氣變化特徵...")
    test_df = calculate_weather_change_features(test_df)

    print("\n2️⃣ 添加極端天氣特徵...")
    test_df = calculate_extreme_weather_features(test_df)

    print("\n3️⃣ 添加年度同期特徵...")
    test_df = calculate_year_over_year_features(test_df, attendance_df)

    print("\n4️⃣ 特徵統計...")
    features = get_historical_weather_feature_list()
    available_features = [f for f in features if f in test_df.columns]

    print(f"   總特徵數: {len(available_features)}")
    print(f"   數據形狀: {test_df.shape}")

    print("\n5️⃣ 特徵預覽...")
    preview_cols = ['Date', 'Temp_Change_1d', 'Is_Sudden_Temp_Drop',
                    'Is_Cold_Rainy', 'Weather_Stability_Index',
                    'Same_Day_Last_Year_Avg']
    print(test_df[preview_cols].head(10).to_string())

    print("\n6️⃣ 特徵描述統計...")
    print(test_df[available_features].describe().to_string())

    print("\n" + "=" * 80)
    print("✅ 測試完成")
    print("=" * 80)


if __name__ == '__main__':
    main()
