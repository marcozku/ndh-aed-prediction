"""
正確的基準對比測試
確保所有測試使用相同配置（排除 COVID + 天氣數據）
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


def get_db_connection():
    password = os.environ.get('PGPASSWORD') or 'nIdJPREHqkBdMgUifrazOsVlWbxsmDGq'
    return psycopg2.connect(
        host=os.environ.get('PGHOST', 'tramway.proxy.rlwy.net'),
        port=int(os.environ.get('PGPORT', '45703')),
        user=os.environ.get('PGUSER', 'postgres'),
        password=password,
        database=os.environ.get('PGDATABASE', 'railway'),
        sslmode='require'
    )


def load_data():
    """加載數據"""
    print("=" * 80)
    print("📥 加載數據")
    print("=" * 80)

    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT date as \"Date\", patient_count as \"Attendance\" FROM actual_data ORDER BY date ASC")
        rows = cur.fetchall()
        df = pd.DataFrame(rows)
        cur.close()
        conn.close()

        df['Date'] = pd.to_datetime(df['Date'])
        print(f"   ✅ 成功加載 {len(df)} 筆數據")
        return df
    except Exception as e:
        print(f"   ❌ 錯誤: {e}")
        return None


def prepare_data_with_weather(df):
    """準備數據：排除 COVID + 添加天氣"""
    # 排除 COVID
    covid_start = pd.Timestamp('2020-02-01')
    covid_end = pd.Timestamp('2022-06-30')
    df = df[~((df['Date'] >= covid_start) & (df['Date'] <= covid_end))].copy()
    print(f"   排除 COVID 後: {len(df)} 筆數據")

    # 添加天氣
    weather_df = load_weather_history()
    if weather_df is not None:
        df = add_weather_features(df, weather_df)
        print(f"   ✅ 已添加天氣數據")

    df['Date'] = pd.to_datetime(df['Date'])
    df = create_comprehensive_features(df, ai_factors_dict=None)
    df = df.dropna(subset=['Attendance'])

    # 分割
    split_idx = int(len(df) * 0.8)
    train = df[:split_idx].copy()
    test = df[split_idx:].copy()

    print(f"   訓練集: {len(train)}, 測試集: {len(test)}")

    return train, test, df


def calculate_metrics(y_true, y_pred):
    return {
        'mae': mean_absolute_error(y_true, y_pred),
        'rmse': np.sqrt(mean_squared_error(y_true, y_pred)),
        'r2': r2_score(y_true, y_pred)
    }


def main():
    print("=" * 80)
    print("🔬 模型準確度優化測試")
    print("=" * 80)
    print(f"開始時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # 加載數據
    df = load_data()
    if df is None:
        return

    # 準備數據
    train, test, full_df = prepare_data_with_weather(df)

    # 基礎特徵（天氣特徵）
    base_features = [
        "Attendance_EWMA7", "Attendance_EWMA14", "Daily_Change", "Monthly_Change",
        "Attendance_Lag1", "Weekly_Change", "Attendance_Rolling7", "Attendance_Position7",
        "Attendance_Lag30", "Attendance_Lag7", "Day_of_Week", "Lag1_Diff",
        "DayOfWeek_sin", "Attendance_Rolling14", "Attendance_Position14",
        "Attendance_Position30", "Attendance_Rolling3", "Attendance_Min7",
        "Attendance_Median14", "DayOfWeek_Target_Mean", "Attendance_Median3",
        "Attendance_EWMA30", "Is_Winter_Flu_Season", "Is_Weekend", "Holiday_Factor"
    ]

    # 添加天氣特徵
    weather_features = [c for c in full_df.columns if c.startswith('Weather_')]
    all_features = base_features + weather_features
    all_features = [c for c in all_features if c in train.columns]

    print(f"\n   使用 {len(all_features)} 個特徵")
    print(f"   基礎特徵: {len([c for c in base_features if c in train.columns])}")
    print(f"   天氣特徵: {len(weather_features)}")

    X_train = train[all_features].fillna(0)
    y_train = train['Attendance'].values
    X_test = test[all_features].fillna(0)
    y_test = test['Attendance'].values

    results = []

    # ========================================
    # 1. XGBoost 基準
    # ========================================
    print("\n" + "=" * 80)
    print("1️⃣ XGBoost 基準")
    print("=" * 80)

    xgb_model = xgb.XGBRegressor(
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
    xgb_model.fit(X_train.values, y_train, verbose=False)
    xgb_pred = xgb_model.predict(X_test.values)
    xgb_metrics = calculate_metrics(y_test, xgb_pred)

    print(f"   MAE:  {xgb_metrics['mae']:.2f}")
    print(f"   RMSE: {xgb_metrics['rmse']:.2f}")
    print(f"   R²:   {xgb_metrics['r2']:.4f}")

    results.append({'name': 'XGBoost', 'mae': xgb_metrics['mae'], 'rmse': xgb_metrics['rmse'], 'r2': xgb_metrics['r2']})

    # ========================================
    # 2. Random Forest
    # ========================================
    print("\n" + "=" * 80)
    print("2️⃣ Random Forest")
    print("=" * 80)

    rf_model = RandomForestRegressor(
        n_estimators=200,
        max_depth=12,
        min_samples_split=10,
        random_state=42,
        n_jobs=-1
    )
    rf_model.fit(X_train.values, y_train)
    rf_pred = rf_model.predict(X_test.values)
    rf_metrics = calculate_metrics(y_test, rf_pred)

    print(f"   MAE:  {rf_metrics['mae']:.2f}")
    print(f"   RMSE: {rf_metrics['rmse']:.2f}")
    print(f"   R²:   {rf_metrics['r2']:.4f}")

    results.append({'name': 'Random Forest', 'mae': rf_metrics['mae'], 'rmse': rf_metrics['rmse'], 'r2': rf_metrics['r2']})

    # ========================================
    # 3. Gradient Boosting
    # ========================================
    print("\n" + "=" * 80)
    print("3️⃣ Gradient Boosting")
    print("=" * 80)

    gb_model = GradientBoostingRegressor(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.05,
        random_state=42
    )
    gb_model.fit(X_train.values, y_train)
    gb_pred = gb_model.predict(X_test.values)
    gb_metrics = calculate_metrics(y_test, gb_pred)

    print(f"   MAE:  {gb_metrics['mae']:.2f}")
    print(f"   RMSE: {gb_metrics['rmse']:.2f}")
    print(f"   R²:   {gb_metrics['r2']:.4f}")

    results.append({'name': 'Gradient Boosting', 'mae': gb_metrics['mae'], 'rmse': gb_metrics['rmse'], 'r2': gb_metrics['r2']})

    # ========================================
    # 4. Simple Average Ensemble
    # ========================================
    print("\n" + "=" * 80)
    print("4️⃣ Simple Average Ensemble")
    print("=" * 80)

    ensemble_pred = (xgb_pred + rf_pred + gb_pred) / 3
    ens_metrics = calculate_metrics(y_test, ensemble_pred)

    print(f"   MAE:  {ens_metrics['mae']:.2f}")
    print(f"   RMSE: {ens_metrics['rmse']:.2f}")
    print(f"   R²:   {ens_metrics['r2']:.4f}")

    results.append({'name': 'Ensemble (Simple Average)', 'mae': ens_metrics['mae'], 'rmse': ens_metrics['rmse'], 'r2': ens_metrics['r2']})

    # ========================================
    # 總結
    # ========================================
    print("\n" + "=" * 80)
    print("🏆 測試結果總結")
    print("=" * 80)

    baseline_mae = 15.77  # 之前的最佳結果

    print(f"\n{'模型':<30} {'MAE':>10} {'RMSE':>10} {'R²':>10} {'vs基準':>10}")
    print("-" * 80)

    for r in sorted(results, key=lambda x: x['mae']):
        improvement = ((baseline_mae - r['mae']) / baseline_mae) * 100
        print(f"{r['name']:<30} {r['mae']:>10.2f} {r['rmse']:>10.2f} {r['r2']:>10.4f} {improvement:>+9.1f}%")

    best = min(results, key=lambda x: x['mae'])
    best_improvement = ((baseline_mae - best['mae']) / baseline_mae) * 100

    print("\n" + "=" * 80)
    if best['mae'] < baseline_mae:
        print(f"✅ 最佳模型 {best['name']} MAE = {best['mae']:.2f} (改善 {best_improvement:+.1f}%)")
    else:
        print(f"⚠️ 所有模型都沒有超過基準 (MAE {baseline_mae:.2f})")
        print(f"   最佳: {best['name']} MAE = {best['mae']:.2f}")
    print("=" * 80)

    # 保存結果
    output = {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'baseline_mae': baseline_mae,
        'results': results,
        'best': best
    }

    os.makedirs('models', exist_ok=True)
    with open('models/benchmark_comparison.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False, default=lambda x: float(x) if isinstance(x, (np.integer, np.floating)) else str(x) if isinstance(x, np.ndarray) else x)

    print(f"\n✅ 結果已保存到 models/benchmark_comparison.json")


if __name__ == '__main__':
    main()
