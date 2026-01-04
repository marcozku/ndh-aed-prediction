# VERSION_LOG.md

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

