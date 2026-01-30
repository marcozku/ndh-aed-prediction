# -*- coding: utf-8 -*-
"""
測試學習系統 - 使用 2026-01-17
"""
import sys
import io

# Fix Windows encoding FIRST
if sys.platform == 'win32':
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except:
        pass

print("=" * 60)
print(f"測試學習系統: 2026-01-17")
print("=" * 60)
print()

# 導入連續學習引擎的函數
sys.path.insert(0, 'python')
from continuous_learner import process_date

try:
    success = process_date("2026-01-17")
    print()
    if success:
        print("✅ 學習記錄創建成功！")
    else:
        print("⚠️  學習記錄創建失敗")
except Exception as e:
    print(f"❌ 錯誤: {e}")
    import traceback
    traceback.print_exc()
