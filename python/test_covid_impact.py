"""
測試 COVID 數據影響: 包含 vs 排除
Test COVID data impact on RF vs XGBoost
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
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_engineering import create_comprehensive_features

def load_full_data():
    """加載完整 11 年數據"""
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

def train_and_evaluate(train_data, test_data, feature_cols, model_type='rf'):
    """訓練並評估模型"""
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
    predictions = model.predict(X_test)

    return calculate_metrics(y_test, predictions), predictions

def main():
    print("=" * 80)
    print("🦠 COVID 數據影響測試: 包含 vs 排除")
    print("=" * 80)
    print(f"⏰ 開始時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # 加載完整數據
    print("📥 加載完整 11 年數據...")
    df_full = load_full_data()
    if df_full is None:
        print("❌ 無法加載數據")
        return

    df_full['Date'] = pd.to_datetime(df_full['Date'])
    print(f"   總數據量: {len(df_full)} 筆")
    print(f"   日期範圍: {df_full['Date'].min()} → {df_full['Date'].max()}")

    # COVID 期間定義
    covid_start = pd.Timestamp('2020-02-01')
    covid_end = pd.Timestamp('2022-06-30')

    # 統計 COVID 期間數據
    covid_mask = (df_full['Date'] >= covid_start) & (df_full['Date'] <= covid_end)
    covid_data = df_full[covid_mask]
    non_covid_data = df_full[~covid_mask]

    print(f"\n📊 數據分佈:")
    print(f"   COVID 期間 ({covid_start.date()} → {covid_end.date()}): {len(covid_data)} 筆")
    print(f"   非 COVID 期間: {len(non_covid_data)} 筆")

    if len(covid_data) > 0:
        print(f"\n📊 COVID 期間 vs 非 COVID 期間統計:")
        print(f"   COVID 期間平均就診: {covid_data['Attendance'].mean():.1f}")
        print(f"   非 COVID 期間平均就診: {non_covid_data['Attendance'].mean():.1f}")
        print(f"   差異: {covid_data['Attendance'].mean() - non_covid_data['Attendance'].mean():.1f}")

    # 特徵列表
    feature_cols = [
        "Attendance_Lag1", "Attendance_Lag7", "Attendance_Same_Weekday_Avg",
        "Day_of_Week", "DayOfWeek_Target_Mean", "Attendance_Rolling7",
        "Attendance_EWMA7", "Attendance_Lag14", "Attendance_Lag30",
        "Daily_Change", "Weekly_Change", "Is_Weekend",
        "Holiday_Factor", "Attendance_Std7", "Month"
    ]

    results = {}

    # ============================================
    # 場景 1: 排除 COVID 數據
    # ============================================
    print("\n" + "=" * 80)
    print("📊 場景 1: 排除 COVID 數據")
    print("=" * 80)

    df_no_covid = df_full[~covid_mask].copy()
    df_no_covid = create_comprehensive_features(df_no_covid)
    df_no_covid = df_no_covid.dropna(subset=['Attendance'])

    feature_cols_available = [c for c in feature_cols if c in df_no_covid.columns]

    # 80/20 分割
    split_idx = int(len(df_no_covid) * 0.8)
    train_no_covid = df_no_covid[:split_idx]
    test_no_covid = df_no_covid[split_idx:]

    print(f"   訓練集: {len(train_no_covid)} 筆")
    print(f"   測試集: {len(test_no_covid)} 筆")

    for model_type, model_name in [('rf', 'Random Forest'), ('xgb', 'XGBoost')]:
        metrics, _ = train_and_evaluate(train_no_covid, test_no_covid, feature_cols_available, model_type)
        results[f'{model_type}_no_covid'] = metrics
        print(f"\n   {model_name}:")
        print(f"      MAE:  {metrics['mae']:.2f}")
        print(f"      MAPE: {metrics['mape']:.2f}%")
        print(f"      R²:   {metrics['r2']:.4f}")

    # ============================================
    # 場景 2: 包含 COVID 數據
    # ============================================
    print("\n" + "=" * 80)
    print("📊 場景 2: 包含 COVID 數據")
    print("=" * 80)

    df_with_covid = df_full.copy()
    df_with_covid = create_comprehensive_features(df_with_covid)
    df_with_covid = df_with_covid.dropna(subset=['Attendance'])

    feature_cols_available = [c for c in feature_cols if c in df_with_covid.columns]

    # 80/20 分割
    split_idx = int(len(df_with_covid) * 0.8)
    train_with_covid = df_with_covid[:split_idx]
    test_with_covid = df_with_covid[split_idx:]

    print(f"   訓練集: {len(train_with_covid)} 筆")
    print(f"   測試集: {len(test_with_covid)} 筆")

    for model_type, model_name in [('rf', 'Random Forest'), ('xgb', 'XGBoost')]:
        metrics, _ = train_and_evaluate(train_with_covid, test_with_covid, feature_cols_available, model_type)
        results[f'{model_type}_with_covid'] = metrics
        print(f"\n   {model_name}:")
        print(f"      MAE:  {metrics['mae']:.2f}")
        print(f"      MAPE: {metrics['mape']:.2f}%")
        print(f"      R²:   {metrics['r2']:.4f}")

    # ============================================
    # 場景 3: 包含 COVID 但加入 COVID 標記特徵
    # ============================================
    print("\n" + "=" * 80)
    print("📊 場景 3: 包含 COVID + COVID 標記特徵")
    print("=" * 80)

    df_covid_flag = df_full.copy()
    df_covid_flag['Is_COVID_Period'] = ((df_covid_flag['Date'] >= covid_start) &
                                         (df_covid_flag['Date'] <= covid_end)).astype(int)

    # COVID 階段細分
    df_covid_flag['COVID_Phase'] = 0
    df_covid_flag.loc[(df_covid_flag['Date'] >= '2020-02-01') &
                      (df_covid_flag['Date'] < '2020-07-01'), 'COVID_Phase'] = 1  # 第一波
    df_covid_flag.loc[(df_covid_flag['Date'] >= '2020-07-01') &
                      (df_covid_flag['Date'] < '2020-12-01'), 'COVID_Phase'] = 2  # 第二波
    df_covid_flag.loc[(df_covid_flag['Date'] >= '2020-12-01') &
                      (df_covid_flag['Date'] < '2021-06-01'), 'COVID_Phase'] = 3  # 第三波
    df_covid_flag.loc[(df_covid_flag['Date'] >= '2021-06-01') &
                      (df_covid_flag['Date'] < '2022-01-01'), 'COVID_Phase'] = 4  # 第四波
    df_covid_flag.loc[(df_covid_flag['Date'] >= '2022-01-01') &
                      (df_covid_flag['Date'] < '2022-07-01'), 'COVID_Phase'] = 5  # 第五波

    df_covid_flag = create_comprehensive_features(df_covid_flag)
    df_covid_flag = df_covid_flag.dropna(subset=['Attendance'])

    feature_cols_covid = feature_cols + ['Is_COVID_Period', 'COVID_Phase']
    feature_cols_covid = [c for c in feature_cols_covid if c in df_covid_flag.columns]

    split_idx = int(len(df_covid_flag) * 0.8)
    train_covid_flag = df_covid_flag[:split_idx]
    test_covid_flag = df_covid_flag[split_idx:]

    print(f"   訓練集: {len(train_covid_flag)} 筆")
    print(f"   測試集: {len(test_covid_flag)} 筆")
    print(f"   額外特徵: Is_COVID_Period, COVID_Phase")

    for model_type, model_name in [('rf', 'Random Forest'), ('xgb', 'XGBoost')]:
        metrics, _ = train_and_evaluate(train_covid_flag, test_covid_flag, feature_cols_covid, model_type)
        results[f'{model_type}_covid_flag'] = metrics
        print(f"\n   {model_name}:")
        print(f"      MAE:  {metrics['mae']:.2f}")
        print(f"      MAPE: {metrics['mape']:.2f}%")
        print(f"      R²:   {metrics['r2']:.4f}")

    # ============================================
    # 總結比較
    # ============================================
    print("\n" + "=" * 80)
    print("🏆 COVID 數據影響總結")
    print("=" * 80)

    print(f"\n{'場景':<35} {'RF MAE':<10} {'XGB MAE':<10} {'RF 勝?':<10}")
    print("-" * 70)

    scenarios = [
        ('no_covid', '排除 COVID'),
        ('with_covid', '包含 COVID'),
        ('covid_flag', '包含 COVID + 標記')
    ]

    for scenario_key, scenario_name in scenarios:
        rf_mae = results[f'rf_{scenario_key}']['mae']
        xgb_mae = results[f'xgb_{scenario_key}']['mae']
        rf_wins = "✅" if rf_mae < xgb_mae else "❌"
        print(f"{scenario_name:<35} {rf_mae:<10.2f} {xgb_mae:<10.2f} {rf_wins:<10}")

    # 分析 COVID 影響
    print("\n" + "=" * 80)
    print("📊 COVID 對模型的影響分析")
    print("=" * 80)

    for model_type, model_name in [('rf', 'Random Forest'), ('xgb', 'XGBoost')]:
        no_covid_mae = results[f'{model_type}_no_covid']['mae']
        with_covid_mae = results[f'{model_type}_with_covid']['mae']
        covid_flag_mae = results[f'{model_type}_covid_flag']['mae']

        impact = ((with_covid_mae - no_covid_mae) / no_covid_mae) * 100
        flag_improvement = ((with_covid_mae - covid_flag_mae) / with_covid_mae) * 100

        print(f"\n   {model_name}:")
        print(f"      排除 COVID MAE:     {no_covid_mae:.2f}")
        print(f"      包含 COVID MAE:     {with_covid_mae:.2f}")
        print(f"      COVID 標記 MAE:     {covid_flag_mae:.2f}")
        print(f"      COVID 影響:         {impact:+.1f}%")
        print(f"      標記改善:           {flag_improvement:+.1f}%")

    # 保存結果
    output = {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'covid_period': f"{covid_start.date()} to {covid_end.date()}",
        'results': results,
        'recommendation': None
    }

    # 決定最佳策略
    best_rf = min([results['rf_no_covid']['mae'], results['rf_with_covid']['mae'], results['rf_covid_flag']['mae']])
    best_xgb = min([results['xgb_no_covid']['mae'], results['xgb_with_covid']['mae'], results['xgb_covid_flag']['mae']])

    if results['rf_no_covid']['mae'] == best_rf:
        output['recommendation'] = 'RF with COVID excluded'
    elif results['rf_covid_flag']['mae'] == best_rf:
        output['recommendation'] = 'RF with COVID flag features'
    else:
        output['recommendation'] = 'RF with COVID included'

    os.makedirs('models', exist_ok=True)
    with open('models/covid_impact_results.json', 'w') as f:
        json.dump(output, f, indent=2)

    print(f"\n✅ 結果已保存到 models/covid_impact_results.json")

    # 最終建議
    print("\n" + "=" * 80)
    print("🎯 最終建議")
    print("=" * 80)

    rf_no_covid = results['rf_no_covid']['mae']
    rf_with_covid = results['rf_with_covid']['mae']
    rf_covid_flag = results['rf_covid_flag']['mae']

    best_scenario = min([
        ('排除 COVID', rf_no_covid),
        ('包含 COVID', rf_with_covid),
        ('COVID 標記', rf_covid_flag)
    ], key=lambda x: x[1])

    print(f"\n   最佳策略: Random Forest + {best_scenario[0]}")
    print(f"   MAE: {best_scenario[1]:.2f}")

if __name__ == '__main__':
    main()
