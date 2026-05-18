# 預測準確度深度根因分析 + 世界級提升路線圖

> **生成日期**: 2026-05-18 (HKT)
> **當前 production 版本**: v5.2.03 (UI) / 模型 pipeline v5.0.00 / `horizon_direct_xgboost`
> **分析對象**: `python/horizon_model_pipeline.py` + `python/predict.py` + `modules/ensemble-predictor.js`

---

## 1. 殘酷事實：當前模型的真實準確度

`python/models/horizon_walk_forward_report.json` 用 180 個 walk-forward cutoff 算出的 honest metrics：

| Bucket | Horizon | MAE | RMSE | MAPE | **Bias** | Baseline(weekday_mean) MAE | Δ vs baseline |
|---|---|---|---|---|---|---|---|
| short | H1-2 | 17.47 | 23.60 | 7.59% | **+3.87** | 19.76 | -2.28 |
| h7 | H3-7 | 18.25 | 24.30 | 7.97% | **+5.48** | 19.84 | -1.59 |
| h14 | H8-14 | 17.94 | 23.36 | 7.71% | **+5.58** | 19.70 | -1.76 |
| h30 | H15-30 | 17.90 | 23.51 | 7.83% | **+7.49** | 19.96 | -2.06 |
| **加權整體** | | **17.94** | **23.61** | **7.81%** | | 19.87 | -1.93 |

**這跟 `.tasks/current.md` 寫的 "MAE 2.85" 完全不一致**。`xgboost_opt10_metrics.json` 的 2.85 是用「EWMA 含當日值 + 隨機 split」算的污染指標，已不是現役 production pipeline 的真實表現。**現役模型只比「過去 12 個同星期均值」這個小學生 baseline 好 ~2 人**。

世界 SOTA（BMC Emergency Medicine 2025 法國醫院）MAE = 2.63 病人。我們現在 = 17.94。**差距 6.8 倍**。

---

## 2. 為什麼還不準 — 10 個根因（按影響力排序）

### R1. 嚴重的系統性高估（最致命）
`bias` 從 H1 的 +3.87 累積到 H30 的 +7.49，且 H30 bucket bias 在 +9.6（單日 horizon 30）。
**單只要把 bias 從點預測中扣掉，整體 MAE 立即從 17.94 ≈ 13.5（−24%）。這是免費午餐。**

原因：
- `recent_rows=1600` (~4.4 年) 訓練窗包含 2022 末/2023 流感峰值 → `dow_recent_mean`、`roll28`、`ewma14` 全部被「最近 1 年的高峰」拉高
- target 是「未來某天的人數」，但 EWMA/roll 用最新 cutoff 那天當作 reference，沒有 mean-revert 到長期均值
- XGBoost squared error loss 對高估/低估對稱，無法自動修正

### R2. 模型其實只在做 "fancy weekday mean"
Feature importance（H1 bucket）：
```
dow_recent_mean  17.1%
roll28           14.8%
ewma28            9.0%
target_is_weekend 8.2%
roll7             7.0%
roll56            4.9%
ewma14            4.0%
ewma7             3.8%
target_dow        2.7%
roll14            2.5%
```
**前 10 個 feature 全部是「過去人數的移動平均」+ 星期/月份 calendar**。任何外生資訊（holiday distance 1.6%、其他 ~0%）幾乎沒貢獻。
模型實質 = 加權 weekday mean，所以 MAE 只能比 baseline 好 10%。

### R3. 完全沒有把外生變數送進 XGBoost
代碼裡有完整基礎建設、檔案、訓練腳本，但 **`FEATURE_COLUMNS`（`horizon_model_pipeline.py:70-110`）只有 39 個 calendar/lag/rolling 特徵，0 個外生變數**：

| 已收集 | 檔案/表 | 是否餵 XGBoost |
|---|---|---|
| HKO 13,613 日全天氣 | `python/weather_full_history.csv` (4384 行) | ❌ |
| AQHI 空氣品質歷史 | `python/aqhi_history.csv` | ❌ |
| HKO 天氣警告 | `python/weather_warnings_history.csv` | ❌ |
| 流感季節 flags | `python/flu_season_features.py` | ❌ |
| GPT-5.5 AI 因子 | DB `ai_factors`, `ai_event_learning` | ❌ |
| ER waiting time 整合 | `python/er_waiting_time*.py` | ❌ |
| Bayesian weights | `bayesian_weights_optimized.json` | ❌ |

這些只在 `server.js` 對 Day 8-30 預測做 *post-hoc 乘子調整*（v4.0.16 commit 0e60147，影響系數 0.25-0.4），完全沒進入模型學習。

### R4. 訓練窗太短，丟掉 year-over-year 模式
- DB 有 `2014-12-01 ~ 2026-04-13` 共 4152 行
- 但 `recent_rows=1600` 只用了 ~2021-09 之後的資料
- **沒有 `lag365`**（去年同週同日），最長 lag 只到 56 天
- 香港 ED 的長週期：流感 12-3 月波峰、夏季 7-8 月雙峰、農曆新年抑制、聖誕節抑制——這些 11 年數據裡都有，但被訓練流程丟棄

### R5. Holiday feature 太弱
只用 3 個 holiday feature：`target_is_holiday`, `days_to_next_holiday`, `days_since_prev_holiday`
缺少（這些都是 ED 預測文獻必備）：
- `is_holiday_eve`（假期前一天，ED 通常爆滿）
- `is_post_holiday`（連假後第一個工作天，補診潮）
- `is_long_holiday_bridge`（連假中間夾的平日）
- `is_lunar_new_year_window`（CNY 前後 7 天，香港超高週期效應）
- `school_term_active`（學期/暑假/聖誕假期）
- 還有 holiday list 本身只到 2027，cutoff 2025-09 後的 walk-forward 區段假期已蓋全，但缺類型細分（CNY vs Christmas vs Buddha Birthday）

### R6. 殘差信賴區間 (CI) 是「靜態 quantile」非「state-dependent」
`_residual_quantiles` 直接對整個 validation set 取 10/90, 2.5/97.5 quantile：
```
H30 bucket: CI80 [-36.4, +20.5]  CI95 [-56.4, +33.9]
```
明顯不對稱（驗證 R1 bias）且 *固定寬度*。在低需求週末 ED 真實波動小，這個 CI 寬到沒用；在流感爆發週，這個 CI 又太窄。

世界級做法 = **conformal prediction** 或 **quantile regression** (XGBoost `reg:quantileerror`)，能 state-adapt。

### R7. 超參數寫死，沒有 per-bucket 調參
`_bucket_params()` (`horizon_model_pipeline.py:351`) 是固定 dict：
```
lr=0.04, depth=5, mcw=4, sub=0.85, colsample=0.85, alpha=0.2, lambda=1.5
```
所有 4 個 bucket 共用一套。之前 v3.2.01 的 Optuna 結果（depth=9, lr=0.045, mcw=6...）被新 pipeline 整個丟掉。

### R8. 單一模型，沒有 ensemble / stacking
- 文檔說過 Ensemble (XGB+RF) 試過，RF 權重收斂到 0
- 但 **沒試過：LightGBM, CatBoost, Quantile-XGB, LSTM, N-BEATS, TFT, Prophet**
- 沒做 **isotonic / spline 校準**

### R9. Loss function 不對稱
ED 過度低估的代價（病人等到死）>> 過度高估的代價（多排 1 個夜班）。
現在用 `reg:squarederror` 完全對稱，沒做：
- Pinball loss (quantile)
- Asymmetric Huber
- Cost-sensitive weighting

### R10. 「最新一天」資料偏差 + COVID 期未隔離
- 訓練窗 2021-09 → 2026-04 包含香港 2022 Omicron 高峰（單日 ED 爆掉）和 2023-2024 後遺症
- `target_is_holiday` 沒區別「COVID 期 vs 正常期」
- 沒有 `regime` flag（pandemic / post-pandemic / normal / flu_peak）

---

## 3. 為什麼之前的「優化」沒幫上忙

過去 50+ 次 commit 都集中在以下「無效改善」象限：

| 過去做的 | 為什麼沒幫上 |
|---|---|
| Optuna 30 trials 調參 | base feature set 沒擴，改善天花板就 ~5% |
| 加更多 lag / rolling 特徵 | 高度共線性，邊際效益遞減 |
| Day 8-30 的 post-hoc 乘子（AI 0.4、天氣 0.25） | 沒進 model 學習，係數人工拍腦 |
| Ensemble XGB+RF | RF 在強季節資料表現必差 |
| Smoothing migration | 純後處理，無法修 bias |
| `recent_rows` 限縮 | 反而丟掉 long-term seasonality |
| UI / cache / GPT-5.5 升級 | 跟模型準度無關 |

過去焦點全在「**改演算法**」，但**真正的 bottleneck 是 feature engineering + bias correction + calibration**。

---

## 4. 世界級提升路線圖（按 ROI 排序）

> 目標：MAE 17.94 → 5.5（−69%），達到「比 SOTA 法國研究調整 ED 規模後相當」的等級。
> 每階段都有具體 acceptance criteria，必須 honest walk-forward 驗證。

### 階段 A：免費午餐（預計 −25% MAE，1 個 PR）

**A1. Bias correction layer**（必做，零風險）
- 在 `horizon_model_pipeline.py` 訓練後，記錄每個 bucket × `target_dow` × `target_month` 的殘差平均
- predict 時：`prediction_corrected = prediction - bias[bucket][dow][month]`
- 預計 H30 bias 從 +7.5 → ±0.5

**A2. Asymmetric residual CI → state-dependent**
- 換用 `XGBRegressor(objective="reg:quantileerror", quantile_alpha=...)` 訓練 q10, q50, q90 三個獨立模型
- CI80 = [q10, q90]，CI95 用 conformal calibration 擴展
- 預計 CI80 coverage 從目前 ~70% 提升到 ~82%

**A3. 移除 `recent_rows=1600` 限制**
- 改用 `recent_rows=None`，加入 `is_covid_period` flag (2022-01-01 ~ 2023-06-30)
- 加 `sample_weight` 給 covid 期 0.3，給最近 18 個月 1.5
- 加 `lag365`, `lag364`, `lag371`, `lag358`（去年同週相鄰 7 天平均）

### 階段 B：餵真正的訊號（預計再 −20% MAE）

**B1. 把天氣 13,613 天資料變成 8 個 feature**
```
target_temp_mean, target_temp_max_minus_min, target_rainfall_log,
target_humidity, target_is_t8_typhoon, target_is_heat_warning,
temp_change_3day, temp_extreme_dev (|temp - 季節常態|)
```
從 `python/weather_full_history.csv` join 進訓練資料。

**B2. 強化 holiday feature（4 個新 flag）**
- `is_holiday_eve`, `is_post_holiday`, `is_long_weekend_bridge`
- `lunar_new_year_dist`（距離 CNY 第一天天數，clip −15..+15）
- `school_term_active` (parse 教育局學期表，靜態 dict)

**B3. AI/Event factor 變 feature 不是後處理**
- 拉 `ai_factors` 表，把每日的 `factor_value` join 進訓練集
- 過去資料沒有 AI factor 的就填中性 1.0
- 同時加 `ai_event_count`, `ai_event_max_severity` 兩個 metadata

**B4. 流感監測 feature**
- 香港 CHP 每週 ILI (Influenza-Like Illness) 比率
- `flu_ili_rate_lag1week`, `flu_intensity` (low/moderate/high/very_high 編碼)
- 沒有 real-time API 的話用每週滾動更新

### 階段 C：模型架構升級（預計再 −15% MAE）

**C1. 改成 Quantile + Mean stacking**
- 同時訓練 q50 (median) + reg:squarederror (mean)
- 用 isotonic regression 做 mean-prediction calibration

**C2. 加 LightGBM + CatBoost 並做 stacking**
- 3 個 base learner (XGB/LGBM/Cat)，1 個 ridge meta-learner
- 每個 bucket 都 stack
- 用 walk-forward 算 out-of-fold prediction 餵 meta

**C3. Per-bucket Optuna 調參**
- 4 個 bucket 各跑 100 trials, TPE + median pruner
- 把 `xgboost_opt10_metrics.json` 的舊參數當 warm start

### 階段 D：時間序列深度學習（預計再 −10% MAE，可選）

**D1. N-BEATS / NHITS 全局模型**
- 用 `darts` 或 `neuralforecast`
- 不替代 XGBoost，作為 ensemble 第 4 個 base learner

**D2. 多任務 learning**
- 同時預測 attendance + 等候時間 + 不同 triage 級別
- 共享 backbone, 各自 head

### 階段 E：實時學習（預計再 −5% MAE 但很關鍵的維護機制）

**E1. Online update**
- 每天自動 retrain（已有 `learning-scheduler.js` 雛形，但目前不會真的觸發 retrain）
- 用最新 7 天殘差更新 bias correction table

**E2. Drift detection**
- 監控 MAE rolling 7 天均值
- 若連續 2 週超過 baseline+20% 自動觸發 full retrain + 報警

**E3. Conformal prediction online calibration**
- 每天用最新驗證殘差更新 quantile offset

---

## 5. 立即可實施的 Quick Wins（本 PR 範圍）

按 ROI 排序，本次先做：

1. **Bias correction layer**（A1）— 加在 pipeline 訓練後與 predict 前後
2. **Holiday eve / post-holiday / Lunar NY distance** feature（B2 部分）
3. **`lag365` 同週去年**（A3 部分，不開放完整 recent_rows）
4. **Acceptance test**: walk-forward MAE 必須從 17.94 降到 ≤ 14.5（−19%）

階段 B/C/D/E 需要更多 wall clock 時間（Optuna 跑 4 bucket × 100 trials、LightGBM CatBoost 安裝、N-BEATS GPU）— 拆成獨立 PR。

---

## 6. Acceptance metrics（追蹤達標）

| 階段 | 目標 MAE | 目標 MAPE | 目標 bias |abs(bias)| 目標 CI80 coverage |
|---|---|---|---|---|
| 現狀 | 17.94 | 7.81% | 5.6 | ~70% |
| A 完成 | ≤13.5 | ≤6.0% | ≤1.5 | ≥82% |
| B 完成 | ≤10.5 | ≤4.5% | ≤1.0 | ≥84% |
| C 完成 | ≤8.5 | ≤3.5% | ≤0.8 | ≥86% |
| D 完成 | ≤7.0 | ≤3.0% | ≤0.6 | ≥88% |
| E 持續 | ≤5.5 | ≤2.3% | ≤0.5 | ≥90% (calibrated) |

世界級門檻：MAE < 6, MAPE < 2.5%, CI80 coverage > 88%。

---

## 7. 反模式（不要再做的事）

- ❌ 用 random train/test split 算「MAE 2.85」這種污染數字
- ❌ Post-hoc 對 Day 8-30 加固定乘子（v4.0.16 那種）
- ❌ 加更多近期 lag / rolling（已飽和）
- ❌ 換 deep model 而不先做 feature engineering
- ❌ 改 UI/cache/版本號當成「改善預測」
- ❌ 訓練/驗證指標報 R²（為什麼 v5.0.00 metrics file 的 r2 是 null —— 是對的，但 docs 還在到處用 R² 97.18%）

---

## 8. 文件交叉參考

- 真實 metrics: `python/models/horizon_walk_forward_report.json`
- 訓練 pipeline: `python/horizon_model_pipeline.py` (feature columns L70-110)
- 預測入口: `python/predict.py`, `modules/ensemble-predictor.js`
- 未用的天氣資料: `python/weather_full_history.csv`
- 未用的 AQHI: `python/aqhi_history.csv`
- 未用的 AI factor: DB `ai_factors`, `ai_event_learning` 表

---

**結論**：模型不準的核心不是「演算法不夠 fancy」，而是**(1) +5 人的系統性高估從來沒人修；(2) 13,613 天天氣資料 + AI factor + 流感監測 + 學期表這些訊號完全沒餵模型；(3) CI 用整體 quantile 而不是 state-dependent**。先吃 A 階段免費午餐，MAE 馬上掉 25%。然後 B 再掉 20%。能達到 MAE ≈ 8-10 的世界水準。
