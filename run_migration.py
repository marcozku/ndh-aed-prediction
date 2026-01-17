#!/usr/bin/env python3
"""
Railway Migration Runner
運行 004_continuous_learning.sql migration

Usage in Railway:
1. Go to Railway Console → your project
2. Click "New" → "Service" → "CLI"
3. Run: python run_migration.py
"""

import psycopg2
import os

DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://postgres:nIdJPREHqkBdMgUifrazOsVlWbxsmDGq@containers-us-west-181.railway.app:5432/railway')

def run_migration():
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # 讀取 migration 文件
    with open('migrations/004_continuous_learning.sql', 'r', encoding='utf-8') as f:
        sql = f.read()

    print("🔧 Running migration 004_continuous_learning.sql...")

    # 執行 migration
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

    print(f"\n✅ Migration complete! {len(tables)} tables created:")
    for t in tables:
        print(f"   - {t[0]}")

    # 檢查視圖
    cur.execute("""
        SELECT viewname FROM pg_views
        WHERE schemaname = 'public'
        AND viewname LIKE '%learning%' OR viewname LIKE '%anomaly%'
        ORDER BY viewname
    """)
    views = cur.fetchall()

    if views:
        print(f"\n📊 {len(views)} views created:")
        for v in views:
            print(f"   - {v[0]}")

    conn.close()
    print("\n🎉 v4.0.00 Continuous Learning System is ready!")

if __name__ == '__main__':
    run_migration()
