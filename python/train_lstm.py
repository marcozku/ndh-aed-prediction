"""
LSTM 模型訓練腳本
根據 AI-AED-Algorithm-Specification.txt Section 6.2
"""
# ============================================================================
# 關鍵：在導入任何其他模塊之前，必須先設置所有 CUDA/TensorFlow 環境變數
# 這可以防止 TensorFlow 嘗試初始化 CUDA，從而避免 free(): invalid pointer 錯誤
# ============================================================================
import os
import sys

# 在所有導入之前設置環境變數（必須在 import tensorflow 之前）
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'  # 減少 TensorFlow 日誌
os.environ['CUDA_VISIBLE_DEVICES'] = '-1'  # 完全禁用 GPU
os.environ['TF_FORCE_GPU_ALLOW_GROWTH'] = 'false'
os.environ['TF_USE_GPU'] = '0'  # 明確禁用 GPU
os.environ['TF_GPU_ALLOCATOR'] = ''  # 禁用 GPU 分配器
os.environ['TF_XLA_FLAGS'] = '--tf_xla_enable_xla_devices=false'  # 禁用 XLA GPU

# 嘗試禁用 CUDA 庫加載（如果可能）
try:
    # 在 Linux 上，可以通過設置 LD_LIBRARY_PATH 來阻止 CUDA 庫加載
    # 但這可能不適用於所有環境，所以我們只嘗試設置，不強制
    if 'LD_LIBRARY_PATH' in os.environ:
        # 從 LD_LIBRARY_PATH 中移除 CUDA 相關路徑
        ld_path = os.environ['LD_LIBRARY_PATH']
        paths = ld_path.split(':')
        filtered_paths = [p for p in paths if 'cuda' not in p.lower() and 'cudnn' not in p.lower()]
        if filtered_paths:
            os.environ['LD_LIBRARY_PATH'] = ':'.join(filtered_paths)
except:
    pass  # 忽略錯誤，繼續執行

import pandas as pd
import numpy as np
import json
import pickle
import gc
import traceback

# 現在導入 TensorFlow，並進行嚴格的 CPU-only 配置
try:
    import tensorflow as tf
    
    # 強制使用 CPU - 在 TensorFlow 初始化之前設置
    # 這必須在任何 TensorFlow 操作之前執行
    try:
        # 列出所有物理設備
        physical_devices = tf.config.list_physical_devices()
        print(f"檢測到的 TensorFlow 設備: {[d.name for d in physical_devices]}")
        
        # 強制設置只使用 CPU
        tf.config.set_visible_devices([], 'GPU')
        
        # 如果意外檢測到 GPU，嘗試禁用它
        gpus = tf.config.list_physical_devices('GPU')
        if gpus:
            print(f"警告: 檢測到 {len(gpus)} 個 GPU，但將強制使用 CPU")
            try:
                # 嘗試禁用所有 GPU
                for gpu in gpus:
                    tf.config.experimental.set_memory_growth(gpu, False)
                tf.config.set_visible_devices([], 'GPU')
            except Exception as e:
                print(f"警告: 無法禁用 GPU: {e}")
        
        # 限制 TensorFlow 線程數，減少內存壓力
        tf.config.threading.set_inter_op_parallelism_threads(2)
        tf.config.threading.set_intra_op_parallelism_threads(2)
        
        # 驗證配置
        visible_devices = tf.config.get_visible_devices()
        print(f"TensorFlow 可見設備: {[d.name for d in visible_devices]}")
        if any('GPU' in d.name for d in visible_devices):
            print("錯誤: GPU 仍然可見，這可能導致 CUDA 錯誤")
            # 強制退出，避免後續錯誤
            sys.exit(1)
            
    except Exception as config_error:
        print(f"TensorFlow 配置錯誤: {config_error}")
        print("嘗試繼續執行，但可能遇到 CUDA 相關問題...")
        traceback.print_exc()
    
    # 導入 Keras 組件
    from tensorflow.keras.models import Sequential
    from tensorflow.keras.layers import LSTM, Dense, Dropout
    from tensorflow.keras.optimizers import Adam
    from tensorflow.keras.callbacks import EarlyStopping
    from tensorflow.keras import backend as K
    
    print("✅ TensorFlow 已成功配置為 CPU-only 模式")
    
except ImportError as e:
    print(f"錯誤: 無法導入 TensorFlow: {e}")
    sys.exit(1)
except Exception as tf_init_error:
    print(f"錯誤: TensorFlow 初始化失敗: {tf_init_error}")
    print("這可能是由於 CUDA 相關問題導致的")
    traceback.print_exc()
    sys.exit(1)

from sklearn.preprocessing import MinMaxScaler
from sklearn.metrics import mean_absolute_error, mean_squared_error
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
    model = None
    scaler_X = None
    scaler_y = None
    metrics = None
    
    try:
        print("準備特徵數據...")
        # 準備特徵
        X_train_raw = train_data[feature_cols].fillna(0).values
        y_train_raw = train_data['Attendance'].values
        X_test_raw = test_data[feature_cols].fillna(0).values
        y_test_raw = test_data['Attendance'].values.copy()  # 保存副本用於評估
        
        print(f"訓練數據形狀: X={X_train_raw.shape}, y={y_train_raw.shape}")
        print(f"測試數據形狀: X={X_test_raw.shape}, y={y_test_raw.shape}")
        
        # 標準化
        print("標準化數據...")
        scaler_X = MinMaxScaler()
        scaler_y = MinMaxScaler()
        
        X_train_scaled = scaler_X.fit_transform(X_train_raw)
        X_test_scaled = scaler_X.transform(X_test_raw)
        y_train_scaled = scaler_y.fit_transform(y_train_raw.reshape(-1, 1)).flatten()
        y_test_scaled = scaler_y.transform(y_test_raw.reshape(-1, 1)).flatten()
        
        # 清理原始數據以釋放內存（但保留 y_test_raw 用於評估）
        del X_train_raw, X_test_raw, y_train_raw
        gc.collect()
        
        # 創建序列
        print(f"創建序列（序列長度: {seq_length}）...")
        X_train_seq, y_train_seq = create_sequences(X_train_scaled, y_train_scaled, seq_length)
        X_test_seq, y_test_seq = create_sequences(X_test_scaled, y_test_scaled, seq_length)
        
        if len(X_train_seq) == 0 or len(X_test_seq) == 0:
            print(f"錯誤: 數據不足以創建序列。訓練序列: {len(X_train_seq)}, 測試序列: {len(X_test_seq)}")
            return None, None, None, None
        
        print(f"訓練序列: {X_train_seq.shape}")
        print(f"測試序列: {X_test_seq.shape}")
        
        # 清理中間數據
        del X_train_scaled, X_test_scaled, y_train_scaled, y_test_scaled
        gc.collect()
        
        # 構建 LSTM 模型（簡化架構以減少內存使用，避免 free(): invalid pointer 錯誤）
        print("構建 LSTM 模型...")
        # 使用更簡單的架構以避免內存分配器衝突
        model = Sequential([
            LSTM(64, return_sequences=True, input_shape=(seq_length, len(feature_cols))),
            Dropout(0.2),
            LSTM(32, return_sequences=False),
            Dropout(0.2),
            Dense(32, activation='relu'),
            Dropout(0.1),
            Dense(1)
        ])
        
        print("編譯模型...")
        model.compile(
            optimizer=Adam(learning_rate=0.001),
            loss='mae',
            metrics=['mae', 'mse']
        )
        
        # 訓練
        print("開始訓練模型...")
        try:
            # 使用較小的 batch_size 以減少內存壓力
            # 在訓練前再次確認沒有 GPU 被使用
            visible_devices = tf.config.get_visible_devices()
            if any('GPU' in d.name for d in visible_devices):
                print("錯誤: 檢測到 GPU 設備，這可能導致 CUDA 錯誤")
                raise RuntimeError("GPU 設備仍然可見，無法安全訓練")
            
            history = model.fit(
                X_train_seq, y_train_seq,
                epochs=100,
                batch_size=16,  # 從 32 減少到 16 以減少內存使用
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
            # 訓練完成後立即清理 TensorFlow 會話
            K.clear_session()
            gc.collect()
        except RuntimeError as rt_error:
            # 捕獲 CUDA 相關的 RuntimeError
            error_msg = str(rt_error)
            if 'CUDA' in error_msg or 'cuda' in error_msg.lower() or 'GPU' in error_msg:
                print(f"❌ CUDA/GPU 相關錯誤: {error_msg}")
                print("這可能是由於 TensorFlow 嘗試使用 GPU 導致的")
                print("建議: 確保環境變數 CUDA_VISIBLE_DEVICES=-1 已設置")
            else:
                print(f"模型訓練過程中發生 RuntimeError: {rt_error}")
            traceback.print_exc()
            # 清理模型和 TensorFlow 會話
            if model is not None:
                try:
                    K.clear_session()
                except:
                    pass
                del model
            gc.collect()
            return None, None, None, None
        except Exception as fit_error:
            error_msg = str(fit_error)
            # 檢查是否為 CUDA 相關錯誤
            if 'CUDA' in error_msg or 'cuda' in error_msg.lower() or 'free()' in error_msg or 'invalid pointer' in error_msg:
                print(f"❌ 檢測到 CUDA/內存相關錯誤: {error_msg}")
                print("這可能是由於 TensorFlow 嘗試初始化 CUDA 但失敗導致的")
                print("已嘗試強制使用 CPU，但可能環境中仍有 CUDA 庫被加載")
                print("建議解決方案:")
                print("  1. 確保環境變數 CUDA_VISIBLE_DEVICES=-1 已設置")
                print("  2. 檢查是否安裝了 CPU-only 版本的 TensorFlow")
                print("  3. 考慮使用 Docker 容器隔離 CUDA 環境")
            else:
                print(f"模型訓練過程中發生錯誤: {fit_error}")
            traceback.print_exc()
            # 清理模型和 TensorFlow 會話
            if model is not None:
                try:
                    K.clear_session()
                except:
                    pass
                del model
            gc.collect()
            return None, None, None, None
        
        # 評估
        print("評估模型...")
        try:
            # 使用較小的 batch_size 進行預測
            y_pred_scaled = model.predict(X_test_seq, verbose=0, batch_size=16).flatten()
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
            
            metrics = {'mae': mae, 'rmse': rmse, 'mape': mape}
            
            # 清理評估數據
            del y_pred_scaled, y_pred, y_pred_eval, y_test_eval, y_test_raw
            gc.collect()
            
        except Exception as eval_error:
            print(f"模型評估過程中發生錯誤: {eval_error}")
            traceback.print_exc()
            metrics = {'mae': None, 'rmse': None, 'mape': None}
            # 清理 y_test_raw
            if 'y_test_raw' in locals():
                del y_test_raw
            gc.collect()
        
        return model, scaler_X, scaler_y, metrics
        
    except Exception as e:
        print(f"錯誤: LSTM 模型訓練過程中發生異常: {e}")
        traceback.print_exc()
        # 清理資源
        if model is not None:
            try:
                K.clear_session()
            except:
                pass
            del model
        gc.collect()
        return None, None, None, None

def main():
    model = None
    scaler_X = None
    scaler_y = None
    metrics = None
    feature_cols = None
    seq_length = 60
    
    try:
        # 驗證環境變數設置
        cuda_visible = os.environ.get('CUDA_VISIBLE_DEVICES', '')
        if cuda_visible != '-1':
            print(f"⚠️  警告: CUDA_VISIBLE_DEVICES={cuda_visible}，預期為 '-1'")
            print("強制設置 CUDA_VISIBLE_DEVICES=-1")
            os.environ['CUDA_VISIBLE_DEVICES'] = '-1'
        
        # 再次驗證 TensorFlow 配置
        try:
            visible_devices = tf.config.get_visible_devices()
            gpu_devices = [d for d in visible_devices if 'GPU' in d.name]
            if gpu_devices:
                print(f"❌ 錯誤: 仍然檢測到 GPU 設備: {[d.name for d in gpu_devices]}")
                print("這可能導致 CUDA 初始化錯誤")
                print("嘗試強制禁用 GPU...")
                tf.config.set_visible_devices([], 'GPU')
                # 再次檢查
                visible_devices = tf.config.get_visible_devices()
                gpu_devices = [d for d in visible_devices if 'GPU' in d.name]
                if gpu_devices:
                    print("❌ 無法禁用 GPU，退出以避免 CUDA 錯誤")
                    sys.exit(1)
            else:
                print("✅ 確認: 沒有 GPU 設備可見，將使用 CPU")
        except Exception as verify_error:
            print(f"⚠️  環境驗證警告: {verify_error}")
            print("繼續執行，但可能遇到問題...")
        
        # 創建模型目錄（相對於當前腳本目錄）
        script_dir = os.path.dirname(os.path.abspath(__file__))
        models_dir = os.path.join(script_dir, 'models')
        os.makedirs(models_dir, exist_ok=True)
        print(f"模型目錄: {models_dir}")
        
        # 加載數據
        print("正在從數據庫加載數據...")
        df = load_data_from_db()
        if df is None or len(df) == 0:
            print("數據庫加載失敗，嘗試從 CSV 加載...")
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
        print("正在創建特徵...")
        df = create_comprehensive_features(df)
        df = df.dropna(subset=['Attendance'])
        print(f"特徵創建完成，剩餘 {len(df)} 筆數據")
        
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
        
        # 清理原始數據框以釋放內存
        del df
        gc.collect()
        
        # 訓練模型
        print("開始訓練 LSTM 模型...")
        model, scaler_X, scaler_y, metrics = train_lstm_model(train_data, test_data, feature_cols, seq_length)
        
        # 清理訓練數據
        del train_data, test_data
        gc.collect()
        
        if model is None or scaler_X is None or scaler_y is None:
            print("錯誤: 模型訓練失敗")
            sys.exit(1)
        
        # 保存模型（使用絕對路徑）
        print("保存模型文件...")
        try:
            model_path = os.path.join(models_dir, 'lstm_model.h5')
            model.save(model_path)
            print(f"模型已保存到 {model_path}")
        except Exception as save_error:
            print(f"保存模型時發生錯誤: {save_error}")
            traceback.print_exc()
            sys.exit(1)
        
        # 保存 scaler（需要序列化）
        try:
            scaler_X_path = os.path.join(models_dir, 'lstm_scaler_X.pkl')
            scaler_y_path = os.path.join(models_dir, 'lstm_scaler_y.pkl')
            with open(scaler_X_path, 'wb') as f:
                pickle.dump(scaler_X, f)
            print(f"Scaler X 已保存到 {scaler_X_path}")
            with open(scaler_y_path, 'wb') as f:
                pickle.dump(scaler_y, f)
            print(f"Scaler y 已保存到 {scaler_y_path}")
        except Exception as save_error:
            print(f"保存 scaler 時發生錯誤: {save_error}")
            traceback.print_exc()
            sys.exit(1)
        
        # 保存特徵列和參數
        try:
            features_path = os.path.join(models_dir, 'lstm_features.json')
            with open(features_path, 'w') as f:
                json.dump(feature_cols, f)
            print(f"特徵列表已保存到 {features_path}")
            
            params_path = os.path.join(models_dir, 'lstm_params.json')
            with open(params_path, 'w') as f:
                json.dump({
                    'seq_length': seq_length,
                    'feature_count': len(feature_cols)
                }, f)
            print(f"模型參數已保存到 {params_path}")
        except Exception as save_error:
            print(f"保存特徵和參數時發生錯誤: {save_error}")
            traceback.print_exc()
        
        # 保存指標
        try:
            metrics_path = os.path.join(models_dir, 'lstm_metrics.json')
            with open(metrics_path, 'w') as f:
                json.dump(metrics, f)
            print(f"模型指標已保存到 {metrics_path}")
        except Exception as save_error:
            print(f"保存指標時發生錯誤: {save_error}")
            traceback.print_exc()
        
        print("✅ LSTM 模型訓練完成！")
        
        # 清理資源
        if model is not None:
            try:
                K.clear_session()
            except:
                pass
            del model
        gc.collect()
        
    except Exception as e:
        print(f"錯誤: 訓練過程中發生異常: {e}")
        traceback.print_exc()
        # 清理資源
        if model is not None:
            try:
                K.clear_session()
            except:
                pass
            del model
        gc.collect()
        sys.exit(1)
    finally:
        # 確保在任何情況下都清理 TensorFlow 會話和內存
        try:
            K.clear_session()
        except:
            pass
        gc.collect()

if __name__ == '__main__':
    main()

