"""
綜合測試：Ensemble、AI/Weather Factors、完整數據（包括 COVID）
從 Railway Database 加載所有數據
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
import json
import os
from datetime import datetime
import psycopg2
from psycopg2.extras import RealDictCursor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_engineering import create_comprehensive_features
from ensemble_predict import load_ai_factors_from_db

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

def load_all_data_from_db():
    """從數據庫加載完整所有數據（包括 COVID）"""
    print("📥 連接 Railway Database 加載所有數據...")
    
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # 獲取所有數據
        cur.execute("""
            SELECT date as "Date", patient_count as "Attendance"
            FROM actual_data
            ORDER BY date
        """)
        
        rows = cur.fetchall()
        df = pd.DataFrame(rows)
        
        cur.close()
        conn.close()
        
        df['Date'] = pd.to_datetime(df['Date'])
        print(f"   ✅ 成功加載 {len(df)} 筆數據")
        print(f"   📅 日期範圍: {df['Date'].min()} → {df['Date'].max()}")
        
        return df
        
    except Exception as e:
        print(f"   ❌ 數據庫連接失敗: {e}")
        return None

def calculate_metrics(y_true, y_pred):
    return {
        'mae': mean_absolute_error(y_true, y_pred),
        'rmse': np.sqrt(mean_squared_error(y_true, y_pred)),
        'mape': np.mean(np.abs((y_true - y_pred) / y_true)) * 100,
        'r2': r2_score(y_true, y_pred)
    }

def train_ensemble_models(train_data, test_data, feature_cols):
    """訓練 Ensemble 模型"""
    X_train = train_data[feature_cols].fillna(0)
    y_train = train_data['Attendance'].values
    X_test = test_data[feature_cols].fillna(0)
    
    models = {}
    predictions = {}
    
    # XGBoost
    print("   🔥 訓練 XGBoost...")
    xgb_model = xgb.XGBRegressor(n_estimators=500, max_depth=8, learning_rate=0.05, random_state=42)
    xgb_model.fit(X_train, y_train, verbose=False)
    models['xgboost'] = xgb_model
    predictions['xgboost'] = xgb_model.predict(X_test)
    
    # Random Forest
    print("   🌲 訓練 Random Forest...")
    rf = RandomForestRegressor(n_estimators=200, max_depth=12, min_samples_split=10, random_state=42, n_jobs=-1)
    rf.fit(X_train, y_train)
    models['randomforest'] = rf
    predictions['randomforest'] = rf.predict(X_test)
    
    # Gradient Boosting
    print("   📈 訓練 Gradient Boosting...")
    gb = GradientBoostingRegressor(n_estimators=200, max_depth=6, learning_rate=0.05, random_state=42)
    gb.fit(X_train, y_train)
    models['gradientboost'] = gb
    predictions['gradientboost'] = gb.predict(X_test)
    
    # LightGBM (optional)
    try:
        print("   ⚡ 訓練 LightGBM...")
        from lightgbm import LGBMRegressor
        lgb = LGBMRegressor(n_estimators=300, max_depth=8, learning_rate=0.05, random_state=42, verbose=-1)
        lgb.fit(X_train, y_train)
        models['lightgbm'] = lgb
        predictions['lightgbm'] = lgb.predict(X_test)
    except:
        print("   ⚠️ LightGBM 未安裝，跳過")
    
    # Ensemble (簡單平均)
    print("   🎯 計算 Ensemble 預測...")
    ensemble_pred = np.mean([predictions[k] for k in predictions.keys()], axis=0)
    predictions['ensemble'] = ensemble_pred
    
    return models, predictions

def test_scenario(name, train_data, test_data, feature_cols, y_test):
    """測試一個場景"""
    print(f"\n   📊 測試: {name}")
    models, predictions = train_ensemble_models(train_data, test_data, feature_cols)
    
    results = {}
    for model_name, pred in predictions.items():
        results[model_name] = calculate_metrics(y_test, pred)
    
    return results, predictions

def main():
    print("=" * 80)
    print("🔬 綜合測試：Ensemble、AI/Weather Factors、完整數據")
    print("   從 Railway Database 加載所有數據（包括 COVID）")
    print("=" * 80)
    print(f"⏰ 開始時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    
    # 從數據庫加載所有數據
    df = load_all_data_from_db()
    if df is None:
        print("❌ 無法加載數據")
        return
    
    total_days = len(df)
    
    # COVID 期間定義
    covid_start = pd.Timestamp('2020-02-01')
    covid_end = pd.Timestamp('2022-06-30')
    covid_mask = (df['Date'] >= covid_start) & (df['Date'] <= covid_end)
    covid_days = covid_mask.sum()
    
    print(f"\n📊 數據統計:")
    print(f"   總數據量: {total_days} 天")
    print(f"   COVID 期間: {covid_days} 天 (2020-02-01 至 2022-06-30)")
    print(f"   非 COVID: {total_days - covid_days} 天")
    
    # 加載 AI factors
    print("\n📥 加載 AI Factors...")
    ai_factors = load_ai_factors_from_db()
    print(f"   ✅ AI Factors 數據: {len(ai_factors)} 個日期")
    
    # 基礎特徵列表
    base_feature_cols = [
        "Attendance_Lag1", "Attendance_Lag7", "Attendance_Same_Weekday_Avg",
        "Day_of_Week", "DayOfWeek_Target_Mean", "Attendance_Rolling7",
        "Attendance_EWMA7", "Attendance_Lag14", "Attendance_Lag30",
        "Daily_Change", "Weekly_Change", "Is_Weekend",
        "Holiday_Factor", "Attendance_Std7", "Month"
    ]
    
    all_results = {}
    
    # ============================================
    # 測試 1: 完整數據（包括 COVID）vs 排除 COVID
    # ============================================
    print("\n" + "=" * 80)
    print("📊 測試 1: 完整數據（包括 COVID）vs 排除 COVID")
    print("=" * 80)
    
    # 1.1 完整數據（包括 COVID）
    print("\n🔧 處理完整數據（包括 COVID）...")
    df_full = df.copy()
    df_full = create_comprehensive_features(df_full, ai_factors_dict=None)
    df_full = df_full.dropna(subset=['Attendance'])
    
    split_idx_full = int(len(df_full) * 0.8)
    train_full = df_full[:split_idx_full].copy()
    test_full = df_full[split_idx_full:].copy()
    
    feature_cols_full = [c for c in base_feature_cols if c in train_full.columns]
    X_test_full = test_full[feature_cols_full].fillna(0)
    y_test_full = test_full['Attendance'].values
    
    print(f"   訓練集: {len(train_full)} 天")
    print(f"   測試集: {len(test_full)} 天")
    
    results_full, _ = test_scenario("完整數據（包括 COVID）", train_full, test_full, feature_cols_full, y_test_full)
    all_results['full_data'] = results_full
    
    # 1.2 排除 COVID
    print("\n🔧 處理排除 COVID 數據...")
    df_no_covid = df[~covid_mask].copy()
    df_no_covid = create_comprehensive_features(df_no_covid, ai_factors_dict=None)
    df_no_covid = df_no_covid.dropna(subset=['Attendance'])
    
    split_idx_no_covid = int(len(df_no_covid) * 0.8)
    train_no_covid = df_no_covid[:split_idx_no_covid].copy()
    test_no_covid = df_no_covid[split_idx_no_covid:].copy()
    
    feature_cols_no_covid = [c for c in base_feature_cols if c in train_no_covid.columns]
    X_test_no_covid = test_no_covid[feature_cols_no_covid].fillna(0)
    y_test_no_covid = test_no_covid['Attendance'].values
    
    print(f"   訓練集: {len(train_no_covid)} 天")
    print(f"   測試集: {len(test_no_covid)} 天")
    
    results_no_covid, _ = test_scenario("排除 COVID", train_no_covid, test_no_covid, feature_cols_no_covid, y_test_no_covid)
    all_results['no_covid'] = results_no_covid
    
    # ============================================
    # 測試 2: AI Factors 影響
    # ============================================
    print("\n" + "=" * 80)
    print("📊 測試 2: AI Factors 影響")
    print("=" * 80)
    
    # 2.1 無 AI factors
    print("\n🔧 處理無 AI factors 數據...")
    train_no_ai = create_comprehensive_features(train_no_covid.copy(), ai_factors_dict=None)
    test_no_ai = create_comprehensive_features(test_no_covid.copy(), ai_factors_dict=None)
    
    feature_cols_no_ai = [c for c in base_feature_cols if c in train_no_ai.columns]
    y_test_no_ai = test_no_ai['Attendance'].values
    
    results_no_ai, _ = test_scenario("無 AI Factors", train_no_ai, test_no_ai, feature_cols_no_ai, y_test_no_ai)
    all_results['no_ai'] = results_no_ai
    
    # 2.2 有 AI factors
    print("\n🔧 處理有 AI factors 數據...")
    train_with_ai = create_comprehensive_features(train_no_covid.copy(), ai_factors_dict=ai_factors if ai_factors else None)
    test_with_ai = create_comprehensive_features(test_no_covid.copy(), ai_factors_dict=ai_factors if ai_factors else None)
    
    # 添加 AI 特徵
    ai_feature_cols = [c for c in train_with_ai.columns if c.startswith('AI_')]
    feature_cols_with_ai = [c for c in base_feature_cols if c in train_with_ai.columns] + ai_feature_cols
    feature_cols_with_ai = [c for c in feature_cols_with_ai if c in train_with_ai.columns]
    
    y_test_with_ai = test_with_ai['Attendance'].values
    
    print(f"   基礎特徵: {len([c for c in base_feature_cols if c in train_with_ai.columns])} 個")
    print(f"   AI 特徵: {len(ai_feature_cols)} 個")
    print(f"   總特徵: {len(feature_cols_with_ai)} 個")
    
    results_with_ai, _ = test_scenario("有 AI Factors", train_with_ai, test_with_ai, feature_cols_with_ai, y_test_with_ai)
    all_results['with_ai'] = results_with_ai
    
    # ============================================
    # 測試 3: Ensemble vs 單一 XGBoost
    # ============================================
    print("\n" + "=" * 80)
    print("📊 測試 3: Ensemble vs 單一 XGBoost")
    print("=" * 80)
    
    # 使用排除 COVID + 無 AI factors 的數據進行比較
    print("\n   使用排除 COVID + 無 AI factors 的數據進行比較")
    
    baseline_mae = results_no_ai['xgboost']['mae']
    ensemble_mae = results_no_ai['ensemble']['mae']
    improvement = ((baseline_mae - ensemble_mae) / baseline_mae) * 100
    
    print(f"\n   XGBoost (單一): MAE = {baseline_mae:.2f}")
    print(f"   Ensemble:       MAE = {ensemble_mae:.2f}")
    print(f"   改善: {improvement:+.2f}%")
    
    if improvement > 0:
        print(f"   ✅ Ensemble 更好！")
    else:
        print(f"   ❌ XGBoost 更好！")
    
    # ============================================
    # 總結報告
    # ============================================
    print("\n" + "=" * 80)
    print("🏆 總結報告")
    print("=" * 80)
    
    print("\n📊 測試 1: 完整數據 vs 排除 COVID")
    print(f"   完整數據 XGBoost MAE: {results_full['xgboost']['mae']:.2f}")
    print(f"   排除 COVID XGBoost MAE: {results_no_covid['xgboost']['mae']:.2f}")
    improvement_covid = ((results_full['xgboost']['mae'] - results_no_covid['xgboost']['mae']) / results_full['xgboost']['mae']) * 100
    print(f"   排除 COVID 改善: {improvement_covid:+.2f}%")
    
    print("\n📊 測試 2: AI Factors 影響")
    print(f"   無 AI Factors XGBoost MAE: {results_no_ai['xgboost']['mae']:.2f}")
    print(f"   有 AI Factors XGBoost MAE: {results_with_ai['xgboost']['mae']:.2f}")
    improvement_ai = ((results_no_ai['xgboost']['mae'] - results_with_ai['xgboost']['mae']) / results_no_ai['xgboost']['mae']) * 100
    print(f"   AI Factors 改善: {improvement_ai:+.2f}%")
    
    print("\n📊 測試 3: Ensemble vs 單一 XGBoost")
    print(f"   XGBoost (單一) MAE: {baseline_mae:.2f}")
    print(f"   Ensemble MAE: {ensemble_mae:.2f}")
    print(f"   Ensemble 改善: {improvement:+.2f}%")
    
    # 保存結果
    output = {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'total_days': total_days,
        'covid_days': int(covid_days),
        'ai_factors_count': len(ai_factors),
        'results': {
            'full_data': {k: {m: float(v) for m, v in metrics.items()} for k, metrics in results_full.items()},
            'no_covid': {k: {m: float(v) for m, v in metrics.items()} for k, metrics in results_no_covid.items()},
            'no_ai': {k: {m: float(v) for m, v in metrics.items()} for k, metrics in results_no_ai.items()},
            'with_ai': {k: {m: float(v) for m, v in metrics.items()} for k, metrics in results_with_ai.items()}
        },
        'summary': {
            'covid_exclusion_improvement_pct': float(improvement_covid),
            'ai_factors_improvement_pct': float(improvement_ai),
            'ensemble_improvement_pct': float(improvement)
        }
    }
    
    os.makedirs('models', exist_ok=True)
    with open('models/comprehensive_test_results.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    print(f"\n✅ 結果已保存到 models/comprehensive_test_results.json")
    print(f"\n⏰ 結束時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

if __name__ == '__main__':
    main()