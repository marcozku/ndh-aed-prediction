# Training Data Implementation Verification

## ✅ Verification Summary

**Status: TRAINING DATA IS FULLY IMPLEMENTED INTO THE ALGORITHM**

The actual patient count data from the `actual_data` database table is correctly loaded, processed, and used in all three model training algorithms.

---

## 📊 Data Loading Process

### 1. Database Query
All training scripts (`train_xgboost.py`, `train_lstm.py`, `train_prophet.py`) use:

```sql
SELECT date as Date, patient_count as Attendance
FROM actual_data
ORDER BY date ASC
```

**Location:**
- `python/train_xgboost.py:30-33`
- `python/train_lstm.py:33-36`
- `python/train_prophet.py:29-32`

### 2. Data Validation
All scripts include column name mapping to handle case inconsistencies:
- Maps `date` → `Date`
- Maps `patient_count` or `attendance` → `Attendance`

---

## 🔧 Feature Engineering

### Attendance Data Usage in Features

The `create_comprehensive_features()` function in `python/feature_engineering.py` uses the actual `Attendance` (patient_count) data to create:

#### 1. **Lag Features** (Lines 42-50)
```python
for lag in [1, 7, 14, 30, 60, 90, 365]:
    df[f'Attendance_Lag{lag}'] = df['Attendance'].shift(lag)
```
- Uses actual historical attendance values
- Creates 7 lag features based on real data

#### 2. **Rolling Statistics** (Lines 53-57)
```python
for window in [7, 14, 30]:
    df[f'Attendance_Rolling{window}'] = df['Attendance'].rolling(window=window).mean()
    df[f'Attendance_Std{window}'] = df['Attendance'].rolling(window=window).std()
    df[f'Attendance_Max{window}'] = df['Attendance'].rolling(window=window).max()
    df[f'Attendance_Min{window}'] = df['Attendance'].rolling(window=window).min()
```
- Calculates rolling averages, standard deviations, max, and min
- Uses actual attendance data over 7, 14, and 30-day windows
- Creates 12 rolling features

#### 3. **Change Rates** (Lines 85-92)
```python
df['Daily_Change'] = df['Attendance'].diff()
df['Weekly_Change'] = df['Attendance'].diff(7)
df['Monthly_Change'] = df['Attendance'].diff(30)
```
- Calculates day-to-day, week-to-week, and month-to-month changes
- Uses actual attendance differences

**Total Features Derived from Attendance Data:**
- 7 lag features
- 12 rolling statistics (3 windows × 4 stats)
- 3 change rate features
- **Total: 22 features directly derived from actual patient count data**

---

## 🎯 Model Training

### XGBoost Model (`train_xgboost.py`)

**Lines 88-93:**
```python
X_train = train_data[feature_cols].fillna(0)
y_train = train_data['Attendance']  # ← ACTUAL PATIENT COUNT
X_test = test_data[feature_cols].fillna(0)
y_test = test_data['Attendance']   # ← ACTUAL PATIENT COUNT
```

**Training Process (Lines 114-118):**
```python
model.fit(
    X_train, y_train,  # ← Training on actual patient counts
    eval_set=[(X_test, y_test)],
    verbose=False
)
```

**Verification:**
- ✅ Uses `Attendance` column as target variable (`y_train`, `y_test`)
- ✅ Uses features derived from `Attendance` (lags, rolling stats, changes)
- ✅ Evaluates model performance against actual patient counts

### LSTM Model (`train_lstm.py`)

**Similar Implementation:**
- ✅ Loads data from database (Line 187)
- ✅ Creates features using `create_comprehensive_features()` (Line 206)
- ✅ Uses `Attendance` as target variable in training

### Prophet Model (`train_prophet.py`)

**Similar Implementation:**
- ✅ Loads data from database (Line 144)
- ✅ Uses `Attendance` column directly for Prophet's time series forecasting
- ✅ Prophet requires `ds` (date) and `y` (attendance) columns

---

## 📈 Data Flow Diagram

```
Database (actual_data table)
    ↓
    patient_count (raw data)
    ↓
load_data_from_db()
    ↓
DataFrame with 'Date' and 'Attendance' columns
    ↓
create_comprehensive_features()
    ↓
    ├─→ Lag Features (Attendance_Lag1, Lag7, ...)
    ├─→ Rolling Stats (Rolling7, Rolling14, ...)
    ├─→ Change Rates (Daily_Change, Weekly_Change, ...)
    └─→ Time Features (Year, Month, Day_of_Week, ...)
    ↓
Feature DataFrame (X_train, X_test)
    ↓
Model Training
    ↓
    X_train → Features
    y_train → Attendance (actual patient count) ← TARGET VARIABLE
    ↓
Trained Model
```

---

## ✅ Verification Checklist

- [x] **Data Loading**: All scripts query `actual_data` table
- [x] **Data Validation**: Column name mapping handles case inconsistencies
- [x] **Feature Engineering**: Attendance data used to create 22+ derived features
- [x] **Target Variable**: `Attendance` (patient_count) used as `y_train`/`y_test`
- [x] **Model Training**: Models trained to predict actual patient counts
- [x] **Evaluation**: Model performance measured against actual patient counts

---

## 📝 Evidence from Code

### Example Training Output
From the training logs, we can see:
```
加載了 1157 筆數據
訓練集: 925 筆
測試集: 232 筆
使用 49 個特徵
XGBoost 模型性能:
  MAE: 3.66 病人
  RMSE: 5.95 病人
  MAPE: 1.56%
```

This confirms:
1. ✅ Data is loaded from database (1157 records)
2. ✅ Data is split into train/test sets
3. ✅ Features are created (49 features)
4. ✅ Model is evaluated on actual patient counts (MAE, RMSE, MAPE)

---

## 🔍 Conclusion

**The training data (patient_count from actual_data table) IS FULLY IMPLEMENTED into the algorithm:**

1. ✅ **Loaded** from database in all training scripts
2. ✅ **Processed** through feature engineering to create 22+ derived features
3. ✅ **Used as target variable** (`y_train`/`y_test`) in all models
4. ✅ **Evaluated** against actual patient counts to measure model performance

The algorithm is correctly using the real historical patient attendance data to train the prediction models.

