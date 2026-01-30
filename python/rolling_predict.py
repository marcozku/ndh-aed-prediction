"""
XGBoost 滾動預測腳本 (v4.0.21)
使用真實歷史數據 + 之前的預測值來生成多天預測

每天的預測使用：
1. 所有真實歷史數據
2. 之前天數的預測值（作為虛擬歷史數據）

這樣 Lag1, Lag7, EWMA7, EWMA14 等特徵會隨著預測天數變化
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

    # EWMA
    if len(df) >= 1:
        series = df['Attendance']
        last_row['Attendance_EWMA7'] = series.ewm(span=7, adjust=False).mean().iloc[-1]
        last_row['Attendance_EWMA14'] = series.ewm(span=14, adjust=False).mean().iloc[-1]
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

    print(f"📊 已加載 {len(historical_data)} 天歷史數據", file=sys.stderr)

    # 準備滾動預測
    import xgboost as xgb
    df = historical_data.copy()
    df['Date'] = pd.to_datetime(df['Date'])
    df = df.sort_values('Date').reset_index(drop=True)

    predictions = []
    start_dt = pd.to_datetime(start_date)

    for i in range(days):
        target_dt = start_dt + timedelta(days=i)
        target_date_str = target_dt.strftime('%Y-%m-%d')

        # 準備特徵（使用當前的 df，包含真實歷史 + 之前的預測）
        features_df = prepare_features(df, target_date_str)

        # XGBoost 預測
        try:
            dmatrix = xgb.DMatrix(features_df[feature_cols], feature_names=feature_cols)
            pred = float(booster.predict(dmatrix)[0])
        except Exception as e:
            print(f"⚠️ Day {i} 預測失敗: {e}", file=sys.stderr)
            continue

        # 計算置信區間
        uncertainty_multiplier = 1.0 + i * 0.02
        std_preds = pred * 0.05 * uncertainty_multiplier

        result = {
            'date': target_date_str,
            'prediction': round(pred, 1),
            'day_ahead': i,
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

        # 每 7 天輸出一次進度
        if (i + 1) % 7 == 0:
            print(f"📊 已完成 {i + 1}/{days} 天滾動預測", file=sys.stderr)

    print(f"✅ 滾動預測完成: {len(predictions)} 天", file=sys.stderr)

    return {
        'predictions': predictions,
        'model_type': f'{model_type}_rolling',
        'historical_days': len(historical_data)
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
