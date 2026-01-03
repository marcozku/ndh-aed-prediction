#!/usr/bin/env python3
"""
Download and process EPD AQHI historical data
Source: https://www.aqhi.gov.hk/en/past-data/past-aqhi.html
"""

import os
import sys
import requests
import pandas as pd
from io import StringIO
from datetime import datetime
import time

# Fix Windows console encoding
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

# AQHI 數據 URL 模板
URL_TEMPLATE = "https://www.aqhi.gov.hk/common/epd/ddata/html/history/{year}/{year}{month:02d}_Eng.csv"

# General Stations (一般監測站)
GENERAL_STATIONS = [
    'Central/Western', 'Southern', 'Eastern', 'Kwun Tong', 'Sham Shui Po',
    'Kwai Chung', 'Tsuen Wan', 'Tseung Kwan O', 'Yuen Long', 'Tuen Mun',
    'Tung Chung', 'Tai Po', 'Sha Tin', 'North', 'Tap Mun'
]

# Roadside Stations (路邊監測站)
ROADSIDE_STATIONS = ['Causeway Bay', 'Central', 'Mong Kok']

def download_month_data(year, month):
    """下載單月 AQHI 數據"""
    url = URL_TEMPLATE.format(year=year, month=month)
    try:
        response = requests.get(url, timeout=30)
        if response.status_code == 200:
            return response.text
        else:
            print(f"  ⚠️ {year}-{month:02d}: HTTP {response.status_code}", file=sys.stderr)
            return None
    except Exception as e:
        print(f"  ❌ {year}-{month:02d}: {e}", file=sys.stderr)
        return None

def parse_csv_content(content, year, month):
    """解析 CSV 內容，提取每日最高 AQHI"""
    lines = content.strip().split('\n')
    
    # 找到標題行（包含 Date,Hour,...）
    header_idx = None
    for i, line in enumerate(lines):
        if line.startswith('Date,Hour,'):
            header_idx = i
            break
    
    if header_idx is None:
        return pd.DataFrame()
    
    # 提取數據部分
    data_lines = [lines[header_idx]]  # 包含標題
    current_date = None
    
    for line in lines[header_idx + 1:]:
        if not line.strip():
            continue
        parts = line.split(',')
        if len(parts) < 3:
            continue
        
        # 如果第一列是日期格式（如 2024-12-01），記錄它
        if parts[0] and '-' in parts[0]:
            current_date = parts[0]
            data_lines.append(line)
        elif parts[0] == '' and current_date:
            # 日期為空，使用當前日期
            if parts[1].strip() not in ['Daily Max', '']:
                data_lines.append(f"{current_date},{','.join(parts[1:])}")
    
    try:
        df = pd.read_csv(StringIO('\n'.join(data_lines)), na_values=['', '*', '-'])
        return df
    except Exception as e:
        print(f"  ❌ 解析錯誤 {year}-{month:02d}: {e}", file=sys.stderr)
        return pd.DataFrame()

def process_to_daily(df):
    """將小時數據處理成每日數據"""
    if df.empty:
        return pd.DataFrame()
    
    # 移除非數字的小時值（如 Daily Max）
    df = df[df['Hour'].apply(lambda x: str(x).isdigit() if pd.notna(x) else False)].copy()
    
    # 確保數據是數字型
    for col in df.columns:
        if col not in ['Date', 'Hour']:
            # 移除星號標記並轉換為數字
            df[col] = pd.to_numeric(df[col].astype(str).str.replace('*', ''), errors='coerce')
    
    # 計算 General Stations 的平均值（每小時所有一般站的平均）
    general_cols = [c for c in GENERAL_STATIONS if c in df.columns]
    roadside_cols = [c for c in ROADSIDE_STATIONS if c in df.columns]
    
    if not general_cols:
        return pd.DataFrame()
    
    # 計算每日統計
    daily_data = []
    for date, group in df.groupby('Date'):
        general_values = group[general_cols].values.flatten()
        general_values = general_values[~pd.isna(general_values)]
        
        roadside_values = group[roadside_cols].values.flatten() if roadside_cols else []
        roadside_values = roadside_values[~pd.isna(roadside_values)] if len(roadside_values) > 0 else []
        
        if len(general_values) > 0:
            daily_data.append({
                'Date': date,
                'AQHI_General_Avg': round(general_values.mean(), 1),
                'AQHI_General_Max': int(general_values.max()),
                'AQHI_Roadside_Avg': round(roadside_values.mean(), 1) if len(roadside_values) > 0 else None,
                'AQHI_Roadside_Max': int(roadside_values.max()) if len(roadside_values) > 0 else None,
            })
    
    return pd.DataFrame(daily_data)

def download_all_history(start_year=2014, start_month=12):
    """Download all historical data"""
    all_data = []
    current_year = datetime.now().year
    current_month = datetime.now().month
    
    print(f"[AQHI] Downloading historical data ({start_year}-{start_month:02d} to {current_year}-{current_month:02d})")
    print("=" * 60)
    
    for year in range(start_year, current_year + 1):
        m_start = start_month if year == start_year else 1
        m_end = current_month if year == current_year else 12
        
        for month in range(m_start, m_end + 1):
            print(f"  Downloading {year}-{month:02d}...", end=' ', flush=True)
            content = download_month_data(year, month)
            
            if content:
                df = parse_csv_content(content, year, month)
                if not df.empty:
                    daily_df = process_to_daily(df)
                    if not daily_df.empty:
                        all_data.append(daily_df)
                        print(f"OK ({len(daily_df)} days)")
                    else:
                        print("WARN: No valid data")
                else:
                    print("WARN: Parse failed")
            else:
                print("FAIL: Download error")
            
            time.sleep(0.3)  # Rate limiting
    
    if all_data:
        combined = pd.concat(all_data, ignore_index=True)
        combined['Date'] = pd.to_datetime(combined['Date'])
        combined = combined.sort_values('Date').drop_duplicates(subset='Date')
        
        # 計算風險等級
        combined['AQHI_Risk'] = combined['AQHI_General_Max'].apply(
            lambda x: 3 if x >= 7 else (2 if x >= 4 else 1)  # 1=Low, 2=Moderate, 3=High
        )
        
        return combined
    
    return pd.DataFrame()

def main():
    """Main function"""
    output_path = os.path.join(os.path.dirname(__file__), 'aqhi_history.csv')
    
    # Download all historical data (from 2014-12 to match our AED data)
    df = download_all_history(start_year=2014, start_month=12)
    
    if not df.empty:
        # Format date
        df['Date'] = df['Date'].dt.strftime('%Y-%m-%d')
        
        # Save
        df.to_csv(output_path, index=False)
        print("=" * 60)
        print(f"[OK] Saved {len(df)} days AQHI data to: {output_path}")
        print(f"     Date range: {df['Date'].iloc[0]} -> {df['Date'].iloc[-1]}")
        print(f"     Columns: {', '.join(df.columns)}")
    else:
        print("[ERROR] No data to save")
        sys.exit(1)

if __name__ == '__main__':
    main()

