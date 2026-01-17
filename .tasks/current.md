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
