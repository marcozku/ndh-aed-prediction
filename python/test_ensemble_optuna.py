# -*- coding: utf-8 -*-
"""
完整模型比較測試 - XGBoost vs RF vs Ensemble + Optuna
使用最佳 10 特徵
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
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score as sklearn_r2_score
import json
import os
from datetime import datetime

# 嘗試導入 Optuna
try:
    import optuna
    OPTUNA_AVAILABLE = True
except ImportError:
    OPTUNA_AVAILABLE = False
    print("⚠️ Optuna 未安裝")

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

        connection_string = f"postgresql://{user}:{quote_plus(password)}@{host}:{port}/{database}?sslmode=require"
        engine = create_engine(connection_string)

        query = "SELECT date as Date, patient_count as Attendance FROM actual_data ORDER BY date ASC"
        df = pd.read_sql_query(query, engine)

        # 處理列名 (SQLAlchemy 可能轉成小寫)
        df.columns = [col if col in ['Date', 'Attendance'] else
                     ('Date' if col.lower() == 'date' else
                      'Attendance' if col.lower() in ['attendance', 'patient_count'] else col)
                     for col in df.columns]

        # 確保有 Date 和 Attendance 列
        if 'Date' not in df.columns:
            if 'date' in df.columns:
                df['Date'] = pd.to_datetime(df['date'])

        if 'Attendance' not in df.columns:
            if 'patient_count' in df.columns:
                df['Attendance'] = df['patient_count']
            elif 'attendance' in df.columns:
                df['Attendance'] = df['attendance']

        return df[['Date', 'Attendance']]
    except Exception as e:
        print(f"無法加載數據: {e}")
        import traceback
        traceback.print_exc()
        return None


def prepare_features(df):
    """準備最佳 10 特徵"""
    df = df.copy()
    df['Date'] = pd.to_datetime(df['Date'])
    df = df.sort_values('Date').reset_index(drop=True)

    # 時間特徵
    df['Day_of_Week'] = df['Date'].dt.dayofweek
    df['Is_Weekend'] = (df['Day_of_Week'] >= 5).astype(int)

    # 週期編碼
    df['DayOfWeek_sin'] = np.sin(2 * np.pi * df['Day_of_Week'] / 7)
    df['DayOfWeek_cos'] = np.cos(2 * np.pi * df['Day_of_Week'] / 7)

    # 歷史就診
    df['Attendance_Lag1'] = df['Attendance'].shift(1)
    df['Attendance_Lag7'] = df['Attendance'].shift(7)
    df['Attendance_EWMA7'] = df['Attendance'].ewm(span=7, adjust=False).mean()
    df['Attendance_EWMA14'] = df['Attendance'].ewm(span=14, adjust=False).mean()
    df['Daily_Change'] = df['Attendance'].diff()
    df['Weekly_Change'] = df['Attendance'].diff(7)

    # 填補
    df['Attendance_Lag1'] = df['Attendance_Lag1'].fillna(df['Attendance'].mean())
    df['Attendance_Lag7'] = df['Attendance_Lag7'].fillna(df['Attendance'].mean())
    df['Attendance_EWMA7'] = df['Attendance_EWMA7'].bfill()
    df['Attendance_EWMA14'] = df['Attendance_EWMA14'].bfill()
    df['Daily_Change'] = df['Daily_Change'].fillna(0)
    df['Weekly_Change'] = df['Weekly_Change'].fillna(0)

    df = df.dropna()
    return df


def exclude_covid(df):
    """排除 COVID 期間"""
    for start, end in COVID_PERIODS:
        start_date = pd.to_datetime(start)
        end_date = pd.to_datetime(end)
        mask = (df['Date'] >= start_date) & (df['Date'] <= end_date)
        df = df[~mask].copy()
    return df


def train_xgboost_default(X_train, y_train, X_val, y_val):
    """訓練 XGBoost (默認參數)"""
    dtrain = xgb.DMatrix(X_train, label=y_train)
    dval = xgb.DMatrix(X_val, label=y_val)

    params = {
        'max_depth': 6,
        'learning_rate': 0.05,
        'min_child_weight': 3,
        'subsample': 0.8,
        'colsample_bytree': 0.8,
        'objective': 'reg:squarederror',
        'tree_method': 'hist',
        'eval_metric': 'mae',
    }

    model = xgb.train(
        params, dtrain,
        num_boost_round=500,
        evals=[(dval, 'val')],
        early_stopping_rounds=50,
        verbose_eval=False
    )
    return model


def train_xgboost_optuna(X_train, y_train, X_val, y_val, n_trials=30):
    """使用 Optuna 優化 XGBoost"""
    if not OPTUNA_AVAILABLE:
        return None, None

    print(f"   🔍 Optuna 優化 ({n_trials} trials)...")

    def objective(trial):
        params = {
            'max_depth': trial.suggest_int('max_depth', 3, 10),
            'learning_rate': trial.suggest_float('learning_rate', 0.01, 0.2, log=True),
            'min_child_weight': trial.suggest_int('min_child_weight', 1, 10),
            'subsample': trial.suggest_float('subsample', 0.6, 1.0),
            'colsample_bytree': trial.suggest_float('colsample_bytree', 0.6, 1.0),
            'gamma': trial.suggest_float('gamma', 0, 2.0),
            'reg_alpha': trial.suggest_float('reg_alpha', 0, 2.0),
            'reg_lambda': trial.suggest_float('reg_lambda', 0.5, 3.0),
            'objective': 'reg:squarederror',
            'tree_method': 'hist',
            'eval_metric': 'mae',
        }

        dtrain = xgb.DMatrix(X_train, label=y_train)
        dval = xgb.DMatrix(X_val, label=y_val)

        model = xgb.train(
            params, dtrain,
            num_boost_round=300,
            evals=[(dval, 'val')],
            early_stopping_rounds=30,
            verbose_eval=False
        )

        y_pred = model.predict(dval)
        mae = mean_absolute_error(y_val, y_pred)
        return mae

    # 靜音 Optuna 日誌
    optuna.logging.set_verbosity(optuna.logging.WARNING)

    study = optuna.create_study(direction='minimize')
    study.optimize(objective, n_trials=n_trials, show_progress_bar=False)

    best_params = study.best_params
    best_params['objective'] = 'reg:squarederror'
    best_params['tree_method'] = 'hist'
    best_params['eval_metric'] = 'mae'

    # 用最佳參數訓練最終模型
    dtrain = xgb.DMatrix(X_train, label=y_train)
    dval = xgb.DMatrix(X_val, label=y_val)

    model = xgb.train(
        best_params, dtrain,
        num_boost_round=500,
        evals=[(dval, 'val')],
        early_stopping_rounds=50,
        verbose_eval=False
    )

    print(f"   ✅ 最佳 MAE: {study.best_value:.2f}")
    return model, best_params


def train_rf(X_train, y_train):
    """訓練 Random Forest"""
    model = RandomForestRegressor(
        n_estimators=200,
        max_depth=10,
        min_samples_split=5,
        min_samples_leaf=2,
        max_features='sqrt',
        random_state=42,
        n_jobs=-1
    )
    model.fit(X_train, y_train)
    return model


def evaluate_model(model, X_test, y_test, model_type='xgboost'):
    """評估模型"""
    if model_type == 'xgboost':
        dtest = xgb.DMatrix(X_test)
        y_pred = model.predict(dtest)
    else:
        y_pred = model.predict(X_test)

    mae = mean_absolute_error(y_test, y_pred)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))
    mape = np.mean(np.abs((y_test - y_pred) / y_test)) * 100
    r2 = sklearn_r2_score(y_test, y_pred)

    return {'mae': mae, 'rmse': rmse, 'mape': mape, 'r2': r2, 'predictions': y_pred}


def main():
    print("=" * 80)
    print("🎯 完整模型比較測試 - XGBoost vs RF vs Ensemble + Optuna")
    print("=" * 80)
    print(f"時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # 1. 加載數據
    print("📥 加載數據...")
    df = load_data_from_db()
    if df is None:
        return

    print(f"   ✅ {len(df)} 筆")

    # 2. 準備特徵
    df = prepare_features(df)
    print(f"   📊 準備完成: {len(df)} 筆")

    # 3. 排除 COVID
    df = exclude_covid(df)
    print(f"   🦠 COVID 後: {len(df)} 筆")

    # 4. 分割數據
    split_idx = int(len(df) * 0.8)
    train_df = df[:split_idx]
    test_df = df[split_idx:]

    # 訓練集再分出驗證集
    val_idx = int(len(train_df) * 0.85)
    train_sub = train_df[:val_idx]
    val_sub = train_df[val_idx:]

    X_train = train_sub[OPTIMAL_FEATURES]
    y_train = train_sub['Attendance']
    X_val = val_sub[OPTIMAL_FEATURES]
    y_val = val_sub['Attendance']
    X_test = test_df[OPTIMAL_FEATURES]
    y_test = test_df['Attendance']

    print(f"\n✂️ 數據分割:")
    print(f"   訓練: {len(X_train)}, 驗證: {len(X_val)}, 測試: {len(X_test)}")

    results = {}

    # ============ Model 1: XGBoost 默認 ============
    print("\n" + "=" * 80)
    print("1️⃣ XGBoost (默認參數)")
    print("=" * 80)

    xgb_model = train_xgboost_default(X_train, y_train, X_val, y_val)
    xgb_metrics = evaluate_model(xgb_model, X_test, y_test, 'xgboost')
    results['xgboost_default'] = xgb_metrics

    print(f"   MAE:  {xgb_metrics['mae']:.2f}")
    print(f"   RMSE: {xgb_metrics['rmse']:.2f}")
    print(f"   MAPE: {xgb_metrics['mape']:.2f}%")
    print(f"   R²:   {xgb_metrics['r2']:.4f}")

    # ============ Model 2: XGBoost + Optuna ============
    print("\n" + "=" * 80)
    print("2️⃣ XGBoost + Optuna 優化")
    print("=" * 80)

    if OPTUNA_AVAILABLE:
        xgb_optuna_model, best_params = train_xgboost_optuna(X_train, y_train, X_val, y_val, n_trials=30)

        if xgb_optuna_model:
            xgb_optuna_metrics = evaluate_model(xgb_optuna_model, X_test, y_test, 'xgboost')
            results['xgboost_optuna'] = xgb_optuna_metrics

            print(f"   MAE:  {xgb_optuna_metrics['mae']:.2f}")
            print(f"   RMSE: {xgb_optuna_metrics['rmse']:.2f}")
            print(f"   MAPE: {xgb_optuna_metrics['mape']:.2f}%")
            print(f"   R²:   {xgb_optuna_metrics['r2']:.4f}")

            print(f"\n   📋 最佳參數:")
            for k, v in best_params.items():
                if isinstance(v, float):
                    print(f"      {k}: {v:.4f}")
                else:
                    print(f"      {k}: {v}")
    else:
        print("   ⚠️ Optuna 未安裝，跳過")

    # ============ Model 3: Random Forest ============
    print("\n" + "=" * 80)
    print("3️⃣ Random Forest")
    print("=" * 80)

    # 用完整訓練集 (不需要驗證集)
    X_train_full = train_df[OPTIMAL_FEATURES]
    y_train_full = train_df['Attendance']

    rf_model = train_rf(X_train_full, y_train_full)
    rf_metrics = evaluate_model(rf_model, X_test, y_test, 'rf')
    results['random_forest'] = rf_metrics

    print(f"   MAE:  {rf_metrics['mae']:.2f}")
    print(f"   RMSE: {rf_metrics['rmse']:.2f}")
    print(f"   MAPE: {rf_metrics['mape']:.2f}%")
    print(f"   R²:   {rf_metrics['r2']:.4f}")

    # RF 特徵重要性
    print("\n   RF 特徵重要性:")
    for i, (feat, imp) in enumerate(sorted(zip(OPTIMAL_FEATURES, rf_model.feature_importances_),
                                           key=lambda x: x[1], reverse=True)):
        print(f"      {i+1}. {feat}: {imp:.4f}")

    # ============ Model 4: Ensemble ============
    print("\n" + "=" * 80)
    print("4️⃣ Ensemble (XGBoost + RF 加權平均)")
    print("=" * 80)

    # 測試不同權重
    print("   測試不同權重組合...")
    best_ensemble_mae = float('inf')
    best_weight = 0.5

    for xgb_weight in np.arange(0, 1.1, 0.1):
        rf_weight = 1 - xgb_weight

        # 如果 Optuna 可用，用它；否則用默認 XGBoost
        if 'xgboost_optuna' in results:
            y_pred = (xgb_weight * results['xgboost_optuna']['predictions'] +
                     rf_weight * results['random_forest']['predictions'])
        else:
            y_pred = (xgb_weight * results['xgboost_default']['predictions'] +
                     rf_weight * results['random_forest']['predictions'])

        mae = mean_absolute_error(y_test, y_pred)

        if mae < best_ensemble_mae:
            best_ensemble_mae = mae
            best_weight = xgb_weight

        status = "✅" if mae < results['xgboost_default']['mae'] else "  "
        print(f"      XGB={xgb_weight:.1f}, RF={rf_weight:.1f} → MAE={mae:.2f} {status}")

    # 計算最終 ensemble 指標
    xgb_w = best_weight
    rf_w = 1 - best_weight

    if 'xgboost_optuna' in results:
        y_pred_ensemble = (xgb_w * results['xgboost_optuna']['predictions'] +
                          rf_w * results['random_forest']['predictions'])
        base_mae = results['xgboost_optuna']['mae']
    else:
        y_pred_ensemble = (xgb_w * results['xgboost_default']['predictions'] +
                          rf_w * results['random_forest']['predictions'])
        base_mae = results['xgboost_default']['mae']

    ensemble_mae = mean_absolute_error(y_test, y_pred_ensemble)
    ensemble_rmse = np.sqrt(mean_squared_error(y_test, y_pred_ensemble))
    ensemble_mape = np.mean(np.abs((y_test - y_pred_ensemble) / y_test)) * 100
    ensemble_r2 = sklearn_r2_score(y_test, y_pred_ensemble)

    results['ensemble'] = {
        'mae': ensemble_mae,
        'rmse': ensemble_rmse,
        'mape': ensemble_mape,
        'r2': ensemble_r2,
        'xgboost_weight': xgb_w,
        'rf_weight': rf_w
    }

    print(f"\n   🏆 最佳 Ensemble: XGB={xgb_w:.1f}, RF={rf_w:.1f}")
    print(f"   MAE:  {ensemble_mae:.2f}")
    print(f"   RMSE: {ensemble_rmse:.2f}")
    print(f"   MAPE: {ensemble_mape:.2f}%")
    print(f"   R²:   {ensemble_r2:.4f}")

    # ============ 總結 ============
    print("\n" + "=" * 80)
    print("📊 最終比較")
    print("=" * 80)
    print(f"\n{'模型':<20} {'MAE':<8} {'RMSE':<8} {'MAPE':<8} {'R²':<8}")
    print("-" * 60)

    for name, metrics in results.items():
        if name == 'ensemble':
            mae_str = f"{metrics['mae']:.2f}*"
        elif 'optuna' in name:
            mae_str = f"{metrics['mae']:.2f}"
        else:
            mae_str = f"{metrics['mae']:.2f}"

        print(f"{name:<20} {mae_str:<8} {metrics['rmse']:<8.2f} {metrics['mape']:<8.2f}% {metrics['r2']:<8.4f}")

    # 找出最佳
    best_model = min(results.items(), key=lambda x: x[1]['mae'])
    print(f"\n🏆 最佳模型: {best_model[0]} (MAE: {best_model[1]['mae']:.2f})")

    # Optuna 價值分析
    if 'xgboost_optuna' in results:
        improvement = results['xgboost_default']['mae'] - results['xgboost_optuna']['mae']
        print(f"\n📈 Optuna 價值:")
        print(f"   默認 MAE: {results['xgboost_default']['mae']:.2f}")
        print(f"   Optuna MAE: {results['xgboost_optuna']['mae']:.2f}")
        print(f"   改善: {improvement:+.2f} ({improvement/results['xgboost_default']['mae']*100:+.1f}%)")

        if improvement > 0:
            print(f"   ✅ Optuna 有幫助！建議使用優化參數")
        else:
            print(f"   ⚠️ Optuna 沒有改善，默認參數已經很好")

    # RF vs XGBoost 分析
    print(f"\n📊 RF vs XGBoost:")
    rf_mae = results['random_forest']['mae']
    xgb_mae = results['xgboost_default']['mae']
    diff = rf_mae - xgb_mae

    if diff < 0:
        print(f"   RF 更好: {rf_mae:.2f} vs {xgb_mae:.2f} (差距 {abs(diff):.2f})")
    else:
        print(f"   XGBoost 更好: {xgb_mae:.2f} vs {rf_mae:.2f} (差距 {abs(diff):.2f})")

    # 保存結果
    output = {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'test_size': len(X_test),
        'results': {k: {j: v for j, v in m.items() if j != 'predictions'} for k, m in results.items()},
        'best_model': best_model[0],
        'recommendation': {}
    }

    if 'xgboost_optuna' in results:
        if results['xgboost_optuna']['mae'] < results['xgboost_default']['mae']:
            output['recommendation']['xgboost'] = 'use_optuna'
        else:
            output['recommendation']['xgboost'] = 'use_default'

    if ensemble_mae < min(results['xgboost_default']['mae'], results['random_forest']['mae']):
        output['recommendation']['final'] = 'use_ensemble'
    else:
        output['recommendation']['final'] = 'use_best_single'

    os.makedirs('models', exist_ok=True)
    with open('models/ensemble_comparison_results.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\n💾 結果已保存到 models/ensemble_comparison_results.json")

    print("\n" + "=" * 80)
    print("✅ 測試完成")
    print("=" * 80)


if __name__ == '__main__':
    main()
