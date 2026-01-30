# -*- coding: utf-8 -*-
"""
從 Railway 數據庫導出所有日期的出席數據到本地 CSV
"""
import sys
import io
import os

if sys.platform == 'win32':
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except:
        pass

import pandas as pd
from datetime import datetime
from dotenv import load_dotenv

# 載入環境變數
load_dotenv()

print("=" * 80)
print("📥 從 Railway 數據庫導出所有出席數據")
print("=" * 80)
print(f"時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

try:
    import psycopg2
    import psycopg2.extras

    # 從環境變數獲取資料庫配置
    db_host = os.getenv('PGHOST') or 'tramway.proxy.rlwy.net'
    db_port = int(os.getenv('PGPORT') or '45703')
    db_user = os.getenv('PGUSER') or 'postgres'
    db_password = os.getenv('PGPASSWORD') or os.getenv('DATABASE_PASSWORD') or 'nIdJPREHqkBdMgUifrazOsVlWbxsmDGq'
    db_name = os.getenv('PGDATABASE') or 'railway'

    print(f"📡 連接資料庫: {db_host}:{db_port}/{db_name}")
    
    DB_CONFIG = {
        'host': db_host,
        'port': db_port,
        'user': db_user,
        'password': db_password,
        'database': db_name,
        'sslmode': 'require'
    }

    conn = psycopg2.connect(**DB_CONFIG)
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # 查詢所有欄位
    query = """
        SELECT 
            id,
            date,
            patient_count,
            source,
            notes,
            created_at
        FROM actual_data 
        ORDER BY date ASC
    """
    
    print("📊 查詢數據...")
    cursor.execute(query)
    rows = cursor.fetchall()

    cursor.close()
    conn.close()

    # 轉換為 DataFrame
    df = pd.DataFrame(rows)
    
    # 確保日期格式正確
    if 'date' in df.columns:
        df['date'] = pd.to_datetime(df['date']).dt.date

    # 保存為 CSV（輸出到根目錄）
    output_file = 'ndh_attendance_export.csv'
    df.to_csv(output_file, index=False, encoding='utf-8-sig')
    
    print(f"\n✅ 成功導出 {len(df)} 筆記錄到 {output_file}")
    if len(df) > 0:
        print(f"📅 日期範圍: {df['date'].min()} → {df['date'].max()}")
        print(f"📈 平均就診人數: {df['patient_count'].mean():.1f}")
        print(f"📊 總記錄數: {len(df)}")
        print(f"\n📋 欄位: {', '.join(df.columns.tolist())}")

except ImportError as e:
    print(f"❌ 缺少必要的套件: {e}")
    print("   請執行: pip install psycopg2-binary pandas python-dotenv")
except Exception as e:
    print(f"❌ 導出失敗: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "=" * 80)
