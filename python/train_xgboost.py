"""
XGBoost 模型訓練腳本 v3.0.98
根據 AI-AED-Algorithm-Specification.txt Section 6.1
新增: Optuna 超參數優化、特徵選擇優化（25特徵）、R² 指標
v3.0.81: 訓練前自動更新動態 factors（從 Railway Database）
v3.0.98: COVID 期間排除法取代 Sliding Window（基於實驗證據）
         - 使用全部 11 年數據 + 排除 COVID 期間 (2020-02 to 2022-06)
         - MAE 從 19.66 降至 16.52 (改善 16%)
         - 研究基礎: Gama et al. (2014), Tukey (1977)
"""
import sys
import io

# Fix Windows encoding for emoji/unicode output
if sys.platform == 'win32':
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except:
        pass

import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score as sklearn_r2_score
import json
import os
import datetime
import time
import subprocess
try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo
from feature_engineering import create_comprehensive_features, get_feature_columns

# 嘗試導入 Optuna（可選）
try:
    import optuna
    from optuna.samplers import TPESampler
    OPTUNA_AVAILABLE = True
except ImportError:
    OPTUNA_AVAILABLE = False
    print("ℹ️ Optuna 未安裝，將使用預設超參數")

# HKT 時區
HKT = ZoneInfo('Asia/Hong_Kong')

def update_dynamic_factors():
    """
    訓練前更新動態 factors（從 Railway Database）
    確保使用最新的真實數據
    """
    print("\n" + "=" * 80)
    print("STEP 0: Updating Dynamic Factors from Railway Database")
    print("=" * 80)
    
    try:
        script_path = os.path.join(os.path.dirname(__file__), 'calculate_dynamic_factors.py')
        result = subprocess.run(
            [sys.executable, script_path],
            capture_output=True,
            text=True,
            timeout=60
        )
        
        if result.returncode == 0:
            print(result.stdout)
            print("✅ Dynamic factors updated successfully")
            return True
        else:
            print(f"⚠️ Warning: Could not update dynamic factors")
            print(f"Error: {result.stderr}")
            print("Continuing with existing factors...")
            return False
    except Exception as e:
        print(f"⚠️ Warning: Error updating dynamic factors: {e}")
        print("Continuing with existing factors...")
        return False

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
        
        # 使用環境變數或 Railway 默認值
        password = os.getenv('PGPASSWORD') or os.getenv('DATABASE_PASSWORD') or 'nIdJPREHqkBdMgUifrazOsVlWbxsmDGq'
        host = os.getenv('PGHOST') or 'tramway.proxy.rlwy.net'
        port = int(os.getenv('PGPORT') or '45703')
        user = os.getenv('PGUSER') or 'postgres'
        database = os.getenv('PGDATABASE') or 'railway'
        
        print(f"   📡 連接資料庫: {host}:{port}/{database}")
        
        conn = psycopg2.connect(
            host=host,
            port=port,
            user=user,
            password=password,
            database=database,
            sslmode='require'
        )
        
        # 使用 SQLAlchemy 創建連接（直接使用已知的連接參數）
        from sqlalchemy import create_engine
        from urllib.parse import quote_plus
        # 使用 quote_plus 確保密碼中的特殊字符被正確編碼
        connection_string = f"postgresql://{user}:{quote_plus(password)}@{host}:{port}/{database}?sslmode=require"
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

def load_old_metrics_from_db():
    """從數據庫加載上次訓練的模型指標（用於比較）"""
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
        
        cursor = conn.cursor()
        cursor.execute("""
            SELECT mae, rmse, mape, training_date, data_count
            FROM model_metrics 
            WHERE model_name = 'xgboost'
            LIMIT 1
        """)
        
        row = cursor.fetchone()
        conn.close()
        
        if row and row[0] is not None:
            return {
                'mae': float(row[0]) if row[0] else None,
                'rmse': float(row[1]) if row[1] else None,
                'mape': float(row[2]) if row[2] else None,
                'training_date': str(row[3]) if row[3] else None,
                'data_count': int(row[4]) if row[4] else None
            }
        return None
    except Exception as e:
        print(f"⚠️ 無法從數據庫加載舊模型指標: {e}")
        return None

def optuna_optimize(X_train, y_train, X_val, y_val, n_trials=50):
    """
    使用 Optuna 進行超參數優化
    
    參數:
        X_train, y_train: 訓練數據
        X_val, y_val: 驗證數據
        n_trials: 優化試驗次數
    
    返回:
        最佳超參數字典
    """
    if not OPTUNA_AVAILABLE:
        print("⚠️ Optuna 未安裝，使用預設參數")
        return None
    
    print(f"\n{'='*60}")
    print("🔍 Optuna 超參數優化 (TPE Sampler)")
    print(f"{'='*60}")
    print(f"   試驗次數: {n_trials}")
    print(f"   訓練集大小: {len(X_train)}")
    print(f"   驗證集大小: {len(X_val)}")
    
    def objective(trial):
        params = {
            'n_estimators': trial.suggest_int('n_estimators', 200, 800),
            'max_depth': trial.suggest_int('max_depth', 4, 12),
            'learning_rate': trial.suggest_float('learning_rate', 0.01, 0.2, log=True),
            'min_child_weight': trial.suggest_int('min_child_weight', 1, 10),
            'subsample': trial.suggest_float('subsample', 0.6, 0.95),
            'colsample_bytree': trial.suggest_float('colsample_bytree', 0.6, 0.95),
            'colsample_bylevel': trial.suggest_float('colsample_bylevel', 0.6, 0.95),
            'gamma': trial.suggest_float('gamma', 0, 1.0),
            'alpha': trial.suggest_float('alpha', 0, 2.0),
            'reg_lambda': trial.suggest_float('reg_lambda', 0.5, 3.0),
        }
        
        model = xgb.XGBRegressor(
            **params,
            objective='reg:squarederror',
            tree_method='hist',
            random_state=42,
            n_jobs=-1,
            early_stopping_rounds=30,
            eval_metric='mae'
        )
        
        model.fit(
            X_train, y_train,
            eval_set=[(X_val, y_val)],
            verbose=False
        )
        
        y_pred = model.predict(X_val)
        mae = mean_absolute_error(y_val, y_pred)
        
        return mae
    
    # 創建 Optuna 研究
    sampler = TPESampler(seed=42)
    study = optuna.create_study(direction='minimize', sampler=sampler)
    
    # 靜音 Optuna 日誌
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    
    # 運行優化
    start_time = time.time()
    study.optimize(objective, n_trials=n_trials, show_progress_bar=True)
    opt_time = time.time() - start_time
    
    print(f"\n✅ 優化完成!")
    print(f"   ⏱️ 耗時: {opt_time:.1f} 秒")
    print(f"   🏆 最佳 MAE: {study.best_value:.2f}")
    print(f"\n   📋 最佳超參數:")
    for key, value in study.best_params.items():
        if isinstance(value, float):
            print(f"      {key}: {value:.4f}")
        else:
            print(f"      {key}: {value}")
    
    return study.best_params


def time_series_cross_validate(df, feature_cols, n_splits=3):
    """
    時間序列交叉驗證 (Walk-Forward Validation) - 優化版 v2.9.21
    
    確保模型在訓練期間永遠不會看到未來數據：
    - 每個 fold 只使用過去的數據進行訓練
    - 驗證集總是在訓練集之後的時間段
    - 最終測試集完全獨立，從未參與任何訓練過程
    
    優化：使用 3-fold 和 100 棵樹（而非 5-fold 和 300 棵樹）以加速訓練
    """
    print(f"\n{'='*60}")
    print("🔄 時間序列交叉驗證 (Walk-Forward Validation) - 快速模式")
    print(f"{'='*60}")
    print(f"⚠️ 重要：確保模型無法訪問未來數據！")
    print(f"📊 交叉驗證折數: {n_splits}")
    
    tscv = TimeSeriesSplit(n_splits=n_splits)
    
    cv_scores = {'mae': [], 'rmse': [], 'mape': []}
    
    # XGBoost 原生支持 NaN 處理，不需要填充
    X = df[feature_cols]
    y = df['Attendance']
    dates = df['Date'].values
    
    for fold, (train_idx, val_idx) in enumerate(tscv.split(X)):
        # 獲取訓練和驗證的日期範圍
        train_dates = dates[train_idx]
        val_dates = dates[val_idx]
        
        # 驗證：確保驗證集日期都在訓練集日期之後
        train_max = pd.to_datetime(train_dates).max()
        val_min = pd.to_datetime(val_dates).min()
        
        if val_min <= train_max:
            print(f"❌ Fold {fold+1}: 數據洩漏！驗證集包含訓練期間的數據")
            continue
        
        X_train_cv, X_val_cv = X.iloc[train_idx], X.iloc[val_idx]
        y_train_cv, y_val_cv = y.iloc[train_idx], y.iloc[val_idx]
        
        print(f"\n📂 Fold {fold+1}/{n_splits}:")
        print(f"   訓練集: {len(train_idx)} 筆 ({train_dates[0]} 至 {train_dates[-1]})")
        print(f"   驗證集: {len(val_idx)} 筆 ({val_dates[0]} 至 {val_dates[-1]})")
        print(f"   ✅ 時間順序驗證通過：驗證集開始日期 > 訓練集結束日期")
        
        # 創建模型 - 使用較少樹數加速 CV（v2.9.21 優化）
        model = xgb.XGBRegressor(
            n_estimators=100,  # 減少到 100 棵樹（原 300）
            max_depth=6,
            learning_rate=0.1,  # 提高學習率以補償較少樹數
            subsample=0.8,
            colsample_bytree=0.8,
            objective='reg:squarederror',
            alpha=1.0,
            reg_lambda=1.0,
            tree_method='hist',  # 使用 histogram 加速
            random_state=42,
            n_jobs=-1
        )
        
        model.fit(X_train_cv, y_train_cv, verbose=False)
        
        y_pred_cv = model.predict(X_val_cv)
        
        mae = mean_absolute_error(y_val_cv, y_pred_cv)
        rmse = np.sqrt(mean_squared_error(y_val_cv, y_pred_cv))
        mape = np.mean(np.abs((y_val_cv - y_pred_cv) / y_val_cv)) * 100
        
        cv_scores['mae'].append(mae)
        cv_scores['rmse'].append(rmse)
        cv_scores['mape'].append(mape)
        
        print(f"   📈 MAE: {mae:.2f}, RMSE: {rmse:.2f}, MAPE: {mape:.2f}%")
    
    # 計算平均分數
    avg_scores = {
        'cv_mae_mean': np.mean(cv_scores['mae']),
        'cv_mae_std': np.std(cv_scores['mae']),
        'cv_rmse_mean': np.mean(cv_scores['rmse']),
        'cv_rmse_std': np.std(cv_scores['rmse']),
        'cv_mape_mean': np.mean(cv_scores['mape']),
        'cv_mape_std': np.std(cv_scores['mape']),
    }
    
    print(f"\n{'='*60}")
    print("📊 交叉驗證結果總結:")
    print(f"{'='*60}")
    print(f"   MAE:  {avg_scores['cv_mae_mean']:.2f} ± {avg_scores['cv_mae_std']:.2f} 病人")
    print(f"   RMSE: {avg_scores['cv_rmse_mean']:.2f} ± {avg_scores['cv_rmse_std']:.2f} 病人")
    print(f"   MAPE: {avg_scores['cv_mape_mean']:.2f} ± {avg_scores['cv_mape_std']:.2f}%")
    
    return avg_scores


def train_xgboost_model(train_data, test_data, feature_cols, sample_weights=None):
    """
    訓練 XGBoost 模型（使用正確的時間序列驗證）
    
    關鍵：Early stopping 使用訓練集內的驗證集，而非測試集！
    這樣確保測試集在整個訓練過程中完全未被模型看到。
    
    參數:
        sample_weights: 樣本權重（用於時間衰減，近期數據權重更高）
    """
    print(f"\n{'='*60}")
    print("🚀 XGBoost 模型訓練開始")
    print(f"{'='*60}")
    print(f"\n📊 數據集統計:")
    print(f"   ├─ 訓練集: {len(train_data)} 筆")
    print(f"   └─ 測試集: {len(test_data)} 筆 (完全隔離)")
    print(f"   📐 特徵維度: {len(feature_cols)} 個")
    
    # 從訓練集中分出一部分作為 early stopping 驗證集
    # 使用訓練集的最後 15% 作為驗證集（保持時間順序）
    val_split_idx = int(len(train_data) * 0.85)
    train_subset = train_data[:val_split_idx].copy()
    val_subset = train_data[val_split_idx:].copy()
    
    # XGBoost 原生支持 NaN 處理，不需要填充
    X_train = train_subset[feature_cols]
    y_train = train_subset['Attendance']
    X_val = val_subset[feature_cols]
    y_val = val_subset['Attendance']
    X_test = test_data[feature_cols]
    y_test = test_data['Attendance']
    
    print(f"\n📅 時間序列數據分割:")
    print(f"   ├─ 訓練子集: {len(train_subset)} 筆")
    print(f"   │     日期: {train_subset['Date'].min()} → {train_subset['Date'].max()}")
    print(f"   ├─ 驗證子集: {len(val_subset)} 筆")
    print(f"   │     日期: {val_subset['Date'].min()} → {val_subset['Date'].max()}")
    print(f"   └─ 測試集:   {len(test_data)} 筆")
    print(f"         日期: {test_data['Date'].min()} → {test_data['Date'].max()}")
    
    # 驗證時間順序
    train_max_date = pd.to_datetime(train_subset['Date']).max()
    val_min_date = pd.to_datetime(val_subset['Date']).min()
    test_min_date = pd.to_datetime(test_data['Date']).min()
    val_max_date = pd.to_datetime(val_subset['Date']).max()
    
    print(f"\n🔒 數據洩漏檢查:")
    if val_min_date > train_max_date:
        print(f"   ✅ 驗證集日期 > 訓練集日期 (安全)")
    else:
        print(f"   ❌ 警告：驗證集可能包含訓練期間的數據！")
    
    if test_min_date > val_max_date:
        print(f"   ✅ 測試集日期 > 驗證集日期 (安全)")
    else:
        print(f"   ❌ 警告：測試集可能包含驗證期間的數據！")
    
    print(f"\n📈 目標變量 (Attendance) 統計:")
    print(f"   訓練集: {y_train.min():.0f} - {y_train.max():.0f} 人 (μ={y_train.mean():.1f}, σ={y_train.std():.1f})")
    print(f"   驗證集: {y_val.min():.0f} - {y_val.max():.0f} 人 (μ={y_val.mean():.1f}, σ={y_val.std():.1f})")
    print(f"   測試集: {y_test.min():.0f} - {y_test.max():.0f} 人 (μ={y_test.mean():.1f}, σ={y_test.std():.1f})")
    
    # 創建自定義 XGBoost 類以修復 _estimator_type 錯誤
    class XGBoostModel(xgb.XGBRegressor):
        _estimator_type = "regressor"
    
    # ============ 超參數優化 v2.9.30 ============
    # 使用 Optuna 自動搜索最佳超參數
    print(f"\n{'='*60}")
    print("⚙️ XGBoost 超參數配置 (v2.9.30 Optuna 優化)")
    print(f"{'='*60}")
    
    # 嘗試使用 Optuna 優化
    use_optuna = os.environ.get('USE_OPTUNA', '1') == '1' and OPTUNA_AVAILABLE
    n_trials = int(os.environ.get('OPTUNA_TRIALS', '30'))
    
    if use_optuna:
        best_params = optuna_optimize(X_train, y_train, X_val, y_val, n_trials=n_trials)
        if best_params:
            params = best_params
        else:
            # Fallback 到預設參數
            params = {
                'n_estimators': 500,
                'max_depth': 8,
                'learning_rate': 0.05,
                'min_child_weight': 3,
                'subsample': 0.85,
                'colsample_bytree': 0.85,
                'colsample_bylevel': 0.85,
                'gamma': 0.1,
                'alpha': 0.5,
                'reg_lambda': 1.5,
            }
    else:
        # 使用預設超參數（基於研究）
        print("   ℹ️ 使用預設超參數（設置 USE_OPTUNA=1 啟用優化）")
        params = {
            'n_estimators': 500,
            'max_depth': 8,
            'learning_rate': 0.05,
            'min_child_weight': 3,
            'subsample': 0.85,
            'colsample_bytree': 0.85,
            'colsample_bylevel': 0.85,
            'gamma': 0.1,
            'alpha': 0.5,
            'reg_lambda': 1.5,
        }
    
    print(f"\n   📋 最終超參數:")
    print(f"   🌲 n_estimators: {params.get('n_estimators', 500)}")
    print(f"   📏 max_depth: {params.get('max_depth', 8)}")
    print(f"   📉 learning_rate: {params.get('learning_rate', 0.05):.4f}")
    print(f"   👶 min_child_weight: {params.get('min_child_weight', 3)}")
    print(f"   🎲 subsample: {params.get('subsample', 0.85):.4f}")
    print(f"   🎯 colsample_bytree: {params.get('colsample_bytree', 0.85):.4f}")
    print(f"   📐 gamma: {params.get('gamma', 0.1):.4f}")
    print(f"   🔧 alpha (L1): {params.get('alpha', 0.5):.4f}")
    print(f"   🔧 reg_lambda (L2): {params.get('reg_lambda', 1.5):.4f}")
    print(f"   🎯 objective: reg:squarederror")
    print(f"   📊 eval_metric: mae")
    print(f"   ⏹️ early_stopping_rounds: 50")
    
    model = XGBoostModel(
        n_estimators=params.get('n_estimators', 500),
        max_depth=params.get('max_depth', 8),
        learning_rate=params.get('learning_rate', 0.05),
        min_child_weight=params.get('min_child_weight', 3),
        subsample=params.get('subsample', 0.85),
        colsample_bytree=params.get('colsample_bytree', 0.85),
        colsample_bylevel=params.get('colsample_bylevel', 0.85),
        gamma=params.get('gamma', 0.1),
        objective='reg:squarederror',
        alpha=params.get('alpha', 0.5),
        reg_lambda=params.get('reg_lambda', 1.5),
        tree_method='hist',
        grow_policy='depthwise',
        early_stopping_rounds=50,
        eval_metric='mae',
        random_state=42,
        n_jobs=-1
    )
    
    # ============ 樣本權重（時間衰減 + COVID 調整）============
    # 研究基礎: JMIR Medical Informatics 2025 - 近期數據更重要
    print(f"\n{'='*60}")
    print("⚖️ 計算樣本權重 (研究基礎: 時間衰減)")
    print(f"{'='*60}")
    
    def calculate_sample_weights(dates, target_values):
        """
        計算樣本權重:
        1. 時間衰減: 近期數據權重更高
        2. COVID 調整: 減少 COVID 異常期間的權重
        """
        weights = np.ones(len(dates))
        
        # 1. 時間衰減權重 (半衰期 = 365 天)
        max_date = dates.max()
        days_from_latest = (max_date - dates).dt.days
        half_life = 365  # 一年半衰期
        time_weights = np.exp(-0.693 * days_from_latest / half_life)
        weights *= time_weights
        
        # 2. COVID 期間權重調整 (2020-02 到 2022-06)
        covid_start = pd.Timestamp('2020-02-01')
        covid_end = pd.Timestamp('2022-06-30')
        is_covid = (dates >= covid_start) & (dates <= covid_end)
        weights[is_covid] *= 0.3  # COVID 期間權重降低到 30%
        
        # 3. 異常值權重調整
        mean_val = target_values.mean()
        std_val = target_values.std()
        z_scores = np.abs((target_values - mean_val) / std_val)
        outlier_mask = z_scores > 3
        weights[outlier_mask] *= 0.5  # 極端異常值權重降低
        
        # 歸一化
        weights = weights / weights.mean()
        
        return weights
    
    # 使用外部提供的權重或計算新權重
    if sample_weights is not None:
        print(f"   📊 使用外部提供的樣本權重 (命令行 --time-decay)")
        train_weights = sample_weights.values if hasattr(sample_weights, 'values') else sample_weights
        # 對應訓練子集
        train_subset_weights = train_weights[:len(train_subset)]
    else:
        train_weights = calculate_sample_weights(
            pd.to_datetime(train_data['Date']), 
            train_data['Attendance'].values
        )
        # 計算訓練子集的權重
        train_subset_weights = calculate_sample_weights(
            pd.to_datetime(train_subset['Date']), 
            train_subset['Attendance'].values
        )
    
    covid_count = ((pd.to_datetime(train_subset['Date']) >= '2020-02-01') & 
                   (pd.to_datetime(train_subset['Date']) <= '2022-06-30')).sum()
    print(f"   📊 COVID 期間樣本數: {covid_count}")
    print(f"   📊 權重範圍: {train_subset_weights.min():.3f} - {train_subset_weights.max():.3f}")
    print(f"   📊 平均權重: {train_subset_weights.mean():.3f}")
    
    print(f"\n{'='*60}")
    print("🔥 開始梯度提升訓練 (Gradient Boosting)")
    print(f"{'='*60}")
    print(f"   每 10 輪輸出一次訓練進度...")
    print(f"   Early stopping: 若 50 輪無改善則停止")
    print(f"   使用樣本權重: ✅ (時間衰減 + COVID 調整)")
    print(f"")
    import time
    
    # 使用驗證子集進行 early stopping
    print("   訓練中...")
    fit_start_time = time.time()
    
    try:
        # 使用樣本權重訓練（研究建議）
        model.fit(
            X_train, y_train,
            sample_weight=train_subset_weights,  # 時間衰減 + COVID 調整權重
            eval_set=[(X_val, y_val)],
            verbose=10
        )
    except TypeError as e:
        # 兼容性處理
        print(f"   ⚠️ XGBoost 版本兼容性調整: {e}")
        try:
            model.fit(
                X_train, y_train,
                sample_weight=train_subset_weights,
                eval_set=[(X_val, y_val)]
            )
        except:
            # 最後的 fallback - 不使用權重
            print(f"   ⚠️ 無法使用樣本權重，使用標準訓練")
            model.fit(
                X_train, y_train,
                eval_set=[(X_val, y_val)]
            )
    
    fit_time = time.time() - fit_start_time
    best_iter = model.best_iteration + 1 if hasattr(model, 'best_iteration') and model.best_iteration is not None else 300
    
    print(f"\n✅ 訓練完成!")
    print(f"   ⏱️ 總耗時: {fit_time:.2f} 秒")
    print(f"   🌲 最終樹數: {best_iter} 棵")
    if hasattr(model, 'best_score') and model.best_score is not None:
        print(f"   📊 最佳驗證 MAE: {model.best_score:.2f} 人")
    
    # 在完全未見過的測試集上評估
    print(f"\n📈 開始模型評估 (在完全未見過的測試集上)...")
    y_pred = model.predict(X_test)
    
    # 計算各種誤差指標
    mae = mean_absolute_error(y_test, y_pred)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))
    mape = np.mean(np.abs((y_test - y_pred) / y_test)) * 100
    
    # 計算其他統計指標
    mean_error = np.mean(y_pred - y_test)
    std_error = np.std(y_pred - y_test)
    r2 = sklearn_r2_score(y_test, y_pred)
    
    # 計算調整 R² (Adjusted R²)
    n = len(y_test)
    p = len(feature_cols)
    adj_r2 = 1 - (1 - r2) * (n - 1) / (n - p - 1) if n > p + 1 else r2
    
    print(f"\n{'='*60}")
    print(f"📊 XGBoost 模型性能指標 (測試集 - 完全獨立)")
    print(f"{'='*60}")
    print(f"  MAE (平均絕對誤差): {mae:.2f} 病人")
    print(f"  RMSE (均方根誤差): {rmse:.2f} 病人")
    print(f"  MAPE (平均絕對百分比誤差): {mape:.2f}%")
    print(f"  平均誤差 (偏差): {mean_error:.2f} 病人")
    print(f"  誤差標準差: {std_error:.2f} 病人")
    print(f"  R² 得分: {r2:.4f} ({r2*100:.1f}%)")
    print(f"  調整 R² 得分: {adj_r2:.4f} ({adj_r2*100:.1f}%)")
    print(f"  預測值範圍: {y_pred.min():.1f} - {y_pred.max():.1f} 病人")
    
    return model, {
        'mae': mae, 
        'rmse': rmse, 
        'mape': mape, 
        'r2': r2,
        'adj_r2': adj_r2,
        'mean_error': mean_error,
        'std_error': std_error,
        'optuna_optimized': use_optuna
    }

def main():
    import argparse
    import time
    
    print(f"\n{'='*60}")
    print("🏥 NDH AED XGBoost 模型訓練系統")
    print(f"{'='*60}")
    print(f"⏰ 開始時間: {datetime.datetime.now(HKT).strftime('%Y-%m-%d %H:%M:%S')} HKT")
    
    parser = argparse.ArgumentParser(description='Train XGBoost model')
    parser.add_argument('--csv', type=str, help='Path to CSV file with historical data')
    parser.add_argument('--full', action='store_true', help='Use full feature set (161 features) instead of optimized')
    parser.add_argument('--optimize', action='store_true', help='Run feature optimization before training')
    parser.add_argument('--quick-optimize', action='store_true', help='Run quick feature optimization')
    parser.add_argument('--sliding-window', type=int, default=0, help='Use only recent N years of data (0=all data)')
    parser.add_argument('--time-decay', type=float, default=0.0, help='Time decay rate for sample weights (0=no decay, 0.001=recommended)')
    args = parser.parse_args()
    
    # 動態加載優化特徵集（從 optimal_features.json）
    def load_optimal_features():
        """從 JSON 文件加載最佳特徵配置"""
        optimal_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models', 'optimal_features.json')
        if os.path.exists(optimal_path):
            try:
                with open(optimal_path, 'r') as f:
                    config = json.load(f)
                if 'optimal_features' in config:
                    print(f"   📂 從 optimal_features.json 加載 {len(config['optimal_features'])} 個特徵")
                    print(f"   📊 上次優化: {config.get('updated', 'N/A')}")
                    print(f"   📈 預期 MAE: {config.get('metrics', {}).get('mae', 'N/A')}")
                    return config['optimal_features']
            except Exception as e:
                print(f"   ⚠️ 無法加載 optimal_features.json: {e}")
        return None
    
    # 默認優化特徵集（備用）
    DEFAULT_OPTIMAL_FEATURES = [
        "Attendance_EWMA7",        # 核心特徵
        "Attendance_EWMA14",
        "Daily_Change",
        "Monthly_Change",
        "Attendance_Lag1",
        "Weekly_Change",
        "Attendance_Rolling7",
        "Attendance_Position7",
        "Attendance_Lag30",
        "Attendance_Lag7",
        "Day_of_Week",
        "Lag1_Diff",
        "DayOfWeek_sin",
        "Attendance_Rolling14",
        "Attendance_Position14",
        "Attendance_Position30",
        "Attendance_Rolling3",
        "Attendance_Min7",
        "Attendance_Median14",
        "DayOfWeek_Target_Mean",
        "Attendance_Median3",
        "Attendance_EWMA30",
        "Is_Winter_Flu_Season",
        "Is_Weekend",
        "Holiday_Factor",
    ]
    
    # 如果請求優化，先運行特徵優化器
    if args.optimize or args.quick_optimize:
        print("\n" + "=" * 60)
        print("🔬 運行自動特徵優化器...")
        print("=" * 60)
        try:
            from auto_feature_optimizer import run_optimization
            run_optimization(quick=args.quick_optimize)
            print("\n" + "=" * 60)
            print("✅ 特徵優化完成，繼續訓練...")
            print("=" * 60)
        except ImportError:
            print("⚠️ 無法導入 auto_feature_optimizer，使用默認特徵集")
        except Exception as e:
            print(f"⚠️ 優化過程出錯: {e}")
    
    # 加載最佳特徵
    OPTIMAL_FEATURES = load_optimal_features() or DEFAULT_OPTIMAL_FEATURES
    
    # 創建模型目錄（相對於當前腳本目錄）
    script_dir = os.path.dirname(os.path.abspath(__file__))
    models_dir = os.path.join(script_dir, 'models')
    os.makedirs(models_dir, exist_ok=True)
    print(f"📁 模型目錄: {models_dir}")
    
    # ============ 階段 1: 數據加載 ============
    print(f"\n{'='*60}")
    print("📥 階段 1/4: 數據加載")
    print(f"{'='*60}")
    
    df = None
    data_source = None
    load_start = time.time()
    
    # 優先使用命令行指定的 CSV 文件
    if args.csv and os.path.exists(args.csv):
        print(f"   📄 嘗試從命令行 CSV 加載: {args.csv}")
        df = load_data_from_csv(args.csv)
        if df is not None and len(df) > 0:
            data_source = f"CSV: {args.csv}"
    
    # 如果沒有指定 CSV，嘗試從數據庫加載數據
    if df is None or len(df) == 0:
        print(f"   🗄️ 嘗試從 PostgreSQL 數據庫加載...")
        df = load_data_from_db()
        if df is not None and len(df) > 0:
            data_source = "PostgreSQL 數據庫"
    
    # 如果數據庫不可用，嘗試從默認 CSV 加載
    if df is None or len(df) == 0:
        print(f"   📄 嘗試從本地 CSV 文件加載...")
        csv_paths = [
            '../NDH_AED_Clean.csv',
            'NDH_AED_Clean.csv',
            '../NDH_AED_Attendance_2025-12-01_to_2025-12-21.csv',
            'NDH_AED_Attendance_2025-12-01_to_2025-12-21.csv',
        ]
        for csv_path in csv_paths:
            if os.path.exists(csv_path):
                print(f"      嘗試: {csv_path}")
                df = load_data_from_csv(csv_path)
                if df is not None and len(df) > 0:
                    data_source = f"CSV: {csv_path}"
                    break
    
    if df is None or len(df) == 0:
        print("❌ 錯誤: 無法加載數據")
        sys.exit(1)
    
    load_time = time.time() - load_start
    print(f"\n✅ 數據加載完成!")
    print(f"   📊 數據來源: {data_source}")
    print(f"   📏 總記錄數: {len(df)} 筆")
    print(f"   📅 日期範圍: {df['Date'].min()} → {df['Date'].max()}")
    print(f"   ⏱️ 加載耗時: {load_time:.2f} 秒")
    
    # ============ 階段 2: AI 因子加載 ============
    print(f"\n{'='*60}")
    print("🤖 階段 2/4: AI 因子加載")
    print(f"{'='*60}")
    
    ai_factors = df.attrs.get('ai_factors', {}) if hasattr(df, 'attrs') else {}
    
    # 如果沒有從數據庫獲取 AI 因子，嘗試從本地 JSON 文件加載
    if not ai_factors:
        ai_factors_path = os.path.join(models_dir, 'ai_factors.json')
        print(f"   📄 嘗試從本地加載: {ai_factors_path}")
        if os.path.exists(ai_factors_path):
            try:
                with open(ai_factors_path, 'r', encoding='utf-8') as f:
                    ai_factors = json.load(f)
                print(f"   ✅ 從本地文件加載了 {len(ai_factors)} 個日期的 AI 因子")
            except Exception as e:
                print(f"   ⚠️ 無法從本地文件加載: {e}")
    
    if ai_factors:
        print(f"\n✅ AI 因子統計:")
        print(f"   📊 覆蓋日期數: {len(ai_factors)} 天")
        # 計算 AI 因子的統計
        factors_values = []
        for date_key, factor_data in ai_factors.items():
            if isinstance(factor_data, dict) and 'impact_factor' in factor_data:
                factors_values.append(factor_data['impact_factor'])
        if factors_values:
            print(f"   📈 影響因子範圍: {min(factors_values):.3f} - {max(factors_values):.3f}")
            print(f"   📊 影響因子平均: {np.mean(factors_values):.3f}")
    else:
        print(f"   ℹ️ 沒有找到 AI 因子數據，將使用默認值 (1.0)")
    
    # ============ 階段 3: 特徵工程 ============
    print(f"\n{'='*60}")
    print("🔧 階段 3/4: 特徵工程")
    print(f"{'='*60}")
    
    fe_start = time.time()
    print(f"   原始數據列數: {len(df.columns)}")
    print(f"\n   正在創建特徵...")
    print(f"   ├─ 時間特徵: 年、月、日、星期、季度...")
    print(f"   ├─ 循環編碼: sin/cos 變換（捕捉周期性）...")
    print(f"   ├─ 滯後特徵: Lag1, Lag7, Lag14, Lag30, Lag365...")
    print(f"   ├─ 滾動統計: 7天/14天/30天 均值、標準差...")
    print(f"   ├─ 假期特徵: 香港公眾假期（含農曆節日）...")
    print(f"   ├─ 事件特徵: COVID期間、流感季節...")
    print(f"   └─ AI因子特徵: 13維度影響因子...")
    
    df = create_comprehensive_features(df, ai_factors_dict=ai_factors if ai_factors else None)
    
    fe_time = time.time() - fe_start
    print(f"\n✅ 特徵工程完成!")
    print(f"   📐 最終特徵數: {len(df.columns)} 列")
    print(f"   ⏱️ 處理耗時: {fe_time:.2f} 秒")
    
    # 移除包含 NaN 的行（除了我們已經填充的列）
    original_len = len(df)
    df = df.dropna(subset=['Attendance'])
    if len(df) < original_len:
        print(f"   ⚠️ 移除了 {original_len - len(df)} 筆無效數據")
    
    # ============ COVID 期間排除 (基於實驗證據) ============
    # 研究結果: COVID 排除法優於 Sliding Window (MAE 16.52 vs 19.66, 改善 16%)
    # 參考: experiment_covid_exclusion_comparison.py 實驗結果
    # 排除期間: 2020-02-01 至 2022-06-30 (WHO 宣布 COVID 大流行至香港放寬限制)
    use_covid_exclusion = os.environ.get('USE_COVID_EXCLUSION', '1') == '1'
    covid_start = pd.Timestamp('2020-02-01')
    covid_end = pd.Timestamp('2022-06-30')
    
    if use_covid_exclusion:
        original_len = len(df)
        covid_mask = (df['Date'] >= covid_start) & (df['Date'] <= covid_end)
        covid_count = covid_mask.sum()
        df = df[~covid_mask].copy()
        print(f"\n🦠 COVID 期間排除模式 (研究基礎: 實驗證據):")
        print(f"   ├─ 排除期間: {covid_start.strftime('%Y-%m-%d')} 至 {covid_end.strftime('%Y-%m-%d')}")
        print(f"   ├─ 排除筆數: {covid_count} 筆 COVID 期間數據")
        print(f"   ├─ 數據量: {original_len} → {len(df)} 筆")
        print(f"   └─ 研究結果: MAE 16.52 (vs Sliding Window 3yr: 19.66, 改善 16%)")
    
    # ============ 滑動窗口過濾 (備用選項) ============
    # 注意: 實驗證明 COVID 排除法優於 Sliding Window
    sliding_window_years = args.sliding_window or int(os.environ.get('SLIDING_WINDOW_YEARS', '0'))
    if sliding_window_years > 0 and not use_covid_exclusion:
        cutoff_date = df['Date'].max() - pd.Timedelta(days=sliding_window_years * 365)
        original_len = len(df)
        df = df[df['Date'] >= cutoff_date].copy()
        print(f"\n📅 滑動窗口訓練模式 (備用):")
        print(f"   ├─ 窗口大小: 最近 {sliding_window_years} 年")
        print(f"   ├─ 截止日期: {cutoff_date.strftime('%Y-%m-%d')}")
        print(f"   ├─ 數據量: {original_len} → {len(df)} 筆 (-{original_len - len(df)} 筆舊數據)")
        print(f"   └─ ⚠️ 建議使用 COVID 排除法 (設置 USE_COVID_EXCLUSION=1)")
    
    # ============ 數據分割 ============
    print(f"\n✂️ 時間序列分割 (80/20):")
    split_idx = int(len(df) * 0.8)
    train_data = df[:split_idx].copy()
    test_data = df[split_idx:].copy()
    
    # ============ 時間衰減權重 (解決 Concept Drift) ============
    time_decay_rate = args.time_decay or float(os.environ.get('TIME_DECAY_RATE', '0'))
    sample_weights = None
    if time_decay_rate > 0:
        days_from_end = (train_data['Date'].max() - train_data['Date']).dt.days
        sample_weights = np.exp(-time_decay_rate * days_from_end)
        sample_weights = sample_weights / sample_weights.mean()  # 歸一化
        print(f"\n⚖️ 時間衰減權重模式:")
        print(f"   ├─ 衰減率: {time_decay_rate}")
        print(f"   ├─ 最新數據權重: {sample_weights.iloc[-1]:.2f}")
        print(f"   └─ 最舊數據權重: {sample_weights.iloc[0]:.2f}")
    
    print(f"   ├─ 訓練集: {len(train_data)} 筆")
    print(f"   │     日期: {train_data['Date'].min()} → {train_data['Date'].max()}")
    print(f"   └─ 測試集: {len(test_data)} 筆")
    print(f"         日期: {test_data['Date'].min()} → {test_data['Date'].max()}")
    
    # 獲取特徵列 - 默認使用優化特徵集（研究表明 25 特徵效果最佳）
    use_full = args.full or os.environ.get('USE_FULL_FEATURES', '0') == '1'
    
    if use_full:
        print(f"\n   📊 使用完整特徵集模式（161 特徵）")
        feature_cols = get_feature_columns()
        original_feature_count = len(feature_cols)
        feature_cols = [col for col in feature_cols if col in df.columns]
        if len(feature_cols) < original_feature_count:
            print(f"   ⚠️ {original_feature_count - len(feature_cols)} 個預期特徵不存在")
        print(f"   📐 使用 {len(feature_cols)} 個特徵進行訓練")
    else:
        print(f"\n   🚀 使用優化特徵集（研究表明 25 特徵效果最佳）")
        print(f"   📊 核心特徵: EWMA7+EWMA14 佔 90% 重要性")
        feature_cols = [col for col in OPTIMAL_FEATURES if col in df.columns]
        print(f"   📐 使用 {len(feature_cols)} 個精選特徵進行訓練")
    
    # ============ 階段 4: 模型訓練 ============
    print(f"\n{'='*60}")
    print("🎯 階段 4/4: 模型訓練與評估")
    print(f"{'='*60}")
    
    # 時間序列交叉驗證（確保無數據洩漏）- v2.9.21 優化為 3-fold
    cv_scores = time_series_cross_validate(train_data, feature_cols, n_splits=3)
    
    # 訓練最終模型
    model, metrics = train_xgboost_model(train_data, test_data, feature_cols, sample_weights=sample_weights)
    
    # 保存模型（使用絕對路徑）
    script_dir = os.path.dirname(os.path.abspath(__file__))
    models_dir = os.path.join(script_dir, 'models')
    
    # 定義指標文件路徑（用於保存新指標）
    metrics_path = os.path.join(models_dir, 'xgboost_metrics.json')
    
    # 加載舊模型指標（用於比較）- 優先從數據庫讀取
    old_metrics = load_old_metrics_from_db()
    if old_metrics:
        print(f"📊 從數據庫加載舊模型指標: MAE={old_metrics.get('mae', 'N/A'):.2f}, MAPE={old_metrics.get('mape', 'N/A'):.2f}%")
    else:
        # 數據庫不可用，嘗試從本地文件讀取
        if os.path.exists(metrics_path):
            try:
                with open(metrics_path, 'r') as f:
                    old_metrics = json.load(f)
                print(f"📊 從本地文件加載舊模型指標: MAE={old_metrics.get('mae', 'N/A'):.2f}")
            except:
                old_metrics = None
    
    model_path = os.path.join(models_dir, 'xgboost_model.json')
    model.save_model(model_path)
    print(f"模型已保存到 {model_path}")
    
    # 保存特徵列名
    features_path = os.path.join(models_dir, 'xgboost_features.json')
    with open(features_path, 'w') as f:
        json.dump(feature_cols, f)
    
    # 添加更多訓練信息到指標
    training_info = {
        'mae': metrics['mae'],
        'rmse': metrics['rmse'],
        'mape': metrics['mape'],
        'r2': metrics['r2'],              # R² 分數 (v2.9.30)
        'adj_r2': metrics['adj_r2'],      # 調整 R² (v2.9.30)
        'mean_error': metrics['mean_error'],
        'std_error': metrics['std_error'],
        'training_date': datetime.datetime.now(HKT).strftime('%Y-%m-%d %H:%M:%S HKT'),
        'data_count': len(df),
        'train_count': len(train_data),
        'test_count': len(test_data),
        'feature_count': len(feature_cols),
        'ai_factors_count': len(ai_factors) if ai_factors else 0,
        # 交叉驗證分數（確保無未來數據洩漏）
        'cv_mae_mean': cv_scores['cv_mae_mean'],
        'cv_mae_std': cv_scores['cv_mae_std'],
        'cv_rmse_mean': cv_scores['cv_rmse_mean'],
        'cv_rmse_std': cv_scores['cv_rmse_std'],
        'cv_mape_mean': cv_scores['cv_mape_mean'],
        'cv_mape_std': cv_scores['cv_mape_std'],
        'time_series_validation': True,  # 標記使用了正確的時間序列驗證
        'version': '2.9.52',
        'optuna_optimized': metrics.get('optuna_optimized', False)
    }
    
    # 保存評估指標
    with open(metrics_path, 'w') as f:
        json.dump(training_info, f, indent=2)
    
    # 計算特徵重要性
    print(f"\n{'='*60}")
    print("📊 特徵重要性分析 (Top 15 最重要特徵):")
    print(f"{'='*60}")
    
    importance = model.feature_importances_
    feature_importance = list(zip(feature_cols, importance))
    feature_importance.sort(key=lambda x: x[1], reverse=True)
    
    for i, (feat, imp) in enumerate(feature_importance[:15]):
        bar_length = int(imp / max(importance) * 30)
        bar = "█" * bar_length + "░" * (30 - bar_length)
        print(f"  {i+1:2}. {feat:25} {bar} {imp:.4f}")
    
    # 顯示訓練前後對比
    print(f"\n{'='*60}")
    print("📈 模型性能變化:")
    print(f"{'='*60}")
    
    if old_metrics:
        old_mae = old_metrics.get('mae', 0)
        old_rmse = old_metrics.get('rmse', 0)
        old_mape = old_metrics.get('mape', 0)
        
        mae_change = metrics['mae'] - old_mae
        rmse_change = metrics['rmse'] - old_rmse
        mape_change = metrics['mape'] - old_mape
        
        # 使用容差判斷，避免浮點數精度問題（顯示為 0.00 時應為無變化）
        tolerance = 0.005
        def get_change_icon(change, tol=tolerance):
            if abs(change) < tol:
                return "➡️ 無變化"
            return "✅ 改善" if change < 0 else "⚠️ 下降"
        
        mae_icon = get_change_icon(mae_change)
        rmse_icon = get_change_icon(rmse_change)
        mape_icon = get_change_icon(mape_change)
        
        print(f"\n  📊 MAE (平均絕對誤差):")
        print(f"     舊模型: {old_mae:.2f} 病人")
        print(f"     新模型: {metrics['mae']:.2f} 病人")
        print(f"     變化: {mae_change:+.2f} 病人 {mae_icon}")
        
        print(f"\n  📊 RMSE (均方根誤差):")
        print(f"     舊模型: {old_rmse:.2f} 病人")
        print(f"     新模型: {metrics['rmse']:.2f} 病人")
        print(f"     變化: {rmse_change:+.2f} 病人 {rmse_icon}")
        
        print(f"\n  📊 MAPE (平均絕對百分比誤差):")
        print(f"     舊模型: {old_mape:.2f}%")
        print(f"     新模型: {metrics['mape']:.2f}%")
        print(f"     變化: {mape_change:+.2f}% {mape_icon}")
        
        # 計算總體改善（使用相同容差）
        improvements = sum([1 for c in [mae_change, rmse_change, mape_change] if c < -tolerance])
        degradations = sum([1 for c in [mae_change, rmse_change, mape_change] if c > tolerance])
        
        print(f"\n  📋 總結:")
        if improvements > degradations:
            print(f"     🎉 模型整體性能提升！({improvements}/3 指標改善)")
        elif degradations > improvements:
            print(f"     ⚠️ 模型整體性能下降 ({degradations}/3 指標下降)")
            print(f"     💡 建議：檢查新數據質量或增加訓練數據")
        else:
            print(f"     ➡️ 模型性能維持穩定")
    else:
        print(f"\n  ℹ️ 這是首次訓練，無舊模型可比較")
        print(f"\n  📊 當前模型性能:")
        print(f"     MAE: {metrics['mae']:.2f} 病人")
        print(f"     RMSE: {metrics['rmse']:.2f} 病人")
        print(f"     MAPE: {metrics['mape']:.2f}%")
    
    # 訓練總結
    total_time = time.time() - load_start + fe_time
    print(f"\n{'='*60}")
    print("🏆 訓練完成總結")
    print(f"{'='*60}")
    print(f"")
    print(f"   📅 訓練時間: {training_info['training_date']}")
    print(f"   ⏱️ 總耗時: {total_time:.1f} 秒")
    print(f"")
    print(f"   📊 數據統計:")
    print(f"      ├─ 總數據量: {training_info['data_count']} 筆")
    print(f"      ├─ 訓練集: {training_info['train_count']} 筆")
    print(f"      └─ 測試集: {training_info['test_count']} 筆")
    print(f"")
    print(f"   🔧 模型配置:")
    print(f"      ├─ 特徵數: {training_info['feature_count']} 個")
    if training_info['ai_factors_count'] > 0:
        print(f"      └─ AI因子: {training_info['ai_factors_count']} 個日期")
    else:
        print(f"      └─ AI因子: 無")
    print(f"")
    print(f"   📈 模型性能 (測試集):")
    print(f"      ├─ MAE: {metrics['mae']:.2f} 人 (平均誤差)")
    print(f"      ├─ RMSE: {metrics['rmse']:.2f} 人 (均方根誤差)")
    print(f"      ├─ MAPE: {metrics['mape']:.2f}% (百分比誤差)")
    print(f"      ├─ R²: {metrics['r2']*100:.1f}% (模型擬合度)")
    print(f"      └─ 調整 R²: {metrics['adj_r2']*100:.1f}% (考慮特徵數)")
    print(f"")
    print(f"   📊 交叉驗證 (5-Fold):")
    print(f"      └─ MAE: {cv_scores['cv_mae_mean']:.2f} ± {cv_scores['cv_mae_std']:.2f} 人")
    print(f"")
    print(f"{'='*60}")
    print(f"✅ XGBoost 模型訓練完成！模型已保存。")
    print(f"{'='*60}")
    
    # v3.0.10: 訓練後自動更新特徵文檔
    try:
        from update_feature_docs import update_docs
        print(f"\n📝 更新特徵文檔...")
        update_docs()
        print(f"✅ 特徵文檔已更新")
    except Exception as e:
        print(f"⚠️ 更新特徵文檔失敗: {e}")

if __name__ == '__main__':
    main()

