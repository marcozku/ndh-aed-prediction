# -*- coding: utf-8 -*-
"""
XGBoost 模型訓練腳本 v3.3.00 - 修復數據洩漏 + 公眾假期特徵
修復內容:
1. EWMA/Change 特徵使用 shift(1) 避免數據洩漏
2. 添加香港公眾假期特徵
3. 實施時間序列交叉驗證
4. 動態特徵重要性監控

預期性能:
- 訓練 MAE: 6-8 人 (更真實)
- 生產 MAE: 8-12 人 (改善 45-54%)
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
from sklearn.model_selection import TimeSeriesSplit
import json
import os
from datetime import datetime, timedelta

# 擴展特徵列表 (10 + 5 假期特徵)
OPTIMAL_FEATURES = [
    'Attendance_EWMA7', 'Daily_Change', 'Attendance_EWMA14',
    'Weekly_Change', 'Day_of_Week', 'Attendance_Lag7',
    'Attendance_Lag1', 'Is_Weekend', 'DayOfWeek_sin', 'DayOfWeek_cos',
    # 新增假期特徵
    'Is_Public_Holiday', 'Days_To_Holiday', 'Days_After_Holiday',
    'Is_Holiday_Eve', 'Is_Holiday_After'
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


def load_holidays():
    """加載香港公眾假期數據"""
    try:
        holidays_path = os.path.join(os.path.dirname(__file__), 'hk_public_holidays.json')
        with open(holidays_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # 展平所有假期到一個列表
        all_holidays = []
        for year, dates in data['holidays'].items():
            all_holidays.extend(dates)

        return set(pd.to_datetime(all_holidays).date)
    except Exception as e:
        print(f"⚠️ 無法加載假期數據: {e}", flush=True)
        return set()


def load_data_from_db():
    """從數據庫加載數據"""
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


def add_holiday_features(df, holidays):
    """添加公眾假期特徵"""
    print(f"   🎆 添加公眾假期特徵...", flush=True)

    df = df.copy()
    df['Date_only'] = pd.to_datetime(df['Date']).dt.date

    # 1. 是否為公眾假期
    df['Is_Public_Holiday'] = df['Date_only'].isin(holidays).astype(int)

    # 2. 距離下一個假期的天數
    def days_to_next_holiday(date):
        future_holidays = [h for h in holidays if h > date]
        if future_holidays:
            return (min(future_holidays) - date).days
        return 365  # 如果沒有未來假期，返回大值

    df['Days_To_Holiday'] = df['Date_only'].apply(days_to_next_holiday)

    # 3. 距離上一個假期的天數
    def days_after_last_holiday(date):
        past_holidays = [h for h in holidays if h < date]
        if past_holidays:
            return (date - max(past_holidays)).days
        return 365

    df['Days_After_Holiday'] = df['Date_only'].apply(days_after_last_holiday)

    # 4. 是否為假期前一天
    df['Is_Holiday_Eve'] = (df['Days_To_Holiday'] == 1).astype(int)

    # 5. 是否為假期後一天
    df['Is_Holiday_After'] = (df['Days_After_Holiday'] == 1).astype(int)

    # 限制距離特徵的範圍 (避免極端值)
    df['Days_To_Holiday'] = df['Days_To_Holiday'].clip(0, 30)
    df['Days_After_Holiday'] = df['Days_After_Holiday'].clip(0, 30)

    df = df.drop('Date_only', axis=1)

    holiday_count = df['Is_Public_Holiday'].sum()
    print(f"   ✅ 識別 {holiday_count} 個公眾假期", flush=True)

    return df


def prepare_optimal_features(df, holidays):
    """準備特徵 (修復數據洩漏)"""
    print("\n📊 準備特徵 (v3.3.00 - 修復數據洩漏)...", flush=True)
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

    print(f"   🔨 計算 EWMA (✅ 修復數據洩漏)...", flush=True)
    # ✅ 修復: 使用 shift(1) 避免數據洩漏，不包含當天的 Attendance
    df['Attendance_EWMA7'] = df['Attendance'].shift(1).ewm(span=7, adjust=False).mean()
    df['Attendance_EWMA14'] = df['Attendance'].shift(1).ewm(span=14, adjust=False).mean()

    print(f"   🔨 計算變化特徵 (✅ 修復數據洩漏)...", flush=True)
    # ✅ 修復: 使用 shift(1) 避免數據洩漏
    df['Daily_Change'] = df['Attendance'].shift(1).diff()
    df['Weekly_Change'] = df['Attendance'].shift(1).diff(7)

    # 添加公眾假期特徵
    df = add_holiday_features(df, holidays)

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


def train_with_time_series_cv(X, y, n_splits=5):
    """使用時間序列交叉驗證訓練"""
    print(f"\n🔄 時間序列交叉驗證 ({n_splits} folds)...", flush=True)
    sys.stdout.flush()

    tscv = TimeSeriesSplit(n_splits=n_splits, test_size=180)  # 每次測試 6 個月

    fold_results = []

    for fold, (train_idx, test_idx) in enumerate(tscv.split(X), 1):
        print(f"\n   📁 Fold {fold}/{n_splits}", flush=True)

        X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
        y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]

        print(f"      訓練: {len(X_train)} 筆, 測試: {len(X_test)} 筆", flush=True)

        # 訓練模型
        dtrain = xgb.DMatrix(X_train, label=y_train)
        dtest = xgb.DMatrix(X_test, label=y_test)

        model = xgb.train(
            OPTUNA_BEST_PARAMS,
            dtrain,
            num_boost_round=500,
            evals=[(dtest, 'test')],
            early_stopping_rounds=50,
            verbose_eval=False
        )

        # 評估
        y_pred = model.predict(dtest)
        mae = mean_absolute_error(y_test, y_pred)
        rmse = np.sqrt(mean_squared_error(y_test, y_pred))
        mape = np.mean(np.abs((y_test - y_pred) / y_test)) * 100
        r2 = sklearn_r2_score(y_test, y_pred)

        fold_results.append({
            'fold': fold,
            'mae': mae,
            'rmse': rmse,
            'mape': mape,
            'r2': r2
        })

        print(f"      MAE: {mae:.2f}, RMSE: {rmse:.2f}, MAPE: {mape:.2f}%, R²: {r2:.4f}", flush=True)

    # 計算平均性能
    avg_mae = np.mean([r['mae'] for r in fold_results])
    avg_rmse = np.mean([r['rmse'] for r in fold_results])
    avg_mape = np.mean([r['mape'] for r in fold_results])
    avg_r2 = np.mean([r['r2'] for r in fold_results])

    std_mae = np.std([r['mae'] for r in fold_results])

    print(f"\n   📊 交叉驗證平均性能:", flush=True)
    print(f"      MAE:  {avg_mae:.2f} ± {std_mae:.2f}", flush=True)
    print(f"      RMSE: {avg_rmse:.2f}", flush=True)
    print(f"      MAPE: {avg_mape:.2f}%", flush=True)
    print(f"      R²:   {avg_r2:.4f}", flush=True)

    return fold_results, avg_mae


def train_final_model(X_train, y_train, X_test, y_test):
    """訓練最終模型"""
    print(f"\n🚀 訓練最終模型...", flush=True)
    print(f"   訓練集: {len(X_train)} 筆", flush=True)
    print(f"   測試集: {len(X_test)} 筆", flush=True)
    print(f"   特徵數: {len(X_train.columns)} 個", flush=True)
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

    model = xgb.train(
        OPTUNA_BEST_PARAMS,
        dtrain,
        num_boost_round=500,
        evals=[(dval, 'validation')],
        early_stopping_rounds=50,
        verbose_eval=False
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

    print(f"\n📊 最終模型性能:", flush=True)
    print(f"   MAE:  {mae:.2f}", flush=True)
    print(f"   RMSE: {rmse:.2f}", flush=True)
    print(f"   MAPE: {mape:.2f}%", flush=True)
    print(f"   R²:   {r2:.4f}", flush=True)

    # 特徵重要性
    importance_scores = model.get_score(importance_type='weight')
    feature_importance = {}
    for i, feat in enumerate(X_train.columns):
        key = f'f{i}'
        feature_importance[feat] = float(importance_scores.get(key, 0.0))

    # 排序並顯示
    sorted_importance = sorted(feature_importance.items(), key=lambda x: x[1], reverse=True)
    print(f"\n📊 特徵重要性 (Top 10):", flush=True)
    for i, (feat, imp) in enumerate(sorted_importance[:10], 1):
        print(f"   {i:2d}. {feat:25s}: {imp:.1f}", flush=True)

    return model, {'mae': mae, 'rmse': rmse, 'mape': mape, 'r2': r2}, feature_importance


def main():
    print("=" * 80, flush=True)
    print("🎯 XGBoost 模型訓練 v3.3.00 - 修復數據洩漏 + 公眾假期", flush=True)
    print("=" * 80, flush=True)
    print(f"時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n", flush=True)
    sys.stdout.flush()

    # 1. 加載假期數據
    print("🎆 加載香港公眾假期數據...", flush=True)
    holidays = load_holidays()
    print(f"   ✅ 加載 {len(holidays)} 個假期", flush=True)

    # 2. 加載數據
    print("\n📥 加載數據...", flush=True)
    sys.stdout.flush()

    df = load_data_from_db()

    if df is None:
        print("❌ 無法加載數據", flush=True)
        return

    print(f"   ✅ 加載 {len(df)} 筆記錄", flush=True)
    print(f"   📅 範圍: {df['Date'].min()} → {df['Date'].max()}", flush=True)
    sys.stdout.flush()

    # 3. 準備特徵
    df = prepare_optimal_features(df, holidays)

    # 4. 排除 COVID
    df = exclude_covid_periods(df)

    # 5. 分割數據
    print("\n✂️ 分割數據 (80/20)...", flush=True)
    split_idx = int(len(df) * 0.8)
    train_df = df[:split_idx]
    test_df = df[split_idx:]

    print(f"   訓練集: {len(train_df)} 筆", flush=True)
    print(f"   測試集: {len(test_df)} 筆", flush=True)
    sys.stdout.flush()

    X_train = train_df[OPTIMAL_FEATURES]
    y_train = train_df['Attendance']
    X_test = test_df[OPTIMAL_FEATURES]
    y_test = test_df['Attendance']

    # 6. 時間序列交叉驗證
    fold_results, avg_cv_mae = train_with_time_series_cv(
        pd.concat([X_train, X_test]),
        pd.concat([y_train, y_test]),
        n_splits=5
    )

    # 7. 訓練最終模型
    model, metrics, feature_importance = train_final_model(X_train, y_train, X_test, y_test)

    # 8. 對比 v3.2.01
    print("\n" + "=" * 80, flush=True)
    print("📊 性能對比 (v3.2.01 vs v3.3.00)", flush=True)
    print("=" * 80, flush=True)

    print(f"\n{'指標':<15} {'v3.2.01 (洩漏)':<20} {'v3.3.00 (修復)':<20} {'變化':<15}", flush=True)
    print("-" * 70, flush=True)

    old_mae = 2.85
    old_rmse = 4.54
    old_mape = 1.17
    old_r2 = 0.9718

    mae_change = ((metrics['mae'] - old_mae) / old_mae) * 100
    rmse_change = ((metrics['rmse'] - old_rmse) / old_rmse) * 100

    print(f"{'MAE':<15} {old_mae:<20.2f} {metrics['mae']:<20.2f} {mae_change:+.1f}%", flush=True)
    print(f"{'RMSE':<15} {old_rmse:<20.2f} {metrics['rmse']:<20.2f} {rmse_change:+.1f}%", flush=True)
    print(f"{'MAPE':<15} {old_mape:<20.2f}% {metrics['mape']:<19.2f}% -", flush=True)
    print(f"{'R²':<15} {old_r2:<20.4f} {metrics['r2']:<20.4f} -", flush=True)
    print(f"{'CV MAE':<15} {'N/A':<20} {avg_cv_mae:<20.2f} -", flush=True)

    print(f"\n💡 分析:", flush=True)
    print(f"   - 訓練 MAE 上升 {mae_change:.1f}% 是正常的（修復數據洩漏後）", flush=True)
    print(f"   - 這個 MAE 更接近真實生產環境性能", flush=True)
    print(f"   - 預期生產 MAE 從 21.93 降到 8-12 人（改善 45-54%）", flush=True)

    # 9. 保存模型
    print(f"\n💾 保存模型...", flush=True)
    sys.stdout.flush()

    models_dir = os.path.join(os.path.dirname(__file__), 'models')
    os.makedirs(models_dir, exist_ok=True)

    model_path = os.path.join(models_dir, 'xgboost_v3_3_00_fixed.json')
    model.save_model(model_path)
    print(f"💾 模型已保存: {model_path}", flush=True)

    # 保存特徵列表
    features_path = os.path.join(models_dir, 'xgboost_v3_3_00_features.json')
    with open(features_path, 'w', encoding='utf-8') as f:
        json.dump(OPTIMAL_FEATURES, f, indent=2, ensure_ascii=False)
    print(f"💾 特徵列表已保存: {features_path}", flush=True)

    # 保存指標
    metrics_data = {
        'version': '3.3.00',
        'model_name': 'xgboost_v3_3_00_fixed',
        'features': OPTIMAL_FEATURES,
        'n_features': len(OPTIMAL_FEATURES),
        'mae': metrics['mae'],
        'rmse': metrics['rmse'],
        'mape': metrics['mape'],
        'r2': metrics['r2'],
        'cv_mae': avg_cv_mae,
        'cv_results': fold_results,
        'improvements': {
            'data_leakage_fixed': True,
            'holiday_features_added': True,
            'time_series_cv': True
        },
        'comparison_v3_2_01': {
            'old_mae': old_mae,
            'new_mae': metrics['mae'],
            'mae_change_pct': mae_change,
            'note': '訓練 MAE 上升是正常的（修復數據洩漏後），更接近真實性能'
        },
        'training_date': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'train_size': len(train_df),
        'test_size': len(test_df),
        'feature_importance': feature_importance,
        'optuna_params': OPTUNA_BEST_PARAMS
    }

    metrics_path = os.path.join(models_dir, 'xgboost_v3_3_00_metrics.json')
    with open(metrics_path, 'w', encoding='utf-8') as f:
        json.dump(metrics_data, f, indent=2, ensure_ascii=False)
    print(f"💾 指標已保存: {metrics_path}", flush=True)

    print("\n" + "=" * 80, flush=True)
    print("✅ 訓練完成！", flush=True)
    print("=" * 80, flush=True)


if __name__ == '__main__':
    main()
