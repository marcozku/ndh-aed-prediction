# -*- coding: utf-8 -*-
"""
測試額外特徵組 - 天氣預報/歷史天氣/流感/AI
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

# 最佳 10 個基礎特徵
OPTIMAL_BASE_FEATURES = [
    'Attendance_EWMA7', 'Daily_Change', 'Attendance_EWMA14',
    'Weekly_Change', 'Day_of_Week', 'Attendance_Lag7',
    'Attendance_Lag1', 'Is_Weekend', 'DayOfWeek_sin', 'DayOfWeek_cos'
]

BASELINE_MAE = 2.91


def load_exported_data():
    """加載導出的完整數據"""
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
        return None

    df['date'] = pd.to_datetime(df['date']).dt.date
    print(f"   ✅ 加載 {len(df)} 筆記錄")
    return df


def exclude_covid_periods(df):
    """排除 COVID 期間"""
    print("\n🦠 排除 COVID 期間...")
    original_count = len(df)

    for start, end in COVID_PERIODS:
        start_date = pd.to_datetime(start).date()
        end_date = pd.to_datetime(end).date()
        mask = (df['date'] >= start_date) & (df['date'] <= end_date)
        df = df[~mask]

    print(f"   📊 過濾後: {len(df)} 筆 (移除 {original_count - len(df)} 筆)")
    return df


def prepare_base_features(df):
    """準備基礎特徵"""
    print("\n📊 準備基礎特徵...")

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

    df = df.dropna()
    print(f"   ✅ 基礎特徵準備完成: {len(df)} 筆")
    return df


def prepare_flu_features(df):
    """準備流感季節特徵"""
    print("\n🦠 準備流感季節特徵...")

    df = df.copy()

    # 香港流感季節定義
    # 冬季流感: 1-3月, 夏季流感: 7-8月
    df['Flu_Month'] = df['Month'].map({
        1: 1, 2: 1, 3: 1,      # 冬季高峰
        7: 2, 8: 2,            # 夏季流感
    }).fillna(0)

    df['Flu_Season_Winter'] = df['Month'].isin([1, 2, 3]).astype(int)
    df['Flu_Season_Summer'] = df['Month'].isin([7, 8]).astype(int)

    # 流感高峰 (假設1月15-31日是最高峰)
    df['Flu_Is_Peak'] = ((df['Month'] == 1) & (df['Day_of_Month'] >= 15)).astype(int)

    # 距離高峰天數
    df['Flu_Days_To_Peak'] = df.apply(
        lambda row: abs((row['Date'] - pd.Timestamp(row['Date'].year, 1, 20)).days)
        if row['Month'] in [12, 1, 2] else 365,
        axis=1
    )

    # 高峰前後7天
    df['Flu_Pre_Peak_7d'] = ((df['Month'] == 1) & (df['Day_of_Month'] >= 8) & (df['Day_of_Month'] < 15)).astype(int)
    df['Flu_Post_Peak_7d'] = ((df['Month'] == 1) & (df['Day_of_Month'] >= 20) & (df['Day_of_Month'] <= 27)).astype(int)

    # 流感強度 (基於月份)
    df['Flu_Intensity'] = df['Month'].map({
        1: 1.0,   # 冬季最高
        2: 0.8,
        3: 0.6,
        7: 0.5,   # 夏季
        8: 0.4,
    }).fillna(0.1)

    df['Flu_Intensity_Level'] = pd.cut(df['Flu_Intensity'],
                                        bins=[0, 0.3, 0.6, 1.0],
                                        labels=[0, 1, 2]).astype(int)

    # 新年後效應
    df['Flu_Post_NewYear'] = ((df['Month'] == 2) & (df['Day_of_Month'] <= 7)).astype(int)

    # 開學效應 (9月1日後)
    df['Flu_School_Start'] = ((df['Month'] == 9) & (df['Day_of_Month'] <= 15)).astype(int)

    flu_features = [
        'Flu_Month', 'Flu_Season_Winter', 'Flu_Season_Summer',
        'Flu_Is_Peak', 'Flu_Days_To_Peak',
        'Flu_Pre_Peak_7d', 'Flu_Post_Peak_7d',
        'Flu_Intensity', 'Flu_Intensity_Level',
        'Flu_Post_NewYear', 'Flu_School_Start'
    ]

    print(f"   ✅ 流感特徵準備完成: {len(flu_features)} 個")
    return df, flu_features


def prepare_advanced_time_features(df):
    """準備高級時間特徵 (模擬 AI 因素)"""
    print("\n🤖 準備 AI 因素特徵...")

    df = df.copy()

    # 月份週期編碼
    df['Month_sin'] = np.sin(2 * np.pi * df['Month'] / 12)
    df['Month_cos'] = np.cos(2 * np.pi * df['Month'] / 12)

    # 日期週期編碼
    df['Day_sin'] = np.sin(2 * np.pi * df['Day_of_Month'] / 31)
    df['Day_cos'] = np.cos(2 * np.pi * df['Day_of_Month'] / 31)

    # 季度
    df['Quarter'] = df['Date'].dt.quarter
    df['Quarter_Start'] = df['Date'].dt.is_quarter_start.astype(int)

    # 月初月末
    df['Month_Start'] = (df['Day_of_Month'] <= 5).astype(int)
    df['Month_End'] = (df['Day_of_Month'] >= 25).astype(int)

    # 週內第幾天 (0-6)
    df['Week_of_Year'] = df['Date'].dt.isocalendar().week.astype(int)

    # 年末年初
    df['Year_End'] = (df['Month'] == 12).astype(int)
    df['Year_Start'] = (df['Month'] == 1).astype(int)

    # 工作日/週末過渡
    df['Is_Monday'] = (df['Day_of_Week'] == 0).astype(int)
    df['Is_Friday'] = (df['Day_of_Week'] == 4).astype(int)

    # 趨勢特徵
    df['Trend_7d'] = df['Attendance_EWMA7'].diff(7)
    df['Trend_30d'] = df['Attendance_EWMA14'].diff(30)

    # 波動率
    df['Volatility_7d'] = df['patient_count'].rolling(7).std().fillna(0)

    ai_features = [
        'Month_sin', 'Month_cos', 'Day_sin', 'Day_cos',
        'Quarter', 'Quarter_Start', 'Month_Start', 'Month_End',
        'Week_of_Year', 'Year_End', 'Year_Start',
        'Is_Monday', 'Is_Friday',
        'Trend_7d', 'Trend_30d', 'Volatility_7d'
    ]

    # 填補 NaN
    df['Trend_7d'] = df['Trend_7d'].fillna(0)
    df['Trend_30d'] = df['Trend_30d'].fillna(0)

    print(f"   ✅ AI 特徵準備完成: {len(ai_features)} 個")
    return df, ai_features


def prepare_simulated_weather_features(df):
    """模擬天氣特徵 (因為沒有真實天氣數據)"""
    print("\n🌤️ 準備模擬天氣特徵...")

    df = df.copy()

    # 基於月份和季節模擬天氣
    np.random.seed(42)

    # 溫度模擬 (香港)
    def simulate_temp(month):
        base_temps = {1: 17, 2: 18, 3: 21, 4: 25, 5: 28, 6: 30,
                      7: 31, 8: 31, 9: 30, 10: 28, 11: 24, 12: 19}
        base = base_temps.get(month, 25)
        return base + np.random.randn() * 3

    df['Sim_Temp'] = df['Month'].apply(simulate_temp)

    # 溫度範圍
    df['Sim_Temp_Range'] = np.random.uniform(3, 8, len(df))

    # 降雨機率
    rain_prob_by_month = {1: 0.3, 2: 0.35, 3: 0.4, 4: 0.5, 5: 0.6, 6: 0.7,
                          7: 0.6, 8: 0.7, 9: 0.6, 10: 0.4, 11: 0.3, 12: 0.25}
    df['Sim_Rain_Prob'] = df['Month'].map(rain_prob_by_month)
    df['Sim_Is_Rainy'] = (np.random.random(len(df)) < df['Sim_Rain_Prob']).astype(int)

    # 濕度
    df['Sim_Humidity'] = 70 + np.random.randn() * 10

    # 天氣狀況
    df['Sim_Is_Sunny'] = (df['Sim_Is_Rainy'] == 0).astype(int)
    df['Sim_Is_Cloudy'] = ((df['Sim_Rain_Prob'] > 0.3) & (df['Sim_Rain_Prob'] < 0.6) & (df['Sim_Is_Rainy'] == 0)).astype(int)

    # 極端天氣
    df['Sim_Is_Very_Hot'] = (df['Sim_Temp'] > 30).astype(int)
    df['Sim_Is_Very_Cold'] = (df['Sim_Temp'] < 15).astype(int)

    # 溫度變化
    df['Sim_Temp_Change_1d'] = df['Sim_Temp'].diff().fillna(0)
    df['Sim_Temp_Change_3d'] = df['Sim_Temp'].diff(3).fillna(0)

    weather_features = [
        'Sim_Temp', 'Sim_Temp_Range', 'Sim_Rain_Prob', 'Sim_Is_Rainy',
        'Sim_Humidity', 'Sim_Is_Sunny', 'Sim_Is_Cloudy',
        'Sim_Is_Very_Hot', 'Sim_Is_Very_Cold',
        'Sim_Temp_Change_1d', 'Sim_Temp_Change_3d'
    ]

    print(f"   ✅ 模擬天氣特徵準備完成: {len(weather_features)} 個")
    return df, weather_features


def test_feature_combination(X_train, y_train, X_test, y_test, feature_names, combo_name):
    """測試特徵組合"""
    print(f"\n   測試: {combo_name} ({len(feature_names)} 個特徵)")

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

    y_pred = model.predict(X_test)
    mae = mean_absolute_error(y_test, y_pred)
    improvement = ((BASELINE_MAE - mae) / BASELINE_MAE * 100)

    # 特徵重要性
    importances = dict(zip(feature_names, model.feature_importances_))

    return mae, improvement, importances


def main():
    """主測試流程"""
    print("=" * 80)
    print("🎯 額外特徵組測試")
    print("=" * 80)
    print(f"時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # 1. 加載數據
    df = load_exported_data()
    if df is None:
        return

    # 2. 排除 COVID
    df = exclude_covid_periods(df)

    # 3. 準備基礎特徵
    df = prepare_base_features(df)

    # 4. 準備額外特徵組
    df, flu_features = prepare_flu_features(df)
    df, ai_features = prepare_advanced_time_features(df)
    df, weather_features = prepare_simulated_weather_features(df)

    # 5. 分割數據
    print("\n✂️ 分割數據...")
    train_size = int(len(df) * 0.8)
    train_df = df.iloc[:train_size]
    test_df = df.iloc[train_size:]

    y_train = train_df['patient_count']
    y_test = test_df['patient_count']

    print(f"   訓練集: {len(train_df)} 筆")
    print(f"   測試集: {len(test_df)} 筆")

    # 6. 測試各種組合
    print("\n" + "=" * 80)
    print("🔍 測試結果")
    print("=" * 80)

    results = {}

    # A. 基線 (最佳 10 個)
    X_train_base = train_df[OPTIMAL_BASE_FEATURES]
    X_test_base = test_df[OPTIMAL_BASE_FEATURES]
    mae, imp, imp_dict = test_feature_combination(
        X_train_base, y_train, X_test_base, y_test,
        OPTIMAL_BASE_FEATURES, "📍 基線 (最佳 10 個)"
    )
    results['baseline'] = {'mae': mae, 'improvement': imp, 'features': OPTIMAL_BASE_FEATURES}
    print(f"   MAE: {mae:.2f}, 改善: {imp:+.1f}%")

    # B. + 流感特徵
    combo_features = OPTIMAL_BASE_FEATURES + flu_features
    X_train_combo = train_df[combo_features]
    X_test_combo = test_df[combo_features]
    mae, imp, imp_dict = test_feature_combination(
        X_train_combo, y_train, X_test_combo, y_test,
        combo_features, "🦠 基線 + 流感特徵"
    )
    results['flu'] = {'mae': mae, 'improvement': imp, 'features': combo_features}
    flu_imp = imp
    flu_imp_dict = imp_dict
    print(f"   MAE: {mae:.2f}, 改善: {imp:+.1f}%")

    # C. + AI 特徵
    combo_features = OPTIMAL_BASE_FEATURES + ai_features
    X_train_combo = train_df[combo_features]
    X_test_combo = test_df[combo_features]
    mae, imp, imp_dict = test_feature_combination(
        X_train_combo, y_train, X_test_combo, y_test,
        combo_features, "🤖 基線 + AI 因素"
    )
    results['ai'] = {'mae': mae, 'improvement': imp, 'features': combo_features}
    ai_imp = imp
    print(f"   MAE: {mae:.2f}, 改善: {imp:+.1f}%")

    # D. + 模擬天氣特徵
    combo_features = OPTIMAL_BASE_FEATURES + weather_features
    X_train_combo = train_df[combo_features]
    X_test_combo = test_df[combo_features]
    mae, imp, imp_dict = test_feature_combination(
        X_train_combo, y_train, X_test_combo, y_test,
        combo_features, "🌤️ 基線 + 模擬天氣"
    )
    results['weather'] = {'mae': mae, 'improvement': imp, 'features': combo_features}
    weather_imp = imp
    print(f"   MAE: {mae:.2f}, 改善: {imp:+.1f}%")

    # E. 全部組合
    combo_features = OPTIMAL_BASE_FEATURES + flu_features + ai_features + weather_features
    X_train_combo = train_df[combo_features]
    X_test_combo = test_df[combo_features]
    mae, imp, imp_dict = test_feature_combination(
        X_train_combo, y_train, X_test_combo, y_test,
        combo_features, "🔥 基線 + 全部額外特徵"
    )
    results['all'] = {'mae': mae, 'improvement': imp, 'features': combo_features}
    all_imp = imp
    all_imp_dict = imp_dict
    print(f"   MAE: {mae:.2f}, 改善: {imp:+.1f}%")

    # 7. 總結
    print("\n" + "=" * 80)
    print("📊 測試總結")
    print("=" * 80)
    print(f"\n{'組合':<30} {'MAE':<10} {'改善 %':<10} {'狀態':<5}")
    print("-" * 60)

    baseline_mae = results['baseline']['mae']
    for name, data in results.items():
        status = "✅" if data['mae'] <= baseline_mae else "⚠️"
        print(f"{name:<30} {data['mae']:<10.2f} {data['improvement']:>+6.1f}%   {status}")

    # 8. 找出最佳
    best = min(results.items(), key=lambda x: x[1]['mae'])
    print(f"\n🏆 最佳組合: {best[0]}")
    print(f"   MAE: {best[1]['mae']:.2f}")
    print(f"   改善: {best[1]['improvement']:+.1f}%")

    # 9. 流感特徵重要性分析
    print("\n" + "=" * 80)
    print("🦠 流感特徵重要性分析")
    print("=" * 80)
    for feat in flu_features:
        imp = flu_imp_dict.get(feat, 0)
        print(f"   {feat:<30} {imp:.4f}")

    # 10. AI 特徵重要性分析
    print("\n" + "=" * 80)
    print("🤖 AI 特徵重要性分析 (Top 10)")
    print("=" * 80)
    ai_sorted = sorted(ai_features, key=lambda x: all_imp_dict.get(x, 0), reverse=True)[:10]
    for feat in ai_sorted:
        imp = all_imp_dict.get(feat, 0)
        print(f"   {feat:<30} {imp:.4f}")

    # 11. 天氣特徵重要性分析
    print("\n" + "=" * 80)
    print("🌤️ 天氣特徵重要性分析")
    print("=" * 80)
    for feat in weather_features:
        imp = all_imp_dict.get(feat, 0)
        print(f"   {feat:<30} {imp:.4f}")

    # 12. 保存結果
    output = {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'baseline_mae': BASELINE_MAE,
        'results': {
            name: {'mae': data['mae'], 'improvement': data['improvement'], 'n_features': len(data['features'])}
            for name, data in results.items()
        },
        'best_combo': best[0],
        'best_mae': best[1]['mae'],
        'best_improvement': best[1]['improvement'],
        'feature_importance': {k: float(v) for k, v in all_imp_dict.items()}
    }

    os.makedirs('models', exist_ok=True)
    with open('models/additional_features_results.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n💾 結果已保存到 models/additional_features_results.json")

    # 13. 推薦
    print("\n" + "=" * 80)
    print("💡 推薦")
    print("=" * 80)

    if best[0] == 'baseline':
        print("\n⚠️ 結論: 基線 (10 個特徵) 已經是最好的")
        print("   額外特徵沒有帶來顯著改善")
        print("   建議: 保持現有的 10 個最佳特徵")
    else:
        print(f"\n✅ 建議使用: {best[0]}")
        print(f"   MAE: {best[1]['mae']:.2f}")
        print(f"   比基線改善: {((results['baseline']['mae'] - best[1]['mae']) / results['baseline']['mae'] * 100):+.1f}%")

    print("\n" + "=" * 80)
    print("✅ 測試完成")
    print("=" * 80)


if __name__ == '__main__':
    main()
