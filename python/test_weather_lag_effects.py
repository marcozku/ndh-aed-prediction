"""
測試天氣滯後效應（Weather Lag Effects）
突然降溫可能 3-5 天後才影響就診率
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
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import json
import os
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_engineering import create_comprehensive_features

def load_data():
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

def create_weather_lag_features(df):
    """
    創建天氣滯後特徵
    假設：今天降溫 → 3-5天後才影響就診
    """
    df = df.copy()
    df = df.sort_values('Date').reset_index(drop=True)

    # 溫度變化
    df['temp_change_1d'] = df['mean_temp'].diff(1)
    df['sudden_temp_drop'] = (df['temp_change_1d'] < -5).astype(int)
    df['extreme_temp_drop'] = (df['temp_change_1d'] < -8).astype(int)

    # 滯後特徵（3-7天前的天氣變化）
    for lag in [1, 2, 3, 4, 5, 7]:
        df[f'temp_change_lag{lag}d'] = df['temp_change_1d'].shift(lag)
        df[f'sudden_drop_lag{lag}d'] = df['sudden_temp_drop'].shift(lag)
        df[f'extreme_drop_lag{lag}d'] = df['extreme_temp_drop'].shift(lag)
        df[f'mean_temp_lag{lag}d'] = df['mean_temp'].shift(lag)
        df[f'is_cold_lag{lag}d'] = df['is_cold'].shift(lag)

    # 累積效應（過去3天/5天/7天有幾天突然降溫）
    df['sudden_drops_past3d'] = df['sudden_temp_drop'].rolling(window=3, min_periods=1).sum()
    df['sudden_drops_past5d'] = df['sudden_temp_drop'].rolling(window=5, min_periods=1).sum()
    df['sudden_drops_past7d'] = df['sudden_temp_drop'].rolling(window=7, min_periods=1).sum()

    # 極端降溫後的天數
    df['days_since_extreme_drop'] = 0
    days_counter = 999
    for i in range(len(df)):
        if df.at[i, 'extreme_temp_drop'] == 1:
            days_counter = 0
        else:
            days_counter += 1
        df.at[i, 'days_since_extreme_drop'] = min(days_counter, 14)

    return df

def calculate_metrics(y_true, y_pred):
    mae = mean_absolute_error(y_true, y_pred)
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))
    mape = np.mean(np.abs((y_true - y_pred) / y_true)) * 100
    r2 = r2_score(y_true, y_pred)
    return {'mae': mae, 'rmse': rmse, 'mape': mape, 'r2': r2}

def main():
    print("=" * 70)
    print("⏱️ 測試天氣滯後效應（3-7天後才影響就診）")
    print("=" * 70)
    print(f"⏰ 開始時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    df = load_data()
    if df is None:
        print("❌ 無法加載數據")
        return

    df['Date'] = pd.to_datetime(df['Date'])

    # COVID 排除
    covid_start = pd.Timestamp('2020-02-01')
    covid_end = pd.Timestamp('2022-06-30')
    covid_mask = (df['Date'] >= covid_start) & (df['Date'] <= covid_end)
    df = df[~covid_mask].copy()

    print("🔧 創建基礎特徵...")
    df = create_comprehensive_features(df)
    df = df.dropna(subset=['Attendance'])

    print("🌤️ 加載天氣數據...")
    weather_df = load_weather_data()
    if weather_df is None:
        print("❌ 無法加載天氣數據")
        return

    print("🔧 創建天氣滯後特徵...")
    weather_df = create_weather_lag_features(weather_df)

    df = df.merge(weather_df, on='Date', how='left')
    print(f"   ✅ 合併後: {len(df)} 筆")

    # 填充缺失值
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    for col in numeric_cols:
        if col not in ['Date', 'Attendance']:
            df[col] = df[col].fillna(0)

    # 時間序列分割
    split_idx = int(len(df) * 0.8)
    train_data = df[:split_idx].copy()
    test_data = df[split_idx:].copy()

    print(f"\n📊 數據分割:")
    print(f"   訓練集: {len(train_data)} 筆")
    print(f"   測試集: {len(test_data)} 筆")

    base_features = [
        "Attendance_Lag1", "Attendance_Lag7", "Attendance_Same_Weekday_Avg",
        "Day_of_Week", "DayOfWeek_Target_Mean", "Attendance_Rolling7",
        "Attendance_EWMA7", "Attendance_Lag14", "Attendance_Lag30",
        "Daily_Change", "Weekly_Change", "Is_Weekend",
        "Holiday_Factor", "Attendance_Std7", "Month"
    ]
    base_features = [c for c in base_features if c in df.columns]

    # 滯後天氣特徵
    lag_weather_features = [col for col in df.columns if 'lag' in col.lower() and col not in base_features]
    lag_weather_features += ['sudden_drops_past3d', 'sudden_drops_past5d', 'sudden_drops_past7d', 'days_since_extreme_drop']
    lag_weather_features = [c for c in lag_weather_features if c in df.columns]

    y_train = train_data['Attendance'].values
    y_test = test_data['Attendance'].values

    results = {}

    # 測試 1: 基準
    print("\n" + "=" * 70)
    print("📊 測試 1: Random Forest (無天氣) - 基準")
    print("=" * 70)

    X_train = train_data[base_features].fillna(0)
    X_test = test_data[base_features].fillna(0)

    rf_base = RandomForestRegressor(n_estimators=200, max_depth=12, min_samples_split=10, random_state=42, n_jobs=-1)
    rf_base.fit(X_train, y_train)
    pred_base = rf_base.predict(X_test)

    metrics_base = calculate_metrics(y_test, pred_base)
    results['rf_base'] = metrics_base

    print(f"   MAE:  {metrics_base['mae']:.2f}")
    print(f"   MAPE: {metrics_base['mape']:.2f}%")
    print(f"   R²:   {metrics_base['r2']:.4f}")

    # 測試 2: 加入滯後天氣特徵
    print("\n" + "=" * 70)
    print("📊 測試 2: Random Forest + 天氣滯後特徵")
    print("=" * 70)
    print(f"   滯後特徵數量: {len(lag_weather_features)}")

    all_features = base_features + lag_weather_features
    X_train_lag = train_data[all_features].fillna(0)
    X_test_lag = test_data[all_features].fillna(0)

    rf_lag = RandomForestRegressor(n_estimators=200, max_depth=12, min_samples_split=10, random_state=42, n_jobs=-1)
    rf_lag.fit(X_train_lag, y_train)
    pred_lag = rf_lag.predict(X_test_lag)

    metrics_lag = calculate_metrics(y_test, pred_lag)
    results['rf_lag'] = metrics_lag

    improvement = metrics_lag['mae'] - metrics_base['mae']
    improvement_pct = (improvement / metrics_base['mae']) * 100

    print(f"   MAE:  {metrics_lag['mae']:.2f} ({improvement:+.2f}, {improvement_pct:+.1f}%)")
    print(f"   MAPE: {metrics_lag['mape']:.2f}%")
    print(f"   R²:   {metrics_lag['r2']:.4f}")

    # 特徵重要性
    print("\n   🔍 滯後天氣特徵重要性 (Top 15):")
    feature_importance = pd.DataFrame({
        'feature': all_features,
        'importance': rf_lag.feature_importances_
    }).sort_values('importance', ascending=False)

    lag_importance = feature_importance[feature_importance['feature'].isin(lag_weather_features)].head(15)
    for _, row in lag_importance.iterrows():
        print(f"      {row['feature']:35} {row['importance']:.4f}")

    # 總結
    print("\n" + "=" * 70)
    print("🏆 結論")
    print("=" * 70)

    if metrics_lag['mae'] < metrics_base['mae']:
        print(f"   ✅ 天氣滯後效應有幫助！")
        print(f"   MAE 改善: {abs(improvement_pct):.1f}%")
        print(f"   → 突然降溫確實會在 3-7 天後影響就診率")
    else:
        print(f"   ❌ 天氣滯後效應沒有明顯幫助")
        print(f"   → 天氣對北區醫院急症就診影響很小")

    # 保存結果
    output = {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'results': results,
        'lag_features_used': lag_weather_features,
        'conclusion': {
            'lag_helps': metrics_lag['mae'] < metrics_base['mae'],
            'improvement': improvement,
            'improvement_pct': improvement_pct
        }
    }

    os.makedirs('models', exist_ok=True)
    with open('models/weather_lag_test_results.json', 'w') as f:
        json.dump(output, f, indent=2)

    print(f"\n✅ 結果已保存到 models/weather_lag_test_results.json")

if __name__ == '__main__':
    main()
