# -*- coding: utf-8 -*-
"""
整合醫管局急診室等候時間數據
來源: C:\Github\hk-aed-waittime\app.js

API: https://www.ha.org.hk/opendata/aed/aedwtdata2-tc.json
更新頻率: 約每 15 分鐘

數據格式:
{
    "waitTime": [
        {
            "hospName": "北區醫院",
            "t45p95": "2.5 小時",  // 次緊急/非緊急類別
            "t45p50": "1.2 小時",
            "t3p50": "0.5 小時",   // 緊急類別
            "updateTime": "2025-01-17 23:00:00"
        },
        ...
    ]
}

用途: 使用等候時間作為實時特徵來調整預測
"""
import sys
import io

if sys.platform == 'win32':
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except:
        pass

import requests
import json
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import os
import time

# 醫管局 API (2025-10-13 更新版本)
AED_API_URL = "https://www.ha.org.hk/opendata/aed/aedwtdata2-tc.json"

# 北區醫院信息
NDH_INFO = {
    'name': '北區醫院',
    'nameEn': 'North District Hospital',
    'code': 'NDH',
    'lat': 22.4969,
    'lng': 114.1386,
    'cluster': 'NTE',
    'clusterName': '新界東聯網',
    'warning': '⚠️ 此醫院沒有兒科、婦產科、神經外科住院服務'
}


def fetch_aed_waiting_time():
    """
    獲取急診室等候時間數據

    返回: dict with keys:
        - success: bool
        - data: list of hospital data
        - update_time: str
        - error: str (if failed)
    """
    try:
        print(f"📡 獲取醫管局急診室等候時間...")

        response = requests.get(AED_API_URL, timeout=30)
        response.raise_for_status()

        data = response.json()

        if not data or 'waitTime' not in data:
            return {
                'success': False,
                'error': 'Invalid data format',
                'data': None
            }

        print(f"   ✅ 成功獲取 {len(data['waitTime'])} 間醫院數據")
        print(f"   📅 更新時間: {data.get('updateTime', 'Unknown')}")

        return {
            'success': True,
            'data': data['waitTime'],
            'update_time': data.get('updateTime', ''),
            'error': None
        }

    except requests.exceptions.Timeout:
        return {
            'success': False,
            'error': 'Request timeout',
            'data': None
        }
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'data': None
        }


def get_ndh_waiting_time():
    """
    獲取北區醫院等候時間

    返回: dict with keys:
        - t45p95: str (次緊急95分位等候時間)
        - t45p50: str (次緊急50分位等候時間)
        - t3p50: str (緊急50分位等候時間)
        - minutes: float (等候時間分鐘數)
        - level: int (0=綠<2h, 1=黃2-4h, 2=橙4-6h, 3=紅>6h)
    """
    result = fetch_aed_waiting_time()

    if not result['success']:
        return None

    # 尋找北區醫院
    for hospital in result['data']:
        if NDH_INFO['name'] in hospital['hospName']:
            # 解析等候時間
            t45p95 = hospital.get('t45p95', '未有資料')
            t45p50 = hospital.get('t45p50', '未有資料')
            t3p50 = hospital.get('t3p50', '未有資料')

            # 轉換為分鐘
            minutes = parse_waiting_time_to_minutes(t45p95)

            # 計算等候時間級別
            level = get_waiting_time_level(minutes)

            return {
                't45p95': t45p95,
                't45p50': t45p50,
                't3p50': t3p50,
                'minutes': minutes,
                'level': level,
                'update_time': result['update_time'],
                'timestamp': datetime.now()
            }

    return None


def parse_waiting_time_to_minutes(time_str):
    """
    將等候時間字符串轉換為分鐘數

    Args:
        time_str: str like "2.5 小時", "90 分鐘", "少於 30 分鐘"

    Returns:
        float: 分鐘數
    """
    if not time_str or time_str == '未有資料' or '未能' in time_str:
        return None

    # 匹配 "X.X 小時"
    hour_match = str(time_str).replace(' ', '').replace('小時', 'h')
    if 'h' in hour_match.lower():
        try:
            hours = float(hour_match.lower().replace('h', ''))
            return hours * 60
        except:
            pass

    # 匹配 "X 分鐘"
    min_match = str(time_str).replace(' ', '').replace('分鐘', 'm')
    if 'm' in min_match.lower():
        try:
            return float(min_match.lower().replace('m', ''))
        except:
            pass

    # 匹配 "少於 X 分鐘"
    if '少於' in str(time_str):
        import re
        match = re.search(r'([\d.]+)', str(time_str))
        if match:
            return float(match.group(1))

    return None


def get_waiting_time_level(minutes):
    """
    根據等候時間返回級別 (顏色編碼)

    Args:
        minutes: float or None

    Returns:
        int: 0=綠色<2h, 1=黃色2-4h, 2=橙色4-6h, 3=紅色>6h, -1=未知
    """
    if minutes is None:
        return -1

    if minutes < 120:  # < 2 小時
        return 0
    elif minutes < 240:  # 2-4 小時
        return 1
    elif minutes < 360:  # 4-6 小時
        return 2
    else:  # > 6 小時
        return 3


def save_waiting_time_history(history_file='models/ndh_waiting_history.csv', max_days=30):
    """
    保存等候時間到歷史記錄

    建議每小時運行一次，建立歷史數據庫
    """
    ndh_wait = get_ndh_waiting_time()

    if ndh_wait is None:
        print(f"   ⚠️ 無法獲取北區醫院等候時間")
        return False

    # 準備記錄
    record = {
        'datetime': ndh_wait['timestamp'].strftime('%Y-%m-%d %H:%M:%S'),
        't45p95': ndh_wait['t45p95'],
        't45p50': ndh_wait['t45p50'],
        't3p50': ndh_wait['t3p50'],
        'minutes': ndh_wait['minutes'] if ndh_wait['minutes'] is not None else '',
        'level': ndh_wait['level'],
        'update_time': ndh_wait['update_time']
    }

    # 讀取現有歷史
    if os.path.exists(history_file):
        history = pd.read_csv(history_file)
        history['datetime'] = pd.to_datetime(history['datetime'])
        new_record = pd.DataFrame([record])
        new_record['datetime'] = pd.to_datetime(new_record['datetime'])
        history = pd.concat([history, new_record], ignore_index=True)
    else:
        record_df = pd.DataFrame([record])
        record_df['datetime'] = pd.to_datetime(record_df['datetime'])
        history = record_df

    # 只保留最近 N 天
    cutoff = datetime.now() - timedelta(days=max_days)
    history = history[history['datetime'] >= cutoff].copy()

    # 保存
    os.makedirs('models', exist_ok=True)
    history.to_csv(history_file, index=False)

    print(f"   ✅ 已保存到 {history_file} ({len(history)} 筆記錄)")
    print(f"   📊 北區醫院等候: {ndh_wait['t45p95']} (級別 {ndh_wait['level']})")

    return True


def calculate_waiting_time_features(current_waiting=None, history_file='models/ndh_waiting_history.csv'):
    """
    計算等候時間相關特徵，用於模型預測

    特徵:
    1. ER_Waiting_Minutes: 當前等候時間（分鐘）
    2. ER_Waiting_Level: 等候級別 (0-3)
    3. ER_Waiting_Ratio: 當前/歷史平均比率
    4. ER_Waiting_Above_Normal: 是否高於正常 (0/1)
    5. ER_Waiting_Trend: 過去3小時趨勢

    Args:
        current_waiting: dict from get_ndh_waiting_time()
        history_file: path to history CSV

    Returns:
        dict of features
    """
    features = {
        'ER_Waiting_Minutes': 0,
        'ER_Waiting_Level': -1,
        'ER_Waiting_Ratio': 1.0,
        'ER_Waiting_Above_Normal': 0,
        'ER_Waiting_Trend_3h': 0
    }

    if current_waiting is None:
        current_waiting = get_ndh_waiting_time()

    if current_waiting is None:
        return features

    # 基礎特徵
    minutes = current_waiting['minutes']
    if minutes is not None:
        features['ER_Waiting_Minutes'] = minutes
        features['ER_Waiting_Level'] = current_waiting['level']

    # 歷史比較特徵
    if os.path.exists(history_file):
        try:
            history = pd.read_csv(history_file)
            history['datetime'] = pd.to_datetime(history['datetime'])
            history = history[history['minutes'] != '']  # 過濾空值
            history['minutes'] = pd.to_numeric(history['minutes'], errors='coerce')

            if len(history) > 0:
                # 同時段歷史平均 (過去 7 天同時段)
                current_hour = datetime.now().hour
                same_hour_data = history[
                    (pd.to_datetime(history['datetime']).dt.hour == current_hour) &
                    (history['datetime'] > datetime.now() - timedelta(days=7))
                ]

                if len(same_hour_data) > 0:
                    normal_minutes = same_hour_data['minutes'].median()

                    if normal_minutes > 0 and minutes is not None:
                        features['ER_Waiting_Ratio'] = minutes / normal_minutes
                        features['ER_Waiting_Above_Normal'] = int(minutes > normal_minutes * 1.2)

                # 過去 3 小時趨勢
                recent_data = history[
                    history['datetime'] > datetime.now() - timedelta(hours=3)
                ].tail(5)

                if len(recent_data) >= 2:
                    recent_minutes = recent_data['minutes'].values
                    # 簡單線性趨勢
                    if len(recent_minutes) > 0:
                        features['ER_Waiting_Trend_3h'] = (
                            (recent_minutes[-1] - recent_minutes[0]) / len(recent_minutes)
                            if len(recent_minutes) > 1 else 0
                        )

        except Exception as e:
            print(f"   ⚠️ 計算歷史特徵失敗: {e}")

    return features


def adjust_prediction_with_waiting_time(base_prediction, waiting_features):
    """
    根據等候時間調整基礎預測

    邏輯:
    - 等候時間高於正常 → 調高預測
    - 等候時間低於正常 → 調低預測

    Args:
        base_prediction: float, 原始預測值
        waiting_features: dict from calculate_waiting_time_features()

    Returns:
        float: 調整後的預測值
    """
    if not waiting_features or waiting_features['ER_Waiting_Minutes'] == 0:
        return base_prediction

    # 調整因子
    ratio = waiting_features['ER_Waiting_Ratio']
    above_normal = waiting_features['ER_Waiting_Above_Normal']

    # 調整公式
    if above_normal:
        # 高於正常：調高預測
        adjustment = 1 + (ratio - 1) * 0.4
    elif ratio < 0.8:
        # 低於正常：調低預測
        adjustment = 0.95
    else:
        # 正常範圍
        adjustment = 1.0

    # 限制調整範圍 ±25%
    adjustment = np.clip(adjustment, 0.75, 1.25)

    adjusted = base_prediction * adjustment

    # 確保調整後值合理
    adjusted = max(adjusted, 100)  # 最少 100 人
    adjusted = min(adjusted, 500)  # 最多 500 人

    return adjusted


def simulate_waiting_time_correlation():
    """
    模擬等候時間與就診人數的相關性

    需要收集歷史數據後才能準確計算
    """
    history_file = 'models/ndh_waiting_history.csv'

    if not os.path.exists(history_file):
        print("\n" + "=" * 60)
        print("📊 等候時間相關性分析")
        print("=" * 60)
        print("\n   ⚠️ 還沒有等候時間歷史數據")
        print("\n   🔧 開始收集數據:")
        print("      1. 運行: python -c \"from er_waiting_time import save_waiting_time_history; save_waiting_time_history()\"")
        print("      2. 設置 cron job 每小時運行一次")
        print("      3. 收集 1-2 週數據後進行分析")
        return

    history = pd.read_csv(history_file)
    history['datetime'] = pd.to_datetime(history['datetime'])

    print("\n" + "=" * 60)
    print("📊 等候時間歷史分析")
    print("=" * 60)
    print(f"\n   📅 數據範圍: {history['datetime'].min()} → {history['datetime'].max()}")
    print(f"   📊 記錄數: {len(history)} 筆")

    # 統計
    valid_data = history[history['minutes'] != '']
    valid_data['minutes'] = pd.to_numeric(valid_data['minutes'], errors='coerce')
    valid_data = valid_data.dropna(subset=['minutes'])

    if len(valid_data) > 0:
        print(f"\n   📈 等候時間統計:")
        print(f"      平均: {valid_data['minutes'].mean():.1f} 分鐘")
        print(f"      中位數: {valid_data['minutes'].median():.1f} 分鐘")
        print(f"      最小: {valid_data['minutes'].min():.1f} 分鐘")
        print(f"      最大: {valid_data['minutes'].max():.1f} 分鐘")

        # 級別分佈
        print(f"\n   🎨 級別分佈:")
        for level in range(4):
            count = len(valid_data[valid_data['level'] == level])
            pct = count / len(valid_data) * 100
            level_names = ['綠色<2h', '黃色2-4h', '橙色4-6h', '紅色>6h']
            print(f"      {level_names[level]}: {count} ({pct:.1f}%)")

    print(f"\n   💡 下一步:")
    print(f"      1. 收集至少 2 週數據")
    print(f"      2. 與 actual_data 表匹配")
    print(f"      3. 計算與就診人數的相關性")


# ========================================
# 快速測試
# ========================================

def main():
    """測試模組功能"""
    print("=" * 80)
    print("🏥 醫管局急診室等候時間整合測試")
    print("=" * 80)
    print(f"時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # 1. 測試獲取數據
    print("1️⃣ 獲取當前等候時間")
    ndh_wait = get_ndh_waiting_time()

    if ndh_wait:
        print(f"   ✅ 成功")
        print(f"   等候時間 (95分位): {ndh_wait['t45p95']}")
        print(f"   等候時間 (50分位): {ndh_wait['t45p50']}")
        print(f"   緊急類別: {ndh_wait['t3p50']}")
        print(f"   分鐘數: {ndh_wait['minutes']}")
        print(f"   級別: {ndh_wait['level']}")
    else:
        print(f"   ❌ 失敗")
        return

    # 2. 保存歷史
    print("\n2️⃣ 保存到歷史")
    save_waiting_time_history()

    # 3. 計算特徵
    print("\n3️⃣ 計算特徵")
    features = calculate_waiting_time_features(ndh_wait)
    for key, value in features.items():
        print(f"   {key}: {value}")

    # 4. 模擬調整預測
    print("\n4️⃣ 模擬預測調整")
    base_pred = 250
    adjusted = adjust_prediction_with_waiting_time(base_pred, features)
    print(f"   基礎預測: {base_pred}")
    print(f"   調整後: {adjusted:.1f}")
    print(f"   調整幅度: {(adjusted/base_pred - 1)*100:+.1f}%")

    # 5. 分析歷史
    print("\n5️⃣ 歷史分析")
    simulate_waiting_time_correlation()


if __name__ == '__main__':
    main()
