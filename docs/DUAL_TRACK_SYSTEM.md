# 🔬 Dual-Track Intelligent Prediction System

## v3.0.82 - 2026-01-05

### 🎯 Overview

The **Dual-Track Intelligent Prediction System** is an adaptive machine learning framework that continuously validates AI factor effectiveness through parallel prediction streams and automatically optimizes model weights based on real-world performance.

---

## 🏗️ System Architecture

### Two Parallel Tracks

#### **Production Track** (Active Deployment)
- **Purpose**: Current validated model used for actual predictions
- **Current Weights**: `w_base=0.95`, `w_weather=0.05`, `w_AI=0.00`
- **Status**: AI factor disabled pending validation data
- **Reliability**: MAPE=2.42% (688 test days)

#### **Experimental Track** (Validation Stream)
- **Purpose**: Test AI factor integration
- **Test Weights**: `w_base=0.85`, `w_weather=0.05`, `w_AI=0.10`
- **Status**: Collecting validation evidence
- **Goal**: Determine if AI factor improves accuracy

---

## 📊 How It Works

### 1. **Parallel Prediction Generation**
Every prediction generates **two forecasts**:

```
Today = 2026-01-05
XGBoost Base = 255 patients
AI Factor = 0.95 (Marathon event detected, -5% attendance)
Weather Factor = 1.02 (Good weather, +2% attendance)

Production Prediction:
  = 0.95 × 255 + 0.05 × (255 × 1.02) + 0.00 × (255 × 0.95)
  = 242.25 + 13.01 + 0
  = 255 patients ✅ (AI ignored)

Experimental Prediction:
  = 0.85 × 255 + 0.05 × (255 × 1.02) + 0.10 × (255 × 0.95)
  = 216.75 + 13.01 + 24.23
  = 254 patients 🧪 (AI included)
```

### 2. **Real-Time Validation**
When actual attendance data arrives:

```
Actual = 242 patients

Production Error: |255 - 242| = 13
Experimental Error: |254 - 242| = 12 ✅ Better!

System logs:
  - Date: 2026-01-05
  - Winner: Experimental (-1 MAE improvement)
  - AI was correct: Marathon did reduce attendance
```

### 3. **Automatic Evaluation** (Every 10 validations)

After collecting **30+ validated predictions**, the system runs statistical analysis:

```python
# python/optimize_bayesian_weights_adaptive.py

Production MAE:  6.18
Experimental MAE: 5.85
Improvement:     +5.3%
Win Rate:        62% (Experimental wins 62% of predictions)
P-Value:         0.023 (Statistically significant)

RECOMMENDATION: ✅ Enable AI factor
  New Weights: w_base=0.85, w_AI=0.10, w_weather=0.05
```

### 4. **Intelligent Weight Updates**

The system automatically adjusts weights based on evidence:

| Evidence | Action | New w_AI |
|----------|--------|----------|
| Improvement > 10%, Win Rate > 65% | **Strong**: Increase w_AI by 0.10 | 0.10 |
| Improvement > 5%, Win Rate > 60% | **Moderate**: Increase w_AI by 0.05 | 0.05 |
| Improvement > 2%, Win Rate > 55% | **Weak**: Increase w_AI by 0.03 | 0.03 |
| Improvement < 2% or P-value > 0.05 | **No Change**: Keep current weights | 0.00 |

---

## 🔄 Adaptive Learning Flow

```
┌─────────────────────┐
│  Dual Prediction    │
│  (Production +      │
│   Experimental)     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Actual Data        │
│  Arrives            │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Calculate Errors   │
│  for Both Tracks    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Save to Database   │
│  (validation table) │
└──────────┬──────────┘
           │
           ▼
     [30+ samples?]
           │
         YES│
           ▼
┌─────────────────────┐
│  Run Statistical    │
│  Analysis           │
│  (Paired t-test)    │
└──────────┬──────────┘
           │
           ▼
    [Experimental     ]
    [ significantly   ]
    [ better?         ]
           │
         YES│
           ▼
┌─────────────────────┐
│  Update Weights     │
│  Automatically      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Log Optimization   │
│  to History         │
└─────────────────────┘
```

---

## 📁 Key Files

### Backend Components

| File | Purpose |
|------|---------|
| `modules/dual-track-predictor.js` | Core dual-track prediction engine |
| `modules/pragmatic-bayesian.js` | Bayesian fusion with dual-track support |
| `python/optimize_bayesian_weights_adaptive.py` | Automatic weight optimization script |
| `migrations/002_dual_track_predictions.sql` | Database schema for dual-track storage |

### Frontend Components

| File | Purpose |
|------|---------|
| `public/dual-track.html` | Real-time dual-track dashboard |

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/dual-track/summary` | GET | Get today's dual predictions + validation stats |
| `/api/dual-track/history` | GET | Get validation history for charts |
| `/api/dual-track/validate` | POST | Validate prediction when actual data arrives |
| `/api/dual-track/optimize` | POST | Trigger weight optimization manually |

---

## 💻 Usage

### 1. Access Dual-Track Dashboard

Open your browser:
```
http://localhost:3000/dual-track.html
```

You'll see:
- ✅ **Production Prediction** (currently active)
- 🧪 **Experimental Prediction** (testing AI factor)
- 📊 **Real-time comparison**
- 📈 **Validation history chart**
- 🎯 **System recommendations**

### 2. Automatic Background Validation

The system automatically:
- Generates dual predictions every 30 minutes
- Validates when actual data is uploaded
- Runs optimization every 10 validations (if 30+ samples)
- Updates weights when evidence is strong

### 3. Manual Optimization

Trigger weight optimization manually:

```bash
python python/optimize_bayesian_weights_adaptive.py
```

Or via API:
```bash
curl -X POST http://localhost:3000/api/dual-track/optimize
```

---

## 📊 Database Schema

### `daily_predictions` (Extended)

New columns added:
- `prediction_production` - Production track prediction
- `prediction_experimental` - Experimental track prediction
- `ai_factor` - AI impact factor used
- `weather_factor` - Weather impact factor used
- `xgboost_base` - XGBoost base prediction
- `production_error` - Production track error (after validation)
- `experimental_error` - Experimental track error
- `better_model` - Which model was closer ('production' or 'experimental')
- `validation_date` - When prediction was validated

### `weight_optimization_history`

Tracks all weight optimization decisions:
- Old and new weights
- Performance metrics (MAE, RMSE, improvement %)
- Statistical significance (p-value, t-statistic)
- Recommendation and decision reasoning

### `ai_factor_validation`

Stores AI-specific validation data:
- Event type and description
- AI factor values
- Improvement metrics
- Validated performance

---

## 📈 Performance Metrics

### Current Status (v3.0.82)

**Production Track:**
- MAE: 6.18
- RMSE: 8.41
- MAPE: 2.42%
- R²: 0.898

**Experimental Track:**
- Status: Collecting validation data
- Target: 30 samples for first evaluation
- Current: 0 samples

---

## 🎯 Decision Criteria

### Weight Update Triggers

The system updates weights only when **ALL** of these conditions are met:

1. ✅ **Sample Size**: ≥30 validated predictions
2. ✅ **Improvement**: >2% MAE reduction
3. ✅ **Statistical Significance**: p-value <0.05 (paired t-test)
4. ✅ **Win Rate**: >55% (experimental wins more often)

### Example Decision Log

```
Optimization Date: 2026-02-15
Samples: 45 days
Production MAE: 6.18
Experimental MAE: 5.85
Improvement: +5.3% (-0.33 MAE)
Win Rate: 62% (28/45 wins)
T-statistic: -2.34
P-value: 0.023

✅ DECISION: Update weights
   w_base: 0.95 → 0.90
   w_AI: 0.00 → 0.05
   w_weather: 0.05 → 0.05

Justification: Strong evidence for AI factor effectiveness.
               Significant improvement in prediction accuracy.
```

---

## 🔄 System Adaptability

### Continuous Learning

The system is designed to:

1. **Adapt to new AI insights** as they prove effective
2. **Revert weights** if experimental performance degrades
3. **Gradual weight updates** (incremental: 0.03 → 0.05 → 0.10)
4. **Evidence-based decisions** (statistical validation required)

### Future AI Model Updates

When OpenAI releases GPT-5 or new capabilities:
1. System continues generating dual predictions
2. New AI insights are tested in experimental track
3. Automatic validation determines effectiveness
4. Weights adapt if new model improves accuracy

**No manual intervention required!** 🚀

---

## 📚 References

- **Bayesian Fusion**: `modules/pragmatic-bayesian.js`
- **Weight Optimization**: `python/models/bayesian_weights_optimized.json`
- **Technical Documentation**: `docs/NDH_AED_Prediction_Algorithm_Technical_Document.pdf`
- **Dynamic Factors System**: `docs/DYNAMIC_FACTORS_SYSTEM.md`

---

## 🎓 Key Benefits

### 1. **Scientific Rigor**
- ✅ Statistical validation (paired t-test)
- ✅ Real-world evidence required
- ✅ No arbitrary decisions

### 2. **Continuous Improvement**
- ✅ Always testing new approaches
- ✅ Automatic adaptation to proven methods
- ✅ Zero downtime (production stays safe)

### 3. **Transparency**
- ✅ All decisions logged
- ✅ Real-time dashboard
- ✅ Explainable AI

### 4. **Safety**
- ✅ Production model never changed without evidence
- ✅ Gradual weight updates
- ✅ Automatic rollback if performance degrades

---

## 🚀 Future Enhancements

- [ ] Multi-day validation windows (7-day, 30-day analysis)
- [ ] A/B testing framework for multiple experimental tracks
- [ ] Automated hyperparameter optimization
- [ ] Concept drift detection and alerts
- [ ] Integration with hospital operations dashboard

---

**Author**: Ma Tsz Kiu  
**Version**: 3.0.82  
**Date**: 2026-01-05  
**Status**: Production Ready ✅

