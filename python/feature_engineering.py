"""
特徵工程模組
根據 AI-AED-Algorithm-Specification.txt 創建所有特徵
"""
import pandas as pd
import numpy as np
from datetime import datetime

def create_comprehensive_features(df, ai_factors_dict=None):
    """
    創建所有特徵用於 NDH AED 就診預測
    
    參數:
        df: DataFrame，必須包含 'Date' 和 'Attendance' 列
        ai_factors_dict: dict，日期字符串到 AI 因子的映射，格式: {'YYYY-MM-DD': {'impactFactor': 1.05, ...}}
    
    返回:
        DataFrame with all engineered features
    """
    # 確保 Date 是 datetime
    if not pd.api.types.is_datetime64_any_dtype(df['Date']):
        df['Date'] = pd.to_datetime(df['Date'])
    
    df = df.sort_values('Date').reset_index(drop=True)
    
    # ============ 時間特徵 ============
    df['Year'] = df['Date'].dt.year
    df['Month'] = df['Date'].dt.month
    df['Day_of_Week'] = df['Date'].dt.dayofweek  # 0=Monday, 6=Sunday
    df['Day_of_Month'] = df['Date'].dt.day
    df['Week_of_Year'] = df['Date'].dt.isocalendar().week
    df['Quarter'] = df['Date'].dt.quarter
    df['DayOfYear'] = df['Date'].dt.dayofyear
    df['Days_Since_Start'] = (df['Date'] - df['Date'].min()).dt.days
    
    # ============ 循環編碼（關鍵！）============
    df['Month_sin'] = np.sin(2 * np.pi * df['Month'] / 12)
    df['Month_cos'] = np.cos(2 * np.pi * df['Month'] / 12)
    df['DayOfWeek_sin'] = np.sin(2 * np.pi * df['Day_of_Week'] / 7)
    df['DayOfWeek_cos'] = np.cos(2 * np.pi * df['Day_of_Week'] / 7)
    
    # ============ 滯後特徵 ============
    for lag in [1, 7, 14, 30, 60, 90, 365]:
        df[f'Attendance_Lag{lag}'] = df['Attendance'].shift(lag)
    
    # 填充 NaN 滯後值
    lag_cols = [col for col in df.columns if col.startswith('Attendance_Lag')]
    # 先向後填充，然後用平均值填充
    df[lag_cols] = df[lag_cols].fillna(method='bfill')
    for col in lag_cols:
        df[col] = df[col].fillna(df['Attendance'].mean())
    
    # ============ 滾動統計 ============
    for window in [7, 14, 30]:
        df[f'Attendance_Rolling{window}'] = df['Attendance'].rolling(window=window, min_periods=1).mean()
        df[f'Attendance_Std{window}'] = df['Attendance'].rolling(window=window, min_periods=1).std()
        df[f'Attendance_Max{window}'] = df['Attendance'].rolling(window=window, min_periods=1).max()
        df[f'Attendance_Min{window}'] = df['Attendance'].rolling(window=window, min_periods=1).min()
    
    # 填充 NaN 滾動值
    rolling_cols = [col for col in df.columns if any(x in col for x in ['Rolling', 'Std', 'Max', 'Min'])]
    df[rolling_cols] = df[rolling_cols].fillna(method='bfill')
    
    # ============ 二進制事件指標 ============
    df['Is_COVID_Period'] = ((df['Year'] >= 2020) & (df['Year'] <= 2022)).astype(int)
    df['Is_Omicron_Wave'] = ((df['Year'] == 2022) & (df['Month'] <= 5)).astype(int)
    df['Is_Winter_Flu_Season'] = df['Month'].isin([12, 1, 2, 3]).astype(int)
    df['Is_Summer_Period'] = df['Month'].isin([6, 7, 8]).astype(int)
    df['Is_Weekend'] = (df['Day_of_Week'] >= 5).astype(int)
    df['Is_Monday'] = (df['Day_of_Week'] == 0).astype(int)
    df['Is_Protest_Period'] = ((df['Year'] == 2019) & (df['Month'].isin([6, 7, 8, 9, 10, 11, 12]))).astype(int)
    df['Is_Umbrella_Movement'] = ((df['Year'] == 2014) & (df['Month'].isin([9, 10, 11, 12]))).astype(int)
    
    # ============ 交互特徵 ============
    df['Is_COVID_AND_Winter'] = df['Is_COVID_Period'] * df['Is_Winter_Flu_Season']
    df['Is_Monday_AND_Winter'] = df['Is_Monday'] * df['Is_Winter_Flu_Season']
    df['Is_Weekend_AND_Summer'] = df['Is_Weekend'] * df['Is_Summer_Period']
    
    # ============ 趨勢特徵 ============
    df['Trend_Normalized'] = df['Days_Since_Start'] / df['Days_Since_Start'].max() if df['Days_Since_Start'].max() > 0 else 0
    
    # 時代指標
    df['Era_Indicator'] = df['Year'].apply(lambda y: 1 if y < 2020 else (2 if y <= 2022 else 3))
    
    # ============ 變化率 ============
    df['Daily_Change'] = df['Attendance'].diff()
    df['Weekly_Change'] = df['Attendance'].diff(7)
    df['Monthly_Change'] = df['Attendance'].diff(30)
    
    # 填充 NaN 變化率
    df['Daily_Change'] = df['Daily_Change'].fillna(0)
    df['Weekly_Change'] = df['Weekly_Change'].fillna(0)
    df['Monthly_Change'] = df['Monthly_Change'].fillna(0)
    
    # ============ 假期特徵（簡化版，可擴展）============
    # 香港固定假期
    hk_holidays = [
        (1, 1),   # 元旦
        (5, 1),   # 勞動節
        (10, 1),  # 國慶日
        (12, 25), # 聖誕節
        (12, 26), # 節禮日
    ]
    
    df['Is_Holiday'] = df['Date'].apply(
        lambda x: 1 if (x.month, x.day) in hk_holidays else 0
    )
    
    # 計算到最近假期的天數（簡化）
    df['Days_To_Next_Holiday'] = 0  # 可擴展為實際計算
    
    # ============ AI 因子特徵 ============
    if ai_factors_dict is not None:
        # 將日期轉換為字符串格式用於匹配
        df['Date_Str'] = df['Date'].dt.strftime('%Y-%m-%d')
        
        # AI 因子（impactFactor）
        df['AI_Factor'] = df['Date_Str'].apply(
            lambda x: ai_factors_dict.get(x, {}).get('impactFactor', 1.0) if isinstance(ai_factors_dict.get(x, {}), dict) else 1.0
        )
        
        # AI 因子是否存在（二進制指標）
        df['Has_AI_Factor'] = df['Date_Str'].apply(
            lambda x: 1 if x in ai_factors_dict and ai_factors_dict.get(x) else 0
        )
        
        # AI 因子類型編碼（如果有類型信息）
        # 將類型映射為數值：'positive'=1, 'negative'=-1, 'neutral'=0, 其他=0
        def encode_ai_type(date_str):
            factor_data = ai_factors_dict.get(date_str, {})
            if not isinstance(factor_data, dict):
                return 0
            ai_type = factor_data.get('type', '').lower()
            if 'positive' in ai_type or '增加' in ai_type or '上升' in ai_type:
                return 1
            elif 'negative' in ai_type or '減少' in ai_type or '下降' in ai_type:
                return -1
            else:
                return 0
        
        df['AI_Factor_Type'] = df['Date_Str'].apply(encode_ai_type)
        
        # 移除臨時列
        df = df.drop(columns=['Date_Str'])
    else:
        # 如果沒有 AI 數據，設置默認值
        df['AI_Factor'] = 1.0
        df['Has_AI_Factor'] = 0
        df['AI_Factor_Type'] = 0
    
    return df

def get_feature_columns():
    """返回所有特徵列名（排除目標變量和日期）"""
    # 這些是我們創建的所有特徵
    feature_cols = [
        'Year', 'Month', 'Day_of_Week', 'Day_of_Month', 'Week_of_Year', 
        'Quarter', 'DayOfYear', 'Days_Since_Start',
        'Month_sin', 'Month_cos', 'DayOfWeek_sin', 'DayOfWeek_cos',
        'Attendance_Lag1', 'Attendance_Lag7', 'Attendance_Lag14', 
        'Attendance_Lag30', 'Attendance_Lag60', 'Attendance_Lag90', 'Attendance_Lag365',
        'Attendance_Rolling7', 'Attendance_Rolling14', 'Attendance_Rolling30',
        'Attendance_Std7', 'Attendance_Std14', 'Attendance_Std30',
        'Attendance_Max7', 'Attendance_Max14', 'Attendance_Max30',
        'Attendance_Min7', 'Attendance_Min14', 'Attendance_Min30',
        'Is_COVID_Period', 'Is_Omicron_Wave', 'Is_Winter_Flu_Season',
        'Is_Summer_Period', 'Is_Weekend', 'Is_Monday',
        'Is_Protest_Period', 'Is_Umbrella_Movement',
        'Is_COVID_AND_Winter', 'Is_Monday_AND_Winter', 'Is_Weekend_AND_Summer',
        'Trend_Normalized', 'Era_Indicator',
        'Daily_Change', 'Weekly_Change', 'Monthly_Change',
        'Is_Holiday', 'Days_To_Next_Holiday',
        'AI_Factor', 'Has_AI_Factor', 'AI_Factor_Type'
    ]
    return feature_cols

