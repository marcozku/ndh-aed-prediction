# -*- coding: utf-8 -*-
"""
檢查 actual_data 表結構和最新數據
"""
import sys
import io
import psycopg2

if sys.platform == 'win32':
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except:
        pass

DATABASE_URL = 'postgresql://postgres:nIdJPREHqkBdMgUifrazOsVlWbxsmDGq@tramway.proxy.rlwy.net:45703/railway'

print("🔍 檢查 actual_data 表...\n")

try:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # 檢查表結構
    cur.execute("""
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'actual_data'
        ORDER BY ordinal_position
    """)

    columns = cur.fetchall()
    print(f"📋 actual_data 表有 {len(columns)} 個欄位：\n")
    for col in columns:
        print(f"   - {col[0]}: {col[1]}")

    # 查找最新數據
    print("\n📊 最新 5 筆數據：\n")
    cur.execute(f"""
        SELECT * FROM actual_data
        ORDER BY date DESC
        LIMIT 5
    """)

    rows = cur.fetchall()
    for row in rows:
        print(f"   {row}")

    cur.close()
    conn.close()

except Exception as e:
    print(f"\n❌ 錯誤: {e}")
