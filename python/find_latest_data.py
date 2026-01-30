# -*- coding: utf-8 -*-
"""
查找有實際數據的最新日期
"""
import sys
import io
import psycopg2
from datetime import datetime

if sys.platform == 'win32':
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except:
        pass

DATABASE_URL = 'postgresql://postgres:nIdJPREHqkBdMgUifrazOsVlWbxsmDGq@tramway.proxy.rlwy.net:45703/railway'

print("🔍 查找有實際數據的最新日期...\n")

try:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # 查找最新的實際數據日期
    cur.execute("""
        SELECT date, attendance
        FROM actual_data
        ORDER BY date DESC
        LIMIT 5
    """)

    rows = cur.fetchall()
    print(f"📊 最新 {len(rows)} 筆實際數據：\n")
    for row in rows:
        print(f"   {row[0]}: {row[1]} 人")

    cur.close()
    conn.close()

except Exception as e:
    print(f"\n❌ 錯誤: {e}")
