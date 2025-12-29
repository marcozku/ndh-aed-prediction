#!/usr/bin/env python
"""
Export AI factors from database to JSON file
Run on Railway or with database access
"""
import json
import os
from dotenv import load_dotenv

def export_ai_factors():
    load_dotenv()
    
    try:
        import psycopg2
        conn = psycopg2.connect(
            host=os.getenv('PGHOST'),
            database=os.getenv('PGDATABASE'),
            user=os.getenv('PGUSER'),
            password=os.getenv('PGPASSWORD'),
        )
        
        cursor = conn.cursor()
        cursor.execute("SELECT factors_cache FROM ai_factors_cache WHERE id = 1")
        result = cursor.fetchone()
        
        if result and result[0]:
            factors = result[0] if isinstance(result[0], dict) else json.loads(result[0])
            
            # Save to file
            output_path = os.path.join(os.path.dirname(__file__), 'models', 'ai_factors.json')
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(factors, f, ensure_ascii=False, indent=2)
            
            print(f"Exported {len(factors)} AI factors to {output_path}")
            return factors
        else:
            print("No AI factors found in database")
            return {}
            
    except Exception as e:
        print(f"Error exporting AI factors: {e}")
        return {}

if __name__ == "__main__":
    export_ai_factors()

