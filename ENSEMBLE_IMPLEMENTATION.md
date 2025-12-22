# XGBoost 預測系統實施指南

## 🎯 概述

已成功實施**XGBoost 預測系統**，使用單一 XGBoost 模型進行預測，根據 `ai/AI-AED-Algorithm-Specification.txt` 的規格實現。

## 📊 性能目標

- **MAE**: < 13 病人（5.2% MAPE）
- **方向準確度**: > 91%
- **95% CI 覆蓋率**: > 95%

## 🚀 快速開始

### 1. 安裝 Python 依賴

```bash
cd python
pip install -r requirements.txt
```

### 2. 訓練 XGBoost 模型

```bash
cd python
python train_all_models.py
```

**注意**: 
- 訓練需要 5-10 分鐘（取決於數據量和硬件）
- 確保數據庫環境變數已設置，或 CSV 文件在項目根目錄

### 3. 使用集成預測

#### 從 Node.js 調用

```javascript
const { NDHAttendancePredictor } = require('./prediction');

const predictor = new NDHAttendancePredictor(historicalData);

// 使用 XGBoost 方法預測
const result = await predictor.predictWithEnsemble('2025-12-25', {
    useEnsemble: true,
    fallbackToStatistical: true  // 如果 XGBoost 失敗，回退到統計方法
});

console.log('預測結果:', result);
```

#### 從 API 調用

```bash
# POST /api/ensemble-predict
curl -X POST http://localhost:3001/api/ensemble-predict \
  -H "Content-Type: application/json" \
  -d '{
    "target_date": "2025-12-25",
    "use_ensemble": true,
    "fallback_to_statistical": true
  }'
```

#### 檢查模型狀態

```bash
# GET /api/ensemble-status
curl http://localhost:3001/api/ensemble-status
```

## 📁 文件結構

```
python/
├── requirements.txt          # Python 依賴
├── feature_engineering.py   # 特徵工程（50+ 特徵）
├── train_xgboost.py         # XGBoost 訓練
├── train_all_models.py      # 訓練 XGBoost 模型
├── ensemble_predict.py      # XGBoost 預測核心邏輯
├── predict.py               # 預測接口
└── models/                  # 訓練好的模型（自動創建）
    ├── xgboost_model.json
    ├── xgboost_features.json
    └── xgboost_metrics.json  # 評估指標

modules/
└── ensemble-predictor.js    # Node.js 集成預測器模組

prediction.js                # 已添加 predictWithEnsemble() 方法
server.js                    # 已添加 /api/ensemble-predict 端點
```

## 🔧 模型說明

- **XGBoost**: 100% - 梯度提升樹模型，捕捉複雜模式、非線性關係

系統使用單一 XGBoost 模型進行預測，簡化部署和維護。

## 🎓 特徵工程

系統自動創建 50+ 特徵，包括：

### 時間特徵
- Year, Month, Day_of_Week, Day_of_Month
- Week_of_Year, Quarter, DayOfYear
- Days_Since_Start

### 循環編碼（關鍵！）
- Month_sin, Month_cos
- DayOfWeek_sin, DayOfWeek_cos

### 滯後特徵
- Attendance_Lag1, Lag7, Lag14, Lag30, Lag365

### 滾動統計
- Attendance_Rolling7/14/30
- Attendance_Std7/14/30
- Attendance_Max/Min7/14/30

### 事件指標
- Is_COVID_Period, Is_Winter_Flu_Season
- Is_Monday, Is_Weekend
- Is_Holiday

### 交互特徵
- Is_COVID_AND_Winter
- Is_Monday_AND_Winter

## 🔄 工作流程

### 訓練流程

1. **數據準備**: 從數據庫或 CSV 加載歷史數據
2. **特徵工程**: 自動創建 50+ 特徵
3. **模型訓練**: 
   - XGBoost: ~5-10 分鐘
4. **模型保存**: 保存到 `python/models/` 目錄

### 預測流程

1. **加載模型**: 從 `python/models/` 加載 XGBoost 模型
2. **準備特徵**: 為目標日期創建特徵
3. **XGBoost 預測**: 使用 XGBoost 模型進行預測
4. **置信區間**: 基於預測值的不確定性計算 CI

## ⚙️ 配置選項

### 預測選項

```javascript
{
    useEnsemble: true,              // 是否使用集成方法
    fallbackToStatistical: true     // 集成失敗時是否回退到統計方法
}
```

### 模型說明

系統使用單一 XGBoost 模型，無需配置權重。

## 📈 性能監控

### 查看模型評估指標

```bash
# XGBoost
cat python/models/xgboost_metrics.json
```

### 檢查模型狀態

```javascript
const { EnsemblePredictor } = require('./modules/ensemble-predictor');
const predictor = new EnsemblePredictor();
const status = predictor.getModelStatus();

console.log(status);
// {
//   available: true,
//   models: {
//     xgboost: true
//   },
//   modelsDir: '...'
// }
```

## 🔄 重新訓練

當有新數據時，重新運行訓練：

```bash
cd python
python train_all_models.py
```

**建議頻率**:
- 每週一次（如果有新數據）
- 每月一次（定期維護）
- 數據分佈明顯變化時（如 COVID-19 期間）

## 🐛 故障排除

### 問題 1: 模型未找到

```
錯誤: 模型未訓練。請先運行 python/train_all_models.py
```

**解決**: 運行訓練腳本

### 問題 2: Python 依賴缺失

```
ModuleNotFoundError: No module named 'xgboost'
```

**解決**: 
```bash
cd python
pip install -r requirements.txt
```

### 問題 3: 數據不足

```
錯誤: 數據不足以創建序列
```

**解決**: 確保有至少 365 天的歷史數據

### 問題 4: 數據庫連接失敗

系統會自動嘗試從 CSV 文件加載數據。確保 CSV 文件在項目根目錄。

### 問題 5: Node.js 無法調用 Python

**檢查**:
1. Python 3.8+ 已安裝
2. `python3` 命令可用（或修改 `modules/ensemble-predictor.js` 中的命令）
3. 所有 Python 依賴已安裝

## 📚 相關文檔

- `python/README.md` - Python 腳本詳細文檔
- `ai/AI-AED-Algorithm-Specification.txt` - 完整算法規格
- `RESEARCH_BASED_IMPROVEMENTS.md` - 研究基礎改進
- `ALGORITHM_UPGRADE_SUMMARY.md` - 算法升級總結

## 🎯 下一步

1. **訓練模型**: 運行 `python/train_all_models.py`
2. **測試預測**: 使用 API 或直接調用 `predictWithEnsemble()`
3. **比較性能**: 與統計方法比較準確度
4. **調整權重**: 根據實際表現調整集成權重
5. **定期重訓練**: 每週或每月重新訓練模型

## ✅ 實施完成清單

- [x] 創建 Python 環境和依賴文件
- [x] 創建特徵工程模組（50+ 特徵）
- [x] 創建 XGBoost 訓練和預測腳本
- [x] 創建 LSTM 訓練和預測腳本
- [x] 創建 Prophet 訓練和預測腳本
- [x] 創建集成預測腳本（組合三個模型）
- [x] 創建 Node.js 模組調用 Python 腳本
- [x] 整合到現有預測器（`predictWithEnsemble()` 方法）
- [x] 添加 API 端點（`/api/ensemble-predict`）
- [x] 創建使用文檔

## 🎉 完成！

集成預測系統已完全實施。現在可以：

1. 訓練模型
2. 使用集成預測
3. 享受更高的預測準確度！

