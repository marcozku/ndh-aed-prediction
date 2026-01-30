# 當前任務

## 已完成

- [x] 特徵選擇測試 - 找出最佳 10 個特徵
- [x] 測試額外特徵組 (天氣/流感/AI)
- [x] 確認基線 10 特徵為最佳組合
- [x] 訓練最佳 10 特徵 XGBoost 模型
- [x] 更新 ensemble-predictor.js 支持 opt10 模型
- [x] 更新版本到 3.2.00
- [x] 推送到 GitHub
- [x] Railway 自動部署 (觸發中)
- [x] Optuna 超參數優化 (30 trials)
- [x] 測試 XGBoost vs RF vs Ensemble
- [x] 訓練 v3.2.01 模型 (MAE: 2.85, 改善 9.2%)
- [x] 更新 package.json 到 v3.2.01
- [x] 更新 VERSION_LOG.md
- [x] 更新 algorithm_timeline.json
- [x] 更新 ensemble-predictor.js 註解
- [x] **v4.0.07 UI 優化** (2026-01-20)
  - [x] 手機版漢堡菜單（10 個導航項優化）
  - [x] 空狀態插圖設計（浮動動畫）
  - [x] 微交互動畫增強（懸停、點擊、滑入等）
  - [x] 圖表手機版響應式（已優化）
  - [x] API 響應格式統一（已完成）

---

## 全面優化執行 (2026-01-30)

### P0 - 緊急修復（執行中）
- [x] 檢查 Railway 部署狀態
- [x] 檢查現有數據庫索引（5個已存在）
- [x] 添加缺失的數據庫索引（11個新索引）
- [x] 創建數據庫性能優化腳本（migrations/005_performance_indexes.sql）
- [x] 創建性能視圖（v_recent_accuracy, v_model_performance）
- [ ] 自動運行數據庫遷移到 Railway

### P1 - 重要優化（執行中）
- [ ] 代碼重構：拆分 prediction.js (11194 行 → 10 個模組)
  - [x] 創建 modules/chart-loader.js (圖表懶載入)
  - [x] 創建 modules/xgboost-api.js (XGBoost API)
  - [ ] 創建 modules/chart-init.js (圖表初始化)
  - [ ] 創建 modules/data-processor.js (數據處理)
  - [ ] 創建 modules/ui-updater.js (UI 更新)
  - [ ] 創建 modules/event-handlers.js (事件處理)
  - [ ] 更新 prediction.js 使用新模組
- [ ] 代碼重構：優化 server.js 組織
- [x] 性能優化：數據庫索引優化（已完成）
- [x] 性能優化：查詢優化策略（已文檔化）
- [x] 性能優化：代碼分割和懶加載（模組化進行中）

### P2 - 文檔和安全（已完成）
- [x] 創建 API 文檔 (docs/API_DOCUMENTATION.md) - 60+ API 端點完整文檔
- [x] 創建系統架構圖 (docs/ARCHITECTURE.md) - 完整架構說明
- [x] 完善部署文檔 (docs/DEPLOYMENT.md) - Railway 部署指南
- [x] 性能優化文檔（migrations/005_performance_indexes.sql）
- [ ] 安全審計 - 需要專業安全工具
- [ ] 依賴更新 - 需要測試環境

### 已完成
- [x] 全面應用檢查
- [x] 生成詳細審計報告 (.tasks/comprehensive-audit.md)

---

## 最終優化計劃 (已完成)

### 第一階段：訓練最終模型 (本地) ✅

- [x] 用最佳 10 特徵訓練 XGBoost 模型
- [x] 評估性能
- [x] 保存最終模型到 `models/xgboost_opt10_model.json`

### 第二階段：整合到 Railway ✅

- [x] 更新 `modules/ensemble-predictor.js` 使用最佳 10 特徵
- [x] 更新版本號到 3.2.00

### 第三階段：部署 ✅

- [x] 推送到 GitHub
- [x] Railway 自動部署

### 第四階段：Optuna 優化 (已完成) ✅

- [x] Optuna 30 trials 找到最佳參數
- [x] 比較 XGBoost vs RF vs Ensemble
- [x] 訓練 v3.2.01 模型
- [x] 更新文檔

---

## 自動學習系統設計 (已完成 2026-01-18)

### 設計文檔

- [x] 創建 `docs/CONTINUOUS_LEARNING_DESIGN.md` 詳細設計文檔
- [x] 創建 `docs/CONTINUOUS_LEARNING_QUICK_START.md` 快速指南
- [x] 創建 `migrations/004_continuous_learning.sql` 數據庫結構

### 實施計劃

#### Phase 1: 自動記錄系統 ✅
- [x] 創建 `migrations/004_continuous_learning.sql` 數據庫結構
- [x] 創建 `python/continuous_learner.py` 每日學習引擎
- [x] 創建 `modules/learning-scheduler.js` Node.js 調度器

#### Phase 2: 異常檢測 ✅
- [x] 創建 `python/anomaly_detector.py` 異常檢測器
- [x] 實現異常分類邏輯
- [x] 創建異常報告 API (`/api/learning/anomalies`)

#### Phase 3: 學習迴歸模型 ✅
- [x] 創建 `python/weather_impact_learner.py` 天氣影響學習
- [x] 實現迴歸模型訓練
- [x] 創建天氣影響參數表更新邏輯

#### Phase 4: 預報整合 ✅
- [x] 創建 `python/forecast_predictor.py` 天氣預報整合
- [x] 整合 HKO 9 天預報 API
- [x] 實現預測調整邏輯
- [x] 添加所有學習系統 API 端點

### 版本更新
- [x] 更新 `server.js` 到 v4.0.00
- [x] 更新 `package.json` 到 v4.0.00
- [x] 更新 `VERSION_LOG.md` 添加 v4.0.00 記錄

---

## 最佳 10 個特徵 (基線)

```javascript
// 特徵重要性順序
1. Attendance_EWMA7    // 7天指數加權移動平均 (最重要)
2. Daily_Change        // 每日變化
3. Attendance_EWMA14   // 14天指數加權移動平均
4. Weekly_Change       // 每周變化
5. Day_of_Week         // 星期幾 (0-6)
6. Attendance_Lag7     // 7天前就診人數
7. Attendance_Lag1     // 1天前就診人數
8. Is_Weekend          // 是否週末
9. DayOfWeek_sin       // 星期週期編碼 (sin)
10. DayOfWeek_cos      // 星期週期編碼 (cos)
```

## 測試結果摘要

| 模型 | 特徵數 | MAE | 改善 |
|------|--------|-----|------|
| 舊模型基準 | - | 15.73 | - |
| 最佳 10 特徵 (默認參數) | 10 | 3.19 | +79.7% |
| 最佳 10 特徵 + Optuna | 10 | **2.85** | **+81.9%** |

## 最終模型性能 (v3.2.01)

- MAE: 2.85 人
- RMSE: 4.54 人
- MAPE: 1.17%
- R²: 97.18%

## Optuna 最佳參數

```
max_depth: 9
learning_rate: 0.045
min_child_weight: 6
subsample: 0.67
colsample_bytree: 0.92
gamma: 0.84
reg_alpha: 1.35
reg_lambda: 0.79
```

## 模型比較測試結果

| 模型 | MAE | 結論 |
|------|-----|------|
| XGBoost (默認) | 3.19 | 基準 |
| XGBoost + Optuna | 2.85 | ✅ 最佳 |
| Random Forest | 5.77 | 比 XGBoost 差 81% |
| Ensemble (XGB+RF) | 2.85 | 無額外改善 (RF權重=0) |

**結論**:
1. 10 個最佳特徵已足夠，無需額外特徵
2. Optuna 優化帶來 9.2% 額外改善
3. RF 在精簡特徵集下表現不佳
4. Ensemble 無幫助，單獨使用 XGBoost 即可
