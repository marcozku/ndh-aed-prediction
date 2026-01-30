#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import psycopg2
import os

os.chdir(r"c:\Github\ndh-aed-prediction")

# Railway 內部地址
DATABASE_URL = "postgresql://postgres:nIdJPREHqkBdMgUifrazOsVlWbxsmDGq@postgres.railway.internal:5432/railway"

print("Connecting to Railway database (internal)...")

try:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # 讀取 SQL
    sql = open('migrations/004_continuous_learning.sql', 'r', encoding='utf-8').read()
    print("Executing migration...")

    cur.execute(sql)
    conn.commit()

    # 驗證
    cur.execute("""
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
        AND (tablename LIKE '%learning%' OR tablename LIKE '%weather%' OR tablename LIKE '%anomaly%')
        ORDER BY tablename
    """)
    tables = cur.fetchall()

    print(f"\n=== SUCCESS! ===")
    print(f"Created {len(tables)} tables:")
    for t in tables:
        print(f"  - {t[0]}")

    cur.execute("SELECT COUNT(*) FROM weather_impact_parameters")
    params = cur.fetchone()[0]
    print(f"\nDefault parameters: {params} records")

    conn.close()
    print("\n=== Migration Complete! ===")

except Exception as e:
    print(f"ERROR: {e}")
    print("\nTrying external address...")
