# 自動學習系統設計文檔
## Continuous Learning System Design

> **版本**: 4.0.00
> **日期**: 2026-01-18
> **作者**: Ma Tsz Kiu

---

## 目錄

1. [系統概述](#系統概述)
2. [架構設計](#架構設計)
3. [數據庫 Schema](#數據庫-schema)
4. [Phase 1: 自動記錄系統](#phase-1-自動記錄系統)
5. [Phase 2: 異常檢測與 Flag 機制](#phase-2-異常檢測與-flag-機制)
6. [Phase 3: 學習迴歸模型](#phase-3-學習迴歸模型)
7. [Phase 4: 預測整合](#phase-4-預測整合)
8. [API 設計](#api-設計)
9. [部署策略](#部署策略)
10. [監控與警報](#監控與警報)

---

## 系統概述

### 目標

建立一個 **持續學習系統**，自動從真實數據中學習：

1. **天氣因素影響** - 自動計算不同天氣條件對 attendance 的影響
2. **AI 因素影響** - 驗證 AI 生成的因素是否有效
3. **天氣預報整合** - 用未來天氣預測調整預測值

### 當前狀態

| 組件 | 狀態 | 描述 |
|------|------|------|
| XGBoost 模型 | ✅ 運行中 | MAE: 2.85, 使用最佳 10 特徵 |
| 天氣影響分析 | ✅ 靜態 | `weather_impact_analysis.json` (寒潮 -6.8%) |
| AI 因子驗證 | ✅ 雙軌道 | `dual_track_predictions.sql` 已部署 |
| 天氣預報整合 | 🚧 待實現 | `weather_forecast_integration.py` 存在但未整合 |
| 持續學習 | ❌ 未實現 | **本設計的目標** |

### 學習循環

```
┌─────────────────────────────────────────────────────────────────┐
│                     自動學習循環 (每日執行)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐          │
│  │  1. 獲取新   │ -> │  2. 計算    │ -> │  3. 檢測    │          │
│  │     實際數據 │    │     Gap    │    │   異常      │          │
│  └─────────────┘    └─────────────┘    └─────────────┘          │
│         │                   │                   │                │
│         ▼                   ▼                   ▼                │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐          │
│  │  4. 分析    │ <- │  5. 標記    │ <- │  6. 記錄    │          │
│  │   天氣/AI  │    │   類似日   │    │   到DB     │          │
│  └─────────────┘    └─────────────┘    └─────────────┘          │
│         │                                                   │     │
│         ▼                                                   │     │
│  ┌─────────────┐                                            │     │
│  │  7. 更新    │ ──────────────────────────────────────────┘     │
│  │  影響參數   │                                                  │
│  └─────────────┘                                                  │
│         │                                                         │
│         ▼                                                         │
│  ┌─────────────┐                                                  │
│  │  8. 重新訓練 │ ─── (可選，每30天)                              │
│  │   XGBoost   │                                                  │
│  └─────────────┘                                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 架構設計

### 系統組件圖

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Railway Production                          │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐         ┌──────────────┐         ┌──────────────┐ │
│  │  Node.js     │         │  PostgreSQL  │         │  Python      │ │
│  │  Backend     │────────▶│  Database    │◀────────│  Learning    │ │
│  │              │◀────────│              │────────▶│  Engine      │ │
│  └──────────────┘         └──────────────┘         └──────────────┘ │
│         │                         │                         │        │
│         │ API                     │                         │        │
│         ▼                         ▼                         ▼        │
│  ┌──────────────┐         ┌──────────────┐         ┌──────────────┐│
│  │  Frontend    │         │  Tables:     │         │  Scripts:    ││
│  │  Dashboard   │         │  - actual_   │         │  - weather_  ││
│  │              │         │    data      │         │    learner.py││
│  └──────────────┘         │  - daily_    │         │  - ai_       ││
│                           │    predictions│         │    learner.py││
│                           │  - learning_  │         │  - forecast_ ││
│                           │    records    │         │    predictor.py│
│                           └──────────────┘         └──────────────┘│
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ 外部數據源
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  ┌──────────────┐         ┌──────────────┐         ┌──────────────┐│
│  │  HKO Weather │         │  HKO 9-Day   │         │  AI Service  ││
│  │  API         │────────▶│  Forecast    │────────▶│  (OpenAI)    ││
│  │  (歷史數據)  │         │  (預報數據)  │         │              ││
│  └──────────────┘         └──────────────┘         └──────────────┘│
└──────────────────────────────────────────────────────────────────────┘
```

### 數據流圖

```
┌────────────────────────────────────────────────────────────────────────┐
│                         每日自動學習流程                                 │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  00:00 ──────────────────────────────────────────────────────────     │
│    │                                                                   │
│    ├─ Cron Job 觸發                                                   │
│    │                                                                   │
│    ▼                                                                   │
│  00:05 ──────────────────────────────────────────────────────────     │
│    │                                                                   │
│    ├─ 1. 獲取昨日實際 attendance                                       │
│    │   從 actual_data 表                                               │
│    │                                                                   │
│    ├─ 2. 獲取昨日預測值                                               │
│    │   從 daily_predictions 表                                         │
│    │                                                                   │
│    ├─ 3. 計算預測誤差                                                 │
│    │   gap = actual - predicted                                       │
│    │                                                                   │
│    ▼                                                                   │
│  00:10 ──────────────────────────────────────────────────────────     │
│    │                                                                   │
│    ├─ 4. 獲取昨日天氣數據                                             │
│    │   從 weather_history 表 或 HKO API                                │
│    │                                                                   │
│    ├─ 5. 獲取昨日 AI factor                                           │
│    │   從 ai_factor_validation 表                                      │
│    │                                                                   │
│    ├─ 6. 檢測異常條件                                                 │
│    │   if |gap| > threshold (e.g., 15)                                │
│    │       flag as anomaly                                            │
│    │                                                                   │
│    ▼                                                                   │
│  00:15 ──────────────────────────────────────────────────────────     │
│    │                                                                   │
│    ├─ 7. 更新天氣影響參數                                             │
│    │   基於當天條件 + gap                                             │
│    │                                                                   │
│    ├─ 8. 更新 AI 因素驗證                                             │
│    │   記錄 AI 預測是否正確                                           │
│    │                                                                   │
│    ├─ 9. 保存學習記錄                                                 │
│    │   到 learning_records 表                                         │
│    │                                                                   │
│    ▼                                                                   │
│  00:20 ──────────────────────────────────────────────────────────     │
│    │                                                                   │
│    ├─ 10. 檢查是否需要重新訓練                                        │
│    │    if (新樣本數 >= 30) AND (上次訓練 > 30天)                      │
│    │        觸發 XGBoost 重新訓練                                      │
│    │                                                                   │
│    ├─ 11. 檢查是否需要更新權重                                        │
│    │    if (驗證樣本 >= 30)                                           │
│    │        運行權重優化腳本                                           │
│    │                                                                   │
│    ▼                                                                   │
│  00:25 ──────────────────────────────────────────────────────────     │
│    │                                                                   │
│    └─ 完成，等待明天                                                   │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 數據庫 Schema

### 新增表格

```sql
-- ============================================================
-- Migration 004: Continuous Learning System
-- 自動學習系統數據庫結構
-- ============================================================

-- 1. 天氣歷史數據表 (用於快速查詢)
CREATE TABLE IF NOT EXISTS weather_history (
    date DATE PRIMARY KEY,
    temp_min NUMERIC(5,2),
    temp_max NUMERIC(5,2),
    temp_mean NUMERIC(5,2),
    humidity_pct NUMERIC(5,2),
    rainfall_mm NUMERIC(6,2),
    wind_kmh NUMERIC(5,2),
    pressure_hpa NUMERIC(7,2),
    visibility_km NUMERIC(5,2),
    cloud_pct NUMERIC(5,2),
    sunshine_hrs NUMERIC(4,2),
    dew_point NUMERIC(5,2),

    -- 天氣警告
    typhoon_signal VARCHAR(10),      -- T1, T3, T8, T8NE, T8NW, T8SE, T8SW, T9, T10
    rainstorm_warning VARCHAR(20),   -- AMBER, RED, BLACK
    cold_warning BOOLEAN,
    hot_warning BOOLEAN,

    -- 極端條件標記 (計算欄位)
    is_very_cold BOOLEAN,            -- temp_min <= 12
    is_very_hot BOOLEAN,             -- temp_max >= 33
    is_heavy_rain BOOLEAN,           -- rainfall_mm > 25
    is_strong_wind BOOLEAN,          -- wind_kmh > 30
    is_low_humidity BOOLEAN,         -- humidity_pct < 50
    is_high_pressure BOOLEAN,        -- pressure_hpa > 1020

    data_fetch_time TIMESTAMP DEFAULT NOW()
);

-- 2. 學習記錄表 (核心學習數據)
CREATE TABLE IF NOT EXISTS learning_records (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,

    -- 預測 vs 實際
    xgboost_base_pred NUMERIC(10,2),
    final_prediction NUMERIC(10,2),
    actual_attendance NUMERIC(10,2),
    prediction_error NUMERIC(10,2),
    error_pct NUMERIC(6,2),

    -- 天氣條件
    temp_min NUMERIC(5,2),
    temp_max NUMERIC(5,2),
    rainfall_mm NUMERIC(6,2),
    wind_kmh NUMERIC(5,2),
    humidity_pct NUMERIC(5,2),
    pressure_hpa NUMERIC(7,2),

    -- 極端天氣標記
    is_very_cold BOOLEAN,
    is_very_hot BOOLEAN,
    is_heavy_rain BOOLEAN,
    is_strong_wind BOOLEAN,
    typhoon_signal VARCHAR(10),

    -- AI 因素
    ai_factor NUMERIC(5,3),
    ai_event_type VARCHAR(100),
    ai_description TEXT,

    -- 學習結果
    weather_impact_learned NUMERIC(6,3),     -- 學習到的天氣影響
    ai_impact_learned NUMERIC(6,3),          -- 學習到的 AI 影響
    is_anomaly BOOLEAN,                      -- 是否為異常值
    anomaly_reason TEXT,                     -- 異常原因

    -- 元數據
    created_at TIMESTAMP DEFAULT NOW(),
    processed BOOLEAN DEFAULT FALSE          -- 是否已被學習模型處理
);

-- 3. 天氣影響參數表 (動態更新)
CREATE TABLE IF NOT EXISTS weather_impact_parameters (
    id SERIAL PRIMARY KEY,
    parameter_name VARCHAR(50) NOT NULL,
    parameter_value NUMERIC(8,4) NOT NULL,
    sample_count INTEGER NOT NULL,
    confidence_interval_lower NUMERIC(8,4),
    confidence_interval_upper NUMERIC(8,4),
    p_value NUMERIC(8,6),
    last_updated TIMESTAMP DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(parameter_name)
);

-- 4. 天氣條件組合影響表
CREATE TABLE IF NOT EXISTS weather_combination_impacts (
    id SERIAL PRIMARY KEY,

    -- 條件組合 (JSON 格式)
    -- 例: {"is_very_cold": true, "is_heavy_rain": true}
    conditions_json JSONB NOT NULL,

    -- 統計數據
    sample_count INTEGER NOT NULL,
    mean_attendance NUMERIC(10,2),
    std_attendance NUMERIC(10,2),
    baseline_mean NUMERIC(10,2),
    impact_factor NUMERIC(6,3),           -- 平均 attendance / baseline
    impact_absolute NUMERIC(8,2),         -- mean - baseline

    -- 統計顯著性
    t_statistic NUMERIC(8,4),
    p_value NUMERIC(8,6),
    is_significant BOOLEAN DEFAULT FALSE,

    last_seen DATE,
    last_updated TIMESTAMP DEFAULT NOW(),

    -- 唯一約束: 相同條件組合
    UNIQUE(conditions_json)
);

-- 5. AI 事件學習表
CREATE TABLE IF NOT EXISTS ai_event_learning (
    id SERIAL PRIMARY KEY,

    -- 事件分類
    event_type VARCHAR(100) NOT NULL,
    event_pattern VARCHAR(200),           -- 事件模式 (如 "marathon", "holiday")

    -- 統計數據
    total_occurrences INTEGER NOT NULL,
    avg_ai_factor NUMERIC(6,3),
    avg_actual_impact NUMERIC(8,2),      -- 實際平均影響 (人數)
    avg_actual_impact_pct NUMERIC(6,3),  -- 實際平均影響 (%)

    -- 預測準確性
    correct_predictions INTEGER,          -- AI 方向正確的次數
    prediction_accuracy NUMERIC(5,3),     -- 正確率

    -- 信度
    confidence_level VARCHAR(20),         -- 'high', 'medium', 'low'
    min_sample_threshold INTEGER DEFAULT 10,

    last_occurrence DATE,
    last_updated TIMESTAMP DEFAULT NOW(),

    UNIQUE(event_type, event_pattern)
);

-- 6. 天氣預報緩存表
CREATE TABLE IF NOT EXISTS weather_forecast_cache (
    id SERIAL PRIMARY KEY,
    forecast_date DATE NOT NULL,
    fetch_date TIMESTAMP DEFAULT NOW(),

    -- 預報數據 (來自 HKO 9-Day Forecast)
    temp_min_forecast NUMERIC(5,2),
    temp_max_forecast NUMERIC(5,2),
    rain_prob_forecast VARCHAR(20),       -- Low, Medium, High, Very High
    weather_desc TEXT,

    -- 預測的天氣影響
    predicted_impact_factor NUMERIC(6,3),
    predicted_impact_absolute NUMERIC(8,2),
    confidence_level VARCHAR(20),

    -- 驗證 (之後更新)
    actual_temp_min NUMERIC(5,2),
    actual_temp_max NUMERIC(5,2),
    forecast_error_temp NUMERIC(5,2),
    forecast_accuracy BOOLEAN,

    UNIQUE(forecast_date, fetch_date)
);

-- 7. 異常事件日誌
CREATE TABLE IF NOT EXISTS anomaly_events (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    anomaly_type VARCHAR(50) NOT NULL,    -- 'weather', 'ai', 'unknown'

    -- 異常詳情
    prediction_error NUMERIC(10,2),
    error_std_deviations NUMERIC(6,2),   -- 誤差是標準差的幾倍

    -- 當日條件
    conditions_json JSONB,

    -- 處理狀態
    is_explained BOOLEAN DEFAULT FALSE,
    explanation TEXT,
    requires_review BOOLEAN DEFAULT TRUE,

    -- 後續追蹤
    similar_event_count INTEGER,          -- 類似事件發生次數
    next_similar_date DATE,

    created_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP
);

-- 索引優化
CREATE INDEX IF NOT EXISTS idx_learning_records_date ON learning_records(date DESC);
CREATE INDEX IF NOT EXISTS idx_learning_records_anomaly ON learning_records(is_anomaly, date DESC);
CREATE INDEX IF NOT EXISTS idx_weather_history_date ON weather_history(date DESC);
CREATE INDEX IF NOT EXISTS idx_weather_conditions ON weather_history(is_very_cold, is_very_hot, is_heavy_rain);
CREATE INDEX IF NOT EXISTS idx_weather_combo_conditions ON weather_combination_impacts USING GIN(conditions_json);
CREATE INDEX IF NOT EXISTS idx_ai_event_pattern ON ai_event_learning(event_type, event_pattern);
CREATE INDEX IF NOT EXISTS idx_forecast_date ON weather_forecast_cache(forecast_date DESC);
CREATE INDEX IF NOT EXISTS idx_anomaly_type ON anomaly_events(anomaly_type, is_explained);

-- 視圖: 當前天氣影響參數摘要
CREATE OR REPLACE VIEW current_weather_impacts AS
SELECT
    parameter_name,
    parameter_value,
    sample_count,
    confidence_interval_lower,
    confidence_interval_upper,
    p_value,
    CASE
        WHEN p_value < 0.001 THEN '***'
        WHEN p_value < 0.01 THEN '**'
        WHEN p_value < 0.05 THEN '*'
        ELSE 'n.s.'
    END as significance,
    last_updated
FROM weather_impact_parameters
WHERE is_active = TRUE
ORDER BY ABS(parameter_value) DESC;

-- 視圖: AI 事件學習摘要
CREATE OR REPLACE VIEW ai_learning_summary AS
SELECT
    event_type,
    event_pattern,
    total_occurrences,
    avg_ai_factor,
    avg_actual_impact_pct,
    prediction_accuracy,
    confidence_level,
    last_occurrence
FROM ai_event_learning
WHERE total_occurrences >= 5
ORDER BY total_occurrences DESC;

-- 視圖: 異常統計
CREATE OR REPLACE VIEW anomaly_stats AS
SELECT
    COUNT(*) as total_anomalies,
    COUNT(CASE WHEN is_explained THEN 1 END) as explained_anomalies,
    COUNT(CASE WHEN requires_review THEN 1 END) as pending_review,
    AVG(prediction_error) as avg_error,
    MAX(date) as latest_anomaly
FROM anomaly_events
WHERE created_at >= CURRENT_DATE - INTERVAL '90 days';

COMMENT ON TABLE learning_records IS '核心學習記錄表，記錄每天的預測、實際、條件和學習結果';
COMMENT ON TABLE weather_impact_parameters IS '動態更新的天氣影響參數';
COMMENT ON TABLE weather_combination_impacts IS '天氣條件組合對 attendance 的影響';
COMMENT ON TABLE ai_event_learning IS 'AI 事件模式學習結果';
COMMENT ON TABLE weather_forecast_cache IS '天氣預報緩存，用於預測調整';
COMMENT ON TABLE anomaly_events IS '異常事件記錄和追蹤';
```

---

## Phase 1: 自動記錄系統

### 目標

自動記錄每天的：
1. 預測值 vs 實際值
2. 天氣條件
3. AI 因素
4. 預測誤差

### 實現文件

#### `python/continuous_learner.py`

```python
#!/usr/bin/env python3
"""
Continuous Learning Engine
自動學習天氣和 AI 因素對 attendance 的影響

Daily Cron Job:
1. 獲取昨日實際數據
2. 獲取昨日預測
3. 計算誤差
4. 分析天氣條件
5. 分析 AI 因素
6. 更新學習記錄
"""

import os
import sys
import psycopg2
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from dotenv import load_dotenv
import json
import requests

# ============================================================
# Configuration
# ============================================================

HKO_WEATHER_API = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=tc"
ANOMALY_THRESHOLD = 15.0  # 誤差 > 15 人視為異常
HIGH_ANOMALY_THRESHOLD = 30.0  # 誤差 > 30 人視為高異常

# ============================================================
# Database Connection
# ============================================================

def get_db_connection():
    """獲取數據庫連接"""
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
    return conn

# ============================================================
# Data Collection
# ============================================================

def fetch_yesterday_data(date):
    """獲取指定日期的所有相關數據"""

    conn = get_db_connection()
    cur = conn.cursor()

    data = {
        'date': date,
        'actual': None,
        'prediction': None,
        'ai_factor': None,
        'weather': None
    }

    # 1. 獲取實際 attendance
    cur.execute("""
        SELECT patient_count
        FROM actual_data
        WHERE date = %s
    """, (date,))
    result = cur.fetchone()
    if result:
        data['actual'] = result[0]

    # 2. 獲取預測值
    cur.execute("""
        SELECT
            xgboost_base,
            prediction_production,
            prediction_experimental,
            ai_factor,
            weather_factor
        FROM daily_predictions
        WHERE target_date = %s
        ORDER BY prediction_date DESC
        LIMIT 1
    """, (date,))
    result = cur.fetchone()
    if result:
        data['prediction'] = {
            'xgboost_base': float(result[0]) if result[0] else None,
            'production': float(result[1]) if result[1] else None,
            'experimental': float(result[2]) if result[2] else None,
            'ai_factor': float(result[3]) if result[3] else None,
            'weather_factor': float(result[4]) if result[4] else None,
        }

    # 3. 獲取 AI factor 詳情
    cur.execute("""
        SELECT
            event_type,
            event_description,
            ai_factor
        FROM ai_factor_validation
        WHERE prediction_date = %s
    """, (date,))
    result = cur.fetchone()
    if result:
        data['ai_factor'] = {
            'event_type': result[0],
            'description': result[1],
            'factor': float(result[2]) if result[2] else None
        }

    # 4. 獲取天氣數據
    cur.execute("""
        SELECT
            temp_min, temp_max, temp_mean,
            humidity_pct, rainfall_mm, wind_kmh,
            pressure_hpa, visibility_km,
            is_very_cold, is_very_hot, is_heavy_rain,
            is_strong_wind, typhoon_signal
        FROM weather_history
        WHERE date = %s
    """, (date,))
    result = cur.fetchone()
    if result:
        data['weather'] = {
            'temp_min': float(result[0]) if result[0] else None,
            'temp_max': float(result[1]) if result[1] else None,
            'temp_mean': float(result[2]) if result[2] else None,
            'humidity_pct': float(result[3]) if result[3] else None,
            'rainfall_mm': float(result[4]) if result[4] else None,
            'wind_kmh': float(result[5]) if result[5] else None,
            'pressure_hpa': float(result[6]) if result[6] else None,
            'visibility_km': float(result[7]) if result[7] else None,
            'is_very_cold': result[8],
            'is_very_hot': result[9],
            'is_heavy_rain': result[10],
            'is_strong_wind': result[11],
            'typhoon_signal': result[12]
        }

    cur.close()
    conn.close()

    return data

# ============================================================
# Learning Engine
# ============================================================

def calculate_error_metrics(actual, predicted):
    """計算誤差指標"""
    error = actual - predicted
    error_pct = (error / actual * 100) if actual > 0 else 0
    return {
        'error': error,
        'error_pct': error_pct,
        'abs_error': abs(error)
    }

def detect_anomaly(error, std_threshold=2.5):
    """檢測是否為異常值"""
    return {
        'is_anomaly': abs(error) > ANOMALY_THRESHOLD,
        'is_high_anomaly': abs(error) > HIGH_ANOMALY_THRESHOLD,
        'severity': 'high' if abs(error) > HIGH_ANOMALY_THRESHOLD else 'medium' if abs(error) > ANOMALY_THRESHOLD else 'none'
    }

def analyze_weather_impact(data, error):
    """分析天氣對誤差的影響"""
    if not data.get('weather'):
        return None

    weather = data['weather']

    # 基於當前已知影響分析
    # 這裡簡化處理，實際應該用更複雜的模型

    impact = {
        'temperature_effect': 0,
        'rain_effect': 0,
        'wind_effect': 0,
        'total_effect': 0
    }

    # 溫度效應
    if weather.get('is_very_cold'):
        impact['temperature_effect'] = -6.8  # 從歷史分析
    elif weather.get('is_very_hot'):
        impact['temperature_effect'] = 1.2

    # 雨效應
    if weather.get('is_heavy_rain'):
        impact['rain_effect'] = -4.9

    # 風效應
    if weather.get('is_strong_wind'):
        impact['wind_effect'] = -2.8

    # 總效應
    impact['total_effect'] = impact['temperature_effect'] + impact['rain_effect'] + impact['wind_effect']

    return impact

def analyze_ai_impact(data, error):
    """分析 AI 因素對誤差的影響"""
    if not data.get('ai_factor'):
        return None

    ai = data['ai_factor']

    # 如果 AI factor 存在，檢查它是否改善了預測
    prediction_without_ai = data['prediction']['production']  # production 不包含 AI
    prediction_with_ai = data['prediction'].get('experimental')

    impact = {
        'ai_factor': ai.get('factor'),
        'event_type': ai.get('event_type'),
        'improved': False,
        'improvement_amount': 0
    }

    if prediction_with_ai and data.get('actual'):
        error_without_ai = abs(data['actual'] - prediction_without_ai)
        error_with_ai = abs(data['actual'] - prediction_with_ai)
        impact['improved'] = error_with_ai < error_without_ai
        impact['improvement_amount'] = error_without_ai - error_with_ai

    return impact

# ============================================================
# Database Update
# ============================================================

def save_learning_record(conn, data, metrics, anomaly, weather_impact, ai_impact):
    """保存學習記錄到數據庫"""
    cur = conn.cursor()

    prediction = data.get('prediction', {})
    weather = data.get('weather', {})
    ai = data.get('ai_factor')

    cur.execute("""
        INSERT INTO learning_records (
            date,
            xgboost_base_pred,
            final_prediction,
            actual_attendance,
            prediction_error,
            error_pct,

            -- 天氣條件
            temp_min,
            temp_max,
            rainfall_mm,
            wind_kmh,
            humidity_pct,
            pressure_hpa,
            is_very_cold,
            is_very_hot,
            is_heavy_rain,
            is_strong_wind,
            typhoon_signal,

            -- AI 因素
            ai_factor,
            ai_event_type,
            ai_description,

            -- 學習結果
            weather_impact_learned,
            ai_impact_learned,
            is_anomaly
        ) VALUES (
            %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s
        )
        ON CONFLICT (date) DO UPDATE SET
            actual_attendance = EXCLUDED.actual_attendance,
            prediction_error = EXCLUDED.prediction_error,
            is_anomaly = EXCLUDED.is_anomaly,
            processed = FALSE
    """, (
        data['date'],
        prediction.get('xgboost_base'),
        prediction.get('production'),
        data.get('actual'),
        metrics.get('error'),
        metrics.get('error_pct'),

        weather.get('temp_min'),
        weather.get('temp_max'),
        weather.get('rainfall_mm'),
        weather.get('wind_kmh'),
        weather.get('humidity_pct'),
        weather.get('pressure_hpa'),
        weather.get('is_very_cold', False),
        weather.get('is_very_hot', False),
        weather.get('is_heavy_rain', False),
        weather.get('is_strong_wind', False),
        weather.get('typhoon_signal'),

        ai.get('factor') if ai else None,
        ai.get('event_type') if ai else None,
        ai.get('description') if ai else None,

        weather_impact.get('total_effect') if weather_impact else None,
        ai_impact.get('improvement_amount') if ai_impact else None,
        anomaly.get('is_anomaly', False)
    ))

    conn.commit()
    cur.close()

def update_anomaly_if_needed(conn, data, metrics, anomaly):
    """如果檢測到異常，記錄到異常表"""
    if not anomaly.get('is_anomaly'):
        return

    cur = conn.cursor()

    weather = data.get('weather', {})
    conditions = {
        'temp_min': weather.get('temp_min'),
        'temp_max': weather.get('temp_max'),
        'rainfall_mm': weather.get('rainfall_mm'),
        'is_very_cold': weather.get('is_very_cold', False),
        'is_heavy_rain': weather.get('is_heavy_rain', False)
    }

    cur.execute("""
        INSERT INTO anomaly_events (
            date,
            anomaly_type,
            prediction_error,
            conditions_json,
            requires_review
        ) VALUES (
            %s, %s, %s, %s, %s
        )
    """, (
        data['date'],
        'unknown',  # 後續分析確定類型
        metrics.get('error'),
        json.dumps(conditions),
        anomaly.get('severity') == 'high'
    ))

    conn.commit()
    cur.close()

# ============================================================
# Main Learning Loop
# ============================================================

def process_date(date):
    """處理單日數據"""
    print(f"Processing date: {date}")

    # 1. 獲取數據
    data = fetch_yesterday_data(date)

    if not data.get('actual') or not data.get('prediction'):
        print(f"  ⚠️ Missing data for {date}")
        return False

    # 2. 計算誤差
    metrics = calculate_error_metrics(
        data['actual'],
        data['prediction']['production']
    )

    print(f"  Actual: {data['actual']}, Predicted: {data['prediction']['production']:.1f}")
    print(f"  Error: {metrics['error']:.1f} ({metrics['error_pct']:.1f}%)")

    # 3. 檢測異常
    anomaly = detect_anomaly(metrics['error'])
    if anomaly['is_anomaly']:
        print(f"  ⚠️ Anomaly detected! Severity: {anomaly['severity']}")

    # 4. 分析天氣影響
    weather_impact = analyze_weather_impact(data, metrics['error'])
    if weather_impact:
        print(f"  Weather impact: {weather_impact['total_effect']:.1f}")

    # 5. 分析 AI 影響
    ai_impact = analyze_ai_impact(data, metrics['error'])
    if ai_impact and ai_impact.get('improved'):
        print(f"  ✅ AI improved prediction by {ai_impact['improvement_amount']:.1f}")

    # 6. 保存到數據庫
    conn = get_db_connection()
    try:
        save_learning_record(conn, data, metrics, anomaly, weather_impact, ai_impact)
        update_anomaly_if_needed(conn, data, metrics, anomaly)
        print(f"  ✅ Saved to database")
    finally:
        conn.close()

    return True

def main():
    """主函數 - 處理昨天的數據"""
    yesterday = (datetime.now() - timedelta(days=1)).date()

    print("=" * 60)
    print("Continuous Learning Engine")
    print("=" * 60)
    print(f"Processing: {yesterday}")
    print()

    success = process_date(yesterday)

    print()
    if success:
        print("✅ Learning complete")
    else:
        print("⚠️ Learning incomplete - missing data")

if __name__ == '__main__':
    main()
```

---

## Phase 2: 異常檢測與 Flag 機制

### 目標

當預測誤差超過閾值時：
1. 自動 flag 為異常
2. 分析異常原因
3. 尋找類似歷史事件
4. 生成報告給管理員

### 實現文件

#### `python/anomaly_detector.py`

```python
#!/usr/bin/env python3
"""
異常檢測與分析模組
Anomaly Detection and Analysis

功能:
1. 檢測預測異常
2. 分類異常原因 (天氣/AI/未知)
3. 尋找類似歷史事件
4. 生成異常報告
"""

import psycopg2
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from dotenv import load_dotenv
import os
import json

# ============================================================
# Anomaly Detection
# ============================================================

def calculate_baseline_stats(conn, days=90):
    """計算基線統計 (過去 N 天的誤差分佈)"""
    cur = conn.cursor()

    cur.execute("""
        SELECT
            AVG(prediction_error) as mean_error,
            STDDEV(prediction_error) as std_error,
            MIN(prediction_error) as min_error,
            MAX(prediction_error) as max_error,
            COUNT(*) as sample_count
        FROM learning_records
        WHERE date >= CURRENT_DATE - INTERVAL '%s days'
          AND actual_attendance IS NOT NULL
    """, (days,))

    result = cur.fetchone()
    cur.close()

    if not result or result[4] < 10:
        # 默認值
        return {
            'mean': 0,
            'std': 10,
            'min': -30,
            'max': 30,
            'count': 0
        }

    return {
        'mean': float(result[0]) if result[0] else 0,
        'std': float(result[1]) if result[1] else 10,
        'min': float(result[2]) if result[2] else -30,
        'max': float(result[3]) if result[3] else 30,
        'count': int(result[4])
    }

def classify_anomaly(conn, date, error, weather=None, ai_factor=None):
    """分類異常原因"""

    classification = {
        'type': 'unknown',
        'confidence': 'low',
        'reason': [],
        'suggested_adjustment': 0
    }

    # 1. 檢查是否為天氣異常
    if weather:
        weather_causes = []

        if weather.get('is_very_cold'):
            weather_causes.append('very_cold')
            classification['suggested_adjustment'] -= 6.8

        if weather.get('is_heavy_rain'):
            weather_causes.append('heavy_rain')
            classification['suggested_adjustment'] -= 4.9

        if weather.get('typhoon_signal') and weather['typhoon_signal'] in ['T8', 'T9', 'T10']:
            weather_causes.append('typhoon')
            classification['suggested_adjustment'] -= 12.0

        if len(weather_causes) > 0:
            classification['type'] = 'weather'
            classification['confidence'] = 'high' if len(weather_causes) >= 2 else 'medium'
            classification['reason'] = weather_causes

    # 2. 檢查是否為 AI 事件異常
    if ai_factor and abs(ai_factor.get('factor', 1.0) - 1.0) > 0.05:
        if classification['type'] == 'unknown':
            classification['type'] = 'ai'
            classification['reason'] = [ai_factor.get('event_type', 'unknown_ai_event')]
            classification['confidence'] = 'medium'

    return classification

def find_similar_events(conn, current_weather, current_ai, limit=10):
    """尋找類似的歷史事件"""
    cur = conn.cursor()

    # 構建查詢條件
    conditions = []
    params = []

    if current_weather:
        if current_weather.get('is_very_cold'):
            conditions.append("is_very_cold = TRUE")
        if current_weather.get('is_heavy_rain'):
            conditions.append("is_heavy_rain = TRUE")
        if current_weather.get('is_strong_wind'):
            conditions.append("is_strong_wind = TRUE")

    if current_ai:
        if current_ai.get('event_type'):
            conditions.append("ai_event_type = %s")
            params.append(current_ai['event_type'])

    where_clause = " AND ".join(conditions) if conditions else "TRUE"

    cur.execute(f"""
        SELECT
            date,
            actual_attendance,
            prediction_error,
            is_very_cold,
            is_heavy_rain,
            is_strong_wind,
            ai_event_type
        FROM learning_records
        WHERE {where_clause}
          AND actual_attendance IS NOT NULL
        ORDER BY date DESC
        LIMIT %s
    """, params + [limit])

    results = cur.fetchall()
    cur.close()

    return [
        {
            'date': str(r[0]),
            'actual': float(r[1]),
            'error': float(r[2]),
            'conditions': {
                'is_very_cold': r[3],
                'is_heavy_rain': r[4],
                'is_strong_wind': r[5],
                'ai_event': r[6]
            }
        }
        for r in results
    ]

def generate_anomaly_report(conn, date):
    """生成異常報告"""

    cur = conn.cursor()

    # 獲取異常記錄
    cur.execute("""
        SELECT
            date,
            actual_attendance,
            final_prediction,
            prediction_error,
            temp_min,
            temp_max,
            rainfall_mm,
            is_very_cold,
            is_heavy_rain,
            ai_factor,
            ai_event_type
        FROM learning_records
        WHERE date = %s
    """, (date,))

    result = cur.fetchone()
    if not result:
        return None

    cur.close()

    # 構建報告
    report = {
        'date': str(result[0]),
        'actual': float(result[1]),
        'predicted': float(result[2]),
        'error': float(result[3]),
        'error_pct': (float(result[3]) / float(result[1]) * 100) if result[1] else 0,

        'conditions': {
            'temp_min': float(result[4]) if result[4] else None,
            'temp_max': float(result[5]) if result[5] else None,
            'rainfall_mm': float(result[6]) if result[6] else None,
            'is_very_cold': result[7],
            'is_heavy_rain': result[8]
        },

        'ai_factor': {
            'factor': float(result[9]) if result[9] else None,
            'event_type': result[10]
        }
    }

    return report

# ============================================================
# Main
# ============================================================

def main():
    """檢測並報告最近的異常"""
    conn = psycopg2.connect(os.getenv('DATABASE_URL'))
    load_dotenv()

    # 計算基線
    baseline = calculate_baseline_stats(conn)

    print("=" * 60)
    print("Anomaly Detection Report")
    print("=" * 60)
    print(f"Baseline (last 90 days):")
    print(f"  Mean Error: {baseline['mean']:.2f}")
    print(f"  Std Dev: {baseline['std']:.2f}")
    print(f"  Sample Count: {baseline['count']}")
    print()

    # 檢測未處理的異常
    cur = conn.cursor()
    cur.execute("""
        SELECT date, prediction_error
        FROM learning_records
        WHERE is_anomaly = TRUE
          AND processed = FALSE
        ORDER BY date DESC
    """)

    anomalies = cur.fetchall()
    cur.close()

    if not anomalies:
        print("✅ No new anomalies to process")
        return

    print(f"Found {len(anomalies)} anomalies:")
    print()

    for date, error in anomalies:
        print(f"📅 {date}: Error = {error:.1f}")

        # 生成報告
        report = generate_anomaly_report(conn, date)
        if report:
            print(f"   Actual: {report['actual']}, Predicted: {report['predicted']:.1f}")
            print(f"   Conditions: {report['conditions']}")

        print()

    conn.close()

if __name__ == '__main__':
    main()
```

---

## Phase 3: 學習迴歸模型

### 目標

基於收集的數據，建立學習模型：
1. 天氣條件 → 預期 attendance 變化
2. AI 事件類型 → 預期 attendance 變化
3. 條件組合 → 預期 attendance 變化

### 實現文件

#### `python/weather_impact_learner.py`

```python
#!/usr/bin/env python3
"""
天氣影響學習模型
Weather Impact Learning Model

基於歷史數據學習不同天氣條件對 attendance 的影響
"""

import psycopg2
import pandas as pd
import numpy as np
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import StandardScaler
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
        'is_heavy_rain', 'is_strong_wind'
    ]

    # 3. 交互特徵
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
        return None

    # 2. 準備特徵
    X, y, feature_names = prepare_features(df)

    # 3. 訓練模型
    model = LinearRegression()
    model.fit(X, y)

    # 4. 評估
    score = model.score(X, y)

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

    print(f"✅ Weather impact model trained (R² = {score:.3f})")
    print(f"   Samples: {len(df)}")

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
    baseline_mean, baseline_std, total_count = cur.fetchone()

    # 分析各種組合
    combinations = [
        # (條件名稱, WHERE 條件)
        ('very_cold', 'is_very_cold = TRUE'),
        ('very_hot', 'is_very_hot = TRUE'),
        ('heavy_rain', 'is_heavy_rain = TRUE'),
        ('strong_wind', 'is_strong_wind = TRUE'),
        ('cold_and_rain', 'is_very_cold = TRUE AND is_heavy_rain = TRUE'),
        ('hot_and_rain', 'is_very_hot = TRUE AND is_heavy_rain = TRUE'),
        ('cold_and_wind', 'is_very_cold = TRUE AND is_strong_wind = TRUE'),
    ]

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

    conn.commit()
    cur.close()

    print(f"✅ Updated {len(combinations)} weather combinations")

def main():
    """主函數"""
    load_dotenv()
    conn = psycopg2.connect(os.getenv('DATABASE_URL'))

    print("=" * 60)
    print("Weather Impact Learning")
    print("=" * 60)
    print()

    # 1. 訓練影響模型
    train_impact_model(conn)

    # 2. 更新組合影響
    update_combination_impacts(conn)

    conn.close()
    print()
    print("✅ Learning complete")

if __name__ == '__main__':
    main()
```

---

## Phase 4: 預測整合

### 目標

將學習到的天氣和 AI 影響整合到預測流程中：
1. 獲取天氣預報
2. 查詢學習到的影響參數
3. 調整 XGBoost 基礎預測
4. 生成最終預測

### 實現文件

#### `python/forecast_predictor.py`

```python
#!/usr/bin/env python3
"""
天氣預報預測整合
Weather Forecast Integrated Prediction

使用天氣預報和學習到的影響參數調整預測
"""

import psycopg2
import requests
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import os
from dotenv import load_dotenv
import json

HKO_FORECAST_API = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=tc"

def fetch_weather_forecast():
    """獲取 HKO 9 天天氣預報"""
    try:
        response = requests.get(HKO_FORECAST_API, timeout=30)
        response.raise_for_status()
        data = response.json()

        forecasts = []
        for day in data.get('weatherForecast', []):
            forecasts.append({
                'date': datetime.strptime(day['forecastDate'], '%Y%m%d').date(),
                'temp_min': int(day.get('forecastMintemp', '20').replace('°C', '').strip()),
                'temp_max': int(day.get('forecastMaxtemp', '28').replace('°C', '').strip()),
                'humidity': day.get('forecastHumidity', ''),
                'rain_prob': day.get('PSR', 'Low'),
                'desc': day.get('ForecastDesc', '')
            })

        return forecasts
    except Exception as e:
        print(f"❌ Failed to fetch forecast: {e}")
        return []

def get_learned_impacts(conn):
    """從數據庫獲取學習到的影響參數"""
    cur = conn.cursor()

    cur.execute("""
        SELECT parameter_name, parameter_value, sample_count
        FROM weather_impact_parameters
        WHERE is_active = TRUE
    """)

    impacts = {row[0]: {'value': float(row[1]), 'n': int(row[2])} for row in cur.fetchall()}
    cur.close()

    return impacts

def calculate_weather_adjustment(forecast, impacts):
    """基於預報計算調整值"""

    adjustment = 0
    factors = []

    temp_min = forecast['temp_min']
    temp_max = forecast['temp_max']
    rain_prob = forecast['rain_prob']

    # 1. 溫度調整
    if temp_min <= 12:
        cold_impact = impacts.get('is_very_cold', {}).get('value', -6.8)
        adjustment += cold_impact
        factors.append(f'寒冷天氣 ({cold_impact:+.1f})')

    elif temp_max >= 33:
        hot_impact = impacts.get('is_very_hot', {}).get('value', 1.2)
        adjustment += hot_impact
        factors.append(f'炎熱天氣 ({hot_impact:+.1f})')

    # 2. 降雨調整
    if rain_prob in ['High', 'Very High']:
        rain_impact = impacts.get('is_heavy_rain', {}).get('value', -4.9)
        adjustment += rain_impact
        factors.append(f'大雨預報 ({rain_impact:+.1f})')

    return adjustment, factors

def predict_with_forecast(target_date, base_prediction):
    """使用天氣預報生成調整後的預測"""

    load_dotenv()
    conn = psycopg2.connect(os.getenv('DATABASE_URL'))

    # 1. 獲取天氣預報
    forecasts = fetch_weather_forecast()

    # 2. 獲取學習到的影響
    impacts = get_learned_impacts(conn)

    # 3. 找到目標日期的預報
    target_forecast = None
    for f in forecasts:
        if f['date'] == target_date:
            target_forecast = f
            break

    conn.close()

    if not target_forecast:
        # 沒有預報，返回基礎預測
        return {
            'date': target_date,
            'base_prediction': base_prediction,
            'final_prediction': base_prediction,
            'adjustment': 0,
            'factors': ['無天氣預報']
        }

    # 4. 計算調整
    adjustment, factors = calculate_weather_adjustment(target_forecast, impacts)

    return {
        'date': target_date,
        'base_prediction': base_prediction,
        'final_prediction': base_prediction + adjustment,
        'adjustment': adjustment,
        'factors': factors,
        'forecast': target_forecast
    }

def main():
    """測試"""
    target_date = (datetime.now() + timedelta(days=1)).date()
    base_pred = 250

    result = predict_with_forecast(target_date, base_pred)

    print("=" * 60)
    print("Weather Forecast Prediction")
    print("=" * 60)
    print(f"Target Date: {result['date']}")
    print(f"Base Prediction: {result['base_prediction']:.0f}")
    print(f"Adjustment: {result['adjustment']:+.1f}")
    print(f"Final Prediction: {result['final_prediction']:.0f}")
    if result.get('forecast'):
        print(f"\nForecast: {result['forecast']['temp_min']}°C - {result['forecast']['temp_max']}°C, {result['forecast']['rain_prob']} rain")

if __name__ == '__main__':
    main()
```

---

## API 設計

### 新增端點

#### `server.js` 新增路由

```javascript
// ============================================================
// Continuous Learning API Endpoints
// ============================================================

// 獲取學習摘要
app.get('/api/learning/summary', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                COUNT(*) as total_records,
                COUNT(CASE WHEN is_anomaly THEN 1 END) as anomalies,
                AVG(prediction_error) as avg_error,
                MAX(date) as latest_date
            FROM learning_records
        `);
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 獲取當前天氣影響參數
app.get('/api/learning/weather-impacts', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT * FROM current_weather_impacts
            ORDER BY ABS(parameter_value) DESC
        `);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 獲取異常列表
app.get('/api/learning/anomalies', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 30;
        const result = await pool.query(`
            SELECT
                date,
                actual_attendance,
                final_prediction,
                prediction_error,
                is_very_cold,
                is_heavy_rain,
                ai_event_type
            FROM learning_records
            WHERE is_anomaly = TRUE
            ORDER BY date DESC
            LIMIT $1
        `, [limit]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 觸發學習更新
app.post('/api/learning/update', async (req, res) => {
    try {
        // 調用 Python 學習腳本
        const { spawn } = require('child_process');
        const python = spawn('python', ['python/weather_impact_learner.py']);

        let output = '';
        python.stdout.on('data', (data) => { output += data.toString(); });

        python.on('close', (code) => {
            if (code === 0) {
                res.json({ success: true, message: 'Learning update complete' });
            } else {
                res.status(500).json({ success: false, message: 'Learning failed' });
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 獲取天氣預報預測
app.get('/api/learning/forecast-prediction/:date', async (req, res) => {
    try {
        const date = req.params.date;
        // 調用 Python 預報預測
        // ...
        res.json({ date, prediction: 250 });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
```

---

## 部署策略

### Cron Job 配置

```bash
# ============================================================
# Railway Cron Job 配置
# ============================================================

# 每天凌晨 12:30 執行學習腳本
# 在 Railway 上設置為 Scheduled Task

# 或在 server.js 中設置定時任務
```

#### `modules/learning-scheduler.js`

```javascript
/**
 * 學習調度器
 * 每天自動執行學習任務
 */

const cron = require('node-cron');
const { spawn } = require('child_process');

class LearningScheduler {
    constructor() {
        this.isRunning = false;
    }

    start() {
        console.log('📚 Starting Learning Scheduler...');

        // 每天凌晨 12:30 執行
        cron.schedule('30 0 * * *', () => {
            this.runDailyLearning();
        });

        // 每週一凌晨 1:00 執行完整學習 (更新模型)
        cron.schedule('0 1 * * 1', () => {
            this.runWeeklyLearning();
        });
    }

    async runDailyLearning() {
        if (this.isRunning) {
            console.log('⚠️ Learning already running');
            return;
        }

        this.isRunning = true;
        console.log('🔄 Running daily learning...');

        const python = spawn('python', ['python/continuous_learner.py']);

        python.stdout.on('data', (data) => {
            console.log(data.toString().trim());
        });

        python.stderr.on('data', (data) => {
            console.error(data.toString().trim());
        });

        python.on('close', (code) => {
            this.isRunning = false;
            if (code === 0) {
                console.log('✅ Daily learning complete');
            } else {
                console.error(`❌ Daily learning failed (code ${code})`);
            }
        });
    }

    async runWeeklyLearning() {
        console.log('🔄 Running weekly learning...');

        const python = spawn('python', ['python/weather_impact_learner.py']);

        python.on('close', (code) => {
            if (code === 0) {
                console.log('✅ Weekly learning complete');
            }
        });
    }
}

module.exports = LearningScheduler;
```

---

## 監控與警報

### Dashboard 指標

```javascript
// 學習系統監控指標
const LEARNING_METRICS = {
    // 數據質量
    totalRecords: 0,
    recentRecords: 0,           // 過去 30 天
    anomaliesCount: 0,
    anomaliesRate: 0,            // 異常率

    // 模型性能
    avgError: 0,
    mae: 0,
    rmse: 0,
    mape: 0,

    // 天氣影響
    weatherImpactParams: {},
    lastWeatherUpdate: null,

    // AI 因素
    aiEventAccuracy: 0,
    aiCorrectPredictions: 0,
    aiTotalPredictions: 0,

    // 系統狀態
    lastLearningRun: null,
    learningStatus: 'idle',      // idle, running, error
    databaseStatus: 'connected'
};
```

---

## 實施步驟

### 第 1 週：數據庫和基礎架構

1. ✅ 運行 migration `004_continuous_learning.sql`
2. ✅ 創建 `python/continuous_learner.py`
3. ✅ 創建 `modules/learning-scheduler.js`
4. ✅ 測試每日數據記錄

### 第 2 週：異常檢測

1. ✅ 創建 `python/anomaly_detector.py`
2. ✅ 實現異常分類邏輯
3. ✅ 創建異常報告 API
4. ✅ 測試異常檢測

### 第 3 週：學習模型

1. ✅ 創建 `python/weather_impact_learner.py`
2. ✅ 實現迴歸模型訓練
3. ✅ 更新天氣影響參數表
4. ✅ 驗證學習效果

### 第 4 週：預報整合

1. ✅ 創建 `python/forecast_predictor.py`
2. ✅ 整合天氣預報 API
3. ✅ 實現預測調整邏輯
4. ✅ 部署到生產環境

---

## 數據流總結

```
┌──────────────────────────────────────────────────────────────────────┐
│                          完整數據流                                   │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────���      ┌────────────────┐      ┌────────────────┐ │
│  │  HKO Weather  │      │  XGBoost       │      │  AI Service    │ │
│  │  (History)    │      │  Prediction    │      │  Analysis      │ │
│  └───────┬────────┘      └───────┬────────┘      └───────┬────────┘ │
│          │                       │                       │          │
│          ▼                       ▼                       ▼          │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                   Daily Prediction Process                     │ │
│  └──────────────────────────┬─────────────────────────────────────┘ │
│                             │                                       │
│                             ▼                                       │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │              daily_predictions Table                           │ │
│  │   - xgboost_base                                               │ │
│  │   - prediction_production                                      │ │
│  │   - prediction_experimental                                    │ │
│  │   - ai_factor                                                  │ │
│  └──────────────────────────┬─────────────────────────────────────┘ │
│                             │                                       │
│                             ▼                                       │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                  actual_data Table                             │ │
│  │   (用戶上傳實際數據)                                            │ │
│  └──────────────────────────┬─────────────────────────────────────┘ │
│                             │                                       │
│                             ▼                                       │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │              Continuous Learner (Cron)                         │ │
│  │   1. 計算誤差                                                   │ │
│  │   2. 分析天氣                                                   │ │
│  │   3. 分析 AI                                                    │ │
│  │   4. 檢測異常                                                   │ │
│  └──────────────────────────┬─────────────────────────────────────┘ │
│                             │                                       │
│                             ▼                                       │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │              learning_records Table                            │ │
│  │   - prediction_error                                           │ │
│  │   - weather_conditions                                         │ │
│  │   - ai_factors                                                 │ │
│  │   - is_anomaly                                                 │ │
│  └──────────────────────────┬─────────────────────────────────────┘ │
│                             │                                       │
│          ┌──────────────────┼──────────────────┐                   │
│          ▼                  ▼                  ▼                   │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐            │
│  │  Weather      │ │  AI Event     │ │  Anomaly      │            │
│  │  Impact       │ │  Learning     │ │  Detection    │            │
│  │  Learner      │ │               │ │               │            │
│  └───────┬───────┘ └───────┬───────┘ └───────┬───────┘            │
│          │                 │                 │                     │
│          ▼                 ▼                 ▼                     │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐            │
│  │  weather_     │ │  ai_event_    │ │  anomaly_     │            │
│  │  impact_      │ │  learning     │ │  events       │            │
│  │  parameters   │ │               │ │               │            │
│  └───────┬───────┘ └───────┬───────┘ └───────┬───────┘            │
│          │                 │                 │                     │
│          └─────────────────┴─────────────────┘                     │
│                             │                                       │
│                             ▼                                       │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                 預測時使用                                      │ │
│  │   1. 讀取學習到的參數                                          │ │
│  │   2. 獲取天氣預報                                              │ │
│  │   3. 調整基礎預測                                              │ │
│  │   4. 生成最終預測                                              │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 預期效果

### 學習後的預測流程

```
今天是 2026-02-01

1. XGBoost 基礎預測: 250 人

2. 檢查天氣預報:
   - 明天最低溫: 8°C (寒冷天氣)
   - 降雨機率: High

3. 查詢學習到的影響:
   - 寒冷天氣 (temp_min <= 12): 平均 -6.8 人
   - 大雨 (High): 平均 -4.9 人
   - 總調整: -11.7 人

4. 最終預測:
   - 基礎: 250 人
   - 調整: -11.7 人
   - 最終: 238 人

5. 如果明天實際是 240 人:
   - 誤差: 2 人
   - 無調整誤差: 10 人
   - 學習改善: 80% ✅
```

---

## 總結

這個自動學習系統將實現：

| 功能 | 當前狀態 | 實現後 |
|------|---------|--------|
| 天氣影響追蹤 | 靜態 JSON | 動態數據庫 |
| 異常檢測 | ❌ 無 | ✅ 自動 |
| 天氣預報整合 | 存在但未使用 | ✅ 整合到預測 |
| AI 因素驗證 | 雙軌道 | ✅ 自動學習 |
| 持續學習 | ❌ 無 | ✅ 每日自動 |

---

**版本**: 4.0.00
**作者**: Ma Tsz Kiu
**日期**: 2026-01-18
