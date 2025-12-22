"""
集成預測腳本（Hybrid Ensemble）
結合 XGBoost + LSTM + Prophet
根據 AI-AED-Algorithm-Specification.txt Section 6.4
"""
import pandas as pd
import numpy as np
import json
import os
import sys
import pickle
from datetime import datetime, timedelta
from feature_engineering import create_comprehensive_features, get_feature_columns

# 模型權重（根據算法規格文件）
ENSEMBLE_WEIGHTS = {
    'xgboost': 0.40,
    'lstm': 0.35,
    'prophet': 0.25
}

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

def load_lstm_model():
    """加載 LSTM 模型"""
    try:
        from tensorflow.keras.models import load_model
        script_dir = os.path.dirname(os.path.abspath(__file__))
        models_dir = os.path.join(script_dir, 'models')
        
        model_path = os.path.join(models_dir, 'lstm_model.h5')
        if not os.path.exists(model_path):
            return None, None, None, None, None
        
        model = load_model(model_path)
        
        with open(os.path.join(models_dir, 'lstm_scaler_X.pkl'), 'rb') as f:
            scaler_X = pickle.load(f)
        with open(os.path.join(models_dir, 'lstm_scaler_y.pkl'), 'rb') as f:
            scaler_y = pickle.load(f)
        with open(os.path.join(models_dir, 'lstm_features.json'), 'r') as f:
            feature_cols = json.load(f)
        with open(os.path.join(models_dir, 'lstm_params.json'), 'r') as f:
            params = json.load(f)
        
        return model, scaler_X, scaler_y, feature_cols, params.get('seq_length', 60)
    except Exception as e:
        print(f"無法加載 LSTM 模型: {e}")
        return None, None, None, None, None

def load_prophet_model():
    """加載 Prophet 模型"""
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        models_dir = os.path.join(script_dir, 'models')
        
        model_path = os.path.join(models_dir, 'prophet_model.pkl')
        if not os.path.exists(model_path):
            return None
        
        with open(model_path, 'rb') as f:
            model = pickle.load(f)
        
        return model
    except Exception as e:
        print(f"無法加載 Prophet 模型: {e}")
        return None

def predict_with_xgboost(model, feature_cols, features_df):
    """使用 XGBoost 預測"""
    if model is None:
        return None
    
    X = features_df[feature_cols].fillna(0)
    prediction = model.predict(X)[0]
    return float(prediction)

def predict_with_lstm(model, scaler_X, scaler_y, feature_cols, seq_length, historical_data):
    """使用 LSTM 預測"""
    if model is None or len(historical_data) < seq_length:
        return None
    
    try:
        from sklearn.preprocessing import MinMaxScaler
        
        # 準備序列數據
        recent_data = historical_data[-seq_length:]
        X_seq = recent_data[feature_cols].fillna(0).values
        
        # 標準化
        X_scaled = scaler_X.transform(X_seq)
        X_seq_array = X_scaled.reshape(1, seq_length, len(feature_cols))
        
        # 預測
        y_pred_scaled = model.predict(X_seq_array, verbose=0)[0][0]
        y_pred = scaler_y.inverse_transform([[y_pred_scaled]])[0][0]
        
        return float(y_pred)
    except Exception as e:
        print(f"LSTM 預測錯誤: {e}")
        return None

def predict_with_prophet(model, target_date, historical_data):
    """使用 Prophet 預測"""
    if model is None:
        return None
    
    try:
        # 創建未來日期 DataFrame
        future = pd.DataFrame({'ds': [pd.to_datetime(target_date)]})
        
        # 添加回歸變量
        target_dt = pd.to_datetime(target_date)
        future['covid_period'] = 0  # 假設未來沒有 COVID
        future['winter_flu'] = 1 if target_dt.month in [12, 1, 2, 3] else 0
        future['is_monday'] = 1 if target_dt.dayofweek == 0 else 0
        
        # 預測
        forecast = model.predict(future)
        prediction = forecast['yhat'].values[0]
        
        return float(prediction)
    except Exception as e:
        print(f"Prophet 預測錯誤: {e}")
        return None

def ensemble_predict(target_date, historical_data):
    """
    集成預測主函數
    
    參數:
        target_date: 目標日期 (YYYY-MM-DD)
        historical_data: DataFrame，包含歷史數據（Date, Attendance）
    
    返回:
        dict: {
            'prediction': 集成預測值,
            'ci80': {'low': ..., 'high': ...},
            'ci95': {'low': ..., 'high': ...},
            'individual': {
                'xgboost': ...,
                'lstm': ...,
                'prophet': ...
            }
        }
    """
    # 加載模型
    xgb_model, xgb_features = load_xgboost_model()
    lstm_model, lstm_scaler_X, lstm_scaler_y, lstm_features, seq_length = load_lstm_model()
    prophet_model = load_prophet_model()
    
    # 準備特徵數據
    if historical_data is not None and len(historical_data) > 0:
        # 確保包含目標日期之前的數據
        all_data = historical_data.copy()
        target_dt = pd.to_datetime(target_date)
        
        # 創建特徵
        all_data = create_comprehensive_features(all_data)
        
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
            
            features_df = pd.DataFrame([last_row])
        else:
            features_df = None
    else:
        features_df = None
    
    # 獲取各個模型的預測
    predictions = {}
    
    # XGBoost
    if xgb_model is not None and features_df is not None:
        xgb_pred = predict_with_xgboost(xgb_model, xgb_features, features_df)
        predictions['xgboost'] = xgb_pred
    
    # LSTM
    if lstm_model is not None and historical_data is not None and len(historical_data) >= seq_length:
        lstm_pred = predict_with_lstm(lstm_model, lstm_scaler_X, lstm_scaler_y, 
                                     lstm_features, seq_length, all_data)
        predictions['lstm'] = lstm_pred
    
    # Prophet
    if prophet_model is not None:
        prophet_pred = predict_with_prophet(prophet_model, target_date, historical_data)
        predictions['prophet'] = prophet_pred
    
    # 如果沒有任何模型可用，返回 None
    if not predictions:
        return None
    
    # 計算加權集成預測
    valid_predictions = {k: v for k, v in predictions.items() if v is not None}
    if not valid_predictions:
        return None
    
    # 調整權重（只使用可用模型的權重）
    total_weight = sum(ENSEMBLE_WEIGHTS.get(k, 0) for k in valid_predictions.keys())
    if total_weight == 0:
        # 如果權重為 0，使用平均
        ensemble_pred = np.mean(list(valid_predictions.values()))
    else:
        # 正規化權重
        normalized_weights = {k: ENSEMBLE_WEIGHTS.get(k, 0) / total_weight 
                              for k in valid_predictions.keys()}
        ensemble_pred = sum(valid_predictions[k] * normalized_weights[k] 
                           for k in valid_predictions.keys())
    
    # 計算置信區間（基於模型間的分歧）
    if len(valid_predictions) > 1:
        pred_values = list(valid_predictions.values())
        std_preds = np.std(pred_values)
        mean_pred = np.mean(pred_values)
    else:
        std_preds = ensemble_pred * 0.05  # 5% 不確定性
        mean_pred = ensemble_pred
    
    # 計算置信區間
    ci80_low = ensemble_pred - 1.28 * std_preds
    ci80_high = ensemble_pred + 1.28 * std_preds
    ci95_low = ensemble_pred - 1.96 * std_preds
    ci95_high = ensemble_pred + 1.96 * std_preds
    
    return {
        'prediction': float(ensemble_pred),
        'ci80': {
            'low': float(ci80_low),
            'high': float(ci80_high)
        },
        'ci95': {
            'low': float(ci95_low),
            'high': float(ci95_high)
        },
        'individual': predictions,
        'weights_used': {k: ENSEMBLE_WEIGHTS.get(k, 0) for k in valid_predictions.keys()}
    }

def main():
    """命令行接口"""
    if len(sys.argv) < 2:
        print("用法: python ensemble_predict.py <target_date> [historical_data_path]")
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

