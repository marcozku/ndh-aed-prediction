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
    
    result = subprocess.run(
        [sys.executable, script_name],
        cwd=os.path.dirname(os.path.abspath(__file__)),
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
        success = run_training_script(script)
        results[script] = success
    
    # 總結
    print(f"\n{'='*60}")
    print("訓練總結:")
    print(f"{'='*60}")
    for script, success in results.items():
        status = "✅ 成功" if success else "❌ 失敗"
        print(f"  {script}: {status}")
    
    all_success = all(results.values())
    if all_success:
        print("\n🎉 所有模型訓練完成！")
        print("現在可以使用 ensemble_predict.py 進行預測")
    else:
        print("\n⚠️  部分模型訓練失敗，請檢查錯誤信息")
        sys.exit(1)

if __name__ == '__main__':
    main()

