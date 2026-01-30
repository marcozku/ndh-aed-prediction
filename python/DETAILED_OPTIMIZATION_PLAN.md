# NDH AED 預測優化詳細計劃 v2.0
## 結合天氣預報 + 流感季節 + 模型優化

**當前基準**: MAE = 15.73 (Ensemble + 排除 COVID + 天氣數據)

---

## 🎯 總體目標

| 階段 | MAE 目標 | 改善 | 時間框架 |
|------|----------|------|----------|
| 當前 | 15.73 | - | - |
| 階段 1 | 14.0-14.5 | 8-11% | 2 週 |
| 階段 2 | 13.0-13.5 | 14-17% | 4 週 |
| 階段 3 | 12.0-12.5 | 20-24% | 6 週 |

---

## 階段 1: 天氣預報整合 (優先級最高) ⭐

### 為什麼天氣預報比歷史天氣更重要？

| 特徵類型 | 預測能力 | 原因 |
|----------|----------|------|
| **天氣預報** | ⭐⭐⭐⭐⭐ | 直接影響未來行為（明天是否出門） |
| **當天實際天氣** | ⭐⭐⭐ | 當天即時影響，但無法提前預測 |
| **歷史天氣** | ⭐⭐ | 累積效應（延遲就診） |

### 1.1 天氣預報來源

**香港天文台 9 天天氣預報**
```
API: https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=tc
更新: 每日 2 次 (上午 11 時, 下午 5 時)
預報範圍: 未來 9 天

數據包括:
- 溫度預報 (最低/最高)
- 降雨機率 (PSR)
- 濕度
- 天氣現象 (晴天、多雲、雨等)
```

### 1.2 實施步驟

#### Step 1: 創建天氣預報獲取模組

```python
# weather_forecast.py

def fetch_weather_forecast():
    """獲取香港天文台 9 天天氣預報"""
    url = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=tc"

    response = requests.get(url)
    data = response.json()

    forecast = []
    for day_data in data['weatherForecast']:
        forecast.append({
            'forecast_date': day_data['forecastDate'],  # YYYYMMDD
            'week': day_data['week'],
            'temp_min': int(day_data['forecastMintemp'].replace('°C', '')),
            'temp_max': int(day_data['forecastMaxtemp'].replace('°C', '')),
            'temp_range': None,  # 計算後填入
            'humidity': day_data['forecastHumidity'] or None,
            'rain_prob': day_data.get('PSR', 'Low'),
            'weather_desc': day_data['ForecastDesc']
        })

    return pd.DataFrame(forecast)
```

#### Step 2: 計算天氣預報特徵

```python
def add_forecast_features(df, forecast_df, target_date_col='Date'):
    """
    為預測目標日期添加天氣預報特徵

    Args:
        df: 包含 Date 列的 DataFrame
        forecast_df: 天氣預報 DataFrame
        target_date_col: 目標日期列名

    特徵:
    1. Forecast_Temp_Min/Max: 預報溫度
    2. Forecast_Temp_Range: 溫差
    3. Forecast_Rain_Prob: 降雨機率編碼
    4. Forecast_Is_Extreme_Temp: 極端溫度
    5. Forecast_Rain_Heavy: 大雨預報
    6. Forecast_Weather_Desc_Encoded: 天氣描述 One-Hot
    """
    df = df.copy()
    df[target_date_col] = pd.to_datetime(df[target_date_col])

    # 提取預報日期
    forecast_df['forecast_date'] = pd.to_datetime(
        forecast_df['forecast_date'], format='%Y%m%d'
    )

    # Merge
    df = df.merge(
        forecast_df[['forecast_date', 'temp_min', 'temp_max',
                     'rain_prob', 'weather_desc']],
        left_on=target_date_col,
        right_on='forecast_date',
        how='left'
    )

    # 溫差
    df['Forecast_Temp_Range'] = df['temp_max'] - df['temp_min']

    # 降雨機率編碼
    rain_mapping = {'Low': 0, 'Medium': 1, 'High': 2, 'Very High': 3}
    df['Forecast_Rain_Prob_Encoded'] = df['rain_prob'].map(rain_mapping).fillna(0)

    # 極端溫度標記
    df['Forecast_Is_Very_Hot'] = (df['temp_max'] >= 33).astype(int)
    df['Forecast_Is_Very_Cold'] = (df['temp_min'] <= 10).astype(int)
    df['Forecast_Is_Temp_Fluctuating'] = (df['Forecast_Temp_Range'] >= 10).astype(int)

    # 大雨預報
    df['Forecast_Rain_Heavy'] = (
        df['rain_prob'].isin(['High', 'Very High']) |
        df['weather_desc'].str.contains('雨|雷暴|暴雨', na=False)
    ).astype(int).fillna(0)

    # 天氣描述 One-Hot
    weather_dummies = pd.get_dummies(df['weather_desc'], prefix='Weather_Desc')
    df = pd.concat([df, weather_dummies], axis=1)

    return df
```

#### Step 3: 整合到現有流程

```python
# 在 train_xgboost.py 中

# 1. 獲取天氣預報
forecast = fetch_weather_forecast()

# 2. 添加預報特徵
train_data = add_forecast_features(train_data, forecast)
test_data = add_forecast_features(test_data, forecast)

# 3. 特徵選擇
forecast_features = [
    'Forecast_Temp_Min', 'Forecast_Temp_Max', 'Forecast_Temp_Range',
    'Forecast_Rain_Prob_Encoded', 'Forecast_Rain_Heavy',
    'Forecast_Is_Very_Hot', 'Forecast_Is_Very_Cold'
]
```

### 1.3 預期改善

```
基準 (無天氣預報): MAE = 15.73
+ 天氣預報特徵: MAE = 14.5-14.8
改善: 6-8%
```

**理由**: 天氣預報是直接的前瞻性指標，影響人們是否外出/就醫的決策。

---

## 階段 2: 歷史天氣累積效應

### 2.1 歷史天氣的作用

你說得對！歷史天氣有以下影響：

#### 延遲就診效應 (Delayed Care)
```
壞天氣 (雨天/寒冷) → 患者延遲就診 → 好天氣出現 "反彈"
```

#### 累積效應 (Accumulation)
```
連續 3 天寒冷天氣 → 第 4 天出現就診高峰
```

### 2.2 實施特徵工程

```python
def add_historical_weather_lag_features(df, weather_df):
    """
    添加歷史天氣滯後特徵

    特徵:
    1. Weather_Rain_1d/2d/3d: 過去 1-3 天的降雨
    2. Weather_Cold_Spell_3d: 過去 3 天寒冷天氣
    3. Weather_Temp_Trend_3d: 過去 3 天溫度趨勢
    4. Weather_Rain_Accum_7d: 過去 7 天累積降雨
    """
    df = df.copy()
    df['Date'] = pd.to_datetime(df['Date'])

    # 確保 weather_df 有 Date 列
    weather_df['Date'] = pd.to_datetime(weather_df['Date'])

    # Merge 天氣數據
    df = df.sort_values('Date')
    weather_aligned = weather_df.sort_values('Date')

    # 1-3 天滯後天氣
    for lag in [1, 2, 3]:
        # 降雨
        df[f'Weather_Rain_{lag}d'] = df['total_rainfall'].shift(lag)

        # 溫度
        df[f'Weather_Mean_Temp_{lag}d'] = df['mean_temp'].shift(lag)

        # 極端天氣標記
        df[f'Weather_Cold_{lag}d'] = (df[f'Weather_Mean_Temp_{lag}d'] < 12).astype(int)
        df[f'Weather_Hot_{lag}d'] = (df[f'Weather_Mean_Temp_{lag}d'] > 30).astype(int)

    # 寒冷天氣持續 (連續 3 天 < 15°C)
    for i in range(len(df)):
        if i < 3:
            df.loc[df.index[i], 'Weather_Cold_Spell_3d'] = 0
        else:
            recent_temps = df.loc[df.index[i-3:i], 'mean_temp'].values
            df.loc[df.index[i], 'Weather_Cold_Spell_3d'] = int(np.all(recent_temps < 15))

    # 溫度趨勢 (過去 3 天)
    df['Weather_Temp_Trend_3d'] = df['mean_temp'].diff(3)

    # 7 天累積降雨
    df['Weather_Rain_Accum_7d'] = df['total_rainfall'].rolling(7).sum()

    # 填補缺失值
    weather_cols = [c for c in df.columns if c.startswith('Weather_')]
    df[weather_cols] = df[weather_cols].fillna(0)

    return df
```

### 2.3 預期改善

```
+ 歷史天氣滯後特徵: MAE 14.5 → 14.0
額外改善: 3-4%
```

---

## 階段 3: 流感季節指標

### 3.1 香港流感監測數據來源

**香港衛生防護中心 - 流感監測**
```
網址: https://www.chp.gov.hk/tc/resources/29.html
數據:
- 流感活動程度 (低/中/高/甚高)
- 主要流行病毒株
- 監測週報 (每週更新)

監測數據:
- 急症監測 (流感樣病例數)
- 急症流感樣病例就診率
- 嚴重流感病例
```

### 3.2 實施方案

#### 方案 A: 使用公開數據 (手動更新)

```python
# flu_season.py

FLU_SEASON_HK = {
    # 流感高峰期 (基於歷史數據)
    'peak_seasons': [
        (1, 15),   (2, 28),   # 1月中旬 - 2月底 (冬季流感)
        (6, 15),   (8, 31),   # 6月中旬 - 8月底 (夏季流感)
    ],
    # 預測高峰期 (基於 2024-2025 數據)
    'predicted_2025': [
        (1, 10),   (2, 20),   # 冬季
        (7, 1),    (8, 15)    # 夏季
    ]
}

def get_flu_season_features(date):
    """
    計算流感季節特徵

    返回:
    - is_flu_peak: 是否在高峰期
    - days_to_peak: 距離高峰期的天數
    - flu_season_intensity: 流感季節強度 (0-3)
    """
    month = date.month
    day = date.day

    # 檢查是否在高峰期
    is_peak = False
    intensity = 0

    for (start_month, start_day), (end_month, end_day) in FLU_SEASON_HK['peak_seasons']:
        if (month == start_month and day >= start_day) or \
           (month == end_month and day <= end_day) or \
           (start_month < month < end_month):
            is_peak = True
            intensity = 3
            break

    # 計算距離下一個高峰期
    days_to_peak = None
    if not is_peak:
        for (start_month, start_day), _ in FLU_SEASON_HK['peak_seasons']:
            peak_date = datetime(2025, start_month, start_day)
            if date < peak_date:
                days_to_peak = (peak_date - date).days
                break

    return {
        'Flu_Is_Peak': int(is_peak),
        'Flu_Days_To_Peak': days_to_peak if days_to_peak else 999,
        'Flu_Intensity': intensity,
        'Flu_Month': month in [1, 2, 7, 8]  # 流感月份
    }
```

#### 方案 B: 自動監控 (理想但需數據源)

```python
def scrape_flu_monitoring():
    """爬取香港流感監測數據"""
    # 需要實際實現爬蟲或 API 調用
    # 這是模擬
    url = "https://www.chp.gov.hk/tc/resources/29.html"
    # 爬取最新流感監測數據
    # 返回當前流感活動程度
    pass
```

### 3.3 預期改善

```
+ 流感季節特徵: MAE 14.0 → 13.5
額外改善: 3-4%
```

---

## 階段 4: 模型架構優化

### 4.1 超參數優化 (Optuna)

```python
# hyperparameter_optimization.py

import optuna

def objective(trial, X_train, y_train, X_val, y_val):
    params = {
        'n_estimators': trial.suggest_int('n_estimators', 200, 1000),
        'max_depth': trial.suggest_int('max_depth', 4, 12),
        'learning_rate': trial.suggest_float('learning_rate', 0.01, 0.2),
        'min_child_weight': trial.suggest_int('min_child_weight', 1, 10),
        'subsample': trial.suggest_float('subsample', 0.6, 0.95),
        'colsample_bytree': trial.suggest_float('colsample_bytree', 0.6, 0.95),
        'alpha': trial.suggest_float('alpha', 0, 1.0),
        'lambda': trial.suggest_float('lambda', 0.5, 2.0)
    }

    model = xgb.XGBRegressor(**params, random_state=42, n_jobs=-1)
    model.fit(X_train, y_train, verbose=False)

    y_pred = model.predict(X_val)
    mae = mean_absolute_error(y_val, y_pred)

    return mae

study = optuna.create_study(direction='minimize')
study.optimize(lambda trial: objective(trial, X_train, y_train, X_val, y_val), n_trials=200)
```

**預期改善**: MAE 13.5 → 13.2 (2%)

### 4.2 分層建模

```python
# stratified_models.py

# 工作日模型
model_weekday = train_model(train[df['Is_Weekend'] == 0])

# 週末模型
model_weekend = train_model(train[df['Is_Weekend'] == 1])

# 假期模型
model_holiday = train_model(train[df['Holiday_Factor'] != 1.0])

# 預測時根據日期選擇模型
```

**預期改善**: MAE 13.2 → 12.8 (3%)

---

## 階段 5: 特徵選擇優化

### 5.1 特徵重要性分析

```python
# feature_selection.py

def analyze_feature_importance(model, X_train, feature_names):
    """分析特徵重要性"""
    importance = model.feature_importances_

    # 排序
    indices = np.argsort(importance)[::-1]

    print("特徵重要性排名:")
    for i, idx in enumerate(indices[:20]):
        print(f"{i+1}. {feature_names[idx]}: {importance[idx]:.4f}")

    # 選擇重要性 > 0.01 的特徵
    selected = [feature_names[i] for i in indices if importance[i] > 0.01]

    return selected
```

### 5.2 遞減特徵法

```python
# 移除不重要特徵
# 保留 top 50 特徵
# 減少過擬合風險
```

**預期改善**: MAE 12.8 → 12.5 (2%)

---

## 完整實施計劃

### Week 1-2: 天氣預報整合 ✅

```bash
# 1. 創建天氣預報模組
# File: weather_forecast_integration.py

# 2. 測試預報獲取
python test_weather_forecast.py

# 3. 整合到訓練流程
python train_with_forecast.py

# 4. 評估改善
python evaluate_forecast_impact.py
```

**目標**: MAE 15.73 → 14.5

### Week 3: 歷史天氣滯後特徵

```bash
# 1. 添加滯後特徵
# File: feature_engineering_v3.py (包含滯後天氣)

# 2. 重新訓練模型
python train_xgboost.py

# 3. 比較結果
python compare_with_without_historical_weather.py
```

**目標**: MAE 14.5 → 14.0

### Week 4: 流感季節指標

```bash
# 1. 添加流感特徵
# File: flu_season_features.py

# 2. 重新訓練
python train_with_flu_features.py

# 3. 評估
python evaluate_flu_impact.py
```

**目標**: MAE 14.0 → 13.5

### Week 5-6: 完整優化

```bash
# 1. 超參數優化
python hyperparameter_optimization.py

# 2. 分層建模
python train_stratified_models.py

# 3. 特徵選擇
python optimize_features.py

# 4. 最終評估
python final_evaluation.py
```

**目標**: MAE 13.5 → 12.5

---

## 數據需求總結

| 特徵類別 | 數據來源 | 可用性 | 優先級 |
|----------|----------|--------|--------|
| **天氣預報** | 香港天文台 API | ✅ 即時 | ⭐⭐⭐⭐⭐ |
| **歷史天氣** | weather_full_history.csv | ✅ 已有 | ⭐⭐⭐ |
| **流感季節** | 公開數據 (手動) | ✅ 即時 | ⭐⭐⭐⭐ |
| **就診歷史** | actual_data 表 | ✅ 已有 | ⭐⭐⭐⭐⭐ |
| **假期因子** | dynamic_factors.json | ✅ 已有 | ⭐⭐⭐ |

---

## 特徵列表

### 天氣預報特徵 (新增)
```python
forecast_features = [
    'Forecast_Temp_Min',           # 預報最低溫
    'Forecast_Temp_Max',           # 預報最高溫
    'Forecast_Temp_Range',         # 溫差
    'Forecast_Rain_Prob_Encoded',  # 降雨機率 (0-3)
    'Forecast_Rain_Heavy',         # 大雨預報
    'Forecast_Is_Very_Hot',        # 酷熱 (>33°C)
    'Forecast_Is_Very_Cold',       # 寒冷 (<10°C)
    'Forecast_Is_Temp_Fluctuating' # 溫差大 (>10°C)
]
```

### 歷史天氣特徵 (新增)
```python
historical_weather_features = [
    'Weather_Rain_1d',             # 1天前降雨
    'Weather_Rain_2d',             # 2天前降雨
    'Weather_Rain_3d',             # 3天前降雨
    'Weather_Cold_1d',             # 1天前寒冷
    'Weather_Cold_2d',             # 2天前寒冷
    'Weather_Cold_3d',             # 3天前寒冷
    'Weather_Cold_Spell_3d',      # 3天寒冷天氣持續
    'Weather_Temp_Trend_3d',       # 3天溫度趨勢
    'Weather_Rain_Accum_7d'        # 7天累積降雨
]
```

### 流感季節特徵 (新增)
```python
flu_features = [
    'Flu_Is_Peak',                # 是否流感高峰期
    'Flu_Days_To_Peak',            # 距高峰期天數
    'Flu_Intensity',               # 流感強度 (0-3)
    'Flu_Month',                   # 流感月份 (1/2/7/8)
    'Flu_Pre_Peak_7d',             # 高峰前 7 天
    'Flu_Post_Peak_7d'             # 高峰後 7 天
]
```

### 基礎特徵 (已有)
```python
base_features = [
    # 時間特徵
    'Day_of_Week', 'Month', 'Day_of_Month',
    'Is_Weekend', 'Holiday_Factor',

    # 歷史就診
    'Attendance_Lag1', 'Attendance_Lag7', 'Attendance_Lag30',
    'Attendance_EWMA7', 'Attendance_EWMA14',
    'Daily_Change', 'Weekly_Change',

    # 季節性
    'Is_Winter_Flu_Season',
    'DayOfWeek_sin', 'DayOfWeek_cos'
]
```

---

## 實施檢查清單

### ✅ 立即可做 (無需新數據)
- [ ] 添加天氣預報 API 整合
- [ ] 實現流感季節特徵
- [ ] 添加歷史天氣滯後特徵
- [ ] 運行超參數優化
- [ ] 實現分層建模

### ⏳ 需要時間 (1-2 週數據收集)
- [ ] 收集流感監測數據 (自動化)
- [ ] 評估天氣預報準確性
- [ ] 分析特徵重要性

### 🔧 可選優化
- [ ] Stacking Ensemble 實現
- [ ] CatBoost/LightGBM 測試
- [ ] 交叉驗證優化

---

## 預期最終結果

```
當前: MAE = 15.73, R² = 0.41

優化後: MAE = 12.0-12.5, R² = 0.55-0.60

改善: 20-24%
誤差率: 6.2% → 4.8%
```

---

## 下一步行動

**立即執行** (今天):
```bash
# 創建天氣預報整合腳本
python create_weather_forecast_module.py

# 測試天氣預報 API
python test_forecast_api.py
```

**本週完成**:
1. 實現天氣預報特徵
2. 添加流感季節指標
3. 訓練新模型並評估

要開始實施嗎？我可以先創建天氣預報整合模組。
