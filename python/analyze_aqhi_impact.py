#!/usr/bin/env python3
"""
AQHI vs Attendance Impact Analysis
分析 AQHI 空氣質素指數對急症室求診量的影響
"""

import pandas as pd
import numpy as np
import os
import sys

def main():
    print("=" * 60)
    print("AQHI vs Attendance Impact Analysis")
    print("=" * 60)
    
    # Load AQHI data
    aqhi_path = os.path.join(os.path.dirname(__file__), 'aqhi_history.csv')
    if not os.path.exists(aqhi_path):
        print("ERROR: aqhi_history.csv not found")
        return
    
    aqhi = pd.read_csv(aqhi_path)
    aqhi['Date'] = pd.to_datetime(aqhi['Date'])
    print(f"Loaded AQHI data: {len(aqhi)} days")
    
    # Load attendance data from database export
    attendance_paths = [
        '../ndh_attendance_extracted.csv',
        'actual_attendance.csv',
        '../actual_attendance.csv',
        '../data/actual_attendance.csv',
    ]
    
    attendance = None
    for path in attendance_paths:
        full_path = os.path.join(os.path.dirname(__file__), path)
        if os.path.exists(full_path):
            attendance = pd.read_csv(full_path)
            print(f"Loaded attendance from: {path}")
            break
    
    if attendance is None:
        # Try to fetch from API
        print("Attendance file not found, please export from database")
        return
    
    # Handle different column names
    if 'date' in attendance.columns:
        attendance = attendance.rename(columns={'date': 'Date', 'attendance': 'Attendance'})
    attendance['Date'] = pd.to_datetime(attendance['Date'])
    
    # Merge
    merged = pd.merge(aqhi, attendance, on='Date', how='inner')
    print(f"\nMatched days: {len(merged)}")
    print(f"Date range: {merged['Date'].min().strftime('%Y-%m-%d')} to {merged['Date'].max().strftime('%Y-%m-%d')}")
    
    # Correlation analysis
    print("\n" + "=" * 60)
    print("Correlation Analysis")
    print("=" * 60)
    
    corr_gen = merged['AQHI_General_Max'].corr(merged['Attendance'])
    corr_road = merged['AQHI_Roadside_Max'].corr(merged['Attendance'])
    corr_risk = merged['AQHI_Risk'].corr(merged['Attendance'])
    
    print(f"AQHI_General_Max vs Attendance:  r = {corr_gen:+.4f}")
    print(f"AQHI_Roadside_Max vs Attendance: r = {corr_road:+.4f}")
    print(f"AQHI_Risk vs Attendance:         r = {corr_risk:+.4f}")
    
    # Group by risk level
    print("\n" + "=" * 60)
    print("By AQHI Risk Level")
    print("=" * 60)
    
    risk_labels = {
        1: 'Low (1-3)',
        2: 'Moderate (4-6)',
        3: 'High (7)',
        4: 'Very High (8-10)',
        5: 'Serious (10+)'
    }
    
    risk_groups = merged.groupby('AQHI_Risk')['Attendance'].agg(['mean', 'std', 'count'])
    baseline = merged['Attendance'].mean()
    
    for risk, row in risk_groups.iterrows():
        label = risk_labels.get(risk, f'Level {risk}')
        diff_pct = ((row['mean'] - baseline) / baseline) * 100
        print(f"  {label:20s}: Mean {row['mean']:6.1f}, Std {row['std']:5.1f}, N={int(row['count']):4d}, Diff: {diff_pct:+.1f}%")
    
    # High vs Normal AQHI
    print("\n" + "=" * 60)
    print("High AQHI (>=7) vs Normal")
    print("=" * 60)
    
    high_aqhi = merged[merged['AQHI_General_Max'] >= 7]
    normal_aqhi = merged[merged['AQHI_General_Max'] < 7]
    
    high_mean = high_aqhi['Attendance'].mean()
    normal_mean = normal_aqhi['Attendance'].mean()
    diff = high_mean - normal_mean
    pct = (diff / normal_mean) * 100
    
    print(f"High AQHI days (>=7):   N={len(high_aqhi):4d}, Mean={high_mean:.1f}")
    print(f"Normal AQHI days (<7):  N={len(normal_aqhi):4d}, Mean={normal_mean:.1f}")
    print(f"Difference: {diff:+.1f} ({pct:+.1f}%)")
    
    # Statistical significance (t-test)
    from scipy import stats
    t_stat, p_value = stats.ttest_ind(high_aqhi['Attendance'], normal_aqhi['Attendance'])
    print(f"T-test: t={t_stat:.3f}, p={p_value:.4f}")
    if p_value < 0.05:
        print("*** Statistically significant (p < 0.05) ***")
    else:
        print("Not statistically significant (p >= 0.05)")
    
    # Very high AQHI (>=8)
    print("\n" + "=" * 60)
    print("Very High AQHI (>=8) vs Normal")
    print("=" * 60)
    
    very_high = merged[merged['AQHI_General_Max'] >= 8]
    if len(very_high) > 0:
        vh_mean = very_high['Attendance'].mean()
        diff2 = vh_mean - normal_mean
        pct2 = (diff2 / normal_mean) * 100
        print(f"Very High AQHI (>=8):  N={len(very_high):4d}, Mean={vh_mean:.1f}")
        print(f"Difference vs normal: {diff2:+.1f} ({pct2:+.1f}%)")
    else:
        print("No days with AQHI >= 8 in dataset")
    
    # Roadside analysis
    print("\n" + "=" * 60)
    print("High Roadside AQHI (>=7)")
    print("=" * 60)
    
    high_road = merged[merged['AQHI_Roadside_Max'] >= 7]
    normal_road = merged[merged['AQHI_Roadside_Max'] < 7]
    
    if len(high_road) > 0:
        hr_mean = high_road['Attendance'].mean()
        nr_mean = normal_road['Attendance'].mean()
        diff3 = hr_mean - nr_mean
        pct3 = (diff3 / nr_mean) * 100
        print(f"High Roadside AQHI:    N={len(high_road):4d}, Mean={hr_mean:.1f}")
        print(f"Normal Roadside AQHI:  N={len(normal_road):4d}, Mean={nr_mean:.1f}")
        print(f"Difference: {diff3:+.1f} ({pct3:+.1f}%)")
    
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Total matched days: {len(merged)}")
    print(f"Baseline attendance: {baseline:.1f}")
    print(f"Correlation (General Max): {corr_gen:+.4f}")
    print(f"High AQHI impact: {pct:+.1f}%")
    
    if abs(corr_gen) > 0.1:
        print("\n>>> AQHI appears to have some correlation with attendance")
        print(">>> Recommend including AQHI features in XGBoost model")
    else:
        print("\n>>> Weak correlation, but may still be useful for extreme days")

if __name__ == "__main__":
    main()

