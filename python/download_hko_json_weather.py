#!/usr/bin/env python3
"""
Download historical weather data from HKO JSON API
URL format: https://www.hko.gov.hk/cis/individual_day/daily_{YEAR}.xml
Data includes: Pressure, Temperature, Humidity, Cloud, Rainfall, etc.
"""

import pandas as pd
import requests
import json
import os
import sys
from datetime import datetime
import time

# Element codes from HKO
ELEMENT_CODES = {
    'MSLP': 'Pressure_hPa',      # Mean Sea Level Pressure
    'MAX_TEMP': 'Temp_Max',      # Maximum Temperature
    'TEMP': 'Temp_Mean',         # Mean Temperature
    'MIN_TEMP': 'Temp_Min',      # Minimum Temperature
    'RH': 'Humidity_pct',        # Relative Humidity
    'CLD': 'Cloud_pct',          # Amount of Cloud
    'RF': 'Rainfall_mm',         # Total Rainfall
    'DEW_PT': 'DewPoint',        # Dew Point Temperature
    'SUNSHINE': 'Sunshine_hrs',  # Sunshine Duration
    'MEAN_WIND': 'Wind_kmh',     # Mean Wind Speed
    'VIS_HKA': 'Visibility_km',  # Visibility
}

def download_year(year):
    """Download weather data for a specific year"""
    url = f"https://www.hko.gov.hk/cis/individual_day/daily_{year}.xml"
    
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        
        data = json.loads(response.text)
        
        if 'stn' not in data or 'data' not in data['stn']:
            return None
        
        # Parse each element
        elements_data = {}
        for elem in data['stn']['data']:
            code = elem.get('code', '')
            if code in ELEMENT_CODES:
                col_name = ELEMENT_CODES[code]
                day_data = elem.get('dayData', [])
                
                # Parse day/month grid
                for day_row in day_data:
                    if not day_row or len(day_row) < 2:
                        continue
                    
                    day = day_row[0].strip()
                    if not day.isdigit():
                        continue
                    day = int(day)
                    
                    for month_idx, value in enumerate(day_row[1:], 1):
                        if month_idx > 12:
                            break
                        
                        # Parse value
                        value_str = str(value).strip()
                        if value_str in ['', '-', '***', 'N.A.', '---']:
                            continue
                        if value_str == 'Trace':
                            value_float = 0.05
                        else:
                            try:
                                value_float = float(value_str.replace(',', ''))
                            except:
                                continue
                        
                        date_key = f"{year}-{month_idx:02d}-{day:02d}"
                        if date_key not in elements_data:
                            elements_data[date_key] = {'Date': date_key}
                        elements_data[date_key][col_name] = value_float
        
        if not elements_data:
            return None
        
        df = pd.DataFrame(list(elements_data.values()))
        df['Date'] = pd.to_datetime(df['Date'], errors='coerce')
        df = df.dropna(subset=['Date'])
        df = df.sort_values('Date')
        
        return df
        
    except Exception as e:
        print(f" Error: {e}", file=sys.stderr)
        return None

def main():
    print("=" * 60)
    print("HKO JSON Weather Data Download")
    print("=" * 60)
    
    # Download from 2014 to current year
    start_year = 2014
    end_year = datetime.now().year
    
    all_data = []
    
    for year in range(start_year, end_year + 1):
        print(f"  {year}... ", end="", flush=True)
        df = download_year(year)
        
        if df is not None:
            all_data.append(df)
            print(f"OK ({len(df)} days)")
        else:
            print("No data")
        
        time.sleep(0.3)
    
    if not all_data:
        print("No data downloaded!")
        return
    
    # Combine all data
    combined = pd.concat(all_data, ignore_index=True)
    combined = combined.sort_values('Date')
    combined = combined.drop_duplicates(subset=['Date'])
    
    # Save
    output_path = os.path.join(os.path.dirname(__file__), 'weather_full_history.csv')
    combined.to_csv(output_path, index=False)
    
    print()
    print("=" * 60)
    print(f"Saved to: {output_path}")
    print(f"Total records: {len(combined)}")
    print(f"Date range: {combined['Date'].min()} to {combined['Date'].max()}")
    print(f"Columns: {list(combined.columns)}")
    print()
    
    # Stats
    print("Data coverage:")
    for col in combined.columns:
        if col != 'Date':
            count = combined[col].notna().sum()
            pct = count / len(combined) * 100
            print(f"  {col}: {count} ({pct:.1f}%)")

if __name__ == "__main__":
    main()

