# VERSION_LOG.md

## v3.0.98 - 2026-01-06 12:30 HKT

### 🏆 Major Update: COVID 排除法取代 Sliding Window

**基於 13 種方法的實驗比較，COVID 排除法勝出**

#### 實驗結果:
| 方法 | MAE | MAPE | R² | 數據量 |
|------|-----|------|-----|--------|
| **COVID 排除法** | **16.52** | **6.76%** | **0.334** | 3171 |
| Sliding Window 3yr | 19.66 | 8.07% | 0.206 | 1096 |
| All Data Baseline | 17.53 | 7.23% | 0.286 | 4052 |

#### 改善幅度 (vs Sliding Window 3yr):
- MAE: **-16%** (19.66 → 16.52)
- MAPE: **-16%** (8.07% → 6.76%)
- R²: **+62%** (0.206 → 0.334)
- 可用數據: **+189%** (1096 → 3171)

#### Changes:
1. ✅ **創建實驗腳本** `experiment_covid_exclusion_comparison.py`
   - 對比 13 種數據處理方法
   - 包括: IQR/Z-score/MAD 排除、Winsorization、時間衰減、Sliding Window

2. ✅ **更新 train_xgboost.py**
   - 默認使用 COVID 排除法 (USE_COVID_EXCLUSION=1)
   - 排除期間: 2020-02-01 至 2022-06-30
   - Sliding Window 降級為備用選項

3. ✅ **研究基礎**
   - Gama et al. (2014) - Concept Drift Adaptation
   - Tukey (1977) - Exploratory Data Analysis
   - 實驗驗證：完整歷史 + 精準排除 > 短窗口

#### 科學原理:
- COVID 期間是系統性偏移，不是隨機噪聲
- 11 年歷史數據包含完整季節性/年度模式
- 精準排除異常期間，保留正常歷史數據
- Sliding Window 丟棄太多有價值的歷史數據

#### Files Changed:
- `python/experiment_covid_exclusion_comparison.py` (NEW)
- `python/models/covid_exclusion_experiment.json` (NEW)
- `python/train_xgboost.py` (UPDATED)
- `python/models/algorithm_timeline.json` (UPDATED)
- `VERSION_LOG_NEW.md` (UPDATED)

---

## v3.0.81 - 2026-01-05 04:40 HKT

### 🔥 Major Update: Dynamic Factors System

**CRITICAL: All prediction factors now auto-update from Railway Database**

#### Changes:
1. ✅ **Dynamic Factor Calculation Engine**
   - Created `python/calculate_dynamic_factors.py`
   - Auto-runs before every model training
   - Calculates Day-of-Week, Month, and Holiday factors from real data
   - Outputs to `python/models/dynamic_factors.json`

2. ✅ **Python Integration**
   - Updated `python/feature_engineering.py` to load dynamic factors
   - Updated `python/train_xgboost.py` to auto-update factors before training
   - Fallback to last known real values if file unavailable

3. ✅ **JavaScript Integration**
   - Updated `prediction.js` to load dynamic holiday factors
   - `HK_PUBLIC_HOLIDAYS` now uses real-time factors from database

4. ✅ **Eliminated ALL Hardcoded Fake Data**
   - **Before**: Holiday factors were hardcoded (e.g., '農曆新年': 0.75 - FAKE!)
   - **After**: All factors from database (e.g., '農曆新年': 0.951 - REAL!)
   - Total data discrepancies fixed: 14 holidays × 2 files = 28 fake values eliminated

5. ✅ **Real Data From 4,052 Days**
   - Day-of-Week factors (n=578-579 each)
   - Month factors (n=311-372 each)
   - Holiday factors (n=11-132 each)

6. ✅ **Documentation**
   - Created `docs/DYNAMIC_FACTORS_SYSTEM.md`
   - Updated technical document with dynamic factor info
   - Added validation summary

#### Benefits:
- **100% Real Data**: No more estimates or mock values
- **Auto-Update**: New data uploaded by user → Next training → Factors auto-update
- **Traceable**: Every factor includes sample size and calculation date
- **Scientific**: All values statistically derived from real records

#### Files Changed:
- `python/calculate_dynamic_factors.py` (NEW)
- `python/models/dynamic_factors.json` (AUTO-GENERATED)
- `python/feature_engineering.py` (UPDATED)
- `python/train_xgboost.py` (UPDATED)
- `prediction.js` (UPDATED)
- `docs/DYNAMIC_FACTORS_SYSTEM.md` (NEW)
- `docs/NDH_AED_Prediction_Algorithm_Technical_Document.md` (UPDATED)

#### Verification:
```bash
python python/calculate_dynamic_factors.py
cat python/models/dynamic_factors.json
```

---

*Previous entries...*

