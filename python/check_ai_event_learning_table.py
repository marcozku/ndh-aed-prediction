# -*- coding: utf-8 -*-
"""
檢查 ai_event_learning 表結構
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

print("🔍 檢查 ai_event_learning 表結構...\n")

try:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # 檢查表結構
    cur.execute("""
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'ai_event_learning'
        ORDER BY ordinal_position
    """)

    columns = cur.fetchall()
    print(f"📋 ai_event_learning 表有 {len(columns)} 個欄位：\n")
    for col in columns:
        print(f"   - {col[0]}: {col[1]}")

    # 檢查數據樣本
    print("\n📊 檢查數據樣本...")
    cur.execute("""
        SELECT * FROM ai_event_learning
        LIMIT 3
    """)
    rows = cur.fetchall()
    print(f"   有 {len(rows)} 筆記錄")

    cur.close()
    conn.close()

except Exception as e:
    print(f"\n❌ 錯誤: {e}")
