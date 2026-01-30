"""
測試 Random Forest vs XGBoost 長期預測能力
Test: 7-day vs 14-day vs 30-day prediction accuracy
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
from datetime import datetime, timedelta

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

def calculate_metrics(y_true, y_pred):
    mae = mean_absolute_error(y_true, y_pred)
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))
    mape = np.mean(np.abs((y_true - y_pred) / y_true)) * 100
    r2 = r2_score(y_true, y_pred)
    return {'mae': mae, 'rmse': rmse, 'mape': mape, 'r2': r2}

def simulate_multi_day_prediction(model, train_data, test_data, feature_cols, horizon_days):
    """
    模擬多天預測（遞歸預測）
    Day 1: 用真實 lag 特徵預測
    Day 2+: 用預測值作為 lag 特徵
    """
    predictions = []
    actuals = []

    # 複製數據以避免修改原始數據
    combined_data = pd.concat([train_data, test_data]).copy()
    combined_data = combined_data.sort_values('Date').reset_index(drop=True)

    test_start_idx = len(train_data)

    for i in range(len(test_data)):
        current_idx = test_start_idx + i

        # 計算這個預測點距離最後一個真實數據的天數
        days_ahead = min(i + 1, horizon_days)

        if days_ahead <= horizon_days:
            # 獲取特徵
            X = combined_data.loc[current_idx, feature_cols].values.reshape(1, -1)
            X = np.nan_to_num(X, nan=0.0)

            # 預測
            pred = model.predict(X)[0]
            predictions.append(pred)
            actuals.append(combined_data.loc[current_idx, 'Attendance'])

            # 更新後續的 lag 特徵（模擬遞歸預測）
            if i + 1 < len(test_data) and 'Attendance_Lag1' in feature_cols:
                # 用預測值更新 lag 特徵
                for future_offset in range(1, min(8, len(test_data) - i)):
                    future_idx = current_idx + future_offset
                    if future_idx < len(combined_data):
                        if future_offset == 1 and 'Attendance_Lag1' in combined_data.columns:
                            combined_data.loc[future_idx, 'Attendance_Lag1'] = pred
                        if future_offset == 7 and 'Attendance_Lag7' in combined_data.columns:
                            combined_data.loc[future_idx, 'Attendance_Lag7'] = pred

    return np.array(predictions), np.array(actuals)

def test_horizon_prediction(train_data, test_data, feature_cols, horizon_days, model_type='rf'):
    """測試特定預測範圍的準確度"""

    X_train = train_data[feature_cols].fillna(0)
    y_train = train_data['Attendance'].values

    if model_type == 'rf':
        model = RandomForestRegressor(
            n_estimators=200,
            max_depth=12,
            min_samples_split=10,
            random_state=42,
            n_jobs=-1
        )
    else:
        model = xgb.XGBRegressor(
            n_estimators=500,
            max_depth=8,
            learning_rate=0.05,
            random_state=42
        )

    model.fit(X_train, y_train)

    # 模擬多天預測
    predictions, actuals = simulate_multi_day_prediction(
        model, train_data, test_data, feature_cols, horizon_days
    )

    # 只取前 horizon_days 天的結果
    if len(predictions) > horizon_days:
        # 分段計算：Day 1-7, Day 8-14, Day 15-30
        results = {}

        # Day 1-7
        if len(predictions) >= 7:
            results['day_1_7'] = calculate_metrics(actuals[:7], predictions[:7])

        # Day 8-14
        if len(predictions) >= 14:
            results['day_8_14'] = calculate_metrics(actuals[7:14], predictions[7:14])

        # Day 15-30
        if len(predictions) >= 30:
            results['day_15_30'] = calculate_metrics(actuals[14:30], predictions[14:30])

        # Overall
        results['overall'] = calculate_metrics(actuals[:min(len(actuals), horizon_days)],
                                               predictions[:min(len(predictions), horizon_days)])

        return results
    else:
        return {'overall': calculate_metrics(actuals, predictions)}

def main():
    print("=" * 80)
    print("📊 長期預測能力測試: Random Forest vs XGBoost")
    print("   測試 7天、14天、30天 預測準確度")
    print("=" * 80)
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
    df = df[~covid_mask].copy()
    print(f"   數據量: {len(df)} 筆 (已排除 COVID)")

    # 創建特徵
    print("🔧 創建特徵...")
    df = create_comprehensive_features(df)
    df = df.dropna(subset=['Attendance'])

    # 特徵列表
    feature_cols = [
        "Attendance_Lag1", "Attendance_Lag7", "Attendance_Same_Weekday_Avg",
        "Day_of_Week", "DayOfWeek_Target_Mean", "Attendance_Rolling7",
        "Attendance_EWMA7", "Attendance_Lag14", "Attendance_Lag30",
        "Daily_Change", "Weekly_Change", "Is_Weekend",
        "Holiday_Factor", "Attendance_Std7", "Month"
    ]
    feature_cols = [c for c in feature_cols if c in df.columns]

    # 時間序列分割（保留最後 60 天作為測試）
    test_days = 60
    train_data = df[:-test_days].copy()
    test_data = df[-test_days:].copy()

    print(f"\n📊 數據分割:")
    print(f"   訓練集: {len(train_data)} 筆")
    print(f"   測試集: {len(test_data)} 筆 ({test_days} 天)")
    print(f"   測試日期: {test_data['Date'].min()} → {test_data['Date'].max()}")

    results = {}

    # ============================================
    # 測試不同預測範圍
    # ============================================
    for model_type, model_name in [('rf', 'Random Forest'), ('xgb', 'XGBoost')]:
        print(f"\n{'=' * 80}")
        print(f"📊 {model_name} 長期預測測試")
        print("=" * 80)

        X_train = train_data[feature_cols].fillna(0)
        y_train = train_data['Attendance'].values
        X_test = test_data[feature_cols].fillna(0)
        y_test = test_data['Attendance'].values

        if model_type == 'rf':
            model = RandomForestRegressor(
                n_estimators=200,
                max_depth=12,
                min_samples_split=10,
                random_state=42,
                n_jobs=-1
            )
        else:
            model = xgb.XGBRegressor(
                n_estimators=500,
                max_depth=8,
                learning_rate=0.05,
                random_state=42
            )

        model.fit(X_train, y_train)

        # 直接預測（不考慮遞歸）
        predictions = model.predict(X_test)

        # 分段分析
        model_results = {}

        # Day 1-7
        if len(predictions) >= 7:
            metrics_1_7 = calculate_metrics(y_test[:7], predictions[:7])
            model_results['day_1_7'] = metrics_1_7
            print(f"\n   📅 Day 1-7:")
            print(f"      MAE:  {metrics_1_7['mae']:.2f}")
            print(f"      MAPE: {metrics_1_7['mape']:.2f}%")

        # Day 8-14
        if len(predictions) >= 14:
            metrics_8_14 = calculate_metrics(y_test[7:14], predictions[7:14])
            model_results['day_8_14'] = metrics_8_14
            print(f"\n   📅 Day 8-14:")
            print(f"      MAE:  {metrics_8_14['mae']:.2f}")
            print(f"      MAPE: {metrics_8_14['mape']:.2f}%")

        # Day 15-21
        if len(predictions) >= 21:
            metrics_15_21 = calculate_metrics(y_test[14:21], predictions[14:21])
            model_results['day_15_21'] = metrics_15_21
            print(f"\n   📅 Day 15-21:")
            print(f"      MAE:  {metrics_15_21['mae']:.2f}")
            print(f"      MAPE: {metrics_15_21['mape']:.2f}%")

        # Day 22-30
        if len(predictions) >= 30:
            metrics_22_30 = calculate_metrics(y_test[21:30], predictions[21:30])
            model_results['day_22_30'] = metrics_22_30
            print(f"\n   📅 Day 22-30:")
            print(f"      MAE:  {metrics_22_30['mae']:.2f}")
            print(f"      MAPE: {metrics_22_30['mape']:.2f}%")

        # Day 31-60
        if len(predictions) >= 60:
            metrics_31_60 = calculate_metrics(y_test[30:60], predictions[30:60])
            model_results['day_31_60'] = metrics_31_60
            print(f"\n   📅 Day 31-60:")
            print(f"      MAE:  {metrics_31_60['mae']:.2f}")
            print(f"      MAPE: {metrics_31_60['mape']:.2f}%")

        # Overall
        metrics_overall = calculate_metrics(y_test, predictions)
        model_results['overall'] = metrics_overall
        print(f"\n   📅 Overall ({len(predictions)} days):")
        print(f"      MAE:  {metrics_overall['mae']:.2f}")
        print(f"      MAPE: {metrics_overall['mape']:.2f}%")
        print(f"      R²:   {metrics_overall['r2']:.4f}")

        results[model_type] = model_results

    # ============================================
    # 比較總結
    # ============================================
    print("\n" + "=" * 80)
    print("🏆 長期預測能力比較")
    print("=" * 80)

    print(f"\n{'預測範圍':<15} {'RF MAE':<12} {'XGB MAE':<12} {'RF MAPE':<12} {'XGB MAPE':<12} {'勝者':<10}")
    print("-" * 80)

    periods = ['day_1_7', 'day_8_14', 'day_15_21', 'day_22_30', 'day_31_60', 'overall']
    period_names = ['Day 1-7', 'Day 8-14', 'Day 15-21', 'Day 22-30', 'Day 31-60', 'Overall']

    for period, name in zip(periods, period_names):
        if period in results['rf'] and period in results['xgb']:
            rf_mae = results['rf'][period]['mae']
            xgb_mae = results['xgb'][period]['mae']
            rf_mape = results['rf'][period]['mape']
            xgb_mape = results['xgb'][period]['mape']

            winner = "RF ✅" if rf_mae < xgb_mae else "XGB ✅" if xgb_mae < rf_mae else "Tie"

            print(f"{name:<15} {rf_mae:<12.2f} {xgb_mae:<12.2f} {rf_mape:<12.2f}% {xgb_mape:<12.2f}% {winner:<10}")

    # 計算衰減率
    print("\n" + "=" * 80)
    print("📉 預測準確度衰減分析")
    print("=" * 80)

    for model_type, model_name in [('rf', 'Random Forest'), ('xgb', 'XGBoost')]:
        if 'day_1_7' in results[model_type] and 'day_22_30' in results[model_type]:
            mae_1_7 = results[model_type]['day_1_7']['mae']
            mae_22_30 = results[model_type]['day_22_30']['mae']
            decay_rate = ((mae_22_30 - mae_1_7) / mae_1_7) * 100

            print(f"\n   {model_name}:")
            print(f"      Day 1-7 MAE:  {mae_1_7:.2f}")
            print(f"      Day 22-30 MAE: {mae_22_30:.2f}")
            print(f"      衰減率: {decay_rate:+.1f}%")

    # 保存結果
    output = {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'test_days': test_days,
        'results': results,
        'conclusion': {
            'rf_better_short_term': results['rf']['day_1_7']['mae'] < results['xgb']['day_1_7']['mae'],
            'rf_better_long_term': results['rf']['day_22_30']['mae'] < results['xgb']['day_22_30']['mae'] if 'day_22_30' in results['rf'] else None,
            'rf_overall_mae': results['rf']['overall']['mae'],
            'xgb_overall_mae': results['xgb']['overall']['mae']
        }
    }

    os.makedirs('models', exist_ok=True)
    with open('models/long_term_prediction_results.json', 'w') as f:
        json.dump(output, f, indent=2)

    print(f"\n✅ 結果已保存到 models/long_term_prediction_results.json")

    # 結論
    print("\n" + "=" * 80)
    print("🎯 結論")
    print("=" * 80)

    rf_overall = results['rf']['overall']['mae']
    xgb_overall = results['xgb']['overall']['mae']

    if rf_overall < xgb_overall:
        improvement = ((xgb_overall - rf_overall) / xgb_overall) * 100
        print(f"\n   ✅ Random Forest 在長期預測表現更好")
        print(f"   Overall MAE 改善: {improvement:.1f}%")
    else:
        print(f"\n   ✅ XGBoost 在長期預測表現更好")

if __name__ == '__main__':
    main()
