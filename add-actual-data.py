#!/usr/bin/env python3
"""
添加實際數據到數據庫並計算準確度
使用 Python 執行，不需要 Node.js
"""

import os
import sys
from urllib.parse import urlparse
import psycopg2
from psycopg2.extras import RealDictCursor

# 實際數據（1/12 到 12/12）
ACTUAL_DATA = [
    {'date': '2025-12-01', 'patient_count': 276},
    {'date': '2025-12-02', 'patient_count': 285},
    {'date': '2025-12-03', 'patient_count': 253},
    {'date': '2025-12-04', 'patient_count': 234},
    {'date': '2025-12-05', 'patient_count': 262},
    {'date': '2025-12-06', 'patient_count': 234},
    {'date': '2025-12-07', 'patient_count': 244},
    {'date': '2025-12-08', 'patient_count': 293},
    {'date': '2025-12-09', 'patient_count': 253},
    {'date': '2025-12-10', 'patient_count': 219},
    {'date': '2025-12-11', 'patient_count': 275},
    {'date': '2025-12-12', 'patient_count': 248}
]

def get_db_connection():
    """獲取數據庫連接"""
    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        print('❌ DATABASE_URL 環境變數未設置')
        print('💡 請設置 DATABASE_URL 環境變數，或從 .env 文件加載')
        sys.exit(1)
    
    try:
        # 解析 DATABASE_URL
        parsed = urlparse(database_url)
        
        conn = psycopg2.connect(
            host=parsed.hostname,
            port=parsed.port or 5432,
            database=parsed.path[1:],  # 移除前導斜杠
            user=parsed.username,
            password=parsed.password,
            sslmode='require' if not parsed.hostname or 'localhost' not in parsed.hostname else 'prefer'
        )
        return conn
    except Exception as e:
        print(f'❌ 數據庫連接失敗: {e}')
        sys.exit(1)

def calculate_accuracy(conn, date, actual_count):
    """計算準確度"""
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # 查找預測數據
            cur.execute("""
                SELECT 
                    COALESCE(
                        (SELECT predicted_count FROM final_daily_predictions WHERE target_date = %s),
                        (SELECT predicted_count FROM daily_predictions WHERE target_date = %s ORDER BY created_at DESC LIMIT 1),
                        (SELECT predicted_count FROM predictions WHERE target_date = %s ORDER BY created_at DESC LIMIT 1)
                    ) as predicted_count,
                    COALESCE(
                        (SELECT ci80_low FROM final_daily_predictions WHERE target_date = %s),
                        (SELECT ci80_low FROM daily_predictions WHERE target_date = %s ORDER BY created_at DESC LIMIT 1),
                        (SELECT ci80_low FROM predictions WHERE target_date = %s ORDER BY created_at DESC LIMIT 1)
                    ) as ci80_low,
                    COALESCE(
                        (SELECT ci80_high FROM final_daily_predictions WHERE target_date = %s),
                        (SELECT ci80_high FROM daily_predictions WHERE target_date = %s ORDER BY created_at DESC LIMIT 1),
                        (SELECT ci80_high FROM predictions WHERE target_date = %s ORDER BY created_at DESC LIMIT 1)
                    ) as ci80_high,
                    COALESCE(
                        (SELECT ci95_low FROM final_daily_predictions WHERE target_date = %s),
                        (SELECT ci95_low FROM daily_predictions WHERE target_date = %s ORDER BY created_at DESC LIMIT 1),
                        (SELECT ci95_low FROM predictions WHERE target_date = %s ORDER BY created_at DESC LIMIT 1)
                    ) as ci95_low,
                    COALESCE(
                        (SELECT ci95_high FROM final_daily_predictions WHERE target_date = %s),
                        (SELECT ci95_high FROM daily_predictions WHERE target_date = %s ORDER BY created_at DESC LIMIT 1),
                        (SELECT ci95_high FROM predictions WHERE target_date = %s ORDER BY created_at DESC LIMIT 1)
                    ) as ci95_high
            """, (date, date, date, date, date, date, date, date, date, date, date, date))
            
            result = cur.fetchone()
            if not result or not result['predicted_count']:
                return None
            
            predicted = result['predicted_count']
            ci80_low = result['ci80_low']
            ci80_high = result['ci80_high']
            ci95_low = result['ci95_low']
            ci95_high = result['ci95_high']
            
            error = predicted - actual_count
            error_pct = round((error / predicted * 100), 2)
            in_ci80 = ci80_low and ci80_high and ci80_low <= actual_count <= ci80_high
            in_ci95 = ci95_low and ci95_high and ci95_low <= actual_count <= ci95_high
            
            # 插入或更新準確度記錄
            cur.execute("""
                INSERT INTO prediction_accuracy (
                    target_date, predicted_count, actual_count, 
                    error_percentage, within_ci80, within_ci95
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (target_date) DO UPDATE SET
                    predicted_count = EXCLUDED.predicted_count,
                    actual_count = EXCLUDED.actual_count,
                    error_percentage = EXCLUDED.error_percentage,
                    within_ci80 = EXCLUDED.within_ci80,
                    within_ci95 = EXCLUDED.in_ci95,
                    updated_at = CURRENT_TIMESTAMP
            """, (date, predicted, actual_count, error_pct, in_ci80, in_ci95))
            
            return {
                'predicted': predicted,
                'error': error,
                'error_pct': error_pct,
                'in_ci80': in_ci80,
                'in_ci95': in_ci95
            }
    except Exception as e:
        print(f'  ⚠️  計算準確度時出錯: {e}')
        return None

def main():
    """主函數"""
    print('📊 開始添加實際數據...\n')
    print('數據列表:')
    for item in ACTUAL_DATA:
        print(f'  {item["date"]}: {item["patient_count"]} 人')
    print('')
    
    # 嘗試從 .env 文件加載環境變數
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass  # 如果沒有 python-dotenv，跳過
    
    conn = get_db_connection()
    
    try:
        success_count = 0
        error_count = 0
        accuracy_results = []
        
        for data in ACTUAL_DATA:
            date = data['date']
            patient_count = data['patient_count']
            
            try:
                with conn.cursor() as cur:
                    # 插入或更新實際數據
                    cur.execute("""
                        INSERT INTO actual_data (date, patient_count, source, notes)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (date) DO UPDATE SET
                            patient_count = EXCLUDED.patient_count,
                            source = EXCLUDED.source,
                            notes = EXCLUDED.notes
                    """, (date, patient_count, 'manual_upload', 'Added via Python script'))
                    
                    success_count += 1
                    
                    # 計算準確度
                    accuracy = calculate_accuracy(conn, date, patient_count)
                    if accuracy:
                        accuracy_results.append({
                            'date': date,
                            'actual': patient_count,
                            **accuracy
                        })
                        ci80_status = '✅' if accuracy['in_ci80'] else '❌'
                        ci95_status = '✅' if accuracy['in_ci95'] else '❌'
                        error_sign = '+' if accuracy['error'] > 0 else ''
                        print(f'  ✅ {date}: 實際 {patient_count} 人, 預測 {accuracy["predicted"]} 人, 誤差 {error_sign}{accuracy["error"]} ({accuracy["error_pct"]}%), CI80: {ci80_status}, CI95: {ci95_status}')
                    else:
                        print(f'  ⚠️  {date}: 已添加實際數據，但沒有找到預測數據')
                
                conn.commit()
            except Exception as e:
                conn.rollback()
                print(f'  ❌ {date}: 添加失敗: {e}')
                error_count += 1
        
        print('')
        print(f'✅ 成功添加 {success_count} 筆數據')
        if error_count > 0:
            print(f'⚠️  {error_count} 筆數據添加失敗')
        
        if accuracy_results:
            print('')
            print('📊 比較結果摘要:')
            for result in accuracy_results:
                ci80_status = '✅' if result['in_ci80'] else '❌'
                ci95_status = '✅' if result['in_ci95'] else '❌'
                error_sign = '+' if result['error'] > 0 else ''
                print(f'  {result["date"]}: 實際 {result["actual"]} 人, 預測 {result["predicted"]} 人, 誤差 {error_sign}{result["error"]} ({result["error_pct"]}%), CI80: {ci80_status}, CI95: {ci95_status}')
        
        print('')
        print('💡 數據已添加並自動計算準確度')
        print('💡 你可以在網頁上查看「實際 vs 預測對比」圖表和「詳細比較數據」表格')
        
    except Exception as e:
        conn.rollback()
        print(f'❌ 處理數據時發生錯誤: {e}')
        sys.exit(1)
    finally:
        conn.close()

if __name__ == '__main__':
    main()
