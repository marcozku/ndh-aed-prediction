# NDH AED Prediction System - 問題分析與修復計劃

## 📊 發現的問題

### 1. 預測算法準確度問題

**位置:** `python/ensemble_predict.py`

**問題點:**
- ✅ 滾動預測使用預測值污染特徵（Lag/EWMA）
- ✅ 置信區間計算過於簡單（固定 5% 標準差）
- ✅ 沒有使用實際歷史誤差
- ✅ 遠期預測不確定性增長過於線性（每天 +2%）
- ⚠️ 沒有滾動窗口機制（應只用最近 90-180 天）

**當前實現:**
```python
# Line 439-441: 固定 5% 標準差
std_preds = xgb_pred * 0.05 * uncertainty_multiplier
uncertainty_multiplier = 1.0 + i * 0.02  # 線性增長
```

### 2. 雙軌智能預測系統問題

**位置:** `server.js`, `index.html`

**問題點:**
- ✅ API endpoint 存在: `/api/dual-track/summary` (line 4423)
- ✅ 前端有載入邏輯: `dual-track-loading` div
- ⚠️ 可能是數據庫表不存在或無數據
- ⚠️ 需要檢查 `dual_track_predictions` 表

### 3. 自動學習系統問題

**位置:** `server.js`, `index.html`

**問題點:**
- ✅ API endpoint 存在: `/api/learning/summary` (line 4790)
- ✅ 前端有載入邏輯: `learning-loading` div
- ⚠️ 可能是 `learning_system_status` 或 `learning_records` 表不存在
- ⚠️ 需要檢查數據庫 schema

### 4. 代碼冗餘問題

**位置:** `prediction.js`

**問題點:**
- ✅ 文件過大: 11,404 行
- ⚠️ 需要識別並移除重複代碼

### 5. 版本不一致

**問題點:**
- server.js: v4.0.25
- ensemble_predict.py: v4.0.20
- ⚠️ 需要統一版本號

## 🔧 修復計劃

### Phase 1: 修復預測算法（優先）
1. 實現基於歷史誤差的置信區間
2. 添加滾動窗口機制（90-180天）
3. 改進遠期預測不確定性模型
4. 防止預測值污染特徵

### Phase 2: 修復雙軌系統
1. 檢查數據庫表結構
2. 確保 API 返回正確數據
3. 修復前端載入邏輯

### Phase 3: 修復學習系統
1. 檢查數據庫表結構
2. 確保 API 返回正確數據
3. 修復前端載入邏輯

### Phase 4: 代碼清理
1. 分析 prediction.js 冗餘代碼
2. 移除重複邏輯
3. 統一版本號

## 📝 下一步
開始 Phase 1 修復...
