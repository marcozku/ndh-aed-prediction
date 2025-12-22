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

def load_ai_factors_from_db(conn):
    """從數據庫加載 AI 因子數據"""
    try:
        import sqlalchemy
        # 使用 SQLAlchemy 創建連接以避免警告
        from sqlalchemy import create_engine
        # 從 psycopg2 連接獲取連接字符串
        dsn = conn.get_dsn_parameters()
        connection_string = f"postgresql://{dsn.get('user')}:{dsn.get('password', '')}@{dsn.get('host')}:{dsn.get('port', 5432)}/{dsn.get('dbname')}"
        engine = create_engine(connection_string)
        
        query = """
            SELECT factors_cache
            FROM ai_factors_cache
            WHERE id = 1
        """
        result = pd.read_sql_query(query, engine)
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
        
        # 使用 SQLAlchemy 創建連接以避免警告
        from sqlalchemy import create_engine
        # 從 psycopg2 連接獲取連接字符串
        dsn = conn.get_dsn_parameters()
        connection_string = f"postgresql://{dsn.get('user')}:{dsn.get('password', '')}@{dsn.get('host')}:{dsn.get('port', 5432)}/{dsn.get('dbname')}"
        engine = create_engine(connection_string)
        
        query = """
            SELECT date as Date, patient_count as Attendance
            FROM actual_data
            ORDER BY date ASC
        """
        df = pd.read_sql_query(query, engine)
        
        # 加載 AI 因子數據（使用原始連接，因為 load_ai_factors_from_db 會創建自己的 engine）
        ai_factors = load_ai_factors_from_db(conn)
        if ai_factors:
            print(f"✅ 加載了 {len(ai_factors)} 個日期的 AI 因子數據")
        else:
            print("ℹ️ 沒有找到 AI 因子數據，將使用默認值")
        
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
        
        # 確保只返回需要的列和 AI 因子
        if 'Date' in df.columns and 'Attendance' in df.columns:
            # 將 AI 因子附加到 DataFrame（作為元數據，稍後在特徵工程中使用）
            df_with_ai = df[['Date', 'Attendance']].copy()
            df_with_ai.attrs['ai_factors'] = ai_factors
            return df_with_ai
        else:
            print(f"警告: 數據列不完整。可用列: {df.columns.tolist()}")
            df.attrs['ai_factors'] = ai_factors
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
    
    # 創建自定義 XGBoost 類以修復 _estimator_type 錯誤
    class XGBoostModel(xgb.XGBRegressor):
        _estimator_type = "regressor"
    
    # 根據算法規格文件配置
    model = XGBoostModel(
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
    
    # 獲取 AI 因子數據（如果有的話）
    ai_factors = df.attrs.get('ai_factors', {}) if hasattr(df, 'attrs') else {}
    
    # 創建特徵（包含 AI 因子）
    df = create_comprehensive_features(df, ai_factors_dict=ai_factors if ai_factors else None)
    
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

