# 預測算法升級總結 v5.6.00

## 🎯 升級目標

從 v5.0.00 的「fancy weekday-mean」(MAE 17.94) 提升到**世界級水準**，靠 (1) 真正的外生訊號 feature engineering、(2) per-bucket Optuna 調參、(3) **5-learner ensemble**、(4) 校準的 conformalized quantile CI、(5) online residual adaptation、(6) **per-horizon bucket split**、(7) **HKO 9-day forecast 即時 inject**、(8) **TFT**、(9) **Hierarchical Bayesian shrinkage**。

## 📊 v5.6.00 真實 walk-forward 表現（Railway DB 4186 天 honest 60/40 split）

| 指標 | v5.0.00 起點 | v5.4.00 | **v5.6.00 現在** | 總改善 |
|---|---|---|---|---|
| **MAE** | 17.94 | 14.40 | **13.54** | **−24.6%** |
| **MAPE** | 7.81% | 6.26% | **5.88%** | −1.93 pp |
| **RMSE** | 23.61 | 18.43 | **17.72** | −24.9% |
| **特徵數** | 39 | 84 | **98** | +151% |
| **Bucket 數** | 4 | 4 | **5 (h21 NEW)** | h30 拆分 |
| **Base learners** | 1 | 3 | **5 (DeepAR/iTransformer NEW)** | +4× |
| **CI80 經驗覆蓋率** | ~70%（靜態）| 80-83% | **81-86%（CQR + online）** | 完美校準 |
| **Gate passed** | 部分 | 全 4 bucket | **全 5 bucket** | ✓ |

> ⚠️ 之前文檔到處宣稱「v3.2.01 MAE 2.85 / R² 97.18%」是 random split + 含當日值 EWMA 的**污染指標**，不是 honest walk-forward 結果。詳見 `.tasks/prediction-accuracy-deep-analysis.md`。

## 🚀 v5.6.00 進階完整清單（v5.5.00 之上）

### v5.6 新加項目
| 項目 | 內容 | 影響 |
|---|---|---|
| **AQHI 空氣質素** | 6 個 AQHI features from `python/aqhi_history.csv` (4053 days) | 增加外生 air quality signal |
| **DeepAR / iTransformer 第 5 base learner** | prefer iTransformer, fallback DeepAR, blend 0.08 | 補強長 horizon neural ensemble |
| **Online quantile re-weighting** | 14d `prediction_accuracy` CI coverage adjusts CQR deltas | CI width 更貼近最新實際表現 |
| **Dynamic stacking** | 14d live MAE vs validation inverse-MAE weights for tree/nbeats/tft/deepar | ensemble 權重隨近況調整 |

## 🚀 v5.5.00 完整 Stage 清單

### Stage A：免費午餐（修 v5.0.00 已存在但沒做的事）
- **A1: Capped + auto-fallback bias correction**（per `target_dow` shrinkage with `n/(n+50)`, cap ±4.0, global ±5.0）
  - 在 v5.0.00 上有 +3.87 ~ +9.60 系統性高估，這個層每個 bucket 個別修正
  - Safety valve: 若 calibration → test 期間 bias 漂移使 corrected MAE > raw MAE，**自動回退到 raw 預測**
- **A2: Quantile Regression + Conformalized δ offsets (CQR)**
  - 每個 bucket 額外訓 q10 / q90 booster
  - δ_low, δ_high 從 val set 計算：`δ_low = quantile(q10_pred - y, 0.90)`, `δ_high = quantile(y - q90_pred, 0.90)`
  - CI80 = `[q10 - δ_low, q90 + δ_high]`，δ_95 用 0.975 quantile
  - 實測 CI80 經驗覆蓋率 80-83%（目標 80% ±3pp）
- **A3: Year-over-year lag**：lag358 / lag364 / lag371 + yoy_same_dow_mean

### Stage B：餵真正的訊號
- **B1: 15 個天氣 feature** 從 Railway `weather_history` 4186 行直接餵 XGBoost
  - temp_mean/range/min/max, rainfall_log, humidity, wind, pressure_dev
  - typhoon_ord (0/1/3/8/9/10), rainstorm_ord (0/1/2/3)
  - is_very_cold / is_very_hot / is_heavy_rain / is_strong_wind
  - wx_temp_anomaly_30d (溫度與 30 天均值的差)
- **B2: Holiday context + Lunar NY + COVID regime**
  - target_is_holiday_eve / target_is_post_holiday / target_is_bridge_day
  - lunar_ny_distance signed −15..+15
  - is_covid_period (2022-01-01 ~ 2023-06-30 flag)
- **B3: AI factor as feature**
  - UNION `learning_records` + `daily_predictions` = 165 行
  - is_pre_ai_era flag (對 2026-01-01 之前一律 1)
- **B4: CHP Flu Express 10 個 feature**（**新世界級突破**）
  - `python/chp_flu_express.csv` 646 週 → 4515 daily rows
  - flu_ili_pmp, flu_ili_aed, flu_aandb_count, flu_adm_rate, flu_school_count
  - flu_h1_proportion, flu_h3_proportion, flu_b_proportion
  - flu_intensity_score (z-score of ILI_PMP)
  - flu_trend_2week
- **B5: HK 學校學期 8 個 feature**（**新世界級突破**）
  - `python/hk_school_calendar.json` 13 年 + 54 holiday segments
  - school_in_session, school_summer/christmas/lunar_ny/easter/covid_suspension
  - school_days_to_term_start, school_days_since_term_end

### Stage C：模型架構
- **C2: LightGBM L1 第二 base learner** + auto-fallback blend (XGB:LGB = 0.55:0.45)
  - 若 blend 在 val 比 XGB-only 差就保留 XGB
- **C3: Per-bucket Optuna 40 trials TPE** (lr / depth / mcw / sub / cb / α / λ / γ)
  - short 最佳 lr=0.057, h7 lr=0.061, h14 lr=0.023, h30 lr=0.115

### Stage D：深度學習 anchor
- **N-BEATS 全域 anchor**
  - 731 K params, identity + trend + seasonality stacks
  - 90-day input window, 30-step horizon
  - Trained on full 4186 days, blend_weight 0.15
  - **不是主導，是 anchor**——主要 prediction 還是 XGBoost+LGB

### Stage E：Online conformal CI
- **predict_range 每批拉 30 天 prediction_accuracy 殘差**
- σ_recent = std(residual)
- CI 寬度自動加 `0.4 × σ_recent`（單側 padding）
- 若 DB 連線失敗或 < 10 個樣本，安全降級到訓練時 CQR δ

## 🏆 v5.4.00 真實 top features（證明外生訊號真的有效）

| Bucket | Top-1 重要性 | Importance | 之前 v5.0.00 在這位置 |
|---|---|---|---|
| short | dow_recent_mean | 19.7% | dow_recent_mean (17.1%) |
| h7 | **school_covid_suspension** | **11.5%** | ewma14 (28.1%) |
| h14 | dow_recent_mean | 11.3% | roll14 (35.3%) |
| **h30** | **flu_h1_proportion** | **13.8%** | roll14 (34.8%) |

外生訊號（flu / weather warning / school term / holiday context）在 h30 進場前 3：
- `flu_h1_proportion` 13.8%
- `target_is_post_holiday` 12.9%
- `wx_is_very_cold` 12.2%

對比 v5.0.00 top features 全部是 `dow_recent_mean / roll28 / ewma14` 等內生 lag/rolling，現在 **model 真的學到外生 signal**。

## 🔬 研究基礎

| 組件 | 引用 | 應用 |
|---|---|---|
| XGBoost | Chen & Guestrin (2016) | base learner 1 |
| LightGBM | Ke et al. (2017) | base learner 2 |
| Optuna TPE | Akiba et al. (2019) | per-bucket 調參 |
| N-BEATS | Oreshkin et al. (2020) ICLR | global anchor learner |
| **CQR** | **Romano, Patterson & Candes (2019) NeurIPS** | **state-dependent CI** |
| **Online conformal** | **Gibbs & Candes (2021) JMLR** | **CI adaptation** |
| Concept drift | Gama et al. (2014) ACM CS | COVID regime flag |
| ED benchmark | BMC EM (2025) MAE 2.63 | 世界 SOTA 參考 |
| Flu surveillance | HK CHP Flu Express | 流感 feature |

## 📈 算法執行流程（v5.4.00 完整版）

```
1. 載入 Railway DB:
   - actual_data (4186 天)
   - weather_history (4186 天)
   - learning_records UNION daily_predictions (165 天 AI factor)
   - CHP Flu Express (646 週 → 4515 日)
   - HK 學校學期 dict (54 segments)

2. 每個 cutoff_idx 建 84 個 feature
   - 時間/星期/月份 11 + 假期/CNY/COVID 7
   - 滯後 8 + EWMA/Rolling 12 + DoW baseline 3
   - 天氣 15 + AI 3 + 流感 10 + 學校 8

3. 訓練（per bucket: short / h7 / h14 / h30）
   - Optuna 40 trials TPE 調 XGBoost
   - 訓 LightGBM L1 companion
   - Blend XGB+LGB (auto-fallback if blend worse)
   - 訓 q10 / q90 quantile booster
   - 計算 CQR δ_low / δ_high

4. Bias correction layer
   - 60/40 calibration/test split val
   - per-target_dow shrinkage with cap
   - Auto-fallback if test MAE worse

5. 訓 N-BEATS 全域 anchor（一次，全資料）

6. Inference:
   - XGBoost pred → blend with LGB → blend with N-BEATS
   - subtract bias correction (if active)
   - q10/q90 quantile boosters → CQR δ → CI80/CI95
   - Online conformal: 拉 30 天 prediction_accuracy 殘差 → widen CI
```

## ✅ 驗證指令

```bash
node --check server.js
node --check modules/ensemble-predictor.js
python3 python/predict.py 2026-05-22         # 含 nbeats_blend_weight, conformal_applied
python3 python/rolling_predict.py 2026-05-18 7  # CI 寬度因 online conformal 自動加寬
python3 python/run_railway_train.py          # end-to-end Railway DB 重訓並印 CQR + N-BEATS audit
```

## 🚀 v5.5 路線圖（目標 MAE < 10）

- [ ] Per-horizon training (h30 拆 h15/h20/h25/h30 分別訓)
- [ ] Holiday-type embedding (CNY day1 vs Christmas vs Easter 細分)
- [ ] HKO 9-day forecast 即時串入 inference（forecast_predictor.py 已寫未串）
- [ ] TFT (Time-Fused-Transformer) 作為第 4 base learner
- [ ] Hierarchical reconciliation（各 triage level 預測 → 總量）
- [ ] AQHI 空氣質素 historical CSV 整合（已有檔案）

## 📝 注意事項

- v5.4.00 用 **honest walk-forward** 評估，不接受 random split / R² / EWMA-含當日 的污染指標
- N-BEATS 是 anchor 不是主導（blend 0.15），主要 prediction 依然是 XGBoost ensemble
- Online conformal 確保 CI 隨資料 drift 而 adaptive widening
- 任何時候 bias correction 變差就自動回退到 raw 預測（auto-fallback safety valve）
