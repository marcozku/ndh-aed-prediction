"""
Prophet 模型訓練腳本
根據 AI-AED-Algorithm-Specification.txt Section 6.3
"""
import pandas as pd
import numpy as np
from prophet import Prophet
from sklearn.metrics import mean_absolute_error, mean_squared_error
import json
import os
import sys
from feature_engineering import create_comprehensive_features

def load_data_from_db():
    """從數據庫加載數據"""
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
        return df
    except Exception as e:
        print(f"無法從數據庫加載數據: {e}")
        return None

def load_data_from_csv(csv_path):
    """從 CSV 文件加載數據"""
    try:
        df = pd.read_csv(csv_path)
        if 'Date' not in df.columns:
            if 'date' in df.columns:
                df['Date'] = df['date']
        if 'Attendance' not in df.columns:
            if 'patient_count' in df.columns:
                df['Attendance'] = df['patient_count']
        return df[['Date', 'Attendance']]
    except Exception as e:
        print(f"無法從 CSV 加載數據: {e}")
        return None

def train_prophet_model(train_data, test_data):
    """訓練 Prophet 模型"""
    # Prophet 需要 'ds' 和 'y' 列
    prophet_train = train_data[['Date', 'Attendance']].copy()
    prophet_train.columns = ['ds', 'y']
    
    # 添加回歸變量
    prophet_train['covid_period'] = train_data['Is_COVID_Period'].values if 'Is_COVID_Period' in train_data.columns else 0
    prophet_train['winter_flu'] = train_data['Is_Winter_Flu_Season'].values if 'Is_Winter_Flu_Season' in train_data.columns else 0
    prophet_train['is_monday'] = train_data['Is_Monday'].values if 'Is_Monday' in train_data.columns else 0
    
    # 初始化模型
    model = Prophet(
        yearly_seasonality=True,
        weekly_seasonality=True,
        daily_seasonality=False,
        seasonality_mode='additive',
        interval_width=0.95,
        n_changepoints=30,
        changepoint_prior_scale=0.05,
        seasonality_prior_scale=10
    )
    
    # 添加回歸變量
    model.add_regressor('covid_period', standardize=True)
    model.add_regressor('winter_flu', standardize=True)
    model.add_regressor('is_monday', standardize=True)
    
    # 訓練
    model.fit(prophet_train)
    
    # 準備測試數據
    prophet_test = test_data[['Date']].copy()
    prophet_test.columns = ['ds']
    prophet_test['covid_period'] = test_data['Is_COVID_Period'].values if 'Is_COVID_Period' in test_data.columns else 0
    prophet_test['winter_flu'] = test_data['Is_Winter_Flu_Season'].values if 'Is_Winter_Flu_Season' in test_data.columns else 0
    prophet_test['is_monday'] = test_data['Is_Monday'].values if 'Is_Monday' in test_data.columns else 0
    
    # 預測
    forecast = model.predict(prophet_test)
    y_pred = forecast['yhat'].values
    
    # 評估
    y_test = test_data['Attendance'].values
    mae = mean_absolute_error(y_test, y_pred)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))
    mape = np.mean(np.abs((y_test - y_pred) / y_test)) * 100
    
    print(f"Prophet 模型性能:")
    print(f"  MAE: {mae:.2f} 病人")
    print(f"  RMSE: {rmse:.2f} 病人")
    print(f"  MAPE: {mape:.2f}%")
    
    return model, {'mae': mae, 'rmse': rmse, 'mape': mape}

def main():
    os.makedirs('models', exist_ok=True)
    
    # 加載數據
    df = load_data_from_db()
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
    df = df.dropna(subset=['Attendance'])
    
    # 時間序列分割
    split_idx = int(len(df) * 0.8)
    train_data = df[:split_idx].copy()
    test_data = df[split_idx:].copy()
    
    print(f"訓練集: {len(train_data)} 筆")
    print(f"測試集: {len(test_data)} 筆")
    
    # 訓練模型
    model, metrics = train_prophet_model(train_data, test_data)
    
    # 保存模型
    import pickle
    model_path = 'models/prophet_model.pkl'
    with open(model_path, 'wb') as f:
        pickle.dump(model, f)
    print(f"模型已保存到 {model_path}")
    
    # 保存評估指標
    with open('models/prophet_metrics.json', 'w') as f:
        json.dump(metrics, f)
    
    print("✅ Prophet 模型訓練完成！")

if __name__ == '__main__':
    main()

