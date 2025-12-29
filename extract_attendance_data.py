#!/usr/bin/env python
# Extract attendance data from PDF text dump
import re
from datetime import datetime

# Read the raw data from input file
with open('c:/Users/marco/Downloads/NDH_AED_Attendance_2014-2025.csv', 'r', encoding='utf-8') as f:
    raw_text = f.read()

# Pattern to match date and attendance pairs
# Format: DD/MM/YYYY followed by a number (attendance)
# The data has dates in DD/MM/YYYY format followed by attendance numbers

# First, let's try to find patterns like "01/12/2014284" or with spacing
# Looking at the raw text, dates and numbers are often concatenated

results = []

# Pattern 1: DD/MM/YYYYNNN (date immediately followed by 3-digit number)
pattern1 = r'(\d{2}/\d{2}/\d{4})(\d{3})(?!\d)'
matches1 = re.findall(pattern1, raw_text)
for date_str, attendance in matches1:
    try:
        date_obj = datetime.strptime(date_str, '%d/%m/%Y')
        results.append((date_obj, int(attendance)))
    except:
        pass

# Pattern 2: DD/MM/YYYYNN (date followed by 2-digit number, less common but possible)
pattern2 = r'(\d{2}/\d{2}/\d{4})(\d{2})(?!\d)'
matches2 = re.findall(pattern2, raw_text)
for date_str, attendance in matches2:
    try:
        date_obj = datetime.strptime(date_str, '%d/%m/%Y')
        att = int(attendance)
        # Filter out unlikely values (attendance should be > 100 typically)
        if att > 50:  # Some low days might have lower attendance
            results.append((date_obj, att))
    except:
        pass

# Remove duplicates and sort by date
unique_results = {}
for date_obj, attendance in results:
    date_key = date_obj.strftime('%Y-%m-%d')
    if date_key not in unique_results:
        unique_results[date_key] = attendance

# Sort by date
sorted_dates = sorted(unique_results.keys())

# Write output
print(f"Found {len(sorted_dates)} unique dates")
print(f"Date range: {sorted_dates[0]} to {sorted_dates[-1]}")

# Output to CSV
output_file = 'NDH_AED_Clean.csv'
with open(output_file, 'w', encoding='utf-8') as f:
    f.write("Date,Attendance\n")
    for date_str in sorted_dates:
        f.write(f"{date_str},{unique_results[date_str]}\n")

print(f"\nData saved to {output_file}")

# Show sample
print("\nFirst 10 entries:")
for date_str in sorted_dates[:10]:
    print(f"{date_str},{unique_results[date_str]}")

print("\nLast 10 entries:")
for date_str in sorted_dates[-10:]:
    print(f"{date_str},{unique_results[date_str]}")

