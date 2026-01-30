#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Direct Railway Migration - using DATABASE_URL
"""
import subprocess
import sys
import os
import psycopg2

os.chdir(r"c:\Github\ndh-aed-prediction")

print("Getting DATABASE_URL from Railway...")

# 獲取所有變數
result = subprocess.run(
    'railway variables',
    capture_output=True,
    text=True,
    shell=True
)

if result.returncode != 0:
    print(f"Error getting variables: {result.stderr}")
    sys.exit(1)

# 解析 DATABASE_URL
DATABASE_URL = None
for line in result.stdout.split('\n'):
    if 'DATABASE_URL' in line or 'DATABASE' in line:
        parts = line.split()
        if len(parts) >= 2:
            DATABASE_URL = parts[-1]
            break

if not DATABASE_URL:
    print("Could not find DATABASE_URL in output:")
    print(result.stdout)
    sys.exit(1)

print(f"Got DATABASE_URL (length: {len(DATABASE_URL)})")

print("\nConnecting to database...")
conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

print("Reading SQL file...")
sql = open('migrations/004_continuous_learning.sql', 'r', encoding='utf-8').read()

print("Executing migration...")
cur.execute(sql)
conn.commit()

print("\nVerifying tables...")
cur.execute("""
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    AND (tablename LIKE '%learning%' OR tablename LIKE '%weather%' OR tablename LIKE '%anomaly%')
    ORDER BY tablename
""")
tables = cur.fetchall()

print(f"Created {len(tables)} tables:")
for t in tables:
    print(f"  - {t[0]}")

cur.execute("SELECT COUNT(*) FROM weather_impact_parameters")
params = cur.fetchone()[0]
print(f"\nDefault parameters: {params} records")

conn.close()
print("\nMigration completed successfully!")
