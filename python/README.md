# XGBoost 預測系統 v3.0.10

基於 AI-AED-Algorithm-Specification.txt 實現的 XGBoost 預測系統，使用單一 XGBoost 模型進行預測。

**最後更新**: 2026-01-02 23:30 HKT

## 🎯 當前性能

- **R²**: 95.8%
- **MAE**: 4.01 病人（1.59% MAPE）
- **方向準確度**: > 91%
- **95% CI 覆蓋率**: > 95%
- **特徵數**: 36+ 個特徵（含 21 個天氣特徵）

## 🚀 v2.9.62 新特性

- **全面 XGBoost**：所有前端預測（今日、7天、30天）都使用 XGBoost 模型
- **伺服器自動預測**：每 30 分鐘生成 31 天 XGBoost 預測
- **元數據整合**：保留因子分解顯示，同時使用 XGBoost 預測值

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

這將訓練：
- XGBoost 模型（~5-10 分鐘）

**注意**: 首次訓練需要從數據庫或 CSV 加載歷史數據。確保：
- 數據庫環境變數已設置（DATABASE_URL 或 PGHOST/PGUSER/PGPASSWORD/PGDATABASE）
- 或者有 CSV 文件在項目根目錄

### 2. 訓練 XGBoost 模型

```bash
# 訓練 XGBoost
python train_xgboost.py
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
    "xgboost": 265.3
  }
}
```

## 📊 模型說明

- **XGBoost**: 100% - 梯度提升樹模型，捕捉複雜模式、非線性關係

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
├── requirements.txt              # Python 依賴
├── feature_engineering.py        # 特徵工程模組（50+ 特徵）
├── train_xgboost.py              # XGBoost 訓練
├── train_all_models.py           # 訓練 XGBoost 模型
├── ensemble_predict.py           # XGBoost 預測核心邏輯
├── predict.py                    # 預測接口
├── weather_history.csv           # HKO 歷史天氣數據（1988-至今）
├── weather_warnings_history.csv  # 颱風/暴雨/警告歷史
└── models/                       # 訓練好的模型（自動創建）
    ├── xgboost_model.json
    ├── xgboost_features.json
    └── xgboost_metrics.json      # 評估指標
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

### 天氣特徵（21個）- v3.0.10 新增

**基礎天氣（HKO 歷史數據）**：
- Weather_Mean_Temp, Max_Temp, Min_Temp - 日平均/最高/最低氣溫
- Weather_Temp_Range - 日溫差
- Weather_Is_Very_Hot, Is_Hot - 酷熱/炎熱日
- Weather_Is_Cold, Is_Very_Cold - 寒冷/嚴寒日
- Weather_Temp_Deviation - 溫度偏離月平均
- Weather_Has_Data - 是否有天氣數據

**溫度變化效應**：
- Weather_Temp_Change - 今天 vs 昨天溫度變化
- Weather_Temp_Drop_5 - 驟降 ≥5°C（研究顯示增加呼吸道疾病）
- Weather_Temp_Rise_5 - 驟升 ≥5°C（研究顯示增加中暑風險）

**極端天氣事件**：
- Typhoon_Signal - 颱風信號（0/1/3/8/10）
- Typhoon_T3_Plus - T3 或以上
- Typhoon_T8_Plus - 8號風球或以上
- Rainstorm_Warning - 暴雨警告（0/1/2/3）
- Rainstorm_Red_Plus - 紅雨或以上
- Rainstorm_Black - 黑色暴雨
- Hot_Warning - 酷熱天氣警告
- Cold_Warning - 寒冷天氣警告

**數據來源**：
- `weather_history.csv` - HKO 打鼓嶺站（1988年至今）
- `weather_warnings_history.csv` - 颱風/暴雨/警告歷史

## ⚠️ 注意事項

1. **數據要求**: 至少需要 365 天的歷史數據才能有效訓練
2. **模型大小**: 訓練後的模型文件約 5-20 MB
3. **訓練時間**: 訓練需要 5-10 分鐘（取決於數據量和硬件）
4. **Python 版本**: 需要 Python 3.8+

## 🔄 重新訓練

當有新數據時，重新運行訓練腳本：

```bash
python train_all_models.py
```

建議每週或每月重新訓練一次，以適應數據分佈變化。

## 📈 性能監控

訓練完成後，查看 XGBoost 模型的評估指標：

```bash
cat python/models/xgboost_metrics.json
```

## 🐛 故障排除

### 模型未找到
```
錯誤: 模型未訓練。請先運行 python/train_all_models.py
```
**解決**: 運行訓練腳本

### 數據不足
```
錯誤: 數據不足以訓練模型
```
**解決**: 確保有至少 365 天的歷史數據

### Python 依賴缺失
```
ModuleNotFoundError: No module named 'xgboost'
```
**解決**: 運行 `pip install -r requirements.txt`

### 數據庫連接失敗
系統會自動嘗試從 CSV 文件加載數據。確保 CSV 文件在項目根目錄。

### XGBoost 模型版本不兼容
```
錯誤: _estimator_type undefined
```
**解決**: v2.9.55 已修復，使用原生 `xgb.Booster()` 加載模型

### JSON 解析失敗
```
錯誤: Unexpected token ✅ in JSON at position 0
```
**解決**: v2.9.56 已修復，所有狀態訊息輸出到 stderr

## 📚 參考文檔

- `ai/AI-AED-Algorithm-Specification.txt` - 完整算法規格
- `RESEARCH_BASED_IMPROVEMENTS.md` - 研究基礎改進
- `ALGORITHM_UPGRADE_SUMMARY.md` - 算法升級總結

