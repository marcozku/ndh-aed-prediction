#!/usr/bin/env python3
"""
自動天氣影響分析 - 在數據上傳後自動運行
分析天氣警告與出席人數的關係，更新 weather_impact_analysis.json
"""

import pandas as pd
import json
import os
import sys
from datetime import datetime

def run_weather_analysis():
    """運行天氣影響分析並更新結果"""
    
    print("[INFO] Starting weather impact analysis...", file=sys.stderr)
    
    # 確定腳本目錄
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    # 讀取數據
    csv_path = os.path.join(script_dir, '..', 'NDH_AED_Clean.csv')
    warnings_path = os.path.join(script_dir, 'weather_warnings_history.csv')
    output_path = os.path.join(script_dir, 'models', 'weather_impact_analysis.json')
    
    if not os.path.exists(csv_path):
        print(f"[ERROR] Attendance data not found: {csv_path}", file=sys.stderr)
        return {"error": "Attendance data not found"}
    
    if not os.path.exists(warnings_path):
        print(f"[ERROR] Warnings data not found: {warnings_path}", file=sys.stderr)
        return {"error": "Warnings data not found"}
    
    # 讀取數據
    att_df = pd.read_csv(csv_path)
    warn_df = pd.read_csv(warnings_path)
    
    # 標準化日期格式
    att_df['Date'] = pd.to_datetime(att_df['Date']).dt.strftime('%Y-%m-%d')
    warn_df['Date'] = pd.to_datetime(warn_df['Date']).dt.strftime('%Y-%m-%d')
    
    # 合併數據
    merged = pd.merge(att_df, warn_df, on='Date', how='inner')
    
    if len(merged) == 0:
        print("[ERROR] No matching data after merge", file=sys.stderr)
        return {"error": "No matching data"}
    
    print(f"[OK] Merged data: {len(merged)} days", file=sys.stderr)
    
    # 計算基準（無警告日）
    no_warning = merged[
        (merged['typhoon_signal'] == 0) & 
        (merged['rainstorm_warning'] == 0) & 
        (merged['hot_warning'] == 0) & 
        (merged['cold_warning'] == 0)
    ]
    baseline = no_warning['Attendance'].mean()
    
    print(f"[INFO] Baseline (no warning days): {baseline:.1f} people ({len(no_warning)} days)", file=sys.stderr)
    
    # 分析各類警告
    results = []
    
    def analyze_warning(name, emoji, condition, df, baseline, color):
        filtered = df[condition]
        if len(filtered) > 0:
            mean = filtered['Attendance'].mean()
            impact = ((mean - baseline) / baseline) * 100
            return {
                'factor': name,  # 不包含 emoji，避免編碼問題
                'days': int(len(filtered)),
                'mean': round(mean, 1),
                'impact': round(impact, 1),
                'color': color
            }
        return None
    
    # 八號颱風
    r = analyze_warning('T8+ Typhoon', None, merged['typhoon_signal'] >= 8, merged, baseline, 'typhoon')
    if r: results.append(r)
    
    # 三號颱風
    r = analyze_warning('T3 Typhoon', None, (merged['typhoon_signal'] >= 3) & (merged['typhoon_signal'] < 8), merged, baseline, 'typhoon')
    if r: results.append(r)
    
    # 黑色暴雨
    r = analyze_warning('Black Rainstorm', None, merged['rainstorm_warning'] >= 3, merged, baseline, 'rainstorm')
    if r: results.append(r)
    
    # 紅色暴雨
    r = analyze_warning('Red Rainstorm', None, (merged['rainstorm_warning'] >= 2) & (merged['rainstorm_warning'] < 3), merged, baseline, 'rainstorm')
    if r: results.append(r)
    
    # 黃色暴雨
    r = analyze_warning('Yellow Rain', None, merged['rainstorm_warning'] == 1, merged, baseline, 'rain')
    if r: results.append(r)
    
    # 酷熱警告
    r = analyze_warning('Hot Warning', None, merged['hot_warning'] > 0, merged, baseline, 'hot')
    if r: results.append(r)
    
    # 寒冷警告
    r = analyze_warning('Cold Warning', None, merged['cold_warning'] > 0, merged, baseline, 'cold')
    if r: results.append(r)
    
    # 按影響力排序
    results.sort(key=lambda x: abs(x['impact']), reverse=True)
    
    # 構建輸出
    output = {
        'baseline': {
            'mean': round(baseline, 1),
            'days': int(len(no_warning))
        },
        'total_days': int(len(merged)),
        'data_range': f"{merged['Date'].min()} to {merged['Date'].max()}",
        'analysis_date': datetime.now().strftime('%Y-%m-%d %H:%M HKT'),
        'factors': results
    }
    
    # 保存結果
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    print(f"[OK] Analysis complete, saved to {output_path}", file=sys.stderr)
    
    # 輸出 JSON 結果
    print(json.dumps(output, ensure_ascii=False))
    
    return output


if __name__ == '__main__':
    run_weather_analysis()

