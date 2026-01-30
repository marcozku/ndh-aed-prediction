# NDH AED 預測系統 API 文檔

## 版本：v4.0.04

---

## 目錄

1. [概述](#概述)
2. [認證](#認證)
3. [數據格式](#數據格式)
4. [API 端點](#api-端點)
   - [實際數據](#實際數據)
   - [預測數據](#預測數據)
   - [準確度統計](#準確度統計)
   - [AI 分析](#ai-分析)
   - [模型訓練](#模型訓練)
   - [系統狀態](#系統狀態)
   - [學習系統](#學習系統)
5. [錯誤處理](#錯誤處理)
6. [速率限制](#速率限制)

---

## 概述

NDH AED 預測系統提供 RESTful API，用於急症室病人數量預測、數據管理和模型訓練。

**Base URL**: `https://your-domain.railway.app`

**時區**: 所有時間使用香港時間 (HKT, UTC+8)

---

## 認證

目前 API 不需要認證（內部系統）。未來版本將添加 API Key 認證。

---

## 數據格式

### 請求格式
- Content-Type: `application/json`
- 字符編碼: `UTF-8`

### 響應格式
```json
{
  "success": true,
  "data": {},
  "error": null
}
```

### 日期格式
- 標準格式: `YYYY-MM-DD` (例: `2026-01-30`)
- 時間戳: ISO 8601 格式

---

## API 端點

### 實際數據

#### 獲取實際數據
```http
GET /api/actual-data?start=YYYY-MM-DD&end=YYYY-MM-DD
```

**查詢參數**:
- `start` (可選): 開始日期
- `end` (可選): 結束日期

**響應**:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "date": "2026-01-30",
      "patient_count": 285,
      "source": "manual_upload",
      "notes": null,
      "created_at": "2026-01-30T10:00:00+08:00"
    }
  ]
}
```

#### 上傳實際數據
```http
POST /api/actual-data
Content-Type: application/json

{
  "date": "2026-01-30",
  "patient_count": 285,
  "source": "manual_upload",
  "notes": "正常工作日"
}
```

**批量上傳**:
```json
[
  {
    "date": "2026-01-30",
    "patient_count": 285
  },
  {
    "date": "2026-01-31",
    "patient_count": 290
  }
]
```

**響應**:
```json
{
  "success": true,
  "inserted": 2,
  "data": [...],
  "weatherAnalysis": "triggered"
}
```

#### 上傳 CSV 數據
```http
POST /api/upload-csv
Content-Type: application/json

{
  "csvData": "Date,Attendance\n2026-01-30,285\n2026-01-31,290"
}
```

---

### 預測數據

#### 獲取今日預測
```http
GET /api/future-predictions?days=1
```

**響應**:
```json
{
  "success": true,
  "data": [
    {
      "target_date": "2026-01-30",
      "predicted_count": 287,
      "ci80_low": 275,
      "ci80_high": 299,
      "ci95_low": 268,
      "ci95_high": 306,
      "model_version": "4.0.04",
      "weather_data": {...},
      "ai_factors": {...}
    }
  ]
}
```

#### 獲取未來 7 天預測
```http
GET /api/future-predictions?days=7
```

#### 觸發預測更新
```http
POST /api/trigger-prediction?source=manual
```

**查詢參數**:
- `source`: `manual` | `training` | `upload`

**響應**:
```json
{
  "success": true,
  "message": "預測更新完成（2.3秒）",
  "duration": 2.3,
  "source": "manual"
}
```

#### 獲取日內預測歷史
```http
GET /api/intraday-predictions?days=7&refresh=true
```

**查詢參數**:
- `days`: 查詢天數 (預設 7)
- `refresh`: 是否刷新 final_daily_predictions

**響應**:
```json
{
  "success": true,
  "data": [
    {
      "date": "2026-01-30",
      "predictions": [
        {
          "time": "2026-01-30T08:00:00+08:00",
          "predicted": 287,
          "ci80_low": 275,
          "ci80_high": 299,
          "source": "auto"
        }
      ],
      "finalPredicted": 287,
      "actual": null
    }
  ]
}
```

---

### 準確度統計

#### 獲取準確度統計
```http
GET /api/accuracy
```

**響應**:
```json
{
  "success": true,
  "data": {
    "total_comparisons": 150,
    "mean_absolute_error_pct": 1.17,
    "mean_error_pct": 0.05,
    "stddev_error_pct": 1.85,
    "ci80_accuracy_pct": 82.5,
    "ci95_accuracy_pct": 95.2,
    "earliest_date": "2025-08-01",
    "latest_date": "2026-01-30"
  }
}
```

#### 獲取比較數據
```http
GET /api/comparison?limit=100&refresh=true
```

**查詢參數**:
- `limit`: 返回記錄數 (預設 100)
- `refresh`: 是否刷新最近 7 天數據

**響應**:
```json
{
  "success": true,
  "data": [
    {
      "date": "2026-01-30",
      "actual": 285,
      "predicted": 287,
      "ci80_low": 275,
      "ci80_high": 299,
      "ci95_low": 268,
      "ci95_high": 306,
      "error": 2,
      "error_percentage": 0.70
    }
  ]
}
```

#### 獲取準確度歷史
```http
GET /api/accuracy-history?days=30
```

**查詢參數**:
- `days`: 查詢天數 (預設 30)

---

### AI 分析

#### 獲取 AI 因素分析
```http
GET /api/ai-analyze
```

**響應**:
```json
{
  "success": true,
  "factors": [
    {
      "factor": "天氣影響",
      "impact": 0.05,
      "description": "今日天氣晴朗，預計就診人數略低"
    }
  ],
  "summary": "綜合分析顯示...",
  "lastUpdate": "2026-01-30T08:00:00+08:00"
}
```

#### 強制重新分析
```http
POST /api/ai-analyze-range
Content-Type: application/json

{
  "startDate": "2026-01-01",
  "endDate": "2026-01-30",
  "force": true
}
```

#### 獲取 AI 狀態
```http
GET /api/ai-status
```

**響應**:
```json
{
  "connected": true,
  "provider": "anthropic",
  "model": "claude-3-5-sonnet-20241022",
  "available": true
}
```

---

### 模型訓練

#### 觸發模型訓練
```http
POST /api/train-models
Content-Type: application/json

{
  "force": false
}
```

**響應**:
```json
{
  "success": true,
  "message": "訓練已開始",
  "trainingId": "train_123456"
}
```

#### 獲取訓練狀態
```http
GET /api/training-status
```

**響應**:
```json
{
  "is_training": false,
  "last_training_date": "2026-01-30T08:00:00+08:00",
  "last_data_count": 500,
  "training_start_time": null,
  "last_training_output": "訓練完成，MAE: 2.85",
  "last_training_error": null
}
```

#### 停止訓練
```http
POST /api/stop-training
```

#### 獲取模型診斷
```http
GET /api/model-diagnostics
```

**響應**:
```json
{
  "success": true,
  "models": {
    "xgboost": true,
    "randomForest": false
  },
  "metrics": {
    "mae": 2.85,
    "rmse": 4.54,
    "mape": 1.17,
    "r2": 97.18
  },
  "python": {
    "available": true,
    "version": "3.11.0"
  }
}
```

---

### 系統狀態

#### 獲取數據庫狀態
```http
GET /api/db-status
```

**響應**:
```json
{
  "connected": true,
  "host": "postgres.railway.internal",
  "database": "railway",
  "tables": 15,
  "totalRecords": 5000
}
```

#### 獲取自動預測統計
```http
GET /api/auto-predict-stats
```

**響應**:
```json
{
  "stat_date": "2026-01-30",
  "today_count": 48,
  "last_run_time": "2026-01-30T08:00:00+08:00",
  "last_run_success": true,
  "last_run_duration": 2300,
  "total_success_count": 1500,
  "total_fail_count": 5
}
```

#### 獲取 Python 環境
```http
GET /api/python-env
```

**響應**:
```json
{
  "python3": {
    "available": true,
    "command": "python3",
    "version": "3.11.0"
  },
  "dependencies": {
    "available": true,
    "packages": ["xgboost", "pandas", "numpy", "scikit-learn"]
  }
}
```

#### 列出所有路由
```http
GET /api/list-routes
```

**響應**:
```json
{
  "success": true,
  "version": "4.0.04",
  "totalRoutes": 60,
  "routes": [
    "GET /api/actual-data",
    "POST /api/actual-data",
    ...
  ]
}
```

---

### 學習系統

#### 獲取學習記錄
```http
GET /api/learning/records?days=30
```

#### 獲取異常事件
```http
GET /api/learning/anomalies?days=30
```

#### 觸發學習更新
```http
POST /api/learning/update
Content-Type: application/json

{
  "date": "2026-01-30"
}
```

#### 運行學習調度器
```http
POST /api/learning/scheduler-run
```

---

### 天氣數據

#### 獲取當前 AQHI
```http
GET /api/aqhi-current
```

**響應**:
```json
{
  "success": true,
  "data": {
    "aqhi": 3,
    "level": "低",
    "timestamp": "2026-01-30T08:00:00+08:00"
  }
}
```

#### 獲取天氣相關性
```http
GET /api/weather-correlation
```

**響應**:
```json
{
  "success": true,
  "data": [...],
  "count": 100,
  "correlation": {
    "temperature": -0.15,
    "humidity": 0.08,
    "rainfall": 0.12
  }
}
```

#### 獲取月平均天氣
```http
GET /api/weather-monthly-averages
```

---

### 雙軌預測

#### 獲取雙軌摘要
```http
GET /api/dual-track/summary
```

**響應**:
```json
{
  "success": true,
  "summary": {
    "total_days": 30,
    "production_mae": 2.85,
    "experimental_mae": 2.65,
    "improvement_pct": 7.02,
    "win_rate_pct": 65.5
  }
}
```

#### 驗證雙軌預測
```http
POST /api/dual-track/validate
Content-Type: application/json

{
  "date": "2026-01-30"
}
```

---

## 錯誤處理

### 錯誤響應格式
```json
{
  "success": false,
  "error": "錯誤描述",
  "code": "ERROR_CODE"
}
```

### 常見錯誤碼

| 狀態碼 | 錯誤碼 | 說明 |
|--------|--------|------|
| 400 | BAD_REQUEST | 請求參數錯誤 |
| 404 | NOT_FOUND | 資源不存在 |
| 500 | INTERNAL_ERROR | 服務器內部錯誤 |
| 503 | SERVICE_UNAVAILABLE | 服務不可用（數據庫未連接） |

### 錯誤示例
```json
{
  "success": false,
  "error": "Database not configured",
  "code": "DB_NOT_CONFIGURED"
}
```

---

## 速率限制

目前沒有速率限制。未來版本將實施：
- 每分鐘 60 次請求
- 每小時 1000 次請求

---

## 最佳實踐

### 1. 日期範圍查詢
```javascript
// 獲取最近 30 天數據
const endDate = new Date().toISOString().split('T')[0];
const startDate = new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0];

fetch(`/api/actual-data?start=${startDate}&end=${endDate}`)
```

### 2. 錯誤處理
```javascript
try {
  const response = await fetch('/api/future-predictions?days=7');
  const result = await response.json();

  if (!result.success) {
    console.error('API Error:', result.error);
    return;
  }

  // 處理數據
  console.log(result.data);
} catch (error) {
  console.error('Network Error:', error);
}
```

### 3. 批量操作
```javascript
// 批量上傳實際數據
const bulkData = [
  { date: '2026-01-30', patient_count: 285 },
  { date: '2026-01-31', patient_count: 290 }
];

fetch('/api/actual-data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(bulkData)
});
```

### 4. 輪詢訓練狀態
```javascript
async function waitForTraining() {
  while (true) {
    const response = await fetch('/api/training-status');
    const status = await response.json();

    if (!status.is_training) {
      console.log('訓練完成');
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 5000)); // 等待 5 秒
  }
}
```

---

## 版本歷史

### v4.0.04 (2026-01-30)
- 添加雙軌預測 API
- 優化查詢性能
- 添加學習系統 API

### v3.2.01 (2026-01-20)
- Optuna 超參數優化
- 改進模型性能 (MAE: 2.85)

### v3.0.00 (2026-01-18)
- 持續學習系統
- 異常檢測
- 天氣預報整合

---

## 支援

如有問題或建議，請聯繫開發團隊。

**文檔版本**: 1.0.0
**最後更新**: 2026-01-30
