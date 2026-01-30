# -*- coding: utf-8 -*-
"""
執行 Railway Migration 004 - 自動學習系統
"""
import sys
import io
import os
import subprocess
import psycopg2
from psycopg2 import sql

# Windows 編碼處理
if sys.platform == 'win32':
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except:
        pass

print("🔧 執行 Migration 004: 自動學習系統")

# 獲取 DATABASE_URL
try:
    railway_path = r'C:\Users\marco\AppData\Roaming\npm\railway.cmd'

    result = subprocess.run(
        ['cmd.exe', '/c', railway_path, 'variables'],
        capture_output=True,
        text=True,
        timeout=30,
        encoding='utf-8',
        errors='replace'
    )

    # 從輸出中提取 DATABASE_URL
    database_url = None
    lines = result.stdout.split('\n')

    print("🔍 解析 railway variables 輸出...")

    for i, line in enumerate(lines):
        if 'DATABASE_URL' in line and 'postgresql://' in line:
            # 合併當前行和下一行（URL 可能跨行）
            combined = line
            if i + 1 < len(lines):
                combined += lines[i + 1]

            # 找到 postgresql:// 的位置
            idx = combined.find('postgresql://')
            if idx >= 0:
                # 提取完整 URL
                url_part = combined[idx:]
                # 移除表格字符和空白
                url_part = url_part.strip()
                # URL 應該持續到遇到空白或表格字符
                for j, char in enumerate(url_part):
                    if char in ['║', '│', '\n', '\r', '\t']:
                        url_part = url_part[:j]
                        break

                database_url = url_part.strip()
                print(f"   提取 URL 長度: {len(database_url)} 字符")
                break

    if not database_url:
        print("❌ 無法找到 DATABASE_URL")
        print(result.stdout)
        sys.exit(1)

    print(f"✅ 找到 DATABASE_URL")
    print(f"   URL: {database_url[:50]}...{database_url[-20:] if len(database_url) > 70 else database_url}")

    # 讀取 migration 文件
    migration_file = os.path.join(os.path.dirname(__file__), '..', 'migrations', '004_continuous_learning.sql')
    with open(migration_file, 'r', encoding='utf-8') as f:
        migration_sql = f.read()

    print(f"✅ 讀取 migration 文件")

    # 連接數據庫
    print("🔌 連接數據庫...")
    conn = psycopg2.connect(database_url)
    cursor = conn.cursor()

    # 執行 migration
    print("🚀 執行 migration...")
    cursor.execute(migration_sql)
    conn.commit()

    print("✅ Migration 004 執行成功！")

    # 驗證表是否創建
    cursor.execute("""
        SELECT tablename
        FROM pg_tables
        WHERE schemaname='public'
          AND tablename IN (
              'learning_records',
              'weather_impact_parameters',
              'weather_combination_impacts',
              'ai_event_learning',
              'weather_forecast_cache',
              'anomaly_events',
              'weather_history'
          )
        ORDER BY tablename;
    """)

    tables = cursor.fetchall()
    print(f"\n📊 已創建 {len(tables)} 個學習系統表:")
    for table in tables:
        print(f"   ✅ {table[0]}")

    cursor.close()
    conn.close()

    print("\n🎉 自動學習系統數據庫結構安裝完成！")

except Exception as e:
    print(f"❌ 錯誤: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
