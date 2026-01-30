"""
增強版特徵工程模組 v2.0
目標: 添加 50+ 高級特徵，將 MAE 從 15.77 降至 12.5

新增特徵類別:
1. 高級滾動統計 (偏度、峰度、趨勢)
2. 滯後交互特徵
3. 多層次時間編碼
4. 波動率特徵
5. AQHI 空氣質素
"""
import pandas as pd
import numpy as np
from scipy import stats
from feature_engineering import create_comprehensive_features, load_aqhi_history, add_aqhi_features

def add_advanced_rolling_features(df):
    """
    添加高級滾動統計特徵
    研究基礎: 滾動統計的二階矩能捕捉更多變異信息
    """
    attendance = df['Attendance']
    attendance_shifted = attendance.shift(1)

    new_cols = {}

    # 滾動偏度和峰度 (捕捉分佈形狀)
    for window in [7, 14, 30]:
        # 偏度 (skewness)
        new_cols[f'Attendance_Skew{window}'] = (
            attendance_shifted.rolling(window=window, min_periods=window//2).skew()
        )

        # 峰度 (kurtosis)
        new_cols[f'Attendance_Kurt{window}'] = (
            attendance_shifted.rolling(window=window, min_periods=window//2).kurt()
        )

        # 變異係數 (CV = std/mean)
        rolling_mean = attendance_shifted.rolling(window=window, min_periods=window//2).mean()
        rolling_std = attendance_shifted.rolling(window=window, min_periods=window//2).std()
        new_cols[f'Attendance_CV{window}'] = np.where(
            rolling_mean > 0, rolling_std / rolling_mean, 0
        )

    # 滾動趨勢 (線性回歸斜率)
    def rolling_trend(series, window):
        """計算滾動趨勢 (線性回歸斜率)"""
        trends = []
        for i in range(len(series)):
            if i < window - 1:
                trends.append(np.nan)
            else:
                window_data = series.iloc[i-window+1:i+1].values
                x = np.arange(window)
                try:
                    slope, _ = np.polyfit(x, window_data, 1)
                    trends.append(slope)
                except:
                    trends.append(0)
        return pd.Series(trends, index=series.index)

    for window in [7, 14, 30]:
        new_cols[f'Attendance_Trend{window}'] = rolling_trend(attendance_shifted, window)

    # 滾動分位數
    for window in [14, 30]:
        new_cols[f'Attendance_Q25{window}'] = (
            attendance_shifted.rolling(window=window, min_periods=window//2).quantile(0.25)
        )
        new_cols[f'Attendance_Q75{window}'] = (
            attendance_shifted.rolling(window=window, min_periods=window//2).quantile(0.75)
        )
        new_cols[f'Attendance_IQR{window}'] = (
            new_cols[f'Attendance_Q75{window}'] - new_cols[f'Attendance_Q25{window}']
        )

    # 跨週期滾動比率
    for short, long in [(7, 14), (7, 30), (14, 30)]:
        new_cols[f'Rolling_Ratio_{short}_{long}'] = (
            df[f'Attendance_Rolling{short}'] / df[f'Attendance_Rolling{long}']
        ).fillna(1.0)

    # 合併新特徵
    new_cols_df = pd.DataFrame(new_cols, index=df.index)
    df = pd.concat([df, new_cols_df], axis=1)

    return df


def add_lag_interaction_features(df):
    """
    添加滯後交互特徵
    捕捉不同滯後期的組合影響
    """
    new_cols = {}

    # 滯後 × 週末交互
    if 'Attendance_Lag7' in df.columns and 'Is_Weekend' in df.columns:
        new_cols['Lag7_Weekend'] = df['Attendance_Lag7'] * df['Is_Weekend']

    if 'Attendance_Lag1' in df.columns and 'Is_Weekend' in df.columns:
        new_cols['Lag1_Weekend'] = df['Attendance_Lag1'] * df['Is_Weekend']

    # 滯後 × 假期交互
    if 'Attendance_Lag7' in df.columns and 'Holiday_Factor' in df.columns:
        new_cols['Lag7_Holiday'] = df['Attendance_Lag7'] * df['Holiday_Factor']

    # 滯後 × 季節交互
    if 'Attendance_Lag7' in df.columns and 'Is_Winter_Flu_Season' in df.columns:
        new_cols['Lag7_FluSeason'] = df['Attendance_Lag7'] * df['Is_Winter_Flu_Season']

    # 滯後組合 (多期滯後的加權組合)
    if all(col in df.columns for col in ['Attendance_Lag1', 'Attendance_Lag7', 'Attendance_Lag30']):
        # 指數衰減權重 (近期權重高)
        new_cols['Lag_ExpDecay'] = (
            0.6 * df['Attendance_Lag1'].fillna(0) +
            0.3 * df['Attendance_Lag7'].fillna(0) +
            0.1 * df['Attendance_Lag30'].fillna(0)
        )

        # 平均滯後
        new_cols['Lag_Avg_1_7'] = (
            (df['Attendance_Lag1'].fillna(0) + df['Attendance_Lag7'].fillna(0)) / 2
        )

    # 滯後差分組合
    if 'Lag1_Diff' in df.columns and 'Lag7_Diff' in df.columns:
        new_cols['Lag_Diff_Ratio'] = (
            df['Lag1_Diff'] / (df['Lag7_Diff'].abs() + 1)
        ).fillna(0)

    # 合併新特徵
    new_cols_df = pd.DataFrame(new_cols, index=df.index)
    df = pd.concat([df, new_cols_df], axis=1)

    return df


def add_advanced_time_features(df):
    """
    添加多層次時間編碼特徵
    """
    new_cols = {}

    # 月內位置 (0-1)
    if 'Day_of_Month' in df.columns:
        days_in_month = df['Date'].dt.days_in_month
        new_cols['Month_Position'] = df['Day_of_Month'] / days_in_month

    # 月初/月末標記
    new_cols['Month_Start_5d'] = (df['Day_of_Month'] <= 5).astype(int)
    new_cols['Month_End_5d'] = (df['Day_of_Month'] >= 26).astype(int)

    # 週內位置 (該月的第幾週)
    new_cols['Week_of_Month'] = (df['Day_of_Month'] - 1) // 7 + 1
    new_cols['Week_of_Month'] = new_cols['Week_of_Month'].clip(upper=5)

    # 季節進度 (該季節的第幾天)
    df['Month'] = df['Date'].dt.month
    season_map = {12: 0, 1: 1, 2: 2,   # 冬季
                  3: 0, 4: 1, 5: 2,    # 春季
                  6: 0, 7: 1, 8: 2,    # 夏季
                  9: 0, 10: 1, 11: 2}  # 秋季

    season = df['Month'].map(season_map)
    days_in_season = 90  # 約 90 天一季
    new_cols['Season_Progress'] = season / days_in_season

    # 月度轉換期 (前月最後 3 天 + 後月前 3 天)
    new_cols['Month_Transition'] = (
        (df['Day_of_Month'] <= 3) | (df['Day_of_Month'] >= 28)
    ).astype(int)

    # 工作日/假期交界日
    if 'Is_Holiday' in df.columns:
        # 假日前一天
        new_cols['Day_Before_Holiday'] = df['Is_Holiday'].shift(1).fillna(0).astype(int)
        # 假期後一天
        new_cols['Day_After_Holiday'] = df['Is_Holiday'].shift(-1).fillna(0).astype(int)

    # 合併新特徵
    new_cols_df = pd.DataFrame(new_cols, index=df.index)
    df = pd.concat([df, new_cols_df], axis=1)

    return df


def add_volatility_features(df):
    """
    添加波動率特徵
    """
    new_cols = {}
    attendance_shifted = df['Attendance'].shift(1)

    # 波動率標準差
    for window in [7, 14, 30]:
        rolling_std = attendance_shifted.rolling(window=window, min_periods=window//2).std()
        rolling_mean = attendance_shifted.rolling(window=window, min_periods=window//2).mean()
        new_cols[f'Volatility{window}'] = rolling_std / (rolling_mean + 1e-6)

    # 價格變化範圍
    for window in [7, 14]:
        new_cols[f'Range{window}'] = (
            df[f'Attendance_Max{window}'] - df[f'Attendance_Min{window}']
        )

    # 連續變化檢測
    daily_change = df['Daily_Change']
    new_cols['Consecutive_Increase'] = (daily_change > 0).astype(int)
    new_cols['Consecutive_Decrease'] = (daily_change < 0).astype(int)

    # 累積變化 (5天)
    new_cols['Cumulative_Change_5d'] = daily_change.rolling(window=5, min_periods=1).sum()

    # 合併新特徵
    new_cols_df = pd.DataFrame(new_cols, index=df.index)
    df = pd.concat([df, new_cols_df], axis=1)

    return df


def create_enhanced_features(df, ai_factors_dict=None, include_aqhi=True):
    """
    創建增強版特徵 (v2.0)

    新增 50+ 高級特徵，目標 MAE 改善 20%+
    """
    print("🔧 創建增強版特徵 (v2.0)...")

    # 基礎特徵
    df = create_comprehensive_features(df, ai_factors_dict=ai_factors_dict)
    print(f"   基礎特徵: {len(df.columns)} 列")

    # 1. 高級滾動統計
    df = add_advanced_rolling_features(df)
    print(f"   + 高級滾動特徵: {len(df.columns)} 列")

    # 2. 滯後交互特徵
    df = add_lag_interaction_features(df)
    print(f"   + 滯後交互特徵: {len(df.columns)} 列")

    # 3. 高級時間特徵
    df = add_advanced_time_features(df)
    print(f"   + 高級時間特徵: {len(df.columns)} 列")

    # 4. 波動率特徵
    df = add_volatility_features(df)
    print(f"   + 波動率特徵: {len(df.columns)} 列")

    # 5. AQHI 空氣質素
    if include_aqhi:
        df = add_aqhi_features(df)
        print(f"   + AQHI 特徵: {len(df.columns)} 列")

    print(f"   ✅ 總特徵數: {len(df.columns)} 列")

    return df


def get_enhanced_feature_columns():
    """返回增強版特徵列表"""
    # 基礎特徵 (25 個)
    base_features = [
        "Attendance_EWMA7", "Attendance_EWMA14", "Daily_Change", "Monthly_Change",
        "Attendance_Lag1", "Weekly_Change", "Attendance_Rolling7", "Attendance_Position7",
        "Attendance_Lag30", "Attendance_Lag7", "Day_of_Week", "Lag1_Diff",
        "DayOfWeek_sin", "Attendance_Rolling14", "Attendance_Position14",
        "Attendance_Position30", "Attendance_Rolling3", "Attendance_Min7",
        "Attendance_Median14", "DayOfWeek_Target_Mean", "Attendance_Median3",
        "Attendance_EWMA30", "Is_Winter_Flu_Season", "Is_Weekend", "Holiday_Factor"
    ]

    # 高級滾動特徵 (約 20 個)
    rolling_features = [
        "Attendance_Skew7", "Attendance_Skew14", "Attendance_Skew30",
        "Attendance_Kurt7", "Attendance_Kurt14", "Attendance_Kurt30",
        "Attendance_CV7", "Attendance_CV14", "Attendance_CV30",
        "Attendance_Trend7", "Attendance_Trend14", "Attendance_Trend30",
        "Attendance_Q25_14", "Attendance_Q75_14", "Attendance_IQR_14",
        "Attendance_Q25_30", "Attendance_Q75_30", "Attendance_IQR_30",
        "Rolling_Ratio_7_14", "Rolling_Ratio_7_30", "Rolling_Ratio_14_30"
    ]

    # 滯後交互特徵 (約 8 個)
    lag_features = [
        "Lag7_Weekend", "Lag1_Weekend", "Lag7_Holiday", "Lag7_FluSeason",
        "Lag_ExpDecay", "Lag_Avg_1_7", "Lag_Diff_Ratio"
    ]

    # 高級時間特徵 (約 8 個)
    time_features = [
        "Month_Position", "Month_Start_5d", "Month_End_5d",
        "Week_of_Month", "Season_Progress", "Month_Transition",
        "Day_Before_Holiday", "Day_After_Holiday"
    ]

    # 波動率特徵 (約 6 個)
    volatility_features = [
        "Volatility7", "Volatility14", "Volatility30",
        "Range7", "Range14", "Consecutive_Increase", "Cumulative_Change_5d"
    ]

    # AQHI 特徵 (約 6 個)
    aqhi_features = [
        "AQHI_General", "AQHI_Risk", "AQHI_High", "AQHI_VeryHigh"
    ]

    all_features = (
        base_features + rolling_features + lag_features +
        time_features + volatility_features + aqhi_features
    )

    return all_features
