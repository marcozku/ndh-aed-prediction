#!/usr/bin/env python3
"""Check date coverage between AQHI and Attendance data"""

import pandas as pd
import os

script_dir = os.path.dirname(__file__)

# AQHI data
aqhi = pd.read_csv(os.path.join(script_dir, 'aqhi_history.csv'))
aqhi['Date'] = pd.to_datetime(aqhi['Date'])
print('=== AQHI Data ===')
print(f'Records: {len(aqhi)}')
print(f'Date range: {aqhi["Date"].min().strftime("%Y-%m-%d")} to {aqhi["Date"].max().strftime("%Y-%m-%d")}')

# Attendance data
att = pd.read_csv(os.path.join(script_dir, '..', 'NDH_AED_Clean.csv'))
att.columns = ['Date', 'Attendance']
att['Date'] = pd.to_datetime(att['Date'])
print()
print('=== Attendance Data ===')
print(f'Records: {len(att)}')
print(f'Date range: {att["Date"].min().strftime("%Y-%m-%d")} to {att["Date"].max().strftime("%Y-%m-%d")}')

# Check overlap
merged = pd.merge(aqhi, att, on='Date', how='inner')
print()
print('=== Overlap ===')
print(f'Matched records: {len(merged)}')
print(f'Date range: {merged["Date"].min().strftime("%Y-%m-%d")} to {merged["Date"].max().strftime("%Y-%m-%d")}')

# Missing dates
att_dates = set(att['Date'].dt.strftime('%Y-%m-%d'))
aqhi_dates = set(aqhi['Date'].dt.strftime('%Y-%m-%d'))
missing_in_aqhi = att_dates - aqhi_dates
missing_in_att = aqhi_dates - att_dates

print()
print('=== Missing Analysis ===')
print(f'Attendance dates NOT in AQHI: {len(missing_in_aqhi)}')
print(f'AQHI dates NOT in Attendance: {len(missing_in_att)}')

if missing_in_aqhi:
    missing_sorted = sorted(list(missing_in_aqhi))
    print(f'  Sample missing: {missing_sorted[:3]} ... {missing_sorted[-3:]}')
    
# Coverage percentage
coverage = len(merged) / len(att) * 100
print()
print(f'=== Coverage: {coverage:.1f}% of attendance data has AQHI ===')

