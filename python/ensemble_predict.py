"""
XGBoost 預測腳本
只使用 XGBoost 模型進行預測
"""
import pandas as pd
import numpy as np
import json
import os
import sys
from datetime import datetime, timedelta
from feature_engineering import create_comprehensive_features, get_feature_columns

def load_xgboost_model():
    """加載 XGBoost 模型"""
    try:
        import xgboost as xgb
        script_dir = os.path.dirname(os.path.abspath(__file__))
        models_dir = os.path.join(script_dir, 'models')
        
        model_path = os.path.join(models_dir, 'xgboost_model.json')
        if not os.path.exists(model_path):
            return None, None
        
        model = xgb.XGBRegressor()
        model.load_model(model_path)
        
        features_path = os.path.join(models_dir, 'xgboost_features.json')
        with open(features_path, 'r') as f:
            feature_cols = json.load(f)
        
        return model, feature_cols
    except Exception as e:
        print(f"無法加載 XGBoost 模型: {e}")
        return None, None


def predict_with_xgboost(model, feature_cols, features_df):
    """使用 XGBoost 預測"""
    if model is None:
        return None
    
    X = features_df[feature_cols].fillna(0)
    prediction = model.predict(X)[0]
    return float(prediction)


def load_ai_factors_from_db():
    """從數據庫加載 AI 因子數據"""
    try:
        from sqlalchemy import create_engine
        from dotenv import load_dotenv
        load_dotenv()
        
        # 構建連接字符串
        database_url = os.getenv('DATABASE_URL')
        if database_url:
            # 如果已有完整的 DATABASE_URL，直接使用
            if not database_url.startswith('postgresql://') and not database_url.startswith('postgres://'):
                database_url = database_url.replace('postgres://', 'postgresql://', 1)
            engine = create_engine(database_url)
        else:
            # 否則從環境變量構建
            host = os.getenv('PGHOST', 'localhost')
            database = os.getenv('PGDATABASE', 'postgres')
            user = os.getenv('PGUSER', 'postgres')
            password = os.getenv('PGPASSWORD', '')
            port = os.getenv('PGPORT', '5432')
            connection_string = f"postgresql://{user}:{password}@{host}:{port}/{database}"
            engine = create_engine(connection_string)
        
        query = """
            SELECT factors_cache
            FROM ai_factors_cache
            WHERE id = 1
        """
        result = pd.read_sql_query(query, engine)
        engine.dispose()
        
        if len(result) > 0 and result.iloc[0]['factors_cache'] is not None:
            import json
            factors_cache = result.iloc[0]['factors_cache']
            if isinstance(factors_cache, str):
                factors_cache = json.loads(factors_cache)
            elif isinstance(factors_cache, dict):
                pass  # 已經是字典
            else:
                factors_cache = {}
            return factors_cache
        return {}
    except Exception as e:
        print(f"⚠️ 無法加載 AI 因子數據: {e}")
        return {}

def ensemble_predict(target_date, historical_data):
    """
    XGBoost 預測主函數
    
    參數:
        target_date: 目標日期 (YYYY-MM-DD)
        historical_data: DataFrame，包含歷史數據（Date, Attendance）
    
    返回:
        dict: {
            'prediction': XGBoost 預測值,
            'ci80': {'low': ..., 'high': ...},
            'ci95': {'low': ..., 'high': ...},
            'individual': {
                'xgboost': ...
            }
        }
    """
    # 加載 XGBoost 模型
    xgb_model, xgb_features = load_xgboost_model()
    
    if xgb_model is None:
        return None
    
    # 加載 AI 因子數據
    ai_factors = load_ai_factors_from_db()
    if ai_factors:
        print(f"✅ 加載了 {len(ai_factors)} 個日期的 AI 因子數據用於預測")
    
    # 準備特徵數據
    if historical_data is not None and len(historical_data) > 0:
        # 確保包含目標日期之前的數據
        all_data = historical_data.copy()
        target_dt = pd.to_datetime(target_date)
        
        # 創建特徵（包含 AI 因子）
        all_data = create_comprehensive_features(all_data, ai_factors_dict=ai_factors if ai_factors else None)
        
        # 獲取目標日期的特徵（使用最後一天的數據作為基礎）
        if len(all_data) > 0:
            last_row = all_data.iloc[-1].copy()
            # 更新日期相關特徵
            last_row['Date'] = target_dt
            last_row['Year'] = target_dt.year
            last_row['Month'] = target_dt.month
            last_row['Day_of_Week'] = target_dt.dayofweek
            last_row['Day_of_Month'] = target_dt.day
            last_row['Week_of_Year'] = target_dt.isocalendar().week
            last_row['Quarter'] = target_dt.quarter
            last_row['DayOfYear'] = target_dt.dayofyear
            last_row['Days_Since_Start'] = (target_dt - all_data['Date'].min()).days
            
            # 更新循環編碼
            last_row['Month_sin'] = np.sin(2 * np.pi * target_dt.month / 12)
            last_row['Month_cos'] = np.cos(2 * np.pi * target_dt.month / 12)
            last_row['DayOfWeek_sin'] = np.sin(2 * np.pi * target_dt.dayofweek / 7)
            last_row['DayOfWeek_cos'] = np.cos(2 * np.pi * target_dt.dayofweek / 7)
            
            # 更新事件指標
            last_row['Is_COVID_Period'] = 0
            last_row['Is_Winter_Flu_Season'] = 1 if target_dt.month in [12, 1, 2, 3] else 0
            last_row['Is_Monday'] = 1 if target_dt.dayofweek == 0 else 0
            last_row['Is_Weekend'] = 1 if target_dt.dayofweek >= 5 else 0
            
            # 為目標日期添加 AI 因子（如果有的話）
            target_date_str = target_date
            if target_date_str in ai_factors and ai_factors[target_date_str]:
                ai_factor_data = ai_factors[target_date_str]
                if isinstance(ai_factor_data, dict):
                    last_row['AI_Factor'] = ai_factor_data.get('impactFactor', 1.0)
                    last_row['Has_AI_Factor'] = 1
                    # 編碼 AI 因子類型
                    ai_type = ai_factor_data.get('type', '').lower()
                    if 'positive' in ai_type or '增加' in ai_type or '上升' in ai_type:
                        last_row['AI_Factor_Type'] = 1
                    elif 'negative' in ai_type or '減少' in ai_type or '下降' in ai_type:
                        last_row['AI_Factor_Type'] = -1
                    else:
                        last_row['AI_Factor_Type'] = 0
                else:
                    last_row['AI_Factor'] = 1.0
                    last_row['Has_AI_Factor'] = 0
                    last_row['AI_Factor_Type'] = 0
            else:
                last_row['AI_Factor'] = 1.0
                last_row['Has_AI_Factor'] = 0
                last_row['AI_Factor_Type'] = 0
            
            features_df = pd.DataFrame([last_row])
        else:
            features_df = None
    else:
        features_df = None
    
    # 如果沒有特徵數據，返回 None
    if features_df is None:
        return None
    
    # XGBoost 預測
    xgb_pred = predict_with_xgboost(xgb_model, xgb_features, features_df)
    
    if xgb_pred is None:
        return None
    
    # 計算置信區間（基於預測值的 5% 不確定性）
    std_preds = xgb_pred * 0.05
    
    # 計算置信區間
    ci80_low = xgb_pred - 1.28 * std_preds
    ci80_high = xgb_pred + 1.28 * std_preds
    ci95_low = xgb_pred - 1.96 * std_preds
    ci95_high = xgb_pred + 1.96 * std_preds
    
    return {
        'prediction': float(xgb_pred),
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

def main():
    """命令行接口"""
    if len(sys.argv) < 2:
        print("用法: python ensemble_predict.py <target_date> [historical_data_path]")
        print("注意: 現在只使用 XGBoost 模型")
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
        print("錯誤: 無法生成預測")
        sys.exit(1)

if __name__ == '__main__':
    main()

