#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Automatic Railway Migration
"""
import subprocess
import os
import sys
import psycopg2

os.chdir(r"c:\Github\ndh-aed-prediction")

print("=== Automatic Railway Migration ===\n")

# Step 1: Get DATABASE_URL
print("[1/2] Getting DATABASE_URL from Railway...")
result = subprocess.run(
    'railway variables',
    capture_output=True,
    text=True,
    encoding='utf-8',  # Force UTF-8
    shell=True,
    errors='ignore'  # Ignore encoding errors
)

DATABASE_URL = None
if result.returncode == 0:
    for line in result.stdout.split('\n'):
        if 'DATABASE_URL' in line and '=' in line:
            # Format: NAME=VALUE or NAME VALUE
            if '=' in line:
                DATABASE_URL = line.split('=')[-1].strip()
            else:
                parts = line.split()
                if len(parts) >= 2:
                    DATABASE_URL = parts[-1]
            break

if not DATABASE_URL or not DATABASE_URL.startswith('postgres'):
    print("  Could not parse DATABASE_URL from output")
    print(f"  Output: {result.stdout[:500]}")

    # Try direct Railway psql
    print("\n[2/2] Trying direct Railway psql...")
    sql = open('migrations/004_continuous_learning.sql', 'r', encoding='utf-8').read()

    result = subprocess.run(
        'railway run psql',
        input=sql,
        capture_output=True,
        text=True,
        encoding='utf-8',
        shell=True,
        errors='ignore'
    )
    print(result.stdout[:1000])
    if result.stderr and 'Multiple services' in result.stderr:
        print("\nERROR: Multiple services found. Please run:")
        print("  railway service")
        print("Then select PostgreSQL service.")
    sys.exit(result.returncode)

print(f"  Got DATABASE_URL (length: {len(DATABASE_URL)})")

# Step 2: Execute migration
print("\n[2/2] Executing migration...")
try:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    sql = open('migrations/004_continuous_learning.sql', 'r', encoding='utf-8').read()
    cur.execute(sql)
    conn.commit()

    # Verify
    cur.execute("""
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
        AND (tablename LIKE '%learning%' OR tablename LIKE '%weather%' OR tablename LIKE '%anomaly%')
        ORDER BY tablename
    """)
    tables = cur.fetchall()

    print(f"\n=== SUCCESS ===")
    print(f"Created {len(tables)} tables:")
    for t in tables:
        print(f"  - {t[0]}")

    cur.execute("SELECT COUNT(*) FROM weather_impact_parameters")
    params = cur.fetchone()[0]
    print(f"\nDefault parameters: {params} records")

    conn.close()
    print("\n=== Migration Complete! ===")

except Exception as e:
    print(f"\nERROR: {e}")
    sys.exit(1)
