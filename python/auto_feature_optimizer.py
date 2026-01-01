"""
自動特徵優化器 v1.0
智能尋找最佳特徵組合，實現最高準確度預測

功能：
1. 多種特徵選擇算法（重要性、RFE、相關性過濾）
2. 自動化測試不同特徵組合
3. 持續學習並記錄最佳配置
4. 與主訓練腳本整合

Usage:
    python auto_feature_optimizer.py              # 運行完整優化
    python auto_feature_optimizer.py --quick      # 快速優化（較少試驗）
    python auto_feature_optimizer.py --update     # 根據歷史記錄更新
"""
import pandas as pd
import numpy as np
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.feature_selection import RFE
import json
import os
import sys
import argparse
from datetime import datetime
import warnings
warnings.filterwarnings('ignore')

# 添加當前目錄到路徑
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feature_engineering import create_comprehensive_features, get_feature_columns

# 香港時區
os.environ['TZ'] = 'Asia/Hong_Kong'

# 優化歷史記錄文件
OPTIMIZATION_HISTORY_FILE = 'models/feature_optimization_history.json'
OPTIMAL_FEATURES_FILE = 'models/optimal_features.json'


def get_hkt_time():
    """獲取香港時間"""
    from datetime import timezone, timedelta
    hkt = timezone(timedelta(hours=8))
    return datetime.now(hkt).strftime('%Y-%m-%d %H:%M:%S HKT')


def load_data():
    """加載數據"""
    csv_paths = ['../NDH_AED_Clean.csv', 'NDH_AED_Clean.csv', '/workspace/NDH_AED_Clean.csv']
    for csv_path in csv_paths:
        if os.path.exists(csv_path):
            df = pd.read_csv(csv_path)
            if 'date' in df.columns:
                df['Date'] = df['date']
            if 'patient_count' in df.columns:
                df['Attendance'] = df['patient_count']
            return df[['Date', 'Attendance']]
    return None


def load_optimization_history():
    """加載優化歷史"""
    if os.path.exists(OPTIMIZATION_HISTORY_FILE):
        with open(OPTIMIZATION_HISTORY_FILE, 'r') as f:
            return json.load(f)
    return {'optimizations': [], 'best_ever': None}


def save_optimization_history(history):
    """保存優化歷史"""
    os.makedirs(os.path.dirname(OPTIMIZATION_HISTORY_FILE), exist_ok=True)
    with open(OPTIMIZATION_HISTORY_FILE, 'w') as f:
        json.dump(history, f, indent=2, ensure_ascii=False)


def calculate_feature_correlations(df, feature_cols, target='Attendance'):
    """計算特徵與目標的相關性"""
    correlations = {}
    for col in feature_cols:
        if col in df.columns:
            corr = df[col].corr(df[target])
            if not np.isnan(corr):
                correlations[col] = abs(corr)
    return correlations


def remove_highly_correlated_features(df, feature_cols, threshold=0.95):
    """移除高度相關的冗餘特徵"""
    X = df[feature_cols].copy()
    
    # 計算相關矩陣
    corr_matrix = X.corr().abs()
    
    # 找出高度相關的特徵對
    upper = corr_matrix.where(np.triu(np.ones(corr_matrix.shape), k=1).astype(bool))
    
    to_drop = set()
    for col in upper.columns:
        high_corr = upper[col][upper[col] > threshold].index.tolist()
        if high_corr:
            # 保留第一個，移除其他
            to_drop.update(high_corr)
    
    remaining = [col for col in feature_cols if col not in to_drop]
    return remaining, list(to_drop)


def feature_importance_selection(X_train, y_train, X_test, y_test, all_features, 
                                  test_sizes=[5, 10, 15, 20, 25, 30, 40, 50, 75, 100]):
    """基於特徵重要性的選擇"""
    print("\n📊 方法 1: 特徵重要性排序選擇")
    print("-" * 50)
    
    # 訓練完整模型獲取重要性
    model = xgb.XGBRegressor(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.05,
        random_state=42,
        n_jobs=-1
    )
    model.fit(X_train[all_features], y_train, verbose=False)
    
    # 排序特徵
    importance = model.feature_importances_
    feature_importance = list(zip(all_features, importance))
    feature_importance.sort(key=lambda x: x[1], reverse=True)
    
    results = []
    best_mae = float('inf')
    best_config = None
    
    for n_features in test_sizes:
        if n_features > len(all_features):
            continue
            
        top_features = [f[0] for f in feature_importance[:n_features]]
        
        # 訓練測試
        m = xgb.XGBRegressor(
            n_estimators=200,
            max_depth=6,
            learning_rate=0.05,
            random_state=42,
            n_jobs=-1
        )
        m.fit(X_train[top_features], y_train, verbose=False)
        y_pred = m.predict(X_test[top_features])
        
        mae = mean_absolute_error(y_test, y_pred)
        mape = np.mean(np.abs((y_test - y_pred) / y_test)) * 100
        r2 = r2_score(y_test, y_pred)
        
        results.append({
            'method': 'importance',
            'n_features': n_features,
            'features': top_features,
            'mae': mae,
            'mape': mape,
            'r2': r2
        })
        
        status = "🏆" if mae < best_mae else "  "
        print(f"   {status} {n_features:3}個特徵: MAE={mae:.2f}, MAPE={mape:.2f}%, R²={r2*100:.1f}%")
        
        if mae < best_mae:
            best_mae = mae
            best_config = results[-1]
    
    return results, best_config, feature_importance


def rfe_selection(X_train, y_train, X_test, y_test, all_features, target_sizes=[15, 20, 25, 30]):
    """遞歸特徵消除選擇"""
    print("\n📊 方法 2: 遞歸特徵消除 (RFE)")
    print("-" * 50)
    
    results = []
    best_mae = float('inf')
    best_config = None
    
    for n_features in target_sizes:
        if n_features > len(all_features):
            continue
            
        print(f"   ⏳ 測試 {n_features} 個特徵 (RFE)...")
        
        # RFE
        base_model = xgb.XGBRegressor(
            n_estimators=100,
            max_depth=4,
            learning_rate=0.1,
            random_state=42,
            n_jobs=-1
        )
        
        rfe = RFE(estimator=base_model, n_features_to_select=n_features, step=5)
        rfe.fit(X_train[all_features], y_train)
        
        selected_features = [f for f, s in zip(all_features, rfe.support_) if s]
        
        # 訓練測試
        m = xgb.XGBRegressor(
            n_estimators=200,
            max_depth=6,
            learning_rate=0.05,
            random_state=42,
            n_jobs=-1
        )
        m.fit(X_train[selected_features], y_train, verbose=False)
        y_pred = m.predict(X_test[selected_features])
        
        mae = mean_absolute_error(y_test, y_pred)
        mape = np.mean(np.abs((y_test - y_pred) / y_test)) * 100
        r2 = r2_score(y_test, y_pred)
        
        results.append({
            'method': 'rfe',
            'n_features': n_features,
            'features': selected_features,
            'mae': mae,
            'mape': mape,
            'r2': r2
        })
        
        status = "🏆" if mae < best_mae else "  "
        print(f"   {status} {n_features:3}個特徵: MAE={mae:.2f}, MAPE={mape:.2f}%, R²={r2*100:.1f}%")
        
        if mae < best_mae:
            best_mae = mae
            best_config = results[-1]
    
    return results, best_config


def correlation_based_selection(X_train, y_train, X_test, y_test, all_features, df_train,
                                 target_counts=[15, 20, 25, 30, 40]):
    """基於相關性的特徵選擇"""
    print("\n📊 方法 3: 相關性選擇 + 去冗餘")
    print("-" * 50)
    
    # 計算與目標的相關性
    correlations = {}
    for col in all_features:
        corr = df_train[col].corr(df_train['Attendance'])
        if not np.isnan(corr):
            correlations[col] = abs(corr)
    
    # 排序
    sorted_features = sorted(correlations.items(), key=lambda x: x[1], reverse=True)
    
    results = []
    best_mae = float('inf')
    best_config = None
    
    for n_features in target_counts:
        if n_features > len(sorted_features):
            continue
            
        # 選擇 top 相關特徵
        selected = [f[0] for f in sorted_features[:n_features]]
        
        # 去除高度相關特徵
        remaining, dropped = remove_highly_correlated_features(
            df_train, selected, threshold=0.95
        )
        
        if len(remaining) < 5:
            remaining = selected[:max(5, n_features//2)]
        
        # 訓練測試
        m = xgb.XGBRegressor(
            n_estimators=200,
            max_depth=6,
            learning_rate=0.05,
            random_state=42,
            n_jobs=-1
        )
        m.fit(X_train[remaining], y_train, verbose=False)
        y_pred = m.predict(X_test[remaining])
        
        mae = mean_absolute_error(y_test, y_pred)
        mape = np.mean(np.abs((y_test - y_pred) / y_test)) * 100
        r2 = r2_score(y_test, y_pred)
        
        results.append({
            'method': 'correlation',
            'n_features': len(remaining),
            'features': remaining,
            'mae': mae,
            'mape': mape,
            'r2': r2
        })
        
        status = "🏆" if mae < best_mae else "  "
        print(f"   {status} {len(remaining):3}個特徵: MAE={mae:.2f}, MAPE={mape:.2f}%, R²={r2*100:.1f}%")
        
        if mae < best_mae:
            best_mae = mae
            best_config = results[-1]
    
    return results, best_config


def hybrid_selection(X_train, y_train, X_test, y_test, all_features, df_train, feature_importance):
    """混合選擇策略：結合多種方法的優勢"""
    print("\n📊 方法 4: 混合智能選擇")
    print("-" * 50)
    
    # 1. 從重要性排序取 top 特徵
    imp_sorted = [f[0] for f in feature_importance]
    
    # 2. 從相關性取 top 特徵
    correlations = {}
    for col in all_features:
        corr = df_train[col].corr(df_train['Attendance'])
        if not np.isnan(corr):
            correlations[col] = abs(corr)
    corr_sorted = sorted(correlations.items(), key=lambda x: x[1], reverse=True)
    corr_sorted = [f[0] for f in corr_sorted]
    
    results = []
    best_mae = float('inf')
    best_config = None
    
    # 測試不同的混合策略
    strategies = [
        ('importance_top20', imp_sorted[:20]),
        ('importance_top25', imp_sorted[:25]),
        ('importance_top30', imp_sorted[:30]),
        ('corr_top20', corr_sorted[:20]),
        ('corr_top25', corr_sorted[:25]),
        ('hybrid_15+10', list(set(imp_sorted[:15] + corr_sorted[:10]))),
        ('hybrid_20+10', list(set(imp_sorted[:20] + corr_sorted[:10]))),
        ('hybrid_15+15', list(set(imp_sorted[:15] + corr_sorted[:15]))),
    ]
    
    for name, selected in strategies:
        # 確保特徵存在
        selected = [f for f in selected if f in X_train.columns]
        
        if len(selected) < 5:
            continue
        
        # 訓練測試
        m = xgb.XGBRegressor(
            n_estimators=200,
            max_depth=6,
            learning_rate=0.05,
            random_state=42,
            n_jobs=-1
        )
        m.fit(X_train[selected], y_train, verbose=False)
        y_pred = m.predict(X_test[selected])
        
        mae = mean_absolute_error(y_test, y_pred)
        mape = np.mean(np.abs((y_test - y_pred) / y_test)) * 100
        r2 = r2_score(y_test, y_pred)
        
        results.append({
            'method': f'hybrid_{name}',
            'n_features': len(selected),
            'features': selected,
            'mae': mae,
            'mape': mape,
            'r2': r2
        })
        
        status = "🏆" if mae < best_mae else "  "
        print(f"   {status} {name:20}: {len(selected):2}個特徵, MAE={mae:.2f}, MAPE={mape:.2f}%, R²={r2*100:.1f}%")
        
        if mae < best_mae:
            best_mae = mae
            best_config = results[-1]
    
    return results, best_config


def run_optimization(quick=False):
    """運行完整優化流程"""
    print("=" * 70)
    print("🔬 自動特徵優化器 v1.0")
    print("=" * 70)
    print(f"⏰ 開始時間: {get_hkt_time()}")
    print(f"📊 模式: {'快速' if quick else '完整'}")
    
    # 加載數據
    print("\n📥 加載數據...")
    df = load_data()
    if df is None:
        print("❌ 無法加載數據")
        return None
    
    print(f"   數據量: {len(df)} 筆")
    
    # 創建特徵
    print("\n🔧 創建特徵...")
    df = create_comprehensive_features(df)
    df = df.dropna(subset=['Attendance'])
    
    # 獲取所有特徵列
    all_features = get_feature_columns()
    all_features = [col for col in all_features if col in df.columns]
    print(f"   可用特徵: {len(all_features)} 個")
    
    # 時間序列分割
    split_idx = int(len(df) * 0.8)
    train_data = df[:split_idx].copy()
    test_data = df[split_idx:].copy()
    
    X_train = train_data[all_features]
    y_train = train_data['Attendance']
    X_test = test_data[all_features]
    y_test = test_data['Attendance']
    
    print(f"   訓練集: {len(train_data)} 筆")
    print(f"   測試集: {len(test_data)} 筆")
    
    # 運行各種選擇方法
    all_results = []
    
    # 1. 特徵重要性選擇
    if quick:
        test_sizes = [10, 20, 25, 30, 50]
    else:
        test_sizes = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 130, 160]
    
    imp_results, imp_best, feature_importance = feature_importance_selection(
        X_train, y_train, X_test, y_test, all_features, test_sizes
    )
    all_results.extend(imp_results)
    
    # 2. RFE 選擇
    if quick:
        rfe_sizes = [20, 25]
    else:
        rfe_sizes = [15, 20, 25, 30, 40]
    
    rfe_results, rfe_best = rfe_selection(
        X_train, y_train, X_test, y_test, all_features, rfe_sizes
    )
    all_results.extend(rfe_results)
    
    # 3. 相關性選擇
    if quick:
        corr_sizes = [20, 25, 30]
    else:
        corr_sizes = [15, 20, 25, 30, 40, 50]
    
    corr_results, corr_best = correlation_based_selection(
        X_train, y_train, X_test, y_test, all_features, train_data, corr_sizes
    )
    all_results.extend(corr_results)
    
    # 4. 混合選擇
    hybrid_results, hybrid_best = hybrid_selection(
        X_train, y_train, X_test, y_test, all_features, train_data, feature_importance
    )
    all_results.extend(hybrid_results)
    
    # 找出全局最佳
    print("\n" + "=" * 70)
    print("🏆 優化結果總結")
    print("=" * 70)
    
    best_overall = min(all_results, key=lambda x: x['mae'])
    
    print(f"\n🥇 最佳配置:")
    print(f"   方法: {best_overall['method']}")
    print(f"   特徵數: {best_overall['n_features']}")
    print(f"   MAE: {best_overall['mae']:.2f}")
    print(f"   MAPE: {best_overall['mape']:.2f}%")
    print(f"   R²: {best_overall['r2']*100:.1f}%")
    
    print(f"\n📋 最佳特徵列表 ({best_overall['n_features']} 個):")
    for i, feat in enumerate(best_overall['features'][:10]):
        print(f"   {i+1:2}. {feat}")
    if len(best_overall['features']) > 10:
        print(f"   ... 還有 {len(best_overall['features'])-10} 個特徵")
    
    # 保存結果
    history = load_optimization_history()
    
    optimization_record = {
        'timestamp': get_hkt_time(),
        'mode': 'quick' if quick else 'full',
        'total_features_tested': len(all_features),
        'best_method': best_overall['method'],
        'best_n_features': best_overall['n_features'],
        'best_mae': best_overall['mae'],
        'best_mape': best_overall['mape'],
        'best_r2': best_overall['r2'],
        'best_features': best_overall['features'],
        'all_results_summary': [
            {
                'method': r['method'],
                'n_features': r['n_features'],
                'mae': r['mae'],
                'r2': r['r2']
            }
            for r in sorted(all_results, key=lambda x: x['mae'])[:10]
        ]
    }
    
    history['optimizations'].append(optimization_record)
    
    # 更新歷史最佳
    if history['best_ever'] is None or best_overall['mae'] < history['best_ever']['mae']:
        history['best_ever'] = {
            'timestamp': get_hkt_time(),
            'mae': best_overall['mae'],
            'mape': best_overall['mape'],
            'r2': best_overall['r2'],
            'n_features': best_overall['n_features'],
            'method': best_overall['method'],
            'features': best_overall['features']
        }
        print(f"\n🎉 新的歷史最佳記錄！")
    else:
        print(f"\n📊 歷史最佳: MAE={history['best_ever']['mae']:.2f} ({history['best_ever']['timestamp']})")
    
    save_optimization_history(history)
    
    # 保存最佳特徵配置
    optimal_config = {
        'version': '2.9.52',
        'updated': get_hkt_time(),
        'optimal_n_features': best_overall['n_features'],
        'optimal_features': best_overall['features'],
        'method': best_overall['method'],
        'metrics': {
            'mae': best_overall['mae'],
            'mape': best_overall['mape'],
            'r2': best_overall['r2']
        },
        'feature_importance': [
            {'feature': f, 'importance': float(i)} 
            for f, i in feature_importance[:50]
        ]
    }
    
    with open(OPTIMAL_FEATURES_FILE, 'w') as f:
        json.dump(optimal_config, f, indent=2, ensure_ascii=False)
    
    print(f"\n✅ 結果已保存到:")
    print(f"   - {OPTIMIZATION_HISTORY_FILE}")
    print(f"   - {OPTIMAL_FEATURES_FILE}")
    print(f"\n⏰ 完成時間: {get_hkt_time()}")
    
    return best_overall


def main():
    parser = argparse.ArgumentParser(description='自動特徵優化器')
    parser.add_argument('--quick', action='store_true', help='快速優化模式')
    parser.add_argument('--update', action='store_true', help='查看歷史並更新')
    args = parser.parse_args()
    
    if args.update:
        history = load_optimization_history()
        if history['best_ever']:
            print("📊 歷史最佳配置:")
            print(f"   時間: {history['best_ever']['timestamp']}")
            print(f"   MAE: {history['best_ever']['mae']:.2f}")
            print(f"   方法: {history['best_ever']['method']}")
            print(f"   特徵數: {history['best_ever']['n_features']}")
        print(f"\n📈 優化次數: {len(history['optimizations'])}")
        if history['optimizations']:
            print("\n最近 5 次優化:")
            for opt in history['optimizations'][-5:]:
                print(f"   {opt['timestamp']}: MAE={opt['best_mae']:.2f} ({opt['best_method']})")
    else:
        run_optimization(quick=args.quick)


if __name__ == '__main__':
    main()
