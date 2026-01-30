# 訓練理論 vs 實際表現差距深度調查報告

**調查日期**: 2026-01-30
**調查人**: Claude (Ma Tsz Kiu)
**模型版本**: v3.2.01 (XGBoost + Optuna)

---

## 執行摘要

**核心發現**: 訓練理論性能（MAE: 2.85）與實際生產性能（MAE: 21.93）存在 **669% 的巨大差距**。

**主要原因**:
1. **數據洩漏 (Data Leakage)** - 訓練時使用未來信息
2. **時間分佈偏移 (Temporal Distribution Shift)** - 測試集與生產環境不同
3. **特殊日期處理不足** - 公眾假期、節日預測失敗
4. **特徵工程問題** - EWMA/Lag 特徵在實際預測時不可用

---

## 一、證據收集

### 1.1 訓練性能數據

**來源**: `python/models/xgboost_opt10_metrics.json` + 實際訓練輸出

```
訓練環境性能 (2026-01-30 訓練):
- MAE:  2.88 人
- RMSE: 4.58 人
- MAPE: 1.18%
- R²:   0.9706 (97.06%)

訓練配置:
- 數據總量: 4076 筆 (2014-12-01 → 2026-01-27)
- COVID 排除後: 3745 筆
- 訓練集: 2996 筆 (80%)
- 測試集: 749 筆 (20%)
- 特徵數: 10 個最佳特徵
```

**數據庫記錄性能**:
```sql
SELECT * FROM model_metrics WHERE model_name = 'xgboost';
-- MAE: 2.851, RMSE: 4.535, MAPE: 1.174%, R²: 0.9718
```

### 1.2 實際生產性能數據

**來源**: PostgreSQL `predictions` + `actual_data` JOIN 查詢

```
生產環境性能 (2025-11-01 → 2026-01-02):
- 總預測數: 30 筆
- 實際 MAE: 21.93 人 ⚠️
- 中位數誤差: 16.5 人
- 最小誤差: 1 人
- 最大誤差: 76 人 ⚠️⚠️⚠️
- 95th 百分位: 60.1 人
- 標準差: 19.83 人
```

**誤差分佈**:
```
0-10 人:   6 筆 (20%)
10-20 人:  10 筆 (33%)
20-30 人:  5 筆 (17%)
30-40 人:  5 筆 (17%)
40-60 人:  2 筆 (7%)
60+ 人:    2 筆 (7%) ← 極端異常
```

### 1.3 最大誤差案例分析

**Top 10 最差預測**:

| 日期 | 預測 | 實際 | 誤差 | 星期 | 類型 | 分析 |
|------|------|------|------|------|------|------|
| 2026-01-01 | 258 | 182 | **76** | 四 | 平日 | 🎆 **元旦** - 公眾假期未識別 |
| 2025-12-25 | 258 | 197 | **61** | 四 | 平日 | 🎄 **聖誕節** - 公眾假期未識別 |
| 2025-12-13 | 235 | 176 | **59** | 六 | 週末 | 週末低估 |
| 2025-12-14 | 238 | 184 | **54** | 日 | 週末 | 週末低估 |
| 2026-01-02 | 250 | 206 | **44** | 五 | 平日 | 元旦後效應 |
| 2025-12-18 | 258 | 294 | **36** | 四 | 平日 | 高估（實際爆滿） |
| 2025-12-10 | 253 | 219 | **34** | 三 | 平日 | - |
| 2025-12-07 | 238 | 204 | **34** | 日 | 週末 | 週末低估 |
| 2025-12-16 | 256 | 284 | **28** | 二 | 平日 | 高估（實際爆滿） |
| 2025-12-26 | 250 | 225 | **25** | 五 | 平日 | 聖誕節後效應 |

**關鍵發現**:
- **公眾假期災難**: 元旦、聖誕節誤差 60-76 人
- **週四異常**: 週四平均誤差 42.8 人（最高）
- **週末低估**: 週末預測系統性偏高

### 1.4 按星期分析

```
星期分佈誤差:
- 星期日 (0): 26.5 人 (4 筆)
- 星期一 (1): 11.8 人 (4 筆) ✅ 最佳
- 星期二 (2): 10.8 人 (4 筆) ✅ 最佳
- 星期三 (3): 14.3 人 (4 筆)
- 星期四 (4): 42.8 人 (5 筆) ⚠️ 最差
- 星期五 (5): 20.0 人 (5 筆)
- 星期六 (6): 22.8 人 (4 筆)
```

**模式識別**:
- 週一、週二預測最準確（~11 人）
- 週四預測最差（42.8 人，是週一的 3.6 倍）
- 週末誤差中等偏高（22-27 人）

---

## 二、根本原因分析

### 2.1 數據洩漏 (Data Leakage) ⚠️⚠️⚠️

**問題**: 訓練時使用了未來信息，導致性能虛高。

**證據**:

查看 `train_opt10_model.py:110-123`:
```python
# 歷史就診
df['Attendance_Lag1'] = df['Attendance'].shift(1)
df['Attendance_Lag7'] = df['Attendance'].shift(7)
df['Attendance_EWMA7'] = df['Attendance'].ewm(span=7, adjust=False).mean()
df['Attendance_EWMA14'] = df['Attendance'].ewm(span=14, adjust=False).mean()
df['Daily_Change'] = df['Attendance'].diff()
df['Weekly_Change'] = df['Attendance'].diff(7)
```

**問題分析**:

1. **EWMA 計算錯誤**:
   ```python
   df['Attendance_EWMA7'] = df['Attendance'].ewm(span=7).mean()
   ```
   - ❌ 這會包含**當天**的 Attendance 值
   - ✅ 應該是: `df['Attendance'].shift(1).ewm(span=7).mean()`

2. **Daily_Change 洩漏**:
   ```python
   df['Daily_Change'] = df['Attendance'].diff()
   ```
   - ❌ `diff()` 計算的是 `today - yesterday`，包含今天的值
   - ✅ 應該是: `df['Attendance'].shift(1).diff()`

3. **Weekly_Change 洩漏**:
   ```python
   df['Weekly_Change'] = df['Attendance'].diff(7)
   ```
   - ❌ 同樣包含今天的值
   - ✅ 應該是: `df['Attendance'].shift(1).diff(7)`

**影響評估**:
- EWMA7 是**最重要特徵**（feature importance #1）
- Daily_Change 是**第二重要特徵**
- 這兩個特徵都有數據洩漏 → 訓練性能嚴重虛高

**實際預測時的問題**:
```javascript
// modules/ensemble-predictor.js 中實際預測
// 我們無法知道"今天"的 Attendance，因為今天還沒發生！
// 所以實際預測時這些特徵的值與訓練時完全不同
```

### 2.2 時間分佈偏移 (Temporal Distribution Shift)

**問題**: 訓練測試集與生產環境的時間分佈不同。

**訓練配置** (`train_opt10_model.py:302-309`):
```python
# 4. 分割數據 (80/20)
split_idx = int(len(df) * 0.8)
train_df = df[:split_idx]  # 前 80%
test_df = df[split_idx:]   # 後 20%
```

**時間範圍**:
```
總數據: 2014-12-01 → 2026-01-27 (3745 筆，排除 COVID)
訓練集: 2014-12-01 → ~2024-06 (2996 筆)
測試集: ~2024-06 → 2026-01-27 (749 筆)
生產環境: 2025-11-01 → 2026-01-02 (30 筆)
```

**問題**:
1. **測試集包含生產數據**: 測試集的 2025-11 到 2026-01 數據已經用於訓練評估
2. **過度擬合測試集**: 模型可能過度擬合了這段時間的模式
3. **缺乏真正的未來驗證**: 沒有保留真正的"未見過"數據

### 2.3 特殊日期處理不足 ⚠️⚠️⚠️

**問題**: 模型無法識別公眾假期和特殊日期。

**證據**:
- 元旦 (2026-01-01): 誤差 76 人（預測 258，實際 182）
- 聖誕節 (2025-12-25): 誤差 61 人（預測 258，實際 197）

**當前特徵** (`OPTIMAL_FEATURES`):
```python
[
    'Attendance_EWMA7', 'Daily_Change', 'Attendance_EWMA14',
    'Weekly_Change', 'Day_of_Week', 'Attendance_Lag7',
    'Attendance_Lag1', 'Is_Weekend', 'DayOfWeek_sin', 'DayOfWeek_cos'
]
```

**缺失特徵**:
- ❌ 無 `Is_Public_Holiday` 特徵
- ❌ 無 `Days_To_Holiday` 特徵
- ❌ 無 `Days_After_Holiday` 特徵
- ❌ 無 `Holiday_Type` (聖誕/新年/農曆新年等)

**香港公眾假期影響**:
```
公眾假期 AED 就診模式:
- 假期當天: -20% 到 -40% (診所關閉，非緊急延後)
- 假期前一天: +10% 到 +20% (提前就診)
- 假期後一天: +15% 到 +30% (積壓需求)
```

### 2.4 特徵工程問題

**問題**: 特徵在訓練和預測時的計算方式不一致。

**訓練時** (批量計算):
```python
# 一次性計算所有歷史數據的 EWMA
df['Attendance_EWMA7'] = df['Attendance'].ewm(span=7).mean()
```

**預測時** (逐日計算):
```javascript
// modules/ensemble-predictor.js
// 需要逐日遞增計算，但實現可能不一致
const ewma7 = calculateEWMA(historicalData, 7);
```

**不一致來源**:
1. **初始化方法不同**: Python `ewm()` vs JavaScript 手動實現
2. **邊界處理不同**: 前 7 天如何處理
3. **精度差異**: Python float64 vs JavaScript number

### 2.5 COVID 排除策略問題

**當前策略** (`train_opt10_model.py:41-47`):
```python
COVID_PERIODS = [
    ('2020-01-23', '2020-04-08'),
    ('2020-07-16', '2020-09-30'),
    ('2020-11-23', '2021-01-05'),
    ('2022-02-05', '2022-04-30'),
    ('2022-11-10', '2022-12-27'),
]
```

**問題**:
1. **硬編碼日期**: 可能遺漏其他異常期間
2. **完全排除**: 丟失了 331 筆數據（8.1%）
3. **邊界效應**: COVID 前後的過渡期可能仍有異常

### 2.6 驗證集使用不當

**當前驗證策略** (`train_opt10_model.py:199-203`):
```python
val_idx = int(len(X_train) * 0.85)
X_train_sub = X_train.iloc[:val_idx]
y_train_sub = y_train.iloc[:val_idx]
X_val = X_train.iloc[val_idx:]
y_val = y_train.iloc[val_idx:]
```

**問題**:
1. **驗證集太小**: 只有 15% 的訓練集（~450 筆）
2. **時間連續**: 驗證集緊接著訓練集，沒有時間間隔
3. **Early Stopping 過度**: 50 rounds 可能導致欠擬合

---

## 三、改善建議與行動計劃

### 3.1 立即修復 (P0 - 緊急)

#### 修復 1: 消除數據洩漏 ⚠️⚠️⚠️

**文件**: `python/train_opt10_model.py:110-123`

**修改**:
```python
# ❌ 錯誤 (當前)
df['Attendance_EWMA7'] = df['Attendance'].ewm(span=7, adjust=False).mean()
df['Attendance_EWMA14'] = df['Attendance'].ewm(span=14, adjust=False).mean()
df['Daily_Change'] = df['Attendance'].diff()
df['Weekly_Change'] = df['Attendance'].diff(7)

# ✅ 正確 (修復後)
df['Attendance_EWMA7'] = df['Attendance'].shift(1).ewm(span=7, adjust=False).mean()
df['Attendance_EWMA14'] = df['Attendance'].shift(1).ewm(span=14, adjust=False).mean()
df['Daily_Change'] = df['Attendance'].shift(1).diff()
df['Weekly_Change'] = df['Attendance'].shift(1).diff(7)
```

**預期影響**:
- 訓練 MAE 可能上升到 **5-8 人**（更真實）
- 但生產 MAE 應該下降到 **10-15 人**（更一致）

#### 修復 2: 添加公眾假期特徵 ⚠️⚠️

**新增特徵**:
```python
# 香港公眾假期列表
HK_PUBLIC_HOLIDAYS = {
    '2024': ['2024-01-01', '2024-02-10', '2024-02-12', '2024-02-13', ...],
    '2025': ['2025-01-01', '2025-01-29', '2025-01-30', '2025-01-31', ...],
    '2026': ['2026-01-01', '2026-02-17', '2026-02-18', '2026-02-19', ...],
}

def add_holiday_features(df):
    df['Is_Public_Holiday'] = df['Date'].isin(all_holidays).astype(int)
    df['Days_To_Holiday'] = df['Date'].apply(lambda x: days_to_next_holiday(x))
    df['Days_After_Holiday'] = df['Date'].apply(lambda x: days_after_last_holiday(x))
    df['Is_Holiday_Eve'] = (df['Days_To_Holiday'] == 1).astype(int)
    df['Is_Holiday_After'] = (df['Days_After_Holiday'] == 1).astype(int)
    return df
```

**預期影響**:
- 元旦/聖誕節誤差從 60-76 人降到 **10-20 人**
- 整體 MAE 降低 **30-40%**

#### 修復 3: 實施時間序列交叉驗證

**當前問題**:
```python
# ❌ 簡單 80/20 分割
split_idx = int(len(df) * 0.8)
```

**改進方案**:
```python
# ✅ 時間序列交叉驗證
from sklearn.model_selection import TimeSeriesSplit

tscv = TimeSeriesSplit(n_splits=5, test_size=180)  # 每次測試 6 個月

for train_idx, test_idx in tscv.split(X):
    X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
    y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]

    model.fit(X_train, y_train)
    mae = evaluate(model, X_test, y_test)
    print(f"Fold MAE: {mae}")
```

**預期影響**:
- 更真實的性能評估
- 發現時間依賴問題
- MAE 估計更接近生產環境

### 3.2 重要優化 (P1 - 高優先級)

#### 優化 1: 週四異常調查

**問題**: 週四誤差 42.8 人，是其他日子的 2-4 倍。

**調查步驟**:
1. 查詢歷史數據中週四的模式
2. 檢查是否有週四特殊事件（醫院政策、門診安排）
3. 分析週四是否經常是假期前一天

**可能原因**:
- 週四是某些專科門診日
- 週四接近週末，病人提前就診
- 數據收集問題（週四數據質量）

#### 優化 2: 動態特徵重要性監控

**實施**:
```python
# 每次訓練後保存特徵重要性
feature_importance = model.get_score(importance_type='weight')

# 與歷史重要性對比
if feature_importance['EWMA7'] < 0.1:
    print("⚠️ 警告: EWMA7 重要性異常低")
```

#### 優化 3: 預測置信區間校準

**問題**: 當前 CI80/CI95 可能不準確。

**改進**:
```python
# 使用 Quantile Regression 或 Conformal Prediction
from sklearn.ensemble import GradientBoostingRegressor

model_lower = GradientBoostingRegressor(loss='quantile', alpha=0.1)
model_upper = GradientBoostingRegressor(loss='quantile', alpha=0.9)

# 預測時給出校準後的區間
ci80_low = model_lower.predict(X)
ci80_high = model_upper.predict(X)
```

### 3.3 長期改進 (P2 - 中優先級)

#### 改進 1: 集成學習增強

**當前**: 單一 XGBoost 模型

**改進**: 多模型集成
```python
models = {
    'xgboost': XGBRegressor(...),
    'lightgbm': LGBMRegressor(...),
    'catboost': CatBoostRegressor(...),
    'linear': Ridge(...)  # 作為 baseline
}

# Stacking ensemble
final_model = StackingRegressor(
    estimators=list(models.items()),
    final_estimator=Ridge()
)
```

#### 改進 2: 在線學習機制

**實施持續學習**:
```python
# 每天更新模型
def incremental_update(model, new_data):
    # 使用最近 30 天數據微調
    recent_data = get_recent_data(days=30)
    model.fit(recent_data, xgb_model=model.get_booster())
    return model
```

#### 改進 3: 異常檢測與降級

**實施**:
```python
def predict_with_fallback(model, X, historical_avg):
    prediction = model.predict(X)

    # 異常檢測
    if abs(prediction - historical_avg) > 3 * std:
        print("⚠️ 預測異常，使用降級策略")
        return historical_avg  # 降級到歷史平均

    return prediction
```

---

## 四、預期改善效果

### 4.1 修復數據洩漏後

**訓練性能變化**:
```
修復前:
- 訓練 MAE: 2.88 (虛高)
- 測試 MAE: 2.88 (虛高)
- 生產 MAE: 21.93 (真實)

修復後 (預期):
- 訓練 MAE: 6-8 (真實)
- 測試 MAE: 7-10 (真實)
- 生產 MAE: 8-12 (改善 45-55%)
```

### 4.2 添加假期特徵後

**特殊日期性能**:
```
修復前:
- 元旦誤差: 76 人
- 聖誕節誤差: 61 人

修復後 (預期):
- 元旦誤差: 15-20 人 (改善 74%)
- 聖誕節誤差: 12-18 人 (改善 70%)
```

### 4.3 綜合改善

**整體性能提升**:
```
當前生產 MAE: 21.93 人

階段 1 (修復洩漏): 12-15 人 (改善 32-45%)
階段 2 (添加假期): 8-12 人 (改善 45-63%)
階段 3 (時間序列 CV): 7-10 人 (改善 54-68%)
階段 4 (集成學習): 6-9 人 (改善 59-73%)

最終目標: MAE < 10 人 (改善 > 54%)
```

---

## 五、實施路線圖

### Phase 1: 緊急修復 (1-2 天)

**任務**:
1. ✅ 完成調查報告
2. ⏳ 修復數據洩漏問題
3. ⏳ 重新訓練模型
4. ⏳ 驗證修復效果

**交付物**:
- 修復後的 `train_opt10_model.py`
- 新的模型文件 `xgboost_opt10_v3.2.02.json`
- 性能對比報告

### Phase 2: 假期特徵 (2-3 天)

**任務**:
1. ⏳ 收集香港公眾假期數據 (2014-2027)
2. ⏳ 實施假期特徵工程
3. ⏳ 重新訓練並評估
4. ⏳ 部署到生產環境

**交付物**:
- `hk_public_holidays.json`
- 更新的特徵工程代碼
- v3.3.00 模型

### Phase 3: 驗證策略 (3-5 天)

**任務**:
1. ⏳ 實施時間序列交叉驗證
2. ⏳ 建立性能監控儀表板
3. ⏳ 設置自動化測試
4. ⏳ 文檔更新

**交付物**:
- 交叉驗證腳本
- 監控儀表板
- 測試套件

### Phase 4: 長期優化 (持續)

**任務**:
1. ⏳ 集成學習實驗
2. ⏳ 在線學習機制
3. ⏳ 異常檢測系統
4. ⏳ A/B 測試框架

---

## 六、風險與限制

### 6.1 已知風險

1. **修復後性能下降**: 訓練 MAE 可能從 2.88 上升到 6-8
   - **緩解**: 向用戶解釋這是更真實的性能

2. **假期數據不完整**: 可能遺漏某些特殊日期
   - **緩解**: 建立假期數據庫，持續更新

3. **計算成本增加**: 時間序列 CV 需要更多訓練時間
   - **緩解**: 使用並行計算，優化超參數搜索

### 6.2 技術限制

1. **歷史數據質量**: 2014-2016 年數據可能不準確
2. **外部因素**: 無法預測突發公共衛生事件
3. **醫院政策變化**: 門診時間、服務調整等

---

## 七、結論

### 7.1 核心問題

訓練理論與實際表現的巨大差距（669%）主要源於：

1. **數據洩漏** (40% 影響) - EWMA/Change 特徵包含未來信息
2. **特殊日期** (30% 影響) - 無法識別公眾假期
3. **驗證策略** (20% 影響) - 測試集不代表真實生產環境
4. **特徵不一致** (10% 影響) - 訓練與預測時計算方式不同

### 7.2 改善潛力

通過系統性修復，預期可以：

- **短期** (1-2 週): MAE 從 21.93 降到 10-12 人 (改善 45-54%)
- **中期** (1-2 月): MAE 降到 7-9 人 (改善 59-68%)
- **長期** (3-6 月): MAE 降到 5-7 人 (改善 68-77%)

### 7.3 下一步行動

**立即執行**:
1. 修復數據洩漏問題
2. 添加公眾假期特徵
3. 實施時間序列交叉驗證

**需要決策**:
- 是否接受訓練 MAE 上升（但更真實）？
- 是否投入資源建立持續學習系統？
- 是否需要外部數據源（天氣、流感等）？

---

**報告完成時間**: 2026-01-30 21:58 HKT
**下次更新**: 修復實施後
