# -*- coding: utf-8 -*-
"""
特徵選擇測試 - 使用本地 CSV 數據
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
import json
import os
import warnings
warnings.filterwarnings('ignore')

# 機器學習
from sklearn.ensemble import RandomForestRegressor
import xgboost as xgb
from sklearn.metrics import mean_absolute_error

# COVID 期間
COVID_PERIODS = [
    ('2020-01-23', '2020-04-08'),
    ('2020-07-16', '2020-09-30'),
    ('2020-11-23', '2021-01-05'),
    ('2022-02-05', '2022-04-30'),
    ('2022-11-10', '2022-12-27'),
]


def load_local_data():
    """從本地 CSV 加載數據"""
    # 嘗試多個可能的文件路徑
    possible_files = [
        '../ndh_attendance_extracted.csv',
        '../../ndh_attendance_extracted.csv',
        'ndh_attendance_extracted.csv'
    ]

    for file_path in possible_files:
        if os.path.exists(file_path):
            print(f"📂 使用本地文件: {file_path}")
            df = pd.read_csv(file_path)
            df['date'] = pd.to_datetime(df['date'])
            return df

    # 如果都找不到，嘗試絕對路徑
    abs_path = 'C:/Github/ndh-aed-prediction/ndh_attendance_extracted.csv'
    if os.path.exists(abs_path):
        print(f"📂 使用本地文件: {abs_path}")
        df = pd.read_csv(abs_path)
        df['date'] = pd.to_datetime(df['date'])
        return df

    print("❌ 找不到本地數據文件")
    print("請確保以下文件存在:")
    for f in possible_files + [abs_path]:
        print(f"   - {f}")
    return None


def exclude_covid_periods(df):
    """排除 COVID 期間"""
    for start, end in COVID_PERIODS:
        start_date = pd.to_datetime(start)
        end_date = pd.to_datetime(end)
        mask = (df['date'] >= start_date) & (df['date'] <= end_date)
        before = len(df)
        df = df[~mask]
        if before > len(df):
            print(f"   排除 {start} 到 {end}: 移除 {before - len(df)} 筆")

    return df


def prepare_features(df):
    """準備特徵"""
    print("\n📊 準備特徵...")

    df = df.rename(columns={'date': 'Date'})

    # 確保列名正確
    if 'attendance' in df.columns:
        df = df.rename(columns={'attendance': 'patient_count'})
    elif 'Attendance' in df.columns:
        df = df.rename(columns={'Attendance': 'patient_count'})

    # 時間特徵
    df['Day_of_Week'] = df['Date'].dt.dayofweek
    df['Month'] = df['Date'].dt.month
    df['Day_of_Month'] = df['Date'].dt.day
    df['Is_Weekend'] = (df['Day_of_Week'] >= 5).astype(int)

    # 週期編碼
    df['DayOfWeek_sin'] = np.sin(2 * np.pi * df['Day_of_Week'] / 7)
    df['DayOfWeek_cos'] = np.cos(2 * np.pi * df['Day_of_Week'] / 7)

    # 季節性
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


def test_feature_counts(X_train, y_train, X_test, y_test, feature_names):
    """測試不同特徵數量"""
    print("\n" + "=" * 80)
    print("🔍 特徵選擇測試")
    print("=" * 80)

    # 訓練模型獲取重要性
    print("\n1️⃣ 訓練 XGBoost 獲取特徵重要性...")
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

    print("\n   Top 15 特徵:")
    print(f"   {'排名':<4} {'特徵':<35} {'重要性':<10}")
    print("   " + "-" * 60)

    for i, idx in enumerate(indices[:15], 1):
        feature = feature_names[idx]
        importance = importances[idx]
        print(f"   {i:<4} {feature:<35} {importance:.4f}")

    # 測試不同特徵數量
    print("\n2️⃣ 測試不同特徵數量...")
    print(f"   {'特徵數':<10} {'MAE':<10} {'改善 %':<10} {'狀態':<5}")
    print("   " + "-" * 45)

    baseline_mae = 15.73
    results = []

    # 測試不同數量
    for n_features in range(5, len(feature_names) + 1, 5):
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
        y_pred = model_selected.predict(X_test_selected)
        mae = mean_absolute_error(y_test, y_pred)
        improvement = ((baseline_mae - mae) / baseline_mae * 100)

        results.append({
            'n_features': n_features,
            'mae': mae,
            'improvement': improvement
        })

        status = "✅" if mae < baseline_mae else "❌"
        print(f"   {n_features:<10} {mae:<10.2f} {improvement:>+6.1f}%   {status}")

    # 找出最佳
    best = min(results, key=lambda x: x['mae'])

    print("\n" + "=" * 80)
    print("🏆 測試結果")
    print("=" * 80)
    print(f"\n基準 (舊模型): MAE = {baseline_mae}")
    print(f"最佳特徵數量: {best['n_features']} 個")
    print(f"最佳 MAE: {best['mae']:.2f}")
    print(f"改善: {best['improvement']:+.1f}%")

    # 分析
    if best['n_features'] < len(feature_names) * 0.7:
        print(f"\n✅ 重要發現:")
        print(f"   特徵數量可以從 {len(feature_names)} 減少到 {best['n_features']}")
        print(f"   減少 {len(feature_names) - best['n_features']} 個特徵")
        print(f"   同時改善準確度！")
    else:
        print(f"\n⚠️ 結論:")
        print(f"   大部分特徵都有用")
        print(f"   建議保留 {best['n_features']} 個特徵")

    return results, best, indices, importances


def main():
    """主測試流程"""
    print("=" * 80)
    print("🎯 特徵選擇測試 (本地數據)")
    print("=" * 80)
    print(f"時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # 1. 加載數據
    df = load_local_data()
    if df is None:
        return

    print(f"   ✅ 加載 {len(df)} 筆記錄")
    print(f"   📅 範圍: {df['date'].min()} → {df['date'].max()}")

    # 2. 排除 COVID
    print("\n🦠 排除 COVID 期間...")
    df = exclude_covid_periods(df)
    print(f"   📊 過濾後: {len(df)} 筆記錄")

    # 3. 準備特徵
    df = prepare_features(df)

    # 4. 特徵列表
    feature_names = [
        'Day_of_Week', 'Month', 'Day_of_Month', 'Is_Weekend',
        'Holiday_Factor', 'Is_Winter_Flu_Season',
        'DayOfWeek_sin', 'DayOfWeek_cos',
        'Attendance_Lag1', 'Attendance_Lag7', 'Attendance_Lag30',
        'Attendance_EWMA7', 'Attendance_EWMA14',
        'Daily_Change', 'Weekly_Change'
    ]

    feature_names = [f for f in feature_names if f in df.columns]
    print(f"\n📋 特徵數量: {len(feature_names)}")

    # 5. 分割數據
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
    print(f"   測試範圍: {test_df['Date'].min()} → {test_df['Date'].max()}")

    # 6. 測試
    results, best, indices, importances = test_feature_counts(
        X_train, y_train, X_test, y_test, feature_names
    )

    # 7. 保存結果
    output = {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'baseline_mae': 15.73,
        'total_features': len(feature_names),
        'best_n_features': best['n_features'],
        'best_mae': best['mae'],
        'improvement_pct': best['improvement'],
        'feature_importance': {
            feature_names[i]: float(importances[i]) for i in range(len(feature_names))
        },
        'test_results': results
    }

    os.makedirs('models', exist_ok=True)
    with open('models/feature_selection_local_results.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n💾 結果已保存到 models/feature_selection_local_results.json")

    # 推薦
    print("\n" + "=" * 80)
    print("💡 推薦使用的特徵")
    print("=" * 80)
    print(f"\n使用這 {best['n_features']} 個最重要特徵來訓練最終模型:")
    for i in range(best['n_features']):
        idx = indices[i]
        print(f"   {i+1}. {feature_names[idx]}")

    print("\n" + "=" * 80)
    print("✅ 測試完成")
    print("=" * 80)


if __name__ == '__main__':
    main()
