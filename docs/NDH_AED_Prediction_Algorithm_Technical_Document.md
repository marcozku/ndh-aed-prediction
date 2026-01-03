# NDH AED Attendance Prediction Algorithm
## Technical Documentation v3.0.76

**North District Hospital Emergency Department**  
**Predictive Analytics System**

---

**Document Version:** 3.0.76  
**Last Updated:** January 4, 2026  
**Author:** NDH AED Analytics Team

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture](#2-system-architecture)
3. [Data Sources](#3-data-sources)
4. [Feature Engineering](#4-feature-engineering)
5. [XGBoost Model](#5-xgboost-model)
6. [Bayesian Fusion Layer](#6-bayesian-fusion-layer)
7. [Post-Processing Adjustments](#7-post-processing-adjustments)
8. [Mathematical Framework](#8-mathematical-framework)
9. [Performance Evaluation](#9-performance-evaluation)
10. [Concept Drift Handling](#10-concept-drift-handling)
11. [Research Evidence](#11-research-evidence)
12. [References](#12-references)

---

## 1. Executive Summary

### 1.1 Purpose

This document provides a comprehensive technical specification of the North District Hospital (NDH) Accident & Emergency Department (AED) attendance prediction algorithm. The system forecasts daily patient attendance to support resource planning and staffing decisions.

### 1.2 Key Metrics

| Metric | Value | Description |
|--------|-------|-------------|
| MAE | 4.90 patients | Mean Absolute Error |
| MAPE | 1.96% | Mean Absolute Percentage Error |
| R² | 0.898 | Coefficient of Determination |
| Features | 25 | Optimized feature count |

### 1.3 Algorithm Summary

The prediction system employs a three-layer architecture:

```
Layer 1: XGBoost Regression (25 optimized features)
    ↓
Layer 2: Pragmatic Bayesian Fusion (AI + Weather factors)
    ↓
Layer 3: Extreme Condition Post-Processing
    ↓
Final Prediction
```

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    DATA SOURCES                              │
├──────────────┬──────────────┬──────────────┬────────────────┤
│  Historical  │     HKO      │     EPD      │      AI        │
│  Attendance  │   Weather    │    AQHI      │   Analysis     │
│   Database   │     API      │     API      │   (GPT-4)      │
└──────┬───────┴──────┬───────┴──────┬───────┴───────┬────────┘
       │              │              │               │
       ▼              ▼              ▼               ▼
┌─────────────────────────────────────────────────────────────┐
│                 FEATURE ENGINEERING                          │
│  • EWMA (Exponential Weighted Moving Average)                │
│  • Lag Features (1-365 days)                                 │
│  • Calendar Features (Day of Week, Holidays)                 │
│  • Rolling Statistics (Mean, Std, Position)                  │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    XGBOOST MODEL                             │
│  • Gradient Boosted Decision Trees                           │
│  • 25 Optimized Features (RFE Selected)                      │
│  • Optuna Hyperparameter Tuning                              │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│               BAYESIAN FUSION LAYER                          │
│  • XGBoost Base Prediction                                   │
│  • AI Factor Weight (0.15)                                   │
│  • Weather Factor Weight (0.10)                              │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│            POST-PROCESSING ADJUSTMENTS                       │
│  • AQHI ≥7: +2.5%, ≥10: +5%                                 │
│  • Cold <8°C: -3%, <12°C: -1.5%                             │
│  • Heavy Rain >25mm: -5%                                     │
│  • Strong Wind >30km/h: -3%                                  │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
                  FINAL PREDICTION
```

### 2.2 Technology Stack

| Component | Technology |
|-----------|------------|
| Backend | Node.js, Express |
| Database | PostgreSQL |
| ML Model | XGBoost (Python) |
| AI Analysis | OpenAI GPT-4 |
| Weather Data | HKO Open Data API |
| Air Quality | EPD AQHI API |
| Frontend | Vanilla JavaScript, Chart.js |

---

## 3. Data Sources

### 3.1 Historical Attendance Data

**Source:** NDH AED Internal Records  
**Coverage:** December 1, 2014 – Present  
**Records:** 4,050+ daily observations

| Statistic | Value |
|-----------|-------|
| Mean Daily Attendance | 249.5 patients |
| Standard Deviation | 32.4 patients |
| Minimum | 111 patients |
| Maximum | 394 patients |
| Median | 252 patients |

### 3.2 Weather Data

**Source:** Hong Kong Observatory (HKO)  
**API:** https://www.hko.gov.hk/en/weatherAPI/  
**Variables:**

| Variable | Unit | Correlation with Attendance |
|----------|------|------------------------------|
| Temperature (Mean) | °C | r = +0.082 (p < 0.001) |
| Temperature (Min) | °C | r = +0.082 (p < 0.001) |
| Humidity | % | r = +0.079 (p < 0.001) |
| Rainfall | mm | r = -0.063 (p < 0.001) |
| Wind Speed | km/h | r = -0.106 (p < 0.001) |
| Visibility | km | r = +0.120 (p < 0.001) |
| Pressure | hPa | r = -0.035 (p = 0.039) |

### 3.3 Air Quality Data

**Source:** Environmental Protection Department (EPD)  
**API:** https://www.aqhi.gov.hk/  
**Variables:**

| Variable | Description |
|----------|-------------|
| AQHI General | General station average (1-10+) |
| AQHI Roadside | Roadside station average (1-10+) |
| Risk Level | Low (1-3), Moderate (4-6), High (7), Very High (8-10), Serious (10+) |

---

## 4. Feature Engineering

### 4.1 Feature Categories

The system generates 161 potential features, optimized to 25 using Recursive Feature Elimination (RFE).

#### 4.1.1 Exponential Weighted Moving Average (EWMA)

EWMA features are the most important predictors, accounting for 87% of model importance.

**Formula:**

$$EWMA_t = \alpha \cdot X_t + (1 - \alpha) \cdot EWMA_{t-1}$$

Where:
- $X_t$ = Attendance on day $t$
- $\alpha = \frac{2}{span + 1}$ (smoothing factor)
- $span$ = Window size (7, 14, or 30 days)

**Implementation:**

```python
# EWMA with span of 7 days
df['Attendance_EWMA7'] = df['Attendance'].ewm(span=7, min_periods=1).mean()
```

**Rationale:** EWMA gives more weight to recent observations, capturing short-term trends while smoothing noise. Research by Hyndman & Athanasopoulos (2021) demonstrates EWMA's effectiveness for time series forecasting.

#### 4.1.2 Lag Features

Lag features capture temporal dependencies.

| Feature | Formula | Importance |
|---------|---------|------------|
| Lag1 | $A_{t-1}$ | 1.10% |
| Lag7 | $A_{t-7}$ | 0.35% |
| Lag30 | $A_{t-30}$ | 0.47% |

**Same Weekday Average:**

$$SameWeekdayAvg_t = \frac{1}{4} \sum_{i=1}^{4} A_{t-7i}$$

#### 4.1.3 Change Features

Capture momentum and trend changes.

| Feature | Formula | Importance |
|---------|---------|------------|
| Daily Change | $A_t - A_{t-1}$ | 2.32% |
| Weekly Change | $A_t - A_{t-7}$ | 0.78% |
| Monthly Change | $A_t - A_{t-30}$ | 2.82% |

#### 4.1.4 Rolling Statistics

| Feature | Formula | Window |
|---------|---------|--------|
| Rolling Mean | $\frac{1}{w}\sum_{i=1}^{w} A_{t-i}$ | 7, 14, 30 days |
| Rolling Std | $\sqrt{\frac{1}{w}\sum_{i=1}^{w}(A_{t-i} - \bar{A})^2}$ | 7, 14, 30 days |
| Position | $\frac{A_{t-1} - Min_w}{Max_w - Min_w}$ | 7, 14, 30 days |
| CV | $\frac{Std_w}{Mean_w}$ | 7, 14, 30 days |

#### 4.1.5 Calendar Features

| Feature | Values | Encoding |
|---------|--------|----------|
| Day of Week | 0-6 (Mon-Sun) | Integer |
| Is Weekend | 0 or 1 | Binary |
| Holiday Factor | 0.75-1.0 | Continuous |

**Holiday Impact Factors:**

| Holiday | Factor | Impact |
|---------|--------|--------|
| Lunar New Year | 0.75 | -25% |
| Christmas | 0.85 | -15% |
| Easter | 0.90 | -10% |
| Other Public Holidays | 0.92 | -8% |

### 4.2 Final Optimized Feature Set (25 Features)

Selected via Recursive Feature Elimination (RFE):

| Rank | Feature | Importance |
|------|---------|------------|
| 1 | Attendance_EWMA7 | 86.89% |
| 2 | Monthly_Change | 2.82% |
| 3 | Daily_Change | 2.32% |
| 4 | Attendance_Lag1 | 1.10% |
| 5 | Weekly_Change | 0.78% |
| 6 | Attendance_Rolling7 | 0.48% |
| 7 | Attendance_Lag30 | 0.47% |
| 8 | Attendance_Position7 | 0.47% |
| 9 | Day_of_Week | 0.45% |
| 10 | DayOfWeek_sin | 0.39% |
| 11-25 | Other features | < 0.4% each |

---

## 5. XGBoost Model

### 5.1 Algorithm Overview

XGBoost (eXtreme Gradient Boosting) is an ensemble learning method that combines multiple decision trees using gradient boosting (Chen & Guestrin, 2016).

**Objective Function:**

$$\mathcal{L}(\phi) = \sum_{i=1}^{n} l(y_i, \hat{y}_i) + \sum_{k=1}^{K} \Omega(f_k)$$

Where:
- $l(y_i, \hat{y}_i)$ = Loss function (MSE for regression)
- $\Omega(f_k) = \gamma T + \frac{1}{2}\lambda \|w\|^2$ = Regularization term
- $T$ = Number of leaves
- $w$ = Leaf weights
- $\gamma, \lambda$ = Regularization parameters

### 5.2 Hyperparameters

Optimized using Optuna TPE (Tree-structured Parzen Estimator) with 30 trials (Akiba et al., 2019).

| Parameter | Value | Description |
|-----------|-------|-------------|
| n_estimators | 500 | Number of boosting rounds |
| max_depth | 8 | Maximum tree depth |
| learning_rate | 0.05 | Step size shrinkage |
| min_child_weight | 3 | Minimum sum of instance weight |
| subsample | 0.85 | Row sampling ratio |
| colsample_bytree | 0.85 | Column sampling ratio |
| gamma | 0.1 | Minimum loss reduction for split |
| alpha (L1) | 0.5 | L1 regularization |
| lambda (L2) | 1.5 | L2 regularization |

### 5.3 Training Process

**Time Series Cross-Validation:**

```
Fold 1: Train [2014-2019] → Validate [2020]
Fold 2: Train [2014-2020] → Validate [2021]
Fold 3: Train [2014-2021] → Validate [2022]
Final:  Train [2014-2022] → Test [2023-2025]
```

**Sample Weighting:**

To handle concept drift, we apply time-decay weights:

$$w_i = e^{-\lambda \cdot d_i}$$

Where:
- $d_i$ = Days from most recent observation
- $\lambda$ = Decay rate (default: 0.693/365 for 1-year half-life)

**COVID Period Adjustment:**

$$w_i = w_i \times 0.3 \quad \text{if } date_i \in [2020\text{-}02, 2022\text{-}06]$$

### 5.4 Prediction Formula

For a new observation $x$:

$$\hat{y}_{XGB} = \sum_{k=1}^{K} f_k(x)$$

Where $f_k$ is the $k$-th decision tree.

---

## 6. Bayesian Fusion Layer

### 6.1 Purpose

Combine XGBoost predictions with AI analysis and weather factors using a pragmatic Bayesian approach.

### 6.2 Mathematical Framework

**Prior (XGBoost Prediction):**

$$P(\theta | XGB) \sim \mathcal{N}(\hat{y}_{XGB}, \sigma_{base}^2)$$

Where $\sigma_{base} = 15$ (empirically determined).

**Likelihoods:**

$$P(D_{AI} | \theta) \propto \mathcal{N}(\theta \cdot f_{AI}, \sigma_{AI}^2)$$
$$P(D_{Weather} | \theta) \propto \mathcal{N}(\theta \cdot f_{Weather}, \sigma_{Weather}^2)$$

**Posterior (Fused Prediction):**

$$\hat{y}_{fused} = w_{base} \cdot \hat{y}_{XGB} + w_{AI} \cdot (\hat{y}_{XGB} \cdot f_{AI}) + w_{Weather} \cdot (\hat{y}_{XGB} \cdot f_{Weather})$$

**Weights (based on factor deviation from neutral):**

| Factor | Neutral Value | Weight |
|--------|---------------|--------|
| Base (XGBoost) | - | 0.75 |
| AI Factor | 1.0 | 0.15 |
| Weather Factor | 1.0 | 0.10 |

### 6.3 AI Factor Calculation

The AI (GPT-4) analyzes:
- Health policy changes
- Public health emergencies
- Major social/sporting events
- School calendar events
- Hospital service changes

**Output:** Impact factor $f_{AI} \in [0.7, 1.3]$

**Excluded from AI Analysis (handled by system):**
- Weather conditions
- Public holidays
- Seasonal flu patterns
- Weekend effects

### 6.4 Weather Factor Calculation

```javascript
let weatherFactor = 1.0;

// Temperature effect
if (temperature < 15) {
    weatherFactor *= 1.0 + (15 - temperature) * 0.01;
}

// Humidity effect
if (humidity > 80) {
    weatherFactor *= 1.0 + (humidity - 80) * 0.002;
}

// Rainfall effect
if (rainfall > 5) {
    weatherFactor *= 1.0 + Math.min(rainfall, 50) * 0.003;
}

// Bound to [0.85, 1.15]
weatherFactor = Math.max(0.85, Math.min(1.15, weatherFactor));
```

---

## 7. Post-Processing Adjustments

### 7.1 Purpose

Apply additional adjustments for extreme conditions that are not fully captured by the main model.

### 7.2 Adjustment Rules

| Condition | Adjustment | Research Basis |
|-----------|------------|----------------|
| AQHI ≥ 10 | +5% | Respiratory/cardiovascular ED visits increase (Lancet 2019) |
| AQHI ≥ 7 | +2.5% | High air pollution health index |
| Temperature ≤ 8°C | -3% | Reduced outdoor activity, but increased respiratory issues |
| Temperature ≤ 12°C | -1.5% | Cold weather effect |
| Rainfall > 25mm | -5% | Heavy rain reduces non-urgent visits (NDH data: -4.9%) |
| Wind > 30km/h | -3% | Strong wind reduces mobility (NDH data: -2.8%) |

### 7.3 Implementation

```javascript
function applyExtremeConditionAdjustments(prediction, weather, aqhi) {
    let adjusted = prediction;
    
    // AQHI adjustments
    if (aqhi?.general >= 10) {
        adjusted *= 1.05;  // +5%
    } else if (aqhi?.general >= 7) {
        adjusted *= 1.025; // +2.5%
    }
    
    // Weather adjustments
    if (weather?.temperature <= 8) {
        adjusted *= 0.97;  // -3%
    } else if (weather?.temperature <= 12) {
        adjusted *= 0.985; // -1.5%
    }
    
    if (weather?.rainfall > 25) {
        adjusted *= 0.95;  // -5%
    }
    
    if (weather?.windSpeed > 30) {
        adjusted *= 0.97;  // -3%
    }
    
    return Math.round(adjusted);
}
```

---

## 8. Mathematical Framework

### 8.1 Complete Prediction Formula

$$\hat{y}_{final} = \text{PostProcess}\left( \text{BayesianFuse}\left( \hat{y}_{XGB}, f_{AI}, f_{Weather} \right) \right)$$

Expanded:

$$\hat{y}_{final} = \prod_{c \in C} \alpha_c \cdot \left[ w_0 \cdot \hat{y}_{XGB} + w_1 \cdot (\hat{y}_{XGB} \cdot f_{AI}) + w_2 \cdot (\hat{y}_{XGB} \cdot f_{Weather}) \right]$$

Where:
- $C$ = Set of active extreme conditions
- $\alpha_c$ = Adjustment factor for condition $c$
- $w_0 + w_1 + w_2 = 1$ (normalized weights)

### 8.2 Confidence Intervals

**80% Confidence Interval:**

$$CI_{80} = \hat{y} \pm 1.28 \cdot \sigma_{posterior}$$

**95% Confidence Interval:**

$$CI_{95} = \hat{y} \pm 1.96 \cdot \sigma_{posterior}$$

Where:

$$\sigma_{posterior} = \sqrt{\frac{1}{\frac{1}{\sigma_{XGB}^2} + \frac{1}{\sigma_{AI}^2} + \frac{1}{\sigma_{Weather}^2}}}$$

### 8.3 EWMA Derivation

Starting from the definition:

$$EWMA_t = \alpha X_t + (1-\alpha) EWMA_{t-1}$$

Expanding recursively:

$$EWMA_t = \alpha \sum_{i=0}^{\infty} (1-\alpha)^i X_{t-i}$$

This is a geometric series with weights that decay exponentially, giving recent observations more influence.

**Half-life calculation:**

$$\text{Half-life} = \frac{\ln(0.5)}{\ln(1-\alpha)} \approx \frac{span - 1}{2}$$

For $span = 7$: Half-life ≈ 3 days

---

## 9. Performance Evaluation

### 9.1 Metrics

| Metric | Formula | Value |
|--------|---------|-------|
| MAE | $\frac{1}{n}\sum\|y_i - \hat{y}_i\|$ | 4.90 |
| MAPE | $\frac{100}{n}\sum\|\frac{y_i - \hat{y}_i}{y_i}\|$ | 1.96% |
| RMSE | $\sqrt{\frac{1}{n}\sum(y_i - \hat{y}_i)^2}$ | 6.84 |
| R² | $1 - \frac{\sum(y_i - \hat{y}_i)^2}{\sum(y_i - \bar{y})^2}$ | 0.898 |

### 9.2 Historical Performance

| Version | Date | MAE | MAPE | R² | Key Changes |
|---------|------|-----|------|-----|-------------|
| 2.9.20 | 2025-12-30 | 3.84 | 1.56% | 0.59 | Base XGBoost |
| 2.9.50 | 2026-01-01 | 6.30 | 2.45% | 0.90 | Optuna + EWMA |
| 2.9.52 | 2026-01-02 | 4.73 | 1.87% | 0.93 | 25 features (RFE) |
| 3.0.73 | 2026-01-04 | 5.22 | 2.05% | 0.93 | AQHI integration |
| 3.0.75 | 2026-01-04 | 3.36* | 1.36%* | 0.96* | RFE optimizer |
| 3.0.76 | 2026-01-04 | 4.90 | 1.96% | 0.90 | Concept Drift handling |

*Optimizer validation set metrics; production metrics higher due to concept drift.

### 9.3 Error Distribution

```
Error Range    | Frequency | Cumulative
---------------+-----------+-----------
0-5 patients   |   68.2%   |   68.2%
5-10 patients  |   24.1%   |   92.3%
10-15 patients |    5.8%   |   98.1%
>15 patients   |    1.9%   |  100.0%
```

---

## 10. Concept Drift Handling

### 10.1 Problem Description

Concept drift occurs when the statistical properties of the target variable change over time (Gama et al., 2014).

**Observed in NDH data:**

| Period | Mean Attendance | Cause |
|--------|-----------------|-------|
| 2014-2019 | ~280 patients | Pre-COVID baseline |
| 2020-2022 | ~200 patients | COVID-19 pandemic |
| 2023-2025 | ~253 patients | Post-COVID recovery |

### 10.2 Solutions Implemented

#### Sliding Window Training

Use only recent data for training:

```bash
python train_xgboost.py --sliding-window 2
```

**Effect:** Reduces MAE from 4.90 to ~3.5 by training on more relevant data.

#### Time Decay Weighting

Apply exponential decay to sample weights:

$$w_i = e^{-\lambda \cdot d_i}$$

```bash
python train_xgboost.py --time-decay 0.001
```

**Effect:** More recent observations have higher influence on model training.

---

## 11. Research Evidence

### 11.1 EWMA Effectiveness

The M4 Competition (Makridakis et al., 2020) found that simple methods like exponential smoothing often outperform complex machine learning models for time series forecasting. Our finding that EWMA7 accounts for 87% of prediction importance aligns with this research.

### 11.2 Feature Selection

Guyon & Elisseeff (2003) established that optimal feature selection reduces overfitting and improves generalization. Our reduction from 161 to 25 features follows this principle, yielding a 3% improvement in R².

### 11.3 Weather Impact on ED Attendance

Studies have shown weather affects ED attendance:
- Cold weather increases respiratory presentations (Hyndman & Athanasopoulos, 2021)
- Heavy rainfall reduces non-urgent visits (NDH internal analysis: -4.9%)
- High AQHI increases respiratory/cardiovascular visits (Lancet Planetary Health, 2019)

### 11.4 Gradient Boosting for Healthcare

Chen & Guestrin (2016) demonstrated XGBoost's effectiveness across various domains. BMC Medical Informatics (2024) specifically validated its use for ED crowding prediction.

---

## 12. References

1. **Akiba, T., Sano, S., Yanase, T., Ohta, T., & Koyama, M.** (2019). Optuna: A Next-generation Hyperparameter Optimization Framework. *Proceedings of the 25th ACM SIGKDD*, 2623-2631. https://doi.org/10.1145/3292500.3330701

2. **Chen, T., & Guestrin, C.** (2016). XGBoost: A Scalable Tree Boosting System. *Proceedings of the 22nd ACM SIGKDD*, 785-794. https://doi.org/10.1145/2939672.2939785

3. **Gama, J., Žliobaitė, I., Bifet, A., Pechenizkiy, M., & Bouchachia, A.** (2014). A Survey on Concept Drift Adaptation. *ACM Computing Surveys*, 46(4), 1-37. https://doi.org/10.1145/2523813

4. **Guyon, I., & Elisseeff, A.** (2003). An Introduction to Variable and Feature Selection. *Journal of Machine Learning Research*, 3, 1157-1182. https://www.jmlr.org/papers/v3/guyon03a.html

5. **Hastie, T., Tibshirani, R., & Friedman, J.** (2009). *The Elements of Statistical Learning* (2nd ed.). Springer. https://hastie.su.domains/ElemStatLearn/

6. **Hyndman, R.J., & Athanasopoulos, G.** (2021). *Forecasting: Principles and Practice* (3rd ed.). OTexts. https://otexts.com/fpp3/

7. **Makridakis, S., Spiliotis, E., & Assimakopoulos, V.** (2020). The M4 Competition: 100,000 time series and 61 forecasting methods. *International Journal of Forecasting*, 36(1), 54-74. https://doi.org/10.1016/j.ijforecast.2019.04.014

8. **Hong Kong Observatory.** Climate Data Services. https://www.hko.gov.hk/en/cis/climat.htm

9. **Environmental Protection Department, HKSAR.** Air Quality Health Index. https://www.aqhi.gov.hk/en.html

10. **BMC Medical Informatics and Decision Making.** (2024). Machine Learning for Emergency Department Crowding Prediction. https://bmcmedinformdecismak.biomedcentral.com/

11. **The Lancet Planetary Health.** (2019). Air Pollution and Health. https://www.thelancet.com/journals/lanplh/home

---

## Appendix A: Feature Importance Visualization

```
Feature                    | Importance | Bar
---------------------------+------------+----------------------------------------
Attendance_EWMA7           |   86.89%   | ████████████████████████████████████████
Monthly_Change             |    2.82%   | █
Daily_Change               |    2.32%   | █
Attendance_Lag1            |    1.10%   | ▌
Weekly_Change              |    0.78%   | ▌
Attendance_Rolling7        |    0.48%   | ▌
Attendance_Lag30           |    0.47%   | ▌
Attendance_Position7       |    0.47%   | ▌
Day_of_Week                |    0.45%   | ▌
Others (16 features)       |    4.22%   | ██
```

---

## Appendix B: API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/predict` | POST | Get prediction for date range |
| `/api/xgboost-predict` | POST | Direct XGBoost prediction |
| `/api/weather-current` | GET | Current weather data |
| `/api/aqhi-current` | GET | Current AQHI data |
| `/api/ai-factors` | GET | AI analysis factors |

---

## Appendix C: System Requirements

| Component | Requirement |
|-----------|-------------|
| Python | 3.9+ |
| Node.js | 18+ |
| PostgreSQL | 14+ |
| Memory | 4GB+ |
| Storage | 1GB+ |

---

**Document End**

*For questions or support, contact the NDH AED Analytics Team.*

