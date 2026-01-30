"""
醫管局急診室等候時間整合模組

使用實時等候時間數據來改善預測準確度
"""
import requests
import json
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import time
import os

# 醫管局 API
HA_ER_API = "https://www.ha.org.hk/hesd/nsapi/api/hospitals_er"

# 北區醫院代碼 (需要確認實際代碼)
NDH_HOSPITAL_CODES = ["NDH", "NDC", "PYN"]  # 可能的代碼


def fetch_er_waiting_times():
    """
    獲取所有醫院急診室等候時間

    返回: DataFrame with columns:
    - hospital_name
    - max_waiting_time
    - avg_waiting_time
    - critical_count
    - semi_critical_count
    - timestamp
    """
    try:
        print(f"📡 獲取醫管局急診室數據...")
        response = requests.get(HA_ER_API, timeout=30)
        response.raise_for_status()

        data = response.json()

        # 解析數據
        records = []
        timestamp = datetime.now()

        # 根據實際 API 結構調整
        if isinstance(data, list):
            for hospital in data:
                records.append({
                    'hospital_name': hospital.get('nameEn', ''),
                    'hospital_name_cn': hospital.get('nameChi', ''),
                    'max_waiting_time': hospital.get('maxWaitingTime', 0),
                    'avg_waiting_time': hospital.get('avgWaitingTime', 0),
                    'critical_count': hospital.get('critical', 0),
                    'semi_critical_count': hospital.get('semiCritical', 0),
                    'timestamp': timestamp
                })

        df = pd.DataFrame(records)

        if len(df) > 0:
            print(f"   ✅ 成功獲取 {len(df)} 間醫院的數據")
        else:
            print(f"   ⚠️ 沒有獲取到數據")

        return df

    except Exception as e:
        print(f"   ❌ 獲取數據失敗: {e}")
        return pd.DataFrame()


def get_ndh_waiting_time(df):
    """
    從等候時間數據中提取北區醫院數據

    可能的醫院名稱變體:
    - North District Hospital
    - 北區醫院
    - NDM (North District New)
    """
    if df is None or len(df) == 0:
        return None

    # 嘗試匹配北區醫院
    ndh_patterns = [
        'north district',
        '北區醫院',
        'NDH',
        'fanling',
        '粉嶺'
    ]

    for pattern in ndh_patterns:
        mask = df['hospital_name'].str.contains(pattern, case=False, na=False)
        if mask.any():
            return df[mask].iloc[0]

    return None


def build_waiting_time_history(output_path='models/er_waiting_history.csv', days=30):
    """
    構建等候時間歷史數據

    Args:
        output_path: 輸出 CSV 路徑
        days: 要保存的天數

    建議使用 cron/scheduler 每小時運行一次
    """
    # 獲取當前數據
    df = fetch_er_waiting_times()
    if df is None or len(df) == 0:
        return

    ndh_data = get_ndh_waiting_time(df)
    if ndh_data is None:
        print("   ⚠️ 未找到北區醫院數據")
        return

    # 添加到歷史
    record = {
        'datetime': ndh_data['timestamp'],
        'max_waiting_time': ndh_data['max_waiting_time'],
        'avg_waiting_time': ndh_data['avg_waiting_time'],
        'critical_count': ndh_data['critical_count'],
        'semi_critical_count': ndh_data['semi_critical_count']
    }

    # 讀取現有歷史
    if os.path.exists(output_path):
        history = pd.read_csv(output_path)
        history['datetime'] = pd.to_datetime(history['datetime'])
        history = pd.concat([history, pd.DataFrame([record])], ignore_index=True)
    else:
        history = pd.DataFrame([record])

    # 只保留最近 N 天
    cutoff = datetime.now() - timedelta(days=days)
    history = history[history['datetime'] >= cutoff]

    # 保存
    history.to_csv(output_path, index=False)
    print(f"   ✅ 已保存到 {output_path} ({len(history)} 筆記錄)")

    return record


def calculate_waiting_time_features(today_waiting_time, history_df=None):
    """
    計算等候時間相關特徵

    Args:
        today_waiting_time: dict with keys (max_waiting_time, avg_waiting_time, etc.)
        history_df: 歷史等候時間數據

    Returns:
        dict of features to add to prediction model
    """
    features = {}

    if today_waiting_time is None:
        # 沒有數據，返回默認值
        return {
            'ER_Waiting_Max': 0,
            'ER_Waiting_Avg': 0,
            'ER_Waiting_Ratio': 1.0,
            'ER_Critical_Count': 0,
            'ER_SemiCritical_Count': 0,
            'ER_Waiting_Above_Normal': 0
        }

    # 基礎特徵
    features['ER_Waiting_Max'] = today_waiting_time['max_waiting_time']
    features['ER_Waiting_Avg'] = today_waiting_time['avg_waiting_time']
    features['ER_Critical_Count'] = today_waiting_time['critical_count']
    features['ER_SemiCritical_Count'] = today_waiting_time['semi_critical_count']

    # 歷史對比特徵
    if history_df is not None and len(history_df) > 7:
        # 計算「正常」等候時間 (過去 7 天同時段的中位數)
        current_hour = datetime.now().hour
        same_hour_data = history_df[
            pd.to_datetime(history_df['datetime']).dt.hour == current_hour
        ]

        if len(same_hour_data) > 0:
            normal_max_wait = same_hour_data['max_waiting_time'].median()
            normal_avg_wait = same_hour_data['avg_waiting_time'].median()

            # 當前 vs 正常
            features['ER_Waiting_Ratio'] = (
                today_waiting_time['max_waiting_time'] / normal_max_wait
                if normal_max_wait > 0 else 1.0
            )

            # 是否高於正常
            features['ER_Waiting_Above_Normal'] = int(
                today_waiting_time['max_waiting_time'] > normal_max_wait * 1.2
            )
        else:
            features['ER_Waiting_Ratio'] = 1.0
            features['ER_Waiting_Above_Normal'] = 0
    else:
        features['ER_Waiting_Ratio'] = 1.0
        features['ER_Waiting_Above_Normal'] = 0

    return features


def adjust_prediction_with_waiting_time(base_prediction, waiting_features, historical_correlation=None):
    """
    根據等候時間調整基礎預測

    Args:
        base_prediction: 模型原始預測值
        waiting_features: 等候時間特徵
        historical_correlation: 歷史相關性係數 (可從訓練數據計算)

    Returns:
        調整後的預測值
    """
    if waiting_features['ER_Waiting_Max'] == 0:
        return base_prediction

    # 默認調整參數 (可以從歷史數據學習)
    waiting_ratio = waiting_features['ER_Waiting_Ratio']

    # 調整公式
    # 等候時間高於正常 → 調高預測
    # 等候時間低於正常 → 調低預測
    adjustment_factor = 1 + (waiting_ratio - 1) * 0.3  # 30% 靈敏度

    # 限制調整範圍 (±20%)
    adjustment_factor = np.clip(adjustment_factor, 0.8, 1.2)

    adjusted = base_prediction * adjustment_factor

    return adjusted


def simulate_waiting_time_impact():
    """
    模擬等候時間對預測的影響

    使用歷史等候時間數據評估潛在改善
    """
    print("=" * 80)
    print("🔬 模擬等候時間特徵影響")
    print("=" * 80)

    # 加載等候時間歷史
    history_path = 'models/er_waiting_history.csv'

    if not os.path.exists(history_path):
        print("\n   ⚠️ 沒有歷史等候時間數據")
        print("\n   🔧 要開始收集數據，運行:")
        print("      python collect_er_waiting_time.py")
        return

    history = pd.read_csv(history_path)
    history['datetime'] = pd.to_datetime(history['datetime'])

    print(f"\n   📊 歷史數據: {len(history)} 筆")
    print(f"   📅 日期範圍: {history['datetime'].min()} → {history['datetime'].max()}")

    # 統計
    print(f"\n   📈 等候時間統計:")
    print(f"      平均最大等候: {history['max_waiting_time'].mean():.1f} 分鐘")
    print(f"      平均等候: {history['avg_waiting_time'].mean():.1f} 分鐘")
    print(f"      平均頂症: {history['critical_count'].mean():.1f} 人")
    print(f"      平均經急症: {history['semi_critical_count'].mean():.1f} 人")

    # 與就診人數的相關性 (如果有匹配的日期)
    print(f"\n   💡 建議下一步:")
    print(f"      1. 收集至少 2 週等候時間數據")
    print(f"      2. 與實際就診人數匹配")
    print(f"      3. 計算相關性")
    print(f"      4. 將特徵加入模型")

    return history


# ========================================
# 數據收集腳本 (定時運行)
# ========================================

def main():
    """
    主函數 - 獲取並保存當前等候時間
    建議每小時運行一次
    """
    print("=" * 80)
    print("🏥 醫管局急診室等候時間收集")
    print("=" * 80)
    print(f"時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    record = build_waiting_time_history()

    if record:
        print(f"\n📊 北區醫院急診室狀態:")
        print(f"   最長等候: {record['max_waiting_time']} 分鐘")
        print(f"   平均等候: {record['avg_waiting_time']} 分鐘")
        print(f"   頂症人數: {record['critical_count']}")
        print(f"   經急症人數: {record['semi_critical_count']}")


if __name__ == '__main__':
    main()
