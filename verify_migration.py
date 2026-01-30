#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import subprocess
import psycopg2
import os

os.chdir(r"c:\Github\ndh-aed-prediction")

# Get DATABASE_URL with proper encoding
result = subprocess.run(
    'railway variables',
    capture_output=True,
    shell=True
)

# Decode with error handling
output = result.stdout.decode('utf-8', errors='ignore')

DATABASE_URL = None
for line in output.split('\n'):
    if 'DATABASE_URL' in line and 'postgresql' in line:
        # Extract URL - it's spread across multiple lines
        if 'postgresql://' in line:
            # Get the full URL from output
            lines = output.split('\n')
            for i, l in enumerate(lines):
                if 'DATABASE_URL' in l:
                    # URL is usually in next few lines
                    url_parts = []
                    for j in range(i, min(i+5, len(lines))):
                        if 'postgresql://' in lines[j]:
                            url_parts.append(lines[j].strip())
                        elif url_parts and lines[j].strip():
                            url_parts.append(lines[j].strip())
                        elif url_parts:
                            break
                    DATABASE_URL = ''.join(url_parts).split()[-1]
                    break
        break

if not DATABASE_URL:
    print("Could not get DATABASE_URL")
    print(f"Output: {output[:500]}")
else:
    print(f"Got DATABASE_URL: {DATABASE_URL[:50]}...")

    # Test connection
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur = conn.cursor()

        # Check tables
        cur.execute("""
            SELECT tablename FROM pg_tables
            WHERE schemaname = 'public'
            AND (tablename LIKE '%learning%' OR tablename LIKE '%weather%' OR tablename LIKE '%anomaly%')
            ORDER BY tablename
        """)
        tables = cur.fetchall()

        if tables:
            print(f"\n=== SUCCESS! ===")
            print(f"Found {len(tables)} new tables:")
            for t in tables:
                print(f"  - {t[0]}")

            # Check parameters
            cur.execute("SELECT COUNT(*) FROM weather_impact_parameters")
            params = cur.fetchone()[0]
            print(f"\nDefault parameters: {params} records")

            print("\n=== MIGRATION COMPLETE! ===")
        else:
            print("\nNo new tables found - migration may not have run")

        conn.close()
    except Exception as e:
        print(f"Error: {e}")
