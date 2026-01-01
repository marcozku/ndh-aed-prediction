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

def time_series_cross_validate(df, feature_cols, n_splits=5):
    """
    時間序列交叉驗證 (Walk-Forward Validation)
    
    確保模型在訓練期間永遠不會看到未來數據：
    - 每個 fold 只使用過去的數據進行訓練
    - 驗證集總是在訓練集之後的時間段
    - 最終測試集完全獨立，從未參與任何訓練過程
    """
    print(f"\n{'='*60}")
    print("🔄 時間序列交叉驗證 (Walk-Forward Validation)")
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
        
        # 創建模型（不使用 early stopping 以避免需要額外驗證集）
        model = xgb.XGBRegressor(
            n_estimators=300,
            max_depth=6,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.8,
            objective='reg:squarederror',
            alpha=1.0,
            reg_lambda=1.0,
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


def train_xgboost_model(train_data, test_data, feature_cols):
    """
    訓練 XGBoost 模型（使用正確的時間序列驗證）
    
    關鍵：Early stopping 使用訓練集內的驗證集，而非測試集！
    這樣確保測試集在整個訓練過程中完全未被模型看到。
    """
    print(f"\n📊 開始訓練 XGBoost 模型...")
    print(f"訓練集大小: {len(train_data)} 筆")
    print(f"測試集大小: {len(test_data)} 筆 (完全隔離，未參與訓練)")
    print(f"特徵數量: {len(feature_cols)} 個")
    
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
    
    print(f"\n⚠️ 時間序列數據分割驗證:")
    print(f"   訓練子集: {len(train_subset)} 筆 ({train_subset['Date'].min()} 至 {train_subset['Date'].max()})")
    print(f"   驗證子集: {len(val_subset)} 筆 ({val_subset['Date'].min()} 至 {val_subset['Date'].max()})")
    print(f"   測試集:   {len(test_data)} 筆 ({test_data['Date'].min()} 至 {test_data['Date'].max()})")
    
    # 驗證時間順序
    train_max_date = pd.to_datetime(train_subset['Date']).max()
    val_min_date = pd.to_datetime(val_subset['Date']).min()
    test_min_date = pd.to_datetime(test_data['Date']).min()
    val_max_date = pd.to_datetime(val_subset['Date']).max()
    
    if val_min_date > train_max_date:
        print(f"   ✅ 驗證集日期 > 訓練集日期 (無數據洩漏)")
    else:
        print(f"   ❌ 警告：驗證集可能包含訓練期間的數據！")
    
    if test_min_date > val_max_date:
        print(f"   ✅ 測試集日期 > 驗證集日期 (無數據洩漏)")
    else:
        print(f"   ❌ 警告：測試集可能包含驗證期間的數據！")
    
    print(f"\n訓練集目標值範圍: {y_train.min():.1f} - {y_train.max():.1f} 病人 (平均: {y_train.mean():.1f})")
    print(f"驗證集目標值範圍: {y_val.min():.1f} - {y_val.max():.1f} 病人 (平均: {y_val.mean():.1f})")
    print(f"測試集目標值範圍: {y_test.min():.1f} - {y_test.max():.1f} 病人 (平均: {y_test.mean():.1f})")
    
    # 創建自定義 XGBoost 類以修復 _estimator_type 錯誤
    class XGBoostModel(xgb.XGBRegressor):
        _estimator_type = "regressor"
    
    # 根據算法規格文件配置
    print(f"\n🔧 模型參數配置:")
    print(f"  n_estimators (樹的數量): 500")
    print(f"  max_depth (最大深度): 6")
    print(f"  learning_rate (學習率): 0.05")
    print(f"  subsample (樣本採樣率): 0.8")
    print(f"  colsample_bytree (特徵採樣率): 0.8")
    print(f"  colsample_bylevel (層級特徵採樣率): 0.8")
    print(f"  objective (目標函數): reg:squarederror (均方誤差)")
    print(f"  alpha (L1 正則化): 1.0")
    print(f"  reg_lambda (L2 正則化): 1.0")
    print(f"  tree_method (樹構建方法): hist (直方圖)")
    print(f"  grow_policy (生長策略): depthwise (深度優先)")
    print(f"  early_stopping_rounds (早停輪數): 50")
    print(f"  eval_metric (評估指標): mae (平均絕對誤差)")
    print(f"  random_state (隨機種子): 42")
    
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
    
    print(f"\n🚀 開始模型訓練 (梯度提升過程)...")
    print(f"⚠️ Early stopping 使用訓練集內的驗證子集，非測試集！")
    import time
    fit_start = time.time()
    
    # 使用驗證子集進行 early stopping，而非測試集
    model.fit(
        X_train, y_train,
        eval_set=[(X_val, y_val)],  # 使用訓練集內的驗證子集
        verbose=False
    )
    
    fit_time = time.time() - fit_start
    print(f"訓練完成，耗時: {fit_time:.2f} 秒")
    print(f"實際訓練輪數: {model.best_iteration + 1 if hasattr(model, 'best_iteration') else model.n_estimators} 輪")
    
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
    r2_score = 1 - (np.sum((y_test - y_pred) ** 2) / np.sum((y_test - np.mean(y_test)) ** 2))
    
    print(f"\nXGBoost 模型性能指標 (測試集 - 完全獨立):")
    print(f"  MAE (平均絕對誤差): {mae:.2f} 病人")
    print(f"  RMSE (均方根誤差): {rmse:.2f} 病人")
    print(f"  MAPE (平均絕對百分比誤差): {mape:.2f}%")
    print(f"  平均誤差: {mean_error:.2f} 病人")
    print(f"  誤差標準差: {std_error:.2f} 病人")
    print(f"  R² 得分: {r2_score:.4f}")
    print(f"  預測值範圍: {y_pred.min():.1f} - {y_pred.max():.1f} 病人")
    
    return model, {'mae': mae, 'rmse': rmse, 'mape': mape}

def main():
    import argparse
    parser = argparse.ArgumentParser(description='Train XGBoost model')
    parser.add_argument('--csv', type=str, help='Path to CSV file with historical data')
    args = parser.parse_args()
    
    # 創建模型目錄（相對於當前腳本目錄）
    script_dir = os.path.dirname(os.path.abspath(__file__))
    models_dir = os.path.join(script_dir, 'models')
    os.makedirs(models_dir, exist_ok=True)
    print(f"模型目錄: {models_dir}")
    
    df = None
    
    # 優先使用命令行指定的 CSV 文件
    if args.csv and os.path.exists(args.csv):
        print(f"從命令行指定的 CSV 加載數據: {args.csv}")
        df = load_data_from_csv(args.csv)
    
    # 如果沒有指定 CSV，嘗試從數據庫加載數據
    if df is None or len(df) == 0:
        df = load_data_from_db()
    
    # 如果數據庫不可用，嘗試從默認 CSV 加載
    if df is None or len(df) == 0:
        csv_paths = [
            '../NDH_AED_Clean.csv',
            'NDH_AED_Clean.csv',
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
    
    # 如果沒有從數據庫獲取 AI 因子，嘗試從本地 JSON 文件加載
    if not ai_factors:
        ai_factors_path = os.path.join(models_dir, 'ai_factors.json')
        if os.path.exists(ai_factors_path):
            try:
                with open(ai_factors_path, 'r', encoding='utf-8') as f:
                    ai_factors = json.load(f)
                print(f"✅ 從本地文件加載了 {len(ai_factors)} 個日期的 AI 因子數據")
            except Exception as e:
                print(f"⚠️ 無法從本地文件加載 AI 因子: {e}")
    
    if ai_factors:
        print(f"✅ 加載了 {len(ai_factors)} 個日期的 AI 因子數據")
    else:
        print(f"ℹ️ 沒有找到 AI 因子數據，將使用默認值")
    
    # 創建特徵（包含 AI 因子）
    print(f"\n🔨 開始特徵工程 (Feature Engineering)...")
    print(f"原始數據列數: {len(df.columns)}")
    df = create_comprehensive_features(df, ai_factors_dict=ai_factors if ai_factors else None)
    print(f"特徵工程後列數: {len(df.columns)}")
    
    # 移除包含 NaN 的行（除了我們已經填充的列）
    original_len = len(df)
    df = df.dropna(subset=['Attendance'])
    if len(df) < original_len:
        print(f"移除了 {original_len - len(df)} 筆包含 NaN 的數據")
    
    # 時間序列分割（不能隨機分割！）
    print(f"\n✂️ 數據分割 (Time Series Split)...")
    split_idx = int(len(df) * 0.8)
    print(f"分割點索引: {split_idx} (80% 訓練, 20% 測試)")
    train_data = df[:split_idx].copy()
    test_data = df[split_idx:].copy()
    
    print(f"訓練集: {len(train_data)} 筆 (日期範圍: {train_data['Date'].min()} 至 {train_data['Date'].max()})")
    print(f"測試集: {len(test_data)} 筆 (日期範圍: {test_data['Date'].min()} 至 {test_data['Date'].max()})")
    
    # 獲取特徵列
    feature_cols = get_feature_columns()
    # 只保留實際存在的列
    original_feature_count = len(feature_cols)
    feature_cols = [col for col in feature_cols if col in df.columns]
    if len(feature_cols) < original_feature_count:
        print(f"⚠️ 警告: {original_feature_count - len(feature_cols)} 個預期特徵在數據中不存在")
    
    print(f"使用 {len(feature_cols)} 個特徵進行訓練")
    
    # 時間序列交叉驗證（確保無數據洩漏）
    cv_scores = time_series_cross_validate(train_data, feature_cols, n_splits=5)
    
    # 訓練最終模型
    model, metrics = train_xgboost_model(train_data, test_data, feature_cols)
    
    # 保存模型（使用絕對路徑）
    script_dir = os.path.dirname(os.path.abspath(__file__))
    models_dir = os.path.join(script_dir, 'models')
    
    # 加載舊模型指標（用於比較）
    metrics_path = os.path.join(models_dir, 'xgboost_metrics.json')
    old_metrics = None
    if os.path.exists(metrics_path):
        try:
            with open(metrics_path, 'r') as f:
                old_metrics = json.load(f)
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
    import datetime
    training_info = {
        'mae': metrics['mae'],
        'rmse': metrics['rmse'],
        'mape': metrics['mape'],
        'training_date': datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
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
        'time_series_validation': True  # 標記使用了正確的時間序列驗證
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
        
        mae_icon = "✅ 改善" if mae_change < 0 else ("⚠️ 下降" if mae_change > 0 else "➡️ 無變化")
        rmse_icon = "✅ 改善" if rmse_change < 0 else ("⚠️ 下降" if rmse_change > 0 else "➡️ 無變化")
        mape_icon = "✅ 改善" if mape_change < 0 else ("⚠️ 下降" if mape_change > 0 else "➡️ 無變化")
        
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
        
        # 計算總體改善
        improvements = sum([1 for c in [mae_change, rmse_change, mape_change] if c < 0])
        degradations = sum([1 for c in [mae_change, rmse_change, mape_change] if c > 0])
        
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
    print(f"\n{'='*60}")
    print("🎯 訓練總結:")
    print(f"{'='*60}")
    print(f"  📅 訓練時間: {training_info['training_date']}")
    print(f"  📊 數據量: {training_info['data_count']} 筆")
    print(f"  🔧 特徵數: {training_info['feature_count']} 個")
    if training_info['ai_factors_count'] > 0:
        print(f"  🤖 AI因子: {training_info['ai_factors_count']} 個日期")
    print(f"  📈 MAE: {metrics['mae']:.2f} 病人")
    print(f"  📈 RMSE: {metrics['rmse']:.2f} 病人")
    print(f"  📈 MAPE: {metrics['mape']:.2f}%")
    print(f"{'='*60}")
    
    print("\n✅ XGBoost 模型訓練完成！")

if __name__ == '__main__':
    main()

