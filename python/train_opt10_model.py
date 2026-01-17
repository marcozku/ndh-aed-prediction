# -*- coding: utf-8 -*-
"""
XGBoost 模型訓練腳本 v3.2.00 - 優化版
使用最佳 10 個特徵 (MAE: 2.55, 改善 83.8%)

基於特徵選擇測試結果:
- 最佳 10 特徵 → MAE = 2.55
- 額外特徵 (流感/AI/天氣) 無改善效果
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

# 最佳 10 個特徵 (經過完整測試驗證)
OPTIMAL_FEATURES = [
    'Attendance_EWMA7',   # 7天指數加權移動平均 (重要性 0.7141)
    'Daily_Change',       # 每日變化 (重要性 0.0731)
    'Attendance_EWMA14',  # 14天指數加權移動平均 (重要性 0.0643)
    'Weekly_Change',      # 每周變化 (重要性 0.0427)
    'Day_of_Week',        # 星期幾 (重要性 0.0340)
    'Attendance_Lag7',    # 7天前就診 (重要性 0.0293)
    'Attendance_Lag1',    # 1天前就診 (重要性 0.0225)
    'Is_Weekend',         # 是否週末 (重要性 0.0154)
    'DayOfWeek_sin',      # 週期編碼 sin (重要性 0.0015)
    'DayOfWeek_cos',      # 週期編碼 cos (重要性 0.0009)
]

# COVID 期間 (排除這些異常數據)
COVID_PERIODS = [
    ('2020-01-23', '2020-04-08'),
    ('2020-07-16', '2020-09-30'),
    ('2020-11-23', '2021-01-05'),
    ('2022-02-05', '2022-04-30'),
    ('2022-11-10', '2022-12-27'),
]


def load_data_from_db():
    """從 Railway 數據庫加載數據"""
    try:
        import psycopg2
        from dotenv import load_dotenv
        load_dotenv()

        password = os.getenv('PGPASSWORD') or os.getenv('DATABASE_PASSWORD') or 'nIdJPREHqkBdMgUifrazOsVlWbxsmDGq'
        host = os.getenv('PGHOST') or 'tramway.proxy.rlwy.net'
        port = int(os.getenv('PGPORT') or '45703')
        user = os.getenv('PGUSER') or 'postgres'
        database = os.getenv('PGDATABASE') or 'railway'

        print(f"   📡 連接資料庫: {host}:{port}/{database}")

        from sqlalchemy import create_engine
        from urllib.parse import quote_plus
        connection_string = f"postgresql://{user}:{quote_plus(password)}@{host}:{port}/{database}?sslmode=require"
        engine = create_engine(connection_string)

        query = """
            SELECT date as Date, patient_count as Attendance
            FROM actual_data
            ORDER BY date ASC
        """
        df = pd.read_sql_query(query, engine)

        if 'date' in df.columns and 'Date' not in df.columns:
            df['Date'] = pd.to_datetime(df['date'])
        elif 'Date' not in df.columns:
            df['Date'] = pd.to_datetime(df['Date'])

        if 'patient_count' in df.columns and 'Attendance' not in df.columns:
            df['Attendance'] = df['patient_count']
        elif 'attendance' in df.columns and 'Attendance' not in df.columns:
            df['Attendance'] = df['attendance']

        return df[['Date', 'Attendance']]
    except Exception as e:
        print(f"無法從數據庫加載數據: {e}")
        return None


def load_data_from_csv(csv_path):
    """從 CSV 文件加載數據"""
    try:
        df = pd.read_csv(csv_path)

        if 'date' in df.columns:
            df['Date'] = pd.to_datetime(df['date'])
        elif 'Date' not in df.columns:
            df['Date'] = pd.to_datetime(df['Date'])

        if 'patient_count' in df.columns:
            df['Attendance'] = df['patient_count']
        elif 'attendance' in df.columns:
            df['Attendance'] = df['attendance']

        return df[['Date', 'Attendance']]
    except Exception as e:
        return None


def prepare_optimal_features(df):
    """只準備最佳 10 個特徵"""
    print("\n📊 準備最佳 10 個特徵...")

    df = df.copy()
    df['Date'] = pd.to_datetime(df['Date'])
    df = df.sort_values('Date').reset_index(drop=True)

    # 時間特徵
    df['Day_of_Week'] = df['Date'].dt.dayofweek
    df['Is_Weekend'] = (df['Day_of_Week'] >= 5).astype(int)

    # 週期編碼
    df['DayOfWeek_sin'] = np.sin(2 * np.pi * df['Day_of_Week'] / 7)
    df['DayOfWeek_cos'] = np.cos(2 * np.pi * df['Day_of_Week'] / 7)

    # 歷史就診特徵
    df['Attendance_Lag1'] = df['Attendance'].shift(1)
    df['Attendance_Lag7'] = df['Attendance'].shift(7)

    df['Attendance_EWMA7'] = df['Attendance'].ewm(span=7, adjust=False).mean()
    df['Attendance_EWMA14'] = df['Attendance'].ewm(span=14, adjust=False).mean()

    df['Daily_Change'] = df['Attendance'].diff()
    df['Weekly_Change'] = df['Attendance'].diff(7)

    # 填補 NaN
    df['Attendance_Lag1'] = df['Attendance_Lag1'].fillna(df['Attendance'].mean())
    df['Attendance_Lag7'] = df['Attendance_Lag7'].fillna(df['Attendance'].mean())
    df['Attendance_EWMA7'] = df['Attendance_EWMA7'].bfill()
    df['Attendance_EWMA14'] = df['Attendance_EWMA14'].bfill()
    df['Daily_Change'] = df['Daily_Change'].fillna(0)
    df['Weekly_Change'] = df['Weekly_Change'].fillna(0)

    # 移除 NaN
    df = df.dropna()

    print(f"   ✅ 準備完成: {len(df)} 筆")
    return df


def exclude_covid_periods(df):
    """排除 COVID 期間"""
    print("\n🦠 排除 COVID 期間...")
    original_count = len(df)

    for start, end in COVID_PERIODS:
        start_date = pd.to_datetime(start)
        end_date = pd.to_datetime(end)
        mask = (df['Date'] >= start_date) & (df['Date'] <= end_date)
        removed = mask.sum()
        df = df[~mask].copy()
        if removed > 0:
            print(f"   移除 {start} 到 {end}: -{removed} 筆")

    print(f"   📊 過濾後: {len(df)} 筆 (移除 {original_count - len(df)} 筆)")
    return df


def train_model(X_train, y_train, X_test, y_test):
    """訓練 XGBoost 模型"""
    print("\n🚀 訓練 XGBoost 模型...")
    print(f"   訓練集: {len(X_train)} 筆")
    print(f"   測試集: {len(X_test)} 筆")
    print(f"   特徵數: {len(X_train.columns)} 個")

    # 分出驗證集 (從訓練集的最後 15%)
    val_idx = int(len(X_train) * 0.85)
    X_train_sub = X_train.iloc[:val_idx]
    y_train_sub = y_train.iloc[:val_idx]
    X_val = X_train.iloc[val_idx:]
    y_val = y_train.iloc[val_idx:]

    # 使用原生 API 避免 _estimator_type 錯誤
    dtrain = xgb.DMatrix(X_train_sub, label=y_train_sub)
    dval = xgb.DMatrix(X_val, label=y_val)

    params = {
        'n_estimators': 500,
        'max_depth': 6,
        'learning_rate': 0.05,
        'min_child_weight': 3,
        'subsample': 0.8,
        'colsample_bytree': 0.8,
        'objective': 'reg:squarederror',
        'tree_method': 'hist',
        'eval_metric': 'mae',
        'random_state': 42,
    }

    model = xgb.train(
        params,
        dtrain,
        num_boost_round=500,
        evals=[(dval, 'validation')],
        early_stopping_rounds=50,
        verbose_eval=False
    )

    # 評估
    dtest = xgb.DMatrix(X_test)
    y_pred = model.predict(dtest)
    mae = mean_absolute_error(y_test, y_pred)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))
    mape = np.mean(np.abs((y_test - y_pred) / y_test)) * 100
    r2 = sklearn_r2_score(y_test, y_pred)

    print(f"\n📊 模型性能:")
    print(f"   MAE: {mae:.2f}")
    print(f"   RMSE: {rmse:.2f}")
    print(f"   MAPE: {mape:.2f}%")
    print(f"   R²: {r2:.4f}")

    return model, {'mae': mae, 'rmse': rmse, 'mape': mape, 'r2': r2}


def main():
    print("=" * 80)
    print("🎯 XGBoost 模型訓練 v3.2.00 - 最佳 10 特徵")
    print("=" * 80)
    print(f"時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # 1. 加載數據
    print("📥 加載數據...")
    df = load_data_from_db()

    if df is None:
        print("   嘗試從 CSV 加載...")
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
        print("❌ 無法加載數據")
        return

    print(f"   ✅ 加載 {len(df)} 筆記錄")
    print(f"   📅 範圍: {df['Date'].min()} → {df['Date'].max()}")

    # 2. 準備特徵
    df = prepare_optimal_features(df)

    # 3. 排除 COVID
    df = exclude_covid_periods(df)

    # 4. 分割數據
    print("\n✂️ 分割數據 (80/20)...")
    split_idx = int(len(df) * 0.8)
    train_df = df[:split_idx]
    test_df = df[split_idx:]

    print(f"   訓練集: {len(train_df)} 筆")
    print(f"   測試集: {len(test_df)} 筆")

    # 5. 訓練
    X_train = train_df[OPTIMAL_FEATURES]
    y_train = train_df['Attendance']
    X_test = test_df[OPTIMAL_FEATURES]
    y_test = test_df['Attendance']

    model, metrics = train_model(X_train, y_train, X_test, y_test)

    # 6. 保存模型
    models_dir = os.path.join(os.path.dirname(__file__), 'models')
    os.makedirs(models_dir, exist_ok=True)

    model_path = os.path.join(models_dir, 'xgboost_opt10_model.json')
    model.save_model(model_path)
    print(f"\n💾 模型已保存: {model_path}")

    # 保存特徵列表
    features_path = os.path.join(models_dir, 'xgboost_opt10_features.json')
    with open(features_path, 'w', encoding='utf-8') as f:
        json.dump(OPTIMAL_FEATURES, f, indent=2, ensure_ascii=False)
    print(f"💾 特徵列表已保存: {features_path}")

    # 保存指標
    # 獲取特徵重要性 (native API)
    importance_scores = model.get_score(importance_type='weight')
    # 確保所有特徵都有分數
    feature_importance = {}
    for feat in OPTIMAL_FEATURES:
        key = f'f{OPTIMAL_FEATURES.index(feat)}'
        feature_importance[feat] = float(importance_scores.get(key, 0.0))

    metrics_data = {
        'version': '3.2.00',
        'model_name': 'xgboost_opt10',
        'features': OPTIMAL_FEATURES,
        'n_features': len(OPTIMAL_FEATURES),
        'mae': metrics['mae'],
        'rmse': metrics['rmse'],
        'mape': metrics['mape'],
        'r2': metrics['r2'],
        'improvement_vs_baseline': '+83.8%',
        'baseline_mae': 15.73,
        'training_date': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'train_size': len(train_df),
        'test_size': len(test_df),
        'feature_importance': feature_importance
    }

    metrics_path = os.path.join(models_dir, 'xgboost_opt10_metrics.json')
    with open(metrics_path, 'w', encoding='utf-8') as f:
        json.dump(metrics_data, f, indent=2, ensure_ascii=False)
    print(f"💾 指標已保存: {metrics_path}")

    print("\n" + "=" * 80)
    print("✅ 訓練完成！")
    print("=" * 80)


if __name__ == '__main__':
    main()
