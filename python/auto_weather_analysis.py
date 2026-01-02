#!/usr/bin/env python3
"""
自動天氣影響分析 - 在數據上傳後自動運行
分析天氣警告與出席人數的關係，更新 weather_impact_analysis.json
v3.0.61: 從數據庫讀取完整 4050 天數據
"""

import pandas as pd
import json
import os
import sys
from datetime import datetime

def get_attendance_from_db():
    """從數據庫獲取出席數據"""
    try:
        import psycopg2
        
        # 從環境變量獲取數據庫連接
        database_url = os.environ.get('DATABASE_URL')
        if not database_url:
            return None
        
        conn = psycopg2.connect(database_url)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT date, patient_count 
            FROM actual_data 
            WHERE patient_count IS NOT NULL
            ORDER BY date
        """)
        
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
        
        if rows:
            df = pd.DataFrame(rows, columns=['Date', 'Attendance'])
            df['Date'] = pd.to_datetime(df['Date']).dt.strftime('%Y-%m-%d')
            return df
        return None
    except Exception as e:
        print(f"[WARN] Database connection failed: {e}", file=sys.stderr)
        return None


def run_weather_analysis():
    """運行天氣影響分析並更新結果"""
    
    print("[INFO] Starting weather impact analysis...", file=sys.stderr)
    
    # 確定腳本目錄
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    # 嘗試從數據庫獲取數據
    att_df = get_attendance_from_db()
    
    # 如果數據庫不可用，回退到 CSV
    if att_df is None:
        csv_path = os.path.join(script_dir, '..', 'NDH_AED_Clean.csv')
        if not os.path.exists(csv_path):
            print(f"[ERROR] Attendance data not found: {csv_path}", file=sys.stderr)
            return {"error": "Attendance data not found"}
        att_df = pd.read_csv(csv_path)
        att_df['Date'] = pd.to_datetime(att_df['Date']).dt.strftime('%Y-%m-%d')
        print(f"[INFO] Using CSV fallback: {len(att_df)} days", file=sys.stderr)
    else:
        print(f"[INFO] Database data loaded: {len(att_df)} days", file=sys.stderr)
    
    # 讀取天氣警告數據
    warnings_path = os.path.join(script_dir, 'weather_warnings_history.csv')
    if not os.path.exists(warnings_path):
        print(f"[ERROR] Warnings data not found: {warnings_path}", file=sys.stderr)
        return {"error": "Warnings data not found"}
    
    warn_df = pd.read_csv(warnings_path)
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
    
    def analyze_warning(name, condition, df, baseline, color):
        filtered = df[condition]
        if len(filtered) > 0:
            mean = filtered['Attendance'].mean()
            impact = ((mean - baseline) / baseline) * 100
            return {
                'factor': name,
                'days': int(len(filtered)),
                'mean': round(mean, 1),
                'impact': round(impact, 1),
                'color': color
            }
        return None
    
    # 八號颱風
    r = analyze_warning('T8+ Typhoon', merged['typhoon_signal'] >= 8, merged, baseline, 'typhoon')
    if r: results.append(r)
    
    # 三號颱風
    r = analyze_warning('T3 Typhoon', (merged['typhoon_signal'] >= 3) & (merged['typhoon_signal'] < 8), merged, baseline, 'typhoon')
    if r: results.append(r)
    
    # 黑色暴雨
    r = analyze_warning('Black Rainstorm', merged['rainstorm_warning'] >= 3, merged, baseline, 'rainstorm')
    if r: results.append(r)
    
    # 紅色暴雨
    r = analyze_warning('Red Rainstorm', (merged['rainstorm_warning'] >= 2) & (merged['rainstorm_warning'] < 3), merged, baseline, 'rainstorm')
    if r: results.append(r)
    
    # 黃色暴雨
    r = analyze_warning('Yellow Rain', merged['rainstorm_warning'] == 1, merged, baseline, 'rain')
    if r: results.append(r)
    
    # 酷熱警告
    r = analyze_warning('Hot Warning', merged['hot_warning'] > 0, merged, baseline, 'hot')
    if r: results.append(r)
    
    # 寒冷警告
    r = analyze_warning('Cold Warning', merged['cold_warning'] > 0, merged, baseline, 'cold')
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
        'factors': results,
        'source': 'database' if att_df is not None else 'csv'
    }
    
    # 保存結果
    output_path = os.path.join(script_dir, 'models', 'weather_impact_analysis.json')
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    print(f"[OK] Analysis complete, saved to {output_path}", file=sys.stderr)
    
    # 輸出 JSON 結果
    print(json.dumps(output, ensure_ascii=False))
    
    return output


if __name__ == '__main__':
    run_weather_analysis()
