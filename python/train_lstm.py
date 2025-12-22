"""
LSTM 模型訓練腳本
根據 AI-AED-Algorithm-Specification.txt Section 6.2
"""
import pandas as pd
import numpy as np
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense, Dropout, Bidirectional
from tensorflow.keras.optimizers import Adam
from tensorflow.keras.callbacks import EarlyStopping
from sklearn.preprocessing import MinMaxScaler
from sklearn.metrics import mean_absolute_error, mean_squared_error
import json
import os
import sys
from feature_engineering import create_comprehensive_features, get_feature_columns

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

def create_sequences(X, y, seq_length=60):
    """創建 60 天滑動窗口用於 LSTM"""
    X_seq, y_seq = [], []
    for i in range(len(X) - seq_length):
        X_seq.append(X[i:i+seq_length])
        y_seq.append(y[i+seq_length])
    return np.array(X_seq), np.array(y_seq)

def train_lstm_model(train_data, test_data, feature_cols, seq_length=60):
    """訓練 LSTM 模型"""
    # 準備特徵
    X_train_raw = train_data[feature_cols].fillna(0).values
    y_train_raw = train_data['Attendance'].values
    X_test_raw = test_data[feature_cols].fillna(0).values
    y_test_raw = test_data['Attendance'].values
    
    # 標準化
    scaler_X = MinMaxScaler()
    scaler_y = MinMaxScaler()
    
    X_train_scaled = scaler_X.fit_transform(X_train_raw)
    X_test_scaled = scaler_X.transform(X_test_raw)
    y_train_scaled = scaler_y.fit_transform(y_train_raw.reshape(-1, 1)).flatten()
    y_test_scaled = scaler_y.transform(y_test_raw.reshape(-1, 1)).flatten()
    
    # 創建序列
    X_train_seq, y_train_seq = create_sequences(X_train_scaled, y_train_scaled, seq_length)
    X_test_seq, y_test_seq = create_sequences(X_test_scaled, y_test_scaled, seq_length)
    
    if len(X_train_seq) == 0 or len(X_test_seq) == 0:
        print("錯誤: 數據不足以創建序列")
        return None, None, None, None
    
    print(f"訓練序列: {X_train_seq.shape}")
    print(f"測試序列: {X_test_seq.shape}")
    
    # 構建 LSTM 模型
    model = Sequential([
        Bidirectional(LSTM(128, return_sequences=True, 
                          input_shape=(seq_length, len(feature_cols)))),
        Dropout(0.2),
        Bidirectional(LSTM(64, return_sequences=True)),
        Dropout(0.2),
        LSTM(32, return_sequences=False),
        Dropout(0.2),
        Dense(64, activation='relu'),
        Dropout(0.1),
        Dense(32, activation='relu'),
        Dense(1)
    ])
    
    model.compile(
        optimizer=Adam(learning_rate=0.001),
        loss='mae',
        metrics=['mae', 'mse']
    )
    
    # 訓練
    history = model.fit(
        X_train_seq, y_train_seq,
        epochs=100,
        batch_size=32,
        validation_data=(X_test_seq, y_test_seq),
        callbacks=[
            EarlyStopping(
                monitor='val_loss',
                patience=15,
                restore_best_weights=True,
                verbose=1
            )
        ],
        verbose=1
    )
    
    # 評估
    y_pred_scaled = model.predict(X_test_seq, verbose=0).flatten()
    y_pred = scaler_y.inverse_transform(y_pred_scaled.reshape(-1, 1)).flatten()
    
    # 只評估有對應實際值的預測
    min_len = min(len(y_pred), len(y_test_raw[seq_length:]))
    y_pred_eval = y_pred[:min_len]
    y_test_eval = y_test_raw[seq_length:seq_length+min_len]
    
    mae = mean_absolute_error(y_test_eval, y_pred_eval)
    rmse = np.sqrt(mean_squared_error(y_test_eval, y_pred_eval))
    mape = np.mean(np.abs((y_test_eval - y_pred_eval) / y_test_eval)) * 100
    
    print(f"LSTM 模型性能:")
    print(f"  MAE: {mae:.2f} 病人")
    print(f"  RMSE: {rmse:.2f} 病人")
    print(f"  MAPE: {mape:.2f}%")
    
    return model, scaler_X, scaler_y, {'mae': mae, 'rmse': rmse, 'mape': mape}

def main():
    # 創建模型目錄（相對於當前腳本目錄）
    script_dir = os.path.dirname(os.path.abspath(__file__))
    models_dir = os.path.join(script_dir, 'models')
    os.makedirs(models_dir, exist_ok=True)
    print(f"模型目錄: {models_dir}")
    
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
    
    # 獲取特徵列
    feature_cols = get_feature_columns()
    feature_cols = [col for col in feature_cols if col in df.columns]
    
    print(f"使用 {len(feature_cols)} 個特徵")
    
    # 訓練模型
    model, scaler_X, scaler_y, metrics = train_lstm_model(train_data, test_data, feature_cols)
    
    if model is None:
        print("模型訓練失敗")
        sys.exit(1)
    
    # 保存模型（使用絕對路徑）
    script_dir = os.path.dirname(os.path.abspath(__file__))
    models_dir = os.path.join(script_dir, 'models')
    
    model_path = os.path.join(models_dir, 'lstm_model.h5')
    model.save(model_path)
    print(f"模型已保存到 {model_path}")
    
    # 保存 scaler（需要序列化）
    import pickle
    with open(os.path.join(models_dir, 'lstm_scaler_X.pkl'), 'wb') as f:
        pickle.dump(scaler_X, f)
    with open(os.path.join(models_dir, 'lstm_scaler_y.pkl'), 'wb') as f:
        pickle.dump(scaler_y, f)
    
    # 保存特徵列和參數
    with open(os.path.join(models_dir, 'lstm_features.json'), 'w') as f:
        json.dump(feature_cols, f)
    with open(os.path.join(models_dir, 'lstm_metrics.json'), 'w') as f:
        json.dump(metrics, f)
    with open(os.path.join(models_dir, 'lstm_params.json'), 'w') as f:
        json.dump({'seq_length': 60}, f)
    
    print("✅ LSTM 模型訓練完成！")

if __name__ == '__main__':
    main()

