"""
測試數據量對模型準確度的影響
Test: 更多數據是否讓 XGBoost 更準確？
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

def check_data_range():
    """檢查數據庫中的數據範圍"""
    print("📊 檢查數據庫數據範圍...")

    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            SELECT
                MIN(date) as first_date,
                MAX(date) as last_date,
                COUNT(*) as total_days,
                MIN(patient_count) as min_count,
                MAX(patient_count) as max_count,
                AVG(patient_count) as avg_count
            FROM actual_data
        """)

        result = cur.fetchone()

        print(f"\n   首日: {result['first_date']}")
        print(f"   末日: {result['last_date']}")
        print(f"   總天數: {result['total_days']}")
        print(f"   就診範圍: {result['min_count']} - {result['max_count']}")
        print(f"   平均就診: {result['avg_count']:.1f}")

        cur.close()
        conn.close()

        return result

    except Exception as e:
        print(f"   ❌ 查詢失敗: {e}")
        return None

def load_full_data_from_db():
    """從數據庫加載完整數據"""
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            SELECT date as "Date", patient_count as "Attendance"
            FROM actual_data
            ORDER BY date
        """)

        rows = cur.fetchall()
        df = pd.DataFrame(rows)

        cur.close()
        conn.close()

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

def test_with_different_data_sizes(df, feature_cols):
    """測試不同數據量的影響"""

    results = {}

    # 測試不同數據量
    data_sizes = [
        ('500 天', 500),
        ('1000 天', 1000),
        ('2000 天', 2000),
        ('3000 天', 3000),
        ('全部數據', len(df))
    ]

    for size_name, size in data_sizes:
        if size > len(df):
            continue

        print(f"\n{'=' * 80}")
        print(f"📊 測試數據量: {size_name} ({size} 天)")
        print("=" * 80)

        # 使用最近的 N 天數據
        df_subset = df.tail(size).copy()

        # 80/20 分割
        split_idx = int(len(df_subset) * 0.8)
        train_data = df_subset[:split_idx]
        test_data = df_subset[split_idx:]

        X_train = train_data[feature_cols].fillna(0)
        y_train = train_data['Attendance'].values
        X_test = test_data[feature_cols].fillna(0)
        y_test = test_data['Attendance'].values

        print(f"   訓練集: {len(train_data)} 天")
        print(f"   測試集: {len(test_data)} 天")

        # Random Forest
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

        # XGBoost
        xgb_model = xgb.XGBRegressor(
            n_estimators=500,
            max_depth=8,
            learning_rate=0.05,
            random_state=42
        )
        xgb_model.fit(X_train, y_train)
        xgb_pred = xgb_model.predict(X_test)
        xgb_metrics = calculate_metrics(y_test, xgb_pred)

        print(f"\n   Random Forest:")
        print(f"      MAE:  {rf_metrics['mae']:.2f}")
        print(f"      MAPE: {rf_metrics['mape']:.2f}%")
        print(f"      R²:   {rf_metrics['r2']:.4f}")

        print(f"\n   XGBoost:")
        print(f"      MAE:  {xgb_metrics['mae']:.2f}")
        print(f"      MAPE: {xgb_metrics['mape']:.2f}%")
        print(f"      R²:   {xgb_metrics['r2']:.4f}")

        winner = "RF" if rf_metrics['mae'] < xgb_metrics['mae'] else "XGB"
        gap = abs(rf_metrics['mae'] - xgb_metrics['mae'])

        print(f"\n   勝者: {winner} (領先 {gap:.2f})")

        results[size_name] = {
            'size': size,
            'train_days': len(train_data),
            'test_days': len(test_data),
            'rf': rf_metrics,
            'xgb': xgb_metrics,
            'winner': winner,
            'gap': float(gap)
        }

    return results

def main():
    print("=" * 80)
    print("🔬 數據量影響測試: 更多數據是否讓 XGBoost 更準確？")
    print("=" * 80)
    print(f"⏰ 開始時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # 檢查數據範圍
    data_info = check_data_range()
    if data_info is None:
        return

    # 加載完整數據
    print("\n📥 加載完整數據...")
    df = load_full_data_from_db()
    if df is None:
        return

    df['Date'] = pd.to_datetime(df['Date'])
    print(f"   ✅ 成功加載 {len(df)} 筆數據")

    # 排除 COVID
    covid_start = pd.Timestamp('2020-02-01')
    covid_end = pd.Timestamp('2022-06-30')
    covid_mask = (df['Date'] >= covid_start) & (df['Date'] <= covid_end)
    df_no_covid = df[~covid_mask].copy()

    print(f"\n📊 數據統計:")
    print(f"   原始數據: {len(df)} 天")
    print(f"   COVID 期間: {covid_mask.sum()} 天")
    print(f"   排除 COVID 後: {len(df_no_covid)} 天")

    # 創建特徵
    print("\n🔧 創建特徵...")
    df_no_covid = create_comprehensive_features(df_no_covid)
    df_no_covid = df_no_covid.dropna(subset=['Attendance'])

    feature_cols = [
        "Attendance_Lag1", "Attendance_Lag7", "Attendance_Same_Weekday_Avg",
        "Day_of_Week", "DayOfWeek_Target_Mean", "Attendance_Rolling7",
        "Attendance_EWMA7", "Attendance_Lag14", "Attendance_Lag30",
        "Daily_Change", "Weekly_Change", "Is_Weekend",
        "Holiday_Factor", "Attendance_Std7", "Month"
    ]
    feature_cols = [c for c in feature_cols if c in df_no_covid.columns]

    # 測試不同數據量
    results = test_with_different_data_sizes(df_no_covid, feature_cols)

    # 總結分析
    print("\n" + "=" * 80)
    print("📊 數據量影響總結")
    print("=" * 80)

    print(f"\n{'數據量':<15} {'訓練天數':<12} {'RF MAE':<10} {'XGB MAE':<10} {'勝者':<8} {'差距':<10}")
    print("-" * 80)

    for size_name, result in results.items():
        rf_mae = result['rf']['mae']
        xgb_mae = result['xgb']['mae']
        winner = result['winner']
        gap = result['gap']

        winner_str = f"{winner} ✅"
        print(f"{size_name:<15} {result['train_days']:<12} {rf_mae:<10.2f} {xgb_mae:<10.2f} {winner_str:<8} {gap:<10.2f}")

    # 分析趨勢
    print("\n" + "=" * 80)
    print("📈 趨勢分析")
    print("=" * 80)

    # 計算 XGBoost 改善趨勢
    sizes = list(results.keys())
    if len(sizes) >= 2:
        first_xgb = results[sizes[0]]['xgb']['mae']
        last_xgb = results[sizes[-1]]['xgb']['mae']
        xgb_improvement = ((first_xgb - last_xgb) / first_xgb) * 100

        first_rf = results[sizes[0]]['rf']['mae']
        last_rf = results[sizes[-1]]['rf']['mae']
        rf_improvement = ((first_rf - last_rf) / first_rf) * 100

        print(f"\n   XGBoost 改善 ({sizes[0]} → {sizes[-1]}):")
        print(f"      MAE: {first_xgb:.2f} → {last_xgb:.2f}")
        print(f"      改善: {xgb_improvement:+.1f}%")

        print(f"\n   Random Forest 改善 ({sizes[0]} → {sizes[-1]}):")
        print(f"      MAE: {first_rf:.2f} → {last_rf:.2f}")
        print(f"      改善: {rf_improvement:+.1f}%")

        # 判斷誰受益更多
        if abs(xgb_improvement) > abs(rf_improvement):
            print(f"\n   ✅ XGBoost 從更多數據中受益更多 ({abs(xgb_improvement):.1f}% vs {abs(rf_improvement):.1f}%)")
        else:
            print(f"\n   ✅ Random Forest 從更多數據中受益更多 ({abs(rf_improvement):.1f}% vs {abs(xgb_improvement):.1f}%)")

    # 結論
    print("\n" + "=" * 80)
    print("🎯 結論")
    print("=" * 80)

    last_result = results[sizes[-1]]

    if last_result['winner'] == 'XGB':
        print(f"\n   ✅ 在最大數據量下，XGBoost 勝出")
        print(f"   XGB MAE: {last_result['xgb']['mae']:.2f}")
        print(f"   RF MAE:  {last_result['rf']['mae']:.2f}")
        print(f"   領先: {last_result['gap']:.2f}")
    else:
        print(f"\n   ✅ 即使在最大數據量下，Random Forest 仍然勝出")
        print(f"   RF MAE:  {last_result['rf']['mae']:.2f}")
        print(f"   XGB MAE: {last_result['xgb']['mae']:.2f}")
        print(f"   領先: {last_result['gap']:.2f}")

    # 保存結果
    output = {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'total_days': len(df),
        'covid_excluded_days': int(covid_mask.sum()),
        'usable_days': len(df_no_covid),
        'results': {k: {
            'size': v['size'],
            'train_days': v['train_days'],
            'test_days': v['test_days'],
            'rf_mae': float(v['rf']['mae']),
            'xgb_mae': float(v['xgb']['mae']),
            'winner': v['winner'],
            'gap': v['gap']
        } for k, v in results.items()}
    }

    os.makedirs('models', exist_ok=True)
    with open('models/data_size_impact_results.json', 'w') as f:
        json.dump(output, f, indent=2)

    print(f"\n✅ 結果已保存到 models/data_size_impact_results.json")

if __name__ == '__main__':
    main()
