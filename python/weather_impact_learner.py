#!/usr/bin/env python3
"""
天氣影響學習模型
Weather Impact Learning Model

基於歷史數據學習不同天氣條件對 attendance 的影響

Version: 4.0.00
Author: Ma Tsz Kiu
Date: 2026-01-18
"""

import psycopg2
import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression
from datetime import datetime, timedelta
import os
from dotenv import load_dotenv
import json

def fetch_learning_data(conn, days=365):
    """獲取學習數據"""
    query = f"""
        SELECT
            date,
            actual_attendance,
            xgboost_base_pred,
            prediction_error,

            -- 天氣特徵
            temp_min,
            temp_max,
            rainfall_mm,
            wind_kmh,
            humidity_pct,
            pressure_hpa,

            -- 極端條件
            is_very_cold,
            is_very_hot,
            is_heavy_rain,
            is_strong_wind

        FROM learning_records
        WHERE actual_attendance IS NOT NULL
          AND xgboost_base_pred IS NOT NULL
          AND date >= CURRENT_DATE - INTERVAL '{days} days'
    """

    return pd.read_sql_query(query, conn)

def prepare_features(df):
    """準備機器學習特徵"""

    # 目標變量: 實際 attendance vs XGBoost 預測的差異
    df['target_impact'] = df['actual_attendance'] - df['xgboost_base_pred']

    # 特徵工程
    features = []

    # 1. 連續特徵
    continuous_features = [
        'temp_min', 'temp_max', 'rainfall_mm',
        'wind_kmh', 'humidity_pct', 'pressure_hpa'
    ]

    # 2. 二元特徵
    binary_features = [
        'is_very_cold', 'is_very_hot',
        'is_heavy_rain', 'is_strong_wind',
        'is_low_humidity', 'is_high_pressure', 'is_rain_day'
    ]

    # 3. 從連續變量導出 (learning_records 無此欄位；依 004 註釋: humidity<50, pressure>1020, rain>0)
    if 'humidity_pct' in df.columns:
        df['is_low_humidity'] = (df['humidity_pct'] < 50).fillna(False).astype(int)
    else:
        df['is_low_humidity'] = 0
    if 'pressure_hpa' in df.columns:
        df['is_high_pressure'] = (df['pressure_hpa'] > 1020).fillna(False).astype(int)
    else:
        df['is_high_pressure'] = 0
    if 'rainfall_mm' in df.columns:
        df['is_rain_day'] = (df['rainfall_mm'] > 0).fillna(False).astype(int)
    else:
        df['is_rain_day'] = 0

    # 4. 交互特徵
    df['cold_rain'] = df['is_very_cold'] & df['is_heavy_rain']
    df['hot_rain'] = df['is_very_hot'] & df['is_heavy_rain']

    all_features = continuous_features + binary_features + ['cold_rain', 'hot_rain']

    # 處理缺失值
    for col in all_features:
        if col not in df.columns:
            df[col] = 0
        df[col] = df[col].fillna(0)

    X = df[all_features]
    y = df['target_impact']

    return X, y, all_features

def train_impact_model(conn):
    """訓練天氣影響模型"""

    # 1. 獲取數據
    df = fetch_learning_data(conn)

    if len(df) < 50:
        print(f"⚠️ Not enough data: {len(df)} samples (need >= 50)")
        return None, None

    # 2. 準備特徵
    X, y, feature_names = prepare_features(df)

    # 3. 訓練模型
    model = LinearRegression()
    model.fit(X, y)

    # 4. 評估
    score = model.score(X, y)
    mae = np.mean(np.abs(model.predict(X) - y))

    # 5. 提取影響參數
    impacts = {}
    for i, feature in enumerate(feature_names):
        impacts[feature] = {
            'coefficient': float(model.coef_[i]),
            'abs_impact': abs(float(model.coef_[i]))
        }

    # 6. 更新數據庫
    cur = conn.cursor()

    for feature, data in impacts.items():
        cur.execute("""
            INSERT INTO weather_impact_parameters (
                parameter_name,
                parameter_value,
                sample_count,
                is_active
            ) VALUES (%s, %s, %s, %s)
            ON CONFLICT (parameter_name) DO UPDATE SET
                parameter_value = EXCLUDED.parameter_value,
                sample_count = EXCLUDED.sample_count,
                last_updated = NOW()
        """, (feature, data['coefficient'], len(df), True))

    conn.commit()
    cur.close()

    print(f"✅ Weather impact model trained")
    print(f"   Samples: {len(df)}")
    print(f"   R² = {score:.3f}")
    print(f"   MAE = {mae:.2f}")

    return model, impacts

def update_combination_impacts(conn):
    """更新天氣條件組合影響"""

    # 計算基線平均
    cur = conn.cursor()
    cur.execute("""
        SELECT AVG(actual_attendance), STDDEV(actual_attendance), COUNT(*)
        FROM learning_records
        WHERE actual_attendance IS NOT NULL
    """)
    result = cur.fetchone()
    baseline_mean = float(result[0]) if result[0] else 250
    baseline_std = float(result[1]) if result[1] else 20

    # 分析各種組合
    combinations = [
        ('very_cold', 'is_very_cold = TRUE'),
        ('very_hot', 'is_very_hot = TRUE'),
        ('heavy_rain', 'is_heavy_rain = TRUE'),
        ('strong_wind', 'is_strong_wind = TRUE'),
        ('cold_and_rain', 'is_very_cold = TRUE AND is_heavy_rain = TRUE'),
        ('hot_and_rain', 'is_very_hot = TRUE AND is_heavy_rain = TRUE'),
        ('cold_and_wind', 'is_very_cold = TRUE AND is_strong_wind = TRUE'),
    ]

    updated_count = 0

    for name, condition in combinations:
        cur.execute(f"""
            SELECT
                COUNT(*) as n,
                AVG(actual_attendance) as mean_att,
                STDDEV(actual_attendance) as std_att
            FROM learning_records
            WHERE {condition}
              AND actual_attendance IS NOT NULL
        """)

        result = cur.fetchone()
        n, mean_att, std_att = result

        if n < 5:  # 樣本太少
            continue

        impact_factor = mean_att / baseline_mean
        impact_absolute = mean_att - baseline_mean

        # t-test
        t_stat = impact_absolute / (std_att / np.sqrt(n)) if std_att > 0 else 0

        cur.execute("""
            INSERT INTO weather_combination_impacts (
                conditions_json,
                sample_count,
                mean_attendance,
                std_attendance,
                baseline_mean,
                impact_factor,
                impact_absolute,
                t_statistic,
                last_seen
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (conditions_json) DO UPDATE SET
                sample_count = EXCLUDED.sample_count,
                impact_factor = EXCLUDED.impact_factor,
                impact_absolute = EXCLUDED.impact_absolute,
                t_statistic = EXCLUDED.t_statistic,
                last_seen = EXCLUDED.last_seen,
                last_updated = NOW()
        """, (
            json.dumps({'condition': name}),
            n, mean_att, std_att, baseline_mean,
            impact_factor, impact_absolute, t_stat,
            datetime.now().date()
        ))

        updated_count += 1

    conn.commit()
    cur.close()

    print(f"✅ Updated {updated_count} weather combinations")

    return updated_count

def update_ai_event_learning(conn):
    """更新 AI 事件學習"""
    cur = conn.cursor()

    # 獲取所有 AI 事件的統計
    cur.execute("""
        SELECT
            ai_event_type,
            COUNT(*) as total_occurrences,
            AVG(ai_factor) as avg_ai_factor,
            AVG(prediction_error) as avg_error
        FROM learning_records
        WHERE ai_event_type IS NOT NULL
          AND actual_attendance IS NOT NULL
        GROUP BY ai_event_type
        HAVING COUNT(*) >= 3
    """)

    events = cur.fetchall()
    updated_count = 0

    for event_type, count, avg_factor, avg_error in events:
        # 計算準確性 (AI 方向是否正確)
        cur.execute("""
            SELECT
                COUNT(*) as total,
                COUNT(CASE
                    WHEN (ai_factor < 1 AND prediction_error < 0) OR
                         (ai_factor > 1 AND prediction_error > 0) OR
                         (ABS(ai_factor - 1) < 0.01 AND ABS(prediction_error) < 5)
                    THEN 1
                END) as correct
            FROM learning_records
            WHERE ai_event_type = %s
              AND actual_attendance IS NOT NULL
        """, (event_type,))

        result = cur.fetchone()
        total = result[0]
        correct = result[1]
        accuracy = correct / total if total > 0 else 0

        # 信度評估
        if total >= 20:
            confidence = 'high'
        elif total >= 10:
            confidence = 'medium'
        else:
            confidence = 'low'

        cur.execute("""
            INSERT INTO ai_event_learning (
                event_type,
                event_pattern,
                total_occurrences,
                avg_ai_factor,
                avg_actual_impact,
                avg_actual_impact_pct,
                correct_predictions,
                prediction_accuracy,
                confidence_level,
                last_occurrence
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (event_type, event_pattern) DO UPDATE SET
                total_occurrences = EXCLUDED.total_occurrences,
                avg_ai_factor = EXCLUDED.avg_ai_factor,
                avg_actual_impact = EXCLUDED.avg_actual_impact,
                prediction_accuracy = EXCLUDED.prediction_accuracy,
                confidence_level = EXCLUDED.confidence_level,
                last_occurrence = EXCLUDED.last_occurrence,
                last_updated = NOW()
        """, (
            event_type,
            event_type,
            count,
            avg_factor,
            avg_error,
            (avg_error / 250 * 100) if avg_error else 0,
            correct,
            accuracy,
            confidence,
            datetime.now().date()
        ))

        updated_count += 1

    conn.commit()
    cur.close()

    print(f"✅ Updated {updated_count} AI event learnings")

    return updated_count

def main():
    """主函數"""
    load_dotenv()
    conn = psycopg2.connect(os.getenv('DATABASE_URL'))

    print("=" * 60)
    print("Weather Impact Learning v4.0.00")
    print("=" * 60)
    print()

    # 1. 訓練影響模型
    model, impacts = train_impact_model(conn)

    # 2. 更新組合影響
    update_combination_impacts(conn)

    # 3. 更新 AI 事件學習
    update_ai_event_learning(conn)

    conn.close()
    print()
    print("✅ Learning complete")

if __name__ == '__main__':
    main()
