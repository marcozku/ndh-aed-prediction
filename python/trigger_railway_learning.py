# -*- coding: utf-8 -*-
"""
觸發 Railway 學習系統更新
"""
import sys
import io
import requests
import time

if sys.platform == 'win32':
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except:
        pass

RAILWAY_URL = "https://ndh-aed-production.up.railway.app"

print("🔍 觸發 Railway 學習系統...")
print(f"URL: {RAILWAY_URL}\n")

# 1. 檢查調度器狀態
print("1️⃣ 檢查調度器狀態...")
try:
    response = requests.get(f"{RAILWAY_URL}/api/learning/scheduler-status", timeout=10)
    print(f"   狀態碼: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"   調度器運行: {data.get('data', {}).get('is_running', False)}")
        print(f"   已排程任務: {data.get('data', {}).get('scheduled_tasks', 0)}")
    else:
        print(f"   ❌ 失敗: {response.text}")
except Exception as e:
    print(f"   ❌ 錯誤: {e}")

print()

# 2. 觸發學習更新
print("2️⃣ 觸發學習更新...")
try:
    response = requests.post(f"{RAILWAY_URL}/api/learning/update", timeout=60)
    print(f"   狀態碼: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"   ✅ {data.get('message', 'Success')}")
        print(f"   腳本: {data.get('script', 'unknown')}")
    else:
        print(f"   ❌ 失敗: {response.text}")
except Exception as e:
    print(f"   ❌ 錯誤: {e}")

print()

# 3. 等待 5 秒
print("3️⃣ 等待 5 秒...")
time.sleep(5)

# 4. 檢查學習摘要
print("4️⃣ 檢查學習摘要...")
try:
    response = requests.get(f"{RAILWAY_URL}/api/learning/summary", timeout=10)
    print(f"   狀態碼: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        summary = data.get('data', {})
        print(f"   學習天數: {summary.get('total_learning_days', 0)}")
        print(f"   平均誤差: {summary.get('average_error', 0)}")
        print(f"   異常數: {summary.get('anomaly_count', 0)}")
        print(f"   最後學習: {summary.get('last_learning_date', 'Never')}")
    else:
        print(f"   ❌ 失敗: {response.text}")
except Exception as e:
    print(f"   ❌ 錯誤: {e}")

print("\n✅ 檢查完成")
