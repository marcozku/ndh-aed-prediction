#!/usr/bin/env python3
"""
Download complete historical weather data from HKO Daily Extract
Includes: Pressure, Temperature, Humidity, Cloud, Dew Point
URL format: https://www.hko.gov.hk/en/cis/dailyExtract.htm?y=YYYY&m=M
"""

import pandas as pd
import requests
from bs4 import BeautifulSoup
import os
import sys
import time
from datetime import datetime

def download_month(year, month):
    """Download weather data for a specific month"""
    url = f"https://www.hko.gov.hk/en/cis/dailyExtract.htm?y={year}&m={month}"
    
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Find the data table
        table = soup.find('table', {'class': 'dailyExtract'})
        if not table:
            tables = soup.find_all('table')
            for t in tables:
                if t.find('th') and 'Pressure' in t.get_text():
                    table = t
                    break
        
        if not table:
            return None
        
        # Parse table rows
        rows = table.find_all('tr')
        data = []
        
        for row in rows[2:]:  # Skip header rows
            cells = row.find_all(['td', 'th'])
            if len(cells) >= 7:
                day_text = cells[0].get_text(strip=True)
                if not day_text.isdigit():
                    continue
                    
                day = int(day_text)
                
                def parse_value(cell):
                    text = cell.get_text(strip=True)
                    if text in ['', '-', '***', 'N.A.']:
                        return None
                    if text == 'Trace':
                        return 0.05
                    try:
                        return float(text.replace(',', ''))
                    except:
                        return None
                
                row_data = {
                    'Year': year,
                    'Month': month,
                    'Day': day,
                    'Pressure_hPa': parse_value(cells[1]),
                    'Temp_Max': parse_value(cells[2]),
                    'Temp_Mean': parse_value(cells[3]),
                    'Temp_Min': parse_value(cells[4]),
                    'DewPoint': parse_value(cells[5]),
                    'Humidity_pct': parse_value(cells[6]),
                    'Cloud_pct': parse_value(cells[7]) if len(cells) > 7 else None,
                }
                data.append(row_data)
        
        if data:
            df = pd.DataFrame(data)
            df['Date'] = pd.to_datetime(df[['Year', 'Month', 'Day']])
            return df
        return None
        
    except Exception as e:
        print(f" Error: {e}", file=sys.stderr)
        return None

def main():
    print("=" * 60)
    print("HKO Complete Weather Data Download")
    print("=" * 60)
    
    # Download from 2014-12 (matching our attendance data start)
    start_year = 2014
    start_month = 12
    end_year = datetime.now().year
    end_month = datetime.now().month
    
    all_data = []
    
    year = start_year
    month = start_month
    
    while True:
        print(f"  {year}-{month:02d}... ", end="", flush=True)
        df = download_month(year, month)
        
        if df is not None:
            all_data.append(df)
            print(f"OK ({len(df)} days)")
        else:
            print("No data")
        
        # Rate limiting
        time.sleep(0.5)
        
        # Next month
        month += 1
        if month > 12:
            month = 1
            year += 1
        
        if year > end_year or (year == end_year and month > end_month):
            break
    
    if not all_data:
        print("No data downloaded!")
        return
    
    # Combine all data
    combined = pd.concat(all_data, ignore_index=True)
    combined = combined.sort_values('Date')
    
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
    
    # Show sample
    print("Sample data:")
    print(combined.tail(5).to_string(index=False))

if __name__ == "__main__":
    main()

