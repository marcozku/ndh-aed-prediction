#!/usr/bin/env python3
"""
Adaptive Bayesian Weight Optimizer (v3.0.82)

Purpose: Automatically evaluates dual-track predictions and optimizes
         Bayesian fusion weights based on real validation data.

Features:
  - Compares production vs experimental prediction performance
  - Statistical significance testing (paired t-test)
  - Intelligent weight updates when experimental shows improvement
  - Rolling window evaluation (last 90 days)
  - Automatic model adaptation

Author: Ma Tsz Kiu
Date: 2026-01-05
"""

import sys
import os
import json
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime, timedelta
from scipy import stats
import numpy as np

# Ensure UTF-8 output
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')
if sys.stderr.encoding != 'utf-8':
    sys.stderr.reconfigure(encoding='utf-8')

# Database connection from environment
DATABASE_URL = os.getenv('DATABASE_URL')

# Configuration
MIN_SAMPLES = 30  # Minimum validation samples needed
EVAL_WINDOW_DAYS = 90  # Evaluation window
IMPROVEMENT_THRESHOLD = 2.0  # Minimum improvement % to trigger update
P_VALUE_THRESHOLD = 0.05  # Statistical significance level

class AdaptiveBayesianOptimizer:
    def __init__(self):
        self.weights_file = 'python/models/bayesian_weights_optimized.json'
        self.conn = None
        
    def connect_db(self):
        """Connect to PostgreSQL database"""
        try:
            if DATABASE_URL:
                self.conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
            else:
                self.conn = psycopg2.connect(
                    host=os.getenv('PGHOST', 'localhost'),
                    port=os.getenv('PGPORT', '5432'),
                    user=os.getenv('PGUSER', 'postgres'),
                    password=os.getenv('PGPASSWORD', ''),
                    database=os.getenv('PGDATABASE', 'ndh_aed'),
                    cursor_factory=RealDictCursor
                )
            print('✅ Connected to PostgreSQL database')
            return True
        except Exception as e:
            print(f'❌ Database connection failed: {e}')
            return False
    
    def load_current_weights(self):
        """Load current weights from JSON"""
        try:
            with open(self.weights_file, 'r', encoding='utf-8') as f:
                config = json.load(f)
            return config['optimized_weights']
        except Exception as e:
            print(f'⚠️  Could not load weights: {e}')
            return {'w_base': 0.95, 'w_weather': 0.05, 'w_AI': 0.00}
    
    def get_validation_data(self):
        """Fetch dual-track predictions with actual attendance"""
        query = """
            SELECT 
                prediction_date,
                prediction_production as prod_pred,
                prediction_experimental as exp_pred,
                actual_attendance as actual,
                production_error,
                experimental_error,
                ai_factor,
                weather_factor
            FROM daily_predictions
            WHERE prediction_date >= CURRENT_DATE - INTERVAL '%s days'
              AND actual_attendance IS NOT NULL
              AND prediction_production IS NOT NULL
              AND prediction_experimental IS NOT NULL
            ORDER BY prediction_date
        """ % EVAL_WINDOW_DAYS
        
        with self.conn.cursor() as cur:
            cur.execute(query)
            results = cur.fetchall()
        
        return results
    
    def evaluate_performance(self, data):
        """Evaluate production vs experimental performance"""
        if len(data) < MIN_SAMPLES:
            return None, f'Insufficient data: {len(data)} < {MIN_SAMPLES} samples'
        
        # Extract errors
        prod_errors = []
        exp_errors = []
        
        for row in data:
            actual = row['actual']
            prod_err = abs(row['prod_pred'] - actual)
            exp_err = abs(row['exp_pred'] - actual)
            prod_errors.append(prod_err)
            exp_errors.append(exp_err)
        
        # Calculate metrics
        prod_mae = np.mean(prod_errors)
        exp_mae = np.mean(exp_errors)
        prod_rmse = np.sqrt(np.mean(np.array(prod_errors)**2))
        exp_rmse = np.sqrt(np.mean(np.array(exp_errors)**2))
        
        # Improvement
        improvement = prod_mae - exp_mae
        improvement_pct = (improvement / prod_mae) * 100
        
        # Statistical significance (paired t-test)
        t_stat, p_value = stats.ttest_rel(prod_errors, exp_errors)
        statistically_significant = p_value < P_VALUE_THRESHOLD
        
        # Win rate
        exp_wins = sum(1 for i in range(len(prod_errors)) if exp_errors[i] < prod_errors[i])
        win_rate = (exp_wins / len(prod_errors)) * 100
        
        return {
            'samples': len(data),
            'production': {
                'mae': round(prod_mae, 3),
                'rmse': round(prod_rmse, 3),
                'std': round(np.std(prod_errors), 3)
            },
            'experimental': {
                'mae': round(exp_mae, 3),
                'rmse': round(exp_rmse, 3),
                'std': round(np.std(exp_errors), 3),
                'wins': exp_wins,
                'win_rate': round(win_rate, 1)
            },
            'improvement': {
                'absolute': round(improvement, 3),
                'percentage': round(improvement_pct, 2)
            },
            'statistics': {
                't_statistic': round(t_stat, 4),
                'p_value': round(p_value, 6),
                'significant': statistically_significant
            }
        }, None
    
    def calculate_optimal_weights(self, current_weights, metrics):
        """Calculate new optimal weights based on performance"""
        improvement_pct = metrics['improvement']['percentage']
        p_value = metrics['statistics']['p_value']
        win_rate = metrics['experimental']['win_rate']
        
        # Criteria for weight update
        should_update = (
            improvement_pct > IMPROVEMENT_THRESHOLD and
            p_value < P_VALUE_THRESHOLD and
            win_rate > 55
        )
        
        if not should_update:
            return current_weights, False, self._get_no_update_reason(metrics)
        
        # Calculate new weights
        # Gradually increase w_AI based on improvement magnitude
        new_w_AI = current_weights['w_AI']
        
        if improvement_pct > 10 and win_rate > 65:
            # Strong evidence: increase w_AI by 0.10
            new_w_AI = min(0.20, current_weights['w_AI'] + 0.10)
        elif improvement_pct > 5 and win_rate > 60:
            # Moderate evidence: increase w_AI by 0.05
            new_w_AI = min(0.15, current_weights['w_AI'] + 0.05)
        else:
            # Weak evidence: small increase
            new_w_AI = min(0.10, current_weights['w_AI'] + 0.03)
        
        # Adjust other weights (maintain sum = 1.0)
        new_w_base = current_weights['w_base'] - (new_w_AI - current_weights['w_AI'])
        new_w_weather = current_weights['w_weather']
        
        # Ensure valid weights
        new_w_base = max(0.70, min(0.95, new_w_base))
        
        new_weights = {
            'w_base': round(new_w_base, 2),
            'w_weather': round(new_w_weather, 2),
            'w_AI': round(new_w_AI, 2)
        }
        
        # Normalize to sum = 1.0
        weight_sum = sum(new_weights.values())
        for k in new_weights:
            new_weights[k] = round(new_weights[k] / weight_sum, 2)
        
        recommendation = self._get_update_recommendation(metrics, new_weights)
        
        return new_weights, True, recommendation
    
    def _get_no_update_reason(self, metrics):
        """Generate reason for not updating weights"""
        improvement = metrics['improvement']['percentage']
        p_value = metrics['statistics']['p_value']
        win_rate = metrics['experimental']['win_rate']
        
        reasons = []
        
        if improvement < IMPROVEMENT_THRESHOLD:
            reasons.append(f'Improvement too small ({improvement:.1f}% < {IMPROVEMENT_THRESHOLD}%)')
        
        if p_value >= P_VALUE_THRESHOLD:
            reasons.append(f'Not statistically significant (p={p_value:.4f})')
        
        if win_rate <= 55:
            reasons.append(f'Win rate too low ({win_rate:.1f}% ≤ 55%)')
        
        return 'No weight update: ' + '; '.join(reasons)
    
    def _get_update_recommendation(self, metrics, new_weights):
        """Generate recommendation message"""
        improvement = metrics['improvement']['percentage']
        win_rate = metrics['experimental']['win_rate']
        
        msg = f'✅ RECOMMENDED: Update weights to enable AI factor.\n'
        msg += f'   Evidence: {improvement:.1f}% improvement, {win_rate:.0f}% win rate\n'
        msg += f'   New weights: w_base={new_weights["w_base"]}, w_AI={new_weights["w_AI"]}, w_weather={new_weights["w_weather"]}'
        
        return msg
    
    def save_weights(self, new_weights, metrics, recommendation):
        """Save optimized weights to JSON"""
        config = {
            'version': '3.0.82',
            'updated': datetime.now().strftime('%Y-%m-%d %H:%M HKT'),
            'method': 'Adaptive optimization from dual-track validation',
            'base_model_performance': {
                'mae': metrics['production']['mae'],
                'rmse': metrics['production']['rmse']
            },
            'optimized_weights': new_weights,
            'validation_evidence': {
                'samples': metrics['samples'],
                'improvement_pct': metrics['improvement']['percentage'],
                'p_value': metrics['statistics']['p_value'],
                'win_rate': metrics['experimental']['win_rate']
            },
            'recommendation': recommendation
        }
        
        with open(self.weights_file, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        
        print(f'✅ Saved optimized weights to {self.weights_file}')
    
    def log_optimization(self, current_weights, new_weights, metrics, updated):
        """Log optimization to database"""
        query = """
            INSERT INTO weight_optimization_history (
                evaluation_period_days,
                samples_evaluated,
                w_base_old, w_weather_old, w_ai_old,
                w_base_new, w_weather_new, w_ai_new,
                production_mae, experimental_mae,
                improvement_percentage,
                p_value, statistically_significant,
                weights_updated,
                recommendation
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """
        
        with self.conn.cursor() as cur:
            cur.execute(query, (
                EVAL_WINDOW_DAYS,
                metrics['samples'],
                current_weights['w_base'], current_weights['w_weather'], current_weights['w_AI'],
                new_weights['w_base'], new_weights['w_weather'], new_weights['w_AI'],
                metrics['production']['mae'], metrics['experimental']['mae'],
                metrics['improvement']['percentage'],
                metrics['statistics']['p_value'], metrics['statistics']['significant'],
                updated,
                json.dumps(metrics, ensure_ascii=False)
            ))
        self.conn.commit()
        print('✅ Logged optimization to database')
    
    def run(self):
        """Main optimization routine"""
        print('\n' + '='*60)
        print('🔬 Adaptive Bayesian Weight Optimizer')
        print('='*60 + '\n')
        
        # Connect to database
        if not self.connect_db():
            return False
        
        try:
            # Load current weights
            current_weights = self.load_current_weights()
            print(f'📊 Current weights: w_base={current_weights["w_base"]}, w_weather={current_weights["w_weather"]}, w_AI={current_weights["w_AI"]}')
            
            # Get validation data
            print(f'📥 Fetching validation data (last {EVAL_WINDOW_DAYS} days)...')
            data = self.get_validation_data()
            print(f'   Found {len(data)} validated predictions')
            
            if len(data) < MIN_SAMPLES:
                print(f'\n⚠️  Insufficient data for optimization')
                print(f'   Required: {MIN_SAMPLES} samples')
                print(f'   Available: {len(data)} samples')
                print(f'   Continue collecting data...\n')
                return True
            
            # Evaluate performance
            print(f'\n📈 Evaluating performance...')
            metrics, error = self.evaluate_performance(data)
            
            if error:
                print(f'❌ Evaluation failed: {error}')
                return False
            
            # Print results
            print(f'\n📊 Performance Metrics:')
            print(f'   Production:    MAE={metrics["production"]["mae"]:.3f}, RMSE={metrics["production"]["rmse"]:.3f}')
            print(f'   Experimental:  MAE={metrics["experimental"]["mae"]:.3f}, RMSE={metrics["experimental"]["rmse"]:.3f}')
            print(f'   Improvement:   {metrics["improvement"]["percentage"]:.2f}% ({metrics["improvement"]["absolute"]:.3f})')
            print(f'   Win Rate:      {metrics["experimental"]["win_rate"]:.1f}% ({metrics["experimental"]["wins"]}/{metrics["samples"]})')
            print(f'   Significance:  t={metrics["statistics"]["t_statistic"]:.4f}, p={metrics["statistics"]["p_value"]:.6f}')
            print(f'   Significant:   {"✅ YES" if metrics["statistics"]["significant"] else "❌ NO"}')
            
            # Calculate optimal weights
            print(f'\n🎯 Calculating optimal weights...')
            new_weights, should_update, recommendation = self.calculate_optimal_weights(
                current_weights, metrics
            )
            
            print(f'\n{recommendation}\n')
            
            # Log to database
            self.log_optimization(current_weights, new_weights, metrics, should_update)
            
            # Save if updated
            if should_update:
                self.save_weights(new_weights, metrics, recommendation)
                print('✅ Weights updated successfully!')
                print('⚠️  IMPORTANT: Restart Node.js server to apply new weights')
            else:
                print('ℹ️  Weights remain unchanged')
            
            return True
            
        except Exception as e:
            print(f'\n❌ Optimization failed: {e}')
            import traceback
            traceback.print_exc()
            return False
        
        finally:
            if self.conn:
                self.conn.close()

if __name__ == '__main__':
    optimizer = AdaptiveBayesianOptimizer()
    success = optimizer.run()
    sys.exit(0 if success else 1)

