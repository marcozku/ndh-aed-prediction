# -*- coding: utf-8 -*-
"""
快速測試 - 使用 Railway 數據庫
"""
import sys
import io

if sys.platform == 'win32':
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except:
        pass

import subprocess
import json
import pandas as pd
import numpy as np
from datetime import datetime

print("🔍 測試 Railway 數據庫連接...")

# 執行查詢
try:
    result = subprocess.run(
        ['railway', 'db', 'query', '--json', 'SELECT COUNT(*) as count FROM actual_data'],
        capture_output=True,
        text=True,
        timeout=30,
        encoding='utf-8',
        errors='replace'
    )

    if result.returncode != 0:
        print(f"❌ 查詢失敗")
        print(f"stderr: {result.stderr}")
    else:
        print(f"✅ 查詢成功")
        data = json.loads(result.stdout)
        print(f"📊 數據筆數: {data}")

except Exception as e:
    print(f"❌ 錯誤: {e}")
