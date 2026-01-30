# NDH AED 預測系統架構文檔

## 版本：v4.0.04

---

## 目錄

1. [系統概述](#系統概述)
2. [架構設計](#架構設計)
3. [技術棧](#技術棧)
4. [核心模組](#核心模組)
5. [數據流](#數據流)
6. [部署架構](#部署架構)
7. [性能優化](#性能優化)
8. [安全性](#安全性)

---

## 系統概述

NDH AED 預測系統是一個基於機器學習的急症室病人數量預測系統，提供：
- 實時預測（今日 + 未來 7 天）
- 持續學習和自動優化
- 多源數據融合（XGBoost + AI + 天氣）
- 雙軌預測驗證

### 核心指標
- **MAE**: 2.85 人 (誤差率 1.17%)
- **R²**: 97.18%
- **預測頻率**: 每 30 分鐘自動更新
- **數據量**: 500+ 天歷史數據

---

## 架構設計

### 整體架構

```
┌─────────────────────────────────────────────────────────────┐
│                         用戶層                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Web UI   │  │ Mobile   │  │  PWA     │  │  API     │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      應用層 (Node.js)                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  server.js (5816 行)                                  │  │
│  │  - API 路由 (60+ 端點)                                │  │
│  │  - 請求處理                                           │  │
│  │  - 錯誤處理                                           │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  前端模組 (14 個)                                      │  │
│  │  - api.js, datetime.js, status.js                    │  │
│  │  - weather.js, learning.js, ui-enhancements.js       │  │
│  │  - ensemble-predictor.js, pragmatic-bayesian.js      │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    業務邏輯層 (Python)                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  機器學習模型 (77 個 Python 腳本)                      │  │
│  │  - XGBoost 預測引擎                                   │  │
│  │  - 特徵工程                                           │  │
│  │  - 模型訓練和優化                                      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  持續學習系統                                          │  │
│  │  - continuous_learner.py                             │  │
│  │  - anomaly_detector.py                               │  │
│  │  - weather_impact_learner.py                         │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    數據層 (PostgreSQL)                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  核心數據表 (15+ 表)                                   │  │
│  │  - actual_data (實際數據)                             │  │
│  │  - predictions (預測數據)                             │  │
│  │  - daily_predictions (日內預測)                       │  │
│  │  - final_daily_predictions (最終預測)                 │  │
│  │  - reliability_state (可靠度狀態)                     │  │
│  │  - model_metrics (模型指標)                           │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    外部服務層                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ HKO API  │  │Claude AI │  │ Railway  │  │  GitHub  │   │
│  │ (天氣)   │  │ (分析)   │  │ (部署)   │  │ (版本)   │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 技術棧

### 後端
- **運行時**: Node.js 18+
- **框架**: 原生 HTTP Server (無框架)
- **數據庫**: PostgreSQL 14+
- **連接池**: pg (max: 20 connections)
- **Python**: 3.11+ (機器學習)

### 前端
- **框架**: Vanilla JavaScript (ES6 模組)
- **UI 庫**: 無 (原生實現)
- **圖表**: Chart.js 4.4.0
- **樣式**: 8197 行自定義 CSS (Apple 風格)
- **PWA**: Service Worker + Manifest

### 機器學習
- **核心**: XGBoost 2.0+
- **數據處理**: Pandas, NumPy
- **優化**: Optuna (超參數優化)
- **特徵**: 10 個最佳特徵 (EWMA7/14 為主)

### 部署
- **平台**: Railway
- **CI/CD**: Git Push 自動部署
- **環境**: Production (單實例)

---

## 核心模組

### 1. 預測引擎 (modules/ensemble-predictor.js)

```javascript
// Pragmatic Bayesian 融合
prediction = w_xgb * xgb_pred + w_ai * ai_pred + w_weather * weather_pred

// 權重動態調整（可靠度學習）
weights = f(historical_accuracy)
```

**特點**:
- 多源融合（XGBoost + AI + 天氣）
- 動態權重調整
- 信賴區間計算 (80%, 95%)

### 2. 持續學習系統 (python/continuous_learner.py)

```python
# 每日自動學習流程
1. 獲取昨日實際數據
2. 計算預測誤差
3. 更新可靠度權重
4. 檢測異常事件
5. 觸發重新訓練（如需要）
```

**觸發條件**:
- 新數據到達
- 誤差超過閾值
- 異常事件檢測

### 3. 平滑算法 (modules/prediction-smoother.js)

8 種平滑方法：
1. **Simple Average**: 簡單平均
2. **EWMA**: 指數加權移動平均
3. **Confidence Weighted**: 信賴度加權
4. **Time Window Weighted**: 時間窗口加權
5. **Trimmed Mean**: 修剪平均
6. **Variance Filtered**: 方差過濾
7. **Kalman Filter**: 卡爾曼濾波
8. **Ensemble Meta**: 集成元學習

### 4. 數據庫層 (database.js - 2071 行)

**核心功能**:
- 連接池管理 (max: 20)
- 查詢重試機制 (指數退避)
- UTF-8 編碼處理
- HKT 時區處理
- 事務管理

**性能優化**:
- 11 個索引 (新增)
- 2 個性能視圖
- 查詢快取策略

---

## 數據流

### 預測生成流程

```
1. 觸發預測
   ├─ 自動觸發 (每 30 分鐘)
   ├─ 手動觸發 (用戶刷新)
   └─ 訓練後觸發

2. 數據準備
   ├─ 獲取歷史數據 (actual_data)
   ├─ 獲取天氣數據 (HKO API)
   └─ 獲取 AI 因素 (Claude API)

3. 特徵工程
   ├─ EWMA7/14 計算
   ├─ Lag 特徵 (1, 7 天)
   ├─ 星期效應編碼
   └─ 天氣特徵整合

4. 模型預測
   ├─ XGBoost 基礎預測
   ├─ AI 因子調整
   └─ 天氣因子調整

5. Bayesian 融合
   ├─ 獲取可靠度權重
   ├─ 加權平均
   └─ 信賴區間計算

6. 平滑處理
   ├─ 8 種平滑方法
   ├─ 自適應選擇
   └─ 最終預測生成

7. 存儲結果
   ├─ daily_predictions (實時)
   ├─ intraday_predictions (歷史)
   └─ final_daily_predictions (最終)
```

### 學習更新流程

```
1. 實際數據到達
   ├─ 用戶上傳 CSV
   ├─ API 手動添加
   └─ 自動導入

2. 準確度計算
   ├─ 獲取對應預測
   ├─ 計算誤差 (MAE, MAPE)
   └─ 更新 prediction_accuracy

3. 可靠度學習
   ├─ 分析各源誤差
   ├─ 更新權重
   └─ 存儲 reliability_history

4. 異常檢測
   ├─ 統計分析 (Z-score)
   ├─ 分類異常類型
   └─ 記錄 anomaly_events

5. 觸發重訓練
   ├─ 檢查觸發條件
   ├─ 執行訓練腳本
   └─ 更新模型文件
```

---

## 部署架構

### Railway 部署

```
GitHub Repository
      │
      │ git push
      ▼
Railway Platform
      │
      ├─ Build (Nixpacks)
      │  ├─ npm install
      │  ├─ pip install -r python/requirements.txt
      │  └─ 構建完成
      │
      ├─ Deploy
      │  ├─ 啟動 server.js
      │  ├─ 連接 PostgreSQL
      │  └─ 健康檢查
      │
      └─ Runtime
         ├─ Node.js 18
         ├─ Python 3.11
         └─ PostgreSQL 14
```

### 環境變數

```bash
# 數據庫
DATABASE_URL=postgresql://...
PGHOST=postgres.railway.internal
PGUSER=postgres
PGPASSWORD=***
PGDATABASE=railway
PGPORT=5432

# AI 服務
ANTHROPIC_API_KEY=***

# 應用
PORT=3001
NODE_ENV=production
MODEL_VERSION=4.0.04
```

### 文件結構

```
ndh-aed-prediction/
├── server.js (5816 行)          # 主服務器
├── database.js (2071 行)        # 數據庫層
├── app.js                       # 前端入口
├── prediction.js (11194 行)     # 預測邏輯
├── styles.css (8197 行)         # 樣式系統
├── index.html (971 行)          # 主頁面
│
├── modules/ (14 個模組)
│   ├── api.js                   # API 調用
│   ├── ensemble-predictor.js   # 集成預測
│   ├── pragmatic-bayesian.js   # Bayesian 融合
│   ├── prediction-smoother.js  # 平滑算法
│   ├── auto-train-manager.js   # 自動訓練
│   └── ...
│
├── python/ (77 個腳本)
│   ├── continuous_learner.py   # 持續學習
│   ├── anomaly_detector.py     # 異常檢測
│   ├── train_all_models.py     # 模型訓練
│   └── ...
│
├── models/
│   ├── xgboost_opt10_model.json # XGBoost 模型
│   ├── feature_names.json       # 特徵名稱
│   └── scaler.pkl               # 標準化器
│
├── migrations/
│   ├── 001_initial.sql
│   ├── 004_continuous_learning.sql
│   └── 005_performance_indexes.sql
│
└── docs/
    ├── API_DOCUMENTATION.md
    ├── ARCHITECTURE.md
    └── DEPLOYMENT.md
```

---

## 性能優化

### 數據庫優化

1. **索引策略** (005_performance_indexes.sql)
   - 11 個新增索引
   - 降序索引（最新數據優先）
   - 複合索引（多欄位查詢）
   - 部分索引（條件查詢）

2. **查詢優化**
   - 連接池 (max: 20)
   - 查詢重試 (指數退避)
   - 預編譯語句
   - 批量操作

3. **快取策略**
   - Service Worker (前端)
   - AI 因素快取 (24 小時)
   - 模型指標快取

### 前端優化

1. **代碼分割**
   - ES6 模組化
   - 動態載入
   - 懶加載圖表

2. **資源優化**
   - 圖片壓縮
   - CSS 最小化
   - Gzip 壓縮

3. **渲染優化**
   - 虛擬滾動
   - 防抖/節流
   - RequestAnimationFrame

### 後端優化

1. **並發處理**
   - 異步 I/O
   - Promise.all 並行
   - Worker Threads (未來)

2. **記憶體管理**
   - 流式處理
   - 及時釋放
   - 垃圾回收優化

---

## 安全性

### 數據安全

1. **SQL 注入防護**
   - 參數化查詢
   - 輸入驗證
   - ORM 使用

2. **XSS 防護**
   - 輸出編碼
   - CSP 頭部
   - DOM 淨化

3. **CSRF 防護**
   - SameSite Cookie
   - CSRF Token (未來)

### 訪問控制

1. **認證** (未來)
   - API Key
   - JWT Token
   - OAuth 2.0

2. **授權** (未來)
   - RBAC
   - 權限檢查
   - 審計日誌

### 數據加密

1. **傳輸加密**
   - HTTPS/TLS
   - WSS (WebSocket)

2. **存儲加密**
   - 敏感數據加密
   - 密鑰管理

---

## 監控和日誌

### 日誌系統

```javascript
// 結構化日誌
console.log('📊 預測生成', {
  date: '2026-01-30',
  predicted: 287,
  duration: 2.3,
  source: 'auto'
});
```

### 性能監控 (未來)

- APM (New Relic / Datadog)
- 錯誤追蹤 (Sentry)
- 用戶分析 (Google Analytics)

---

## 擴展性

### 水平擴展 (未來)

```
Load Balancer
      │
      ├─ App Instance 1
      ├─ App Instance 2
      └─ App Instance 3
           │
           ▼
    PostgreSQL (Primary)
           │
           ├─ Read Replica 1
           └─ Read Replica 2
```

### 微服務化 (未來)

```
API Gateway
      │
      ├─ Prediction Service
      ├─ Training Service
      ├─ Learning Service
      └─ Analytics Service
```

---

## 版本歷史

### v4.0.04 (2026-01-30)
- 性能優化（11 個新索引）
- API 文檔完善
- 架構文檔創建

### v3.2.01 (2026-01-20)
- Optuna 優化 (MAE: 2.85)
- 10 個最佳特徵

### v3.0.00 (2026-01-18)
- 持續學習系統
- 異常檢測
- 天氣預報整合

---

## 參考資料

- [API 文檔](./API_DOCUMENTATION.md)
- [部署指南](./DEPLOYMENT.md)
- [開發指南](./DEVELOPMENT.md)

**文檔版本**: 1.0.0
**最後更新**: 2026-01-30
