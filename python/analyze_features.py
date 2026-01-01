"""
特徵分析與選擇腳本
研究特徵數量對模型準確度的影響
"""
import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_absolute_error, r2_score
import json
import os
import sys

# 添加當前目錄到路徑
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_engineering import create_comprehensive_features, get_feature_columns

def load_data():
    """加載數據"""
    csv_path = '../NDH_AED_Clean.csv'
    if os.path.exists(csv_path):
        df = pd.read_csv(csv_path)
        if 'date' in df.columns:
            df['Date'] = df['date']
        if 'patient_count' in df.columns:
            df['Attendance'] = df['patient_count']
        return df[['Date', 'Attendance']]
    return None

def analyze_feature_importance(n_top_features_list=[10, 20, 30, 50, 80, 100, 130, 161]):
    """
    分析不同特徵數量對準確度的影響
    
    這個實驗測試「維度災難」假設：
    - 太少特徵：模型欠擬合
    - 太多特徵：模型過擬合或有噪音特徵
    - 最佳點：準確度和泛化能力的平衡
    """
    print("=" * 70)
    print("🔬 特徵數量 vs 準確度 研究")
    print("=" * 70)
    print("\n📚 理論背景：")
    print("   1. 維度災難 (Curse of Dimensionality)：")
    print("      - 特徵增加時，數據變得稀疏")
    print("      - 需要指數級數據量來維持統計顯著性")
    print("   2. 過擬合風險：")
    print("      - 過多特徵 → 模型記住訓練數據")
    print("      - 表現：訓練集好，測試集差")
    print("   3. 噪音特徵：")
    print("      - 無關特徵會引入噪音")
    print("      - 降低模型泛化能力")
    print()
    
    # 加載數據
    df = load_data()
    if df is None:
        print("❌ 無法加載數據")
        return
    
    print(f"📊 數據量: {len(df)} 筆")
    print(f"📅 日期範圍: {df['Date'].min()} → {df['Date'].max()}")
    
    # 創建特徵
    print("\n⏳ 創建特徵中...")
    df = create_comprehensive_features(df)
    df = df.dropna(subset=['Attendance'])
    
    # 獲取所有特徵列
    all_feature_cols = get_feature_columns()
    all_feature_cols = [col for col in all_feature_cols if col in df.columns]
    print(f"✅ 可用特徵數: {len(all_feature_cols)}")
    
    # 時間序列分割
    split_idx = int(len(df) * 0.8)
    train_data = df[:split_idx].copy()
    test_data = df[split_idx:].copy()
    
    print(f"\n📊 數據分割:")
    print(f"   訓練集: {len(train_data)} 筆")
    print(f"   測試集: {len(test_data)} 筆")
    
    # 首先訓練完整模型獲取特徵重要性
    print("\n🔄 訓練完整模型以獲取特徵重要性...")
    X_train_full = train_data[all_feature_cols]
    y_train = train_data['Attendance']
    X_test_full = test_data[all_feature_cols]
    y_test = test_data['Attendance']
    
    full_model = xgb.XGBRegressor(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.05,
        random_state=42,
        n_jobs=-1
    )
    full_model.fit(X_train_full, y_train, verbose=False)
    
    # 獲取特徵重要性排名
    importance = full_model.feature_importances_
    feature_importance = list(zip(all_feature_cols, importance))
    feature_importance.sort(key=lambda x: x[1], reverse=True)
    
    print("\n📊 Top 20 最重要特徵:")
    for i, (feat, imp) in enumerate(feature_importance[:20]):
        bar = "█" * int(imp / max(importance) * 30)
        print(f"   {i+1:2}. {feat:30} {bar} {imp:.4f}")
    
    # 測試不同特徵數量
    print("\n" + "=" * 70)
    print("🧪 實驗：不同特徵數量的準確度")
    print("=" * 70)
    print(f"\n{'特徵數':>8} | {'MAE':>8} | {'MAPE':>8} | {'R²':>8} | {'調整R²':>8} | 評估")
    print("-" * 70)
    
    results = []
    
    for n_features in n_top_features_list:
        if n_features > len(all_feature_cols):
            n_features = len(all_feature_cols)
        
        # 選擇 top N 特徵
        top_features = [f[0] for f in feature_importance[:n_features]]
        
        X_train = train_data[top_features]
        X_test = test_data[top_features]
        
        # 訓練模型
        model = xgb.XGBRegressor(
            n_estimators=300,
            max_depth=6,
            learning_rate=0.05,
            random_state=42,
            n_jobs=-1
        )
        model.fit(X_train, y_train, verbose=False)
        
        # 評估
        y_pred = model.predict(X_test)
        mae = mean_absolute_error(y_test, y_pred)
        mape = np.mean(np.abs((y_test - y_pred) / y_test)) * 100
        r2 = r2_score(y_test, y_pred)
        
        # 調整 R²
        n = len(y_test)
        p = n_features
        adj_r2 = 1 - (1 - r2) * (n - 1) / (n - p - 1) if n > p + 1 else r2
        
        # 評估
        if mae < 4:
            rating = "🏆 優秀"
        elif mae < 5:
            rating = "✅ 良好"
        elif mae < 6:
            rating = "⚠️ 一般"
        else:
            rating = "❌ 需改進"
        
        results.append({
            'n_features': n_features,
            'mae': mae,
            'mape': mape,
            'r2': r2,
            'adj_r2': adj_r2,
            'features': top_features
        })
        
        print(f"{n_features:>8} | {mae:>8.2f} | {mape:>7.2f}% | {r2*100:>7.1f}% | {adj_r2*100:>7.1f}% | {rating}")
    
    # 找出最佳特徵數量
    print("\n" + "=" * 70)
    print("📊 分析結論")
    print("=" * 70)
    
    # 以 MAE 為主要指標
    best_by_mae = min(results, key=lambda x: x['mae'])
    # 以調整 R² 為指標
    best_by_adj_r2 = max(results, key=lambda x: x['adj_r2'])
    
    print(f"\n🏆 最佳 MAE: {best_by_mae['mae']:.2f} (使用 {best_by_mae['n_features']} 個特徵)")
    print(f"🏆 最佳調整 R²: {best_by_adj_r2['adj_r2']*100:.1f}% (使用 {best_by_adj_r2['n_features']} 個特徵)")
    
    # 建議
    print("\n💡 建議：")
    
    # 比較 161 特徵和最佳點
    full_result = [r for r in results if r['n_features'] >= 130][-1] if any(r['n_features'] >= 130 for r in results) else results[-1]
    
    if best_by_mae['n_features'] < full_result['n_features'] * 0.7:
        print(f"   ⚠️ 使用較少特徵 ({best_by_mae['n_features']}) 反而準確度更高")
        print(f"   ⚠️ 這表明有過多噪音特徵或過擬合")
        print(f"   ✅ 建議使用 {best_by_mae['n_features']} 個特徵")
    else:
        print(f"   ✅ 當前特徵數量合理")
    
    # 保存最佳特徵列表
    print(f"\n📁 保存最佳特徵配置...")
    best_config = {
        'optimal_n_features': best_by_mae['n_features'],
        'optimal_features': best_by_mae['features'],
        'metrics': {
            'mae': best_by_mae['mae'],
            'mape': best_by_mae['mape'],
            'r2': best_by_mae['r2'],
            'adj_r2': best_by_mae['adj_r2']
        },
        'comparison': [
            {'n_features': r['n_features'], 'mae': r['mae'], 'r2': r['r2']} 
            for r in results
        ]
    }
    
    with open('models/optimal_features.json', 'w') as f:
        json.dump(best_config, f, indent=2)
    
    print(f"✅ 已保存到 models/optimal_features.json")
    
    return results

if __name__ == '__main__':
    analyze_feature_importance()
