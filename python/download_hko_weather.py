#!/usr/bin/env python3
"""
Download historical weather data from HKO
Downloads: Pressure, Humidity, Rainfall, Cloud, Wind Speed
"""

import pandas as pd
import requests
import os
import sys
from datetime import datetime

# HKO data URLs - daily data CSV format
# Format: https://www.hko.gov.hk/cis/dailyExtract/dailyExtract_{ELEMENT}_{STATION}.csv
# Station: HKO = Hong Kong Observatory

HKO_BASE_URL = "https://www.hko.gov.hk/cis/dailyExtract"

ELEMENTS = {
    'pressure': {
        'url': f'{HKO_BASE_URL}/dailyExtract_PRESSURE_HKO.csv',
        'columns': ['Year', 'Month', 'Day', 'Value'],
        'output_col': 'Pressure_hPa'
    },
    'humidity': {
        'url': f'{HKO_BASE_URL}/dailyExtract_RH_HKO.csv',
        'columns': ['Year', 'Month', 'Day', 'Value'],
        'output_col': 'Humidity_pct'
    },
    'rainfall': {
        'url': f'{HKO_BASE_URL}/dailyExtract_RAIN_HKO.csv',
        'columns': ['Year', 'Month', 'Day', 'Value'],
        'output_col': 'Rainfall_mm'
    },
    'cloud': {
        'url': f'{HKO_BASE_URL}/dailyExtract_CLD_HKO.csv',
        'columns': ['Year', 'Month', 'Day', 'Value'],
        'output_col': 'Cloud_pct'
    }
}

def download_element(element_name, element_config):
    """Download a single weather element from HKO"""
    url = element_config['url']
    print(f"  Downloading {element_name}...", end=" ")
    
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        
        # Parse CSV - HKO format has header rows to skip
        from io import StringIO
        content = response.text
        
        # Find the data start (usually after header lines)
        lines = content.split('\n')
        data_start = 0
        for i, line in enumerate(lines):
            if line.startswith('Year') or (len(line) > 0 and line[0].isdigit()):
                data_start = i
                break
        
        # Read CSV from data start
        df = pd.read_csv(StringIO('\n'.join(lines[data_start:])), 
                        names=['Year', 'Month', 'Day', 'Value'],
                        skipinitialspace=True)
        
        # Clean data
        df = df.dropna(subset=['Year', 'Month', 'Day'])
        df['Year'] = pd.to_numeric(df['Year'], errors='coerce')
        df['Month'] = pd.to_numeric(df['Month'], errors='coerce')
        df['Day'] = pd.to_numeric(df['Day'], errors='coerce')
        df = df.dropna(subset=['Year', 'Month', 'Day'])
        
        # Create date column
        df['Date'] = pd.to_datetime(df[['Year', 'Month', 'Day']].astype(int), errors='coerce')
        df = df.dropna(subset=['Date'])
        
        # Clean value column
        df['Value'] = pd.to_numeric(df['Value'].astype(str).str.replace('Trace', '0.05').str.replace('***', ''), errors='coerce')
        
        # Rename value column
        df = df.rename(columns={'Value': element_config['output_col']})
        df = df[['Date', element_config['output_col']]]
        
        print(f"OK ({len(df)} records, {df['Date'].min().strftime('%Y')} - {df['Date'].max().strftime('%Y')})")
        return df
        
    except Exception as e:
        print(f"FAILED: {e}")
        return None

def main():
    print("=" * 60)
    print("HKO Weather Data Download")
    print("=" * 60)
    
    all_data = []
    
    for element_name, element_config in ELEMENTS.items():
        df = download_element(element_name, element_config)
        if df is not None:
            all_data.append(df)
    
    if not all_data:
        print("No data downloaded!")
        return
    
    # Merge all data on Date
    print("\nMerging data...")
    merged = all_data[0]
    for df in all_data[1:]:
        merged = pd.merge(merged, df, on='Date', how='outer')
    
    merged = merged.sort_values('Date')
    
    # Load existing weather history
    existing_path = os.path.join(os.path.dirname(__file__), 'weather_history.csv')
    if os.path.exists(existing_path):
        existing = pd.read_csv(existing_path)
        existing['Date'] = pd.to_datetime(existing['Date'])
        print(f"Existing weather_history.csv: {len(existing)} records")
        
        # Merge with existing (add new columns)
        for col in merged.columns:
            if col != 'Date' and col not in existing.columns:
                # Merge this column
                existing = pd.merge(existing, merged[['Date', col]], on='Date', how='left')
                print(f"  Added column: {col}")
        
        merged = existing
    
    # Save
    output_path = os.path.join(os.path.dirname(__file__), 'weather_history.csv')
    merged.to_csv(output_path, index=False)
    
    print(f"\nSaved to: {output_path}")
    print(f"Total records: {len(merged)}")
    print(f"Date range: {merged['Date'].min()} to {merged['Date'].max()}")
    print(f"Columns: {list(merged.columns)}")

if __name__ == "__main__":
    main()

