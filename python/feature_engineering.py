"""
特徵工程模組
根據 AI-AED-Algorithm-Specification.txt 創建所有特徵
"""
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

# ============ 香港公眾假期資料庫 ============
def get_hk_public_holidays(year):
    """
    獲取指定年份的香港公眾假期
    包含固定假期和農曆假期（使用查表法）
    
    返回: dict，格式 {(month, day): holiday_name}
    """
    holidays = {}
    
    # ===== 固定假期（每年相同日期）=====
    fixed_holidays = {
        (1, 1): '元旦',
        (5, 1): '勞動節',
        (7, 1): '香港特別行政區成立紀念日',
        (10, 1): '國慶日',
        (12, 25): '聖誕節',
        (12, 26): '聖誕節翌日',
    }
    holidays.update(fixed_holidays)
    
    # ===== 農曆假期（每年日期不同，使用查表法）=====
    # 農曆新年（年初一、初二、初三）
    lunar_new_year = {
        2014: [(1, 31), (2, 1), (2, 2)],
        2015: [(2, 19), (2, 20), (2, 21)],
        2016: [(2, 8), (2, 9), (2, 10)],
        2017: [(1, 28), (1, 29), (1, 30)],
        2018: [(2, 16), (2, 17), (2, 18)],
        2019: [(2, 5), (2, 6), (2, 7)],
        2020: [(1, 25), (1, 26), (1, 27)],
        2021: [(2, 12), (2, 13), (2, 14)],
        2022: [(2, 1), (2, 2), (2, 3)],
        2023: [(1, 22), (1, 23), (1, 24)],
        2024: [(2, 10), (2, 11), (2, 12)],
        2025: [(1, 29), (1, 30), (1, 31)],
        2026: [(2, 17), (2, 18), (2, 19)],
        2027: [(2, 6), (2, 7), (2, 8)],
        2028: [(1, 26), (1, 27), (1, 28)],
        2029: [(2, 13), (2, 14), (2, 15)],
        2030: [(2, 3), (2, 4), (2, 5)],
    }
    if year in lunar_new_year:
        for m, d in lunar_new_year[year]:
            holidays[(m, d)] = '農曆新年'
    
    # 清明節
    ching_ming = {
        2014: (4, 5), 2015: (4, 5), 2016: (4, 4), 2017: (4, 4),
        2018: (4, 5), 2019: (4, 5), 2020: (4, 4), 2021: (4, 4),
        2022: (4, 5), 2023: (4, 5), 2024: (4, 4), 2025: (4, 4),
        2026: (4, 5), 2027: (4, 5), 2028: (4, 4), 2029: (4, 4),
        2030: (4, 5),
    }
    if year in ching_ming:
        m, d = ching_ming[year]
        holidays[(m, d)] = '清明節'
    
    # 端午節
    dragon_boat = {
        2014: (6, 2), 2015: (6, 20), 2016: (6, 9), 2017: (5, 30),
        2018: (6, 18), 2019: (6, 7), 2020: (6, 25), 2021: (6, 14),
        2022: (6, 3), 2023: (6, 22), 2024: (6, 10), 2025: (5, 31),
        2026: (6, 19), 2027: (6, 9), 2028: (5, 28), 2029: (6, 16),
        2030: (6, 5),
    }
    if year in dragon_boat:
        m, d = dragon_boat[year]
        holidays[(m, d)] = '端午節'
    
    # 中秋節翌日
    mid_autumn = {
        2014: (9, 9), 2015: (9, 28), 2016: (9, 16), 2017: (10, 5),
        2018: (9, 25), 2019: (9, 14), 2020: (10, 2), 2021: (9, 22),
        2022: (9, 12), 2023: (9, 30), 2024: (9, 18), 2025: (10, 7),
        2026: (9, 26), 2027: (9, 16), 2028: (10, 4), 2029: (9, 23),
        2030: (9, 13),
    }
    if year in mid_autumn:
        m, d = mid_autumn[year]
        holidays[(m, d)] = '中秋節翌日'
    
    # 重陽節
    chung_yeung = {
        2014: (10, 2), 2015: (10, 21), 2016: (10, 9), 2017: (10, 28),
        2018: (10, 17), 2019: (10, 7), 2020: (10, 26), 2021: (10, 14),
        2022: (10, 4), 2023: (10, 23), 2024: (10, 11), 2025: (10, 29),
        2026: (10, 18), 2027: (10, 8), 2028: (10, 26), 2029: (10, 16),
        2030: (10, 5),
    }
    if year in chung_yeung:
        m, d = chung_yeung[year]
        holidays[(m, d)] = '重陽節'
    
    # 佛誕
    buddha_birthday = {
        2014: (5, 6), 2015: (5, 25), 2016: (5, 14), 2017: (5, 3),
        2018: (5, 22), 2019: (5, 12), 2020: (4, 30), 2021: (5, 19),
        2022: (5, 8), 2023: (5, 26), 2024: (5, 15), 2025: (5, 5),
        2026: (5, 24), 2027: (5, 13), 2028: (5, 2), 2029: (5, 20),
        2030: (5, 9),
    }
    if year in buddha_birthday:
        m, d = buddha_birthday[year]
        holidays[(m, d)] = '佛誕'
    
    # 復活節（耶穌受難日、耶穌受難日翌日、復活節星期一）
    easter = {
        2014: [(4, 18), (4, 19), (4, 21)],
        2015: [(4, 3), (4, 4), (4, 6)],
        2016: [(3, 25), (3, 26), (3, 28)],
        2017: [(4, 14), (4, 15), (4, 17)],
        2018: [(3, 30), (3, 31), (4, 2)],
        2019: [(4, 19), (4, 20), (4, 22)],
        2020: [(4, 10), (4, 11), (4, 13)],
        2021: [(4, 2), (4, 3), (4, 5)],
        2022: [(4, 15), (4, 16), (4, 18)],
        2023: [(4, 7), (4, 8), (4, 10)],
        2024: [(3, 29), (3, 30), (4, 1)],
        2025: [(4, 18), (4, 19), (4, 21)],
        2026: [(4, 3), (4, 4), (4, 6)],
        2027: [(3, 26), (3, 27), (3, 29)],
        2028: [(4, 14), (4, 15), (4, 17)],
        2029: [(3, 30), (3, 31), (4, 2)],
        2030: [(4, 19), (4, 20), (4, 22)],
    }
    if year in easter:
        names = ['耶穌受難日', '耶穌受難日翌日', '復活節星期一']
        for i, (m, d) in enumerate(easter[year]):
            holidays[(m, d)] = names[i]
    
    return holidays


def get_holiday_info(date):
    """
    獲取指定日期的假期信息
    
    返回: (is_holiday, holiday_name, holiday_factor)
    """
    year = date.year
    month = date.month
    day = date.day
    
    holidays = get_hk_public_holidays(year)
    
    if (month, day) in holidays:
        holiday_name = holidays[(month, day)]
        # 不同假期的影響因子
        holiday_factors = {
            '農曆新年': 0.75,       # 農曆新年通常急診較少
            '聖誕節': 0.85,
            '聖誕節翌日': 0.88,
            '元旦': 0.90,
            '清明節': 0.92,
            '端午節': 0.92,
            '中秋節翌日': 0.92,
            '重陽節': 0.92,
            '佛誕': 0.93,
            '勞動節': 0.93,
            '耶穌受難日': 0.90,
            '耶穌受難日翌日': 0.90,
            '復活節星期一': 0.92,
            '香港特別行政區成立紀念日': 0.93,
            '國慶日': 0.93,
        }
        factor = holiday_factors.get(holiday_name, 0.92)
        return True, holiday_name, factor
    
    return False, None, 1.0


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
    
    # ============ 批量建立特徵以避免 DataFrame 碎片化 ============
    # 使用字典收集所有新欄位，最後一次性合併
    new_cols = {}
    
    # ============ 時間特徵 ============
    new_cols['Year'] = df['Date'].dt.year
    new_cols['Month'] = df['Date'].dt.month
    new_cols['Day_of_Week'] = df['Date'].dt.dayofweek  # 0=Monday, 6=Sunday
    new_cols['Day_of_Month'] = df['Date'].dt.day
    new_cols['Week_of_Year'] = df['Date'].dt.isocalendar().week.values
    new_cols['Quarter'] = df['Date'].dt.quarter
    new_cols['DayOfYear'] = df['Date'].dt.dayofyear
    new_cols['Days_Since_Start'] = (df['Date'] - df['Date'].min()).dt.days
    
    # ============ 循環編碼（關鍵！）============
    month_vals = new_cols['Month']
    dow_vals = new_cols['Day_of_Week']
    doy_vals = new_cols['DayOfYear']
    
    new_cols['Month_sin'] = np.sin(2 * np.pi * month_vals / 12)
    new_cols['Month_cos'] = np.cos(2 * np.pi * month_vals / 12)
    new_cols['DayOfWeek_sin'] = np.sin(2 * np.pi * dow_vals / 7)
    new_cols['DayOfWeek_cos'] = np.cos(2 * np.pi * dow_vals / 7)
    
    # ============ Fourier 季節特徵（研究基礎）============
    # 參考: Facebook Prophet, BMC Medical Informatics 2024
    # 多階 Fourier 特徵可以捕捉複雜的周期性模式
    days_in_year = 365.25
    for k in range(1, 4):  # 3 階 Fourier 特徵
        new_cols[f'Fourier_Year_sin_{k}'] = np.sin(2 * np.pi * k * doy_vals / days_in_year)
        new_cols[f'Fourier_Year_cos_{k}'] = np.cos(2 * np.pi * k * doy_vals / days_in_year)
    
    # 週內 Fourier 特徵
    for k in range(1, 3):  # 2 階 Fourier 特徵
        new_cols[f'Fourier_Week_sin_{k}'] = np.sin(2 * np.pi * k * dow_vals / 7)
        new_cols[f'Fourier_Week_cos_{k}'] = np.cos(2 * np.pi * k * dow_vals / 7)
    
    # ============ 滯後特徵 (擴展版 v2.9.30) ============
    # 研究基礎: 短期滯後對急診預測非常重要
    # 添加連續短期滯後 (1-7天) 以捕捉短期趨勢
    short_lags = [1, 2, 3, 4, 5, 6, 7]
    medium_lags = [14, 21, 28]  # 兩週、三週、四週
    long_lags = [30, 60, 90, 180, 365]  # 長期季節性
    all_lags = short_lags + medium_lags + long_lags
    
    attendance = df['Attendance']
    for lag in all_lags:
        lag_col = attendance.shift(lag)
        new_cols[f'Attendance_Lag{lag}'] = lag_col
        new_cols[f'Lag{lag}_Available'] = lag_col.notna().astype(int)
    
    # ============ 同星期歷史滯後 (關鍵改進!) ============
    # 上週同一天、兩週前同一天等（捕捉週期性模式）
    same_weekday_cols = {}
    for weeks_ago in [1, 2, 3, 4]:
        lag_days = weeks_ago * 7
        col_name = f'Attendance_Same_Weekday_{weeks_ago}w'
        same_weekday_cols[col_name] = attendance.shift(lag_days)
        new_cols[col_name] = same_weekday_cols[col_name]
    
    # 計算同星期的平均值（過去4週的同一天平均）
    new_cols['Attendance_Same_Weekday_Avg'] = (
        same_weekday_cols['Attendance_Same_Weekday_1w'].fillna(0) + 
        same_weekday_cols['Attendance_Same_Weekday_2w'].fillna(0) + 
        same_weekday_cols['Attendance_Same_Weekday_3w'].fillna(0) + 
        same_weekday_cols['Attendance_Same_Weekday_4w'].fillna(0)
    ) / 4
    
    # ============ 差分特徵 (捕捉動量) ============
    lag1 = new_cols['Attendance_Lag1']
    lag2 = new_cols['Attendance_Lag2']
    lag7 = new_cols['Attendance_Lag7']
    lag14 = new_cols['Attendance_Lag14']
    new_cols['Lag1_Diff'] = lag1 - lag2  # 昨天 vs 前天
    new_cols['Lag7_Diff'] = lag7 - lag14  # 上週 vs 兩週前
    
    # ============ 指數加權移動平均 (EWMA) ============
    # 研究表明 EWMA 比簡單滾動平均更能捕捉趨勢
    for span in [7, 14, 30]:
        new_cols[f'Attendance_EWMA{span}'] = attendance.ewm(span=span, min_periods=1).mean()
    
    # 不填充 NaN - 讓 XGBoost 自行處理缺失值
    # XGBoost 原生支持缺失值處理，會自動學習最佳分割方向
    
    # ============ 滾動統計 (擴展版 v2.9.30) ============
    # 使用 min_periods 確保至少有足夠數據才計算，否則保留 NaN
    attendance_shifted = attendance.shift(1)
    rolling_cols = {}
    for window in [3, 7, 14, 21, 30, 60, 90]:
        min_req = max(2, window // 2)
        roll = attendance_shifted.rolling(window=window, min_periods=min_req)
        rolling_cols[f'Attendance_Rolling{window}'] = roll.mean()
        rolling_cols[f'Attendance_Std{window}'] = roll.std()
        rolling_cols[f'Attendance_Max{window}'] = roll.max()
        rolling_cols[f'Attendance_Min{window}'] = roll.min()
        rolling_cols[f'Attendance_Median{window}'] = roll.median()
        rolling_cols[f'Rolling{window}_Available'] = rolling_cols[f'Attendance_Rolling{window}'].notna().astype(int)
    
    new_cols.update(rolling_cols)
    
    # ============ 相對位置特徵 (關鍵改進!) ============
    # 當前值相對於滾動範圍的位置（歸一化到 0-1）
    for window in [7, 14, 30]:
        range_col = rolling_cols[f'Attendance_Max{window}'] - rolling_cols[f'Attendance_Min{window}']
        new_cols[f'Attendance_Position{window}'] = np.where(
            range_col > 0,
            (lag1 - rolling_cols[f'Attendance_Min{window}']) / range_col,
            0.5
        )
    
    # ============ 變異係數 (CV) ============
    # 標準差 / 平均值，衡量波動程度
    for window in [7, 14, 30]:
        new_cols[f'Attendance_CV{window}'] = np.where(
            rolling_cols[f'Attendance_Rolling{window}'] > 0,
            rolling_cols[f'Attendance_Std{window}'] / rolling_cols[f'Attendance_Rolling{window}'],
            0
        )
    
    # 不填充 NaN - 讓 XGBoost 自行處理缺失值
    
    # ============ 二進制事件指標 ============
    year_vals = new_cols['Year']
    month_vals_series = pd.Series(month_vals) if not isinstance(month_vals, pd.Series) else month_vals
    new_cols['Is_COVID_Period'] = ((year_vals >= 2020) & (year_vals <= 2022)).astype(int)
    new_cols['Is_Omicron_Wave'] = ((year_vals == 2022) & (month_vals <= 5)).astype(int)
    new_cols['Is_Winter_Flu_Season'] = month_vals_series.isin([12, 1, 2, 3]).astype(int)
    new_cols['Is_Summer_Period'] = month_vals_series.isin([6, 7, 8]).astype(int)
    new_cols['Is_Weekend'] = (dow_vals >= 5).astype(int)
    new_cols['Is_Monday'] = (dow_vals == 0).astype(int)
    new_cols['Is_Protest_Period'] = ((year_vals == 2019) & (month_vals_series.isin([6, 7, 8, 9, 10, 11, 12]))).astype(int)
    new_cols['Is_Umbrella_Movement'] = ((year_vals == 2014) & (month_vals_series.isin([9, 10, 11, 12]))).astype(int)
    
    # ============ 交互特徵 ============
    new_cols['Is_COVID_AND_Winter'] = new_cols['Is_COVID_Period'] * new_cols['Is_Winter_Flu_Season']
    new_cols['Is_Monday_AND_Winter'] = new_cols['Is_Monday'] * new_cols['Is_Winter_Flu_Season']
    new_cols['Is_Weekend_AND_Summer'] = new_cols['Is_Weekend'] * new_cols['Is_Summer_Period']
    
    # ============ 趨勢特徵 ============
    days_since_start = new_cols['Days_Since_Start']
    max_days = days_since_start.max() if hasattr(days_since_start, 'max') else max(days_since_start)
    new_cols['Trend_Normalized'] = days_since_start / max_days if max_days > 0 else 0
    
    # 時代指標
    new_cols['Era_Indicator'] = pd.Series(year_vals).apply(lambda y: 1 if y < 2020 else (2 if y <= 2022 else 3)).values
    
    # ============ 一次性合併所有新欄位 ============
    new_cols_df = pd.DataFrame(new_cols, index=df.index)
    df = pd.concat([df, new_cols_df], axis=1)
    
    # ============ 目標編碼特徵 (關鍵改進 v2.9.30!) ============
    # 使用歷史數據計算每個分類的平均出席人數（防止數據洩漏）
    # 這些特徵捕捉了「週一通常多少人」等模式
    
    # 星期幾的歷史平均（使用累積平均，避免洩漏）
    df['DayOfWeek_Target_Mean'] = df.groupby('Day_of_Week')['Attendance'].transform(
        lambda x: x.expanding().mean().shift(1)
    )
    
    # 月份的歷史平均
    df['Month_Target_Mean'] = df.groupby('Month')['Attendance'].transform(
        lambda x: x.expanding().mean().shift(1)
    )
    
    # 年-月組合的歷史平均（捕捉年度季節性變化）
    df['YearMonth'] = df['Year'] * 100 + df['Month']
    df['YearMonth_Target_Mean'] = df.groupby('YearMonth')['Attendance'].transform(
        lambda x: x.expanding().mean().shift(1)
    )
    df = df.drop(columns=['YearMonth'])
    
    # 填充初始 NaN（第一次出現的分組沒有歷史數據）
    expanding_mean = df['Attendance'].expanding().mean().shift(1)
    df['DayOfWeek_Target_Mean'] = df['DayOfWeek_Target_Mean'].fillna(expanding_mean)
    df['Month_Target_Mean'] = df['Month_Target_Mean'].fillna(expanding_mean)
    df['YearMonth_Target_Mean'] = df['YearMonth_Target_Mean'].fillna(expanding_mean)
    
    # ============ 變化率 ============
    df['Daily_Change'] = df['Attendance'].diff().fillna(0)
    df['Weekly_Change'] = df['Attendance'].diff(7).fillna(0)
    df['Monthly_Change'] = df['Attendance'].diff(30).fillna(0)
    
    # 反碎片化 DataFrame
    df = df.copy()
    
    # ============ 假期特徵（完整香港公眾假期）============
    def get_holiday_features(date):
        """獲取假期相關特徵"""
        is_holiday, holiday_name, factor = get_holiday_info(date)
        return pd.Series({
            'Is_Holiday': 1 if is_holiday else 0,
            'Holiday_Factor': factor,
            'Is_Lunar_Holiday': 1 if is_holiday and holiday_name in ['農曆新年', '端午節', '中秋節翌日', '重陽節', '佛誕', '清明節'] else 0,
            'Is_Christmas_Period': 1 if date.month == 12 and date.day >= 24 or (date.month == 1 and date.day <= 2) else 0,
            'Is_Easter_Period': 1 if is_holiday and holiday_name in ['耶穌受難日', '耶穌受難日翌日', '復活節星期一'] else 0,
            'Is_CNY_Period': 1 if is_holiday and holiday_name == '農曆新年' else 0,
        })
    
    holiday_features = df['Date'].apply(get_holiday_features)
    df = pd.concat([df, holiday_features], axis=1)
    
    # 計算到最近假期的天數
    def days_to_next_holiday(date):
        """計算到下一個公眾假期的天數"""
        holidays = get_hk_public_holidays(date.year)
        next_year_holidays = get_hk_public_holidays(date.year + 1)
        
        min_days = 366  # 最大值
        for (m, d) in list(holidays.keys()) + [(m, d) for (m, d) in next_year_holidays.keys()]:
            try:
                if m <= 12 and d <= 31:  # 基本驗證
                    if (m, d) in holidays:
                        holiday_date = datetime(date.year, m, d)
                    else:
                        holiday_date = datetime(date.year + 1, m, d)
                    delta = (holiday_date - date).days
                    if 0 < delta < min_days:
                        min_days = delta
            except ValueError:
                continue
        return min_days if min_days < 366 else 0
    
    df['Days_To_Next_Holiday'] = df['Date'].apply(lambda x: days_to_next_holiday(x.to_pydatetime() if hasattr(x, 'to_pydatetime') else x))
    
    # 假期前後效應
    df['Is_Day_Before_Holiday'] = (df['Days_To_Next_Holiday'] == 1).astype(int)
    df['Is_Day_After_Holiday'] = df['Is_Holiday'].shift(1).fillna(0).astype(int)
    
    # ============ AI 因子特徵（全面版）============
    if ai_factors_dict is not None and len(ai_factors_dict) > 0:
        # 將日期轉換為字符串格式用於匹配
        df['Date_Str'] = df['Date'].dt.strftime('%Y-%m-%d')
        
        def extract_ai_features(date_str):
            """從 AI 因子數據中提取多維度特徵"""
            factor_data = ai_factors_dict.get(date_str, {})
            if not isinstance(factor_data, dict):
                return pd.Series({
                    'AI_Impact_Factor': 1.0,
                    'AI_Impact_Magnitude': 0.0,
                    'AI_Impact_Direction': 0,
                    'AI_Confidence_Score': 0.0,
                    'AI_Factor_Count': 0,
                    'AI_Type_Weather': 0,
                    'AI_Type_Health': 0,
                    'AI_Type_Policy': 0,
                    'AI_Type_Event': 0,
                    'AI_Type_Seasonal': 0,
                    'Has_AI_Factor': 0,
                })
            
            # 基礎影響因子（限制在 0.7-1.3 範圍內）
            impact_factor = factor_data.get('impactFactor', 1.0)
            impact_factor = max(0.7, min(1.3, impact_factor))
            
            # 影響幅度（距離 1.0 的絕對距離，表示影響強度）
            impact_magnitude = abs(impact_factor - 1.0)
            
            # 影響方向（+1=增加, -1=減少, 0=無影響）
            if impact_factor > 1.02:
                impact_direction = 1
            elif impact_factor < 0.98:
                impact_direction = -1
            else:
                impact_direction = 0
            
            # 信心分數（高=1.0, 中=0.6, 低=0.3）
            confidence = factor_data.get('confidence', '中').lower()
            if '高' in confidence or 'high' in confidence:
                confidence_score = 1.0
            elif '低' in confidence or 'low' in confidence:
                confidence_score = 0.3
            else:
                confidence_score = 0.6
            
            # 因子類型編碼（獨熱編碼）
            factor_type = factor_data.get('type', '').lower()
            type_weather = 1 if any(w in factor_type for w in ['天氣', '氣溫', '濕度', '雨', '熱', '冷', 'weather', 'temperature']) else 0
            type_health = 1 if any(w in factor_type for w in ['健康', '流感', '疫情', '病毒', '公共衛生', 'health', 'flu', 'virus']) else 0
            type_policy = 1 if any(w in factor_type for w in ['政策', '當局', '醫院', '醫管局', 'policy', 'hospital']) else 0
            type_event = 1 if any(w in factor_type for w in ['事件', '新聞', '社會', 'event', 'news']) else 0
            type_seasonal = 1 if any(w in factor_type for w in ['季節', '節日', '假期', 'season', 'holiday']) else 0
            
            return pd.Series({
                'AI_Impact_Factor': impact_factor,
                'AI_Impact_Magnitude': impact_magnitude,
                'AI_Impact_Direction': impact_direction,
                'AI_Confidence_Score': confidence_score,
                'AI_Factor_Count': 1,  # 該日期有 AI 因子
                'AI_Type_Weather': type_weather,
                'AI_Type_Health': type_health,
                'AI_Type_Policy': type_policy,
                'AI_Type_Event': type_event,
                'AI_Type_Seasonal': type_seasonal,
                'Has_AI_Factor': 1,
            })
        
        ai_features = df['Date_Str'].apply(extract_ai_features)
        df = pd.concat([df, ai_features], axis=1)
        
        # 移除臨時列
        df = df.drop(columns=['Date_Str'])
        
        # 計算 AI 因子的滾動特徵（過去 7 天的平均影響）
        df['AI_Impact_Rolling7'] = df['AI_Impact_Factor'].rolling(window=7, min_periods=1).mean()
        df['AI_Impact_Trend'] = df['AI_Impact_Factor'].diff(1).fillna(0)  # 影響因子變化趨勢
        
    else:
        # 如果沒有 AI 數據，設置默認值
        df['AI_Impact_Factor'] = 1.0
        df['AI_Impact_Magnitude'] = 0.0
        df['AI_Impact_Direction'] = 0
        df['AI_Confidence_Score'] = 0.0
        df['AI_Factor_Count'] = 0
        df['AI_Type_Weather'] = 0
        df['AI_Type_Health'] = 0
        df['AI_Type_Policy'] = 0
        df['AI_Type_Event'] = 0
        df['AI_Type_Seasonal'] = 0
        df['Has_AI_Factor'] = 0
        df['AI_Impact_Rolling7'] = 1.0
        df['AI_Impact_Trend'] = 0.0
    
    # ============ 天氣特徵（香港天文台歷史數據）============
    weather_df = load_weather_history()
    df = add_weather_features(df, weather_df)
    
    # ============ 天氣警告特徵（颱風、暴雨、酷熱/寒冷警告）============
    df = add_weather_warning_features(df)
    
    return df

def get_feature_columns():
    """返回所有特徵列名（排除目標變量和日期）- v2.9.30 擴展版"""
    # 這些是我們創建的所有特徵
    feature_cols = [
        # 時間特徵
        'Year', 'Month', 'Day_of_Week', 'Day_of_Month', 'Week_of_Year', 
        'Quarter', 'DayOfYear', 'Days_Since_Start',
        
        # 循環編碼
        'Month_sin', 'Month_cos', 'DayOfWeek_sin', 'DayOfWeek_cos',
        
        # Fourier 季節特徵（研究基礎: Prophet, BMC 2024）
        'Fourier_Year_sin_1', 'Fourier_Year_cos_1',
        'Fourier_Year_sin_2', 'Fourier_Year_cos_2',
        'Fourier_Year_sin_3', 'Fourier_Year_cos_3',
        'Fourier_Week_sin_1', 'Fourier_Week_cos_1',
        'Fourier_Week_sin_2', 'Fourier_Week_cos_2',
        
        # 滯後特徵 (擴展版 v2.9.30)
        'Attendance_Lag1', 'Attendance_Lag2', 'Attendance_Lag3', 'Attendance_Lag4',
        'Attendance_Lag5', 'Attendance_Lag6', 'Attendance_Lag7',
        'Attendance_Lag14', 'Attendance_Lag21', 'Attendance_Lag28',
        'Attendance_Lag30', 'Attendance_Lag60', 'Attendance_Lag90', 
        'Attendance_Lag180', 'Attendance_Lag365',
        # 滯後數據可用性指標
        'Lag1_Available', 'Lag2_Available', 'Lag3_Available', 'Lag4_Available',
        'Lag5_Available', 'Lag6_Available', 'Lag7_Available',
        'Lag14_Available', 'Lag21_Available', 'Lag28_Available',
        'Lag30_Available', 'Lag60_Available', 'Lag90_Available', 
        'Lag180_Available', 'Lag365_Available',
        
        # 同星期歷史滯後 (新增 v2.9.30)
        'Attendance_Same_Weekday_1w', 'Attendance_Same_Weekday_2w',
        'Attendance_Same_Weekday_3w', 'Attendance_Same_Weekday_4w',
        'Attendance_Same_Weekday_Avg',
        
        # 差分特徵 (新增 v2.9.30)
        'Lag1_Diff', 'Lag7_Diff',
        
        # 指數加權移動平均 EWMA (新增 v2.9.30)
        'Attendance_EWMA7', 'Attendance_EWMA14', 'Attendance_EWMA30',
        
        # 滾動統計 (擴展版 v2.9.30)
        'Attendance_Rolling3', 'Attendance_Rolling7', 'Attendance_Rolling14', 
        'Attendance_Rolling21', 'Attendance_Rolling30', 'Attendance_Rolling60', 'Attendance_Rolling90',
        'Attendance_Std3', 'Attendance_Std7', 'Attendance_Std14', 
        'Attendance_Std21', 'Attendance_Std30', 'Attendance_Std60', 'Attendance_Std90',
        'Attendance_Max3', 'Attendance_Max7', 'Attendance_Max14', 
        'Attendance_Max21', 'Attendance_Max30', 'Attendance_Max60', 'Attendance_Max90',
        'Attendance_Min3', 'Attendance_Min7', 'Attendance_Min14', 
        'Attendance_Min21', 'Attendance_Min30', 'Attendance_Min60', 'Attendance_Min90',
        'Attendance_Median3', 'Attendance_Median7', 'Attendance_Median14',
        'Attendance_Median21', 'Attendance_Median30', 'Attendance_Median60', 'Attendance_Median90',
        # 滾動數據可用性指標
        'Rolling3_Available', 'Rolling7_Available', 'Rolling14_Available',
        'Rolling21_Available', 'Rolling30_Available', 'Rolling60_Available', 'Rolling90_Available',
        
        # 相對位置特徵 (新增 v2.9.30)
        'Attendance_Position7', 'Attendance_Position14', 'Attendance_Position30',
        
        # 變異係數 (新增 v2.9.30)
        'Attendance_CV7', 'Attendance_CV14', 'Attendance_CV30',
        
        # 目標編碼特徵 (新增 v2.9.30)
        'DayOfWeek_Target_Mean', 'Month_Target_Mean', 'YearMonth_Target_Mean',
        
        # 事件指標
        'Is_COVID_Period', 'Is_Omicron_Wave', 'Is_Winter_Flu_Season',
        'Is_Summer_Period', 'Is_Weekend', 'Is_Monday',
        'Is_Protest_Period', 'Is_Umbrella_Movement',
        
        # 交互特徵
        'Is_COVID_AND_Winter', 'Is_Monday_AND_Winter', 'Is_Weekend_AND_Summer',
        
        # 趨勢特徵
        'Trend_Normalized', 'Era_Indicator',
        
        # 變化率
        'Daily_Change', 'Weekly_Change', 'Monthly_Change',
        
        # 假期特徵（完整香港公眾假期）
        'Is_Holiday', 'Holiday_Factor', 'Days_To_Next_Holiday',
        'Is_Lunar_Holiday', 'Is_Christmas_Period', 'Is_Easter_Period', 'Is_CNY_Period',
        'Is_Day_Before_Holiday', 'Is_Day_After_Holiday',
        
        # AI 因子特徵（全面版）
        'AI_Impact_Factor',        # 影響因子數值
        'AI_Impact_Magnitude',     # 影響幅度（距離 1.0 的絕對值）
        'AI_Impact_Direction',     # 影響方向（+1/-1/0）
        'AI_Confidence_Score',     # 信心分數
        'AI_Factor_Count',         # 因子數量
        'AI_Type_Weather',         # 天氣類型因子
        'AI_Type_Health',          # 健康/疫情類型因子
        'AI_Type_Policy',          # 政策類型因子
        'AI_Type_Event',           # 事件類型因子
        'AI_Type_Seasonal',        # 季節性因子
        'Has_AI_Factor',           # 是否有 AI 因子
        'AI_Impact_Rolling7',      # 7天滾動平均影響
        'AI_Impact_Trend',         # 影響趨勢變化
        
        # 天氣特徵（香港天文台歷史數據）
        'Weather_Mean_Temp',       # 日平均氣溫
        'Weather_Max_Temp',        # 日最高氣溫
        'Weather_Min_Temp',        # 日最低氣溫
        'Weather_Temp_Range',      # 日溫差
        'Weather_Is_Very_Hot',     # 是否酷熱 (>=33°C)
        'Weather_Is_Hot',          # 是否炎熱 (>=30°C)
        'Weather_Is_Cold',         # 是否寒冷 (<=12°C)
        'Weather_Is_Very_Cold',    # 是否嚴寒 (<=8°C)
        'Weather_Temp_Deviation',  # 溫度偏離月平均
        'Weather_Has_Data',        # 是否有天氣數據
        'Weather_Temp_Change',     # 溫度變化（今天vs昨天）
        'Weather_Temp_Drop_5',     # 驟降 ≥5°C
        'Weather_Temp_Rise_5',     # 驟升 ≥5°C
        'Typhoon_Signal',          # 颱風信號 (0/1/3/8/10)
        'Typhoon_T3_Plus',         # T3 或以上
        'Typhoon_T8_Plus',         # T8 或以上
        'Rainstorm_Warning',       # 暴雨警告 (0/1/2/3)
        'Rainstorm_Red_Plus',      # 紅雨或以上
        'Rainstorm_Black',         # 黑色暴雨
        'Hot_Warning',             # 酷熱天氣警告
        'Cold_Warning',            # 寒冷天氣警告
    ]
    return feature_cols


def add_weather_features(df, weather_df=None):
    """
    添加天氣特徵到數據框
    
    參數:
        df: 出席數據 DataFrame（需有 'Date' 列）
        weather_df: 天氣歷史數據 DataFrame（需有 'Date', 'mean_temp', 'max_temp', 'min_temp' 列）
    
    返回:
        添加了天氣特徵的 DataFrame
    """
    # 確保 Date 列是 datetime 類型
    if 'Date' in df.columns:
        df['Date'] = pd.to_datetime(df['Date'])
    
    # 如果沒有天氣數據，使用季節性估計值
    if weather_df is None or len(weather_df) == 0:
        import sys as _sys
        print("ℹ️ 無天氣歷史數據，使用季節性估計值", file=_sys.stderr)
        
        # 季節性平均溫度（香港）
        seasonal_temps = {
            1: {'mean': 16, 'max': 19, 'min': 13},
            2: {'mean': 17, 'max': 20, 'min': 14},
            3: {'mean': 19, 'max': 22, 'min': 17},
            4: {'mean': 23, 'max': 26, 'min': 21},
            5: {'mean': 26, 'max': 29, 'min': 24},
            6: {'mean': 28, 'max': 31, 'min': 26},
            7: {'mean': 29, 'max': 32, 'min': 27},
            8: {'mean': 29, 'max': 32, 'min': 27},
            9: {'mean': 28, 'max': 31, 'min': 26},
            10: {'mean': 25, 'max': 28, 'min': 23},
            11: {'mean': 21, 'max': 24, 'min': 19},
            12: {'mean': 18, 'max': 21, 'min': 15},
        }
        
        df['Weather_Mean_Temp'] = df['Date'].dt.month.map(lambda m: seasonal_temps[m]['mean'])
        df['Weather_Max_Temp'] = df['Date'].dt.month.map(lambda m: seasonal_temps[m]['max'])
        df['Weather_Min_Temp'] = df['Date'].dt.month.map(lambda m: seasonal_temps[m]['min'])
        df['Weather_Has_Data'] = 0
    else:
        import sys as _sys
        print(f"✅ 合併天氣歷史數據 ({len(weather_df)} 天)", file=_sys.stderr)
        
        # 確保天氣數據的 Date 列是 datetime 類型
        weather_df = weather_df.copy()
        weather_df['Date'] = pd.to_datetime(weather_df['Date'])
        
        # 重命名列以避免衝突
        weather_cols = {
            'mean_temp': 'Weather_Mean_Temp',
            'max_temp': 'Weather_Max_Temp',
            'min_temp': 'Weather_Min_Temp',
        }
        
        weather_subset = weather_df[['Date'] + list(weather_cols.keys())].copy()
        weather_subset = weather_subset.rename(columns=weather_cols)
        
        # 合併
        df = df.merge(weather_subset, on='Date', how='left')
        
        # 標記有天氣數據的日期
        df['Weather_Has_Data'] = df['Weather_Mean_Temp'].notna().astype(int)
        
        # 填充缺失值（使用月份平均）
        for col in ['Weather_Mean_Temp', 'Weather_Max_Temp', 'Weather_Min_Temp']:
            if col in df.columns:
                # 計算每月平均
                monthly_avg = df.groupby(df['Date'].dt.month)[col].transform('mean')
                df[col] = df[col].fillna(monthly_avg)
    
    # 計算衍生天氣特徵
    df['Weather_Temp_Range'] = df['Weather_Max_Temp'] - df['Weather_Min_Temp']
    
    # 極端天氣標記
    df['Weather_Is_Very_Hot'] = (df['Weather_Max_Temp'] >= 33).astype(int)
    df['Weather_Is_Hot'] = (df['Weather_Max_Temp'] >= 30).astype(int)
    df['Weather_Is_Cold'] = (df['Weather_Min_Temp'] <= 12).astype(int)
    df['Weather_Is_Very_Cold'] = (df['Weather_Min_Temp'] <= 8).astype(int)
    
    # 溫度偏離（相對於該月平均）
    monthly_mean = df.groupby(df['Date'].dt.month)['Weather_Mean_Temp'].transform('mean')
    df['Weather_Temp_Deviation'] = df['Weather_Mean_Temp'] - monthly_mean
    
    # v3.0.10: 溫度變化特徵（今天 vs 昨天）
    df = df.sort_values('Date').reset_index(drop=True)
    df['Weather_Temp_Change'] = df['Weather_Mean_Temp'].diff()
    df['Weather_Temp_Change'] = df['Weather_Temp_Change'].fillna(0)
    
    # 溫度變化分類
    df['Weather_Temp_Drop_5'] = (df['Weather_Temp_Change'] <= -5).astype(int)  # 驟降 ≥5°C
    df['Weather_Temp_Rise_5'] = (df['Weather_Temp_Change'] >= 5).astype(int)   # 驟升 ≥5°C
    
    return df


def load_weather_warnings():
    """從 CSV 文件加載天氣警告歷史數據（颱風、暴雨等）"""
    import os
    import sys as _sys
    
    possible_paths = [
        'weather_warnings_history.csv',
        'python/weather_warnings_history.csv',
        os.path.join(os.path.dirname(__file__), 'weather_warnings_history.csv'),
    ]
    
    for path in possible_paths:
        if os.path.exists(path):
            try:
                warnings_data = {}
                with open(path, 'r', encoding='utf-8') as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith('#') or line.startswith('Date'):
                            continue
                        parts = line.split(',')
                        if len(parts) >= 5:
                            date = parts[0].strip()
                            warnings_data[date] = {
                                'typhoon_signal': int(parts[1]) if parts[1].strip() else 0,
                                'rainstorm_warning': int(parts[2]) if parts[2].strip() else 0,
                                'hot_warning': int(parts[3]) if parts[3].strip() else 0,
                                'cold_warning': int(parts[4]) if parts[4].strip() else 0,
                            }
                print(f"✅ 已加載天氣警告數據: {path} ({len(warnings_data)} 天)", file=_sys.stderr)
                return warnings_data
            except Exception as e:
                print(f"⚠️ 讀取 {path} 失敗: {e}", file=_sys.stderr)
    
    print("ℹ️ 未找到天氣警告歷史數據文件", file=_sys.stderr)
    return {}


def add_weather_warning_features(df):
    """添加天氣警告特徵（颱風、暴雨、酷熱/寒冷警告）"""
    import sys as _sys
    
    warnings_data = load_weather_warnings()
    
    # 初始化列
    df['Typhoon_Signal'] = 0
    df['Typhoon_T3_Plus'] = 0
    df['Typhoon_T8_Plus'] = 0
    df['Rainstorm_Warning'] = 0
    df['Rainstorm_Red_Plus'] = 0
    df['Rainstorm_Black'] = 0
    df['Hot_Warning'] = 0
    df['Cold_Warning'] = 0
    
    if not warnings_data:
        return df
    
    # 合併警告數據
    matched = 0
    for idx, row in df.iterrows():
        date_str = row['Date'].strftime('%Y-%m-%d') if hasattr(row['Date'], 'strftime') else str(row['Date'])[:10]
        if date_str in warnings_data:
            w = warnings_data[date_str]
            df.at[idx, 'Typhoon_Signal'] = w['typhoon_signal']
            df.at[idx, 'Typhoon_T3_Plus'] = 1 if w['typhoon_signal'] >= 3 else 0
            df.at[idx, 'Typhoon_T8_Plus'] = 1 if w['typhoon_signal'] >= 8 else 0
            df.at[idx, 'Rainstorm_Warning'] = w['rainstorm_warning']
            df.at[idx, 'Rainstorm_Red_Plus'] = 1 if w['rainstorm_warning'] >= 2 else 0
            df.at[idx, 'Rainstorm_Black'] = 1 if w['rainstorm_warning'] >= 3 else 0
            df.at[idx, 'Hot_Warning'] = w['hot_warning']
            df.at[idx, 'Cold_Warning'] = w['cold_warning']
            matched += 1
    
    if matched > 0:
        print(f"✅ 已匹配 {matched} 天天氣警告數據", file=_sys.stderr)
    
    return df


def load_weather_history():
    """從 CSV 文件加載天氣歷史數據"""
    import os
    
    # 嘗試多個可能的路徑
    possible_paths = [
        'weather_history.csv',
        'python/weather_history.csv',
        os.path.join(os.path.dirname(__file__), 'weather_history.csv'),
    ]
    
    for path in possible_paths:
        if os.path.exists(path):
            try:
                df = pd.read_csv(path)
                df['Date'] = pd.to_datetime(df['Date'])
                import sys as _sys
                print(f"✅ 已加載天氣歷史數據: {path} ({len(df)} 天)", file=_sys.stderr)
                return df
            except Exception as e:
                print(f"⚠️ 讀取 {path} 失敗: {e}", file=_sys.stderr)
    
    import sys as _sys
    print("ℹ️ 未找到天氣歷史數據文件", file=_sys.stderr)
    return None

