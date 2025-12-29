#!/usr/bin/env python
# Check for missing dates in the attendance data
import csv
from datetime import datetime, timedelta

# Read the cleaned CSV
dates = []
with open('NDH_AED_Clean.csv', 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        dates.append(datetime.strptime(row['Date'], '%Y-%m-%d').date())

dates.sort()

print(f"Total records: {len(dates)}")
print(f"First date: {dates[0]}")
print(f"Last date: {dates[-1]}")

# Calculate expected days
total_expected = (dates[-1] - dates[0]).days + 1
missing_count = total_expected - len(dates)

print(f"Expected days: {total_expected}")
print(f"Missing days: {missing_count}")
print(f"Coverage: {len(dates)/total_expected*100:.2f}%")

# Find all gaps
print("\n" + "="*60)
print("ALL MISSING DATE RANGES:")
print("="*60)

gaps = []
for i in range(1, len(dates)):
    diff = (dates[i] - dates[i-1]).days
    if diff > 1:
        gap_start = dates[i-1] + timedelta(days=1)
        gap_end = dates[i] - timedelta(days=1)
        gaps.append({
            'start': gap_start,
            'end': gap_end,
            'days': diff - 1
        })

# Sort by gap size (largest first)
gaps.sort(key=lambda x: x['days'], reverse=True)

print(f"\nTotal {len(gaps)} gaps found:\n")

for i, gap in enumerate(gaps, 1):
    if gap['days'] == 1:
        print(f"{i:3}. {gap['start']} (1 day)")
    else:
        print(f"{i:3}. {gap['start']} to {gap['end']} ({gap['days']} days)")

# Summary by year
print("\n" + "="*60)
print("COVERAGE BY YEAR:")
print("="*60)

from collections import defaultdict
year_data = defaultdict(list)
for d in dates:
    year_data[d.year].append(d)

for year in sorted(year_data.keys()):
    year_dates = year_data[year]
    # Calculate expected days for this year within our range
    year_start = max(datetime(year, 1, 1).date(), dates[0])
    year_end = min(datetime(year, 12, 31).date(), dates[-1])
    expected = (year_end - year_start).days + 1
    actual = len(year_dates)
    pct = actual/expected*100 if expected > 0 else 0
    print(f"{year}: {actual:4} / {expected:3} days ({pct:5.1f}%) - {year_dates[0]} to {year_dates[-1]}")

