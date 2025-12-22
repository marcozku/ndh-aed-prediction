"""
訓練所有模型的主腳本
依次訓練 XGBoost、LSTM、Prophet，然後評估集成性能
"""
import subprocess
import sys
import os

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
    
    result = subprocess.run(
        [sys.executable, script_path],
        cwd=script_dir,  # 在 python 目錄下運行
        capture_output=True,
        text=True
    )
    
    print(result.stdout)
    if result.stderr:
        print("錯誤輸出:", result.stderr)
    
    if result.returncode != 0:
        print(f"❌ {script_name} 訓練失敗")
        return False
    else:
        print(f"✅ {script_name} 訓練完成")
        return True

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
    for script in scripts:
        try:
            success = run_training_script(script)
            results[script] = success
        except Exception as e:
            print(f"❌ 執行 {script} 時發生異常: {e}")
            results[script] = False
    
    # 總結
    print(f"\n{'='*60}")
    print("訓練總結:")
    print(f"{'='*60}")
    for script, success in results.items():
        status = "✅ 成功" if success else "❌ 失敗"
        print(f"  {script}: {status}")
    
    # 檢查模型文件是否存在
    print(f"\n{'='*60}")
    print("模型文件檢查:")
    print(f"{'='*60}")
    model_files = {
        'XGBoost': ['xgboost_model.json', 'xgboost_features.json'],
        'LSTM': ['lstm_model.h5', 'lstm_scaler_X.pkl', 'lstm_scaler_y.pkl'],
        'Prophet': ['prophet_model.pkl']
    }
    
    all_files_exist = True
    for model_name, files in model_files.items():
        for file in files:
            file_path = os.path.join(models_dir, file)
            exists = os.path.exists(file_path)
            status = "✅" if exists else "❌"
            print(f"  {status} {file}")
            if not exists:
                all_files_exist = False
    
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
    
    if all_success and all_files_exist:
        print("\n🎉 所有模型訓練完成且文件完整！")
        print("現在可以使用 ensemble_predict.py 進行預測")
        sys.exit(0)
    else:
        print("\n⚠️  部分模型訓練失敗或文件缺失，請檢查錯誤信息")
        print("💡 提示: 請檢查 Python 依賴是否已安裝（pip install -r requirements.txt）")
        print("💡 提示: 請檢查數據庫連接是否正常")
        sys.exit(1)

if __name__ == '__main__':
    main()

