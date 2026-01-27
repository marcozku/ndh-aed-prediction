"""
XGBoost 預測腳本
v3.2.01: 支持最佳 10 特徵模型 (opt10) 和標準 XGBoost 模型
優先使用 opt10 模型 (MAE: 2.85)
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

def prepare_opt10_features(df, target_date_str):
    """為 opt10 模型準備特徵"""
    df = df.copy()
    df['Date'] = pd.to_datetime(df['Date'])
    df = df.sort_values('Date').reset_index(drop=True)

    # 時間特徵
    target_dt = pd.to_datetime(target_date_str)

    # 為目標日期創建一行
    last_row = {}
    last_row['Date'] = target_dt
    last_row['Day_of_Week'] = target_dt.dayofweek
    last_row['Is_Weekend'] = 1 if target_dt.dayofweek >= 5 else 0

    # 週期編碼
    last_row['DayOfWeek_sin'] = np.sin(2 * np.pi * target_dt.dayofweek / 7)
    last_row['DayOfWeek_cos'] = np.cos(2 * np.pi * target_dt.dayofweek / 7)

    # 歷史就診數據
    if len(df) >= 1:
        last_row['Attendance_Lag1'] = df.iloc[-1]['Attendance']
    else:
        last_row['Attendance_Lag1'] = df['Attendance'].mean() if len(df) > 0 else 250

    if len(df) >= 7:
        last_row['Attendance_Lag7'] = df.iloc[-7]['Attendance']
    else:
        last_row['Attendance_Lag7'] = df['Attendance'].mean() if len(df) > 0 else 250

    # EWMA
    if len(df) >= 1:
        series = pd.concat([df['Attendance'], pd.Series([last_row['Attendance_Lag1']])], ignore_index=True)
        last_row['Attendance_EWMA7'] = series.ewm(span=7, adjust=False).mean().iloc[-1]
        last_row['Attendance_EWMA14'] = series.ewm(span=14, adjust=False).mean().iloc[-1]
    else:
        last_row['Attendance_EWMA7'] = 250
        last_row['Attendance_EWMA14'] = 250

    # 變化
    if len(df) >= 1:
        last_row['Daily_Change'] = last_row['Attendance_Lag1'] - df.iloc[-1]['Attendance'] if len(df) >= 2 else 0
    else:
        last_row['Daily_Change'] = 0

    if len(df) >= 7:
        last_row['Weekly_Change'] = last_row['Attendance_Lag1'] - df.iloc[-7]['Attendance']
    else:
        last_row['Weekly_Change'] = 0

    # 確保列順序與 OPT10_FEATURES 完全一致（XGBoost 需要匹配的特徵名稱）
    return pd.DataFrame([last_row], columns=OPT10_FEATURES)


def load_xgboost_model():
    """加載 XGBoost 模型（優先使用 opt10 模型）v3.2.01"""
    try:
        import xgboost as xgb
        script_dir = os.path.dirname(os.path.abspath(__file__))
        models_dir = os.path.join(script_dir, 'models')

        # v3.2.01: 優先檢查 opt10 模型
        opt10_model_path = os.path.join(models_dir, 'xgboost_opt10_model.json')
        opt10_features_path = os.path.join(models_dir, 'xgboost_opt10_features.json')

        if os.path.exists(opt10_model_path) and os.path.exists(opt10_features_path):
            print(f"✅ 使用 opt10 模型 (最佳 10 特徵)", file=sys.stderr)
            booster = xgb.Booster()
            booster.load_model(opt10_model_path)
            model = XGBoostWrapper(booster, model_type='opt10')

            with open(opt10_features_path, 'r') as f:
                feature_cols = json.load(f)

            return model, feature_cols, 'opt10'

        # 回退到標準 XGBoost 模型
        model_path = os.path.join(models_dir, 'xgboost_model.json')
        if not os.path.exists(model_path):
            return None, None, None

        print(f"⚠️ 使用舊模型 (建議訓練 opt10 模型)", file=sys.stderr)
        booster = xgb.Booster()
        booster.load_model(model_path)
        model = XGBoostWrapper(booster, model_type='standard')

        features_path = os.path.join(models_dir, 'xgboost_features.json')
        with open(features_path, 'r') as f:
            feature_cols = json.load(f)

        return model, feature_cols, 'standard'
    except Exception as e:
        print(f"無法加載 XGBoost 模型: {e}", file=sys.stderr)
        return None, None, None


class XGBoostWrapper:
    """包裝 XGBoost Booster 提供類似 sklearn 的接口"""
    def __init__(self, booster, model_type='standard'):
        self.booster = booster
        self.model_type = model_type

    def predict(self, X):
        import xgboost as xgb
        if isinstance(X, pd.DataFrame):
            dmatrix = xgb.DMatrix(X)
        else:
            dmatrix = xgb.DMatrix(X)
        return self.booster.predict(dmatrix)


def predict_with_xgboost(model, feature_cols, features_df):
    """使用 XGBoost 預測"""
    if model is None:
        return None
    X = features_df[feature_cols]
    prediction = model.predict(X)[0]
    return float(prediction)


def load_ai_factors_from_db():
    """從數據庫加載 AI 因子數據"""
    try:
        from sqlalchemy import create_engine
        from dotenv import load_dotenv
        load_dotenv()

        database_url = os.getenv('DATABASE_URL')
        if database_url:
            if not database_url.startswith('postgresql://') and not database_url.startswith('postgres://'):
                database_url = database_url.replace('postgres://', 'postgresql://', 1)
            engine = create_engine(database_url)
        else:
            host = os.getenv('PGHOST', 'localhost')
            database = os.getenv('PGDATABASE', 'postgres')
            user = os.getenv('PGUSER', 'postgres')
            password = os.getenv('PGPASSWORD', '')
            port = os.getenv('PGPORT', '5432')
            connection_string = f"postgresql://{user}:{password}@{host}:{port}/{database}"
            engine = create_engine(connection_string)

        query = "SELECT factors_cache FROM ai_factors_cache WHERE id = 1"
        result = pd.read_sql_query(query, engine)
        engine.dispose()

        if len(result) > 0 and result.iloc[0]['factors_cache'] is not None:
            factors_cache = result.iloc[0]['factors_cache']
            if isinstance(factors_cache, str):
                factors_cache = json.loads(factors_cache)
            return factors_cache
        return {}
    except Exception as e:
        return {}


def ensemble_predict(target_date, historical_data):
    """
    XGBoost 預測主函數 v3.2.01

    參數:
        target_date: 目標日期 (YYYY-MM-DD)
        historical_data: DataFrame，包含歷史數據（Date, Attendance）

    返回:
        dict: {
            'prediction': XGBoost 預測值,
            'model_type': 'opt10' 或 'standard',
            'ci80': {'low': ..., 'high': ...},
            'ci95': {'low': ..., 'high': ...},
            'individual': {
                'xgboost': ...
            }
        }
    """
    # 加載模型（優先 opt10）
    xgb_model, xgb_features, model_type = load_xgboost_model()

    if xgb_model is None:
        return None

    # 準備特徵數據
    if model_type == 'opt10':
        # 使用簡化的 10 特徵
        features_df = prepare_opt10_features(historical_data, target_date)
    else:
        # 使用完整特徵（舊模型）
        from feature_engineering import create_comprehensive_features
        ai_factors = load_ai_factors_from_db()

        if historical_data is not None and len(historical_data) > 0:
            all_data = historical_data.copy()
            target_dt = pd.to_datetime(target_date)
            all_data = create_comprehensive_features(all_data, ai_factors_dict=ai_factors if ai_factors else None)

            if len(all_data) > 0:
                last_row = all_data.iloc[-1].copy()
                last_row['Date'] = target_dt
                last_row['Year'] = target_dt.year
                last_row['Month'] = target_dt.month
                last_row['Day_of_Week'] = target_dt.dayofweek
                last_row['Day_of_Month'] = target_dt.day
                last_row['Week_of_Year'] = target_dt.isocalendar().week
                last_row['Quarter'] = target_dt.quarter
                last_row['DayOfYear'] = target_dt.dayofyear
                last_row['Days_Since_Start'] = (target_dt - all_data['Date'].min()).days
                last_row['Month_sin'] = np.sin(2 * np.pi * target_dt.month / 12)
                last_row['Month_cos'] = np.cos(2 * np.pi * target_dt.month / 12)
                last_row['DayOfWeek_sin'] = np.sin(2 * np.pi * target_dt.dayofweek / 7)
                last_row['DayOfWeek_cos'] = np.cos(2 * np.pi * target_dt.dayofweek / 7)
                last_row['Is_COVID_Period'] = 0
                last_row['Is_Winter_Flu_Season'] = 1 if target_dt.month in [12, 1, 2, 3] else 0
                last_row['Is_Monday'] = 1 if target_dt.dayofweek == 0 else 0
                last_row['Is_Weekend'] = 1 if target_dt.dayofweek >= 5 else 0

                # AI 因子
                if ai_factors and str(target_date) in ai_factors:
                    ai_data = ai_factors[str(target_date)]
                    if isinstance(ai_data, dict):
                        impact = max(0.7, min(1.3, ai_data.get('impactFactor', 1.0)))
                        last_row['AI_Impact_Factor'] = impact
                        last_row['AI_Impact_Magnitude'] = abs(impact - 1.0)
                        last_row['AI_Impact_Direction'] = 1 if impact > 1.02 else (-1 if impact < 0.98 else 0)
                        conf = ai_data.get('confidence', '中').lower()
                        last_row['AI_Confidence_Score'] = 1.0 if '高' in conf or 'high' in conf else (0.3 if '低' in conf or 'low' in conf else 0.6)
                        last_row['AI_Factor_Count'] = 1
                        last_row['Has_AI_Factor'] = 1
                    else:
                        set_default_ai(last_row)
                else:
                    set_default_ai(last_row)

                features_df = pd.DataFrame([last_row])
            else:
                features_df = None
        else:
            features_df = None

    if features_df is None:
        return None

    # XGBoost 預測
    xgb_pred = predict_with_xgboost(xgb_model, xgb_features, features_df)

    if xgb_pred is None:
        return None

    # 計算置信區間
    std_preds = xgb_pred * 0.05
    ci80_low = xgb_pred - 1.28 * std_preds
    ci80_high = xgb_pred + 1.28 * std_preds
    ci95_low = xgb_pred - 1.96 * std_preds
    ci95_high = xgb_pred + 1.96 * std_preds

    return {
        'prediction': float(xgb_pred),
        'model_type': model_type,
        'ci80': {
            'low': float(ci80_low),
            'high': float(ci80_high)
        },
        'ci95': {
            'low': float(ci95_low),
            'high': float(ci95_high)
        },
        'individual': {
            'xgboost': xgb_pred
        }
    }


def set_default_ai(row):
    """設置 AI 因子默認值"""
    row['AI_Impact_Factor'] = 1.0
    row['AI_Impact_Magnitude'] = 0.0
    row['AI_Impact_Direction'] = 0
    row['AI_Confidence_Score'] = 0.0
    row['AI_Factor_Count'] = 0
    row['AI_Type_Weather'] = 0
    row['AI_Type_Health'] = 0
    row['AI_Type_Policy'] = 0
    row['AI_Type_Event'] = 0
    row['AI_Type_Seasonal'] = 0
    row['Has_AI_Factor'] = 0
    row['AI_Impact_Rolling7'] = 1.0
    row['AI_Impact_Trend'] = 0.0

def main():
    """命令行接口"""
    if len(sys.argv) < 2:
        print("用法: python ensemble_predict.py <target_date> [historical_data_path]", file=sys.stderr)
        print("注意: 現在只使用 XGBoost 模型", file=sys.stderr)
        sys.exit(1)
    
    target_date = sys.argv[1]
    
    # 嘗試從數據庫或 CSV 加載歷史數據
    historical_data = None
    if len(sys.argv) >= 3:
        csv_path = sys.argv[2]
        if os.path.exists(csv_path):
            historical_data = pd.read_csv(csv_path)
            if 'Date' not in historical_data.columns:
                if 'date' in historical_data.columns:
                    historical_data['Date'] = historical_data['date']
            if 'Attendance' not in historical_data.columns:
                if 'patient_count' in historical_data.columns:
                    historical_data['Attendance'] = historical_data['patient_count']
    
    result = ensemble_predict(target_date, historical_data)
    
    if result:
        print(json.dumps(result, indent=2))
    else:
        print("錯誤: 無法生成預測", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()

