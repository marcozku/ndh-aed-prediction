"""
測試天氣變化特徵（而非絕對值）
Test weather CHANGE features (sudden cold, temperature drops, etc.)
"""
import sys
import io

# Fix Windows encoding
if sys.platform == 'win32':
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except:
        pass

import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import json
import os
from datetime import datetime

# 添加當前目錄到路徑
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_engineering import create_comprehensive_features

def load_data():
    """加載數據"""
    csv_paths = [
        '../ndh_attendance_extracted.csv',
        'ndh_attendance_extracted.csv',
        'c:/Github/ndh-aed-prediction/ndh_attendance_extracted.csv',
    ]
    for csv_path in csv_paths:
        if os.path.exists(csv_path):
            df = pd.read_csv(csv_path)
            if 'date' in df.columns:
                df['Date'] = df['date']
            if 'patient_count' in df.columns:
                df['Attendance'] = df['patient_count']
            if 'attendance' in df.columns:
                df['Attendance'] = df['attendance']
            return df[['Date', 'Attendance']].copy()
    return None

def load_weather_data():
    """加載真實天氣數據"""
    weather_paths = [
        'weather_history.csv',
        'python/weather_history.csv',
        'c:/Github/ndh-aed-prediction/python/weather_history.csv',
    ]

    for path in weather_paths:
        if os.path.exists(path):
            df = pd.read_csv(path)
            df['Date'] = pd.to_datetime(df['Date'])
            return df

    return None

def create_weather_change_features(df):
    """
    創建天氣變化特徵（這才是關鍵！）

    重點：
    - 突然降溫/升溫
    - 溫度波動性
    - 極端天氣變化
    """
    df = df.copy()
    df = df.sort_values('Date').reset_index(drop=True)

    # 1. 溫度變化率（day-to-day）
    df['temp_change_1d'] = df['mean_temp'].diff(1)  # 今天 vs 昨天
    df['temp_change_3d'] = df['mean_temp'].diff(3)  # 今天 vs 3天前
    df['temp_change_7d'] = df['mean_temp'].diff(7)  # 今天 vs 7天前

    # 2. 突然降溫/升溫（絕對值 > 5°C）
    df['sudden_temp_drop'] = (df['temp_change_1d'] < -5).astype(int)
    df['sudden_temp_rise'] = (df['temp_change_1d'] > 5).astype(int)

    # 3. 極端突然降溫（> 8°C）
    df['extreme_temp_drop'] = (df['temp_change_1d'] < -8).astype(int)

    # 4. 溫度波動性（過去7天的標準差）
    df['temp_volatility_7d'] = df['mean_temp'].rolling(window=7, min_periods=3).std()

    # 5. 最高溫變化
    df['max_temp_change_1d'] = df['max_temp'].diff(1)
    df['max_temp_change_3d'] = df['max_temp'].diff(3)

    # 6. 最低溫變化
    df['min_temp_change_1d'] = df['min_temp'].diff(1)

    # 7. 溫差變化（今天溫差 vs 昨天溫差）
    df['temp_range_change'] = df['temp_range'].diff(1)

    # 8. 進入/離開極端天氣
    df['entering_hot_weather'] = ((df['is_hot'] == 1) & (df['is_hot'].shift(1) == 0)).astype(int)
    df['entering_cold_weather'] = ((df['is_cold'] == 1) & (df['is_cold'].shift(1) == 0)).astype(int)
    df['leaving_hot_weather'] = ((df['is_hot'] == 0) & (df['is_hot'].shift(1) == 1)).astype(int)
    df['leaving_cold_weather'] = ((df['is_cold'] == 0) & (df['is_cold'].shift(1) == 1)).astype(int)

    # 9. 連續極端天氣天數
    df['consecutive_hot_days'] = 0
    df['consecutive_cold_days'] = 0

    hot_count = 0
    cold_count = 0
    for i in range(len(df)):
        if df.at[i, 'is_hot'] == 1:
            hot_count += 1
        else:
            hot_count = 0

        if df.at[i, 'is_cold'] == 1:
            cold_count += 1
        else:
            cold_count = 0

        df.at[i, 'consecutive_hot_days'] = hot_count
        df.at[i, 'consecutive_cold_days'] = cold_count

    # 10. 溫度偏離季節平均（異常天氣）
    df['month'] = df['Date'].dt.month
    monthly_avg = df.groupby('month')['mean_temp'].transform('mean')
    df['temp_deviation_from_seasonal'] = df['mean_temp'] - monthly_avg

    # 11. 極端溫度偏離
    df['extreme_cold_for_season'] = (df['temp_deviation_from_seasonal'] < -5).astype(int)
    df['extreme_hot_for_season'] = (df['temp_deviation_from_seasonal'] > 5).astype(int)

    return df

def calculate_metrics(y_true, y_pred):
    """計算評估指標"""
    mae = mean_absolute_error(y_true, y_pred)
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))
    mape = np.mean(np.abs((y_true - y_pred) / y_true)) * 100
    r2 = r2_score(y_true, y_pred)

    return {
        'mae': mae,
        'rmse': rmse,
        'mape': mape,
        'r2': r2
    }

def main():
    print("=" * 70)
    print("🌡️ 測試天氣變化特徵（突然降溫、溫度波動等）")
    print("=" * 70)
    print(f"⏰ 開始時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # 加載數據
    print("📥 加載數據...")
    df = load_data()
    if df is None:
        print("❌ 無法加載數據")
        return

    df['Date'] = pd.to_datetime(df['Date'])

    # COVID 排除
    covid_start = pd.Timestamp('2020-02-01')
    covid_end = pd.Timestamp('2022-06-30')
    covid_mask = (df['Date'] >= covid_start) & (df['Date'] <= covid_end)
    original_len = len(df)
    df = df[~covid_mask].copy()
    print(f"   COVID 排除: {original_len} → {len(df)} 筆")

    # 創建基礎特徵
    print("\n🔧 創建基礎特徵...")
    df = create_comprehensive_features(df)
    df = df.dropna(subset=['Attendance'])

    # 加載天氣數據
    print("\n🌤️ 加載天氣數據...")
    weather_df = load_weather_data()

    if weather_df is None:
        print("❌ 無法加載天氣數據")
        return

    # 先創建天氣變化特徵
    print("🔧 創建天氣變化特徵...")
    weather_df = create_weather_change_features(weather_df)

    # 合併天氣數據
    df = df.merge(weather_df, on='Date', how='left')
    print(f"   ✅ 合併後: {len(df)} 筆")

    # 填充缺失值
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    for col in numeric_cols:
        if col not in ['Date', 'Attendance']:
            df[col] = df[col].fillna(df[col].median())

    # 時間序列分割
    split_idx = int(len(df) * 0.8)
    train_data = df[:split_idx].copy()
    test_data = df[split_idx:].copy()

    print(f"\n📊 數據分割:")
    print(f"   訓練集: {len(train_data)} 筆")
    print(f"   測試集: {len(test_data)} 筆")
    print(f"   測試日期: {test_data['Date'].min()} → {test_data['Date'].max()}")

    # 基礎特徵
    base_features = [
        "Attendance_Lag1", "Attendance_Lag7", "Attendance_Same_Weekday_Avg",
        "Day_of_Week", "DayOfWeek_Target_Mean", "Attendance_Rolling7",
        "Attendance_EWMA7", "Attendance_Lag14", "Attendance_Lag30",
        "Daily_Change", "Weekly_Change", "Is_Weekend",
        "Holiday_Factor", "Attendance_Std7", "Month"
    ]
    base_features = [c for c in base_features if c in df.columns]

    # 天氣變化特徵
    weather_change_features = [
        'temp_change_1d', 'temp_change_3d', 'temp_change_7d',
        'sudden_temp_drop', 'sudden_temp_rise', 'extreme_temp_drop',
        'temp_volatility_7d', 'max_temp_change_1d', 'max_temp_change_3d',
        'min_temp_change_1d', 'temp_range_change',
        'entering_hot_weather', 'entering_cold_weather',
        'leaving_hot_weather', 'leaving_cold_weather',
        'consecutive_hot_days', 'consecutive_cold_days',
        'temp_deviation_from_seasonal', 'extreme_cold_for_season',
        'extreme_hot_for_season'
    ]
    weather_change_features = [c for c in weather_change_features if c in df.columns]

    # 原始天氣特徵（絕對值）
    weather_absolute_features = [
        'mean_temp', 'max_temp', 'min_temp', 'temp_range',
        'is_very_hot', 'is_hot', 'is_cold', 'is_very_cold'
    ]
    weather_absolute_features = [c for c in weather_absolute_features if c in df.columns]

    y_train = train_data['Attendance'].values
    y_test = test_data['Attendance'].values

    results = {}

    # ============================================
    # 測試 1: Random Forest (無天氣)
    # ============================================
    print("\n" + "=" * 70)
    print("📊 測試 1: Random Forest (無天氣特徵) - 基準")
    print("=" * 70)

    X_train = train_data[base_features].fillna(0)
    X_test = test_data[base_features].fillna(0)

    rf_base = RandomForestRegressor(
        n_estimators=200,
        max_depth=12,
        min_samples_split=10,
        random_state=42,
        n_jobs=-1
    )
    rf_base.fit(X_train, y_train)
    pred_base = rf_base.predict(X_test)

    metrics_base = calculate_metrics(y_test, pred_base)
    results['rf_base'] = metrics_base

    print(f"   MAE:  {metrics_base['mae']:.2f}")
    print(f"   RMSE: {metrics_base['rmse']:.2f}")
    print(f"   MAPE: {metrics_base['mape']:.2f}%")
    print(f"   R²:   {metrics_base['r2']:.4f}")

    # ============================================
    # 測試 2: Random Forest + 天氣絕對值
    # ============================================
    print("\n" + "=" * 70)
    print("📊 測試 2: Random Forest + 天氣絕對值（舊方法）")
    print("=" * 70)

    all_features_abs = base_features + weather_absolute_features
    X_train_abs = train_data[all_features_abs].fillna(0)
    X_test_abs = test_data[all_features_abs].fillna(0)

    rf_abs = RandomForestRegressor(
        n_estimators=200,
        max_depth=12,
        min_samples_split=10,
        random_state=42,
        n_jobs=-1
    )
    rf_abs.fit(X_train_abs, y_train)
    pred_abs = rf_abs.predict(X_test_abs)

    metrics_abs = calculate_metrics(y_test, pred_abs)
    results['rf_absolute'] = metrics_abs

    improvement_abs = metrics_abs['mae'] - metrics_base['mae']
    improvement_pct_abs = (improvement_abs / metrics_base['mae']) * 100

    print(f"   MAE:  {metrics_abs['mae']:.2f} ({improvement_abs:+.2f}, {improvement_pct_abs:+.1f}%)")
    print(f"   RMSE: {metrics_abs['rmse']:.2f}")
    print(f"   MAPE: {metrics_abs['mape']:.2f}%")
    print(f"   R²:   {metrics_abs['r2']:.4f}")

    # ============================================
    # 測試 3: Random Forest + 天氣變化特徵（新方法）
    # ============================================
    print("\n" + "=" * 70)
    print("📊 測試 3: Random Forest + 天氣變化特徵（新方法）")
    print("=" * 70)
    print(f"   變化特徵數量: {len(weather_change_features)}")

    all_features_change = base_features + weather_change_features
    X_train_change = train_data[all_features_change].fillna(0)
    X_test_change = test_data[all_features_change].fillna(0)

    rf_change = RandomForestRegressor(
        n_estimators=200,
        max_depth=12,
        min_samples_split=10,
        random_state=42,
        n_jobs=-1
    )
    rf_change.fit(X_train_change, y_train)
    pred_change = rf_change.predict(X_test_change)

    metrics_change = calculate_metrics(y_test, pred_change)
    results['rf_change'] = metrics_change

    improvement_change = metrics_change['mae'] - metrics_base['mae']
    improvement_pct_change = (improvement_change / metrics_base['mae']) * 100

    print(f"   MAE:  {metrics_change['mae']:.2f} ({improvement_change:+.2f}, {improvement_pct_change:+.1f}%)")
    print(f"   RMSE: {metrics_change['rmse']:.2f}")
    print(f"   MAPE: {metrics_change['mape']:.2f}%")
    print(f"   R²:   {metrics_change['r2']:.4f}")

    # 特徵重要性
    print("\n   🔍 天氣變化特徵重要性 (Top 10):")
    feature_importance = pd.DataFrame({
        'feature': all_features_change,
        'importance': rf_change.feature_importances_
    }).sort_values('importance', ascending=False)

    weather_importance = feature_importance[feature_importance['feature'].isin(weather_change_features)].head(10)
    for _, row in weather_importance.iterrows():
        print(f"      {row['feature']:35} {row['importance']:.4f}")

    # ============================================
    # 測試 4: Random Forest + 所有天氣特徵
    # ============================================
    print("\n" + "=" * 70)
    print("📊 測試 4: Random Forest + 所有天氣特徵（絕對值 + 變化）")
    print("=" * 70)

    all_features_combined = base_features + weather_absolute_features + weather_change_features
    X_train_combined = train_data[all_features_combined].fillna(0)
    X_test_combined = test_data[all_features_combined].fillna(0)

    rf_combined = RandomForestRegressor(
        n_estimators=200,
        max_depth=12,
        min_samples_split=10,
        random_state=42,
        n_jobs=-1
    )
    rf_combined.fit(X_train_combined, y_train)
    pred_combined = rf_combined.predict(X_test_combined)

    metrics_combined = calculate_metrics(y_test, pred_combined)
    results['rf_combined'] = metrics_combined

    improvement_combined = metrics_combined['mae'] - metrics_base['mae']
    improvement_pct_combined = (improvement_combined / metrics_base['mae']) * 100

    print(f"   MAE:  {metrics_combined['mae']:.2f} ({improvement_combined:+.2f}, {improvement_pct_combined:+.1f}%)")
    print(f"   RMSE: {metrics_combined['rmse']:.2f}")
    print(f"   MAPE: {metrics_combined['mape']:.2f}%")
    print(f"   R²:   {metrics_combined['r2']:.4f}")

    # ============================================
    # 總結
    # ============================================
    print("\n" + "=" * 70)
    print("🏆 測試總結")
    print("=" * 70)

    print(f"\n{'模型':<40} {'MAE':<8} {'MAPE':<8} {'R²':<8} {'改善':<10}")
    print("-" * 80)

    baseline_mae = metrics_base['mae']

    display_names = {
        'rf_base': 'RF (無天氣) - 基準',
        'rf_absolute': 'RF + 天氣絕對值',
        'rf_change': 'RF + 天氣變化特徵 ⭐',
        'rf_combined': 'RF + 所有天氣特徵'
    }

    for name, metrics in results.items():
        improvement = metrics['mae'] - baseline_mae
        improvement_pct = (improvement / baseline_mae) * 100
        improvement_str = f"{improvement:+.2f} ({improvement_pct:+.1f}%)"

        if improvement < 0:
            improvement_str = f"✅ {improvement_str}"
        else:
            improvement_str = f"❌ {improvement_str}"

        display_name = display_names.get(name, name)
        print(f"{display_name:<40} {metrics['mae']:<8.2f} {metrics['mape']:<8.2f}% {metrics['r2']:<8.4f} {improvement_str:<10}")

    # 保存結果
    output = {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'results': results,
        'weather_change_features': weather_change_features,
        'conclusion': {
            'change_features_help': metrics_change['mae'] < metrics_base['mae'],
            'absolute_features_help': metrics_abs['mae'] < metrics_base['mae'],
            'best_approach': min(results.items(), key=lambda x: x[1]['mae'])[0]
        }
    }

    os.makedirs('models', exist_ok=True)
    with open('models/weather_change_test_results.json', 'w') as f:
        json.dump(output, f, indent=2)

    print(f"\n✅ 結果已保存到 models/weather_change_test_results.json")

    # 結論
    best_name = min(results.items(), key=lambda x: x[1]['mae'])[0]
    best_metrics = results[best_name]

    print(f"\n🎯 結論:")
    print(f"   最佳方案: {display_names[best_name]}")
    print(f"   MAE: {best_metrics['mae']:.2f}")
    print(f"   改善: {((baseline_mae - best_metrics['mae']) / baseline_mae * 100):.1f}%")

    if metrics_change['mae'] < metrics_abs['mae']:
        print(f"\n   ✅ 天氣變化特徵 > 天氣絕對值")
        print(f"   → 突然降溫、溫度波動等變化特徵更重要！")
    else:
        print(f"\n   ⚠️ 天氣變化特徵沒有明顯優勢")

if __name__ == '__main__':
    main()
