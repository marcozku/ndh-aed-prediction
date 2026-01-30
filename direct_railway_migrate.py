#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Direct Railway migration executor
Run this after linking to Railway project
"""
import subprocess
import psycopg2
import os
import sys

os.chdir(r"c:\Github\ndh-aed-prediction")

print("=== Railway Migration Executor ===\n")

# Step 1: Get DATABASE_URL using Railway CLI
print("[1/3] Getting DATABASE_URL from Railway...")
try:
    result = subprocess.run(
        ['cmd.exe', '/c', 'railway variables 2>&1'],
        capture_output=True,
        timeout=30
    )

    output = result.stdout.decode('utf-8', errors='ignore') + result.stderr.decode('utf-8', errors='ignore')

    # Extract DATABASE_URL
    DATABASE_URL = None
    for line in output.split('\n'):
        if 'DATABASE_URL' in line and 'postgresql' in output:
            # Find the URL in the output
            idx = output.find('postgresql://')
            if idx != -1:
                # Extract until end of line or next variable
                end = output.find('\n', idx)
                DATABASE_URL = output[idx:end].strip().split()[0]
                break

    if not DATABASE_URL:
        print("ERROR: Could not find DATABASE_URL")
        print(f"Output: {output[:500]}")
        sys.exit(1)

    print(f"Found: {DATABASE_URL[:50]}...")

except Exception as e:
    print(f"ERROR getting DATABASE_URL: {e}")
    sys.exit(1)

# Step 2: Connect and execute migration
print("\n[2/3] Connecting to database...")
try:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    print("Connected!")

    # Read SQL file
    with open('migrations/004_continuous_learning.sql', 'r', encoding='utf-8') as f:
        sql = f.read()

    print(f"SQL file size: {len(sql)} bytes")

    # Execute migration
    print("\n[3/3] Executing migration...")
    cur.execute(sql)
    conn.commit()

    print("Migration executed successfully!")

    # Step 3: Verify
    print("\n=== Verification ===")
    cur.execute("""
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
        AND (tablename LIKE '%learning%' OR tablename LIKE '%weather%' OR tablename LIKE '%anomaly%')
        ORDER BY tablename
    """)
    tables = cur.fetchall()

    print(f"Created {len(tables)} new tables/views:")
    for t in tables:
        print(f"  - {t[0]}")

    # Check default parameters
    cur.execute("SELECT COUNT(*) FROM weather_impact_parameters")
    params = cur.fetchone()[0]
    print(f"\nDefault weather parameters: {params} records")

    # Check views
    cur.execute("""
        SELECT viewname FROM pg_views
        WHERE schemaname = 'public'
        AND viewname LIKE '%learning%' OR viewname LIKE '%weather%' OR viewname LIKE '%anomaly%'
        ORDER BY viewname
    """)
    views = cur.fetchall()
    print(f"Created {len(views)} views:")
    for v in views:
        print(f"  - {v[0]}")

    conn.close()

    print("\n=== MIGRATION COMPLETE! ===")

except Exception as e:
    print(f"\nERROR: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
