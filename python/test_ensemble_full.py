"""
完整測試：Ensemble 模型 + AI 因素 + 天氣因素
使用完整數據庫數據 (4064 天)
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
from sklearn.ensemble import RandomForestRegressor
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import json
import os
from datetime import datetime
import psycopg2
from psycopg2.extras import RealDictCursor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_engineering import create_comprehensive_features

def get_db_connection():
    """連接到 Railway Production Database"""
    password = os.environ.get('PGPASSWORD') or os.environ.get('DATABASE_PASSWORD') or 'nIdJPREHqkBdMgUifrazOsVlWbxsmDGq'

    return psycopg2.connect(
        host=os.environ.get('PGHOST', 'tramway.proxy.rlwy.net'),
        port=int(os.environ.get('PGPORT', '45703')),
        user=os.environ.get('PGUSER', 'postgres'),
        password=password,
        database=os.environ.get('PGDATABASE', 'railway'),
        sslmode='require'
    )

def load_full_data_from_db():
    """從數據庫加載完整數據"""
    print("📥 連接 Railway Database...")

    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # 獲取所有數據
        cur.execute("""
            SELECT date as "Date", patient_count as "Attendance"
            FROM actual_data
            ORDER BY date
        """)

        rows = cur.fetchall()
        df = pd.DataFrame(rows)

        cur.close()
        conn.close()

        print(f"   ✅ 成功加載 {len(df)} 筆數據")
        print(f"   📅 日期範圍: {df['Date'].min()} → {df['Date'].max()}")

        return df

    except Exception as e:
        print(f"   ❌ 數據庫連接失敗: {e}")
        return None

def load_weather_data():
    """加載天氣數據"""
    weather_paths = [
        'weather_history.csv',
        'python/weather_history.csv',
        'c:/Github/ndh-aed-prediction/python/weather_history.csv',
    ]

    for path in weather_paths:
        if os.path.exists(path):
            df = pd.read_csv(path)
            df['Date'] = pd.to_datetime(df['Date'])
            print(f"   ✅ 加載天氣數據: {len(df)} 筆")
            return df

    print("   ⚠️ 未找到天氣數據")
    return None

def create_weather_change_features(df):
    """創建天氣變化特徵"""
    df = df.copy()
    df = df.sort_values('Date').reset_index(drop=True)

    # 溫度變化率
    df['temp_change_1d'] = df['mean_temp'].diff(1)
    df['temp_change_3d'] = df['mean_temp'].diff(3)

    # 突然降溫/升溫
    df['sudden_temp_drop'] = (df['temp_change_1d'] < -5).astype(int)
    df['sudden_temp_rise'] = (df['temp_change_1d'] > 5).astype(int)

    # 溫度波動性
    df['temp_volatility_7d'] = df['mean_temp'].rolling(window=7, min_periods=3).std()

    # 季節偏離
    df['month'] = df['Date'].dt.month
    monthly_avg = df.groupby('month')['mean_temp'].transform('mean')
    df['temp_deviation_from_seasonal'] = df['mean_temp'] - monthly_avg

    return df

def load_ai_factors():
    """加載 AI 因素（如果存在）"""
    ai_paths = [
        'models/ai_factors.json',
        'python/models/ai_factors.json',
        'c:/Github/ndh-aed-prediction/python/models/ai_factors.json',
    ]

    for path in ai_paths:
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                print(f"   ✅ 加載 AI 因素: {len(data)} 筆")
                return data

    print("   ⚠️ 未找到 AI 因素數據")
    return None

def calculate_metrics(y_true, y_pred):
    mae = mean_absolute_error(y_true, y_pred)
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))
    mape = np.mean(np.abs((y_true - y_pred) / y_true)) * 100
    r2 = r2_score(y_true, y_pred)
    return {'mae': mae, 'rmse': rmse, 'mape': mape, 'r2': r2}

def main():
    print("=" * 80)
    print("🔬 完整測試: Ensemble + AI + 天氣因素")
    print("   使用完整數據庫數據")
    print("=" * 80)
    print(f"⏰ 開始時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # 加載數據
    df = load_full_data_from_db()
    if df is None:
        return

    df['Date'] = pd.to_datetime(df['Date'])

    # 排除 COVID
    covid_start = pd.Timestamp('2020-02-01')
    covid_end = pd.Timestamp('2022-06-30')
    covid_mask = (df['Date'] >= covid_start) & (df['Date'] <= covid_end)
    df = df[~covid_mask].copy()

    print(f"\n📊 數據量: {len(df)} 天 (排除 COVID)")

    # 創建基礎特徵
    print("\n🔧 創建基礎特徵...")
    df = create_comprehensive_features(df)
    df = df.dropna(subset=['Attendance'])

    # 加載天氣數據
    print("\n🌤️ 加載天氣數據...")
    weather_df = load_weather_data()

    weather_features = []
    if weather_df is not None:
        weather_df = create_weather_change_features(weather_df)
        df = df.merge(weather_df, on='Date', how='left')

        # 天氣變化特徵
        weather_features = [
            'temp_change_1d', 'temp_change_3d',
            'sudden_temp_drop', 'sudden_temp_rise',
            'temp_volatility_7d', 'temp_deviation_from_seasonal',
            'mean_temp', 'max_temp', 'min_temp',
            'is_very_hot', 'is_hot', 'is_cold', 'is_very_cold'
        ]
        weather_features = [c for c in weather_features if c in df.columns]

        # 填充缺失值
        for col in weather_features:
            df[col] = df[col].fillna(df[col].median())

        print(f"   ✅ 天氣特徵: {len(weather_features)} 個")

    # 加載 AI 因素
    print("\n�� 加載 AI 因素...")
    ai_factors = load_ai_factors()

    ai_features = []
    if ai_factors:
        # 將 AI 因素轉換為 DataFrame
        ai_df = pd.DataFrame([
            {'Date': pd.to_datetime(date), 'ai_factor': factor}
            for date, factor in ai_factors.items()
        ])
        df = df.merge(ai_df, on='Date', how='left')
        df['ai_factor'] = df['ai_factor'].fillna(1.0)
        ai_features = ['ai_factor']
        print(f"   ✅ AI 特徵: {len(ai_features)} 個")

    # 基礎特徵
    base_features = [
        "Attendance_Lag1", "Attendance_Lag7", "Attendance_Same_Weekday_Avg",
        "Day_of_Week", "DayOfWeek_Target_Mean", "Attendance_Rolling7",
        "Attendance_EWMA7", "Attendance_Lag14", "Attendance_Lag30",
        "Daily_Change", "Weekly_Change", "Is_Weekend",
        "Holiday_Factor", "Attendance_Std7", "Month"
    ]
    base_features = [c for c in base_features if c in df.columns]

    # 所有特徵
    all_features = base_features + weather_features + ai_features

    print(f"\n📊 特徵總數: {len(all_features)}")
    print(f"   基礎特徵: {len(base_features)}")
    print(f"   天氣特徵: {len(weather_features)}")
    print(f"   AI 特徵: {len(ai_features)}")

    # 時間序列分割
    split_idx = int(len(df) * 0.8)
    train_data = df[:split_idx].copy()
    test_data = df[split_idx:].copy()

    print(f"\n📊 數據分割:")
    print(f"   訓練集: {len(train_data)} 天")
    print(f"   測試集: {len(test_data)} 天")

    y_train = train_data['Attendance'].values
    y_test = test_data['Attendance'].values

    results = {}

    # ============================================
    # 測試 1: 基礎 Random Forest
    # ============================================
    print("\n" + "=" * 80)
    print("📊 測試 1: Random Forest (基礎特徵)")
    print("=" * 80)

    X_train_base = train_data[base_features].fillna(0)
    X_test_base = test_data[base_features].fillna(0)

    rf_base = RandomForestRegressor(
        n_estimators=200,
        max_depth=12,
        min_samples_split=10,
        random_state=42,
        n_jobs=-1
    )
    rf_base.fit(X_train_base, y_train)
    rf_base_pred = rf_base.predict(X_test_base)

    rf_base_metrics = calculate_metrics(y_test, rf_base_pred)
    results['rf_base'] = rf_base_metrics

    print(f"   MAE:  {rf_base_metrics['mae']:.2f}")
    print(f"   MAPE: {rf_base_metrics['mape']:.2f}%")
    print(f"   R²:   {rf_base_metrics['r2']:.4f}")

    # ============================================
    # 測試 2: 基礎 XGBoost
    # ============================================
    print("\n" + "=" * 80)
    print("📊 測試 2: XGBoost (基礎特徵)")
    print("=" * 80)

    xgb_base = xgb.XGBRegressor(
        n_estimators=500,
        max_depth=8,
        learning_rate=0.05,
        random_state=42
    )
    xgb_base.fit(X_train_base, y_train)
    xgb_base_pred = xgb_base.predict(X_test_base)

    xgb_base_metrics = calculate_metrics(y_test, xgb_base_pred)
    results['xgb_base'] = xgb_base_metrics

    print(f"   MAE:  {xgb_base_metrics['mae']:.2f}")
    print(f"   MAPE: {xgb_base_metrics['mape']:.2f}%")
    print(f"   R²:   {xgb_base_metrics['r2']:.4f}")

    # ============================================
    # 測試 3: RF + 所有特徵
    # ============================================
    print("\n" + "=" * 80)
    print("📊 測試 3: Random Forest + 天氣 + AI")
    print("=" * 80)

    X_train_all = train_data[all_features].fillna(0)
    X_test_all = test_data[all_features].fillna(0)

    rf_all = RandomForestRegressor(
        n_estimators=200,
        max_depth=12,
        min_samples_split=10,
        random_state=42,
        n_jobs=-1
    )
    rf_all.fit(X_train_all, y_train)
    rf_all_pred = rf_all.predict(X_test_all)

    rf_all_metrics = calculate_metrics(y_test, rf_all_pred)
    results['rf_all'] = rf_all_metrics

    improvement_rf = ((rf_base_metrics['mae'] - rf_all_metrics['mae']) / rf_base_metrics['mae']) * 100

    print(f"   MAE:  {rf_all_metrics['mae']:.2f} ({improvement_rf:+.1f}%)")
    print(f"   MAPE: {rf_all_metrics['mape']:.2f}%")
    print(f"   R²:   {rf_all_metrics['r2']:.4f}")

    # ============================================
    # 測試 4: XGB + 所有特徵
    # ============================================
    print("\n" + "=" * 80)
    print("📊 測試 4: XGBoost + 天氣 + AI")
    print("=" * 80)

    xgb_all = xgb.XGBRegressor(
        n_estimators=500,
        max_depth=8,
        learning_rate=0.05,
        random_state=42
    )
    xgb_all.fit(X_train_all, y_train)
    xgb_all_pred = xgb_all.predict(X_test_all)

    xgb_all_metrics = calculate_metrics(y_test, xgb_all_pred)
    results['xgb_all'] = xgb_all_metrics

    improvement_xgb = ((xgb_base_metrics['mae'] - xgb_all_metrics['mae']) / xgb_base_metrics['mae']) * 100

    print(f"   MAE:  {xgb_all_metrics['mae']:.2f} ({improvement_xgb:+.1f}%)")
    print(f"   MAPE: {xgb_all_metrics['mape']:.2f}%")
    print(f"   R²:   {xgb_all_metrics['r2']:.4f}")

    # ============================================
    # 測試 5: Simple Ensemble (50/50)
    # ============================================
    print("\n" + "=" * 80)
    print("📊 測試 5: Simple Ensemble (RF 50% + XGB 50%)")
    print("=" * 80)

    ensemble_simple = 0.5 * rf_all_pred + 0.5 * xgb_all_pred
    ensemble_simple_metrics = calculate_metrics(y_test, ensemble_simple)
    results['ensemble_simple'] = ensemble_simple_metrics

    print(f"   MAE:  {ensemble_simple_metrics['mae']:.2f}")
    print(f"   MAPE: {ensemble_simple_metrics['mape']:.2f}%")
    print(f"   R²:   {ensemble_simple_metrics['r2']:.4f}")

    # ============================================
    # 測試 6: Weighted Ensemble (基於驗證集表現)
    # ============================================
    print("\n" + "=" * 80)
    print("📊 測試 6: Weighted Ensemble (基於表現)")
    print("=" * 80)

    # 計算權重（MAE 越小權重越高）
    rf_weight = (1 / rf_all_metrics['mae']) / ((1 / rf_all_metrics['mae']) + (1 / xgb_all_metrics['mae']))
    xgb_weight = 1 - rf_weight

    print(f"   RF 權重: {rf_weight:.2f}")
    print(f"   XGB 權重: {xgb_weight:.2f}")

    ensemble_weighted = rf_weight * rf_all_pred + xgb_weight * xgb_all_pred
    ensemble_weighted_metrics = calculate_metrics(y_test, ensemble_weighted)
    results['ensemble_weighted'] = ensemble_weighted_metrics

    print(f"   MAE:  {ensemble_weighted_metrics['mae']:.2f}")
    print(f"   MAPE: {ensemble_weighted_metrics['mape']:.2f}%")
    print(f"   R²:   {ensemble_weighted_metrics['r2']:.4f}")

    # ============================================
    # 測試 7: Adaptive Ensemble (根據預測範圍調整)
    # ============================================
    print("\n" + "=" * 80)
    print("📊 測試 7: Adaptive Ensemble (短期 XGB, 長期 RF)")
    print("=" * 80)

    # 模擬不同時間範圍的權重
    ensemble_adaptive = []
    for i in range(len(y_test)):
        if i < 7:  # Day 1-7: XGB 權重更高
            pred = 0.4 * rf_all_pred[i] + 0.6 * xgb_all_pred[i]
        elif i < 30:  # Day 8-30: 平均
            pred = 0.5 * rf_all_pred[i] + 0.5 * xgb_all_pred[i]
        else:  # Day 31+: RF 權重更高
            pred = 0.6 * rf_all_pred[i] + 0.4 * xgb_all_pred[i]
        ensemble_adaptive.append(pred)

    ensemble_adaptive = np.array(ensemble_adaptive)
    ensemble_adaptive_metrics = calculate_metrics(y_test, ensemble_adaptive)
    results['ensemble_adaptive'] = ensemble_adaptive_metrics

    print(f"   MAE:  {ensemble_adaptive_metrics['mae']:.2f}")
    print(f"   MAPE: {ensemble_adaptive_metrics['mape']:.2f}%")
    print(f"   R²:   {ensemble_adaptive_metrics['r2']:.4f}")

    # ============================================
    # 總結比較
    # ============================================
    print("\n" + "=" * 80)
    print("🏆 總結比較")
    print("=" * 80)

    print(f"\n{'模型':<40} {'MAE':<10} {'MAPE':<10} {'R²':<10} {'vs 基準':<10}")
    print("-" * 80)

    baseline_mae = rf_base_metrics['mae']

    model_names = {
        'rf_base': 'RF (基礎) - 基準',
        'xgb_base': 'XGB (基礎)',
        'rf_all': 'RF + 天氣 + AI',
        'xgb_all': 'XGB + 天氣 + AI',
        'ensemble_simple': 'Ensemble 50/50',
        'ensemble_weighted': 'Ensemble 加權',
        'ensemble_adaptive': 'Ensemble 自適應 ⭐'
    }

    sorted_results = sorted(results.items(), key=lambda x: x[1]['mae'])

    for name, metrics in sorted_results:
        improvement = ((baseline_mae - metrics['mae']) / baseline_mae) * 100
        improvement_str = f"{improvement:+.1f}%"
        if improvement > 0:
            improvement_str = f"✅ {improvement_str}"
        else:
            improvement_str = f"❌ {improvement_str}"

        display_name = model_names.get(name, name)
        print(f"{display_name:<40} {metrics['mae']:<10.2f} {metrics['mape']:<10.2f}% {metrics['r2']:<10.4f} {improvement_str:<10}")

    # 統計顯著性測試
    print("\n" + "=" * 80)
    print("📊 統計顯著性分析")
    print("=" * 80)

    best_name = sorted_results[0][0]
    best_metrics = sorted_results[0][1]

    print(f"\n   最佳模型: {model_names[best_name]}")
    print(f"   MAE: {best_metrics['mae']:.2f}")
    print(f"   改善: {((baseline_mae - best_metrics['mae']) / baseline_mae * 100):.1f}%")

    # 保存結果
    output = {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'data_days': len(df),
        'train_days': len(train_data),
        'test_days': len(test_data),
        'features': {
            'base': len(base_features),
            'weather': len(weather_features),
            'ai': len(ai_features),
            'total': len(all_features)
        },
        'results': {k: {
            'mae': float(v['mae']),
            'rmse': float(v['rmse']),
            'mape': float(v['mape']),
            'r2': float(v['r2'])
        } for k, v in results.items()},
        'best_model': best_name,
        'improvement_over_baseline': float((baseline_mae - best_metrics['mae']) / baseline_mae * 100)
    }

    os.makedirs('models', exist_ok=True)
    with open('models/ensemble_full_test_results.json', 'w') as f:
        json.dump(output, f, indent=2)

    print(f"\n✅ 結果已保存到 models/ensemble_full_test_results.json")

if __name__ == '__main__':
    main()
