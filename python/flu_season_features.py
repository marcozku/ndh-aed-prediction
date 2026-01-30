# -*- coding: utf-8 -*-
"""
流感季節特徵模組

基於香港流感監測數據和歷史模式
參考: 香港衛生防護中心流感監測
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

# 香港流感季節定義 (基於歷史數據)
# 冬季流感: 通常 1-2 月達到高峰
# 夏季流感: 通常 7-8 月達到高峰

FLU_SEASON_PEAKS = {
    # (開始月, 開始日) -> (結束月, 結束日)
    'winter': {
        'peak': [(1, 10), (2, 20)],      # 主要高峰期
        'pre_peak': (1, 1),              # 高峰前
        'post_peak': (2, 28),            # 高峰後
    },
    'summer': {
        'peak': [(7, 15), (8, 15)],      # 主要高峰期
        'pre_peak': (7, 1),              # 高峰前
        'post_peak': (8, 31),            # 高峰後
    }
}

# 流感月份 (1, 2, 7, 8)
FLU_MONTHS = [1, 2, 7, 8]

# 流感活躍度歷史數據 (模擬，可從實際監測數據更新)
# 根據香港 2015-2024 數據模擬
FLU_ACTIVITY_HISTORY = {
    2015: {'winter': 2.5, 'summer': 1.8},  # 冬季較嚴重
    2016: {'winter': 2.0, 'summer': 1.5},
    2017: {'winter': 3.0, 'summer': 2.2},  # 2017 冬季高峰
    2018: {'winter': 1.8, 'summer': 2.0},
    2019: {'winter': 2.2, 'summer': 1.9},
    2020: {'winter': 1.5, 'summer': 0.5},  # COVID 影響
    2021: {'winter': 1.2, 'summer': 1.0},
    2022: {'winter': 2.8, 'summer': 2.5},  # 2022 夏季高峰
    2023: {'winter': 2.3, 'summer': 2.0},
    2024: {'winter': 2.6, 'summer': 2.3},  # 2024 冬季高峰
    2025: {'winter': 2.4, 'summer': 2.2},  # 預測
}


def get_flu_season_features(date):
    """
    計算流感季節特徵

    Args:
        date: datetime 物件

    返回:
        dict of flu season features
    """
    month = date.month
    day = date.day
    year = date.year

    features = {}

    # ===== 基礎特徵 =====
    # 是否流感月份
    features['Flu_Month'] = int(month in FLU_MONTHS)

    # 季節類型
    if month in [1, 2]:
        features['Flu_Season_Winter'] = 1
        features['Flu_Season_Summer'] = 0
    elif month in [7, 8]:
        features['Flu_Season_Winter'] = 0
        features['Flu_Season_Summer'] = 1
    else:
        features['Flu_Season_Winter'] = 0
        features['Flu_Season_Summer'] = 0

    # ===== 高峰期判斷 =====
    is_winter_peak = False
    is_summer_peak = False
    days_to_peak = None
    days_from_peak = None

    # 冬季高峰
    for (start_month, start_day), (end_month, end_day) in FLU_SEASON_PEAKS['winter']['peak']:
        if (month == start_month and day >= start_day) or \
           (month == end_month and day <= end_day) or \
           (start_month < month < end_month):
            is_winter_peak = True
            break

    # 夏季高峰
    for (start_month, start_day), (end_month, end_day) in FLU_SEASON_PEAKS['summer']['peak']:
        if (month == start_month and day >= start_day) or \
           (month == end_month and day <= end_day) or \
           (start_month < month < end_month):
            is_summer_peak = True
            break

    features['Flu_Is_Peak'] = int(is_winter_peak or is_summer_peak)

    # 距離高峰期天數
    if not is_winter_peak and not is_summer_peak:
        # 計算距離下一個高峰期
        # 冬季
        winter_peak = datetime(date.year, 1, 10)
        if date < winter_peak:
            days_to_peak = (winter_peak - date).days
        else:
            # 夏季
            summer_peak = datetime(date.year, 7, 15)
            if date < summer_peak:
                days_to_peak = (summer_peak - date).days

        # 冬季後高峰
        if month > 2 and month < 7:
            next_winter = datetime(date.year + 1, 1, 10)
            days_to_peak = (next_winter - date).days

        features['Flu_Days_To_Peak'] = days_to_peak if days_to_peak is not None else 999

    # 高峰期前後 7 天
    pre_peak_winter = datetime(date.year, 1, 1)
    post_peak_winter = datetime(date.year, 2, 28)
    pre_peak_summer = datetime(date.year, 7, 1)
    post_peak_summer = datetime(date.year, 8, 31)

    features['Flu_Pre_Peak_7d'] = int(
        (pre_peak_winter - timedelta(days=7) <= date <= pre_peak_winter) or
        (pre_peak_summer - timedelta(days=7) <= date <= pre_peak_summer)
    )

    features['Flu_Post_Peak_7d'] = int(
        (post_peak_winter <= date <= post_peak_winter + timedelta(days=7)) or
        (post_peak_summer <= date <= post_peak_summer + timedelta(days=7))
    )

    # ===== 流感強度 (基於歷史數據) =====
    year_activity = FLU_ACTIVITY_HISTORY.get(year, {'winter': 2.0, 'summer': 1.5})

    if month in [1, 2]:
        features['Flu_Intensity'] = year_activity['winter']
    elif month in [7, 8]:
        features['Flu_Intensity'] = year_activity['summer']
    else:
        features['Flu_Intensity'] = 1.0

    # 量化強度 (0-4)
    if features['Flu_Intensity'] >= 2.5:
        features['Flu_Intensity_Level'] = 4  # 甚高
    elif features['Flu_Intensity'] >= 2.0:
        features['Flu_Intensity_Level'] = 3  # 高
    elif features['Flu_Intensity'] >= 1.5:
        features['Flu_Intensity_Level'] = 2  # 中
    elif features['Flu_Intensity'] >= 1.0:
        features['Flu_Intensity_Level'] = 1  # 低
    else:
        features['Flu_Intensity_Level'] = 0

    # ===== 特殊時間點 =====
    # 新年後 (流感高發)
    features['Flu_Post_NewYear'] = int(month == 1 and day <= 7)

    # 開學後 (學校流感傳播)
    features['Flu_School_Start'] = int((month == 9 and day <= 14) or  # 9月開學
                                         (month == 2 and day >= 15))   # 2月開學後

    return features


def add_flu_features_to_df(df, date_col='Date'):
    """
    為 DataFrame 添加流感季節特徵

    Args:
        df: 包含日期的 DataFrame
        date_col: 日期列名

    返回:
        添加了流感特徵的 DataFrame
    """
    df = df.copy()
    df[date_col] = pd.to_datetime(df[date_col])

    # 計算特徵
    flu_features_list = []

    for date in df[date_col]:
        features = get_flu_season_features(date)
        flu_features_list.append(features)

    # 轉為 DataFrame
    flu_df = pd.DataFrame(flu_features_list)

    # 合併
    df = pd.concat([df.reset_index(drop=True), flu_df], axis=1)

    return df


def get_flu_feature_list():
    """返回流感特徵列表"""
    return [
        'Flu_Month',                      # 流感月份
        'Flu_Season_Winter',              # 冬季流感季節
        'Flu_Season_Summer',              # 夏季流感季節
        'Flu_Is_Peak',                    # 是否高峰期
        'Flu_Days_To_Peak',                # 距離高峰天數
        'Flu_Pre_Peak_7d',                 # 高峰前 7 天
        'Flu_Post_Peak_7d',                # 高峰後 7 天
        'Flu_Intensity',                   # 流感強度 (連續)
        'Flu_Intensity_Level',             # 流感強度等級 (0-4)
        'Flu_Post_NewYear',                # 新年後
        'Flu_School_Start'                # 開學後
    ]


def simulate_flu_impact():
    """模擬流感季節對就診人數的影響"""
    # 創建模擬數據
    dates = pd.date_range(start='2024-01-01', end='2024-12-31', freq='D')
    df = pd.DataFrame({'Date': dates})

    # 添加流感特徵
    df_with_flu = add_flu_features_to_df(df)

    # 統計
    print("=" * 60)
    print("📊 流感季節特徵統計")
    print("=" * 60)

    print(f"\n流感月份天數: {df_with_flu['Flu_Month'].sum()} 天")
    print(f"高峰期天數: {df_with_flu['Flu_Is_Peak'].sum()} 天")
    print(f"冬季流感季節: {df_with_flu['Flu_Season_Winter'].sum()} 天")
    print(f"夏季流感季節: {df_with_flu['Flu_Season_Summer'].sum()} 天")

    # 按月統計
    print(f"\n每月平均流感強度:")
    monthly_intensity = df_with_flu.groupby(df_with_flu['Date'].dt.month)['Flu_Intensity'].mean()
    for month in range(1, 13):
        if month in monthly_intensity:
            print(f"   {month:2}月: {monthly_intensity[month]:.2f}")

    # 高峰期分佈
    print(f"\n高峰期分佈:")
    peak_months = df_with_flu[df_with_flu['Flu_Is_Peak'] == 1]['Date'].dt.month.value_counts().sort_index()
    for month, count in peak_months.items():
        print(f"   {month:2}月: {count} 天")

    # 分析與就診人數的相關性
    print(f"\n💡 預期影響:")
    print(f"   - 高峰期 (+2.8): MAE 可能增加 15-20 人")
    print(f"   - 流感季節 (+1.5): MAE 可能增加 8-12 人")
    print(f"   - 高峰前後: 短期波動 ±5 人")

    return df_with_flu


def main():
    """測試流感季節特徵"""
    print("=" * 80)
    print("🦠 流感季節特徵模組測試")
    print("=" * 80)
    print(f"時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # 1. 測試今天
    print("1️⃣ 今天的流感特徵")
    today_features = get_flu_season_features(datetime.now())

    print(f"   日期: {datetime.now().strftime('%Y-%m-%d')}")
    for key, value in sorted(today_features.items()):
        print(f"   {key}: {value}")

    # 2. 模擬影響
    print("\n2️⃣ 模擬全年影響")
    simulate_flu_impact()


if __name__ == '__main__':
    main()
