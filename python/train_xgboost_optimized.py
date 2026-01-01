"""
XGBoost 優化版訓練腳本 v2.9.51
使用特徵選擇優化，只使用最重要的 20-30 個特徵
"""
import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import json
import os
import sys
import datetime
import time

try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo

from feature_engineering import create_comprehensive_features

HKT = ZoneInfo('Asia/Hong_Kong')

# 最佳特徵集（基於特徵重要性分析）
OPTIMAL_FEATURES = [
    # Top 20 特徵（佔總重要性 95%+）
    "Attendance_EWMA7",        # 87.87% - 絕對核心！
    "Monthly_Change",           # 2.59%
    "Daily_Change",             # 2.58%
    "Attendance_Lag1",          # 1.18%
    "Weekly_Change",            # 0.83%
    "Attendance_Rolling7",      # 0.48%
    "Attendance_Position7",     # 0.47%
    "Attendance_Lag30",         # 0.41%
    "Attendance_Lag7",          # 0.34%
    "Day_of_Week",              # 0.32%
    "Lag1_Diff",                # 0.30%
    "DayOfWeek_sin",            # 0.21%
    "Attendance_Rolling14",     # 0.17%
    "Attendance_Position14",    # 0.16%
    "Attendance_Position30",    # 0.13%
    "Attendance_Rolling3",      # 0.12%
    "Attendance_Min7",          # 0.11%
    "Attendance_Median14",      # 0.10%
    "DayOfWeek_Target_Mean",    # 0.09%
    "Attendance_Median3",       # 0.08%
    # 可選：添加更多如果需要
    "Attendance_EWMA14",
    "Attendance_EWMA30",
    "Is_Winter_Flu_Season",
    "Is_Weekend",
    "Holiday_Factor",
]

def load_data_from_csv(csv_path):
    """從 CSV 文件加載數據"""
    try:
        df = pd.read_csv(csv_path)
        if 'Date' not in df.columns and 'date' in df.columns:
            df['Date'] = df['date']
        if 'Attendance' not in df.columns and 'patient_count' in df.columns:
            df['Attendance'] = df['patient_count']
        return df[['Date', 'Attendance']]
    except Exception as e:
        print(f"無法從 CSV 加載數據: {e}")
        return None

def main():
    print(f"\n{'='*60}")
    print("🏥 NDH AED XGBoost 優化版訓練 v2.9.51")
    print(f"{'='*60}")
    print(f"⏰ 開始時間: {datetime.datetime.now(HKT).strftime('%Y-%m-%d %H:%M:%S')} HKT")
    print(f"📊 使用優化特徵集: {len(OPTIMAL_FEATURES)} 個特徵")
    
    # 加載數據
    df = load_data_from_csv('../NDH_AED_Clean.csv')
    if df is None:
        print("❌ 無法加載數據")
        return
    
    print(f"\n📊 數據量: {len(df)} 筆")
    print(f"📅 日期範圍: {df['Date'].min()} → {df['Date'].max()}")
    
    # 創建特徵
    print("\n⏳ 創建特徵中...")
    df = create_comprehensive_features(df)
    df = df.dropna(subset=['Attendance'])
    
    # 選擇優化特徵
    available_features = [f for f in OPTIMAL_FEATURES if f in df.columns]
    print(f"✅ 使用 {len(available_features)} 個特徵")
    
    # 時間序列分割
    split_idx = int(len(df) * 0.8)
    train_data = df[:split_idx].copy()
    test_data = df[split_idx:].copy()
    
    X_train = train_data[available_features]
    y_train = train_data['Attendance']
    X_test = test_data[available_features]
    y_test = test_data['Attendance']
    
    print(f"\n📊 數據分割:")
    print(f"   訓練集: {len(train_data)} 筆")
    print(f"   測試集: {len(test_data)} 筆")
    
    # 訓練模型
    print(f"\n🔥 開始訓練...")
    model = xgb.XGBRegressor(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        n_jobs=-1
    )
    
    start_time = time.time()
    model.fit(X_train, y_train, verbose=False)
    train_time = time.time() - start_time
    
    # 評估
    y_pred = model.predict(X_test)
    mae = mean_absolute_error(y_test, y_pred)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))
    mape = np.mean(np.abs((y_test - y_pred) / y_test)) * 100
    r2 = r2_score(y_test, y_pred)
    
    n = len(y_test)
    p = len(available_features)
    adj_r2 = 1 - (1 - r2) * (n - 1) / (n - p - 1)
    
    print(f"\n✅ 訓練完成！耗時: {train_time:.2f} 秒")
    print(f"\n{'='*60}")
    print("📊 模型性能")
    print(f"{'='*60}")
    print(f"   MAE: {mae:.2f} 人")
    print(f"   MAPE: {mape:.2f}%")
    print(f"   R²: {r2*100:.1f}%")
    print(f"   調整 R²: {adj_r2*100:.1f}%")
    
    # 保存模型（使用 booster 直接保存以避免 sklearn 問題）
    model.get_booster().save_model('models/xgboost_optimized.json')
    
    # 保存指標
    metrics = {
        'mae': mae,
        'rmse': rmse,
        'mape': mape,
        'r2': r2,
        'adj_r2': adj_r2,
        'feature_count': len(available_features),
        'features': available_features,
        'training_date': datetime.datetime.now(HKT).strftime('%Y-%m-%d %H:%M:%S HKT'),
        'version': '2.9.51-optimized'
    }
    
    with open('models/xgboost_optimized_metrics.json', 'w') as f:
        json.dump(metrics, f, indent=2)
    
    print(f"\n✅ 模型已保存到 models/xgboost_optimized.json")
    
    # 與完整版比較
    print(f"\n{'='*60}")
    print("📊 與完整版 (161特徵) 比較")
    print(f"{'='*60}")
    print(f"   優化版 ({len(available_features)} 特徵): MAE={mae:.2f}, R²={r2*100:.1f}%")
    print(f"   完整版 (161 特徵): MAE=3.44, R²=96.3% (參考)")
    
    if mae < 3.44:
        print(f"\n   🏆 優化版更好！MAE 降低了 {3.44 - mae:.2f}")
    else:
        print(f"\n   ℹ️ 差異很小，優化版特徵數減少 {161 - len(available_features)} 個")

if __name__ == '__main__':
    main()
