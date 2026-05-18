# XGBoost + LightGBM + N-BEATS + TFT 完整特徵列表 (v5.5.00)

**生成於**: 2026-05-18 HKT
**特徵數量**: **92 個**（v5.0.00 39 → v5.4.00 84 → v5.5.00 92）
**模型版本**: 5.5.00 (`horizon_direct_xgboost` + 4-learner ensemble)
**Bucket 數量**: **5**（short / h7 / h14 / **h21 NEW** / h30 shrunk to H22-30）
**訓練資料**: 4186 天 Railway DB（2014-12-01 到 2026-05-17）

## 📊 真實 walk-forward 模型性能（honest 60/40 split, 180 cutoffs）

| 指標 | v5.0.00 起點 | v5.4.00 | **v5.5.00 現在** | 總改善 |
|------|------|------|------|------|
| MAE  | 17.94 | 14.40 | **13.84** | **−22.9%** |
| MAPE | 7.81% | 6.26% | **6.04%** | −1.77 pp |
| RMSE | 23.61 | 18.43 | **17.83** | −24.5% |
| CI80 經驗覆蓋率 | ~70%（靜態）| 80-83% | **81-83%（CQR + online）** | 校準完美 |
| Gate passed | 部分 | 全 4 bucket | **全 5 bucket** | ✓ |

## 🎯 92 個 feature 分類

### 1. 時間/星期/月份 (11 個)
- `horizon`, `origin_dow`, `origin_month`
- `target_dow`, `target_month`, `target_dom`, `target_is_weekend`
- `target_dow_sin`, `target_dow_cos`, `target_month_sin`, `target_month_cos`

### 2. 假期 / Lunar NY / COVID regime (7 個)
- `target_is_holiday`, `target_is_holiday_eve`, `target_is_post_holiday`, `target_is_bridge_day`
- `lunar_ny_distance`（signed −15..+15）
- `days_to_next_holiday`, `days_since_prev_holiday`
- `is_covid_period`（2022-01-01 ~ 2023-06-30 flag）

### 3. 滯後特徵 (8 個)
- 近期: `last_value`, `lag2`, `lag7`, `lag14`, `lag28`, `lag56`
- **去年同週**: `lag358`, `lag364`, `lag371`, `yoy_same_dow_mean`（Stage A3 新加）

### 4. EWMA / Rolling / 趨勢 (12 個)
- `ewma7`, `ewma14`, `ewma28`
- `roll7`, `roll14`, `roll28`, `roll56`, `recent_mean_84`
- `std7`, `std14`, `std28`
- `trend_7_28`, `trend_14_56`, `delta_1_7`, `delta_7_14`

### 5. Same-DoW 基準 (3 個)
- `dow_recent_mean`, `seasonal_baseline`, `seasonal_gap`, `dow_gap`

### 6. 天氣 (15 個，Stage B1 加，全部從 `weather_history` 4186 行)
- 溫度: `wx_temp_mean`, `wx_temp_range`, `wx_temp_min`, `wx_temp_max`, `wx_temp_anomaly_30d`
- 降雨/濕度/風/氣壓: `wx_rainfall_log`, `wx_humidity`, `wx_wind`, `wx_pressure_dev`
- HKO 警告 ordinal: `wx_typhoon_signal_ord`（0/1/3/8/9/10）, `wx_rainstorm_signal_ord`（0/1/2/3）
- 極端條件 binary: `wx_is_very_cold`, `wx_is_very_hot`, `wx_is_heavy_rain`, `wx_is_strong_wind`

### 7. AI factor (3 個，Stage B3)
- `ai_factor`, `ai_factor_known`, `is_pre_ai_era`
- UNION 自 `learning_records` + `daily_predictions` 165 行

### 8. **CHP 流感監測 (10 個，Stage B4 新加)**
- 主指標: `flu_ili_pmp`（per million population）, `flu_ili_aed`（A&E ILI rate）
- 病毒分株: `flu_h1_proportion`, `flu_h3_proportion`, `flu_b_proportion`
- 嚴重程度: `flu_aandb_count`, `flu_adm_rate`, `flu_school_count`
- 衍生: `flu_intensity_score`（z-score）, `flu_trend_2week`
- 資料源: data.gov.hk Flu Express 646 週 → 4515 daily rows

### 9. **學校學期 (8 個，Stage B5 新加)**
- `school_in_session`
- `school_summer_holiday`, `school_christmas_holiday`, `school_lunar_ny_holiday`, `school_easter_holiday`
- `school_covid_suspension`（2020-02 ~ 2020-05, 2022-03 ~ 2022-04）
- `school_days_to_term_start`, `school_days_since_term_end`
- 資料源: EDB 學年表 13 年 × 54 holiday segment dict

### 10. **Holiday-type embedding (8 個，v5.5.00 新加)**
- `holiday_type_cny`（距 CNY day-1 ≤4 天）
- `holiday_type_christmas`（12/25-26）
- `holiday_type_easter`（3/19~4/27）
- `holiday_type_buddha`（5/5-20）
- `holiday_type_dragon_boat`（5/25~6/25）
- `holiday_type_mid_autumn`（9/7~10/10）
- `holiday_type_national`（10/1）
- `holiday_type_other`（其他公眾假期）
- 推斷自 calendar position + lunar NY ordinal

## 🏆 每個 bucket 的 top features（v5.5.00 真實實測）

### Short (H1-2)
1. dow_recent_mean (22.8%)
2. roll7 (7.4%)
3. ewma14 (6.4%)
4. **target_is_post_holiday** (6.2%) — 外生 ✓
5. **flu_h1_proportion** (5.1%) — 外生 ✓
6. roll28 (4.3%)
7. ewma7 (2.3%)
8. **wx_typhoon_signal_ord** (2.0%) — 外生 ✓
9. **wx_is_heavy_rain** (2.0%) — 外生 ✓
10. **is_covid_period** (1.9%) — 外生 ✓

### H7 (H3-H7)
1. dow_recent_mean (15.2%)
2. **school_covid_suspension** (8.6%) — 外生 ✓
3. **target_is_post_holiday** (7.3%) — 外生 ✓
4. **flu_h1_proportion** (6.7%) — 外生 ✓
5. roll28 (6.5%)
6. **wx_typhoon_signal_ord** (4.6%) — 外生 ✓
7. ewma14 (3.3%)
8. roll56 (2.7%)
9. roll7 (2.4%)
10. ewma28 (2.0%)

### H14 (H8-H14)
1. **flu_h1_proportion** (13.2%) ⭐ — 外生 ✓
2. dow_recent_mean (10.5%)
3. **target_is_post_holiday** (9.7%) — 外生 ✓
4. roll56 (4.7%)
5. **wx_is_heavy_rain** (3.6%) — 外生 ✓
6. roll14 (3.2%)
7. roll28 (2.9%)
8. **wx_typhoon_signal_ord** (2.8%) — 外生 ✓
9. target_is_weekend (2.2%)
10. **flu_aandb_count** (1.9%) — 外生 ✓

### H21 (H15-H21) **— NEW v5.5 bucket**
1. dow_recent_mean (16.9%)
2. **flu_h1_proportion** (16.5%) — 外生 ✓
3. **target_is_post_holiday** (5.6%) — 外生 ✓
4. ewma28 (4.3%)
5. **flu_adm_rate** (3.6%) — 外生 ✓
6. **flu_ili_pmp** (3.4%) — 外生 ✓
7. **flu_intensity_score** (3.0%) — 外生 ✓
8. seasonal_baseline (2.8%)
9. roll14 (2.6%)
10. **flu_aandb_count** (2.3%) — 外生 ✓

**外生 flu 訊號佔 top-10 半數**，這個 bucket 真的在學「未來 2-3 週的流感波會推高 ED」。

### H30 (H22-H30)
1. **flu_h1_proportion** (20.4%) ⭐⭐ **絕對 top-1** — 外生 ✓
2. **target_is_post_holiday** (9.9%) — 外生 ✓
3. dow_recent_mean (6.2%)
4. target_is_weekend (4.8%)
5. roll28 (4.5%)
6. **flu_intensity_score** (4.2%) — 外生 ✓
7. **is_covid_period** (3.3%) — 外生 ✓
8. **flu_adm_rate** (2.5%) — 外生 ✓
9. **flu_aandb_count** (2.0%) — 外生 ✓
10. target_dow_sin (1.7%)

**外生訊號（流感 + 假期 + COVID regime）在 h30 佔 top-10 中 6 名**，內生 lag/rolling 只佔 4 名。v5.0.00 完全沒有的事。

## 🔧 模型架構

- **XGBoost** (per-bucket Optuna 30-40 trials 調參) — base learner 1
- **LightGBM** L1 objective — base learner 2（auto-fallback）
- **N-BEATS** (731K params, identity+trend+seasonality stacks) — anchor learner 3，blend_weight 0.15
- **TFT** (56K params, 2-head, hidden=32) — base learner 4（v5.5 新加），blend_weight 0.10
- **HKO 9-day forecast injection** at inference for future-date weather features
- **Capped per-DoW bias correction**（shrink=50, cap=4.0, global_cap=5.0）+ auto-fallback safety valve
- **Conformalized Quantile Regression (CQR)**：q10/q90 booster + δ_low/δ_high val-fitted offsets
- **Online conformal CI calibration**：每次 predict_range 從 prediction_accuracy 拉 30 天殘差 widen CI
- **Hierarchical Bayesian shrinkage**（v5.5 軟版）：h14/h21/h30 shrink 0.10 toward dow/recent/seasonal anchor

## 📚 研究基礎

| 組件 | 引用 |
|---|---|
| XGBoost | Chen & Guestrin (2016) |
| Optuna TPE | Akiba et al. (2019) |
| LightGBM | Ke et al. (2017) |
| N-BEATS | Oreshkin et al. (2020), ICLR |
| **TFT (Temporal Fusion Transformer)** | **Lim, Arık, Loeff & Pfister (2021), IJOF** |
| Conformalized Quantile Regression | Romano, Patterson & Candes (2019), NeurIPS |
| Online conformal | Gibbs & Candes (2021), JMLR |
| Hierarchical reconciliation | Hyndman & Athanasopoulos (2021) FPP3 ch.11 |
| Concept drift adaptation | Gama et al. (2014), ACM CS |
| HK ED 預測基準 | BMC Emergency Medicine (2025) MAE 2.63 |

## 🔄 更新歷史

- 2026-05-18 HKT: **v5.5.00** — per-horizon split (h21 NEW), holiday-type embedding, HKO 9-day forecast inject, **TFT** 第 4 base learner, AI backfill 工具, Hierarchical Bayesian shrinkage 軟版。MAE 14.40 → **13.84** (v5.0.00 → v5.5.00 總改善 **−22.9%**)
- 2026-05-18 HKT: v5.4.00 — CHP flu, school terms, N-BEATS, CQR, online conformal 全面加入。MAE 17.94 → 14.40 (−19.7%)
- 2026-05-18 HKT: v5.3.00 — weather, AI factor, holiday context, YoY lags, Optuna, LightGBM, quantile CI, bias correction
- 2026-04-14 HKT: v5.0.00 — DB-only direct multi-horizon + baseline gate（MAE 17.94 真實值）
