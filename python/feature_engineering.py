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
    # 只使用真實歷史數據，不進行任何填充（NaN 表示該數據不存在）
    for lag in [1, 7, 14, 30, 60, 90, 365]:
        df[f'Attendance_Lag{lag}'] = df['Attendance'].shift(lag)
        # 添加滯後數據可用性指標（1=真實數據存在, 0=不存在）
        df[f'Lag{lag}_Available'] = df[f'Attendance_Lag{lag}'].notna().astype(int)
    
    # 不填充 NaN - 讓 XGBoost 自行處理缺失值
    # XGBoost 原生支持缺失值處理，會自動學習最佳分割方向
    # 這比使用虛假數據（如均值填充）更準確
    
    # ============ 滾動統計 ============
    # 使用 min_periods 確保至少有足夠數據才計算，否則保留 NaN
    for window in [7, 14, 30]:
        # 只有當有足夠的歷史數據時才計算滾動統計
        min_req = max(2, window // 2)  # 至少需要一半的窗口數據
        df[f'Attendance_Rolling{window}'] = df['Attendance'].rolling(window=window, min_periods=min_req).mean()
        df[f'Attendance_Std{window}'] = df['Attendance'].rolling(window=window, min_periods=min_req).std()
        df[f'Attendance_Max{window}'] = df['Attendance'].rolling(window=window, min_periods=min_req).max()
        df[f'Attendance_Min{window}'] = df['Attendance'].rolling(window=window, min_periods=min_req).min()
        # 添加滾動數據可用性指標
        df[f'Rolling{window}_Available'] = df[f'Attendance_Rolling{window}'].notna().astype(int)
    
    # 不填充 NaN - 讓 XGBoost 自行處理缺失值
    
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
    
    return df

def get_feature_columns():
    """返回所有特徵列名（排除目標變量和日期）"""
    # 這些是我們創建的所有特徵
    feature_cols = [
        # 時間特徵
        'Year', 'Month', 'Day_of_Week', 'Day_of_Month', 'Week_of_Year', 
        'Quarter', 'DayOfYear', 'Days_Since_Start',
        
        # 循環編碼
        'Month_sin', 'Month_cos', 'DayOfWeek_sin', 'DayOfWeek_cos',
        
        # 滯後特徵（真實數據，XGBoost 處理 NaN）
        'Attendance_Lag1', 'Attendance_Lag7', 'Attendance_Lag14', 
        'Attendance_Lag30', 'Attendance_Lag60', 'Attendance_Lag90', 'Attendance_Lag365',
        # 滯後數據可用性指標
        'Lag1_Available', 'Lag7_Available', 'Lag14_Available',
        'Lag30_Available', 'Lag60_Available', 'Lag90_Available', 'Lag365_Available',
        
        # 滾動統計
        'Attendance_Rolling7', 'Attendance_Rolling14', 'Attendance_Rolling30',
        'Attendance_Std7', 'Attendance_Std14', 'Attendance_Std30',
        'Attendance_Max7', 'Attendance_Max14', 'Attendance_Max30',
        'Attendance_Min7', 'Attendance_Min14', 'Attendance_Min30',
        # 滾動數據可用性指標
        'Rolling7_Available', 'Rolling14_Available', 'Rolling30_Available',
        
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
    ]
    return feature_cols

