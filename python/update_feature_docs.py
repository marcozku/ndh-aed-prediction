#!/usr/bin/env python3
"""
自動更新特徵文檔
在每次訓練後調用，更新文檔中的精選特徵列表

v3.0.10 - 2026-01-02
"""

import json
import os
import datetime

# 香港時區
try:
    from zoneinfo import ZoneInfo
    HKT = ZoneInfo('Asia/Hong_Kong')
except ImportError:
    import pytz
    HKT = pytz.timezone('Asia/Hong_Kong')


def load_optimal_features():
    """從 optimal_features.json 載入當前精選特徵"""
    path = os.path.join(os.path.dirname(__file__), 'models', 'optimal_features.json')
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return None


def load_xgboost_features():
    """從 xgboost_features.json 載入當前使用的特徵"""
    path = os.path.join(os.path.dirname(__file__), 'models', 'xgboost_features.json')
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return None


def load_xgboost_metrics():
    """從 xgboost_metrics.json 載入模型指標"""
    path = os.path.join(os.path.dirname(__file__), 'models', 'xgboost_metrics.json')
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return None


def categorize_features(features):
    """將特徵分類"""
    categories = {
        '時間特徵': [],
        '滯後特徵': [],
        '滾動統計': [],
        'EWMA 特徵': [],
        '變化特徵': [],
        '位置特徵': [],
        '事件指標': [],
        '天氣特徵': [],
        '其他': []
    }
    
    for f in features:
        if 'EWMA' in f:
            categories['EWMA 特徵'].append(f)
        elif 'Lag' in f:
            categories['滯後特徵'].append(f)
        elif 'Rolling' in f or 'Median' in f or 'Min' in f or 'Max' in f or 'Std' in f:
            categories['滾動統計'].append(f)
        elif 'Position' in f:
            categories['位置特徵'].append(f)
        elif 'Change' in f or 'Diff' in f:
            categories['變化特徵'].append(f)
        elif 'Day_of' in f or 'DayOf' in f or 'Month' in f and 'Change' not in f or 'Week_of' in f:
            categories['時間特徵'].append(f)
        elif 'Weather' in f or 'Temp' in f or 'Typhoon' in f or 'Rain' in f or 'Hot_Warning' in f or 'Cold_Warning' in f:
            categories['天氣特徵'].append(f)
        elif 'Is_' in f or 'Holiday' in f or 'COVID' in f or 'Flu' in f:
            categories['事件指標'].append(f)
        else:
            categories['其他'].append(f)
    
    # 移除空類別
    return {k: v for k, v in categories.items() if v}


def generate_feature_docs():
    """生成特徵文檔"""
    optimal = load_optimal_features()
    features = load_xgboost_features()
    metrics = load_xgboost_metrics()
    
    if not features:
        print("❌ 無法載入特徵列表")
        return None
    
    now = datetime.datetime.now(HKT).strftime('%Y-%m-%d %H:%M HKT')
    
    # 分類特徵
    categorized = categorize_features(features)
    
    # 生成 Markdown
    doc = f"""# XGBoost 精選特徵列表

**自動生成於**: {now}
**特徵數量**: {len(features)} 個
**模型版本**: {optimal.get('version', 'unknown') if optimal else 'unknown'}

## 📊 模型性能

| 指標 | 數值 |
|------|------|
| MAE | {metrics.get('mae', 'N/A'):.2f} 病人 |
| MAPE | {metrics.get('mape', 'N/A'):.2f}% |
| R² | {metrics.get('r2', 'N/A'):.3f} |
| RMSE | {metrics.get('rmse', 'N/A'):.2f} |

## 🎯 精選特徵列表

"""
    
    for category, feats in categorized.items():
        doc += f"### {category} ({len(feats)}個)\n\n"
        for f in feats:
            doc += f"- `{f}`\n"
        doc += "\n"
    
    # 特徵重要性（如果有）
    if optimal and 'feature_importance' in optimal:
        doc += "## 📈 特徵重要性 (Top 10)\n\n"
        doc += "| 排名 | 特徵 | 重要性 |\n"
        doc += "|------|------|--------|\n"
        for i, fi in enumerate(optimal['feature_importance'][:10], 1):
            doc += f"| {i} | `{fi['feature']}` | {fi['importance']:.2%} |\n"
        doc += "\n"
    
    doc += f"""## 📝 備註

- 特徵列表由自動特徵優化系統生成
- 每次訓練後自動更新
- 特徵選擇基於 XGBoost 特徵重要性和交叉驗證
- 新的天氣特徵（颱風、暴雨等）會在重新訓練後被考慮

## 🔄 更新歷史

- {now}: 自動生成
"""
    
    return doc


def update_docs():
    """更新所有相關文檔"""
    doc = generate_feature_docs()
    if not doc:
        return False
    
    # 保存到 CURRENT_FEATURES.md
    output_path = os.path.join(os.path.dirname(__file__), '..', 'CURRENT_FEATURES.md')
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(doc)
    
    print(f"✅ 已更新 CURRENT_FEATURES.md")
    
    # 同時保存到 python/models/feature_docs.json（供 API 使用）
    features = load_xgboost_features()
    optimal = load_optimal_features()
    metrics = load_xgboost_metrics()
    
    feature_docs = {
        'updated': datetime.datetime.now(HKT).strftime('%Y-%m-%d %H:%M HKT'),
        'features': features,
        'feature_count': len(features) if features else 0,
        'categories': categorize_features(features) if features else {},
        'metrics': metrics,
        'optimal_info': {
            'version': optimal.get('version') if optimal else None,
            'method': optimal.get('method') if optimal else None,
            'note': optimal.get('note') if optimal else None
        } if optimal else None
    }
    
    docs_path = os.path.join(os.path.dirname(__file__), 'models', 'feature_docs.json')
    with open(docs_path, 'w', encoding='utf-8') as f:
        json.dump(feature_docs, f, ensure_ascii=False, indent=2)
    
    print(f"✅ 已更新 python/models/feature_docs.json")
    
    return True


if __name__ == '__main__':
    print("🔄 更新特徵文檔...")
    if update_docs():
        print("✅ 特徵文檔更新完成")
    else:
        print("❌ 更新失敗")

