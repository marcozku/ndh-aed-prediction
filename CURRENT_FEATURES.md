# XGBoost + LightGBM + N-BEATS 完整特徵列表 (v5.4.00)

**生成於**: 2026-05-18 HKT
**特徵數量**: **84 個**（v5.0.00 只有 39）
**模型版本**: 5.4.00 (`horizon_direct_xgboost` + ensemble)
**訓練資料**: 4186 天 Railway DB（2014-12-01 到 2026-05-17）

## 📊 真實 walk-forward 模型性能（honest 60/40 split, 180 cutoffs）

| 指標 | v5.0.00（之前）| **v5.4.00（現在）** | 改善 |
|------|------|------|------|
| MAE  | 17.94 | **14.40** | **−19.7%** |
| MAPE | 7.81% | **6.26%** | −1.55 pp |
| RMSE | 23.61 | **18.43** | −22.0% |
| CI80 經驗覆蓋率 | ~70%（靜態 quantile）| **80-83%（CQR）** | 校準完美 |
| Gate passed | 部分 | **全 4 bucket** | ✓ |

## 🎯 84 個 feature 分類

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

## 🏆 每個 bucket 的 top features（v5.4.00 真實實測）

### Short (H1-2)
1. dow_recent_mean (19.7%)
2. **flu_h1_proportion** (7.6%) — 新外生 ✓
3. roll7 (4.9%)
4. roll14 (4.7%)
5. roll28 (4.2%)
6. seasonal_baseline (3.8%)
7. **target_is_post_holiday** (3.6%) — 新外生 ✓
8. target_is_weekend (3.5%)
9. ewma14 (3.2%)
10. **flu_ili_pmp** (3.0%) — 新外生 ✓

### H7 (H3-H7)
1. **school_covid_suspension** (11.5%) — 新外生 ✓
2. **wx_is_very_cold** (9.6%) — 新外生 ✓
3. ewma14 (8.8%)
4. **flu_h1_proportion** (7.2%) — 新外生 ✓
5. dow_recent_mean (6.9%)
6. **target_is_post_holiday** (6.6%) — 新外生 ✓
7. ewma28 (5.4%)
8. roll14 (3.3%)
9. roll28 (2.9%)
10. **wx_is_heavy_rain** (2.9%) — 新外生 ✓

### H14 (H8-H14)
1. dow_recent_mean (11.3%)
2. **flu_h1_proportion** (10.6%) — 新外生 ✓
3. roll14 (8.8%)
4. **target_is_post_holiday** (8.0%) — 新外生 ✓
5. roll28 (6.1%)
6. roll56 (4.0%)
7. target_is_weekend (2.6%)
8. **flu_aandb_count** (2.4%) — 新外生 ✓
9. ewma14 (2.4%)
10. **wx_is_very_cold** (2.1%) — 新外生 ✓

### H30 (H15-H30)
1. **flu_h1_proportion** (13.8%) ⭐ — 新外生 ✓ **TOP FEATURE**
2. **target_is_post_holiday** (12.9%) — 新外生 ✓
3. **wx_is_very_cold** (12.2%) — 新外生 ✓
4. roll28 (7.6%)
5. roll14 (7.3%)
6. dow_recent_mean (3.5%)
7. target_is_weekend (3.3%)
8. **flu_ili_aed** (2.1%) — 新外生 ✓
9. **flu_aandb_count** (1.7%) — 新外生 ✓
10. **flu_intensity_score** (1.7%) — 新外生 ✓

**外生訊號在 h30 佔據前 3 名所有位置**，內生 lag/rolling 只佔 14%。這是 v5.0.00 完全沒有的事。

## 🔧 模型架構

- **XGBoost** (per-bucket Optuna 40 trials 調參) — base learner 1
- **LightGBM** L1 objective — base learner 2（auto-fallback）
- **N-BEATS** (731K params, identity+trend+seasonality stacks) — anchor learner 3，blend_weight 0.15
- **Capped per-DoW bias correction**（shrink=50, cap=4.0, global_cap=5.0）+ auto-fallback safety valve
- **Conformalized Quantile Regression (CQR)**：q10/q90 booster + δ_low/δ_high val-fitted offsets
- **Online conformal CI calibration**：每次 predict_range 從 prediction_accuracy 拉 30 天殘差 widen CI

## 📚 研究基礎

| 組件 | 引用 |
|---|---|
| XGBoost | Chen & Guestrin (2016) |
| Optuna TPE | Akiba et al. (2019) |
| LightGBM | Ke et al. (2017) |
| N-BEATS | Oreshkin et al. (2020), ICLR |
| Conformalized Quantile Regression | Romano, Patterson & Candes (2019), NeurIPS |
| Online conformal | Gibbs & Candes (2021), JMLR |
| Concept drift adaptation | Gama et al. (2014), ACM CS |
| HK ED 預測基準 | BMC Emergency Medicine (2025) MAE 2.63 |

## 🔄 更新歷史

- 2026-05-18 HKT: v5.4.00 — CHP flu, school terms, N-BEATS, CQR, online conformal 全面加入。MAE 17.94 → 14.40 (−19.7%)
- 2026-05-18 HKT: v5.3.00 — weather, AI factor, holiday context, YoY lags, Optuna, LightGBM, quantile CI, bias correction
- 2026-04-14 HKT: v5.0.00 — DB-only direct multi-horizon + baseline gate（MAE 17.94 真實值）
