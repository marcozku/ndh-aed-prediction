#!/usr/bin/env python3
"""
Analyze relationship between weather factors and ED attendance
Uses complete HKO weather data and attendance records
"""

import pandas as pd
import numpy as np
import os
from scipy import stats

def main():
    print("=" * 70)
    print("Weather Factors vs ED Attendance - Correlation Analysis")
    print("=" * 70)
    
    # Load weather data
    weather_path = os.path.join(os.path.dirname(__file__), 'weather_full_history.csv')
    weather = pd.read_csv(weather_path)
    weather['Date'] = pd.to_datetime(weather['Date'])
    print(f"Weather data: {len(weather)} days")
    
    # Load attendance data
    att_path = os.path.join(os.path.dirname(__file__), '..', 'NDH_AED_Clean.csv')
    att = pd.read_csv(att_path)
    att.columns = ['Date', 'Attendance']
    att['Date'] = pd.to_datetime(att['Date'])
    print(f"Attendance data: {len(att)} days")
    
    # Merge
    merged = pd.merge(weather, att, on='Date', how='inner')
    print(f"Matched days: {len(merged)}")
    print(f"Date range: {merged['Date'].min().strftime('%Y-%m-%d')} to {merged['Date'].max().strftime('%Y-%m-%d')}")
    
    # Weather columns to analyze
    weather_cols = [
        'Pressure_hPa', 'Temp_Mean', 'Temp_Max', 'Temp_Min', 
        'DewPoint', 'Humidity_pct', 'Cloud_pct', 'Rainfall_mm',
        'Sunshine_hrs', 'Wind_kmh', 'Visibility_km'
    ]
    
    print()
    print("=" * 70)
    print("CORRELATION ANALYSIS (Pearson r)")
    print("=" * 70)
    print(f"{'Factor':<20} {'Correlation':>12} {'P-value':>12} {'Significance':>15}")
    print("-" * 70)
    
    correlations = []
    for col in weather_cols:
        if col not in merged.columns:
            continue
        
        # Remove NA
        valid = merged[[col, 'Attendance']].dropna()
        if len(valid) < 30:
            continue
        
        r, p = stats.pearsonr(valid[col], valid['Attendance'])
        
        # Significance level
        if p < 0.001:
            sig = "*** (p<0.001)"
        elif p < 0.01:
            sig = "** (p<0.01)"
        elif p < 0.05:
            sig = "* (p<0.05)"
        else:
            sig = "n.s."
        
        correlations.append({
            'Factor': col,
            'Correlation': r,
            'P-value': p,
            'Significance': sig,
            'N': len(valid)
        })
        
        print(f"{col:<20} {r:>+12.4f} {p:>12.4e} {sig:>15}")
    
    # Sort by absolute correlation
    correlations = sorted(correlations, key=lambda x: abs(x['Correlation']), reverse=True)
    
    print()
    print("=" * 70)
    print("EXTREME VALUE ANALYSIS")
    print("=" * 70)
    
    baseline = merged['Attendance'].mean()
    print(f"Baseline attendance: {baseline:.1f}")
    print()
    
    # Analyze extreme conditions
    extreme_analyses = [
        ('High Pressure (>1020 hPa)', merged['Pressure_hPa'] > 1020),
        ('Low Pressure (<1010 hPa)', merged['Pressure_hPa'] < 1010),
        ('Pressure Drop (>5 hPa/day)', merged['Pressure_hPa'].diff().abs() > 5),
        ('Very Hot (Max >33C)', merged['Temp_Max'] > 33),
        ('Hot (Max >30C)', merged['Temp_Max'] > 30),
        ('Cold (Min <12C)', merged['Temp_Min'] < 12),
        ('Very Cold (Min <8C)', merged['Temp_Min'] < 8),
        ('High Humidity (>90%)', merged['Humidity_pct'] > 90),
        ('Low Humidity (<50%)', merged['Humidity_pct'] < 50),
        ('Heavy Rain (>25mm)', merged['Rainfall_mm'] > 25),
        ('Rain Day (>0.1mm)', merged['Rainfall_mm'] > 0.1),
        ('No Rain (0mm)', merged['Rainfall_mm'] == 0),
        ('Strong Wind (>30km/h)', merged['Wind_kmh'] > 30),
        ('Cloudy (>80%)', merged['Cloud_pct'] > 80),
        ('Clear (<20%)', merged['Cloud_pct'] < 20),
        ('Low Visibility (<8km)', merged['Visibility_km'] < 8),
        ('Sunny (>8hrs)', merged['Sunshine_hrs'] > 8),
    ]
    
    print(f"{'Condition':<35} {'N':>6} {'Mean':>8} {'Diff':>10} {'Diff%':>8} {'P-value':>12}")
    print("-" * 70)
    
    significant_factors = []
    for name, condition in extreme_analyses:
        subset = merged[condition]
        rest = merged[~condition]
        
        if len(subset) < 10:
            continue
        
        mean = subset['Attendance'].mean()
        diff = mean - baseline
        diff_pct = (diff / baseline) * 100
        
        # T-test
        t_stat, p = stats.ttest_ind(subset['Attendance'], rest['Attendance'])
        
        sig = "***" if p < 0.001 else "**" if p < 0.01 else "*" if p < 0.05 else ""
        
        print(f"{name:<35} {len(subset):>6} {mean:>8.1f} {diff:>+10.1f} {diff_pct:>+7.1f}% {p:>11.4f} {sig}")
        
        if p < 0.05:
            significant_factors.append({
                'name': name,
                'n': len(subset),
                'mean': mean,
                'diff': diff,
                'diff_pct': diff_pct,
                'p': p
            })
    
    print()
    print("=" * 70)
    print("SUMMARY - Significant Factors (p < 0.05)")
    print("=" * 70)
    
    # Sort by absolute impact
    significant_factors = sorted(significant_factors, key=lambda x: abs(x['diff_pct']), reverse=True)
    
    for f in significant_factors:
        direction = "increases" if f['diff'] > 0 else "decreases"
        print(f"  {f['name']}: {direction} attendance by {abs(f['diff_pct']):.1f}% (N={f['n']}, p={f['p']:.4f})")
    
    print()
    print("=" * 70)
    print("RECOMMENDATIONS")
    print("=" * 70)
    
    # Top correlations
    print("\nTop correlated factors (by |r|):")
    for c in correlations[:5]:
        print(f"  {c['Factor']}: r={c['Correlation']:+.4f} {c['Significance']}")
    
    print("\nFactors to add to XGBoost model:")
    for f in significant_factors[:5]:
        print(f"  - {f['name']} (impact: {f['diff_pct']:+.1f}%)")

if __name__ == "__main__":
    main()

