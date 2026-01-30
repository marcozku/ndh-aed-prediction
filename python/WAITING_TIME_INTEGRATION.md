# 醫管局急診室等候時間整合指南

## ✅ 已完成

1. **API 連接成功**
   - URL: `https://www.ha.org.hk/opendata/aed/aedwtdata2-tc.json`
   - 更新頻率: 約每 15-30 分鐘
   - 北區醫院數據正常

2. **測試結果** (2026-01-17 23:44)
   ```
   北區醫院等候時間: 5.5 小時 (橙色級別)
   緊急類別: 23 分鐘
   次緊急 (50分位): 3 小時
   次緊急 (95分位): 5.5 小時
   ```

---

## 📊 數據說明

### API 返回格式
```json
{
    "waitTime": [
        {
            "hospName": "北區醫院",
            "t45p95": "5.5 小時",  // 次緊急/非緊急 95分位
            "t45p50": "3 小時",    // 次緊急/非緊急 50分位
            "t3p50": "23 分鐘",    // 緊急 50分位
            "updateTime": "2026年1月17日 下午11時30分"
        }
    ]
}
```

### 等候時間級別
| 級別 | 顏色 | 等候時間 | 意義 |
|------|------|----------|------|
| 0 | 綠色 | < 2 小時 | 正常運作 |
| 1 | 黃色 | 2-4 小時 | 較繁忙 |
| 2 | 橙色 | 4-6 小時 | **需關注** |
| 3 | 紅色 | > 6 小時 | 嚴重超標 |

---

## 🎯 整合策略

### 方案 1: 實時調整 (快速實現)

```python
from er_waiting_time_integrated import get_ndh_waiting_time, adjust_prediction_with_waiting_time, calculate_waiting_time_features

# 1. 獲取當前等候時間
ndh_wait = get_ndh_waiting_time()

# 2. 計算特徵
features = calculate_waiting_time_features(ndh_wait)
# {
#     'ER_Waiting_Minutes': 330.0,
#     'ER_Waiting_Level': 2,
#     'ER_Waiting_Ratio': 1.2,      # 與歷史同時段比較
#     'ER_Waiting_Above_Normal': 1,  # 是否高於正常
#     'ER_Waiting_Trend_3h': 15     # 3小時趨勢
# }

# 3. 調整預測
base_prediction = 250  # XGBoost 原始預測
adjusted = adjust_prediction_with_waiting_time(base_prediction, features)
# 如果等候時間高於正常，調高預測
```

### 方案 2: 作為模型特徵 (長期)

收集 2-4 週等候時間歷史後：

1. **匹配就診數據**
   ```sql
   SELECT a.date, a.patient_count, w.minutes, w.level
   FROM actual_data a
   LEFT JOIN ndh_waiting_history w
   ON DATE(a.date) = DATE(w.datetime)
   ```

2. **計算相關性**
   ```python
   correlation = df['patient_count'].corr(df['minutes'])
   # 預期: 0.6-0.8 (中等至強相關)
   ```

3. **加入模型訓練**
   ```python
   features = [
       ...existing_features...,
       'ER_Waiting_Minutes',
       'ER_Waiting_Level',
       'ER_Waiting_Ratio',
       'ER_Waiting_Above_Normal'
   ]
   ```

---

## 🚀 實施步驟

### 第一階段: 數據收集 (1-2 週)

1. **設置定時任務**
   ```bash
   # 每小時收集一次
   crontab -e

   # 添加以下行:
   0 * * * * cd /path/to/ndh-aed-prediction/python && python -c "from er_waiting_time_integrated import save_waiting_time_history; save_waiting_time_history()"
   ```

2. **驗證數據收集**
   ```bash
   python -c "
   from er_waiting_time_integrated import simulate_waiting_time_correlation
   simulate_waiting_time_correlation()
   "
   ```

### 第二階段: 相關性分析 (第 3 週)

```python
# 創建分析腳本
import pandas as pd
import psycopg2
from er_waiting_time_integrated import save_waiting_time_history

# 1. 獲取就診數據
conn = psycopg2.connect(...)
df_actual = pd.read_sql("SELECT date, patient_count FROM actual_data ORDER BY date", conn)

# 2. 獲取等候時間歷史
df_wait = pd.read_csv('models/ndh_waiting_history.csv')
df_wait['datetime'] = pd.to_datetime(df_wait['datetime'])
df_wait['date'] = df_wait['datetime'].dt.date

# 3. 匹配
df_merged = df_actual.merge(df_wait, left_on='date', right_on='date')

# 4. 計算相關性
corr = df_merged['patient_count'].corr(df_merged['minutes'])
print(f"相關係數: {corr:.3f}")

# 預期結果: 0.6-0.8 (中等至強相關)
```

### 第三階段: 整合到模型 (第 4 週)

1. **更新特徵工程**
   ```python
   # feature_engineering.py

   def add_waiting_time_features(df, waiting_df):
       """等候時間特徵"""
       # 同日等候時間 (使用當天上午數據)
       df = df.merge(
           waiting_df[['date', 'minutes', 'level']].rename(columns={'minutes': 'ER_Waiting_Minutes'}),
           on='date',
           how='left'
       )

       # 填補缺失值
       df['ER_Waiting_Minutes'] = df['ER_Waiting_Minutes'].fillna(180)  # 默認 3 小時
       df['ER_Waiting_Level'] = df['level'].fillna(1).astype(int)

       # 等候時間級別 One-Hot
       df['ER_Wait_Level_0'] = (df['ER_Waiting_Level'] == 0).astype(int)
       df['ER_Wait_Level_1'] = (df['ER_Waiting_Level'] == 1).astype(int)
       df['ER_Wait_Level_2'] = (df['ER_Waiting_Level'] == 2).astype(int)
       df['ER_Wait_Level_3'] = (df['ER_Waiting_Level'] == 3).astype(int)

       return df
   ```

2. **重新訓練模型**
   ```bash
   python train_xgboost.py
   ```

---

## 📈 預期改善

### 保守估計
- 當前 MAE: 15.73
- 加入等候時間特徵後: **14.0-14.5**
- 改善: **8-11%**

### 樂觀估計 (如果相關性 > 0.7)
- MAE: **13.0-13.5**
- 改善: **14-17%**

---

## 💡 使用建議

1. **立即實施**: 實時調整功能 (方案 1)
   - 無需收集大量歷史數據
   - 立即可用於當天預測修正

2. **短期實施**: 定時收集數據
   - 設置 cron job 每小時收集
   - 1 週後開始初步分析

3. **中期實施**: 模型特徵整合 (方案 2)
   - 2-4 週數據後計算相關性
   - 確認相關性 > 0.5 後加入模型

---

## 📝 相關文件

- `python/er_waiting_time_integrated.py` - 主模組
- `models/ndh_waiting_history.csv` - 歷史數據 (自動生成)
- `C:\Github\hk-aed-waittime\app.js` - 前端顯示系統

---

## 🔍 監控指標

建立監控後追蹤：

1. **數據收集率**
   ```bash
   # 應該有: 每小時 1 筆 × 24 小時 × 30 天 = 720 筆/月
   wc -l models/ndh_waiting_history.csv
   ```

2. **相關性趨勢**
   ```
   Week 1: N/A (數據不足)
   Week 2: 預期 0.4-0.6
   Week 3: 預期 0.5-0.7
   Week 4: 預期 0.6-0.8
   ```

3. **MAE 改善**
   ```
   基準: 15.73
   Week 2: 預期 15.0-15.3 (實時調整)
   Week 4: 預期 14.0-14.5 (模型特徵)
   ```

---

## ✅ 快速開始

```bash
# 1. 測試 API
python python/er_waiting_time_integrated.py

# 2. 開始收集 (可選 - 使用 cron 自動化)
python -c "from er_waiting_time_integrated import save_waiting_time_history; save_waiting_time_history()"

# 3. 查看歷史
head models/ndh_waiting_history.csv
```
