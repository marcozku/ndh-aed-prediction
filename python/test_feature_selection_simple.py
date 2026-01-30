# -*- coding: utf-8 -*-
"""
簡化版特徵選擇測試 - 診斷版本
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
from datetime import datetime
import psycopg2
import psycopg2.extras
from sklearn.ensemble import RandomForestRegressor
import xgboost as xgb
import json
import os
import warnings
warnings.filterwarnings('ignore')

# 數據庫連接
DB_CONFIG = {
    'host': 'razzle.db.elephantsql.com',
    'database': 'ndh_aed',
    'user': 'ndh_aed',
    'password': 'B3IG7EYud_UMqfUNvEbi5XxO9xh5l8Pp',
    'port': 5432
}

# COVID 期間
COVID_PERIODS = [
    ('2020-01-23', '2020-04-08'),
    ('2020-07-16', '2020-09-30'),
    ('2020-11-23', '2021-01-05'),
    ('2022-02-05', '2022-04-30'),
    ('2022-11-10', '2022-12-27'),
]


def load_data():
    """加載數據"""
    try:
        print("📡 加載數據...")
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        query = "SELECT date, patient_count FROM actual_data ORDER BY date ASC"
        cursor.execute(query)
        rows = cursor.fetchall()

        cursor.close()
        conn.close()

        df = pd.DataFrame(rows)
        df['date'] = pd.to_datetime(df['date'])

        # 排除 COVID
        for start, end in COVID_PERIODS:
            start_date = pd.to_datetime(start)
            end_date = pd.to_datetime(end)
            mask = (df['date'] >= start_date) & (df['date'] <= end_date)
            df = df[~mask]

        print(f"   ✅ {len(df)} 筆記錄")
        return df

    except Exception as e:
        print(f"   ❌ {e}")
        return None


def load_weather_data():
    """加載天氣數據"""
    weather_file = 'models/weather_full_history.csv'
    if not os.path.exists(weather_file):
        return None

    weather_df = pd.read_csv(weather_file)
    weather_df['Date'] = pd.to_datetime(weather_df['Date'])
    return weather_df


def prepare_features_simple(df):
    """準備基礎特徵"""
    print("\n📊 準備特徵...")

    df = df.rename(columns={'date': 'Date'})

    # 時間特徵
    df['Day_of_Week'] = df['Date'].dt.dayofweek
    df['Month'] = df['Date'].dt.month
    df['Day_of_Month'] = df['Date'].dt.day
    df['Is_Weekend'] = (df['Day_of_Week'] >= 5).astype(int)

    # 週期編碼
    df['DayOfWeek_sin'] = np.sin(2 * np.pi * df['Day_of_Week'] / 7)
    df['DayOfWeek_cos'] = np.cos(2 * np.pi * df['Day_of_Week'] / 7)

    # 流感季節
    df['Is_Winter_Flu_Season'] = df['Month'].isin([1, 2]).astype(int)
    df['Holiday_Factor'] = 1.0

    # 歷史就診
    df = df.sort_values('Date').reset_index(drop=True)

    df['Attendance_Lag1'] = df['patient_count'].shift(1)
    df['Attendance_Lag7'] = df['patient_count'].shift(7)
    df['Attendance_Lag30'] = df['patient_count'].shift(30)

    df['Attendance_EWMA7'] = df['patient_count'].ewm(span=7, adjust=False).mean()
    df['Attendance_EWMA14'] = df['patient_count'].ewm(span=14, adjust=False).mean()

    df['Daily_Change'] = df['patient_count'].diff()
    df['Weekly_Change'] = df['patient_count'].diff(7)

    # 填補
    df['Attendance_Lag1'] = df['Attendance_Lag1'].fillna(df['patient_count'].mean())
    df['Attendance_Lag7'] = df['Attendance_Lag7'].fillna(df['patient_count'].mean())
    df['Attendance_Lag30'] = df['Attendance_Lag30'].fillna(df['patient_count'].mean())
    df['Attendance_EWMA7'] = df['Attendance_EWMA7'].fillna(method='bfill')
    df['Attendance_EWMA14'] = df['Attendance_EWMA14'].fillna(method='bfill')
    df['Daily_Change'] = df['Daily_Change'].fillna(0)
    df['Weekly_Change'] = df['Weekly_Change'].fillna(0)

    # 移除 NaN
    df = df.dropna()

    print(f"   ✅ 特徵準備完成: {len(df)} 筆")
    return df


def test_feature_importance(X_train, y_train, X_test, y_test, feature_names):
    """測試特徵重要性"""
    print("\n" + "=" * 80)
    print("🔍 特徵重要性分析")
    print("=" * 80)

    # 訓練模型
    print("\n訓練 XGBoost...")
    model = xgb.XGBRegressor(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.05,
        random_state=42,
        n_jobs=-1
    )

    model.fit(X_train, y_train, verbose=False)

    # 特徵重要性
    importances = model.feature_importances_
    indices = np.argsort(importances)[::-1]

    print("\n   Top 20 特徵:")
    print(f"   {'排名':<4} {'特徵':<35} {'重要性':<10}")
    print("   " + "-" * 60)

    for i, idx in enumerate(indices[:20], 1):
        feature = feature_names[idx]
        importance = importances[idx]
        print(f"   {i:<4} {feature:<35} {importance:.4f}")

    # 評估
    from sklearn.metrics import mean_absolute_error
    y_pred = model.predict(X_test)
    mae = mean_absolute_error(y_test, y_pred)

    print(f"\n   所有特徵 ({len(feature_names)} 個): MAE = {mae:.2f}")

    # 測試不同特徵數量
    print("\n" + "=" * 80)
    print("🔍 測試不同特徵數量")
    print("=" * 80)

    results = []
    feature_counts = [5, 10, 15, 20, 25, 30, 40, 50]

    for n_features in feature_counts:
        if n_features > len(feature_names):
            continue

        # 選擇 top n_features
        selected_indices = indices[:n_features]
        X_train_selected = X_train.iloc[:, selected_indices]
        X_test_selected = X_test.iloc[:, selected_indices]

        # 訓練
        model_selected = xgb.XGBRegressor(
            n_estimators=300,
            max_depth=6,
            learning_rate=0.05,
            random_state=42,
            n_jobs=-1
        )
        model_selected.fit(X_train_selected, y_train, verbose=False)

        # 評估
        y_pred_selected = model_selected.predict(X_test_selected)
        mae_selected = mean_absolute_error(y_test, y_pred_selected)

        results.append({
            'n_features': n_features,
            'mae': mae_selected
        })

        print(f"   {n_features:3d} 特徵: MAE = {mae_selected:.2f}")

    # 找出最佳
    best_result = min(results, key=lambda x: x['mae'])

    print("\n" + "=" * 80)
    print(f"🏆 最佳特徵數量: {best_result['n_features']} 個")
    print(f"   MAE: {best_result['mae']:.2f}")
    print(f"   改善: {((15.73 - best_result['mae']) / 15.73 * 100):.1f}%")
    print("=" * 80)

    return results, best_result, indices, importances


def main():
    """主測試流程"""
    print("=" * 80)
    print("🎯 特徵選擇測試（簡化版）")
    print("=" * 80)
    print(f"時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # 1. 加載數據
    df = load_data()
    if df is None:
        print("   ❌ 無法加載數據")
        return

    # 2. 準備特徵
    df = prepare_features_simple(df)

    # 3. 特徵列表
    feature_names = [
        'Day_of_Week', 'Month', 'Day_of_Month', 'Is_Weekend',
        'Holiday_Factor', 'Is_Winter_Flu_Season',
        'DayOfWeek_sin', 'DayOfWeek_cos',
        'Attendance_Lag1', 'Attendance_Lag7', 'Attendance_Lag30',
        'Attendance_EWMA7', 'Attendance_EWMA14',
        'Daily_Change', 'Weekly_Change'
    ]

    # 過濾存在的特徵
    feature_names = [f for f in feature_names if f in df.columns]

    print(f"\n📋 特徵數量: {len(feature_names)}")

    # 4. 分割數據
    print("\n✂️ 分割數據...")
    train_size = int(len(df) * 0.8)

    train_df = df.iloc[:train_size]
    test_df = df.iloc[train_size:]

    X_train = train_df[feature_names]
    y_train = train_df['patient_count']
    X_test = test_df[feature_names]
    y_test = test_df['patient_count']

    print(f"   訓練集: {len(X_train)} 筆")
    print(f"   測試集: {len(X_test)} 筆")

    # 5. 測試
    results, best_result, indices, importances = test_feature_importance(
        X_train, y_train, X_test, y_test, feature_names
    )

    # 6. 保存結果
    output = {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'baseline_mae': 15.73,
        'total_features': len(feature_names),
        'best_n_features': best_result['n_features'],
        'best_mae': best_result['mae'],
        'improvement_pct': ((15.73 - best_result['mae']) / 15.73 * 100),
        'feature_importance': {
            feature_names[i]: float(importances[i]) for i in range(len(feature_names))
        }
    }

    os.makedirs('models', exist_ok=True)
    with open('models/feature_selection_simple_results.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n💾 結果已保存")

    print("\n" + "=" * 80)
    print("✅ 測試完成")
    print("=" * 80)


if __name__ == '__main__':
    main()
