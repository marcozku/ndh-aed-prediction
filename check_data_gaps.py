#!/usr/bin/env python
# Check database for missing data gaps
import urllib.request
import json
from datetime import datetime, timedelta, date
from collections import defaultdict

def check_data_gaps():
    print("[Fetching data from API...]\n")
    
    url = "https://ndhaedprediction.up.railway.app/api/actual-data"
    with urllib.request.urlopen(url) as response:
        data = json.loads(response.read().decode())
    
    if data.get("success") and data.get("data"):
        dates = sorted([datetime.fromisoformat(d["date"].replace("Z", "+00:00")).date() 
                       for d in data["data"]])
        
        today = date.today()
        
        print("=" * 70)
        print("DATABASE STATISTICS")
        print("=" * 70)
        print(f"Total records:    {len(dates)}")
        print(f"Date range:       {dates[0]} to {dates[-1]}")
        print(f"Today:            {today}")
        
        # Calculate coverage
        total_days = (today - dates[0]).days + 1
        print(f"Expected days:    {total_days}")
        print(f"Actual records:   {len(dates)}")
        print(f"Missing days:     {total_days - len(dates)}")
        print(f"Coverage:         {(len(dates) / total_days * 100):.2f}%")
        
        # Find ALL gaps (> 1 day)
        print("\n" + "=" * 70)
        print("ALL DATA GAPS (missing dates)")
        print("=" * 70)
        print(f"{'#':<4} {'From':<12} {'To':<12} {'Missing Days':<12} {'Period'}")
        print("-" * 70)
        
        all_gaps = []
        gap_num = 1
        
        for i in range(1, len(dates)):
            diff = (dates[i] - dates[i-1]).days
            if diff > 1:  # Any gap > 1 day means missing data
                missing_days = diff - 1
                gap = {
                    "from": dates[i-1],
                    "to": dates[i],
                    "missing": missing_days,
                    "first_missing": dates[i-1] + timedelta(days=1),
                    "last_missing": dates[i] - timedelta(days=1)
                }
                all_gaps.append(gap)
                
                if missing_days == 1:
                    period = f"{gap['first_missing']}"
                else:
                    period = f"{gap['first_missing']} to {gap['last_missing']}"
                
                print(f"{gap_num:<4} {str(dates[i-1]):<12} {str(dates[i]):<12} {missing_days:<12} {period}")
                gap_num += 1
        
        # Check if there's a gap between last data and today
        if dates[-1] < today:
            missing_days = (today - dates[-1]).days
            if missing_days > 0:
                gap = {
                    "from": dates[-1],
                    "to": today,
                    "missing": missing_days,
                    "first_missing": dates[-1] + timedelta(days=1),
                    "last_missing": today
                }
                all_gaps.append(gap)
                
                if missing_days == 1:
                    period = f"{gap['first_missing']}"
                else:
                    period = f"{gap['first_missing']} to {gap['last_missing']}"
                
                print(f"{gap_num:<4} {str(dates[-1]):<12} {str(today):<12} {missing_days:<12} {period} [RECENT]")
        
        print("-" * 70)
        print(f"Total gaps: {len(all_gaps)}")
        total_missing = sum(g["missing"] for g in all_gaps)
        print(f"Total missing days: {total_missing}")
        
        # Summary by category
        print("\n" + "=" * 70)
        print("GAPS BY SIZE")
        print("=" * 70)
        
        gaps_1_7 = [g for g in all_gaps if g["missing"] <= 7]
        gaps_8_30 = [g for g in all_gaps if 7 < g["missing"] <= 30]
        gaps_31_90 = [g for g in all_gaps if 30 < g["missing"] <= 90]
        gaps_90_plus = [g for g in all_gaps if g["missing"] > 90]
        
        print(f"1-7 days:     {len(gaps_1_7)} gaps ({sum(g['missing'] for g in gaps_1_7)} days)")
        print(f"8-30 days:    {len(gaps_8_30)} gaps ({sum(g['missing'] for g in gaps_8_30)} days)")
        print(f"31-90 days:   {len(gaps_31_90)} gaps ({sum(g['missing'] for g in gaps_31_90)} days)")
        print(f"90+ days:     {len(gaps_90_plus)} gaps ({sum(g['missing'] for g in gaps_90_plus)} days)")
        
        # Major gaps detail
        if gaps_90_plus:
            print("\n" + "=" * 70)
            print("MAJOR GAPS (90+ days)")
            print("=" * 70)
            for g in gaps_90_plus:
                print(f"  {g['first_missing']} to {g['last_missing']} ({g['missing']} days)")
        
        # Analyze by year
        print("\n" + "=" * 70)
        print("DATA BY YEAR")
        print("=" * 70)
        year_data = defaultdict(list)
        for d in dates:
            year_data[d.year].append(d)
        
        for year in sorted(year_data.keys()):
            year_dates = year_data[year]
            year_start = date(year, 1, 1)
            year_end = min(date(year, 12, 31), today)
            expected = (year_end - year_start).days + 1
            if year == dates[0].year:
                year_start = dates[0]
                expected = (year_end - year_start).days + 1
            coverage = len(year_dates) / expected * 100 if expected > 0 else 0
            print(f"{year}: {len(year_dates):>4} records ({year_dates[0]} to {year_dates[-1]}) - {coverage:.1f}% coverage")
        
    else:
        print("API returned invalid data")

if __name__ == "__main__":
    check_data_gaps()
