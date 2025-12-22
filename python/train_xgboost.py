"""
XGBoost 模型訓練腳本
根據 AI-AED-Algorithm-Specification.txt Section 6.1
"""
import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_absolute_error, mean_squared_error
import json
import os
import sys
from feature_engineering import create_comprehensive_features, get_feature_columns

def load_data_from_db():
    """從數據庫加載數據（如果可用）"""
    try:
        import psycopg2
        from dotenv import load_dotenv
        load_dotenv()
        
        conn = psycopg2.connect(
            host=os.getenv('PGHOST') or os.getenv('DATABASE_URL', '').split('@')[1].split('/')[0] if '@' in os.getenv('DATABASE_URL', '') else None,
            database=os.getenv('PGDATABASE') or os.getenv('DATABASE_URL', '').split('/')[-1] if '/' in os.getenv('DATABASE_URL', '') else None,
            user=os.getenv('PGUSER') or os.getenv('DATABASE_URL', '').split('://')[1].split(':')[0] if '://' in os.getenv('DATABASE_URL', '') else None,
            password=os.getenv('PGPASSWORD') or os.getenv('DATABASE_URL', '').split('@')[0].split(':')[-1] if '@' in os.getenv('DATABASE_URL', '') else None,
        )
        
        query = """
            SELECT date as Date, patient_count as Attendance
            FROM actual_data
            ORDER BY date ASC
        """
        df = pd.read_sql_query(query, conn)
        conn.close()
        
        # 確保列名正確（pandas 可能會將列名轉為小寫）
        # 檢查並映射 Date 列
        if 'date' in df.columns and 'Date' not in df.columns:
            df['Date'] = df['date']
            df = df.drop(columns=['date'])
        elif 'Date' not in df.columns:
            print(f"錯誤: 找不到 Date 列。可用列: {df.columns.tolist()}")
            return None
        
        # 檢查並映射 Attendance 列（可能是 attendance 或 patient_count）
        if 'attendance' in df.columns and 'Attendance' not in df.columns:
            df['Attendance'] = df['attendance']
            df = df.drop(columns=['attendance'])
        elif 'patient_count' in df.columns and 'Attendance' not in df.columns:
            df['Attendance'] = df['patient_count']
            df = df.drop(columns=['patient_count'])
        elif 'Attendance' not in df.columns:
            print(f"錯誤: 找不到 Attendance 列。可用列: {df.columns.tolist()}")
            return None
        
        # 確保只返回需要的列
        if 'Date' in df.columns and 'Attendance' in df.columns:
            return df[['Date', 'Attendance']]
        else:
            print(f"警告: 數據列不完整。可用列: {df.columns.tolist()}")
            return df
    except Exception as e:
        print(f"無法從數據庫加載數據: {e}")
        return None

def load_data_from_csv(csv_path):
    """從 CSV 文件加載數據"""
    try:
        df = pd.read_csv(csv_path)
        # 處理不同的列名格式
        if 'Date' not in df.columns:
            if 'date' in df.columns:
                df['Date'] = df['date']
            elif 'Date' in df.columns:
                df['Date'] = df['Date']
        if 'Attendance' not in df.columns:
            if 'patient_count' in df.columns:
                df['Attendance'] = df['patient_count']
            elif 'Attendance' in df.columns:
                df['Attendance'] = df['Attendance']
        
        return df[['Date', 'Attendance']]
    except Exception as e:
        print(f"無法從 CSV 加載數據: {e}")
        return None

def train_xgboost_model(train_data, test_data, feature_cols):
    """訓練 XGBoost 模型"""
    X_train = train_data[feature_cols].fillna(0)
    y_train = train_data['Attendance']
    X_test = test_data[feature_cols].fillna(0)
    y_test = test_data['Attendance']
    
    # 根據算法規格文件配置
    model = xgb.XGBRegressor(
        n_estimators=500,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        colsample_bylevel=0.8,
        objective='reg:squarederror',
        alpha=1.0,
        reg_lambda=1.0,
        tree_method='hist',
        grow_policy='depthwise',
        early_stopping_rounds=50,
        eval_metric='mae',
        random_state=42,
        n_jobs=-1
    )
    
    model.fit(
        X_train, y_train,
        eval_set=[(X_test, y_test)],
        verbose=False
    )
    
    # 評估
    y_pred = model.predict(X_test)
    mae = mean_absolute_error(y_test, y_pred)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))
    mape = np.mean(np.abs((y_test - y_pred) / y_test)) * 100
    
    print(f"XGBoost 模型性能:")
    print(f"  MAE: {mae:.2f} 病人")
    print(f"  RMSE: {rmse:.2f} 病人")
    print(f"  MAPE: {mape:.2f}%")
    
    return model, {'mae': mae, 'rmse': rmse, 'mape': mape}

def main():
    # 創建模型目錄（相對於當前腳本目錄）
    script_dir = os.path.dirname(os.path.abspath(__file__))
    models_dir = os.path.join(script_dir, 'models')
    os.makedirs(models_dir, exist_ok=True)
    print(f"模型目錄: {models_dir}")
    
    # 嘗試從數據庫加載數據
    df = load_data_from_db()
    
    # 如果數據庫不可用，嘗試從 CSV 加載
    if df is None or len(df) == 0:
        csv_paths = [
            '../NDH_AED_Attendance_2025-12-01_to_2025-12-21.csv',
            'NDH_AED_Attendance_2025-12-01_to_2025-12-21.csv',
        ]
        for csv_path in csv_paths:
            if os.path.exists(csv_path):
                df = load_data_from_csv(csv_path)
                if df is not None and len(df) > 0:
                    break
    
    if df is None or len(df) == 0:
        print("錯誤: 無法加載數據")
        sys.exit(1)
    
    print(f"加載了 {len(df)} 筆數據")
    
    # 創建特徵
    df = create_comprehensive_features(df)
    
    # 移除包含 NaN 的行（除了我們已經填充的列）
    df = df.dropna(subset=['Attendance'])
    
    # 時間序列分割（不能隨機分割！）
    split_idx = int(len(df) * 0.8)
    train_data = df[:split_idx].copy()
    test_data = df[split_idx:].copy()
    
    print(f"訓練集: {len(train_data)} 筆")
    print(f"測試集: {len(test_data)} 筆")
    
    # 獲取特徵列
    feature_cols = get_feature_columns()
    # 只保留實際存在的列
    feature_cols = [col for col in feature_cols if col in df.columns]
    
    print(f"使用 {len(feature_cols)} 個特徵")
    
    # 訓練模型
    model, metrics = train_xgboost_model(train_data, test_data, feature_cols)
    
    # 保存模型（使用絕對路徑）
    script_dir = os.path.dirname(os.path.abspath(__file__))
    models_dir = os.path.join(script_dir, 'models')
    
    model_path = os.path.join(models_dir, 'xgboost_model.json')
    model.save_model(model_path)
    print(f"模型已保存到 {model_path}")
    
    # 保存特徵列名
    features_path = os.path.join(models_dir, 'xgboost_features.json')
    with open(features_path, 'w') as f:
        json.dump(feature_cols, f)
    
    # 保存評估指標
    metrics_path = os.path.join(models_dir, 'xgboost_metrics.json')
    with open(metrics_path, 'w') as f:
        json.dump(metrics, f)
    
    print("✅ XGBoost 模型訓練完成！")

if __name__ == '__main__':
    main()

