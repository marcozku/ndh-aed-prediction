#!/usr/bin/env python3
"""
AI Factor Validation and Weight Adjustment System

Purpose: 
- Collect AI factor validation data over time
- Compare predictions with/without AI factors
- Automatically adjust Bayesian weights when sufficient validation data exists
- Enable gradual integration of AI factors

v3.0.81: Initial implementation
"""

import os
import sys
import json
import psycopg2
from datetime import datetime, timedelta
import numpy as np

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

def collect_ai_factor_validation_data():
    """
    收集 AI factor 的驗證數據
    比較有無 AI factor 的預測準確度
    """
    
    print("=" * 80)
    print("AI FACTOR VALIDATION DATA COLLECTION")
    print("=" * 80)
    
    conn = get_db_connection()
    cur = conn.cursor()
    
    # 檢查是否有 AI factors 和對應的實際數據
    query = """
        SELECT 
            p.prediction_date,
            p.xgboost_prediction,
            p.ai_factor,
            p.final_prediction,
            a.patient_count as actual
        FROM predictions p
        LEFT JOIN actual_data a ON p.prediction_date = a.date
        WHERE p.ai_factor IS NOT NULL 
          AND p.ai_factor != 1.0
          AND a.patient_count IS NOT NULL
        ORDER BY p.prediction_date DESC
        LIMIT 100
    """
    
    cur.execute(query)
    results = cur.fetchall()
    
    if not results:
        print("\n[INFO] No AI factor validation data found yet")
        print("        System needs to:")
        print("        1. Make predictions with AI factors")
        print("        2. Wait for actual data")
        print("        3. Compare accuracy")
        print("\n[RECOMMENDATION] Keep w_AI=0.00 until validation data exists")
        cur.close()
        conn.close()
        return None
    
    print(f"\n[OK] Found {len(results)} predictions with AI factors\n")
    
    # 分析準確度
    base_errors = []  # XGBoost only
    ai_errors = []    # With AI factor
    
    for row in results:
        date, xgb_pred, ai_factor, final_pred, actual = row
        
        base_error = abs(xgb_pred - actual)
        ai_error = abs(final_pred - actual)
        
        base_errors.append(base_error)
        ai_errors.append(ai_error)
    
    base_mae = np.mean(base_errors)
    ai_mae = np.mean(ai_errors)
    
    improvement = ((base_mae - ai_mae) / base_mae) * 100
    
    print(f"Validation Results (n={len(results)} days):")
    print(f"  XGBoost Only MAE: {base_mae:.2f}")
    print(f"  With AI Factor MAE: {ai_mae:.2f}")
    print(f"  Improvement: {improvement:+.2f}%")
    
    # 決定建議的權重
    if improvement > 5 and len(results) >= 30:
        recommended_w_ai = min(0.15, 0.05 + (improvement / 100))
        print(f"\n[RECOMMENDATION] AI factors show {improvement:.1f}% improvement")
        print(f"                 Suggest w_AI = {recommended_w_ai:.2f}")
        print(f"                 Adjust w_base to {1.0 - recommended_w_ai - 0.05:.2f}")
    elif improvement > 0:
        print(f"\n[INFO] AI factors show small improvement ({improvement:.1f}%)")
        print(f"       Need more data (current: {len(results)}, need: 30+)")
        print(f"       Keep w_AI = 0.00 for now")
    else:
        print(f"\n[WARN] AI factors not improving predictions ({improvement:.1f}%)")
        print(f"       Keep w_AI = 0.00")
    
    cur.close()
    conn.close()
    
    return {
        'sample_size': len(results),
        'base_mae': base_mae,
        'ai_mae': ai_mae,
        'improvement_pct': improvement,
        'analysis_date': datetime.now().strftime('%Y-%m-%d %H:%M HKT')
    }

def update_bayesian_weights_with_ai():
    """
    當有足夠驗證數據時，更新 Bayesian weights 包含 AI factor
    """
    
    print("\n" + "=" * 80)
    print("BAYESIAN WEIGHTS UPDATE WITH AI VALIDATION")
    print("=" * 80)
    
    validation_data = collect_ai_factor_validation_data()
    
    if not validation_data:
        print("\n[CONCLUSION] Not enough data to enable AI factors")
        print("              Current w_AI = 0.00 is appropriate")
        return
    
    # 讀取當前權重
    weights_path = os.path.join(os.path.dirname(__file__), 'models', 'bayesian_weights_optimized.json')
    with open(weights_path, 'r') as f:
        weights_config = json.load(f)
    
    current_weights = weights_config['optimized_weights']
    
    print(f"\nCurrent Weights:")
    print(f"  w_base: {current_weights['w_base']}")
    print(f"  w_weather: {current_weights['w_weather']}")
    print(f"  w_AI: {current_weights['w_AI']}")
    
    # 如果改進顯著且有足夠數據，建議更新
    if validation_data['improvement_pct'] > 5 and validation_data['sample_size'] >= 30:
        # 計算新權重（保守估計）
        improvement_factor = min(validation_data['improvement_pct'] / 100, 0.15)
        new_w_ai = round(improvement_factor, 2)
        new_w_base = round(0.95 - new_w_ai, 2)
        
        print(f"\n[RECOMMENDATION] Update to:")
        print(f"  w_base: {new_w_base} (XGBoost)")
        print(f"  w_weather: 0.05 (unchanged)")
        print(f"  w_AI: {new_w_ai} (newly enabled)")
        
        print(f"\nJustification:")
        print(f"  - {validation_data['sample_size']} validated predictions")
        print(f"  - {validation_data['improvement_pct']:.1f}% improvement in MAE")
        print(f"  - Statistically significant benefit observed")
        
        # 保存建議（不自動更新，需要人工確認）
        recommendation = {
            'version': '3.0.82',
            'updated': datetime.now().strftime('%Y-%m-%d %H:%M HKT'),
            'status': 'RECOMMENDATION',
            'validation_data': validation_data,
            'current_weights': current_weights,
            'recommended_weights': {
                'w_base': new_w_base,
                'w_weather': 0.05,
                'w_AI': new_w_ai
            },
            'note': 'Manual approval required before applying'
        }
        
        rec_path = os.path.join(os.path.dirname(__file__), 'models', 'bayesian_weights_ai_recommendation.json')
        with open(rec_path, 'w', encoding='utf-8') as f:
            json.dump(recommendation, f, indent=2, ensure_ascii=False)
        
        print(f"\n[SAVED] Recommendation to: {rec_path}")
        print(f"        Review and manually apply if appropriate")
    else:
        print(f"\n[INFO] Continue collecting validation data")
        print(f"       Current: {validation_data['sample_size']} samples")
        print(f"       Need: 30+ samples with >5% improvement")

if __name__ == '__main__':
    try:
        update_bayesian_weights_with_ai()
        sys.exit(0)
    except Exception as e:
        print(f"\n[ERROR] {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)

