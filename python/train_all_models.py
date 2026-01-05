"""
訓練 XGBoost 模型的主腳本
只訓練 XGBoost 模型
"""
import subprocess
import sys
import os
import time
import json

def format_file_size(size_bytes):
    """格式化文件大小"""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.2f} KB"
    else:
        return f"{size_bytes / (1024 * 1024):.2f} MB"

def get_file_info(file_path):
    """獲取文件信息"""
    if os.path.exists(file_path):
        size = os.path.getsize(file_path)
        return {
            'exists': True,
            'size': size,
            'size_formatted': format_file_size(size)
        }
    return {'exists': False, 'size': 0, 'size_formatted': '0 B'}

def parse_model_metrics(output):
    """從輸出中解析模型性能指標"""
    metrics = {}
    lines = output.split('\n')
    for i, line in enumerate(lines):
        if 'MAE:' in line or 'MAE' in line:
            try:
                # 嘗試提取 MAE 值
                parts = line.split('MAE')
                if len(parts) > 1:
                    value_part = parts[1].split()[0] if parts[1].split() else None
                    if value_part:
                        metrics['MAE'] = float(value_part)
            except:
                pass
        if 'RMSE:' in line or 'RMSE' in line:
            try:
                parts = line.split('RMSE')
                if len(parts) > 1:
                    value_part = parts[1].split()[0] if parts[1].split() else None
                    if value_part:
                        metrics['RMSE'] = float(value_part)
            except:
                pass
        if 'MAPE:' in line or 'MAPE' in line:
            try:
                parts = line.split('MAPE')
                if len(parts) > 1:
                    value_part = parts[1].split('%')[0] if '%' in parts[1] else parts[1].split()[0]
                    if value_part:
                        metrics['MAPE'] = float(value_part)
            except:
                pass
    return metrics

def run_training_script(script_name):
    """運行訓練腳本（實時輸出）"""
    print(f"\n{'='*60}")
    print(f"開始訓練: {script_name}")
    print(f"{'='*60}\n")
    sys.stdout.flush()
    
    # 確保在 python 目錄下運行
    script_dir = os.path.dirname(os.path.abspath(__file__))
    script_path = os.path.join(script_dir, script_name)
    
    print(f"工作目錄: {script_dir}")
    print(f"腳本路徑: {script_path}")
    sys.stdout.flush()
    
    env = os.environ.copy()
    env['PYTHONUNBUFFERED'] = '1'  # 確保子進程也不緩衝輸出
    
    # v3.0.96: 滑動窗口訓練 (研究基礎: Gama et al., 2014 Concept Drift)
    # COVID (2020-2021) 模式完全不同，只用近 2 年數據
    # 設置為 0 則使用全部數據
    if 'SLIDING_WINDOW_YEARS' not in env:
        env['SLIDING_WINDOW_YEARS'] = '2'  # 默認使用最近 2 年數據
    
    # v3.0.96: 時間衰減權重 - 近期數據權重更高
    if 'TIME_DECAY_RATE' not in env:
        env['TIME_DECAY_RATE'] = '0.001'  # 推薦值
    
    start_time = time.time()
    
    # 使用 Popen 實時輸出，而不是等待完成
    process = subprocess.Popen(
        [sys.executable, '-u', script_path],  # -u 強制無緩衝
        cwd=script_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
        bufsize=1  # 行緩衝
    )
    
    stdout_lines = []
    stderr_lines = []
    
    # 實時讀取輸出
    import threading
    import queue
    
    def read_stream(stream, lines_list, stream_name):
        """讀取流並實時輸出"""
        try:
            for line in iter(stream.readline, ''):
                if line:
                    lines_list.append(line)
                    if stream_name == 'stdout':
                        print(line, end='', flush=True)
                    else:
                        print(f"[stderr] {line}", end='', flush=True)
        except Exception as e:
            pass
        finally:
            stream.close()
    
    # 啟動讀取線程
    stdout_thread = threading.Thread(target=read_stream, args=(process.stdout, stdout_lines, 'stdout'))
    stderr_thread = threading.Thread(target=read_stream, args=(process.stderr, stderr_lines, 'stderr'))
    
    stdout_thread.start()
    stderr_thread.start()
    
    # 等待進程完成
    process.wait()
    
    # 等待讀取線程完成
    stdout_thread.join(timeout=5)
    stderr_thread.join(timeout=5)
    
    elapsed_time = time.time() - start_time
    elapsed_minutes = elapsed_time / 60
    
    stdout_text = ''.join(stdout_lines)
    stderr_text = ''.join(stderr_lines)
    
    # 解析性能指標
    metrics = parse_model_metrics(stdout_text)
    
    if process.returncode != 0:
        print(f"\n❌ {script_name} 訓練失敗")
        print(f"⏱️  訓練時間: {elapsed_minutes:.2f} 分鐘")
        if stderr_text:
            print(f"❌ 錯誤信息: {stderr_text[:500]}")
        sys.stdout.flush()
        return False, elapsed_minutes, metrics
    else:
        print(f"\n✅ {script_name} 訓練完成")
        print(f"⏱️  訓練時間: {elapsed_minutes:.2f} 分鐘")
        if metrics:
            print(f"📊 模型性能:")
            if 'MAE' in metrics:
                print(f"   MAE: {metrics['MAE']:.2f} 病人")
            if 'RMSE' in metrics:
                print(f"   RMSE: {metrics['RMSE']:.2f} 病人")
            if 'MAPE' in metrics:
                print(f"   MAPE: {metrics['MAPE']:.2f}%")
        sys.stdout.flush()
        return True, elapsed_minutes, metrics

def main():
    """主函數"""
    import sys
    import os
    
    # 確保模型目錄存在
    script_dir = os.path.dirname(os.path.abspath(__file__))
    models_dir = os.path.join(script_dir, 'models')
    os.makedirs(models_dir, exist_ok=True)
    print(f"📁 模型目錄: {models_dir}")
    
    print("🚀 開始訓練 XGBoost 模型...")
    print("只訓練 XGBoost 模型")
    print("預計需要 5-10 分鐘（取決於數據量和硬件）\n")
    
    scripts = [
        'train_xgboost.py'
    ]
    
    results = {}
    training_times = {}
    all_metrics = {}
    total_start_time = time.time()
    
    for script in scripts:
        try:
            success, elapsed_time, metrics = run_training_script(script)
            results[script] = success
            training_times[script] = elapsed_time
            if metrics:
                all_metrics[script] = metrics
        except Exception as e:
            print(f"❌ 執行 {script} 時發生異常: {e}")
            results[script] = False
            training_times[script] = 0
    
    total_elapsed_time = time.time() - total_start_time
    total_elapsed_minutes = total_elapsed_time / 60
    
    # 總結
    print(f"\n{'='*60}")
    print("📊 訓練總結:")
    print(f"{'='*60}")
    for script, success in results.items():
        status = "✅ 成功" if success else "❌ 失敗"
        elapsed = training_times.get(script, 0)
        print(f"  {script}: {status} (耗時: {elapsed:.2f} 分鐘)")
        if script in all_metrics:
            metrics = all_metrics[script]
            if metrics:
                print(f"    性能指標:")
                if 'MAE' in metrics:
                    print(f"      MAE: {metrics['MAE']:.2f} 病人")
                if 'RMSE' in metrics:
                    print(f"      RMSE: {metrics['RMSE']:.2f} 病人")
                if 'MAPE' in metrics:
                    print(f"      MAPE: {metrics['MAPE']:.2f}%")
    
    print(f"\n⏱️  總訓練時間: {total_elapsed_minutes:.2f} 分鐘")
    
    # 檢查模型文件是否存在
    print(f"\n{'='*60}")
    print("📁 模型文件檢查:")
    print(f"{'='*60}")
    model_files = {
        'XGBoost': ['xgboost_model.json', 'xgboost_features.json', 'xgboost_metrics.json']
    }
    
    all_files_exist = True
    total_file_size = 0
    for model_name, files in model_files.items():
        print(f"\n  {model_name} 模型文件:")
        for file in files:
            file_path = os.path.join(models_dir, file)
            file_info = get_file_info(file_path)
            status = "✅" if file_info['exists'] else "❌"
            if file_info['exists']:
                print(f"    {status} {file} ({file_info['size_formatted']})")
                total_file_size += file_info['size']
            else:
                print(f"    {status} {file} (缺失)")
                all_files_exist = False
    
    print(f"\n📦 總文件大小: {format_file_size(total_file_size)}")
    
    # 檢查所有腳本是否成功
    all_success = all(results.values())
    
    # 輸出詳細的失敗信息
    if not all_success:
        print("\n❌ 以下訓練腳本失敗:")
        for script, success in results.items():
            if not success:
                print(f"  - {script}")
    
    if not all_files_exist:
        print("\n❌ 以下模型文件缺失:")
        for model_name, files in model_files.items():
            for file in files:
                file_path = os.path.join(models_dir, file)
                if not os.path.exists(file_path):
                    print(f"  - {file}")
    
    # 成功統計
    success_count = sum(1 for s in results.values() if s)
    total_count = len(results)
    
    if all_success and all_files_exist:
        print(f"\n{'='*60}")
        print("🎉 訓練完成總結")
        print(f"{'='*60}")
        print(f"✅ 所有模型訓練成功 ({success_count}/{total_count})")
        print(f"✅ 所有模型文件完整")
        print(f"⏱️  總訓練時間: {total_elapsed_minutes:.2f} 分鐘")
        print(f"📦 總文件大小: {format_file_size(total_file_size)}")
        print(f"\n💡 現在可以使用 ensemble_predict.py 進行預測（XGBoost 模型）")
        print(f"{'='*60}\n")
        sys.exit(0)
    else:
        print(f"\n{'='*60}")
        print("⚠️  訓練完成但存在問題")
        print(f"{'='*60}")
        print(f"✅ 成功: {success_count}/{total_count} 個模型")
        print(f"❌ 失敗: {total_count - success_count}/{total_count} 個模型")
        if not all_files_exist:
            print(f"❌ 部分模型文件缺失")
        print(f"⏱️  總訓練時間: {total_elapsed_minutes:.2f} 分鐘")
        print(f"\n💡 提示: 請檢查 Python 依賴是否已安裝（pip install -r requirements.txt）")
        print(f"💡 提示: 請檢查數據庫連接是否正常")
        print(f"💡 提示: 請查看上方錯誤信息以獲取詳細信息")
        print(f"{'='*60}\n")
        sys.exit(1)

if __name__ == '__main__':
    main()

