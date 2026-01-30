"""
使用完整數據庫數據測試 Random Forest vs XGBoost
Full 4064 days data from Railway Database
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
import psycopg2
from psycopg2.extras import RealDictCursor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_engineering import create_comprehensive_features

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

def load_full_data_from_db():
    """從數據庫加載完整 11 年數據"""
    print("📥 連接 Railway Database...")

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

        print(f"   ✅ 成功加載 {len(df)} 筆數據")
        print(f"   📅 日期範圍: {df['Date'].min()} → {df['Date'].max()}")

        return df

    except Exception as e:
        print(f"   ❌ 數據庫連接失敗: {e}")
        return None

def calculate_metrics(y_true, y_pred):
    mae = mean_absolute_error(y_true, y_pred)
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))
    mape = np.mean(np.abs((y_true - y_pred) / y_true)) * 100
    r2 = r2_score(y_true, y_pred)
    return {'mae': mae, 'rmse': rmse, 'mape': mape, 'r2': r2}

def main():
    print("=" * 80)
    print("🔬 完整數據測試: Random Forest vs XGBoost")
    print("   使用 Railway Database 完整 11 年數據")
    print("=" * 80)
    print(f"⏰ 開始時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # 從數據庫加載完整數據
    df = load_full_data_from_db()
    if df is None:
        print("❌ 無法加載數據")
        return

    df['Date'] = pd.to_datetime(df['Date'])
    total_days = len(df)

    # COVID 期間定義
    covid_start = pd.Timestamp('2020-02-01')
    covid_end = pd.Timestamp('2022-06-30')
    covid_mask = (df['Date'] >= covid_start) & (df['Date'] <= covid_end)
    covid_days = covid_mask.sum()

    print(f"\n📊 數據統計:")
    print(f"   總數據量: {total_days} 天")
    print(f"   COVID 期間: {covid_days} 天")
    print(f"   非 COVID: {total_days - covid_days} 天")

    # 排除 COVID 數據
    df_no_covid = df[~covid_mask].copy()
    print(f"\n🔧 排除 COVID 後: {len(df_no_covid)} 天")

    # 創建特徵
    print("🔧 創建特徵...")
    df_no_covid = create_comprehensive_features(df_no_covid)
    df_no_covid = df_no_covid.dropna(subset=['Attendance'])

    # 特徵列表
    feature_cols = [
        "Attendance_Lag1", "Attendance_Lag7", "Attendance_Same_Weekday_Avg",
        "Day_of_Week", "DayOfWeek_Target_Mean", "Attendance_Rolling7",
        "Attendance_EWMA7", "Attendance_Lag14", "Attendance_Lag30",
        "Daily_Change", "Weekly_Change", "Is_Weekend",
        "Holiday_Factor", "Attendance_Std7", "Month"
    ]
    feature_cols = [c for c in feature_cols if c in df_no_covid.columns]

    # 時間序列分割（80/20）
    split_idx = int(len(df_no_covid) * 0.8)
    train_data = df_no_covid[:split_idx].copy()
    test_data = df_no_covid[split_idx:].copy()

    print(f"\n📊 數據分割:")
    print(f"   訓練集: {len(train_data)} 天")
    print(f"   測試集: {len(test_data)} 天")
    print(f"   測試日期: {test_data['Date'].min()} → {test_data['Date'].max()}")

    X_train = train_data[feature_cols].fillna(0)
    y_train = train_data['Attendance'].values
    X_test = test_data[feature_cols].fillna(0)
    y_test = test_data['Attendance'].values

    results = {}

    # ============================================
    # Random Forest
    # ============================================
    print("\n" + "=" * 80)
    print("📊 Random Forest")
    print("=" * 80)

    rf = RandomForestRegressor(
        n_estimators=200,
        max_depth=12,
        min_samples_split=10,
        random_state=42,
        n_jobs=-1
    )
    rf.fit(X_train, y_train)
    rf_pred = rf.predict(X_test)

    rf_metrics = calculate_metrics(y_test, rf_pred)
    results['rf'] = rf_metrics

    print(f"   MAE:  {rf_metrics['mae']:.2f}")
    print(f"   RMSE: {rf_metrics['rmse']:.2f}")
    print(f"   MAPE: {rf_metrics['mape']:.2f}%")
    print(f"   R²:   {rf_metrics['r2']:.4f}")

    # ============================================
    # XGBoost
    # ============================================
    print("\n" + "=" * 80)
    print("📊 XGBoost")
    print("=" * 80)

    xgb_model = xgb.XGBRegressor(
        n_estimators=500,
        max_depth=8,
        learning_rate=0.05,
        random_state=42
    )
    xgb_model.fit(X_train, y_train)
    xgb_pred = xgb_model.predict(X_test)

    xgb_metrics = calculate_metrics(y_test, xgb_pred)
    results['xgb'] = xgb_metrics

    print(f"   MAE:  {xgb_metrics['mae']:.2f}")
    print(f"   RMSE: {xgb_metrics['rmse']:.2f}")
    print(f"   MAPE: {xgb_metrics['mape']:.2f}%")
    print(f"   R²:   {xgb_metrics['r2']:.4f}")

    # ============================================
    # 長期預測測試 (7天, 14天, 30天, 60天)
    # ============================================
    print("\n" + "=" * 80)
    print("📊 長期預測能力比較")
    print("=" * 80)

    periods = [
        ('Day 1-7', 0, 7),
        ('Day 8-14', 7, 14),
        ('Day 15-21', 14, 21),
        ('Day 22-30', 21, 30),
        ('Day 31-60', 30, 60),
        ('Day 61-90', 60, 90),
    ]

    print(f"\n{'預測範圍':<15} {'RF MAE':<12} {'XGB MAE':<12} {'RF MAPE':<12} {'XGB MAPE':<12} {'勝者':<10}")
    print("-" * 80)

    for name, start, end in periods:
        if end <= len(y_test):
            rf_period = calculate_metrics(y_test[start:end], rf_pred[start:end])
            xgb_period = calculate_metrics(y_test[start:end], xgb_pred[start:end])

            winner = "RF ✅" if rf_period['mae'] < xgb_period['mae'] else "XGB ✅"
            print(f"{name:<15} {rf_period['mae']:<12.2f} {xgb_period['mae']:<12.2f} {rf_period['mape']:<12.2f}% {xgb_period['mape']:<12.2f}% {winner:<10}")

            results[f'rf_{name}'] = rf_period
            results[f'xgb_{name}'] = xgb_period

    # ============================================
    # 總結
    # ============================================
    print("\n" + "=" * 80)
    print("🏆 總結")
    print("=" * 80)

    improvement = ((xgb_metrics['mae'] - rf_metrics['mae']) / xgb_metrics['mae']) * 100

    print(f"\n   數據量: {len(df_no_covid)} 天 (排除 COVID)")
    print(f"\n   Random Forest:")
    print(f"      MAE:  {rf_metrics['mae']:.2f}")
    print(f"      MAPE: {rf_metrics['mape']:.2f}%")
    print(f"      R²:   {rf_metrics['r2']:.4f}")
    print(f"\n   XGBoost:")
    print(f"      MAE:  {xgb_metrics['mae']:.2f}")
    print(f"      MAPE: {xgb_metrics['mape']:.2f}%")
    print(f"      R²:   {xgb_metrics['r2']:.4f}")

    if rf_metrics['mae'] < xgb_metrics['mae']:
        print(f"\n   ✅ Random Forest 勝出！")
        print(f"   MAE 改善: {improvement:.1f}%")
    else:
        print(f"\n   ✅ XGBoost 勝出！")
        print(f"   MAE 改善: {-improvement:.1f}%")

    # 保存結果
    output = {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'total_days': total_days,
        'covid_excluded_days': covid_days,
        'training_days': len(train_data),
        'test_days': len(test_data),
        'results': {
            'rf': rf_metrics,
            'xgb': xgb_metrics
        },
        'winner': 'Random Forest' if rf_metrics['mae'] < xgb_metrics['mae'] else 'XGBoost',
        'improvement_pct': improvement
    }

    os.makedirs('models', exist_ok=True)
    with open('models/full_data_comparison_results.json', 'w') as f:
        json.dump(output, f, indent=2)

    print(f"\n✅ 結果已保存到 models/full_data_comparison_results.json")

if __name__ == '__main__':
    main()
