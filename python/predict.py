"""
統一的預測接口
支持從數據庫或 CSV 加載數據，然後調用集成預測
"""
import pandas as pd
import json
import os
import sys
from ensemble_predict import ensemble_predict

def load_data_from_db():
    """從數據庫加載數據"""
    try:
        import psycopg2
        from dotenv import load_dotenv
        load_dotenv()
        
        database_url = os.getenv('DATABASE_URL')
        if database_url:
            conn = psycopg2.connect(database_url)
        else:
            conn = psycopg2.connect(
                host=os.getenv('PGHOST'),
                database=os.getenv('PGDATABASE'),
                user=os.getenv('PGUSER'),
                password=os.getenv('PGPASSWORD'),
            )
        
        query = """
            SELECT date as Date, patient_count as Attendance
            FROM actual_data
            ORDER BY date ASC
        """
        df = pd.read_sql_query(query, conn)
        conn.close()
        
        # 確保列名正確（pandas 可能會將列名轉為小寫）
        if 'date' in df.columns and 'Date' not in df.columns:
            df['Date'] = df['date']
            df = df.drop(columns=['date'])
        if 'patient_count' in df.columns and 'Attendance' not in df.columns:
            df['Attendance'] = df['patient_count']
            df = df.drop(columns=['patient_count'])
        
        # 確保只返回需要的列
        if 'Date' in df.columns and 'Attendance' in df.columns:
            return df[['Date', 'Attendance']]
        else:
            print(f"警告: 數據列不完整。可用列: {df.columns.tolist()}")
            return df
    except Exception as e:
        return None

def main():
    """命令行接口：python predict.py <target_date>"""
    if len(sys.argv) < 2:
        print("用法: python predict.py <target_date>")
        print("示例: python predict.py 2025-12-25")
        sys.exit(1)
    
    target_date = sys.argv[1]
    
    # 嘗試從數據庫加載歷史數據
    historical_data = load_data_from_db()
    
    if historical_data is None or len(historical_data) == 0:
        print("警告: 無法從數據庫加載數據，嘗試使用空數據集")
        historical_data = pd.DataFrame(columns=['Date', 'Attendance'])
    
    # 執行集成預測
    result = ensemble_predict(target_date, historical_data)
    
    if result:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(json.dumps({
            'error': '無法生成預測',
            'message': '請確保模型已訓練（運行 train_all_models.py）'
        }, indent=2, ensure_ascii=False))
        sys.exit(1)

if __name__ == '__main__':
    main()

