"""
全面的模型比較測試腳本
從 Railway Database 獲取所有歷史數據（NDH AED 開業至今）

測試場景:
1. Ensemble vs 單一 XGBoost
2. AI 因子影響分析
3. 天氣因素影響分析
4. 全數據 vs 部分數據效果比較
5. 統計顯著性測試 (t-test, Wilcoxon, Diebold-Mariano)
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
import xgboost as xgb
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from scipy import stats
import json
import os
from datetime import datetime
import psycopg2
from psycopg2.extras import RealDictCursor
import warnings
warnings.filterwarnings('ignore')

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_engineering import create_comprehensive_features, load_weather_history, add_weather_features
from ensemble_predict import load_ai_factors_from_db

# ============ 數據庫連接 ============
def get_db_connection():
    """連接到 Railway Production Database"""
    password = os.environ.get('PGPASSWORD') or os.environ.get('DATABASE_PASSWORD') or 'nIdJPREHqkBdMgUifrazOsVlWbxsmDGq'
    return psycopg2.connect(
        host=os.environ.get('PGHOST', 'tramway.proxy.rlwy.net'),
        port=int(os.environ.get('PGPORT', '45703')),
        user=os.environ.get('PGUSER', 'postgres'),
        password=password,
        database=os.environ.get('PGDATABASE', 'railway'),
        sslmode='require'
    )

def load_all_historical_data():
    """從數據庫加載完整歷史數據"""
    print("=" * 80)
    print("📥 從 Railway Database 加載所有歷史數據")
    print("=" * 80)

    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # 獲取實際就診數據
        cur.execute("""
            SELECT date as "Date", patient_count as "Attendance"
            FROM actual_data
            ORDER BY date ASC
        """)

        rows = cur.fetchall()
        df = pd.DataFrame(rows)

        cur.close()
        conn.close()

        df['Date'] = pd.to_datetime(df['Date'])
        print(f"   ✅ 成功加載 {len(df)} 筆數據")
        print(f"   📅 日期範圍: {df['Date'].min()} → {df['Date'].max()}")
        print(f"   📊 平均就診: {df['Attendance'].mean():.1f} 人/天")

        return df

    except Exception as e:
        print(f"   ❌ 數據庫連接失敗: {e}")
        return None

def load_ai_factors():
    """加載 AI 因子"""
    print("\n📥 加載 AI Factors...")

    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            SELECT factors_cache
            FROM ai_factors_cache
            WHERE id = 1
        """)

        row = cur.fetchone()
        cur.close()
        conn.close()

        if row and row['factors_cache']:
            if isinstance(row['factors_cache'], str):
                factors_cache = json.loads(row['factors_cache'])
            else:
                factors_cache = row['factors_cache']

            print(f"   ✅ AI Factors 數據: {len(factors_cache)} 個日期")
            return factors_cache
        else:
            print("   ℹ️ 沒有 AI Factors 數據")
            return {}

    except Exception as e:
        print(f"   ⚠️ 無法加載 AI Factors: {e}")
        return {}

# ============ 評估指標 ============
def calculate_metrics(y_true, y_pred):
    """計算所有評估指標"""
    mae = mean_absolute_error(y_true, y_pred)
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))
    mape = np.mean(np.abs((y_true - y_pred) / np.maximum(y_true, 1))) * 100
    r2 = r2_score(y_true, y_pred)

    # 計算誤差分佈
    errors = y_pred - y_true
    mean_error = np.mean(errors)
    std_error = np.std(errors)
    median_ae = np.median(np.abs(errors))

    # 計算 Theil's U 系數 (相對於簡單預測)
    naive_forecast = np.roll(y_true, 1)
    naive_forecast[0] = y_true[0]
    naive_mse = np.mean((y_true[1:] - naive_forecast[1:]) ** 2)
    model_mse = np.mean((y_true - y_pred) ** 2)
    theils_u = np.sqrt(model_mse) / np.sqrt(naive_mse) if naive_mse > 0 else 1

    return {
        'mae': mae,
        'rmse': rmse,
        'mape': mape,
        'r2': r2,
        'mean_error': mean_error,
        'std_error': std_error,
        'median_ae': median_ae,
        'theils_u': theils_u
    }

# ============ 統計顯著性測試 ============
def statistical_significance_tests(y_true, pred1, pred2, model1_name="Model 1", model2_name="Model 2"):
    """
    統計顯著性測試套件

    測試方法:
    1. Paired t-test: 比較兩模型絕對誤差差異
    2. Wilcoxon signed-rank test: 非參數版本
    3. Diebold-Mariano test: 預測準確度比較
    """
    errors1 = np.abs(pred1 - y_true)
    errors2 = np.abs(pred2 - y_true)
    diff = errors1 - errors2

    results = {}

    # 1. Paired t-test
    t_stat, t_pvalue = stats.ttest_rel(errors1, errors2)
    results['t_test'] = {
        'statistic': float(t_stat),
        'p_value': float(t_pvalue),
        'significant': t_pvalue < 0.05,
        'interpretation': '顯著' if t_pvalue < 0.05 else '不顯著'
    }

    # 2. Wilcoxon signed-rank test
    try:
        w_stat, w_pvalue = stats.wilcoxon(diff)
        results['wilcoxon'] = {
            'statistic': float(w_stat),
            'p_value': float(w_pvalue),
            'significant': w_pvalue < 0.05,
            'interpretation': '顯著' if w_pvalue < 0.05 else '不顯著'
        }
    except:
        results['wilcoxon'] = {'p_value': 1.0, 'significant': False, 'interpretation': '無法計算'}

    # 3. Diebold-Mariano test (簡化版)
    loss_diff = (pred1 - y_true)**2 - (pred2 - y_true)**2
    mean_loss_diff = np.mean(loss_diff)
    var_loss_diff = np.var(loss_diff, ddof=1)

    if var_loss_diff > 0:
        dm_stat = mean_loss_diff / np.sqrt(var_loss_diff / len(loss_diff))
        dm_pvalue = 2 * (1 - stats.norm.cdf(abs(dm_stat)))
        results['diebold_mariano'] = {
            'statistic': float(dm_stat),
            'p_value': float(dm_pvalue),
            'significant': dm_pvalue < 0.05,
            'interpretation': '顯著' if dm_pvalue < 0.05 else '不顯著'
        }
    else:
        results['diebold_mariano'] = {'p_value': 1.0, 'significant': False, 'interpretation': '無法計算'}

    # 4. 改善方向
    mae1 = np.mean(errors1)
    mae2 = np.mean(errors2)
    results['improvement'] = {
        'better_model': model1_name if mae1 < mae2 else model2_name,
        'mae1': float(mae1),
        'mae2': float(mae2),
        'relative_improvement_pct': float((mae1 - mae2) / mae1 * 100) if mae1 > 0 else 0
    }

    return results

# ============ 模型訓練 ============
def train_xgboost_model(X_train, y_train, X_test):
    """訓練 XGBoost 模型"""
    model = xgb.XGBRegressor(
        n_estimators=500,
        max_depth=8,
        learning_rate=0.05,
        min_child_weight=3,
        subsample=0.85,
        colsample_bytree=0.85,
        objective='reg:squarederror',
        alpha=0.5,
        reg_lambda=1.5,
        tree_method='hist',
        random_state=42,
        n_jobs=-1
    )
    model.fit(X_train, y_train, verbose=False)
    return model

def train_random_forest(X_train, y_train, X_test):
    """訓練 Random Forest 模型"""
    model = RandomForestRegressor(
        n_estimators=200,
        max_depth=12,
        min_samples_split=10,
        random_state=42,
        n_jobs=-1
    )
    model.fit(X_train, y_train)
    return model

def train_gradient_boosting(X_train, y_train, X_test):
    """訓練 Gradient Boosting 模型"""
    model = GradientBoostingRegressor(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.05,
        random_state=42
    )
    model.fit(X_train, y_train)
    return model

def train_ensemble(X_train, y_train, X_test, y_test):
    """訓練並預測 Ensemble 模型"""
    predictions = {}

    # XGBoost
    xgb_model = train_xgboost_model(X_train, y_train, X_test)
    predictions['xgboost'] = xgb_model.predict(X_test)

    # Random Forest
    rf_model = train_random_forest(X_train, y_train, X_test)
    predictions['randomforest'] = rf_model.predict(X_test)

    # Gradient Boosting
    gb_model = train_gradient_boosting(X_train, y_train, X_test)
    predictions['gradientboosting'] = gb_model.predict(X_test)

    # LightGBM (如果可用)
    try:
        from lightgbm import LGBMRegressor
        lgb = LGBMRegressor(n_estimators=300, max_depth=8, learning_rate=0.05,
                           random_state=42, verbose=-1, n_jobs=-1)
        lgb.fit(X_train, y_train)
        predictions['lightgbm'] = lgb.predict(X_test)
    except:
        pass

    # Simple Average Ensemble
    pred_values = list(predictions.values())
    predictions['ensemble_simple'] = np.mean(pred_values, axis=0)

    # 加權 Ensemble (根據驗證集性能)
    # 使用訓練集的最後 20% 作為驗證集
    val_size = len(X_train) // 5
    X_val = X_train[-val_size:]
    y_val = y_train[-val_size:]

    val_scores = {}
    for name, model in [('xgboost', xgb_model), ('rf', rf_model), ('gb', gb_model)]:
        if name == 'xgboost':
            val_pred = model.predict(X_val)
        elif name == 'rf':
            val_pred = model.predict(X_val)
        else:
            val_pred = model.predict(X_val)
        val_scores[name] = mean_absolute_error(y_val, val_pred)

    # 計算權重 (誤差越小權重越大)
    weights = {k: 1/v for k, v in val_scores.items()}
    total_weight = sum(weights.values())
    weights = {k: v/total_weight for k, v in weights.items()}

    ensemble_weighted = (
        weights['xgboost'] * predictions['xgboost'] +
        weights['rf'] * predictions['randomforest'] +
        weights['gb'] * predictions['gradientboosting']
    )
    predictions['ensemble_weighted'] = ensemble_weighted

    return predictions, weights

# ============ 測試場景 ============
def prepare_data_scenarios(df, ai_factors, weather_df):
    """準備不同測試場景的數據"""
    scenarios = {}

    # COVID 期間定義
    covid_start = pd.Timestamp('2020-02-01')
    covid_end = pd.Timestamp('2022-06-30')

    # ========================================
    # 場景 1: 全數據（包含 COVID）
    # ========================================
    df_full = df.copy()
    df_full = create_comprehensive_features(df_full, ai_factors_dict=None)
    df_full = df_full.dropna(subset=['Attendance'])

    split_idx = int(len(df_full) * 0.8)
    train_full = df_full[:split_idx].copy()
    test_full = df_full[split_idx:].copy()

    scenarios['full_data'] = {
        'name': '全數據 (含 COVID)',
        'train': train_full,
        'test': test_full,
        'total_days': len(df_full),
        'covid_days': ((df_full['Date'] >= covid_start) & (df_full['Date'] <= covid_end)).sum()
    }

    # ========================================
    # 場景 2: 排除 COVID
    # ========================================
    df_no_covid = df[~((df['Date'] >= covid_start) & (df['Date'] <= covid_end))].copy()
    df_no_covid = create_comprehensive_features(df_no_covid, ai_factors_dict=None)
    df_no_covid = df_no_covid.dropna(subset=['Attendance'])

    split_idx = int(len(df_no_covid) * 0.8)
    train_no_covid = df_no_covid[:split_idx].copy()
    test_no_covid = df_no_covid[split_idx:].copy()

    scenarios['no_covid'] = {
        'name': '排除 COVID',
        'train': train_no_covid,
        'test': test_no_covid,
        'total_days': len(df_no_covid),
        'covid_days': 0
    }

    # ========================================
    # 場景 3: 最近 3 年數據
    # ========================================
    cutoff_date = df['Date'].max() - pd.Timedelta(days=3*365)
    df_recent = df[df['Date'] >= cutoff_date].copy()
    df_recent = create_comprehensive_features(df_recent, ai_factors_dict=None)
    df_recent = df_recent.dropna(subset=['Attendance'])

    split_idx = int(len(df_recent) * 0.8)
    train_recent = df_recent[:split_idx].copy()
    test_recent = df_recent[split_idx:].copy()

    scenarios['recent_3yr'] = {
        'name': '最近 3 年',
        'train': train_recent,
        'test': test_recent,
        'total_days': len(df_recent),
        'covid_days': ((df_recent['Date'] >= covid_start) & (df_recent['Date'] <= covid_end)).sum()
    }

    # ========================================
    # 場景 4: 排除 COVID + AI Factors
    # ========================================
    df_with_ai = df[~((df['Date'] >= covid_start) & (df['Date'] <= covid_end))].copy()
    df_with_ai = create_comprehensive_features(df_with_ai, ai_factors_dict=ai_factors)
    df_with_ai = df_with_ai.dropna(subset=['Attendance'])

    split_idx = int(len(df_with_ai) * 0.8)
    train_ai = df_with_ai[:split_idx].copy()
    test_ai = df_with_ai[split_idx:].copy()

    scenarios['with_ai'] = {
        'name': '排除 COVID + AI Factors',
        'train': train_ai,
        'test': test_ai,
        'total_days': len(df_with_ai),
        'covid_days': 0,
        'has_ai': True
    }

    # ========================================
    # 場景 5: 排除 COVID + 天氣數據
    # ========================================
    if weather_df is not None and len(weather_df) > 0:
        df_weather = df[~((df['Date'] >= covid_start) & (df['Date'] <= covid_end))].copy()
        df_weather = add_weather_features(df_weather, weather_df)
        # 確保 Date 是 datetime
        df_weather['Date'] = pd.to_datetime(df_weather['Date'])
        df_weather = create_comprehensive_features(df_weather, ai_factors_dict=None)
        df_weather = df_weather.dropna(subset=['Attendance'])

        split_idx = int(len(df_weather) * 0.8)
        train_weather = df_weather[:split_idx].copy()
        test_weather = df_weather[split_idx:].copy()

        scenarios['with_weather'] = {
            'name': '排除 COVID + 天氣數據',
            'train': train_weather,
            'test': test_weather,
            'total_days': len(df_weather),
            'covid_days': 0,
            'has_weather': True
        }

    return scenarios

# ============ 主測試函數 ============
def run_comprehensive_comparison():
    """執行全面模型比較測試"""
    print("=" * 80)
    print("🔬 全面的模型比較測試")
    print("=" * 80)
    print(f"⏰ 開始時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # 1. 加載數據
    df = load_all_historical_data()
    if df is None:
        print("❌ 無法加載數據")
        return

    # 2. 加載 AI Factors
    ai_factors = load_ai_factors()

    # 3. 加載天氣數據
    print("\n📥 加載天氣數據...")
    weather_df = load_weather_history()

    # 4. 準備測試場景
    print("\n🔧 準備測試場景...")
    scenarios = prepare_data_scenarios(df, ai_factors, weather_df)

    # 基礎特徵列表
    base_features = [
        "Attendance_EWMA7", "Attendance_EWMA14", "Daily_Change", "Monthly_Change",
        "Attendance_Lag1", "Weekly_Change", "Attendance_Rolling7", "Attendance_Position7",
        "Attendance_Lag30", "Attendance_Lag7", "Day_of_Week", "Lag1_Diff",
        "DayOfWeek_sin", "Attendance_Rolling14", "Attendance_Position14",
        "Attendance_Position30", "Attendance_Rolling3", "Attendance_Min7",
        "Attendance_Median14", "DayOfWeek_Target_Mean", "Attendance_Median3",
        "Attendance_EWMA30", "Is_Winter_Flu_Season", "Is_Weekend", "Holiday_Factor"
    ]

    all_results = {}
    all_predictions = {}

    # ========================================
    # 測試每個場景
    # ========================================
    for scenario_key, scenario in scenarios.items():
        print("\n" + "=" * 80)
        print(f"📊 測試場景: {scenario['name']}")
        print("=" * 80)
        print(f"   訓練集: {len(scenario['train'])} 天")
        print(f"   測試集: {len(scenario['test'])} 天")

        train = scenario['train']
        test = scenario['test']
        y_test = test['Attendance'].values

        # 選擇特徵
        if scenario.get('has_ai'):
            # 使用 AI 特徵
            ai_cols = [c for c in train.columns if c.startswith('AI_')]
            feature_cols = [c for c in base_features if c in train.columns] + ai_cols
        elif scenario.get('has_weather'):
            # 使用天氣特徵
            weather_cols = [c for c in train.columns if c.startswith('Weather_')]
            feature_cols = [c for c in base_features if c in train.columns] + weather_cols
        else:
            # 僅使用基礎特徵
            feature_cols = [c for c in base_features if c in train.columns]

        feature_cols = [c for c in feature_cols if c in train.columns]
        print(f"   特徵數: {len(feature_cols)} 個")

        X_train = train[feature_cols].fillna(0)
        X_test = test[feature_cols].fillna(0)

        # 訓練模型
        print("\n   訓練模型...")
        predictions, weights = train_ensemble(X_train, train['Attendance'].values, X_test, y_test)

        # 計算指標
        scenario_results = {}
        for model_name, pred in predictions.items():
            scenario_results[model_name] = calculate_metrics(y_test, pred)

        all_results[scenario_key] = {
            'scenario_name': scenario['name'],
            'metrics': {k: {m: float(v) for m, v in metrics.items()} for k, metrics in scenario_results.items()},
            'feature_count': len(feature_cols),
            'train_size': len(train),
            'test_size': len(test),
            'ensemble_weights': weights
        }

        all_predictions[scenario_key] = {
            'y_true': y_test,
            'predictions': predictions
        }

        # 輸出結果
        print(f"\n   結果:")
        for model_name, metrics in scenario_results.items():
            print(f"      {model_name:20} MAE={metrics['mae']:.2f}, RMSE={metrics['rmse']:.2f}, R²={metrics['r2']:.4f}")

    # ========================================
    # 統計顯著性測試
    # ========================================
    print("\n" + "=" * 80)
    print("📊 統計顯著性測試")
    print("=" * 80)

    significance_tests = {}

    # 測試 1: XGBoost vs Ensemble (在排除 COVID 數據上)
    if 'no_covid' in all_predictions and 'no_covid' in all_results:
        y_true = all_predictions['no_covid']['y_true']
        pred_xgb = all_predictions['no_covid']['predictions']['xgboost']
        pred_ens = all_predictions['no_covid']['predictions']['ensemble_simple']

        print("\n1️⃣ XGBoost vs Ensemble (排除 COVID 數據)")
        sig_result = statistical_significance_tests(
            y_true, pred_xgb, pred_ens, "XGBoost", "Ensemble"
        )
        significance_tests['xgb_vs_ensemble'] = sig_result

        print(f"   Paired t-test: p={sig_result['t_test']['p_value']:.4f} ({sig_result['t_test']['interpretation']})")
        print(f"   Wilcoxon test: p={sig_result['wilcoxon']['p_value']:.4f} ({sig_result['wilcoxon']['interpretation']})")
        print(f"   Diebold-Mariano: p={sig_result['diebold_mariano']['p_value']:.4f} ({sig_result['diebold_mariano']['interpretation']})")

        mae1 = sig_result['improvement']['mae1']
        mae2 = sig_result['improvement']['mae2']
        better = sig_result['improvement']['better_model']
        imp_pct = sig_result['improvement']['relative_improvement_pct']
        print(f"   更好模型: {better} (MAE: {mae1:.2f} → {mae2:.2f}, {imp_pct:+.1f}%)")

    # 測試 2: 無 AI vs 有 AI
    if 'no_covid' in all_predictions and 'with_ai' in all_predictions:
        # 確保測試集大小一致
        min_len = min(len(all_predictions['no_covid']['y_true']),
                     len(all_predictions['with_ai']['y_true']))

        y_true_no_ai = all_predictions['no_covid']['y_true'][:min_len]
        y_true_with_ai = all_predictions['with_ai']['y_true'][:min_len]
        pred_no_ai = all_predictions['no_covid']['predictions']['xgboost'][:min_len]
        pred_with_ai = all_predictions['with_ai']['predictions']['xgboost'][:min_len]

        # 需要比較的是同一數據上的預測，但這裡數據集不同
        # 改為比較整體指標
        print("\n2️⃣ AI 因子影響分析")
        mae_no_ai = all_results['no_covid']['metrics']['xgboost']['mae']
        mae_with_ai = all_results['with_ai']['metrics']['xgboost']['mae']
        improvement = (mae_no_ai - mae_with_ai) / mae_no_ai * 100

        print(f"   無 AI Factors: MAE = {mae_no_ai:.2f}")
        print(f"   有 AI Factors: MAE = {mae_with_ai:.2f}")
        print(f"   改善: {improvement:+.1f}%")

        significance_tests['ai_factors_impact'] = {
            'mae_without_ai': float(mae_no_ai),
            'mae_with_ai': float(mae_with_ai),
            'improvement_pct': float(improvement)
        }

    # 測試 3: 全數據 vs 排除 COVID
    if 'full_data' in all_results and 'no_covid' in all_results:
        print("\n3️⃣ 全數據 vs 排除 COVID")
        mae_full = all_results['full_data']['metrics']['xgboost']['mae']
        mae_no_covid = all_results['no_covid']['metrics']['xgboost']['mae']
        improvement = (mae_full - mae_no_covid) / mae_full * 100

        print(f"   全數據 (含 COVID): MAE = {mae_full:.2f}")
        print(f"   排除 COVID: MAE = {mae_no_covid:.2f}")
        print(f"   排除 COVID 改善: {improvement:+.1f}%")

        significance_tests['covid_exclusion_impact'] = {
            'mae_full_data': float(mae_full),
            'mae_no_covid': float(mae_no_covid),
            'improvement_pct': float(improvement)
        }

    # 測試 4: 天氣因素影響
    if 'no_covid' in all_results and 'with_weather' in all_results:
        print("\n4️⃣ 天氣因素影響分析")
        mae_no_weather = all_results['no_covid']['metrics']['xgboost']['mae']
        mae_with_weather = all_results['with_weather']['metrics']['xgboost']['mae']
        improvement = (mae_no_weather - mae_with_weather) / mae_no_weather * 100

        print(f"   無天氣數據: MAE = {mae_no_weather:.2f}")
        print(f"   有天氣數據: MAE = {mae_with_weather:.2f}")
        print(f"   改善: {improvement:+.1f}%")

        significance_tests['weather_factors_impact'] = {
            'mae_without_weather': float(mae_no_weather),
            'mae_with_weather': float(mae_with_weather),
            'improvement_pct': float(improvement)
        }

    # 測試 5: 數據量影響 (全數據 vs 最近 3 年)
    if 'full_data' in all_results and 'recent_3yr' in all_results:
        print("\n5️⃣ 數據量影響分析")
        mae_full = all_results['full_data']['metrics']['xgboost']['mae']
        mae_recent = all_results['recent_3yr']['metrics']['xgboost']['mae']
        diff_pct = (mae_recent - mae_full) / mae_full * 100

        print(f"   全數據 ({all_results['full_data']['train_size']} 訓練樣本): MAE = {mae_full:.2f}")
        print(f"   最近 3 年 ({all_results['recent_3yr']['train_size']} 訓練樣本): MAE = {mae_recent:.2f}")
        print(f"   差異: {diff_pct:+.1f}%")

        significance_tests['data_size_impact'] = {
            'mae_full_data': float(mae_full),
            'mae_recent_3yr': float(mae_recent),
            'full_data_train_size': all_results['full_data']['train_size'],
            'recent_3yr_train_size': all_results['recent_3yr']['train_size'],
            'difference_pct': float(diff_pct)
        }

    # ========================================
    # 總結報告
    # ========================================
    print("\n" + "=" * 80)
    print("🏆 總結報告")
    print("=" * 80)

    # 最佳模型配置
    best_mae = float('inf')
    best_config = None

    for scenario_key, results in all_results.items():
        for model_name, metrics in results['metrics'].items():
            if metrics['mae'] < best_mae:
                best_mae = metrics['mae']
                best_config = {
                    'scenario': results['scenario_name'],
                    'model': model_name,
                    'mae': metrics['mae'],
                    'rmse': metrics['rmse'],
                    'r2': metrics['r2']
                }

    print(f"\n🥇 最佳模型配置:")
    print(f"   場景: {best_config['scenario']}")
    print(f"   模型: {best_config['model']}")
    print(f"   MAE: {best_config['mae']:.2f}")
    print(f"   RMSE: {best_config['rmse']:.2f}")
    print(f"   R²: {best_config['r2']:.4f}")

    # 保存結果
    output = {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'data_info': {
            'total_records': len(df),
            'date_range': {
                'start': df['Date'].min().strftime('%Y-%m-%d'),
                'end': df['Date'].max().strftime('%Y-%m-%d')
            },
            'mean_attendance': float(df['Attendance'].mean()),
            'std_attendance': float(df['Attendance'].std())
        },
        'scenarios': all_results,
        'significance_tests': significance_tests,
        'best_configuration': best_config
    }

    # 轉換為 JSON 可序列化格式
    def convert_to_serializable(obj):
        if isinstance(obj, dict):
            return {k: convert_to_serializable(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [convert_to_serializable(v) for v in obj]
        elif isinstance(obj, (np.integer, np.int64, np.int32)):
            return int(obj)
        elif isinstance(obj, (np.floating, np.float64, np.float32)):
            return float(obj)
        elif isinstance(obj, (np.bool_, bool)):
            return bool(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        else:
            return obj

    output_serializable = convert_to_serializable(output)

    # 保存為 JSON
    os.makedirs('models', exist_ok=True)
    output_path = 'models/comprehensive_model_comparison.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output_serializable, f, indent=2, ensure_ascii=False)

    print(f"\n✅ 結果已保存到 {output_path}")
    print(f"\n⏰ 結束時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    return output

if __name__ == '__main__':
    run_comprehensive_comparison()
