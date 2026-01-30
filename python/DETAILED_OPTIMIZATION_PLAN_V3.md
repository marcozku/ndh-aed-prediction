# NDH AED 預測優化詳細計劃 v3.0
## 結合天氣預報 + 歷史天氣模式 + 流感季節 + 模型優化

**當前基準**: MAE = 15.73 (Ensemble + 排除 COVID + 天氣數據)

---

## 🎯 總體目標

| 階段 | MAE 目標 | 改善 | 時間框架 | 優先級 |
|------|----------|------|----------|--------|
| 當前 | 15.73 | - | - | - |
| 階段 1 | 14.5-15.0 | 5-8% | 1 週 | ⭐⭐⭐⭐⭐ |
| 階段 2 | 13.8-14.2 | 10-12% | 2 週 | ⭐⭐⭐⭐ |
| 階段 3 | 13.0-13.5 | 14-17% | 3 週 | ⭐⭐⭐ |
| 階段 4 | 12.5-13.0 | 17-20% | 4 週 | ⭐⭐ |

---

## 階段 1: 天氣預報整合 (優先級最高) ⭐⭐⭐⭐⭐

### 1.1 為什麼天氣預報最重要？

| 特徵類型 | 預測能力 | 原因 |
|----------|----------|------|
| **天氣預報** | ⭐⭐⭐⭐⭐ | 直接影響未來行為（明天是否出門、是否就醫） |
| **歷史天氣模式** | ⭐⭐⭐⭐ | 過去模式重現（天氣突變 → 就診變化） |
| **當天實際天氣** | ⭐⭐⭐ | 當天即時影響，但無法提前預測 |

**天氣預報的優勢**:
- ✅ 前瞻性指標（知道明天會下雨 → 今天決定是否就醫）
- ✅ 即時可用（香港天文台 API，每日 2 次更新）
- ✅ 覆蓋 9 天（短期預測足夠準確）

### 1.2 香港天文台 9 天天氣預報

```
API: https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=tc
更新: 每日 2 次 (上午 11 時, 下午 5 時)
預報範圍: 未來 9 天
```

**數據包括**:
- 溫度預報 (最低/最高)
- 降雨機率 (PSR: Low/Medium/High/Very High)
- 濕度 (%)
- 天氣描述 (晴天、多雲、雨、雷暴等)

### 1.3 實施步驟

#### Step 1: 天氣預報模組 (已完成 ✅)
```python
# weather_forecast_integration.py

def fetch_weather_forecast():
    """獲取香港天文台 9 天天氣預報"""
    url = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=tc"
    response = requests.get(url)
    data = response.json()

    forecast = []
    for day_data in data['weatherForecast']:
        forecast.append({
            'forecast_date': day_data['forecastDate'],  # YYYYMMDD
            'temp_min': int(day_data['forecastMintemp'].replace('°C', '')),
            'temp_max': int(day_data['forecastMaxtemp'].replace('°C', '')),
            'rain_prob': day_data.get('PSR', 'Low'),
            'weather_desc': day_data['ForecastDesc']
        })

    return pd.DataFrame(forecast)
```

#### Step 2: 天氣預報特徵 (已完成 ✅)
```python
def calculate_forecast_features(forecast_df):
    """將天氣預報轉換為機器學習特徵"""

    features = {}

    # 基礎溫度特徵
    features['Forecast_Temp_Min'] = forecast_df['temp_min'].iloc[0]
    features['Forecast_Temp_Max'] = forecast_df['temp_max'].iloc[0]
    features['Forecast_Temp_Range'] = features['Forecast_Temp_Max'] - features['Forecast_Temp_Min']

    # 降雨機率編碼
    rain_mapping = {'Low': 0, 'Medium': 1, 'High': 2, 'Very High': 3}
    features['Forecast_Rain_Prob_Encoded'] = rain_mapping[forecast_df['rain_prob'].iloc[0]]

    # 極端天氣標記
    features['Forecast_Is_Very_Hot'] = int(features['Forecast_Temp_Max'] >= 33)
    features['Forecast_Is_Very_Cold'] = int(features['Forecast_Temp_Min'] <= 10)
    features['Forecast_Rain_Heavy'] = int(forecast_df['rain_prob'].iloc[0] in ['High', 'Very High'])

    # 未來 3 天平均特徵
    features['Forecast_Avg_Temp_3d'] = forecast_df['temp_max'].iloc[:3].mean()
    features['Forecast_Rain_Days_3d'] = sum(forecast_df['rain_prob'].iloc[:3].isin(['High', 'Very High']))

    return features
```

**特徵列表** (14 個):
1. `Forecast_Temp_Min` - 預報最低溫
2. `Forecast_Temp_Max` - 預報最高溫
3. `Forecast_Temp_Range` - 溫差
4. `Forecast_Rain_Prob_Encoded` - 降雨機率 (0-3)
5. `Forecast_Rain_Heavy` - 大雨預報
6. `Forecast_Is_Very_Hot` - 酷熱 (>33°C)
7. `Forecast_Is_Very_Cold` - 寒冷 (<10°C)
8. `Forecast_Is_Temp_Fluctuating` - 溫差大 (>10°C)
9. `Forecast_Avg_Temp_3d` - 未來 3 天平均溫度
10. `Forecast_Rain_Days_3d` - 未來 3 天降雨天數
11. `Forecast_Weather_Sunny` - 晴天
12. `Forecast_Weather_Cloudy` - 多雲
13. `Forecast_Weather_Rainy` - 下雨
14. `Forecast_Weather_Stormy` - 雷暴

#### Step 3: 整合到訓練流程
```python
# train_integrated_optimization.py

# 1. 獲取天氣預報
forecast_df = fetch_weather_forecast()

# 2. 添加預報特徵
train_data = add_forecast_features_to_df(train_data, forecast_df)
test_data = add_forecast_features_to_df(test_data, forecast_df)

# 3. 訓練模型
model.fit(X_train, y_train)
```

### 1.4 預期改善

```
基準 (無天氣預報): MAE = 15.73
+ 天氣預報特徵: MAE = 14.8-15.2
改善: 3-5%
```

**理由**: 天氣預報是直接的前瞻性指標，影響人們是否外出/就醫的決策。

---

## 階段 2: 歷史天氣模式分析 ⭐⭐⭐⭐

### 2.1 歷史天氣的作用

你說得對！歷史天氣可以捕捉**過去天氣變化對就診的影響模式**：

#### 1. **天氣突變效應** (Sudden Weather Change)
```
溫度驟降 5°C → 24 小時內就診增加 15-20%
濕度驟升 20% → 呼吸道問題增加
突發降雨 → 意外傷害減少，但延遲就診增加
```

#### 2. **累積效應** (Accumulation Effect)
```
連續 3 天寒冷 → 第 4 天出現就診高峰
連續 5 天乾旱 → 雨天後「反彈」就診
連續 7 天高溫 → 中暑案例累積
```

#### 3. **天氣組合效應** (Weather Combination)
```
寒冷 + 下雨 → 就診飆升 (雙重影響)
酷熱 + 高濕 → 中暑風險 + 心血管問題
陰冷 + 高濕 → 關節痛、呼吸道問題
```

#### 4. **年度同期模式** (Year-Over-Year Pattern)
```
去年同期類似天氣條件 → 預期就診人數
相同月份-週次 → 季節性基準
```

### 2.2 實施特徵工程

#### 已完成模組 ✅
```python
# historical_weather_patterns.py

def calculate_weather_change_features(df):
    """
    計算天氣變化特徵

    特徵:
    1. Temp_Change_1d/2d/3d: 1-3 天溫度變化
    2. Temp_Change_Abs_1d: 絕對溫度變化（突變）
    3. Is_Sudden_Temp_Drop/Rise: 溫度驟變 (24h > 5°C)
    4. Humidity_Change_1d: 濕度變化
    5. Is_Sudden_Rain/Is_Rain_Stop: 突發降雨/雨停
    6. Weather_Stability_Index: 天氣穩定指數 (0-1)
    """
    # 溫度變化
    df['Temp_Change_1d'] = df['mean_temp'].diff(1)
    df['Temp_Change_Abs_1d'] = df['Temp_Change_1d'].abs()

    # 溫度驟變
    df['Is_Sudden_Temp_Drop'] = (df['Temp_Change_1d'] < -5).astype(int)
    df['Is_Sudden_Temp_Rise'] = (df['Temp_Change_1d'] > 5).astype(int)

    # 濕度變化
    df['Humidity_Change_1d'] = df['mean_relative_humidity'].diff(1)
    df['Is_Sudden_Humidity_Drop'] = (df['Humidity_Change_1d'] < -20).astype(int)

    # 突發降雨
    df['Is_Sudden_Rain'] = ((df['total_rainfall'].shift(1) == 0) &
                            (df['total_rainfall'] > 10)).astype(int)

    # 天氣穩定指數
    temp_std = df['mean_temp'].rolling(3).std() / 10
    humidity_std = df['mean_relative_humidity'].rolling(3).std() / 30
    df['Weather_Stability_Index'] = (temp_std + humidity_std) / 2

    return df
```

#### 天氣組合特徵
```python
def calculate_weather_combination_features(df):
    """天氣組合效應"""

    # 寒冷 + 下雨
    df['Is_Cold_Rainy'] = ((df['mean_temp'] < 15) &
                           (df['total_rainfall'] > 5)).astype(int)

    # 酷熱 + 高濕
    df['Is_Hot_Humid'] = ((df['mean_temp'] > 30) &
                          (df['mean_relative_humidity'] > 80)).astype(int)

    # 陰冷（低溫 + 高濕）
    df['Is_Cold_Damp'] = ((df['mean_temp'] < 15) &
                          (df['mean_relative_humidity'] > 80)).astype(int)

    return df
```

#### 累積效應特徵
```python
def calculate_accumulation_features(df):
    """累積效應特徵"""

    # 連續寒冷天數
    df['Cold_Streak_Days'] = 0
    current_streak = 0
    for i in range(len(df)):
        if df.loc[i, 'mean_temp'] < 15:
            current_streak += 1
        else:
            current_streak = 0
        df.loc[i, 'Cold_Streak_Days'] = current_streak

    # 連續降雨天數
    df['Rainy_Streak_Days'] = 0
    current_streak = 0
    for i in range(len(df)):
        if df.loc[i, 'total_rainfall'] > 0:
            current_streak += 1
        else:
            current_streak = 0
        df.loc[i, 'Rainy_Streak_Days'] = current_streak

    return df
```

#### 年度同期特徵
```python
def calculate_year_over_year_features(df, attendance_df):
    """年度同期比較"""

    # 去年同期平均就診
    historical_avg = df.groupby(['Month', 'Day'])['patient_count'].transform('mean')
    df['Same_Day_Last_Year_Avg'] = historical_avg

    # 與去年偏差
    df['Deviation_From_Last_Year'] = df['patient_count'] - df['Same_Day_Last_Year_Avg']

    # 天氣相似日的歷史就診
    for i in range(len(df)):
        current_temp = df.loc[i, 'mean_temp']
        # 找出溫度相似（±2°C）的歷史日期
        similar_days = df[abs(df['mean_temp'] - current_temp) <= 2]
        df.loc[i, 'Weather_Match_Attendance_Avg'] = similar_days['patient_count'].mean()

    return df
```

### 2.3 特徵列表 (40+ 個)

#### A. 天氣變化特徵 (17 個)
1. `Temp_Change_1d` - 1 天溫度變化
2. `Temp_Change_2d` - 2 天溫度變化
3. `Temp_Change_3d` - 3 天溫度變化
4. `Temp_Change_Abs_1d` - 絕對溫度變化
5. `Temp_Change_Abs_2d` - 2 天絕對變化
6. `Temp_Change_3d_Accum` - 3 天累積變化
7. `Is_Sudden_Temp_Drop` - 溫度驟降
8. `Is_Sudden_Temp_Rise` - 溫度驟升
9. `Humidity_Change_1d` - 濕度變化
10. `Humidity_Change_Abs_1d` - 絕對濕度變化
11. `Is_Sudden_Humidity_Drop` - 濕度驟降
12. `Is_Sudden_Humidity_Rise` - 濕度驟升
13. `Rain_Change_1d` - 降雨變化
14. `Rain_Change_2d` - 2 天降雨變化
15. `Is_Sudden_Rain` - 突發降雨
16. `Is_Rain_Stop` - 雨停
17. `Weather_Stability_Index` - 天氣穩定指數

#### B. 天氣組合特徵 (5 個)
1. `Is_Cold_Rainy` - 寒冷+下雨
2. `Is_Hot_Humid` - 酷熱+高濕
3. `Is_Cold_Damp` - 陰冷
4. `Is_Weather_Unstable` - 天氣不穩定

#### C. 極端天氣特徵 (12 個)
1. `Is_Extreme_Cold` - 極端寒冷 (<10°C)
2. `Is_Extreme_Hot` - 極端酷熱 (>32°C)
3. `Is_Heavy_Rain` - 暴雨 (>50mm)
4. `Is_Moderate_Rain` - 大雨 (10-50mm)
5. `Rainy_Streak_Days` - 連續降雨天數
6. `Dry_Streak_Days` - 連續乾旱天數
7. `Cold_Streak_Days` - 連續寒冷天數
8. `Hot_Streak_Days` - 連續炎熱天數

#### D. 年度同期特徵 (4 個)
1. `Same_Day_Last_Year_Avg` - 去年同期平均
2. `Deviation_From_Last_Year` - 與去年偏差
3. `Weather_Match_Attendance_Avg` - 相似天氣歷史平均
4. `Weekly_Seasonal_Avg` - 週季節性平均

### 2.4 預期改善

```
基準: MAE = 15.73
+ 天氣預報: MAE = 15.0
+ 歷史天氣模式: MAE = 14.2-14.5
額外改善: 5-7%
```

**理由**: 歷史天氣模式捕捉了天氣變化對行為的累積影響，這是單純的預報無法捕捉的。

---

## 階段 3: 流感季節指標 ⭐⭐⭐⭐

### 3.1 香港流感季節特點

**香港流感模式** (基於 2015-2024 歷史數據):
- **冬季流感**: 1 月中旬 - 2 月底 (高峰)
- **夏季流感**: 7 月中旬 - 8 月底 (次高峰)

**流感高峰期定義**:
```
冬季高峰: 1月10日 - 2月20日 (42天)
夏季高峰: 7月15日 - 8月15日 (32天)
```

### 3.2 流感季節特徵 (已完成 ✅)

```python
# flu_season_features.py

FLU_SEASON_PEAKS = {
    'winter': {
        'peak': [(1, 10), (2, 20)],      # 主要高峰期
        'pre_peak': (1, 1),              # 高峰前
        'post_peak': (2, 28),            # 高峰後
    },
    'summer': {
        'peak': [(7, 15), (8, 15)],      # 主要高峰期
        'pre_peak': (7, 1),              # 高峰前
        'post_peak': (8, 31),            # 高峰後
    }
}

def get_flu_season_features(date):
    """計算流感季節特徵"""

    features = {}

    # 基礎特徵
    features['Flu_Month'] = int(date.month in [1, 2, 7, 8])

    # 季節類型
    features['Flu_Season_Winter'] = int(date.month in [1, 2])
    features['Flu_Season_Summer'] = int(date.month in [7, 8])

    # 高峰期判斷
    features['Flu_Is_Peak'] = int(is_in_peak_period(date))

    # 距離高峰期天數
    features['Flu_Days_To_Peak'] = calculate_days_to_peak(date)

    # 高峰前後 7 天
    features['Flu_Pre_Peak_7d'] = int(is_near_peak_start(date))
    features['Flu_Post_Peak_7d'] = int(is_near_peak_end(date))

    # 流感強度 (基於歷史數據)
    year_activity = FLU_ACTIVITY_HISTORY.get(date.year, {'winter': 2.0})
    if date.month in [1, 2]:
        features['Flu_Intensity'] = year_activity['winter']
    elif date.month in [7, 8]:
        features['Flu_Intensity'] = year_activity['summer']
    else:
        features['Flu_Intensity'] = 1.0

    # 強度等級 (0-4)
    features['Flu_Intensity_Level'] = int(features['Flu_Intensity'] * 1.5)

    # 特殊時間點
    features['Flu_Post_NewYear'] = int(date.month == 1 and date.day <= 7)
    features['Flu_School_Start'] = int(
        (date.month == 9 and date.day <= 14) or  # 9月開學
        (date.month == 2 and date.day >= 15)     # 2月開學後
    )

    return features
```

### 3.3 特徵列表 (11 個)

1. `Flu_Month` - 流感月份 (1/2/7/8)
2. `Flu_Season_Winter` - 冬季流感季節
3. `Flu_Season_Summer` - 夏季流感季節
4. `Flu_Is_Peak` - 是否高峰期
5. `Flu_Days_To_Peak` - 距離高峰天數
6. `Flu_Pre_Peak_7d` - 高峰前 7 天
7. `Flu_Post_Peak_7d` - 高峰後 7 天
8. `Flu_Intensity` - 流感強度 (連續)
9. `Flu_Intensity_Level` - 流感強度等級 (0-4)
10. `Flu_Post_NewYear` - 新年後
11. `Flu_School_Start` - 開學後

### 3.4 預期改善

```
基準: MAE = 14.5
+ 流感季節特徵: MAE = 14.0-14.2
額外改善: 2-3%
```

**理由**: 流感季節直接影響呼吸道疾病就診人數，是季節性波動的重要指標。

---

## 階段 4: 模型架構優化 ⭐⭐⭐

### 4.1 超參數優化 (Optuna)

```python
# hyperparameter_optimization.py

import optuna

def objective_xgboost(trial, X_train, y_train, X_val, y_val):
    """XGBoost 超參數優化"""

    params = {
        'n_estimators': trial.suggest_int('n_estimators', 300, 1000),
        'max_depth': trial.suggest_int('max_depth', 4, 10),
        'learning_rate': trial.suggest_float('learning_rate', 0.01, 0.1),
        'min_child_weight': trial.suggest_int('min_child_weight', 1, 10),
        'subsample': trial.suggest_float('subsample', 0.6, 0.95),
        'colsample_bytree': trial.suggest_float('colsample_bytree', 0.6, 0.95),
        'alpha': trial.suggest_float('alpha', 0, 1.0),
        'lambda': trial.suggest_float('lambda', 0.5, 2.0),
        'random_state': 42,
        'n_jobs': -1
    }

    model = xgb.XGBRegressor(**params)
    model.fit(X_train, y_train, verbose=False)

    y_pred = model.predict(X_val)
    mae = mean_absolute_error(y_val, y_pred)

    return mae

# 執行優化
study = optuna.create_study(direction='minimize')
study.optimize(lambda trial: objective_xgboost(trial, X_train, y_train, X_val, y_val),
               n_trials=200)

best_params = study.best_params
```

**預期改善**: MAE 14.0 → 13.7 (2%)

### 4.2 分層建模 (Stratified Modeling)

```python
# stratified_models.py

# 工作日模型
train_weekday = train_data[train_data['Is_Weekend'] == 0]
model_weekday = train_model(train_weekday)

# 週末模型
train_weekend = train_data[train_data['Is_Weekend'] == 1]
model_weekend = train_model(train_weekend)

# 流感季節模型
train_flu = train_data[train_data['Flu_Is_Peak'] == 1]
model_flu = train_model(train_flu)

# 預測時根據日期選擇模型
def predict_with_stratified_model(date, features):
    if is_weekend(date):
        return model_weekend.predict(features)
    elif is_flu_peak(date):
        return model_flu.predict(features)
    else:
        return model_weekday.predict(features)
```

**預期改善**: MAE 13.7 → 13.3 (3%)

### 4.3 特徵選擇優化

```python
# feature_selection.py

def select_features_by_importance(model, X_train, feature_names, threshold=0.01):
    """根據特徵重要性選擇特徵"""

    importance = model.feature_importances_

    # 選擇重要性 > threshold 的特徵
    selected_indices = np.where(importance > threshold)[0]
    selected_features = [feature_names[i] for i in selected_indices]

    print(f"特徵數: {len(feature_names)} → {len(selected_features)}")

    return selected_features

# 使用
selected_features = select_features_by_importance(
    model, X_train, feature_names, threshold=0.01
)
```

**預期改善**: MAE 13.3 → 13.0 (2%)

---

## 階段 5: 高級優化 (可選) ⭐⭐

### 5.1 Stacking Ensemble

```python
# stacking_ensemble.py

from sklearn.ensemble import StackingRegressor
from sklearn.linear_model import Ridge

# Base models
base_models = [
    ('xgboost', xgb.XGBRegressor(**best_xgb_params)),
    ('random_forest', RandomForestRegressor(**best_rf_params)),
    ('gradient_boosting', GradientBoostingRegressor(**best_gb_params))
]

# Meta model
meta_model = Ridge(alpha=1.0)

# Stacking
stacking_model = StackingRegressor(
    estimators=base_models,
    final_estimator=meta_model,
    cv=5
)

stacking_model.fit(X_train, y_train)
```

**預期改善**: MAE 13.0 → 12.7 (2%)

### 5.2 時間序列交叉驗證

```python
# time_series_cv.py

from sklearn.model_selection import TimeSeriesSplit

tscv = TimeSeriesSplit(n_splits=5)

scores = []
for train_idx, val_idx in tscv.split(X):
    X_train_fold, X_val_fold = X.iloc[train_idx], X.iloc[val_idx]
    y_train_fold, y_val_fold = y.iloc[train_idx], y.iloc[val_idx]

    model.fit(X_train_fold, y_train_fold)
    y_pred = model.predict(X_val_fold)

    mae = mean_absolute_error(y_val_fold, y_pred)
    scores.append(mae)

print(f"平均 MAE: {np.mean(scores):.2f} ± {np.std(scores):.2f}")
```

---

## 完整實施計劃

### Week 1: 天氣預報整合 ✅

**任務**:
1. ✅ 創建 `weather_forecast_integration.py`
2. ✅ 測試 API 連接
3. ⏳ 整合到訓練流程
4. ⏳ 訓練並評估改善

**預期結果**: MAE 15.73 → 15.0-15.2 (3-5% 改善)

### Week 2: 歷史天氣模式分析 ✅

**任務**:
1. ✅ 創建 `historical_weather_patterns.py`
2. ⏳ 測試特徵工程
3. ⏳ 整合到訓練流程
4. ⏳ 訓練並評估改善

**預期結果**: MAE 15.0 → 14.2-14.5 (額外 5-7% 改善)

### Week 3: 流感季節 + 整合測試 ✅

**任務**:
1. ✅ 創建 `flu_season_features.py`
2. ⏳ 整合所有特徵
3. ⏳ 運行完整訓練
4. ⏳ 評估綜合改善

**預期結果**: MAE 14.2 → 13.8-14.0 (額外 2-3% 改善)

### Week 4-5: 模型架構優化

**任務**:
1. ⏳ 超參數優化 (Optuna, 200+ trials)
2. ⏳ 分層建模 (工作日/週末/流感)
3. ⏳ 特徵選擇優化

**預期結果**: MAE 13.8 → 13.0-13.3 (5-8% 改善)

### Week 6: 高級優化 (可選)

**任務**:
1. ⏳ Stacking Ensemble
2. ⏳ 時間序列交叉驗證
3. ⏳ 最終評估

**預期結果**: MAE 13.0 → 12.5-12.7 (2-4% 改善)

---

## 特徵列表總結

### 基礎特徵 (16 個)
```python
base_features = [
    # 時間特徵
    'Day_of_Week', 'Month', 'Day_of_Month',
    'Is_Weekend', 'Holiday_Factor',
    'DayOfWeek_sin', 'DayOfWeek_cos',

    # 歷史就診
    'Attendance_Lag1', 'Attendance_Lag7', 'Attendance_Lag30',
    'Attendance_EWMA7', 'Attendance_EWMA14',
    'Daily_Change', 'Weekly_Change',

    # 季節性
    'Is_Winter_Flu_Season'
]
```

### 天氣預報特徵 (14 個)
```python
forecast_features = [
    'Forecast_Temp_Min', 'Forecast_Temp_Max', 'Forecast_Temp_Range',
    'Forecast_Rain_Prob_Encoded', 'Forecast_Rain_Heavy',
    'Forecast_Is_Very_Hot', 'Forecast_Is_Very_Cold',
    'Forecast_Is_Temp_Fluctuating',
    'Forecast_Avg_Temp_3d', 'Forecast_Rain_Days_3d',
    'Forecast_Weather_Sunny', 'Forecast_Weather_Cloudy',
    'Forecast_Weather_Rainy', 'Forecast_Weather_Stormy'
]
```

### 歷史天氣模式特徵 (38 個)
```python
historical_weather_features = [
    # 天氣變化 (17)
    'Temp_Change_1d', 'Temp_Change_2d', 'Temp_Change_3d',
    'Temp_Change_Abs_1d', 'Temp_Change_Abs_2d',
    'Temp_Change_3d_Accum',
    'Is_Sudden_Temp_Drop', 'Is_Sudden_Temp_Rise',
    'Humidity_Change_1d', 'Humidity_Change_Abs_1d',
    'Is_Sudden_Humidity_Drop', 'Is_Sudden_Humidity_Rise',
    'Rain_Change_1d', 'Rain_Change_2d',
    'Is_Sudden_Rain', 'Is_Rain_Stop',
    'Weather_Stability_Index',

    # 天氣組合 (3)
    'Is_Cold_Rainy', 'Is_Hot_Humid', 'Is_Cold_Damp',

    # 極端天氣 (8)
    'Is_Extreme_Cold', 'Is_Extreme_Hot',
    'Is_Heavy_Rain', 'Is_Moderate_Rain',
    'Rainy_Streak_Days', 'Dry_Streak_Days',
    'Cold_Streak_Days', 'Hot_Streak_Days',

    # 年度同期 (4)
    'Same_Day_Last_Year_Avg', 'Deviation_From_Last_Year',
    'Weather_Match_Attendance_Avg', 'Weekly_Seasonal_Avg'
]
```

### 流感季節特徵 (11 個)
```python
flu_features = [
    'Flu_Month', 'Flu_Season_Winter', 'Flu_Season_Summer',
    'Flu_Is_Peak', 'Flu_Days_To_Peak',
    'Flu_Pre_Peak_7d', 'Flu_Post_Peak_7d',
    'Flu_Intensity', 'Flu_Intensity_Level',
    'Flu_Post_NewYear', 'Flu_School_Start'
]
```

**總特徵數**: 16 + 14 + 38 + 11 = **79 個特徵**

---

## 預期最終結果

```
當前: MAE = 15.73, R² = 0.41
階段 1 (天氣預報): MAE = 15.0-15.2, R² = 0.45
階段 2 (歷史天氣): MAE = 14.2-14.5, R² = 0.48
階段 3 (流感季節): MAE = 13.8-14.0, R² = 0.50
階段 4 (模型優化): MAE = 13.0-13.3, R² = 0.53
階段 5 (高級優化): MAE = 12.5-12.7, R² = 0.55

總改善: 17-20%
誤差率: 6.2% → 4.8-5.0%
```

---

## 數據需求

| 特徵類別 | 數據來源 | 可用性 | 優先級 |
|----------|----------|--------|--------|
| **天氣預報** | 香港天文台 API | ✅ 即時 | ⭐⭐⭐⭐⭐ |
| **歷史天氣** | weather_full_history.csv | ✅ 已有 | ⭐⭐⭐⭐ |
| **流感季節** | 公開數據 (手動) | ✅ 即時 | ⭐⭐⭐⭐ |
| **就診歷史** | actual_data 表 | ✅ 已有 | ⭐⭐⭐⭐⭐ |
| **假期因子** | dynamic_factors.json | ✅ 已有 | ⭐⭐⭐ |

---

## 實施檢查清單

### ✅ 已完成
- [x] 天氣預報模組 (`weather_forecast_integration.py`)
- [x] 流感季節模組 (`flu_season_features.py`)
- [x] 歷史天氣模式模組 (`historical_weather_patterns.py`)
- [x] 整合訓練腳本 (`train_integrated_optimization.py`)

### ⏳ 待完成
- [ ] 測試所有模組整合
- [ ] 運行完整訓練
- [ ] 評估改善效果
- [ ] 超參數優化
- [ ] 分層建模實現
- [ ] 最終模型部署

---

## 下一步行動

**立即執行**:
```bash
# 1. 測試所有特徵模組
cd python
python weather_forecast_integration.py
python flu_season_features.py
python historical_weather_patterns.py

# 2. 運行整合訓練
python train_integrated_optimization.py

# 3. 評估結果
cat models/integrated_optimization_results.json
```

**本週目標**:
- ✅ 完成所有特徵模組
- ⏳ 運行完整訓練
- ⏳ 達成 MAE < 15.0

**4 週目標**:
- MAE < 13.5 (14% 改善)
- 所有特徵上線
- 模型部署到 Railway

---

## 風險與挑戰

### 1. 特徵過多風險
**問題**: 79 個特徵可能導致過擬合
**解決**:
- 使用特徵重要性篩選
- L1 正則化 (Lasso)
- 交叉驗證監控

### 2. 數據稀疏性
**問題**: 某些特徵（如極端天氣）出現頻率低
**解決**:
- 合併相似特徵
- 使用分層採樣
- 增加數據增強

### 3. 計算成本
**問題**: 特徵多 + 超參數優化 = 訓練時間長
**解決**:
- 使用 GPU 加速 (XGBoost GPU 支持)
- 並行化 Optuna trials
- 雲端訓練 (Railway)

---

## 總結

這個優化計劃結合了：

1. **前瞻性指標** (天氣預報) - 影響未來行為
2. **歷史模式** (天氣變化、累積效應) - 捕捉過去影響
3. **季節性指標** (流感季節) - 解釋週期性波動
4. **模型優化** (超參數、分層) - 提升擬合能力

**預期改善**: MAE 15.73 → 12.5-13.0 (17-20%)

這是一個現實可行的目標，基於數據驅動的方法，逐步優化每個環節。
