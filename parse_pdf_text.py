#!/usr/bin/env python
# Parse attendance data from PDF text dump
import re
from datetime import datetime
import sys

def parse_attendance_data(text):
    """Extract date-attendance pairs from messy PDF text"""
    results = {}
    
    # Pattern: DD/MM/YYYY followed by 2-3 digit attendance number
    # The attendance number ends when we hit another date or non-digit
    # Example: 01/12/2014284 -> date=01/12/2014, attendance=284
    pattern = r'(\d{2}/\d{2}/\d{4})(\d{2,3})(?=\d{2}/\d{2}/\d{4}|[^\d]|$)'
    
    matches = re.findall(pattern, text)
    print(f"Regex found {len(matches)} matches")
    
    for date_str, attendance_str in matches:
        try:
            date_obj = datetime.strptime(date_str, '%d/%m/%Y')
            attendance = int(attendance_str)
            
            # Filter: attendance typically 100-500 range
            if 50 <= attendance <= 500:
                date_key = date_obj.strftime('%Y-%m-%d')
                if date_key not in results:
                    results[date_key] = attendance
        except Exception as e:
            print(f"Error parsing {date_str}: {e}")
    
    return results

if __name__ == "__main__":
    # Read from stdin or file
    if len(sys.argv) > 1:
        with open(sys.argv[1], 'r', encoding='utf-8') as f:
            text = f.read()
    else:
        text = sys.stdin.read()
    
    data = parse_attendance_data(text)
    sorted_dates = sorted(data.keys())
    
    print(f"Found {len(sorted_dates)} records")
    if sorted_dates:
        print(f"Range: {sorted_dates[0]} to {sorted_dates[-1]}")
        
        # Output CSV
        with open('NDH_AED_Clean.csv', 'w') as f:
            f.write("Date,Attendance\n")
            for d in sorted_dates:
                f.write(f"{d},{data[d]}\n")
        print("Saved to NDH_AED_Clean.csv")

