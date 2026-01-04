#!/usr/bin/env python3
"""
動態計算所有 prediction factors 從 Railway Production Database
每次訓練模型時自動執行，確保使用最新真實數據
"""

import os
import sys
import json
from datetime import datetime
import psycopg2
from psycopg2.extras import RealDictCursor

def get_db_connection():
    """連接到 Railway Production Database"""
    # 從環境變數或 server.js 配置獲取
    password = os.environ.get('PGPASSWORD') or os.environ.get('DATABASE_PASSWORD') or 'nIdJPREHqkBdMgUifrazOsVlWbxsmDGq'
    
    return psycopg2.connect(
        host=os.environ.get('PGHOST', 'tramway.proxy.rlwy.net'),
        port=int(os.environ.get('PGPORT', '45703')),
        user=os.environ.get('PGUSER', 'postgres'),
        password=password,
        database=os.environ.get('PGDATABASE', 'railway'),
        sslmode='require'
    )

def calculate_dynamic_factors():
    """從數據庫動態計算所有 factors"""
    
    print("=" * 80)
    print("DYNAMIC FACTOR CALCULATION FROM RAILWAY DATABASE")
    print("=" * 80)
    
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    
    # 1. Overall statistics
    cur.execute("SELECT COUNT(*) as total, AVG(patient_count) as mean FROM actual_data")
    overall = cur.fetchone()
    total_days = overall['total']
    overall_mean = float(overall['mean'])
    
    print(f"\nTotal Days: {total_days}")
    print(f"Overall Mean: {overall_mean:.2f}\n")
    
    # 2. Day of Week Factors
    print("Calculating Day-of-Week Factors...")
    cur.execute("""
        SELECT 
            EXTRACT(DOW FROM date) as dow,
            COUNT(*) as count,
            AVG(patient_count) as mean
        FROM actual_data
        GROUP BY EXTRACT(DOW FROM date)
        ORDER BY dow
    """)
    
    dow_factors = {}
    dow_names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    for row in cur.fetchall():
        dow = int(row['dow'])
        factor = float(row['mean']) / overall_mean
        dow_factors[dow] = {
            'name': dow_names[dow],
            'factor': round(factor, 3),
            'mean': round(float(row['mean']), 2),
            'count': row['count']
        }
        print(f"  {dow_names[dow]}: {factor:.3f} (n={row['count']})")
    
    # 3. Month Factors
    print("\nCalculating Month Factors...")
    cur.execute("""
        SELECT 
            EXTRACT(MONTH FROM date) as month,
            COUNT(*) as count,
            AVG(patient_count) as mean
        FROM actual_data
        GROUP BY EXTRACT(MONTH FROM date)
        ORDER BY month
    """)
    
    month_factors = {}
    for row in cur.fetchall():
        month = int(row['month'])
        factor = float(row['mean']) / overall_mean
        month_factors[month] = {
            'factor': round(factor, 3),
            'mean': round(float(row['mean']), 2),
            'count': row['count']
        }
        print(f"  Month {month}: {factor:.3f} (n={row['count']})")
    
    # 4. Holiday Factors (HK Public Holidays)
    print("\nCalculating Holiday Factors...")
    
    holidays = {
        '農曆新年': ['01-31', '02-19', '02-08', '01-28', '02-16', '02-05', '01-25', '02-12', '02-01', '01-22', '02-10', '01-29'],
        '聖誕節': ['12-25'],
        '聖誕節翌日': ['12-26'],
        '元旦': ['01-01'],
        '清明節': ['04-04', '04-05'],
        '端午節': ['06-02', '06-20', '06-09', '05-30', '06-18', '06-07', '06-25', '06-14', '06-03', '06-22', '06-10', '05-31'],
        '中秋節翌日': ['09-09', '09-28', '09-16', '10-05', '09-25', '09-14', '10-02', '09-22', '09-12', '09-30', '09-18', '10-07'],
        '重陽節': ['10-02', '10-21', '10-10', '10-28', '10-17', '10-07', '10-26', '10-14', '10-04', '10-23', '10-11', '10-29'],
        '佛誕': ['05-06', '05-25', '05-14', '05-03', '05-22', '05-13', '04-30', '05-19', '05-09', '05-26', '05-15', '05-05'],
        '勞動節': ['05-01'],
        '耶穌受難日': ['04-18', '04-03', '03-25', '04-14', '03-30', '04-19', '04-10', '04-02', '04-15', '04-07', '03-29', '04-18'],
        '復活節星期一': ['04-21', '04-06', '03-28', '04-17', '04-02', '04-22', '04-13', '04-05', '04-18', '04-10', '04-01', '04-21'],
        '香港特別行政區成立紀念日': ['07-01'],
        '國慶日': ['10-01']
    }
    
    holiday_factors = {}
    for name, dates in holidays.items():
        date_conditions = " OR ".join([f"TO_CHAR(date, 'MM-DD') = '{d}'" for d in set(dates)])
        query = f"""
            SELECT 
                COUNT(*) as count,
                AVG(patient_count) as mean
            FROM actual_data
            WHERE {date_conditions}
        """
        cur.execute(query)
        result = cur.fetchone()
        
        if result['count'] > 0:
            factor = float(result['mean']) / overall_mean
            holiday_factors[name] = {
                'factor': round(factor, 3),
                'mean': round(float(result['mean']), 2),
                'count': result['count'],
                'impact_pct': round((factor - 1.0) * 100, 1)
            }
            print(f"  {name}: {factor:.3f} (n={result['count']}, {holiday_factors[name]['impact_pct']:+.1f}%)")
    
    # Add secondary holidays (same factor as primary)
    holiday_factors['耶穌受難日翌日'] = holiday_factors['耶穌受難日'].copy()
    
    cur.close()
    conn.close()
    
    # 5. Save to JSON
    output = {
        'version': '3.0.81',
        'updated': datetime.now().strftime('%Y-%m-%d %H:%M HKT'),
        'source': 'Railway Production Database (actual_data table)',
        'total_days': total_days,
        'overall_mean': round(overall_mean, 2),
        'dow_factors': dow_factors,
        'month_factors': month_factors,
        'holiday_factors': holiday_factors,
        'note': 'All factors dynamically calculated from real data. Auto-updates when new data is uploaded.'
    }
    
    output_file = os.path.join(os.path.dirname(__file__), 'models', 'dynamic_factors.json')
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    print(f"\n[OK] Factors saved to: {output_file}")
    print(f"[OK] Total days analyzed: {total_days}")
    print(f"[OK] All factors calculated from real database records")
    
    return output

if __name__ == '__main__':
    try:
        result = calculate_dynamic_factors()
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)

