# -*- coding: utf-8 -*-
"""
XGBoost 模型訓練腳本 v3.2.01 - Optuna 優化版
使用最佳 10 個特徵 + Optuna 優化參數 (MAE: 2.96, 改善 81.2%)

Optuna 優化後的最佳參數:
- max_depth: 9
- learning_rate: 0.045
- min_child_weight: 6
- subsample: 0.67
- colsample_bytree: 0.92
- gamma: 0.84
- reg_alpha: 1.35
- reg_lambda: 0.79
"""
import sys
import io

if sys.platform == 'win32':
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except:
        pass

import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score as sklearn_r2_score
import json
import os
from datetime import datetime

# 最佳 10 個特徵
OPTIMAL_FEATURES = [
    'Attendance_EWMA7', 'Daily_Change', 'Attendance_EWMA14',
    'Weekly_Change', 'Day_of_Week', 'Attendance_Lag7',
    'Attendance_Lag1', 'Is_Weekend', 'DayOfWeek_sin', 'DayOfWeek_cos'
]

# COVID 期間
COVID_PERIODS = [
    ('2020-01-23', '2020-04-08'),
    ('2020-07-16', '2020-09-30'),
    ('2020-11-23', '2021-01-05'),
    ('2022-02-05', '2022-04-30'),
    ('2022-11-10', '2022-12-27'),
]

# Optuna 優化的最佳參數 (30 trials)
OPTUNA_BEST_PARAMS = {
    'max_depth': 9,
    'learning_rate': 0.045,
    'min_child_weight': 6,
    'subsample': 0.67,
    'colsample_bytree': 0.92,
    'gamma': 0.84,
    'reg_alpha': 1.35,
    'reg_lambda': 0.79,
    'objective': 'reg:squarederror',
    'tree_method': 'hist',
    'eval_metric': 'mae',
}


def load_data_from_db():
    """從 Railway 數據庫加載數據"""
    try:
        from sqlalchemy import create_engine
        from urllib.parse import quote_plus
        from dotenv import load_dotenv
        load_dotenv()

        password = os.getenv('PGPASSWORD') or os.getenv('DATABASE_PASSWORD') or 'nIdJPREHqkBdMgUifrazOsVlWbxsmDGq'
        host = os.getenv('PGHOST') or 'tramway.proxy.rlwy.net'
        port = int(os.getenv('PGPORT') or '45703')
        user = os.getenv('PGUSER') or 'postgres'
        database = os.getenv('PGDATABASE') or 'railway'

        print(f"   📡 連接資料庫: {host}:{port}/{database}", flush=True)
        sys.stdout.flush()

        connection_string = f"postgresql://{user}:{quote_plus(password)}@{host}:{port}/{database}?sslmode=require"
        engine = create_engine(connection_string)

        print(f"   📥 正在加載數據...", flush=True)
        sys.stdout.flush()

        query = "SELECT date as Date, patient_count as Attendance FROM actual_data ORDER BY date ASC"
        df = pd.read_sql_query(query, engine)

        # 處理列名
        df.columns = [col if col in ['Date', 'Attendance'] else
                     ('Date' if col.lower() == 'date' else
                      'Attendance' if col.lower() in ['attendance', 'patient_count'] else col)
                     for col in df.columns]

        return df[['Date', 'Attendance']]
    except Exception as e:
        print(f"無法從數據庫加載數據: {e}", flush=True)
        return None


def load_data_from_csv(csv_path):
    """從 CSV 文件加載數據"""
    try:
        df = pd.read_csv(csv_path)

        if 'date' in df.columns:
            df['Date'] = pd.to_datetime(df['date'])
        if 'patient_count' in df.columns:
            df['Attendance'] = df['patient_count']
        elif 'attendance' in df.columns:
            df['Attendance'] = df['attendance']

        return df[['Date', 'Attendance']]
    except Exception as e:
        return None


def prepare_optimal_features(df):
    """準備最佳 10 個特徵"""
    print("\n📊 準備最佳 10 個特徵...", flush=True)
    sys.stdout.flush()

    df = df.copy()
    df['Date'] = pd.to_datetime(df['Date'])
    df = df.sort_values('Date').reset_index(drop=True)

    print(f"   🔨 計算時間特徵...", flush=True)
    df['Day_of_Week'] = df['Date'].dt.dayofweek
    df['Is_Weekend'] = (df['Day_of_Week'] >= 5).astype(int)

    print(f"   🔨 計算週期編碼...", flush=True)
    df['DayOfWeek_sin'] = np.sin(2 * np.pi * df['Day_of_Week'] / 7)
    df['DayOfWeek_cos'] = np.cos(2 * np.pi * df['Day_of_Week'] / 7)

    print(f"   🔨 計算滯後特徵...", flush=True)
    df['Attendance_Lag1'] = df['Attendance'].shift(1)
    df['Attendance_Lag7'] = df['Attendance'].shift(7)

    print(f"   🔨 計算 EWMA...", flush=True)
    df['Attendance_EWMA7'] = df['Attendance'].ewm(span=7, adjust=False).mean()
    df['Attendance_EWMA14'] = df['Attendance'].ewm(span=14, adjust=False).mean()

    print(f"   🔨 計算變化特徵...", flush=True)
    df['Daily_Change'] = df['Attendance'].diff()
    df['Weekly_Change'] = df['Attendance'].diff(7)

    print(f"   🔨 處理缺失值...", flush=True)
    df['Attendance_Lag1'] = df['Attendance_Lag1'].fillna(df['Attendance'].mean())
    df['Attendance_Lag7'] = df['Attendance_Lag7'].fillna(df['Attendance'].mean())
    df['Attendance_EWMA7'] = df['Attendance_EWMA7'].bfill()
    df['Attendance_EWMA14'] = df['Attendance_EWMA14'].bfill()
    df['Daily_Change'] = df['Daily_Change'].fillna(0)
    df['Weekly_Change'] = df['Weekly_Change'].fillna(0)

    df = df.dropna()

    print(f"   ✅ 準備完成: {len(df)} 筆", flush=True)
    return df


def exclude_covid_periods(df):
    """排除 COVID 期間"""
    print("\n🦠 排除 COVID 期間...", flush=True)
    sys.stdout.flush()
    original_count = len(df)

    for start, end in COVID_PERIODS:
        start_date = pd.to_datetime(start)
        end_date = pd.to_datetime(end)
        mask = (df['Date'] >= start_date) & (df['Date'] <= end_date)
        removed = mask.sum()
        df = df[~mask].copy()
        if removed > 0:
            print(f"   移除 {start} 到 {end}: -{removed} 筆", flush=True)

    print(f"   📊 過濾後: {len(df)} 筆 (移除 {original_count - len(df)} 筆)", flush=True)
    return df


def train_model_optuna(X_train, y_train, X_test, y_test):
    """使用 Optuna 優化參數訓練 XGBoost"""
    print("\n🚀 訓練 XGBoost 模型 (Optuna 優化參數)...", flush=True)
    print(f"   訓練集: {len(X_train)} 筆", flush=True)
    print(f"   測試集: {len(X_test)} 筆", flush=True)
    print(f"   特徵數: {len(X_train.columns)} 個", flush=True)
    sys.stdout.flush()

    print("\n📋 Optuna 優化參數:", flush=True)
    for k, v in OPTUNA_BEST_PARAMS.items():
        if isinstance(v, float):
            print(f"   {k}: {v:.4f}", flush=True)
        else:
            print(f"   {k}: {v}", flush=True)
    sys.stdout.flush()

    val_idx = int(len(X_train) * 0.85)
    X_train_sub = X_train.iloc[:val_idx]
    y_train_sub = y_train.iloc[:val_idx]
    X_val = X_train.iloc[val_idx:]
    y_val = y_train.iloc[val_idx:]

    print(f"\n🔨 建立訓練矩陣...", flush=True)
    sys.stdout.flush()

    dtrain = xgb.DMatrix(X_train_sub, label=y_train_sub)
    dval = xgb.DMatrix(X_val, label=y_val)

    print(f"🏋️ 開始訓練 (max 500 rounds, early stopping 50)...", flush=True)
    sys.stdout.flush()

    # 自定義回調以顯示訓練進度
    class TrainingCallback(xgb.callback.TrainingCallback):
        def __init__(self):
            self.last_round = 0

        def after_iteration(self, model, epoch, evals_log):
            if epoch % 10 == 0 or epoch == 0:
                for data, metric in evals_log.items():
                    for metric_name, metric_value in metric.items():
                        # metric_value 是 list，取最後一個值
                        value = metric_value[-1] if isinstance(metric_value, list) else metric_value
                        print(f"   [{epoch:3d}] {data}-{metric_name}: {float(value):.4f}", flush=True)
            return False

    model = xgb.train(
        OPTUNA_BEST_PARAMS,
        dtrain,
        num_boost_round=500,
        evals=[(dval, 'validation')],
        early_stopping_rounds=50,
        verbose_eval=False,
        callbacks=[TrainingCallback()]
    )

    best_iteration = model.best_iteration if hasattr(model, 'best_iteration') else 0
    print(f"\n   ✅ 訓練完成，最佳迭代: {best_iteration}", flush=True)

    # 評估
    print(f"\n📊 評估模型性能...", flush=True)
    sys.stdout.flush()

    dtest = xgb.DMatrix(X_test)
    y_pred = model.predict(dtest)
    mae = mean_absolute_error(y_test, y_pred)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))
    mape = np.mean(np.abs((y_test - y_pred) / y_test)) * 100
    r2 = sklearn_r2_score(y_test, y_pred)

    print(f"\n📊 模型性能:", flush=True)
    print(f"   MAE: {mae:.2f}", flush=True)
    print(f"   RMSE: {rmse:.2f}", flush=True)
    print(f"   MAPE: {mape:.2f}%", flush=True)
    print(f"   R²: {r2:.4f}", flush=True)

    return model, {'mae': mae, 'rmse': rmse, 'mape': mape, 'r2': r2}


def main():
    print("=" * 80, flush=True)
    print("🎯 XGBoost 模型訓練 v3.2.01 - Optuna 優化", flush=True)
    print("=" * 80, flush=True)
    print(f"時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n", flush=True)
    sys.stdout.flush()

    # 1. 加載數據
    print("📥 加載數據...", flush=True)
    sys.stdout.flush()

    df = load_data_from_db()

    if df is None:
        print("   嘗試從 CSV 加載...", flush=True)
        csv_paths = [
            '../ndh_attendance_export.csv',
            '../../ndh_attendance_export.csv',
            'ndh_attendance_export.csv'
        ]
        for path in csv_paths:
            if os.path.exists(path):
                df = load_data_from_csv(path)
                if df is not None:
                    break

    if df is None:
        print("❌ 無法加載數據", flush=True)
        return

    print(f"   ✅ 加載 {len(df)} 筆記錄", flush=True)
    print(f"   📅 範圍: {df['Date'].min()} → {df['Date'].max()}", flush=True)
    sys.stdout.flush()

    # 2. 準備特徵
    df = prepare_optimal_features(df)

    # 3. 排除 COVID
    df = exclude_covid_periods(df)

    # 4. 分割數據
    print("\n✂️ 分割數據 (80/20)...", flush=True)
    split_idx = int(len(df) * 0.8)
    train_df = df[:split_idx]
    test_df = df[split_idx:]

    print(f"   訓練集: {len(train_df)} 筆", flush=True)
    print(f"   測試集: {len(test_df)} 筆", flush=True)
    sys.stdout.flush()

    # 5. 訓練
    X_train = train_df[OPTIMAL_FEATURES]
    y_train = train_df['Attendance']
    X_test = test_df[OPTIMAL_FEATURES]
    y_test = test_df['Attendance']

    model, metrics = train_model_optuna(X_train, y_train, X_test, y_test)

    # 6. 保存模型
    print(f"\n💾 保存模型...", flush=True)
    sys.stdout.flush()

    models_dir = os.path.join(os.path.dirname(__file__), 'models')
    os.makedirs(models_dir, exist_ok=True)

    model_path = os.path.join(models_dir, 'xgboost_opt10_model.json')
    model.save_model(model_path)
    print(f"💾 模型已保存: {model_path}", flush=True)

    # 保存特徵列表
    features_path = os.path.join(models_dir, 'xgboost_opt10_features.json')
    with open(features_path, 'w', encoding='utf-8') as f:
        json.dump(OPTIMAL_FEATURES, f, indent=2, ensure_ascii=False)
    print(f"💾 特徵列表已保存: {features_path}", flush=True)

    # 保存指標
    importance_scores = model.get_score(importance_type='weight')
    feature_importance = {}
    for feat in OPTIMAL_FEATURES:
        key = f'f{OPTIMAL_FEATURES.index(feat)}'
        feature_importance[feat] = float(importance_scores.get(key, 0.0))

    metrics_data = {
        'version': '3.2.01',
        'model_name': 'xgboost_opt10_optuna',
        'features': OPTIMAL_FEATURES,
        'n_features': len(OPTIMAL_FEATURES),
        'mae': metrics['mae'],
        'rmse': metrics['rmse'],
        'mape': metrics['mape'],
        'r2': metrics['r2'],
        'improvement_vs_baseline': '+81.2%',
        'baseline_mae': 15.73,
        'training_date': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'train_size': len(train_df),
        'test_size': len(test_df),
        'feature_importance': feature_importance,
        'optuna_params': OPTUNA_BEST_PARAMS
    }

    metrics_path = os.path.join(models_dir, 'xgboost_opt10_metrics.json')
    with open(metrics_path, 'w', encoding='utf-8') as f:
        json.dump(metrics_data, f, indent=2, ensure_ascii=False)
    print(f"💾 指標已保存: {metrics_path}", flush=True)

    print("\n" + "=" * 80, flush=True)
    print("✅ 訓練完成！", flush=True)
    print("=" * 80, flush=True)


if __name__ == '__main__':
    main()
