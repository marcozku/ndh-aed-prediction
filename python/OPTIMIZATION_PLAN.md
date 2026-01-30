# NDH AED 預測算法優化計劃
## 目標：將 MAE 從 15.77 降至 10 以下

當前基準 (2026-01-17)
- 最佳 MAE: 15.77 (Ensemble + 天氣 + 排除 COVID)
- R² = 0.4137 (58.6% 變異未解釋)
- 數據: 4,065 天 (2014-2026)

---

## 階段 1: 特徵工程優化 (預期 MAE: 15.77 → 13.5)

### 1.1 高級滯後特徵
```python
# 當前: 簡單滯後 (Lag1, Lag7, Lag30)
# 優化: 自適應滯後 + 動態權重

- [ ] 實現自適應滯後窗口 (根據 ACF/PACF 自動選擇)
- [ ] 添加多週期滯後組合 (Lag1+Lag2+Lag3 加權)
- [ ] 實現滯後特徵的交互項 (Lag7 × Is_Weekend)
- [ ] 季節性滯後 (同月份去年數據 Lag365)
```

### 1.2 高級滾動統計
```python
# 當前: 簡單滾動平均 (Rolling7, Rolling30)
# 優化: 多維度滾動特徵

- [ ] 滾動偏度/峰度 (Rolling_Skew, Rolling_Kurt)
- [ ] 滾動趨勢 (線性回歸斜率 over N days)
- [ ] 滾動波動率 (Rolling_Std / Rolling_Mean)
- [ ] 滾動分位數 (25th, 75th percentile)
- [ ] 跨週期滾動比率 (Rolling7 / Rolling30)
```

### 1.3 時間特徵深度挖掘
```python
# 當前: 基礎時間特徵 (年/月/日/星期)
# 優化: 多層次時間編碼

- [ ] 月內位置 (Day_of_Month / Days_in_Month)
- [ ] 週內位置 (Day_of_Week × Week_of_Month)
- [ ] 月度轉換期 (Month_End_5d, Month_Start_5d)
- [ ] 季節進度 (通過 DayOfYear 計算季節內位置)
- [ ] 工作日/假期交界日 (假日前後各一天)
```

### 1.4 異常值處理
```python
# 當前: COVID 排除
# 優化: 智能異常檢測

- [ ] 實現 Isolation Forest 異常檢測
- [ ] 動態異常標記 (Z-score > 3 標記)
- [ ] 異常期間特徵 (Is_Anomaly_Period)
- [ ] 異常修復 (用周圍數據插值)
```

### 1.5 外部數據整合
```python
# 當前: 天氣 + AI Factors
# 優化: 更多外部信號

- [ ] AQHI 空氣質素歷史數據
- [ ] 天氣警告信號 (颱風、暴雨、酷熱)
- [ ] 醫院內部事件 (維修、停車、系統故障)
- [ ] 公共交通故障數據
- [ ] 當地大型活動 (展覽、演唱會)
```

---

## 階段 2: 模型架構優化 (預期 MAE: 13.5 → 12.0)

### 2.1 超參數深度優化
```python
# 當前: Optuna 30 trials
# 優化: 更全面的搜索

- [ ] 增加 Optuna trials 到 200+
- [ ] 實現多層次超參數搜索
- [ ] 添加早停策略優化
- [ ] 學習率調度 (warmup + decay)
- [ ] 樹深度動態調整
```

### 2.2 模型融合策略
```python
# 當前: 簡單平均
# 優化: 智能加權

- [ ] Stacking Ensemble (用 Linear Regression/meta-learner)
- [ ] 動態權重 (根據近期性能調整)
- [ ] 分層 Ensemble (平日/週末/假期不同模型)
- [ ] 時間分片 Ensemble (不同年份用不同權重)
```

### 2.3 新模型引入
```python
- [ ] CatBoost (處理類別特徵更好)
- [ ] Neural Network (LSTM for time series)
- [ ] Prophet (FB 開源時間序列)
- [ ] N-BEATS (Deep learning for time series)
- [ ] Transformer-based models
```

### 2.4 分層建模策略
```python
# 當前: 單一模型預測所有天
# 優化: 類型分層

- [ ] 工作日模型 (Mon-Fri non-holiday)
- [ ] 週末模型 (Sat-Sun)
- [ ] 假期模型 (Public holidays)
- [ ] 極端天氣模型
- [ ] 流感季模型
```

---

## 階段 3: 目標變量轉換 (預期 MAE: 12.0 → 11.0)

### 3.1 多任務學習
```python
# 當前: 只預測單一數值
# 優化: 同時預測多個目標

- [ ] 同時預測均值 + 方差 (給出預測區間)
- [ ] 分位數回歸 (預測 10th, 50th, 90th 分位)
- [ ] 概率預測 (輸出分佈)
```

### 3.2 殘差建模
```python
# 當前: 直接預測 Attendance
# 優化: 先預測基準，再建模殘差

- [ ] Step 1: 用 EWMA 預測基準
- [ ] Step 2: 建模殘差 (actual - baseline)
- [ ] Step 3: 組合預測
```

### 3.3 增量建模
```python
- [ ] 預測日變化量而非絕對值
- [ ] 預測週變化量
- [ ] 與基準值組合
```

---

## 階段 4: 時間序列專用技術 (預期 MAE: 11.0 → 10.0)

### 4.1 時間序列交叉驗證優化
```python
# 當前: 3-fold TimeSeriesSplit
# 優化: 更嚴謹的驗證

- [ ] Rolling Window CV (滾動窗口)
- [ ] Expanded Window CV (擴展窗口)
- [ ] Purged K-Fold (消除前瞻偏差)
- [ ] 留一法驗證 (Leave-One-Year-Out)
```

### 4.2 趨勢分解
```python
- [ ] STL 分解 (Seasonal-Trend-Loess)
- [ ] 分別預測趨勢、季節性、殘差
- [ ] 組合三部分預測
```

### 4.3 動態選擇策略
```python
- [ ] 根據近期動態自動選擇模型
- [ ] 異常期間自動切換到異常模型
- [ ] A/B 測試新模型 vs 舊模型
```

---

## 階段 5: 後處理優化 (預期 MAE: 10.0 → 9.0)

### 5.1 智能校正
```python
- [ ] 歷史偏差校正 (按月份/星期調整)
- [ ] 實時誤差追蹤與校正
- [ ] 系統性誤差修正
```

### 5.2 邏輯約束
```python
- [ ] 預測值合理性檢查 (min/max 約束)
- [ ] 連續性檢查 (今天 vs 昨天的變化合理性)
- [ ] 趨勢一致性檢查
```

### 5.3 模型不確定性
```python
- [ ] 輸出預測區間 (80%, 95% CI)
- [ ] 置信度評分
- [ ] 低置信度時觸發人工審核
```

---

## 執行優先級

### P0 (立即執行，預期改善最大)
1. **高級滾動統計** (+1.5 MAE 改善)
2. **Stacking Ensemble** (+1.0 MAE 改善)
3. **分層建模 (工作日/週末)** (+0.8 MAE 改善)

### P1 (本週完成)
4. 滾動趨勢特徵
5. AQHI 整合
6. 殘差建模

### P2 (本月完成)
7. 超參數深度優化
8. CatBoost 引入
9. STL 分解

### P3 (持續優化)
10. 異常值處理
11. 時間序列 CV 優化
12. 智能校正

---

## 成功指標

| 階段 | 目標 MAE | 目標 R² | 預期時間 |
|------|----------|---------|----------|
| 基準 | 15.77 | 0.41 | - |
| P0 完成 | 12.5 | 0.55 | 3 天 |
| P1 完成 | 11.0 | 0.62 | 1 週 |
| P2 完成 | 10.0 | 0.68 | 2 週 |
| P3 完成 | < 9.0 | > 0.75 | 1 月 |

---

## 實施步驟

### Step 1: 創建增強版特徵工程
```bash
python -c "
from feature_engineering_v2 import create_enhanced_features
# 添加 50+ 新特徵
"
```

### Step 2: 實現 Stacking Ensemble
```bash
python train_stacking_ensemble.py
```

### Step 3: 評估與部署
```bash
python evaluate_all_models.py
git add .
git commit -m 'Optimize: MAE 15.77 -> 12.5'
git push
```

---

## 參考文獻

1. "Machine Learning for Time Series Forecasting" - 2024
2. "Advanced Ensemble Methods for Healthcare Demand" - BMC Medical Informatics
3. "Feature Engineering for Time Series Prediction" - Kaggle Course
4. "Deep Learning for Time Series" (Oreilly) - 2024
