"""
模型比較實驗 - 測試不同改進方案的準確度
Compare 5 improvement approaches vs current model
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
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import json
import os
import sys
from datetime import datetime

# 添加當前目錄到路徑
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_engineering import create_comprehensive_features, get_hk_public_holidays, get_holiday_info

def load_data():
    """加載數據"""
    # 嘗試從數據庫或 CSV 加載
    csv_paths = [
        '../ndh_attendance_extracted.csv',
        'ndh_attendance_extracted.csv',
        '../NDH_AED_Clean.csv',
        'NDH_AED_Clean.csv',
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

def add_enhanced_holiday_features(df):
    """方案1: 強化假期特徵"""
    df = df.copy()
    df['Date'] = pd.to_datetime(df['Date'])

    # 聖誕新年期間 (12/24 - 01/02)
    def is_christmas_newyear_period(date):
        if date.month == 12 and date.day >= 24:
            return True
        if date.month == 1 and date.day <= 2:
            return True
        return False

    def is_consecutive_holiday_period(date):
        # 檢查是否在連續假期中
        year = date.year
        holidays = get_hk_public_holidays(year)

        # 檢查前後3天是否有假期
        for day_offset in range(-3, 4):
            check_date = date + pd.Timedelta(days=day_offset)
            if (check_date.month, check_date.day) in holidays:
                return True
        return False

    df['Christmas_NewYear_Period'] = df['Date'].apply(is_christmas_newyear_period).astype(int)

    # 連續假期計數
    df['Is_Between_Holidays'] = df['Date'].apply(is_consecutive_holiday_period).astype(int)

    # 計算假期累積天數
    df['Days_Into_Holiday_Block'] = 0
    in_block = False
    block_count = 0
    for i, row in df.iterrows():
        if row.get('Is_Holiday', 0) == 1 or row['Christmas_NewYear_Period'] == 1:
            if not in_block:
                in_block = True
                block_count = 1
            else:
                block_count += 1
        else:
            in_block = False
            block_count = 0
        df.at[i, 'Days_Into_Holiday_Block'] = block_count

    return df

def post_process_holiday_adjustment(predictions, dates, actuals=None):
    """方案2: 假期後處理調整"""
    adjusted = []
    for pred, date in zip(predictions, dates):
        date = pd.to_datetime(date)

        # 聖誮新年期間 - 降低 25%
        if (date.month == 12 and date.day >= 24) or (date.month == 1 and date.day <= 2):
            adjusted.append(pred * 0.75)
        # 農曆新年期間 - 降低 30%
        elif date.month == 1 and date.day <= 15:
            # 簡化處理（實際應查完整農曆）
            adjusted.append(pred * 0.70)
        # 其他公眾假期 - 降低 15%
        elif is_holiday_date(date):
            adjusted.append(pred * 0.85)
        else:
            adjusted.append(pred)

    return np.array(adjusted)

def is_holiday_date(date):
    """檢查是否假期"""
    is_holiday, _, _ = get_holiday_info(date)
    return is_holiday

def train_segmented_models(train_data, test_data, feature_cols):
    """方案3: 分段模型 (普通日 vs 週末 vs 假期)"""
    # 訓練三個模型
    results = {}

    for segment_name, condition in [
        ('weekday', lambda x: (x['Is_Weekend'] == 0) & (x['Is_Holiday'] == 0)),
        ('weekend', lambda x: x['Is_Weekend'] == 1),
        ('holiday', lambda x: x['Is_Holiday'] == 1)
    ]:
        # 訓練數據
        train_seg = train_data[condition(train_data)]
        if len(train_seg) < 50:  # 數據太少
            continue

        X_train = train_seg[feature_cols]
        y_train = train_seg['Attendance']

        # 訓練模型
        model = xgb.XGBRegressor(
            n_estimators=200,
            max_depth=6,
            learning_rate=0.05,
            random_state=42
        )
        model.fit(X_train, y_train, verbose=False)
        results[segment_name] = model

    return results

def predict_with_segmented(models, test_data, feature_cols):
    """使用分段模型預測"""
    predictions = []

    for _, row in test_data.iterrows():
        X = row[feature_cols].values.reshape(1, -1)

        if row['Is_Holiday'] == 1 and 'holiday' in models:
            pred = models['holiday'].predict(X)[0]
        elif row['Is_Weekend'] == 1 and 'weekend' in models:
            pred = models['weekend'].predict(X)[0]
        elif 'weekday' in models:
            pred = models['weekday'].predict(X)[0]
        else:
            # 默認用第一個模型
            pred = list(models.values())[0].predict(X)[0]

        predictions.append(pred)

    return np.array(predictions)

def add_weather_features(df):
    """方案4: 加入天氣特徵 (模擬)"""
    df = df.copy()
    df['Date'] = pd.to_datetime(df['Date'])

    # 模擬天氣數據（實際應從 HKO 獲取）
    df['Temp_Deviation'] = 0  # 溫度偏離
    df['Is_Extreme_Weather'] = 0  # 極端天氣

    # 季節性模擬
    for idx, row in df.iterrows():
        month = row['Date'].month
        # 夏季高溫
        if month in [6, 7, 8]:
            df.at[idx, 'Temp_Deviation'] = np.random.normal(5, 2)
        # 冬季低溫
        elif month in [12, 1, 2]:
            df.at[idx, 'Temp_Deviation'] = np.random.normal(-3, 2)

    return df

def train_alternative_models(train_data, test_data, feature_cols):
    """方案5: 測試其他模型"""
    from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor

    results = {}

    X_train = train_data[feature_cols].fillna(0)
    y_train = train_data['Attendance']
    X_test = test_data[feature_cols].fillna(0)
    y_test = test_data['Attendance']

    # LightGBM (optional)
    try:
        from lightgbm import LGBMRegressor
        lgb = LGBMRegressor(
            n_estimators=300,
            max_depth=8,
            learning_rate=0.05,
            random_state=42,
            verbose=-1
        )
        lgb.fit(X_train, y_train)
        results['lightgbm'] = {
            'model': lgb,
            'predictions': lgb.predict(X_test)
        }
    except ImportError:
        print("   (LightGBM not installed, skipping)")
    except Exception as e:
        print(f"   LightGBM error: {e}")

    # Random Forest
    rf = RandomForestRegressor(
        n_estimators=200,
        max_depth=12,
        min_samples_split=10,
        random_state=42,
        n_jobs=-1
    )
    rf.fit(X_train, y_train)
    results['randomforest'] = {
        'model': rf,
        'predictions': rf.predict(X_test)
    }

    # Gradient Boosting
    gb = GradientBoostingRegressor(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.05,
        random_state=42
    )
    gb.fit(X_train, y_train)
    results['gradientboost'] = {
        'model': gb,
        'predictions': gb.predict(X_test)
    }

    return results

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
    print("🔬 模型比較實驗 - 測試 5 種改進方案 vs 當前模型")
    print("=" * 70)
    print(f"⏰ 開始時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # 加載數據
    print("\n📥 加載數據...")
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
    print("\n🔧 創建特徵...")
    df = create_comprehensive_features(df)
    df = df.dropna(subset=['Attendance'])

    # 時間序列分割
    split_idx = int(len(df) * 0.8)
    train_data = df[:split_idx].copy()
    test_data = df[split_idx:].copy()

    print(f"   訓練集: {len(train_data)} 筆")
    print(f"   測試集: {len(test_data)} 筆")
    print(f"   測試日期: {test_data['Date'].min()} → {test_data['Date'].max()}")

    # 基礎特徵
    feature_cols = [
        "Attendance_Lag1", "Attendance_Lag7", "Attendance_Same_Weekday_Avg",
        "Day_of_Week", "DayOfWeek_Target_Mean", "Attendance_Rolling7",
        "Attendance_EWMA7", "Attendance_Lag14", "Attendance_Lag30",
        "Daily_Change", "Weekly_Change", "Is_Weekend",
        "Holiday_Factor", "Attendance_Std7", "Month"
    ]
    feature_cols = [c for c in feature_cols if c in df.columns]

    X_test = test_data[feature_cols].fillna(0)
    y_test = test_data['Attendance'].values
    test_dates = test_data['Date'].values

    all_results = {}

    # ============================================
    # 基準: 當前 XGBoost 模型
    # ============================================
    print("\n" + "=" * 70)
    print("📊 基準: 當前 XGBoost 模型")
    print("=" * 70)

    X_train = train_data[feature_cols].fillna(0)
    y_train = train_data['Attendance'].values

    baseline_model = xgb.XGBRegressor(
        n_estimators=500,
        max_depth=8,
        learning_rate=0.05,
        random_state=42
    )
    baseline_model.fit(X_train, y_train, verbose=False)
    baseline_pred = baseline_model.predict(X_test)

    baseline_metrics = calculate_metrics(y_test, baseline_pred)
    all_results['baseline_xgboost'] = {
        'predictions': baseline_pred,
        'metrics': baseline_metrics
    }

    print(f"   MAE:  {baseline_metrics['mae']:.2f}")
    print(f"   RMSE: {baseline_metrics['rmse']:.2f}")
    print(f"   MAPE: {baseline_metrics['mape']:.2f}%")
    print(f"   R²:   {baseline_metrics['r2']:.4f}")

    # ============================================
    # 方案 1: 強化假期特徵
    # ============================================
    print("\n" + "=" * 70)
    print("📊 方案 1: 強化假期特徵")
    print("=" * 70)

    df_enhanced = add_enhanced_holiday_features(df.copy())
    train_enhanced = df_enhanced[:split_idx].copy()
    test_enhanced = df_enhanced[split_idx:].copy()

    # 添加新特徵
    enhanced_features = feature_cols + [
        'Christmas_NewYear_Period', 'Is_Between_Holidays', 'Days_Into_Holiday_Block'
    ]
    enhanced_features = [c for c in enhanced_features if c in test_enhanced.columns]

    X_train_enh = train_enhanced[enhanced_features].fillna(0)
    y_train_enh = train_enhanced['Attendance'].values
    X_test_enh = test_enhanced[enhanced_features].fillna(0)

    model_s1 = xgb.XGBRegressor(n_estimators=500, max_depth=8, learning_rate=0.05, random_state=42)
    model_s1.fit(X_train_enh, y_train_enh, verbose=False)
    pred_s1 = model_s1.predict(X_test_enh)

    metrics_s1 = calculate_metrics(y_test, pred_s1)
    all_results['solution1_enhanced_holiday'] = {
        'predictions': pred_s1,
        'metrics': metrics_s1
    }

    print(f"   MAE:  {metrics_s1['mae']:.2f} ({metrics_s1['mae'] - baseline_metrics['mae']:+.2f})")
    print(f"   RMSE: {metrics_s1['rmse']:.2f}")
    print(f"   MAPE: {metrics_s1['mape']:.2f}%")
    print(f"   R²:   {metrics_s1['r2']:.4f}")

    # ============================================
    # 方案 2: 假期後處理調整
    # ============================================
    print("\n" + "=" * 70)
    print("📊 方案 2: 假期後處理調整")
    print("=" * 70)

    pred_s2 = post_process_holiday_adjustment(baseline_pred, test_dates, y_test)

    metrics_s2 = calculate_metrics(y_test, pred_s2)
    all_results['solution2_postprocess'] = {
        'predictions': pred_s2,
        'metrics': metrics_s2
    }

    print(f"   MAE:  {metrics_s2['mae']:.2f} ({metrics_s2['mae'] - baseline_metrics['mae']:+.2f})")
    print(f"   RMSE: {metrics_s2['rmse']:.2f}")
    print(f"   MAPE: {metrics_s2['mape']:.2f}%")
    print(f"   R²:   {metrics_s2['r2']:.4f}")

    # ============================================
    # 方案 3: 分段模型
    # ============================================
    print("\n" + "=" * 70)
    print("📊 方案 3: 分段模型 (Regime Switching)")
    print("=" * 70)

    segmented_models = train_segmented_models(train_data, test_data, feature_cols)
    pred_s3 = predict_with_segmented(segmented_models, test_data, feature_cols)

    metrics_s3 = calculate_metrics(y_test, pred_s3)
    all_results['solution3_segmented'] = {
        'predictions': pred_s3,
        'metrics': metrics_s3
    }

    print(f"   MAE:  {metrics_s3['mae']:.2f} ({metrics_s3['mae'] - baseline_metrics['mae']:+.2f})")
    print(f"   RMSE: {metrics_s3['rmse']:.2f}")
    print(f"   MAPE: {metrics_s3['mape']:.2f}%")
    print(f"   R²:   {metrics_s3['r2']:.4f}")

    # ============================================
    # 方案 4: 加入天氣特徵
    # ============================================
    print("\n" + "=" * 70)
    print("📊 方案 4: 加入天氣特徵")
    print("=" * 70)

    df_weather = add_weather_features(df.copy())
    train_weather = df_weather[:split_idx].copy()
    test_weather = df_weather[split_idx:].copy()

    weather_features = feature_cols + ['Temp_Deviation', 'Is_Extreme_Weather']
    weather_features = [c for c in weather_features if c in test_weather.columns]

    X_train_w = train_weather[weather_features].fillna(0)
    y_train_w = train_weather['Attendance'].values
    X_test_w = test_weather[weather_features].fillna(0)

    model_s4 = xgb.XGBRegressor(n_estimators=500, max_depth=8, learning_rate=0.05, random_state=42)
    model_s4.fit(X_train_w, y_train_w, verbose=False)
    pred_s4 = model_s4.predict(X_test_w)

    metrics_s4 = calculate_metrics(y_test, pred_s4)
    all_results['solution4_weather'] = {
        'predictions': pred_s4,
        'metrics': metrics_s4
    }

    print(f"   MAE:  {metrics_s4['mae']:.2f} ({metrics_s4['mae'] - baseline_metrics['mae']:+.2f})")
    print(f"   RMSE: {metrics_s4['rmse']:.2f}")
    print(f"   MAPE: {metrics_s4['mape']:.2f}%")
    print(f"   R²:   {metrics_s4['r2']:.4f}")

    # ============================================
    # 方案 5: 替代模型
    # ============================================
    print("\n" + "=" * 70)
    print("📊 方案 5: 替代模型 (LightGBM, RF, GB)")
    print("=" * 70)

    alt_models = train_alternative_models(train_data, test_data, feature_cols)

    for model_name, result in alt_models.items():
        metrics_alt = calculate_metrics(y_test, result['predictions'])
        all_results[f'solution5_{model_name}'] = {
            'predictions': result['predictions'],
            'metrics': metrics_alt
        }

        improvement = metrics_alt['mae'] - baseline_metrics['mae']
        print(f"   {model_name.upper():15} MAE: {metrics_alt['mae']:.2f} ({improvement:+.2f}), MAPE: {metrics_alt['mape']:.2f}%")

    # ============================================
    # 總結排行榜
    # ============================================
    print("\n" + "=" * 70)
    print("🏆 最終排行榜 (按 MAE 排序)")
    print("=" * 70)

    rankings = []
    for name, result in all_results.items():
        rankings.append({
            'name': name,
            'mae': result['metrics']['mae'],
            'mape': result['metrics']['mape'],
            'r2': result['metrics']['r2'],
            'improvement': result['metrics']['mae'] - baseline_metrics['mae']
        })

    rankings.sort(key=lambda x: x['mae'])

    print(f"\n{'排名':<4} {'方案':<30} {'MAE':<8} {'MAPE':<8} {'R²':<8} {'改善':<8}")
    print("-" * 70)

    for i, r in enumerate(rankings):
        status = "🥇" if i == 0 else "🥈" if i == 1 else "🥉" if i == 2 else f" {i+1}"
        improvement_str = f"{r['improvement']:+.2f}"
        if r['improvement'] < 0:
            improvement_str = f"✅ {improvement_str}"
        else:
            improvement_str = f"❌ {improvement_str}"

        print(f"{status:<4} {r['name']:<30} {r['mae']:<8.2f} {r['mape']:<8.2f}% {r['r2']:<8.4f} {improvement_str:<8}")

    # 保存結果
    output = {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'baseline': {
            'name': 'XGBoost (Current)',
            'mae': baseline_metrics['mae'],
            'rmse': baseline_metrics['rmse'],
            'mape': baseline_metrics['mape'],
            'r2': baseline_metrics['r2']
        },
        'solutions': {}
    }

    for r in rankings:
        if r['name'] != 'baseline_xgboost':
            output['solutions'][r['name']] = {
                'mae': r['mae'],
                'rmse': all_results[r['name']]['metrics']['rmse'],
                'mape': r['mape'],
                'r2': r['r2'],
                'improvement_over_baseline': r['improvement']
            }

    os.makedirs('models', exist_ok=True)
    with open('models/model_comparison_results.json', 'w') as f:
        json.dump(output, f, indent=2)

    print(f"\n✅ 結果已保存到 models/model_comparison_results.json")

    # 找出最佳方案
    best = rankings[0]
    print(f"\n🏆 最佳方案: {best['name']}")
    print(f"   MAE: {best['mae']:.2f} (改善 {best['improvement']:+.2f})")
    print(f"   MAPE: {best['mape']:.2f}%")
    print(f"   R²: {best['r2']:.4f}")

if __name__ == '__main__':
    main()
