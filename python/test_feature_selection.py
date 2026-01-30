# -*- coding: utf-8 -*-
"""
特徵選擇優化測試

目標: 找出最佳特徵數量和特徵子集

方法:
1. 遞增特徵測試 (Forward Selection) - 從少到多
2. 遞減特徵測試 (Backward Selection) - 從多到少
3. 遞歸特徵消除 (RFECV) - 自動選擇最優
4. 特徵重要性排名 (XGBoost importance)
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
from sklearn.model_selection import TimeSeriesSplit, cross_val_score
from sklearn.preprocessing import StandardScaler
from sklearn.feature_selection import RFECV, SelectKBest, f_regression, mutual_info_regression
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
import xgboost as xgb
import json
import os
import warnings
warnings.filterwarnings('ignore')

# 導入特徵模組
from weather_forecast_integration import fetch_weather_forecast, get_forecast_feature_list
from flu_season_features import add_flu_features_to_df, get_flu_feature_list
from historical_weather_patterns import (
    add_historical_weather_pattern_features,
    get_historical_weather_feature_list
)

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


def prepare_all_features(df):
    """準備所有特徵"""
    print("\n📊 準備特徵...")

    df = df.rename(columns={'date': 'Date'})

    # 基礎特徵
    df = add_base_features(df)

    # 流感季節
    df = add_flu_features_to_df(df, date_col='Date')

    # 歷史天氣模式
    weather_df = load_weather_data()
    if weather_df is not None:
        df = add_historical_weather_pattern_features(df, weather_df, df)

    # 天氣預報
    forecast_df = fetch_weather_forecast()
    if forecast_df is not None and len(forecast_df) > 0:
        from weather_forecast_integration import add_forecast_features_to_df
        df = add_forecast_features_to_df(df, forecast_df, date_col='Date')

    # 移除 NaN
    df = df.dropna()

    print(f"   ✅ 特徵準備完成: {len(df)} 筆")
    return df


def add_base_features(df):
    """添加基礎特徵"""
    df = df.copy()
    df['Date'] = pd.to_datetime(df['Date'])

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

    # 動態因子
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

    return df


def test_feature_counts(X_train, y_train, X_test, y_test, feature_names):
    """
    測試不同特徵數量的效果

    方法: 遞增測試（從 5 個特徵開始，每次 +5）
    """
    print("\n" + "=" * 80)
    print("🔍 測試 1: 遞增特徵數量測試")
    print("=" * 80)

    results = []

    # 測試範圍: 5 到所有特徵，每次 +5
    max_features = len(feature_names)
    feature_counts = list(range(5, min(max_features, 81), 5))

    # 如果 max_features 不是 5 的倍數，添加最後一次
    if max_features % 5 != 0:
        feature_counts.append(max_features)

    print(f"\n測試範圍: {min(feature_counts)} 到 {max(feature_counts)} 個特徵")
    print(f"總特徵數: {max_features}\n")

    for n_features in feature_counts:
        if n_features > max_features:
            n_features = max_features

        # 選擇前 n_features 個特徵（基於重要性）
        model = xgb.XGBRegressor(
            n_estimators=300,
            max_depth=6,
            learning_rate=0.05,
            random_state=42,
            n_jobs=-1
        )

        # 先訓練獲取特徵重要性
        model.fit(X_train, y_train, verbose=False)

        # 獲取特徵重要性
        importances = model.feature_importances_
        indices = np.argsort(importances)[::-1]

        # 選擇 top n_features
        selected_indices = indices[:n_features]
        selected_features = [feature_names[i] for i in selected_indices]

        # 重新訓練
        X_train_selected = X_train.iloc[:, selected_indices]
        X_test_selected = X_test.iloc[:, selected_indices]

        model_selected = xgb.XGBRegressor(
            n_estimators=300,
            max_depth=6,
            learning_rate=0.05,
            random_state=42,
            n_jobs=-1
        )
        model_selected.fit(X_train_selected, y_train, verbose=False)

        # 評估
        from sklearn.metrics import mean_absolute_error
        y_pred = model_selected.predict(X_test_selected)
        mae = mean_absolute_error(y_test, y_pred)

        results.append({
            'n_features': n_features,
            'mae': mae,
            'features': selected_features
        })

        print(f"   {n_features:3d} 特徵: MAE = {mae:.2f}")

    # 找出最佳
    best_result = min(results, key=lambda x: x['mae'])

    print("\n" + "=" * 80)
    print(f"🏆 最佳特徵數量: {best_result['n_features']} 個")
    print(f"   MAE: {best_result['mae']:.2f}")
    print(f"   改善: {((15.73 - best_result['mae']) / 15.73 * 100):.1f}%")
    print("=" * 80)

    return results, best_result


def test_backward_selection(X_train, y_train, X_test, y_test, feature_names):
    """
    遞減特徵選擇

    方法: 從所有特徵開始，逐步移除不重要的特徵
    """
    print("\n" + "=" * 80)
    print("🔍 測試 2: 遞減特徵選擇")
    print("=" * 80)

    results = []
    remaining_features = list(range(len(feature_names)))

    # 訓練初始模型
    model = xgb.XGBRegressor(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.05,
        random_state=42,
        n_jobs=-1
    )
    model.fit(X_train.iloc[:, remaining_features], y_train, verbose=False)

    from sklearn.metrics import mean_absolute_error
    y_pred = model.predict(X_test.iloc[:, remaining_features])
    best_mae = mean_absolute_error(y_test, y_pred)

    print(f"\n初始 ({len(remaining_features)} 特徵): MAE = {best_mae:.2f}")

    # 每次移除 5 個最不重要的特徵
    iteration = 0
    while len(remaining_features) > 10:
        iteration += 1

        # 訓練並獲取重要性
        model.fit(X_train.iloc[:, remaining_features], y_train, verbose=False)
        importances = model.feature_importances_

        # 找出最不重要的 5 個特徵
        indices = np.argsort(importances)
        to_remove = indices[:min(5, len(indices))]

        # 移除
        remaining_features = [i for i in remaining_features if i not in to_remove]

        # 評估
        model.fit(X_train.iloc[:, remaining_features], y_train, verbose=False)
        y_pred = model.predict(X_test.iloc[:, remaining_features])
        mae = mean_absolute_error(y_test, y_pred)

        results.append({
            'iteration': iteration,
            'n_features': len(remaining_features),
            'mae': mae,
            'removed': to_remove
        })

        print(f"   迭代 {iteration} ({len(remaining_features):3d} 特徵): MAE = {mae:.2f}", end="")

        if mae < best_mae:
            best_mae = mae
            print(" ✅ 改善")
        else:
            print(" ❌ 惡化")

        # 如果連續 3 次沒有改善，停止
        if len(results) >= 3:
            recent_maes = [r['mae'] for r in results[-3:]]
            if all(m > best_mae for m in recent_maes):
                print(f"\n   ⚠️ 連續 3 次無改善，停止")
                break

    # 找出最佳
    best_result = min(results, key=lambda x: x['mae'])
    best_features_idx = remaining_features

    print("\n" + "=" * 80)
    print(f"🏆 最佳特徵數量: {best_result['n_features']} 個")
    print(f"   MAE: {best_result['mae']:.2f}")
    print("=" * 80)

    return results, best_result, best_features_idx


def test_rfecv(X_train, y_train, X_test, y_test, feature_names):
    """
    遞歸特徵消除交叉驗證

    自動找出最優特徵子集
    """
    print("\n" + "=" * 80)
    print("🔍 測試 3: 遞歸特徵消除 (RFECV)")
    print("=" * 80)

    from sklearn.feature_selection import RFECV
    from sklearn.model_selection import TimeSeriesSplit

    # 使用較簡單的模型加快速度
    estimator = RandomForestRegressor(
        n_estimators=100,
        max_depth=8,
        random_state=42,
        n_jobs=-1
    )

    # 時間序列交叉驗證
    tscv = TimeSeriesSplit(n_splits=3)

    # RFECV
    rfecv = RFECV(
        estimator=estimator,
        step=5,
        cv=tscv,
        scoring='neg_mean_absolute_error',
        min_features_to_select=10,
        n_jobs=-1
    )

    print("   ⏳ 執行 RFECV (這可能需要幾分鐘)...")
    rfecv.fit(X_train, y_train)

    # 結果
    optimal_n_features = rfecv.n_features_
    selected_features = [feature_names[i] for i in range(len(feature_names)) if rfecv.support_[i]]

    print(f"   ✅ 最優特徵數量: {optimal_n_features}")

    # 評估
    from sklearn.metrics import mean_absolute_error
    y_pred = rfecv.predict(X_test)
    mae = mean_absolute_error(y_test, y_pred)

    print(f"   MAE: {mae:.2f}")

    # 顯示選中的特徵
    print(f"\n   選中的特徵 ({len(selected_features)} 個):")
    for i, feature in enumerate(selected_features, 1):
        print(f"      {i:2d}. {feature}")

    return {
        'n_features': optimal_n_features,
        'mae': mae,
        'features': selected_features,
        'ranking': rfecv.ranking_
    }


def get_feature_importance_ranking(X_train, y_train, feature_names):
    """
    獲取特徵重要性排名
    """
    print("\n" + "=" * 80)
    print("🔍 測試 4: 特徵重要性排名")
    print("=" * 80)

    # 使用 XGBoost
    model = xgb.XGBRegressor(
        n_estimators=500,
        max_depth=6,
        learning_rate=0.05,
        random_state=42,
        n_jobs=-1
    )

    model.fit(X_train, y_train, verbose=False)

    # 特徵重要性
    importances = model.feature_importances_
    indices = np.argsort(importances)[::-1]

    print("\n   Top 30 特徵:")
    print(f"   {'排名':<4} {'特徵':<35} {'重要性':<10}")
    print("   " + "-" * 60)

    ranking = {}
    for i, idx in enumerate(indices[:30], 1):
        feature = feature_names[idx]
        importance = importances[idx]
        ranking[feature] = {
            'rank': i,
            'importance': importance
        }
        print(f"   {i:<4} {feature:<35} {importance:.4f}")

    # 分類統計
    print("\n   特徵分類統計:")

    base_features = ['Day_of_Week', 'Month', 'Day_of_Month', 'Is_Weekend', 'Holiday_Factor',
                     'DayOfWeek_sin', 'DayOfWeek_cos', 'Is_Winter_Flu_Season',
                     'Attendance_Lag1', 'Attendance_Lag7', 'Attendance_Lag30',
                     'Attendance_EWMA7', 'Attendance_EWMA14', 'Daily_Change', 'Weekly_Change']

    flu_features = get_flu_feature_list()
    weather_forecast_features = get_forecast_feature_list()
    historical_weather_features = get_historical_weather_feature_list()

    categories = {
        '基礎特徵': base_features,
        '流感季節': flu_features,
        '天氣預報': weather_forecast_features,
        '歷史天氣': historical_weather_features
    }

    for category, features in categories.items():
        available = [f for f in features if f in feature_names]
        if len(available) > 0:
            # 計算平均重要性
            category_importance = []
            for feature in available:
                if feature in feature_names:
                    idx = feature_names.index(feature)
                    category_importance.append(importances[idx])

            avg_importance = np.mean(category_importance)
            print(f"      {category:<12} {len(available):2d} 個特徵, 平均重要性: {avg_importance:.4f}")

    return ranking, importances, indices


def main():
    """主測試流程"""
    print("=" * 80)
    print("🎯 特徵選擇優化測試")
    print("=" * 80)
    print(f"時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # 1. 加載數據
    df = load_data()
    if df is None:
        return

    # 2. 準備特徵
    df = prepare_all_features(df)

    # 3. 獲取特徵列表
    print("\n📋 特徵列表...")

    # 基礎特徵
    base_features = [
        'Day_of_Week', 'Month', 'Day_of_Month', 'Is_Weekend',
        'Holiday_Factor', 'Is_Winter_Flu_Season',
        'DayOfWeek_sin', 'DayOfWeek_cos',
        'Attendance_Lag1', 'Attendance_Lag7', 'Attendance_Lag30',
        'Attendance_EWMA7', 'Attendance_EWMA14',
        'Daily_Change', 'Weekly_Change'
    ]

    # 其他特徵
    flu_features = get_flu_feature_list()
    weather_forecast_features = [f for f in get_forecast_feature_list() if f in df.columns]
    historical_weather_features = [f for f in get_historical_weather_feature_list() if f in df.columns]

    all_features = base_features + flu_features + historical_weather_features + weather_forecast_features

    # 只保留存在的特徵
    all_features = [f for f in all_features if f in df.columns]

    print(f"   總特徵數: {len(all_features)}")
    print(f"   - 基礎特徵: {len(base_features)}")
    print(f"   - 流感季節: {len(flu_features)}")
    print(f"   - 歷史天氣: {len(historical_weather_features)}")
    print(f"   - 天氣預報: {len(weather_forecast_features)}")

    # 4. 分割數據
    print("\n✂️ 分割數據...")
    train_size = int(len(df) * 0.8)

    train_df = df.iloc[:train_size]
    test_df = df.iloc[train_size:]

    X_train = train_df[all_features]
    y_train = train_df['patient_count']
    X_test = test_df[all_features]
    y_test = test_df['patient_count']

    print(f"   訓練集: {len(X_train)} 筆")
    print(f"   測試集: {len(X_test)} 筆")

    # 測試 1: 遞增特徵
    forward_results, best_forward = test_feature_counts(X_train, y_train, X_test, y_test, all_features)

    # 測試 2: 特徵重要性排名
    ranking, importances, indices = get_feature_importance_ranking(X_train, y_train, all_features)

    # 測試 3: RFECV
    rfecv_result = test_rfecv(X_train, y_train, X_test, y_test, all_features)

    # 總結
    print("\n" + "=" * 80)
    print("📊 測試總結")
    print("=" * 80)

    print(f"\n基準 (舊模型): MAE = 15.73")
    print(f"遞增特徵最佳: {best_forward['n_features']} 個特徵, MAE = {best_forward['mae']:.2f}")
    print(f"RFECV 最佳: {rfecv_result['n_features']} 個特徵, MAE = {rfecv_result['mae']:.2f}")

    # 找出整體最佳
    best_overall = min([
        ('Forward', best_forward),
        ('RFECV', rfecv_result)
    ], key=lambda x: x[1]['mae'])

    print(f"\n🏆 最佳方法: {best_overall[0]}")
    print(f"   特徵數量: {best_overall[1]['n_features']}")
    print(f"   MAE: {best_overall[1]['mae']:.2f}")
    print(f"   改善: {((15.73 - best_overall[1]['mae']) / 15.73 * 100):.1f}%")

    # 保存結果
    results = {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'baseline_mae': 15.73,
        'total_features': len(all_features),
        'forward_selection': {
            'best_n_features': best_forward['n_features'],
            'best_mae': best_forward['mae'],
            'all_results': [{'n': r['n_features'], 'mae': r['mae']} for r in forward_results]
        },
        'rfecv': {
            'best_n_features': rfecv_result['n_features'],
            'best_mae': rfecv_result['mae'],
            'selected_features': rfecv_result['features']
        },
        'best_overall': {
            'method': best_overall[0],
            'n_features': best_overall[1]['n_features'],
            'mae': best_overall[1]['mae'],
            'improvement_pct': ((15.73 - best_overall[1]['mae']) / 15.73 * 100)
        }
    }

    os.makedirs('models', exist_ok=True)
    with open('models/feature_selection_results.json', 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"\n💾 結果已保存到 models/feature_selection_results.json")

    # 推薦
    print("\n" + "=" * 80)
    print("💡 推薦")
    print("=" * 80)

    if best_overall[1]['n_features'] < len(all_features) * 0.5:
        print(f"\n✅ 特徵數量可以減少!")
        print(f"   從 {len(all_features)} 個減少到 {best_overall[1]['n_features']} 個")
        print(f"   減少 {len(all_features) - best_overall[1]['n_features']} 個特徵 ({(1 - best_overall[1]['n_features']/len(all_features))*100:.1f}%)")
        print(f"   同時改善準確度!")
    else:
        print(f"\n⚠️ 大部分特徵都有用")
        print(f"   推薦使用 {best_overall[1]['n_features']} 個特徵")

    print(f"\n使用這 {best_overall[1]['n_features']} 個特徵重新訓練模型以獲得最佳結果。")

    print("\n" + "=" * 80)
    print("✅ 測試完成")
    print("=" * 80)


if __name__ == '__main__':
    main()
