# 集成預測系統（Hybrid Ensemble）

基於 AI-AED-Algorithm-Specification.txt 實現的集成預測系統，結合 XGBoost + LSTM + Prophet 三個模型。

## 🎯 性能目標

- **MAE**: < 13 病人（5.2% MAPE）
- **方向準確度**: > 91%
- **95% CI 覆蓋率**: > 95%

## 📦 安裝依賴

```bash
cd python
pip install -r requirements.txt
```

## 🚀 快速開始

### 1. 訓練所有模型

```bash
cd python
python train_all_models.py
```

這將依次訓練：
- XGBoost 模型（~5-10 分鐘）
- LSTM 模型（~10-20 分鐘）
- Prophet 模型（~2-5 分鐘）

**注意**: 首次訓練需要從數據庫或 CSV 加載歷史數據。確保：
- 數據庫環境變數已設置（DATABASE_URL 或 PGHOST/PGUSER/PGPASSWORD/PGDATABASE）
- 或者有 CSV 文件在項目根目錄

### 2. 單獨訓練模型

```bash
# 訓練 XGBoost
python train_xgboost.py

# 訓練 LSTM
python train_lstm.py

# 訓練 Prophet
python train_prophet.py
```

### 3. 執行預測

```bash
# 預測特定日期
python predict.py 2025-12-25
```

輸出示例：
```json
{
  "prediction": 265.3,
  "ci80": {
    "low": 250.1,
    "high": 280.5
  },
  "ci95": {
    "low": 240.2,
    "high": 290.4
  },
  "individual": {
    "xgboost": 268.5,
    "lstm": 262.1,
    "prophet": 265.3
  },
  "weights_used": {
    "xgboost": 0.4,
    "lstm": 0.35,
    "prophet": 0.25
  }
}
```

## 📊 模型權重

根據算法規格文件，集成權重為：
- **XGBoost**: 40% - 捕捉複雜模式、非線性關係
- **LSTM**: 35% - 學習序列、處理多尺度季節性
- **Prophet**: 25% - 可解釋性、處理制度變化

## 🔧 從 Node.js 調用

```javascript
const { EnsemblePredictor } = require('./modules/ensemble-predictor');

const predictor = new EnsemblePredictor();

// 檢查模型狀態
const status = predictor.getModelStatus();
console.log(status);

// 執行預測
try {
    const result = await predictor.predict('2025-12-25');
    console.log('預測結果:', result);
} catch (error) {
    console.error('預測失敗:', error.message);
}
```

## 📁 文件結構

```
python/
├── requirements.txt          # Python 依賴
├── feature_engineering.py   # 特徵工程模組
├── train_xgboost.py         # XGBoost 訓練
├── train_lstm.py            # LSTM 訓練
├── train_prophet.py         # Prophet 訓練
├── train_all_models.py      # 訓練所有模型
├── ensemble_predict.py      # 集成預測核心邏輯
├── predict.py               # 預測接口
└── models/                  # 訓練好的模型（自動創建）
    ├── xgboost_model.json
    ├── xgboost_features.json
    ├── lstm_model.h5
    ├── lstm_scaler_X.pkl
    ├── lstm_scaler_y.pkl
    ├── lstm_features.json
    ├── prophet_model.pkl
    └── *_metrics.json       # 各模型的評估指標
```

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

## ⚠️ 注意事項

1. **數據要求**: 至少需要 365 天的歷史數據才能有效訓練
2. **LSTM 序列長度**: 默認使用 60 天滑動窗口
3. **模型大小**: 訓練後的模型文件約 50-200 MB
4. **訓練時間**: 完整訓練需要 15-35 分鐘（取決於數據量和硬件）
5. **Python 版本**: 需要 Python 3.8+

## 🔄 重新訓練

當有新數據時，重新運行訓練腳本：

```bash
python train_all_models.py
```

建議每週或每月重新訓練一次，以適應數據分佈變化。

## 📈 性能監控

訓練完成後，查看各模型的評估指標：

```bash
cat python/models/xgboost_metrics.json
cat python/models/lstm_metrics.json
cat python/models/prophet_metrics.json
```

## 🐛 故障排除

### 模型未找到
```
錯誤: 模型未訓練。請先運行 python/train_all_models.py
```
**解決**: 運行訓練腳本

### 數據不足
```
錯誤: 數據不足以創建序列
```
**解決**: 確保有至少 365 天的歷史數據

### Python 依賴缺失
```
ModuleNotFoundError: No module named 'xgboost'
```
**解決**: 運行 `pip install -r requirements.txt`

### 數據庫連接失敗
系統會自動嘗試從 CSV 文件加載數據。確保 CSV 文件在項目根目錄。

## 📚 參考文檔

- `ai/AI-AED-Algorithm-Specification.txt` - 完整算法規格
- `RESEARCH_BASED_IMPROVEMENTS.md` - 研究基礎改進
- `ALGORITHM_UPGRADE_SUMMARY.md` - 算法升級總結

