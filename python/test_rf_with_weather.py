"""
測試 Random Forest + 真實天氣數據的準確度
Test if weather factors improve Random Forest predictions
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
            print(f"   ✅ 加載天氣數據: {len(df)} 筆")
            print(f"   📅 日期範圍: {df['Date'].min()} → {df['Date'].max()}")
            return df

    print("   ⚠️ 未找到天氣數據")
    return None

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
    print("🧪 Random Forest + 真實天氣數據測試")
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

    if weather_df is not None:
        # 合併天氣數據
        df = df.merge(weather_df, on='Date', how='left')
        print(f"   ✅ 合併後: {len(df)} 筆")

        # 填充缺失的天氣數據
        weather_cols = ['mean_temp', 'max_temp', 'min_temp', 'temp_range',
                       'is_very_hot', 'is_hot', 'is_cold', 'is_very_cold']
        for col in weather_cols:
            if col in df.columns:
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

    # 天氣特徵
    weather_features = []
    if weather_df is not None:
        weather_features = ['mean_temp', 'max_temp', 'min_temp', 'temp_range',
                           'is_very_hot', 'is_hot', 'is_cold', 'is_very_cold']
        weather_features = [c for c in weather_features if c in df.columns]

    y_test = test_data['Attendance'].values

    results = {}

    # ============================================
    # 測試 1: Random Forest (無天氣)
    # ============================================
    print("\n" + "=" * 70)
    print("📊 測試 1: Random Forest (無天氣特徵)")
    print("=" * 70)

    X_train = train_data[base_features].fillna(0)
    y_train = train_data['Attendance'].values
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
    # 測試 2: Random Forest + 天氣
    # ============================================
    if weather_features:
        print("\n" + "=" * 70)
        print("📊 測試 2: Random Forest + 真實天氣數據")
        print("=" * 70)

        all_features = base_features + weather_features
        print(f"   特徵數量: {len(all_features)}")
        print(f"   天氣特徵: {', '.join(weather_features)}")

        X_train_w = train_data[all_features].fillna(0)
        X_test_w = test_data[all_features].fillna(0)

        rf_weather = RandomForestRegressor(
            n_estimators=200,
            max_depth=12,
            min_samples_split=10,
            random_state=42,
            n_jobs=-1
        )
        rf_weather.fit(X_train_w, y_train)
        pred_weather = rf_weather.predict(X_test_w)

        metrics_weather = calculate_metrics(y_test, pred_weather)
        results['rf_weather'] = metrics_weather

        improvement = metrics_weather['mae'] - metrics_base['mae']
        improvement_pct = (improvement / metrics_base['mae']) * 100

        print(f"   MAE:  {metrics_weather['mae']:.2f} ({improvement:+.2f}, {improvement_pct:+.1f}%)")
        print(f"   RMSE: {metrics_weather['rmse']:.2f}")
        print(f"   MAPE: {metrics_weather['mape']:.2f}%")
        print(f"   R²:   {metrics_weather['r2']:.4f}")

        # 特徵重要性
        print("\n   🔍 天氣特徵重要性:")
        feature_importance = pd.DataFrame({
            'feature': all_features,
            'importance': rf_weather.feature_importances_
        }).sort_values('importance', ascending=False)

        weather_importance = feature_importance[feature_importance['feature'].isin(weather_features)]
        for _, row in weather_importance.iterrows():
            print(f"      {row['feature']:20} {row['importance']:.4f}")

    # ============================================
    # 測試 3: 不同 Random Forest 配置
    # ============================================
    if weather_features:
        print("\n" + "=" * 70)
        print("📊 測試 3: 優化 Random Forest 超參數")
        print("=" * 70)

        configs = [
            {'n_estimators': 300, 'max_depth': 15, 'min_samples_split': 5, 'name': '深度模型'},
            {'n_estimators': 500, 'max_depth': 10, 'min_samples_split': 15, 'name': '保守模型'},
            {'n_estimators': 400, 'max_depth': 12, 'min_samples_split': 8, 'name': '平衡模型'},
        ]

        best_mae = float('inf')
        best_config = None

        for config in configs:
            name = config.pop('name')
            rf = RandomForestRegressor(random_state=42, n_jobs=-1, **config)
            rf.fit(X_train_w, y_train)
            pred = rf.predict(X_test_w)
            metrics = calculate_metrics(y_test, pred)

            improvement = metrics['mae'] - metrics_base['mae']
            print(f"   {name:12} MAE: {metrics['mae']:.2f} ({improvement:+.2f}), MAPE: {metrics['mape']:.2f}%")

            if metrics['mae'] < best_mae:
                best_mae = metrics['mae']
                best_config = {'name': name, 'config': config, 'metrics': metrics}

    # ============================================
    # 總結
    # ============================================
    print("\n" + "=" * 70)
    print("🏆 測試總結")
    print("=" * 70)

    print(f"\n{'模型':<30} {'MAE':<8} {'MAPE':<8} {'R²':<8} {'改善':<8}")
    print("-" * 70)

    baseline_mae = metrics_base['mae']

    for name, metrics in results.items():
        improvement = metrics['mae'] - baseline_mae
        improvement_str = f"{improvement:+.2f}"
        if improvement < 0:
            improvement_str = f"✅ {improvement_str}"
        else:
            improvement_str = f"❌ {improvement_str}"

        display_name = {
            'rf_base': 'Random Forest (無天氣)',
            'rf_weather': 'Random Forest + 天氣'
        }.get(name, name)

        print(f"{display_name:<30} {metrics['mae']:<8.2f} {metrics['mape']:<8.2f}% {metrics['r2']:<8.4f} {improvement_str:<8}")

    # 保存結果
    output = {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'results': results,
        'weather_features_used': weather_features if weather_features else [],
        'conclusion': {
            'weather_helps': results['rf_weather']['mae'] < results['rf_base']['mae'] if 'rf_weather' in results else False,
            'improvement': results['rf_weather']['mae'] - results['rf_base']['mae'] if 'rf_weather' in results else 0
        }
    }

    os.makedirs('models', exist_ok=True)
    with open('models/rf_weather_test_results.json', 'w') as f:
        json.dump(output, f, indent=2)

    print(f"\n✅ 結果已保存到 models/rf_weather_test_results.json")

    # 結論
    if 'rf_weather' in results:
        if results['rf_weather']['mae'] < results['rf_base']['mae']:
            improvement_pct = ((results['rf_base']['mae'] - results['rf_weather']['mae']) / results['rf_base']['mae']) * 100
            print(f"\n🎯 結論: 天氣特徵有幫助！")
            print(f"   MAE 改善: {improvement_pct:.1f}%")
            print(f"   建議: 使用 Random Forest + 天氣數據")
        else:
            print(f"\n⚠️ 結論: 天氣特徵沒有明顯幫助")
            print(f"   可能原因: 數據質量、特徵工程需要改進")

if __name__ == '__main__':
    main()
