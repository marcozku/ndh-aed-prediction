# -*- coding: utf-8 -*-
"""
整合所有優化特徵的訓練腳本
結合: 天氣預報 + 歷史天氣滯後 + 流感季節

基準: MAE = 15.73 (Ensemble + 天氣 + 排除 COVID)
目標: MAE = 14.0-14.5 (8-11% 改善)
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
from datetime import datetime, timedelta
import psycopg2
import psycopg2.extras
from sklearn.model_selection import TimeSeriesSplit
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
import xgboost as xgb
import json
import os

# 導入特徵模組
from weather_forecast_integration import (
    fetch_weather_forecast,
    add_forecast_features_to_df,
    get_forecast_feature_list
)
from flu_season_features import (
    add_flu_features_to_df,
    get_flu_feature_list
)
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

# COVID 影響期間
COVID_PERIODS = [
    ('2020-01-23', '2020-04-08'),  # 第一波
    ('2020-07-16', '2020-09-30'),  # 第三波
    ('2020-11-23', '2021-01-05'),  # 第四波
    ('2022-02-05', '2022-04-30'),  # 第五波
    ('2022-11-10', '2022-12-27'),  # 放寬前
]


def load_data_from_railway():
    """從 Railway 數據庫加載所有歷史數據"""
    try:
        print("📡 連接 Railway 數據庫...")

        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # 獲取所有就診數據
        query = """
        SELECT date, patient_count
        FROM actual_data
        ORDER BY date ASC
        """

        cursor.execute(query)
        rows = cursor.fetchall()

        cursor.close()
        conn.close()

        if not rows:
            print("   ❌ 沒有數據")
            return None

        df = pd.DataFrame(rows)
        df['date'] = pd.to_datetime(df['date'])

        print(f"   ✅ 成功加載 {len(df)} 筆記錄")
        print(f"   📅 範圍: {df['date'].min()} → {df['date'].max()}")

        return df

    except Exception as e:
        print(f"   ❌ 錯誤: {e}")
        return None


def load_weather_data():
    """加載歷史天氣數據"""
    weather_file = 'models/weather_full_history.csv'

    if not os.path.exists(weather_file):
        print(f"   ⚠️ 天氣數據不存在: {weather_file}")
        return None

    try:
        weather_df = pd.read_csv(weather_file)
        weather_df['Date'] = pd.to_datetime(weather_df['Date'])

        print(f"   ✅ 天氣數據: {len(weather_df)} 筆")

        return weather_df

    except Exception as e:
        print(f"   ❌ 錯誤: {e}")
        return None


def exclude_covid_periods(df, date_col='date'):
    """排除 COVID 影響期間"""
    df = df.copy()

    # 標記 COVID 期間
    df['is_covid'] = 0
    for start, end in COVID_PERIODS:
        start_date = pd.to_datetime(start)
        end_date = pd.to_datetime(end)
        mask = (df[date_col] >= start_date) & (df[date_col] <= end_date)
        df.loc[mask, 'is_covid'] = 1

    # 過濾
    df_filtered = df[df['is_covid'] == 0].copy()

    print(f"   📊 過濾 COVID: {len(df)} → {len(df_filtered)} 筆")

    return df_filtered


def prepare_features(df, forecast_df=None):
    """
    準備所有特徵

    特徵組合:
    1. 基礎特徵 (時間、滯後就診)
    2. 歷史天氣模式特徵 (天氣變化、極端天氣、年度同期)
    3. 流感季節特徵
    4. 天氣預報特徵
    """
    print("\n📊 準備特徵...")

    # 1. 基礎特徵
    df = add_base_features(df)
    print("   ✅ 基礎特徵")

    # 2. 流感季節特徵
    df = add_flu_features_to_df(df, date_col='Date')
    print("   ✅ 流感季節特徵")

    # 3. 歷史天氣模式特徵
    weather_df = load_weather_data()
    df = add_historical_weather_pattern_features(df, weather_df, df)

    # 4. 天氣預報特徵
    if forecast_df is not None:
        df = add_forecast_features_to_df(df, forecast_df, date_col='Date')
        print("   ✅ 天氣預報特徵")
    else:
        print("   ⚠️ 無天氣預報數據")

    # 移除包含 NaN 的行
    before_len = len(df)
    df = df.dropna()
    after_len = len(df)

    if before_len > after_len:
        print(f"   🧹 移除 NaN: {before_len} → {after_len}")

    return df


def get_all_feature_lists():
    """獲取所有特徵列表"""
    base_features = [
        'Day_of_Week', 'Month', 'Day_of_Month', 'Is_Weekend',
        'Holiday_Factor', 'Is_Winter_Flu_Season',
        'DayOfWeek_sin', 'DayOfWeek_cos',
        'Attendance_Lag1', 'Attendance_Lag7', 'Attendance_Lag30',
        'Attendance_EWMA7', 'Attendance_EWMA14',
        'Daily_Change', 'Weekly_Change'
    ]

    historical_weather_features = [
        'Weather_Rain_1d', 'Weather_Rain_2d', 'Weather_Rain_3d',
        'Weather_Mean_Temp_1d', 'Weather_Mean_Temp_2d', 'Weather_Mean_Temp_3d',
        'Weather_Cold_1d', 'Weather_Cold_2d', 'Weather_Cold_3d',
        'Weather_Hot_1d', 'Weather_Hot_2d', 'Weather_Hot_3d',
        'Weather_Cold_Spell_3d', 'Weather_Temp_Trend_3d', 'Weather_Rain_Accum_7d'
    ]

    flu_features = get_flu_feature_list()
    forecast_features = get_forecast_feature_list()

    return {
        'base': base_features,
        'historical_weather': historical_weather_features,
        'flu': flu_features,
        'forecast': forecast_features
    }


def train_models(X_train, y_train, X_test, y_test):
    """訓練多個模型並返回預測結果"""
    print("\n🤖 訓練模型...")

    models = {}
    predictions = {}

    # 1. XGBoost
    print("   訓練 XGBoost...")
    models['xgboost'] = xgb.XGBRegressor(
        n_estimators=500,
        max_depth=6,
        learning_rate=0.05,
        min_child_weight=3,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        n_jobs=-1
    )
    models['xgboost'].fit(X_train, y_train, verbose=False)
    predictions['xgboost'] = models['xgboost'].predict(X_test)

    # 2. Random Forest
    print("   訓練 Random Forest...")
    models['random_forest'] = RandomForestRegressor(
        n_estimators=300,
        max_depth=10,
        min_samples_split=5,
        min_samples_leaf=2,
        random_state=42,
        n_jobs=-1
    )
    models['random_forest'].fit(X_train, y_train)
    predictions['random_forest'] = models['random_forest'].predict(X_test)

    # 3. Gradient Boosting
    print("   訓練 Gradient Boosting...")
    models['gradient_boosting'] = GradientBoostingRegressor(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.05,
        min_samples_split=5,
        min_samples_leaf=2,
        random_state=42
    )
    models['gradient_boosting'].fit(X_train, y_train)
    predictions['gradient_boosting'] = models['gradient_boosting'].predict(X_test)

    # 4. Ensemble (簡單平均)
    print("   訓練 Ensemble...")
    predictions['ensemble'] = np.mean([
        predictions['xgboost'],
        predictions['random_forest'],
        predictions['gradient_boosting']
    ], axis=0)

    return models, predictions


def evaluate_predictions(y_true, predictions):
    """評估預測結果"""
    from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

    results = {}

    for model_name, y_pred in predictions.items():
        mae = mean_absolute_error(y_true, y_pred)
        rmse = np.sqrt(mean_squared_error(y_true, y_pred))
        r2 = r2_score(y_true, y_pred)

        results[model_name] = {
            'MAE': mae,
            'RMSE': rmse,
            'R²': r2
        }

    return results


def main():
    """主訓練流程"""
    print("=" * 80)
    print("🚀 整合優化特徵訓練")
    print("=" * 80)
    print(f"時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # 1. 加載數據
    print("1️⃣ 加載數據...")
    df = load_data_from_railway()

    if df is None:
        return

    # 2. 排除 COVID 期間
    print("\n2️⃣ 排除 COVID 期間...")
    df = exclude_covid_periods(df, date_col='date')

    # 3. 獲取天氣預報
    print("\n3️⃣ 獲取天氣預報...")
    forecast_df = fetch_weather_forecast()

    if forecast_df is None or len(forecast_df) == 0:
        print("   ⚠️ 無法獲取天氣預報，使用現有特徵訓練")
        forecast_df = None

    # 4. 準備特徵
    print("\n4️⃣ 準備特徵...")
    df = df.rename(columns={'date': 'Date'})
    df = prepare_features(df, forecast_df)

    # 5. 獲取特徵列表
    print("\n5️⃣ 獲取特徵列表...")
    feature_lists = get_all_feature_lists()

    all_features = (
        feature_lists['base'] +
        feature_lists['flu'] +
        feature_lists['historical_weather']
    )

    # 只添加可用的預報特徵
    if forecast_df is not None:
        available_forecast_features = [f for f in feature_lists['forecast'] if f in df.columns]
        all_features += available_forecast_features
        print(f"   📊 天氣預報特徵: {len(available_forecast_features)}")
    else:
        print(f"   ⚠️ 無天氣預報特徵")

    print(f"   📊 總特徵數: {len(all_features)}")
    print(f"   📋 特徵列表: {all_features[:10]}...")

    # 6. 時間序列分割
    print("\n6️⃣ 時間序列分割...")
    train_size = int(len(df) * 0.8)

    train_df = df.iloc[:train_size].copy()
    test_df = df.iloc[train_size:].copy()

    print(f"   訓練集: {len(train_df)} 筆")
    print(f"   測試集: {len(test_df)} 筆")
    print(f"   測試範圍: {test_df['Date'].min()} → {test_df['Date'].max()}")

    # 7. 準備 X, y
    print("\n7️⃣ 準備訓練數據...")
    X_train = train_df[all_features]
    y_train = train_df['patient_count']
    X_test = test_df[all_features]
    y_test = test_df['patient_count']

    # 8. 訓練模型
    print("\n8️⃣ 訓練模型...")
    models, predictions = train_models(X_train, y_train, X_test, y_test)

    # 9. 評估結果
    print("\n9️⃣ 評估結果...")
    results = evaluate_predictions(y_test, predictions)

    print("\n" + "=" * 80)
    print("📊 模型評估結果")
    print("=" * 80)

    # 按 MAE 排序
    sorted_results = sorted(results.items(), key=lambda x: x[1]['MAE'])

    for model_name, metrics in sorted_results:
        print(f"\n{model_name.upper()}:")
        print(f"   MAE:  {metrics['MAE']:.2f}")
        print(f"   RMSE: {metrics['RMSE']:.2f}")
        print(f"   R²:   {metrics['R²']:.4f}")

    # 10. 計算改善
    print("\n" + "=" * 80)
    print("📈 改善分析")
    print("=" * 80)

    baseline_mae = 15.73
    best_mae = sorted_results[0][1]['MAE']
    improvement = (baseline_mae - best_mae) / baseline_mae * 100

    print(f"\n基準 (舊模型): MAE = {baseline_mae}")
    print(f"最佳 (新模型): MAE = {best_mae:.2f}")
    print(f"改善: {improvement:+.1f}%")

    if best_mae < baseline_mae:
        print(f"✅ 達成目標！改善 {improvement:.1f}%")
    else:
        print(f"⚠️ 未達基準，需要調整")

    # 11. 保存結果
    print("\n💾 保存結果...")

    results_summary = {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'baseline_mae': baseline_mae,
        'results': {k: {'MAE': float(v['MAE']), 'RMSE': float(v['RMSE']), 'R²': float(v['R²'])}
                    for k, v in results.items()},
        'improvement_pct': improvement,
        'feature_count': len(all_features),
        'train_size': len(train_df),
        'test_size': len(test_df)
    }

    os.makedirs('models', exist_ok=True)
    with open('models/integrated_optimization_results.json', 'w', encoding='utf-8') as f:
        json.dump(results_summary, f, ensure_ascii=False, indent=2)

    print(f"   ✅ 結果已保存到 models/integrated_optimization_results.json")

    # 12. 特徵重要性 (XGBoost)
    print("\n🔍 特徵重要性 (Top 15)...")
    importances = models['xgboost'].feature_importances_
    indices = np.argsort(importances)[::-1]

    print(f"\n   {'排名':<4} {'特徵':<30} {'重要性':<10}")
    print("   " + "-" * 50)

    for i in range(min(15, len(all_features))):
        idx = indices[i]
        print(f"   {i+1:<4} {all_features[idx]:<30} {importances[idx]:.4f}")

    print("\n" + "=" * 80)
    print("✅ 訓練完成")
    print("=" * 80)


if __name__ == '__main__':
    main()
