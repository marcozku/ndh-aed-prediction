#!/usr/bin/env python3
"""
Railway Migration Runner
運行 004_continuous_learning.sql migration

Usage in Railway Console (推薦):
1. Go to Railway Console → your project
2. Click "New" → "Service" → "CLI"
3. Run: python run_migration.py

Usage locally with Railway CLI:
railway run python run_migration.py
"""

import psycopg2
import os
import sys

# 優先使用環境變數
DATABASE_URL = os.getenv('DATABASE_URL')

# 調試輸出
if DATABASE_URL:
    print(f"✓ DATABASE_URL found (length: {len(DATABASE_URL)})")
else:
    print("✗ DATABASE_URL not found in environment")
    print("\n請使用以下方式之一執行:")
    print("1. Railway Console CLI (推薦):")
    print("   - Railway Console → New → Service → CLI")
    print("   - 執行: python run_migration.py")
    print("\n2. 本地 Railway CLI:")
    print("   - railway run python run_migration.py")
    sys.exit(1)

def run_migration():
    print(f"🔌 Connecting to Railway database...")

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
        AND (viewname LIKE '%learning%' OR viewname LIKE '%anomaly%' OR viewname LIKE '%weather%')
        ORDER BY viewname
    """)
    views = cur.fetchall()

    if views:
        print(f"\n📊 {len(views)} views created:")
        for v in views:
            print(f"   - {v[0]}")

    # 插入默認天氣影響參數
    print("\n📊 Inserting default weather impact parameters...")
    cur.execute("""
        INSERT INTO weather_impact_parameters (parameter_name, parameter_value, sample_count, is_active)
        VALUES
            ('is_very_cold', -6.8, 128, TRUE),
            ('is_heavy_rain', -4.9, 232, TRUE),
            ('is_low_humidity', -4.7, 94, TRUE),
            ('is_strong_wind', -2.8, 789, TRUE),
            ('is_high_pressure', -1.5, 581, TRUE),
            ('is_very_hot', 1.2, 1064, TRUE),
            ('is_rain_day', -1.0, 1212, TRUE)
        ON CONFLICT (parameter_name) DO NOTHING
    """)
    conn.commit()
    print("   ✅ 7 default parameters inserted")

    conn.close()
    print("\n🎉 v4.0.00 Continuous Learning System is ready!")

if __name__ == '__main__':
    run_migration()
