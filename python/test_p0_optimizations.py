"""
P0 優先任務測試腳本
測試預期改善最大的優化項目

目標: MAE 15.77 → 12.5 (約 20% 改善)

P0 項目:
1. 高級滾動統計特徵 (+1.5 MAE 改善預期)
2. Stacking Ensemble (+1.0 MAE 改善預期)
3. 分層建模 (工作日/週末) (+0.8 MAE 改善預期)
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
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import json
import os
from datetime import datetime
import psycopg2
from psycopg2.extras import RealDictCursor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_engineering import create_comprehensive_features, load_weather_history, add_weather_features
from feature_engineering_v2 import create_enhanced_features, get_enhanced_feature_columns
from stacking_ensemble import compare_all_ensembles, StackingEnsemble


def get_db_connection():
    """連接到 Railway Database"""
    password = os.environ.get('PGPASSWORD') or os.environ.get('DATABASE_PASSWORD') or 'nIdJPREHqkBdMgUifrazOsVlWbxsmDGq'
    return psycopg2.connect(
        host=os.environ.get('PGHOST', 'tramway.proxy.rlwy.net'),
        port=int(os.environ.get('PGPORT', '45703')),
        user=os.environ.get('PGUSER', 'postgres'),
        password=password,
        database=os.environ.get('PGDATABASE', 'railway'),
        sslmode='require'
    )


def load_all_data():
    """從數據庫加載所有歷史數據"""
    print("=" * 80)
    print("📥 加載歷史數據")
    print("=" * 80)

    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            SELECT date as "Date", patient_count as "Attendance"
            FROM actual_data
            ORDER BY date ASC
        """)

        rows = cur.fetchall()
        df = pd.DataFrame(rows)

        cur.close()
        conn.close()

        df['Date'] = pd.to_datetime(df['Date'])
        print(f"   ✅ 成功加載 {len(df)} 筆數據")
        print(f"   📅 日期範圍: {df['Date'].min()} → {df['Date'].max()}")

        return df

    except Exception as e:
        print(f"   ❌ 數據庫連接失敗: {e}")
        return None


def calculate_metrics(y_true, y_pred):
    """計算評估指標"""
    return {
        'mae': mean_absolute_error(y_true, y_pred),
        'rmse': np.sqrt(mean_squared_error(y_true, y_pred)),
        'r2': r2_score(y_true, y_pred)
    }


def prepare_test_data(df):
    """準備測試數據（排除 COVID）"""
    # 排除 COVID 期間
    covid_start = pd.Timestamp('2020-02-01')
    covid_end = pd.Timestamp('2022-06-30')
    df = df[~((df['Date'] >= covid_start) & (df['Date'] <= covid_end))].copy()

    # 添加天氣數據
    weather_df = load_weather_history()
    if weather_df is not None:
        df = add_weather_features(df, weather_df)

    # 確保 Date 是 datetime
    df['Date'] = pd.to_datetime(df['Date'])

    # 創建特徵
    df = create_comprehensive_features(df, ai_factors_dict=None)
    df = df.dropna(subset=['Attendance'])

    # 分割數據
    split_idx = int(len(df) * 0.8)
    train = df[:split_idx].copy()
    test = df[split_idx:].copy()

    return train, test


def test_enhanced_features():
    """
    測試 1: 增強特徵工程
    預期: MAE 15.77 → 14.5
    """
    print("\n" + "=" * 80)
    print("🧪 測試 1: 增強特徵工程")
    print("=" * 80)

    df = load_all_data()
    if df is None:
        return None

    # 排除 COVID
    covid_start = pd.Timestamp('2020-02-01')
    covid_end = pd.Timestamp('2022-06-30')
    df = df[~((df['Date'] >= covid_start) & (df['Date'] <= covid_end))].copy()

    # 添加天氣
    weather_df = load_weather_history()
    if weather_df is not None:
        df = add_weather_features(df, weather_df)
    df['Date'] = pd.to_datetime(df['Date'])

    # 使用增強特徵
    df = create_enhanced_features(df, include_aqhi=True)
    df = df.dropna(subset=['Attendance'])

    # 獲取增強特徵
    enhanced_features = get_enhanced_feature_columns()
    enhanced_features = [c for c in enhanced_features if c in df.columns]

    print(f"\n   使用 {len(enhanced_features)} 個增強特徵")

    # 分割
    split_idx = int(len(df) * 0.8)
    train = df[:split_idx].copy()
    test = df[split_idx:].copy()

    X_train = train[enhanced_features].fillna(0)
    y_train = train['Attendance'].values
    X_test = test[enhanced_features].fillna(0)
    y_test = test['Attendance'].values

    # 訓練 XGBoost
    print("\n   訓練 XGBoost (增強特徵)...")
    model = xgb.XGBRegressor(
        n_estimators=500,
        max_depth=8,
        learning_rate=0.05,
        subsample=0.85,
        colsample_bytree=0.85,
        objective='reg:squarederror',
        tree_method='hist',
        random_state=42,
        n_jobs=-1
    )
    model.fit(X_train.values, y_train, verbose=False)

    # 預測
    y_pred = model.predict(X_test.values)
    metrics = calculate_metrics(y_test, y_pred)

    print(f"\n   📊 結果:")
    print(f"      MAE:  {metrics['mae']:.2f}")
    print(f"      RMSE: {metrics['rmse']:.2f}")
    print(f"      R²:   {metrics['r2']:.4f}")

    return {
        'name': 'Enhanced Features',
        'mae': metrics['mae'],
        'rmse': metrics['rmse'],
        'r2': metrics['r2'],
        'feature_count': len(enhanced_features)
    }


def test_stacking_ensemble():
    """
    測試 2: Stacking Ensemble
    預期: MAE 15.77 → 14.8
    """
    print("\n" + "=" * 80)
    print("🧪 測試 2: Stacking Ensemble")
    print("=" * 80)

    df = load_all_data()
    if df is None:
        return None

    # 排除 COVID + 天氣
    covid_start = pd.Timestamp('2020-02-01')
    covid_end = pd.Timestamp('2022-06-30')
    df = df[~((df['Date'] >= covid_start) & (df['Date'] <= covid_end))].copy()

    weather_df = load_weather_history()
    if weather_df is not None:
        df = add_weather_features(df, weather_df)
    df['Date'] = pd.to_datetime(df['Date'])

    # 使用基礎特徵（避免過擬合）
    df = create_comprehensive_features(df, ai_factors_dict=None)
    df = df.dropna(subset=['Attendance'])

    base_features = [
        "Attendance_EWMA7", "Attendance_EWMA14", "Daily_Change", "Monthly_Change",
        "Attendance_Lag1", "Weekly_Change", "Attendance_Rolling7", "Attendance_Position7",
        "Attendance_Lag30", "Attendance_Lag7", "Day_of_Week", "Lag1_Diff",
        "DayOfWeek_sin", "Attendance_Rolling14", "Attendance_Position14",
        "Attendance_Position30", "Attendance_Rolling3", "Attendance_Min7",
        "Attendance_Median14", "DayOfWeek_Target_Mean", "Attendance_Median3",
        "Attendance_EWMA30", "Is_Winter_Flu_Season", "Is_Weekend", "Holiday_Factor"
    ]
    base_features = [c for c in base_features if c in df.columns]

    # 分割
    split_idx = int(len(df) * 0.8)
    train = df[:split_idx].copy()
    test = df[split_idx:].copy()

    # 比較所有 Ensemble 方法
    results, best = compare_all_ensembles(train, test, base_features)

    return {
        'name': best[0],
        'mae': best[1]['mae'],
        'results': results
    }


def test_stratified_modeling():
    """
    測試 3: 分層建模 (工作日 vs 週末)
    預期: MAE 15.77 → 15.0
    """
    print("\n" + "=" * 80)
    print("🧪 測試 3: 分層建模 (工作日 vs 週末)")
    print("=" * 80)

    df = load_all_data()
    if df is None:
        return None

    # 排除 COVID + 天氣
    covid_start = pd.Timestamp('2020-02-01')
    covid_end = pd.Timestamp('2022-06-30')
    df = df[~((df['Date'] >= covid_start) & (df['Date'] <= covid_end))].copy()

    weather_df = load_weather_history()
    if weather_df is not None:
        df = add_weather_features(df, weather_df)
    df['Date'] = pd.to_datetime(df['Date'])

    df = create_comprehensive_features(df, ai_factors_dict=None)
    df = df.dropna(subset=['Attendance'])

    base_features = [
        "Attendance_EWMA7", "Attendance_EWMA14", "Daily_Change", "Monthly_Change",
        "Attendance_Lag1", "Weekly_Change", "Attendance_Rolling7", "Attendance_Position7",
        "Attendance_Lag30", "Attendance_Lag7", "Day_of_Week", "Lag1_Diff",
        "DayOfWeek_sin", "Attendance_Rolling14", "Attendance_Position14",
        "Attendance_Position30", "Attendance_Rolling3", "Attendance_Min7",
        "Attendance_Median14", "DayOfWeek_Target_Mean", "Attendance_Median3",
        "Attendance_EWMA30", "Is_Winter_Flu_Season", "Is_Weekend", "Holiday_Factor"
    ]
    base_features = [c for c in base_features if c in df.columns]

    # 分割
    split_idx = int(len(df) * 0.8)
    train = df[:split_idx].copy()
    test = df[split_idx:].copy()

    # 分層模型
    train_weekday = train[train['Is_Weekend'] == 0].copy()
    train_weekend = train[train['Is_Weekend'] == 1].copy()

    test_weekday = test[test['Is_Weekend'] == 0].copy()
    test_weekend = test[test['Is_Weekend'] == 1].copy()

    print(f"\n   工作日: 訓練 {len(train_weekday)}, 測試 {len(test_weekday)}")
    print(f"   週末:   訓練 {len(train_weekend)}, 測試 {len(test_weekend)}")

    # 訓練工作日模型
    X_train_wd = train_weekday[base_features].fillna(0)
    y_train_wd = train_weekday['Attendance'].values
    X_test_wd = test_weekday[base_features].fillna(0)
    y_test_wd = test_weekday['Attendance'].values

    model_wd = xgb.XGBRegressor(
        n_estimators=500, max_depth=8, learning_rate=0.05,
        objective='reg:squarederror', random_state=42, n_jobs=-1
    )
    model_wd.fit(X_train_wd, y_train_wd, verbose=False)
    pred_wd = model_wd.predict(X_test_wd)

    # 訓練週末模型
    X_train_we = train_weekend[base_features].fillna(0)
    y_train_we = train_weekend['Attendance'].values
    X_test_we = test_weekend[base_features].fillna(0)
    y_test_we = test_weekend['Attendance'].values

    model_we = xgb.XGBRegressor(
        n_estimators=500, max_depth=8, learning_rate=0.05,
        objective='reg:squarederror', random_state=42, n_jobs=-1
    )
    model_we.fit(X_train_we, y_train_we, verbose=False)
    pred_we = model_we.predict(X_test_we)

    # 合併預測
    y_true_combined = np.concatenate([y_test_wd, y_test_we])
    y_pred_combined = np.concatenate([pred_wd, pred_we])

    metrics = calculate_metrics(y_true_combined, y_pred_combined)

    print(f"\n   📊 分層模型結果:")
    print(f"      工作日 MAE: {mean_absolute_error(y_test_wd, pred_wd):.2f}")
    print(f"      週末 MAE:   {mean_absolute_error(y_test_we, pred_we):.2f}")
    print(f"      總體 MAE:   {metrics['mae']:.2f}")
    print(f"      R²:         {metrics['r2']:.4f}")

    return {
        'name': 'Stratified Modeling',
        'mae': metrics['mae'],
        'rmse': metrics['rmse'],
        'r2': metrics['r2']
    }


def test_combined_p0():
    """
    測試 4: 結合所有 P0 優化
    預期: MAE 15.77 → 12.5
    """
    print("\n" + "=" * 80)
    print("🧪 測試 4: 結合所有 P0 優化")
    print("=" * 80)

    df = load_all_data()
    if df is None:
        return None

    # 排除 COVID + 天氣
    covid_start = pd.Timestamp('2020-02-01')
    covid_end = pd.Timestamp('2022-06-30')
    df = df[~((df['Date'] >= covid_start) & (df['Date'] <= covid_end))].copy()

    weather_df = load_weather_history()
    if weather_df is not None:
        df = add_weather_features(df, weather_df)
    df['Date'] = pd.to_datetime(df['Date'])

    # 增強特徵
    df = create_enhanced_features(df, include_aqhi=True)
    df = df.dropna(subset=['Attendance'])

    enhanced_features = get_enhanced_feature_columns()
    enhanced_features = [c for c in enhanced_features if c in df.columns]

    print(f"\n   使用 {len(enhanced_features)} 個增強特徵")

    # 分割
    split_idx = int(len(df) * 0.8)
    train = df[:split_idx].copy()
    test = df[split_idx:].copy()

    # Stacking Ensemble
    print("\n   訓練 Stacking Ensemble (增強特徵)...")

    stacking = StackingEnsemble(use_meta='ridge')

    val_size = len(train) // 5
    train_val = train[-val_size:].copy()
    train_main = train[:-val_size].copy()

    X_train = train_main[enhanced_features].fillna(0)
    y_train = train_main['Attendance'].values
    X_val = train_val[enhanced_features].fillna(0)
    y_val = train_val['Attendance'].values
    X_test = test[enhanced_features].fillna(0)
    y_test = test['Attendance'].values

    stacking.fit(X_train, y_train, X_val, y_val)

    y_pred = stacking.predict(X_test)
    metrics = calculate_metrics(y_test, y_pred)

    print(f"\n   📊 最終結果 (P0 全部優化):")
    print(f"      MAE:  {metrics['mae']:.2f}")
    print(f"      RMSE: {metrics['rmse']:.2f}")
    print(f"      R²:   {metrics['r2']:.4f}")

    # 與基準比較
    baseline_mae = 15.77
    improvement = ((baseline_mae - metrics['mae']) / baseline_mae) * 100

    print(f"\n   vs 基準 (MAE {baseline_mae}):")
    print(f"      改善: {improvement:+.1f}%")

    return {
        'name': 'P0 Combined (Enhanced + Stacking)',
        'mae': metrics['mae'],
        'rmse': metrics['rmse'],
        'r2': metrics['r2'],
        'improvement_pct': improvement
    }


def main():
    """運行所有 P0 測試"""
    print("=" * 80)
    print("🚀 P0 優先任務測試")
    print("目標: MAE 15.77 → 12.5")
    print("=" * 80)
    print(f"開始時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    results = []
    baseline_mae = 15.77

    # 測試 1: 增強特徵
    try:
        result1 = test_enhanced_features()
        if result1:
            results.append(result1)
    except Exception as e:
        print(f"   ❌ 測試 1 失敗: {e}")

    # 測試 2: Stacking
    try:
        result2 = test_stacking_ensemble()
        if result2:
            results.append(result2)
    except Exception as e:
        print(f"   ❌ 測試 2 失敗: {e}")

    # 測試 3: 分層建模
    try:
        result3 = test_stratified_modeling()
        if result3:
            results.append(result3)
    except Exception as e:
        print(f"   ❌ 測試 3 失敗: {e}")

    # 測試 4: 結合所有
    try:
        result4 = test_combined_p0()
        if result4:
            results.append(result4)
    except Exception as e:
        print(f"   ❌ 測試 4 失敗: {e}")

    # 總結
    print("\n" + "=" * 80)
    print("🏆 P0 測試總結")
    print("=" * 80)

    print(f"\n{'方法':<35} {'MAE':>10} {'改善':>10}")
    print("-" * 60)
    print(f"{'基準 (當前最佳)':<35} {baseline_mae:>10.2f} {'---':>10}")

    for r in results:
        improvement = ((baseline_mae - r['mae']) / baseline_mae) * 100
        print(f"{r['name']:<35} {r['mae']:>10.2f} {improvement:>+9.1f}%")

    # 找出最佳
    best = min(results, key=lambda x: x['mae'])
    best_improvement = ((baseline_mae - best['mae']) / baseline_mae) * 100

    print("\n" + "=" * 80)
    print(f"🥇 最佳方法: {best['name']}")
    print(f"   MAE: {best['mae']:.2f} (改善 {best_improvement:+.1f}%)")
    print("=" * 80)

    # 保存結果
    output = {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'baseline_mae': baseline_mae,
        'results': results,
        'best': best
    }

    os.makedirs('models', exist_ok=True)
    with open('models/p0_test_results.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False, default=lambda x: float(x) if isinstance(x, (np.integer, np.floating)) else x)

    print(f"\n✅ 結果已保存到 models/p0_test_results.json")
    print(f"\n結束時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")


if __name__ == '__main__':
    main()
