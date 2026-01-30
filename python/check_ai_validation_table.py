# -*- coding: utf-8 -*-
"""
檢查 ai_factor_validation 表結構
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

print("🔍 檢查 ai_factor_validation 表結構...\n")

try:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # 檢查表是否存在
    cur.execute("""
        SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_name = 'ai_factor_validation'
        )
    """)
    exists = cur.fetchone()[0]

    if not exists:
        print("   ❌ ai_factor_validation 表不存在")
        print("   💡 可能的替代表：ai_event_learning")
    else:
        # 檢查表結構
        cur.execute("""
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_name = 'ai_factor_validation'
            ORDER BY ordinal_position
        """)

        columns = cur.fetchall()
        print(f"📋 ai_factor_validation 表有 {len(columns)} 個欄位：\n")
        for col in columns:
            print(f"   - {col[0]}: {col[1]}")

    cur.close()
    conn.close()

except Exception as e:
    print(f"\n❌ 錯誤: {e}")
