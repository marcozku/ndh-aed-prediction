# -*- coding: utf-8 -*-
"""
特徵選擇測試 - 使用完整導出數據
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


def load_exported_data():
    """加載導出的完整數據"""
    # 嘗試多個路徑
    possible_paths = [
        '../ndh_attendance_export.csv',
        '../../ndh_attendance_export.csv',
        'C:/Github/ndh-aed-prediction/ndh_attendance_export.csv'
    ]

    df = None
    for file_path in possible_paths:
        if os.path.exists(file_path):
            print(f"📂 找到文件: {file_path}")
            df = pd.read_csv(file_path)
            break

    if df is None:
        print(f"❌ 找不到 ndh_attendance_export.csv")
        print("   請確保文件在項目根目錄")
        return None

    df['date'] = pd.to_datetime(df['date']).dt.date

    print(f"   ✅ 加載 {len(df)} 筆記錄")
    print(f"   📅 範圍: {df['date'].min()} → {df['date'].max()}")
    print(f"   📈 平均就診: {df['patient_count'].mean():.1f} 人")

    return df


def exclude_covid_periods(df):
    """排除 COVID 期間"""
    print("\n🦠 排除 COVID 期間...")

    original_count = len(df)

    for start, end in COVID_PERIODS:
        start_date = pd.to_datetime(start).date()
        end_date = pd.to_datetime(end).date()
        mask = (df['date'] >= start_date) & (df['date'] <= end_date)
        removed = len(df[mask])
        df = df[~mask]
        if removed > 0:
            print(f"   移除 {start} 到 {end}: -{removed} 筆")

    print(f"   📊 過濾後: {len(df)} 筆 (移除 {original_count - len(df)} 筆)")

    return df


def prepare_features(df):
    """準備特徵"""
    print("\n📊 準備特徵...")

    df = df.copy()
    df['Date'] = pd.to_datetime(df['date'])

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
    before = len(df)
    df = df.dropna()
    after = len(df)

    print(f"   ✅ 特徵準備完成: {after} 筆 (移除 {before - after} 筆含 NaN)")
    return df


def test_feature_selection(X_train, y_train, X_test, y_test, feature_names):
    """完整特徵選擇測試"""
    print("\n" + "=" * 80)
    print("🔍 特徵選擇測試 (完整數據)")
    print("=" * 80)

    # 訓練模型獲取重要性
    print("\n1️⃣ 訓練 XGBoost 獲取特徵重要性...")
    model = xgb.XGBRegressor(
        n_estimators=500,
        max_depth=6,
        learning_rate=0.05,
        min_child_weight=3,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        n_jobs=-1
    )
    model.fit(X_train, y_train, verbose=False)

    # 特徵重要性
    importances = model.feature_importances_
    indices = np.argsort(importances)[::-1]

    print("\n   特徵重要性排名:")
    print(f"   {'排名':<4} {'特徵':<30} {'重要性':<10}")
    print("   " + "-" * 50)

    for i, idx in enumerate(indices, 1):
        feature = feature_names[idx]
        importance = importances[idx]
        print(f"   {i:<4} {feature:<30} {importance:.4f}")

    # 測試不同特徵數量
    print("\n2️⃣ 測試不同特徵數量...")
    print(f"   {'特徵數':<10} {'MAE':<10} {'改善 %':<10} {'狀態':<5}")
    print("   " + "-" * 45)

    baseline_mae = 15.73
    results = []

    # 測試所有可能的數量
    for n_features in range(3, len(feature_names) + 1):
        selected_indices = indices[:n_features]
        X_train_sel = X_train.iloc[:, selected_indices]
        X_test_sel = X_test.iloc[:, selected_indices]

        model_sel = xgb.XGBRegressor(
            n_estimators=300,
            max_depth=6,
            learning_rate=0.05,
            random_state=42,
            n_jobs=-1
        )
        model_sel.fit(X_train_sel, y_train, verbose=False)

        y_pred = model_sel.predict(X_test_sel)
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
    worst = max(results, key=lambda x: x['mae'])

    print("\n" + "=" * 80)
    print("🏆 測試結果")
    print("=" * 80)
    print(f"\n基準 (舊模型): MAE = {baseline_mae}")
    print(f"最佳特徵數: {best['n_features']} 個 → MAE = {best['mae']:.2f} ({best['improvement']:+.1f}%)")
    print(f"最差特徵數: {worst['n_features']} 個 → MAE = {worst['mae']:.2f}")

    # 分析
    improvement_best_vs_all = ((results[-1]['mae'] - best['mae']) / results[-1]['mae'] * 100)

    if best['n_features'] < len(feature_names):
        print(f"\n✅ 重要發現:")
        print(f"   使用全部 {len(feature_names)} 個特徵: MAE = {results[-1]['mae']:.2f}")
        print(f"   最佳 {best['n_features']} 個特徵: MAE = {best['mae']:.2f}")
        print(f"   減少特徵改善: {improvement_best_vs_all:+.1f}%")
    else:
        print(f"\n⚠️ 結論: 所有特徵都有用")

    return results, best, indices, importances


def main():
    """主測試流程"""
    print("=" * 80)
    print("🎯 特徵選擇測試 (完整 Railway 數據)")
    print("=" * 80)
    print(f"時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # 1. 加載數據
    df = load_exported_data()
    if df is None:
        return

    # 2. 排除 COVID
    df = exclude_covid_periods(df)

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
    results, best, indices, importances = test_feature_selection(
        X_train, y_train, X_test, y_test, feature_names
    )

    # 7. 保存結果
    output = {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'data_info': {
            'total_records': len(df),
            'date_range': f"{df['Date'].min()} → {df['Date'].max()}",
            'train_size': len(X_train),
            'test_size': len(X_test)
        },
        'baseline_mae': 15.73,
        'total_features': len(feature_names),
        'best_n_features': best['n_features'],
        'best_mae': best['mae'],
        'improvement_pct': best['improvement'],
        'feature_importance': {
            feature_names[i]: float(importances[i]) for i in range(len(feature_names))
        },
        'all_results': results
    }

    os.makedirs('models', exist_ok=True)
    with open('models/feature_selection_full_results.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n💾 結果已保存到 models/feature_selection_full_results.json")

    # 推薦
    print("\n" + "=" * 80)
    print("💡 推薦")
    print("=" * 80)
    print(f"\n最佳 {best['n_features']} 個特徵:")
    for i in range(best['n_features']):
        idx = indices[i]
        print(f"   {i+1}. {feature_names[idx]} (重要性: {importances[idx]:.4f})")

    print("\n" + "=" * 80)
    print("✅ 測試完成")
    print("=" * 80)


if __name__ == '__main__':
    main()
