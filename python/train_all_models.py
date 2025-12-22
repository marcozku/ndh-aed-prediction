"""
訓練所有模型的主腳本
依次訓練 XGBoost、LSTM、Prophet，然後評估集成性能
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
    """運行訓練腳本"""
    print(f"\n{'='*60}")
    print(f"開始訓練: {script_name}")
    print(f"{'='*60}\n")
    
    # 確保在 python 目錄下運行
    script_dir = os.path.dirname(os.path.abspath(__file__))
    script_path = os.path.join(script_dir, script_name)
    
    print(f"工作目錄: {script_dir}")
    print(f"腳本路徑: {script_path}")
    
    # 對於 LSTM 訓練，設置環境變數以強制使用 CPU
    env = os.environ.copy()
    if 'train_lstm' in script_name:
        print("🔧 為 LSTM 訓練設置 CPU-only 環境變數...")
        env['CUDA_VISIBLE_DEVICES'] = '-1'
        env['TF_CPP_MIN_LOG_LEVEL'] = '2'
        env['TF_USE_GPU'] = '0'
        env['TF_FORCE_GPU_ALLOW_GROWTH'] = 'false'
        env['TF_GPU_ALLOCATOR'] = ''
        # 完全禁用 XLA（防止 XLA 嘗試初始化 CUDA）
        env['TF_XLA_FLAGS'] = '--tf_xla_cpu_global_jit=false --tf_xla_enable_xla_devices=false'
        env['XLA_FLAGS'] = '--xla_gpu_force_compilation_parallelism=1'
        env['TF_DISABLE_JIT'] = '1'
        env['TF_DISABLE_CUDA'] = '1'
        print("✅ 環境變數已設置（強制 CPU-only 模式，XLA 已禁用）")
    
    start_time = time.time()
    
    result = subprocess.run(
        [sys.executable, script_path],
        cwd=script_dir,  # 在 python 目錄下運行
        capture_output=True,
        text=True,
        env=env  # 使用修改後的環境變數
    )
    
    elapsed_time = time.time() - start_time
    elapsed_minutes = elapsed_time / 60
    
    print(result.stdout)
    if result.stderr:
        print("錯誤輸出:", result.stderr)
    
    # 解析性能指標
    metrics = parse_model_metrics(result.stdout)
    
    if result.returncode != 0:
        print(f"\n❌ {script_name} 訓練失敗")
        print(f"⏱️  訓練時間: {elapsed_minutes:.2f} 分鐘")
        if result.stderr:
            print(f"❌ 錯誤信息: {result.stderr[:500]}")
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
    
    print("🚀 開始訓練所有模型...")
    print("這將依次訓練 XGBoost、LSTM 和 Prophet 模型")
    print("預計需要 10-30 分鐘（取決於數據量和硬件）\n")
    
    scripts = [
        'train_xgboost.py',
        'train_lstm.py',
        'train_prophet.py'
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
        'XGBoost': ['xgboost_model.json', 'xgboost_features.json', 'xgboost_metrics.json'],
        'LSTM': ['lstm_model.h5', 'lstm_scaler_X.pkl', 'lstm_scaler_y.pkl', 'lstm_features.json', 'lstm_params.json', 'lstm_metrics.json'],
        'Prophet': ['prophet_model.pkl', 'prophet_metrics.json']
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
        print(f"\n💡 現在可以使用 ensemble_predict.py 進行預測")
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

