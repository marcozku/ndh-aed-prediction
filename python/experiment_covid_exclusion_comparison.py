#!/usr/bin/env python3
"""
XGBoost Data Exclusion Comparison Experiment v1.0

研究問題: 使用全部 11 年數據 + 基於證據的極端值排除 vs Sliding Window 方法

Research-Based Methods for Handling Outliers/COVID:
==================================================

1. IQR-Based Exclusion (Tukey, 1977)
   - Classical statistical method for outlier detection
   - Exclude values outside Q1 - 1.5*IQR and Q3 + 1.5*IQR

2. Z-Score Exclusion (Grubbs, 1950)
   - Parametric method assuming normal distribution
   - Exclude values with |z| > 3

3. Modified Z-Score (Iglewicz & Hoaglin, 1993)
   - Uses median absolute deviation (MAD)
   - More robust to outliers: |M_i| > 3.5

4. Winsorization (Winsor, 1941)
   - Cap extreme values at percentile bounds (e.g., 5th-95th)
   - Preserves data points but limits their impact

5. Domain-Based COVID Exclusion
   - Exclude specific COVID period (Feb 2020 - Jun 2022)
   - Based on epidemiological knowledge

6. Time-Decay Weighting (Gama et al., 2014)
   - Exponential decay for older data
   - Handles concept drift naturally

7. Sliding Window (Widmer & Kubat, 1996)
   - Only use recent N years
   - Most aggressive approach to handling concept drift

References:
- Tukey, J. W. (1977). Exploratory Data Analysis. Addison-Wesley.
- Grubbs, F. E. (1950). Procedures for Detecting Outlying Observations. 
- Iglewicz, B. & Hoaglin, D. C. (1993). How to Detect and Handle Outliers.
- Gama, J. et al. (2014). A Survey on Concept Drift Adaptation. ACM Computing Surveys.
"""

import sys
import os
import warnings
warnings.filterwarnings('ignore')

import pandas as pd
import numpy as np
from datetime import datetime
import json
import time

# XGBoost and sklearn
import xgboost as xgb
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

# Set working directory
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(SCRIPT_DIR)

# Try importing feature engineering
try:
    from feature_engineering import create_comprehensive_features
    HAS_FEATURE_ENG = True
except ImportError:
    HAS_FEATURE_ENG = False
    print("⚠️ feature_engineering not available, using basic features")

def load_data():
    """Load all available attendance data"""
    # Try to load from combined files
    df1_path = os.path.join(SCRIPT_DIR, '..', 'ndh_attendance_extracted.csv')
    df2_path = os.path.join(SCRIPT_DIR, '..', 'NDH_AED_Attendance_2025-12-01_to_2025-12-21.csv')
    
    dfs = []
    
    if os.path.exists(df1_path):
        df1 = pd.read_csv(df1_path)
        df1.columns = ['Date', 'Attendance']
        dfs.append(df1)
    
    if os.path.exists(df2_path):
        df2 = pd.read_csv(df2_path)
        df2.columns = ['Date', 'Attendance']
        dfs.append(df2)
    
    if not dfs:
        raise FileNotFoundError("No data files found!")
    
    df = pd.concat(dfs).drop_duplicates(subset=['Date'])
    df['Date'] = pd.to_datetime(df['Date'])
    df = df.sort_values('Date').reset_index(drop=True)
    
    return df

def create_basic_features(df):
    """Create basic time-series features if feature_engineering is not available"""
    df = df.copy()
    df['Date'] = pd.to_datetime(df['Date'])
    df = df.sort_values('Date').reset_index(drop=True)
    
    # Time features
    df['Day_of_Week'] = df['Date'].dt.dayofweek
    df['Month'] = df['Date'].dt.month
    df['Year'] = df['Date'].dt.year
    df['Is_Weekend'] = (df['Day_of_Week'] >= 5).astype(int)
    
    # Lag features
    for lag in [1, 7, 14, 30]:
        df[f'Attendance_Lag{lag}'] = df['Attendance'].shift(lag)
    
    # Rolling features
    for window in [3, 7, 14]:
        df[f'Attendance_Rolling{window}'] = df['Attendance'].shift(1).rolling(window).mean()
        df[f'Attendance_Std{window}'] = df['Attendance'].shift(1).rolling(window).std()
    
    # EWMA features
    for span in [7, 14, 30]:
        df[f'Attendance_EWMA{span}'] = df['Attendance'].shift(1).ewm(span=span).mean()
    
    # Day-of-week encoding (cyclic)
    df['DayOfWeek_sin'] = np.sin(2 * np.pi * df['Day_of_Week'] / 7)
    df['DayOfWeek_cos'] = np.cos(2 * np.pi * df['Day_of_Week'] / 7)
    
    # Month encoding (cyclic)
    df['Month_sin'] = np.sin(2 * np.pi * df['Month'] / 12)
    df['Month_cos'] = np.cos(2 * np.pi * df['Month'] / 12)
    
    return df

def get_feature_cols(df):
    """Get feature columns (exclude Date, Attendance, Year)"""
    exclude_cols = ['Date', 'Attendance', 'Year']
    return [col for col in df.columns if col not in exclude_cols 
            and not col.startswith('_') and df[col].dtype in ['int64', 'float64', 'int32', 'float32']]

# ============ OUTLIER HANDLING METHODS ============

def iqr_exclusion(df, target_col='Attendance', k=1.5):
    """Exclude outliers using IQR method (Tukey, 1977)"""
    Q1 = df[target_col].quantile(0.25)
    Q3 = df[target_col].quantile(0.75)
    IQR = Q3 - Q1
    lower = Q1 - k * IQR
    upper = Q3 + k * IQR
    mask = (df[target_col] >= lower) & (df[target_col] <= upper)
    return df[mask].copy()

def zscore_exclusion(df, target_col='Attendance', threshold=3):
    """Exclude outliers using Z-score method (Grubbs, 1950)"""
    mean = df[target_col].mean()
    std = df[target_col].std()
    z_scores = np.abs((df[target_col] - mean) / std)
    mask = z_scores <= threshold
    return df[mask].copy()

def modified_zscore_exclusion(df, target_col='Attendance', threshold=3.5):
    """
    Exclude outliers using Modified Z-score (Iglewicz & Hoaglin, 1993)
    Uses MAD (Median Absolute Deviation) - more robust
    """
    median = df[target_col].median()
    mad = np.median(np.abs(df[target_col] - median))
    # Avoid division by zero
    if mad == 0:
        mad = 1e-6
    modified_z = 0.6745 * (df[target_col] - median) / mad
    mask = np.abs(modified_z) <= threshold
    return df[mask].copy()

def winsorization(df, target_col='Attendance', lower_pct=0.05, upper_pct=0.95):
    """
    Winsorization: Cap extreme values at percentile bounds (Winsor, 1941)
    Instead of excluding, we cap the values
    """
    df = df.copy()
    lower = df[target_col].quantile(lower_pct)
    upper = df[target_col].quantile(upper_pct)
    df[target_col] = df[target_col].clip(lower, upper)
    return df

def covid_period_exclusion(df, start='2020-02-01', end='2022-06-30'):
    """
    Exclude COVID period based on domain knowledge
    Hong Kong COVID restrictions: Feb 2020 - Jun 2022
    """
    df = df.copy()
    covid_start = pd.Timestamp(start)
    covid_end = pd.Timestamp(end)
    mask = ~((df['Date'] >= covid_start) & (df['Date'] <= covid_end))
    return df[mask].copy()

def time_decay_weights(dates, half_life_days=365):
    """
    Calculate exponential time decay weights (Gama et al., 2014)
    Recent data gets higher weight
    """
    max_date = dates.max()
    days_from_latest = (max_date - dates).dt.days
    weights = np.exp(-0.693 * days_from_latest / half_life_days)
    # Normalize
    weights = weights / weights.mean()
    return weights

def sliding_window(df, years=3):
    """
    Sliding window: Only use recent N years (Widmer & Kubat, 1996)
    """
    df = df.copy()
    cutoff = df['Date'].max() - pd.Timedelta(days=years * 365)
    return df[df['Date'] >= cutoff].copy()

# ============ TRAINING AND EVALUATION ============

def train_and_evaluate(df, sample_weights=None, config_name=""):
    """Train XGBoost and return metrics"""
    
    if len(df) < 50:
        return {'error': 'Not enough data', 'mae': float('inf')}
    
    # Create features
    if HAS_FEATURE_ENG:
        df_feat = create_comprehensive_features(df.copy())
    else:
        df_feat = create_basic_features(df.copy())
    
    # Drop NaN rows (especially important for lag features)
    df_feat = df_feat.dropna()
    
    if len(df_feat) < 50:
        return {'error': 'Not enough data after feature creation', 'mae': float('inf')}
    
    # Get feature columns
    feature_cols = get_feature_cols(df_feat)
    
    # Time series split (80/20)
    split_idx = int(len(df_feat) * 0.8)
    train_df = df_feat[:split_idx]
    test_df = df_feat[split_idx:]
    
    X_train = train_df[feature_cols]
    y_train = train_df['Attendance']
    X_test = test_df[feature_cols]
    y_test = test_df['Attendance']
    
    # Handle sample weights
    train_weights = None
    if sample_weights is not None:
        # Align weights with training data after NaN removal
        train_weights = sample_weights[:len(train_df)]
        if len(train_weights) != len(train_df):
            # Recalculate if alignment failed
            train_weights = time_decay_weights(train_df['Date'])
    
    # XGBoost parameters (simplified for speed)
    model = xgb.XGBRegressor(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        objective='reg:squarederror',
        random_state=42,
        n_jobs=-1
    )
    
    # Train
    try:
        if train_weights is not None and len(train_weights) == len(X_train):
            model.fit(X_train, y_train, sample_weight=train_weights.values if hasattr(train_weights, 'values') else train_weights)
        else:
            model.fit(X_train, y_train)
    except Exception as e:
        model.fit(X_train, y_train)
    
    # Predict
    y_pred = model.predict(X_test)
    
    # Metrics
    mae = mean_absolute_error(y_test, y_pred)
    rmse = np.sqrt(mean_squared_error(y_test, y_pred))
    mape = np.mean(np.abs((y_test - y_pred) / y_test)) * 100
    r2 = r2_score(y_test, y_pred)
    
    # Naive baseline (previous day)
    naive_pred = test_df['Attendance'].shift(1).dropna()
    naive_actual = y_test.iloc[1:]
    naive_mae = mean_absolute_error(naive_actual, naive_pred)
    
    # MASE (Mean Absolute Scaled Error)
    mase = mae / naive_mae if naive_mae > 0 else float('inf')
    
    return {
        'mae': mae,
        'rmse': rmse,
        'mape': mape,
        'r2': r2,
        'mase': mase,
        'naive_mae': naive_mae,
        'train_size': len(train_df),
        'test_size': len(test_df),
        'feature_count': len(feature_cols)
    }

def run_experiments():
    """Run all experiments and compare methods"""
    
    print("=" * 70)
    print("🔬 XGBoost Data Exclusion Comparison Experiment")
    print(f"   Start Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)
    
    # Load data
    print("\n📊 Loading data...")
    df = load_data()
    print(f"   Total records: {len(df)}")
    print(f"   Date range: {df['Date'].min().date()} to {df['Date'].max().date()}")
    
    # Define experiments
    experiments = [
        # Baseline: All data, no treatment
        {
            'name': 'A: All Data (Baseline)',
            'method': 'none',
            'description': 'All data without any treatment'
        },
        
        # Statistical outlier exclusion methods
        {
            'name': 'B: IQR Exclusion (Tukey)',
            'method': 'iqr',
            'description': 'Exclude values outside 1.5*IQR bounds'
        },
        {
            'name': 'C: Z-Score Exclusion (|z|>3)',
            'method': 'zscore',
            'description': 'Exclude values with Z-score > 3'
        },
        {
            'name': 'D: Modified Z-Score (MAD)',
            'method': 'modified_zscore',
            'description': 'Using Median Absolute Deviation, more robust'
        },
        {
            'name': 'E: Winsorization (5-95%)',
            'method': 'winsorization',
            'description': 'Cap extremes at 5th and 95th percentile'
        },
        
        # Domain-based exclusion
        {
            'name': 'F: COVID Period Exclusion',
            'method': 'covid_exclusion',
            'description': 'Exclude Feb 2020 - Jun 2022'
        },
        
        # Weighting methods
        {
            'name': 'G: All Data + Time Decay (1yr)',
            'method': 'time_decay_1yr',
            'description': 'Exponential decay, half-life 1 year'
        },
        {
            'name': 'H: All Data + Time Decay (2yr)',
            'method': 'time_decay_2yr',
            'description': 'Exponential decay, half-life 2 years'
        },
        
        # Sliding window methods
        {
            'name': 'I: Sliding Window 2 Years',
            'method': 'sliding_2yr',
            'description': 'Only use most recent 2 years'
        },
        {
            'name': 'J: Sliding Window 3 Years',
            'method': 'sliding_3yr',
            'description': 'Only use most recent 3 years'
        },
        {
            'name': 'K: Sliding Window 4 Years',
            'method': 'sliding_4yr',
            'description': 'Only use most recent 4 years'
        },
        
        # Combined methods
        {
            'name': 'L: IQR + Time Decay',
            'method': 'iqr_time_decay',
            'description': 'IQR exclusion + time decay weighting'
        },
        {
            'name': 'M: COVID Exclusion + Time Decay',
            'method': 'covid_time_decay',
            'description': 'Exclude COVID + time decay weighting'
        },
    ]
    
    results = []
    
    for exp in experiments:
        print(f"\n{'='*60}")
        print(f"[EXP] {exp['name']}")
        print(f"      {exp['description']}")
        print(f"{'='*60}")
        
        start_time = time.time()
        
        try:
            # Apply method
            exp_df = df.copy()
            sample_weights = None
            
            if exp['method'] == 'none':
                pass
            elif exp['method'] == 'iqr':
                exp_df = iqr_exclusion(exp_df)
            elif exp['method'] == 'zscore':
                exp_df = zscore_exclusion(exp_df)
            elif exp['method'] == 'modified_zscore':
                exp_df = modified_zscore_exclusion(exp_df)
            elif exp['method'] == 'winsorization':
                exp_df = winsorization(exp_df)
            elif exp['method'] == 'covid_exclusion':
                exp_df = covid_period_exclusion(exp_df)
            elif exp['method'] == 'time_decay_1yr':
                sample_weights = time_decay_weights(exp_df['Date'], half_life_days=365)
            elif exp['method'] == 'time_decay_2yr':
                sample_weights = time_decay_weights(exp_df['Date'], half_life_days=730)
            elif exp['method'] == 'sliding_2yr':
                exp_df = sliding_window(exp_df, years=2)
            elif exp['method'] == 'sliding_3yr':
                exp_df = sliding_window(exp_df, years=3)
            elif exp['method'] == 'sliding_4yr':
                exp_df = sliding_window(exp_df, years=4)
            elif exp['method'] == 'iqr_time_decay':
                exp_df = iqr_exclusion(exp_df)
                sample_weights = time_decay_weights(exp_df['Date'], half_life_days=365)
            elif exp['method'] == 'covid_time_decay':
                exp_df = covid_period_exclusion(exp_df)
                sample_weights = time_decay_weights(exp_df['Date'], half_life_days=365)
            
            print(f"   Data points: {len(exp_df)}")
            
            # Train and evaluate
            metrics = train_and_evaluate(exp_df, sample_weights, exp['name'])
            elapsed = time.time() - start_time
            
            print(f"\n   Results:")
            print(f"   MAE:  {metrics.get('mae', 'N/A'):.2f}")
            print(f"   RMSE: {metrics.get('rmse', 'N/A'):.2f}")
            print(f"   MAPE: {metrics.get('mape', 'N/A'):.2f}%")
            print(f"   R²:   {metrics.get('r2', 'N/A'):.4f}")
            print(f"   MASE: {metrics.get('mase', 'N/A'):.4f}")
            print(f"   Time: {elapsed:.1f}s")
            
            results.append({
                'name': exp['name'],
                'method': exp['method'],
                'description': exp['description'],
                'data_points': len(exp_df),
                'metrics': metrics,
                'elapsed': elapsed
            })
            
        except Exception as e:
            print(f"   ❌ Error: {e}")
            results.append({
                'name': exp['name'],
                'method': exp['method'],
                'description': exp['description'],
                'error': str(e)
            })
    
    # Summary
    print("\n" + "=" * 70)
    print("📊 EXPERIMENT SUMMARY")
    print("=" * 70)
    
    # Sort by MAE
    valid_results = [r for r in results if 'metrics' in r and 'mae' in r['metrics'] and r['metrics']['mae'] != float('inf')]
    valid_results.sort(key=lambda x: x['metrics']['mae'])
    
    print(f"\n{'Rank':<5} {'Method':<35} {'MAE':>8} {'MAPE':>8} {'MASE':>8} {'R²':>8} {'Data':>6}")
    print("-" * 85)
    
    for i, r in enumerate(valid_results):
        m = r['metrics']
        print(f"{i+1:<5} {r['name']:<35} {m['mae']:>8.2f} {m['mape']:>7.2f}% {m['mase']:>8.4f} {m['r2']:>8.4f} {r['data_points']:>6}")
    
    # Best method
    if valid_results:
        best = valid_results[0]
        print("\n" + "=" * 70)
        print(f"🏆 BEST METHOD: {best['name']}")
        print(f"   MAE: {best['metrics']['mae']:.2f}")
        print(f"   Description: {best['description']}")
        print("=" * 70)
    
    # Key insights
    print("\n📝 KEY INSIGHTS:")
    print("-" * 70)
    
    # Compare all data vs sliding window
    all_data = next((r for r in results if r['method'] == 'none' and 'metrics' in r), None)
    sliding_3yr = next((r for r in results if r['method'] == 'sliding_3yr' and 'metrics' in r), None)
    
    if all_data and sliding_3yr:
        all_mae = all_data['metrics']['mae']
        sliding_mae = sliding_3yr['metrics']['mae']
        diff = sliding_mae - all_mae
        if diff < 0:
            print(f"• Sliding Window (3yr) outperforms All Data by {abs(diff):.2f} MAE")
        else:
            print(f"• All Data outperforms Sliding Window (3yr) by {abs(diff):.2f} MAE")
    
    # Compare IQR exclusion
    iqr_result = next((r for r in results if r['method'] == 'iqr' and 'metrics' in r), None)
    if iqr_result and all_data:
        iqr_mae = iqr_result['metrics']['mae']
        all_mae = all_data['metrics']['mae']
        diff = iqr_mae - all_mae
        if diff < 0:
            print(f"• IQR Exclusion improves MAE by {abs(diff):.2f}")
        else:
            print(f"• IQR Exclusion worsens MAE by {abs(diff):.2f}")
    
    # Save results
    results_file = os.path.join(SCRIPT_DIR, 'models', 'covid_exclusion_experiment.json')
    os.makedirs(os.path.dirname(results_file), exist_ok=True)
    
    with open(results_file, 'w', encoding='utf-8') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'total_data_points': len(df),
            'date_range': f"{df['Date'].min().date()} to {df['Date'].max().date()}",
            'experiments': results,
            'best_method': valid_results[0]['name'] if valid_results else None,
            'best_mae': valid_results[0]['metrics']['mae'] if valid_results else None
        }, f, indent=2, ensure_ascii=False, default=str)
    
    print(f"\n💾 Results saved to: {results_file}")
    
    return results

if __name__ == '__main__':
    run_experiments()
