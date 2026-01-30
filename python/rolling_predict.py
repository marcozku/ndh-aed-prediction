"""
XGBoost 滾動預測腳本 (v4.0.24)
使用真實歷史數據 + 之前的預測值來生成多天預測

v4.0.24 修復預測持平問題：
- EWMA 只使用最近 30 天數據計算，確保新預測能影響特徵
- 添加基於歷史星期均值的調整
- 增加隨機擾動模擬真實世界的日常變化

每天的預測使用：
1. 最近 30-60 天的歷史數據（計算 EWMA）
2. 之前天數的預測值（作為虛擬歷史數據）
3. 假期因子調整
4. 星期效應因子
5. 日常隨機擾動
"""
import pandas as pd
import numpy as np
import json
import os
import sys
from datetime import datetime, timedelta

# 最佳 10 個特徵 (opt10)
OPT10_FEATURES = [
    'Attendance_EWMA7', 'Daily_Change', 'Attendance_EWMA14',
    'Weekly_Change', 'Day_of_Week', 'Attendance_Lag7',
    'Attendance_Lag1', 'Is_Weekend', 'DayOfWeek_sin', 'DayOfWeek_cos'
]

# 假期因子（假期平均減少 8% 求診人數）
HOLIDAY_FACTOR = 0.92

# 星期效應因子（基於歷史數據分析）
# 週一最高，週末最低
DOW_FACTORS = {
    0: 1.15,  # 週一 +15%
    1: 1.08,  # 週二 +8%
    2: 1.05,  # 週三 +5%
    3: 1.02,  # 週四 +2%
    4: 0.98,  # 週五 -2%
    5: 0.88,  # 週六 -12%
    6: 0.84   # 週日 -16%
}

# 歷史星期平均值（Post-COVID 2023-2025）
DOW_MEANS = {
    0: 225,  # 週日
    1: 270,  # 週一（最高）
    2: 260,  # 週二
    3: 255,  # 週三
    4: 252,  # 週四
    5: 245,  # 週五
    6: 235   # 週六
}


def load_holidays():
    """加載香港公眾假期數據"""
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        holiday_path = os.path.join(script_dir, 'hk_public_holidays.json')

        if os.path.exists(holiday_path):
            with open(holiday_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            holidays = set()
            for year, dates in data.get('holidays', {}).items():
                for date in dates:
                    holidays.add(date)

            print(f"🎌 已載入 {len(holidays)} 個公眾假期", file=sys.stderr)
            return holidays
        else:
            print("⚠️ 找不到假期數據文件", file=sys.stderr)
            return set()
    except Exception as e:
        print(f"⚠️ 無法載入假期數據: {e}", file=sys.stderr)
        return set()


def load_data_from_db():
    """從數據庫加載所有歷史數據"""
    try:
        import psycopg2
        from dotenv import load_dotenv
        import warnings
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

        query = """
            SELECT date as Date, patient_count as Attendance
            FROM actual_data
            ORDER BY date ASC
        """
        with warnings.catch_warnings():
            warnings.filterwarnings('ignore', message='.*pandas only supports SQLAlchemy.*')
            df = pd.read_sql_query(query, conn)
        conn.close()

        # 確保列名正確
        if 'date' in df.columns and 'Date' not in df.columns:
            df['Date'] = df['date']
        if 'attendance' in df.columns and 'Attendance' not in df.columns:
            df['Attendance'] = df['attendance']

        return df[['Date', 'Attendance']]
    except Exception as e:
        print(f"無法從數據庫加載數據: {e}", file=sys.stderr)
        return None


def load_xgboost_model():
    """加載 XGBoost 模型（優先使用 opt10 模型）"""
    try:
        import xgboost as xgb
        script_dir = os.path.dirname(os.path.abspath(__file__))
        models_dir = os.path.join(script_dir, 'models')

        # 優先檢查 opt10 模型
        opt10_model_path = os.path.join(models_dir, 'xgboost_opt10_model.json')
        opt10_features_path = os.path.join(models_dir, 'xgboost_opt10_features.json')

        if os.path.exists(opt10_model_path) and os.path.exists(opt10_features_path):
            booster = xgb.Booster()
            booster.load_model(opt10_model_path)

            with open(opt10_features_path, 'r') as f:
                feature_cols = json.load(f)

            return booster, feature_cols, 'opt10'

        # 回退到標準 XGBoost 模型
        model_path = os.path.join(models_dir, 'xgboost_model.json')
        if os.path.exists(model_path):
            booster = xgb.Booster()
            booster.load_model(model_path)

            features_path = os.path.join(models_dir, 'xgboost_features.json')
            with open(features_path, 'r') as f:
                feature_cols = json.load(f)

            return booster, feature_cols, 'standard'

        return None, None, None
    except Exception as e:
        print(f"無法加載 XGBoost 模型: {e}", file=sys.stderr)
        return None, None, None


def prepare_features(df, target_date_str):
    """
    為目標日期準備特徵
    df 應該包含所有可用的歷史數據（真實 + 預測）
    
    v4.0.24: 只使用最近 N 天數據計算 EWMA，確保預測值能有效影響特徵
    """
    df = df.copy()
    df['Date'] = pd.to_datetime(df['Date'])
    df = df.sort_values('Date').reset_index(drop=True)

    target_dt = pd.to_datetime(target_date_str)

    # 時間特徵
    last_row = {}
    last_row['Day_of_Week'] = target_dt.dayofweek
    last_row['Is_Weekend'] = 1 if target_dt.dayofweek >= 5 else 0
    last_row['DayOfWeek_sin'] = np.sin(2 * np.pi * target_dt.dayofweek / 7)
    last_row['DayOfWeek_cos'] = np.cos(2 * np.pi * target_dt.dayofweek / 7)

    # Lag 特徵
    if len(df) >= 1:
        last_row['Attendance_Lag1'] = df.iloc[-1]['Attendance']
    else:
        last_row['Attendance_Lag1'] = 250

    if len(df) >= 7:
        last_row['Attendance_Lag7'] = df.iloc[-7]['Attendance']
    else:
        last_row['Attendance_Lag7'] = df['Attendance'].mean() if len(df) > 0 else 250

    # v4.0.24: EWMA 只使用最近 30 天數據
    # 這樣新的預測值對 EWMA 有更大影響
    EWMA_WINDOW = 30
    if len(df) >= 1:
        recent_data = df.tail(EWMA_WINDOW)['Attendance']
        last_row['Attendance_EWMA7'] = recent_data.ewm(span=7, adjust=False).mean().iloc[-1]
        last_row['Attendance_EWMA14'] = recent_data.ewm(span=14, adjust=False).mean().iloc[-1]
    else:
        last_row['Attendance_EWMA7'] = 250
        last_row['Attendance_EWMA14'] = 250

    # 變化特徵
    if len(df) >= 2:
        last_row['Daily_Change'] = df.iloc[-1]['Attendance'] - df.iloc[-2]['Attendance']
    else:
        last_row['Daily_Change'] = 0

    if len(df) >= 8:
        last_row['Weekly_Change'] = df.iloc[-1]['Attendance'] - df.iloc[-8]['Attendance']
    else:
        last_row['Weekly_Change'] = 0

    return pd.DataFrame([last_row], columns=OPT10_FEATURES)


def rolling_predict(start_date, days):
    """
    滾動預測主函數

    參數:
        start_date: 開始日期 (YYYY-MM-DD)
        days: 預測天數

    返回:
        dict: {predictions: [{date, prediction, day_ahead}, ...], model_type: ...}
    """
    # 加載模型
    booster, feature_cols, model_type = load_xgboost_model()
    if booster is None:
        print("錯誤: 無法加載 XGBoost 模型", file=sys.stderr)
        return None

    # 加載歷史數據
    historical_data = load_data_from_db()
    if historical_data is None or len(historical_data) == 0:
        print("錯誤: 無法加載歷史數據", file=sys.stderr)
        return None

    # 加載假期數據
    holidays = load_holidays()

    print(f"📊 已加載 {len(historical_data)} 天歷史數據", file=sys.stderr)

    # 計算近 90 天的歷史統計（更能反映當前趨勢）
    recent_90_days = historical_data.tail(90)
    historical_mean = recent_90_days['Attendance'].mean()
    historical_std = recent_90_days['Attendance'].std()
    print(f"📈 近 90 天平均值: {historical_mean:.1f}, 標準差: {historical_std:.1f}", file=sys.stderr)

    # 計算各星期的實際平均值
    historical_data['Date'] = pd.to_datetime(historical_data['Date'])
    historical_data['dow'] = historical_data['Date'].dt.dayofweek
    actual_dow_means = historical_data.tail(180).groupby('dow')['Attendance'].mean().to_dict()
    print(f"📊 實際星期均值: {actual_dow_means}", file=sys.stderr)

    # 準備滾動預測
    import xgboost as xgb
    df = historical_data.copy()
    df = df.sort_values('Date').reset_index(drop=True)

    predictions = []
    start_dt = pd.to_datetime(start_date)
    
    # v4.0.24: 使用固定種子確保可重現，但每天不同
    np.random.seed(int(start_dt.timestamp()) % 2**31)

    for i in range(days):
        target_dt = start_dt + timedelta(days=i)
        target_date_str = target_dt.strftime('%Y-%m-%d')
        dow = target_dt.dayofweek

        # 準備特徵（使用當前的 df，包含真實歷史 + 之前的預測）
        features_df = prepare_features(df, target_date_str)

        # XGBoost 預測
        try:
            dmatrix = xgb.DMatrix(features_df[feature_cols], feature_names=feature_cols)
            xgb_pred = float(booster.predict(dmatrix)[0])
        except Exception as e:
            print(f"⚠️ Day {i} 預測失敗: {e}", file=sys.stderr)
            continue

        # ============================================================
        # v4.0.24: 混合預測策略
        # ============================================================
        # 問題：XGBoost 對遠期預測缺乏變異性（EWMA 收斂）
        # 解決：結合 XGBoost 預測 + 星期歷史均值 + 隨機擾動
        
        # 獲取該星期的歷史均值
        dow_historical_mean = actual_dow_means.get(dow, historical_mean)
        
        # 根據預測天數調整混合權重
        # Day 0-7: 主要依賴 XGBoost（權重 0.9 -> 0.6）
        # Day 8-30: 逐漸增加歷史均值的權重
        if i <= 7:
            xgb_weight = 0.9 - i * 0.04  # 0.9 -> 0.62
        else:
            xgb_weight = max(0.4, 0.6 - (i - 7) * 0.01)  # 0.59 -> 0.4
        
        mean_weight = 1 - xgb_weight
        
        # 混合 XGBoost 預測和星期歷史均值
        pred = xgb_pred * xgb_weight + dow_historical_mean * mean_weight

        # 1. 星期效應調整（基於實際歷史數據）
        dow_factor = DOW_FACTORS.get(dow, 1.0)
        dow_adjustment = (dow_factor - 1.0) * pred * 0.3  # 調整幅度 30%
        pred += dow_adjustment

        # 2. 假期因子
        is_holiday = target_date_str in holidays
        if is_holiday:
            pred = pred * HOLIDAY_FACTOR
            print(f"🎌 {target_date_str} 是假期，應用因子 {HOLIDAY_FACTOR}", file=sys.stderr)

        # 3. v4.0.24: 添加隨機擾動模擬真實世界變化
        # 歷史標準差約 28，我們使用較小的擾動
        if i > 0:
            # 擾動幅度隨預測天數增加（反映不確定性）
            noise_std = historical_std * 0.3 * (1 + i * 0.02)
            noise = np.random.normal(0, noise_std)
            pred += noise
        
        # 4. 確保預測值在合理範圍內
        pred = max(150, min(350, pred))

        # 計算置信區間
        uncertainty_multiplier = 1.0 + i * 0.025
        std_preds = historical_std * uncertainty_multiplier

        result = {
            'date': target_date_str,
            'prediction': round(pred, 1),
            'day_ahead': i,
            'dow': dow,
            'dow_factor': round(dow_factor, 3),
            'xgb_weight': round(xgb_weight, 2),
            'xgb_raw': round(xgb_pred, 1),
            'dow_mean': round(dow_historical_mean, 1),
            'is_holiday': is_holiday,
            'ci80': {
                'low': round(pred - 1.28 * std_preds, 1),
                'high': round(pred + 1.28 * std_preds, 1)
            },
            'ci95': {
                'low': round(pred - 1.96 * std_preds, 1),
                'high': round(pred + 1.96 * std_preds, 1)
            }
        }
        predictions.append(result)

        # 將這天的預測添加到歷史數據中，供下一天使用
        new_row = pd.DataFrame([{
            'Date': target_dt,
            'Attendance': pred
        }])
        df = pd.concat([df, new_row], ignore_index=True)

        # 輸出進度
        if i <= 7 or (i + 1) % 7 == 0:
            print(f"📈 Day {i}: XGB={xgb_pred:.0f} ({xgb_weight:.0%}), Mean={dow_historical_mean:.0f} → {pred:.0f}", file=sys.stderr)

    print(f"✅ 滾動預測完成: {len(predictions)} 天", file=sys.stderr)

    return {
        'predictions': predictions,
        'model_type': f'{model_type}_rolling_v4.0.24',
        'historical_days': len(historical_data),
        'historical_mean': round(historical_mean, 1),
        'historical_std': round(historical_std, 1)
    }


def main():
    """命令行接口"""
    if len(sys.argv) < 3:
        print("用法: python rolling_predict.py <start_date> <days>", file=sys.stderr)
        print("示例: python rolling_predict.py 2025-02-01 31", file=sys.stderr)
        sys.exit(1)

    start_date = sys.argv[1]
    days = int(sys.argv[2])

    result = rolling_predict(start_date, days)

    if result:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(json.dumps({'error': '滾動預測失敗'}, indent=2))
        sys.exit(1)


if __name__ == '__main__':
    main()
