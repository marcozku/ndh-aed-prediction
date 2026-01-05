#!/usr/bin/env python3
"""
Experiment: Compare different sliding window configurations
Research basis: Gama et al. (2014) - Concept Drift Adaptation

Configurations:
A. No sliding window (all data + time decay 0.001)
B. 2 year sliding window (2024-2026)
C. 3 year sliding window (2023-2026)
D. 4 year sliding window (2022-2026, excludes COVID core period)
"""

import subprocess
import sys
import os
import json
import time
from datetime import datetime

# Fix Windows encoding
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# 設置工作目錄
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(SCRIPT_DIR)

# 實驗配置
EXPERIMENTS = [
    {
        'name': 'A: 全部數據 + 時間衰減',
        'sliding_window': 0,
        'time_decay': 0.001,
        'description': '使用全部 10 年數據，近期數據權重更高'
    },
    {
        'name': 'B: 2 年滑動窗口',
        'sliding_window': 2,
        'time_decay': 0.001,
        'description': '只用 2024-2026 數據，約 730 天'
    },
    {
        'name': 'C: 3 年滑動窗口',
        'sliding_window': 3,
        'time_decay': 0.001,
        'description': '只用 2023-2026 數據，約 1095 天'
    },
    {
        'name': 'D: 4 年滑動窗口 (排除 COVID)',
        'sliding_window': 4,
        'time_decay': 0.001,
        'description': '只用 2022-2026 數據，約 1460 天'
    }
]

def run_experiment(config):
    """Run a single experiment configuration"""
    print(f"\n{'='*60}")
    print(f"[TEST] {config['name']}")
    print(f"   {config['description']}")
    print(f"   Sliding Window: {config['sliding_window']} years")
    print(f"   Time Decay: {config['time_decay']}")
    print(f"{'='*60}")
    
    env = os.environ.copy()
    env['SLIDING_WINDOW_YEARS'] = str(config['sliding_window'])
    env['TIME_DECAY_RATE'] = str(config['time_decay'])
    env['PYTHONUNBUFFERED'] = '1'
    
    start_time = time.time()
    
    try:
        result = subprocess.run(
            [sys.executable, 'train_xgboost.py'],
            cwd=SCRIPT_DIR,
            env=env,
            capture_output=True,
            text=True,
            timeout=600  # 10 分鐘超時
        )
        
        elapsed = time.time() - start_time
        
        # 解析輸出中的 metrics
        output = result.stdout + result.stderr
        metrics = parse_metrics(output)
        metrics['elapsed_time'] = elapsed
        metrics['success'] = result.returncode == 0
        
        print(f"\n[RESULT]")
        print(f"   MAE: {metrics.get('mae', 'N/A')}")
        print(f"   MAPE: {metrics.get('mape', 'N/A')}%")
        print(f"   R2: {metrics.get('r2', 'N/A')}")
        print(f"   MASE: {metrics.get('mase', 'N/A')}")
        print(f"   Time: {elapsed:.1f}s")
        
        return metrics
        
    except subprocess.TimeoutExpired:
        print(f"[ERROR] Timeout (>10min)")
        return {'success': False, 'error': 'timeout'}
    except Exception as e:
        print(f"[ERROR] Failed: {e}")
        return {'success': False, 'error': str(e)}

def parse_metrics(output):
    """從訓練輸出解析 metrics"""
    metrics = {}
    
    # 尋找 metrics 行
    lines = output.split('\n')
    for i, line in enumerate(lines):
        if 'MAE:' in line and 'MAPE' not in line:
            try:
                metrics['mae'] = float(line.split('MAE:')[1].split()[0].replace(',', ''))
            except:
                pass
        if 'MAPE:' in line:
            try:
                val = line.split('MAPE:')[1].split()[0].replace('%', '').replace(',', '')
                metrics['mape'] = float(val)
            except:
                pass
        if 'R²:' in line or 'R2:' in line:
            try:
                if 'R²:' in line:
                    val = line.split('R²:')[1].split()[0].replace('%', '').replace(',', '')
                else:
                    val = line.split('R2:')[1].split()[0].replace('%', '').replace(',', '')
                metrics['r2'] = float(val)
            except:
                pass
        if 'MASE:' in line:
            try:
                metrics['mase'] = float(line.split('MASE:')[1].split()[0].replace(',', ''))
            except:
                pass
        if 'Naive MAE:' in line or 'naive_mae' in line.lower():
            try:
                if 'Naive MAE:' in line:
                    metrics['naive_mae'] = float(line.split('Naive MAE:')[1].split()[0].replace(',', ''))
            except:
                pass
                
    # 也嘗試從 JSON 輸出解析
    for line in lines:
        if line.strip().startswith('{') and 'mae' in line.lower():
            try:
                data = json.loads(line.strip())
                if 'mae' in data:
                    metrics['mae'] = data['mae']
                if 'mape' in data:
                    metrics['mape'] = data['mape']
                if 'r2' in data:
                    metrics['r2'] = data['r2']
                if 'mase' in data:
                    metrics['mase'] = data['mase']
            except:
                pass
    
    return metrics

def main():
    print(f"\n{'#'*60}")
    print("[EXP] Sliding Window Experiment")
    print(f"   Start: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"   Research: Gama et al. (2014) Concept Drift Adaptation")
    print(f"{'#'*60}")
    
    results = []
    
    for config in EXPERIMENTS:
        metrics = run_experiment(config)
        results.append({
            'config': config,
            'metrics': metrics
        })
    
    # Summary
    print(f"\n{'='*60}")
    print("[SUMMARY] Experiment Results")
    print(f"{'='*60}")
    print(f"{'Config':<30} {'MAE':>8} {'MAPE':>8} {'MASE':>8} {'Winner':>10}")
    print("-" * 70)
    
    best_mae = float('inf')
    best_config = None
    
    for r in results:
        config = r['config']
        metrics = r['metrics']
        
        mae = metrics.get('mae', float('inf'))
        mape = metrics.get('mape', 'N/A')
        mase = metrics.get('mase', 'N/A')
        
        if isinstance(mae, (int, float)) and mae < best_mae:
            best_mae = mae
            best_config = config['name']
        
        conclusion = '<-- BEST' if mae == best_mae and best_config == config['name'] else ''
        
        mae_str = f"{mae:.2f}" if isinstance(mae, (int, float)) else str(mae)
        mape_str = f"{mape:.2f}%" if isinstance(mape, (int, float)) else str(mape)
        mase_str = f"{mase:.3f}" if isinstance(mase, (int, float)) else str(mase)
        
        print(f"{config['name']:<30} {mae_str:>8} {mape_str:>8} {mase_str:>8} {conclusion:>10}")
    
    print("-" * 70)
    print(f"\n[WINNER] Best config: {best_config}")
    print(f"         MAE: {best_mae:.2f}")
    
    # 保存結果
    results_file = os.path.join(SCRIPT_DIR, 'models', 'experiment_results.json')
    with open(results_file, 'w', encoding='utf-8') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'experiments': results,
            'best_config': best_config,
            'best_mae': best_mae
        }, f, indent=2, ensure_ascii=False)
    
    print(f"\n[SAVED] Results saved to: {results_file}")
    
    return best_config, best_mae

if __name__ == '__main__':
    main()

