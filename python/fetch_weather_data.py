"""
香港天文台歷史天氣數據獲取腳本
用於 XGBoost 模型訓練的天氣特徵
"""
import requests
import pandas as pd
import json
import os
from datetime import datetime, timedelta
import sys

# HKO Open Data API
HKO_API_BASE = "https://data.weather.gov.hk/weatherAPI/opendata/opendata.php"

# 天文台站點（北區醫院最近的站點）
STATIONS = {
    'TKL': '打鼓嶺',  # Ta Kwu Ling - 最接近北區醫院
    'HKO': '天文台',  # Hong Kong Observatory - 備用
    'SHA': '沙田',    # Sha Tin - 備用
}

# 可用的天氣數據類型
DATA_TYPES = {
    'CLMTEMP': 'mean_temp',      # 日平均氣溫
    'CLMMAXT': 'max_temp',       # 日最高氣溫
    'CLMMINT': 'min_temp',       # 日最低氣溫
}


def fetch_weather_data(data_type, station='TKL'):
    """從 HKO API 獲取天氣數據"""
    url = f"{HKO_API_BASE}?dataType={data_type}&lang=tc&rformat=json&station={station}"
    
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        data = response.json()
        
        if 'data' not in data:
            print(f"⚠️ {data_type} 無數據")
            return None
            
        return data
    except Exception as e:
        print(f"❌ 獲取 {data_type} 失敗: {e}")
        return None


def process_weather_data(raw_data, column_name):
    """處理原始天氣數據為 DataFrame"""
    if not raw_data or 'data' not in raw_data:
        return None
    
    records = []
    for row in raw_data['data']:
        try:
            year, month, day, value, completeness = row
            if value == '***' or value == 'Trace' or value == '':
                continue
            
            date_str = f"{year}-{month.zfill(2)}-{day.zfill(2)}"
            records.append({
                'Date': date_str,
                column_name: float(value)
            })
        except (ValueError, TypeError):
            continue
    
    if not records:
        return None
    
    df = pd.DataFrame(records)
    df['Date'] = pd.to_datetime(df['Date'])
    return df


def fetch_all_weather_data(start_date=None, end_date=None, station='TKL'):
    """獲取所有天氣數據並合併"""
    print(f"🌤️ 開始獲取 {STATIONS.get(station, station)} 站天氣數據...")
    
    all_dfs = []
    
    for data_type, column_name in DATA_TYPES.items():
        print(f"   📊 獲取 {data_type} ({column_name})...")
        raw_data = fetch_weather_data(data_type, station)
        
        if raw_data:
            df = process_weather_data(raw_data, column_name)
            if df is not None:
                print(f"      ✅ {len(df)} 筆記錄")
                all_dfs.append(df)
            else:
                print(f"      ⚠️ 無有效數據")
        
        # 如果主站失敗，嘗試備用站
        if raw_data is None and station != 'HKO':
            print(f"   🔄 嘗試備用站 HKO...")
            raw_data = fetch_weather_data(data_type, 'HKO')
            if raw_data:
                df = process_weather_data(raw_data, column_name)
                if df is not None:
                    print(f"      ✅ {len(df)} 筆記錄 (HKO)")
                    all_dfs.append(df)
    
    if not all_dfs:
        print("❌ 無法獲取任何天氣數據")
        return None
    
    # 合併所有數據
    print("📊 合併天氣數據...")
    merged_df = all_dfs[0]
    for df in all_dfs[1:]:
        merged_df = merged_df.merge(df, on='Date', how='outer')
    
    # 排序並過濾日期範圍
    merged_df = merged_df.sort_values('Date')
    
    if start_date:
        merged_df = merged_df[merged_df['Date'] >= pd.to_datetime(start_date)]
    if end_date:
        merged_df = merged_df[merged_df['Date'] <= pd.to_datetime(end_date)]
    
    # 計算衍生特徵
    merged_df['temp_range'] = merged_df['max_temp'] - merged_df['min_temp']
    
    # 計算極端天氣標記
    merged_df['is_very_hot'] = (merged_df['max_temp'] >= 33).astype(int)
    merged_df['is_hot'] = (merged_df['max_temp'] >= 30).astype(int)
    merged_df['is_cold'] = (merged_df['min_temp'] <= 12).astype(int)
    merged_df['is_very_cold'] = (merged_df['min_temp'] <= 8).astype(int)
    
    print(f"✅ 天氣數據準備完成: {len(merged_df)} 天")
    print(f"   日期範圍: {merged_df['Date'].min()} 至 {merged_df['Date'].max()}")
    
    return merged_df


def save_weather_data(df, output_path='weather_history.csv'):
    """保存天氣數據到 CSV"""
    df.to_csv(output_path, index=False)
    print(f"💾 天氣數據已保存至 {output_path}")


def load_weather_data(file_path='weather_history.csv'):
    """從 CSV 加載天氣數據"""
    if not os.path.exists(file_path):
        return None
    
    df = pd.read_csv(file_path)
    df['Date'] = pd.to_datetime(df['Date'])
    return df


def update_weather_data(existing_df=None, output_path='weather_history.csv'):
    """更新天氣數據（只獲取新數據）"""
    if existing_df is not None:
        last_date = existing_df['Date'].max()
        start_date = last_date + timedelta(days=1)
        print(f"📅 從 {start_date.strftime('%Y-%m-%d')} 開始更新...")
        
        new_df = fetch_all_weather_data(start_date=start_date.strftime('%Y-%m-%d'))
        
        if new_df is not None and len(new_df) > 0:
            combined_df = pd.concat([existing_df, new_df], ignore_index=True)
            combined_df = combined_df.drop_duplicates(subset=['Date'], keep='last')
            combined_df = combined_df.sort_values('Date')
            save_weather_data(combined_df, output_path)
            return combined_df
        else:
            print("ℹ️ 沒有新數據")
            return existing_df
    else:
        new_df = fetch_all_weather_data()
        if new_df is not None:
            save_weather_data(new_df, output_path)
        return new_df


if __name__ == '__main__':
    # 如果有命令行參數，使用它們
    output_path = sys.argv[1] if len(sys.argv) > 1 else 'weather_history.csv'
    
    # 嘗試加載現有數據
    existing = load_weather_data(output_path)
    
    if existing is not None:
        print(f"📂 找到現有天氣數據: {len(existing)} 筆")
        df = update_weather_data(existing, output_path)
    else:
        print("📂 沒有現有天氣數據，開始完整下載...")
        df = fetch_all_weather_data()
        if df is not None:
            save_weather_data(df, output_path)
    
    if df is not None:
        print("\n📊 天氣數據摘要:")
        print(df.describe())
