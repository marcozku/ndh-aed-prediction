# NDH AED Prediction Algorithm - Dynamic Factors System

## 📊 Overview

本系統確保所有預測參數 (factors) 從 Railway Production Database 實時計算，永遠使用最新真實數據。

## 🔄 Auto-Update Mechanism

### When Factors Are Updated:

1. **每次模型訓練時**
   - `python/train_xgboost.py` 執行前自動呼叫 `calculate_dynamic_factors.py`
   - 從 `actual_data` table 重新計算所有 factors

2. **手動更新**
   ```bash
   python python/calculate_dynamic_factors.py
   ```

### What Gets Calculated:

✅ **Day-of-Week Factors** (n=578-579 each)
- Sunday: 0.961, Monday: 1.092, Tuesday: 1.016, etc.

✅ **Month Factors** (n=311-372 each)
- January: 0.985, February: 0.964, etc.

✅ **Holiday Factors** (n=11-132 each)
- 農曆新年: 0.951 (-4.9%)
- 聖誕節: 0.920 (-8.0%)
- 端午節: 1.027 (+2.7%)
- etc.

## 📁 Files

### Python
- `python/calculate_dynamic_factors.py` - 動態計算引擎
- `python/models/dynamic_factors.json` - 自動生成的 factors (JSON)
- `python/feature_engineering.py` - 使用動態 factors

### JavaScript
- `prediction.js` - 使用動態 factors (HK_PUBLIC_HOLIDAYS)

## 🎯 Benefits

1. **100% Real Data**: 所有 factors 從真實數據庫記錄計算
2. **Auto-Update**: 用戶上傳新數據後，下次訓練自動更新
3. **No Mock Data**: 消除所有硬編碼估計值
4. **Traceable**: 每個 factor 記錄樣本數 (n) 和計算日期

## 📝 Example Output

```json
{
  "version": "3.0.81",
  "updated": "2026-01-05 03:15 HKT",
  "source": "Railway Production Database (actual_data table)",
  "total_days": 4052,
  "overall_mean": 252.40,
  "holiday_factors": {
    "農曆新年": {
      "factor": 0.951,
      "mean": 240.12,
      "count": 132,
      "impact_pct": -4.9
    }
  }
}
```

## 🔧 Fallback Mechanism

如果 `dynamic_factors.json` 無法載入：
- Python: 使用最後已知的真實值 (from 2026-01-05)
- JavaScript: 使用最後已知的真實值 (from 2026-01-05)

## ✅ Verification

Run this to verify factors are up-to-date:
```bash
python python/calculate_dynamic_factors.py
cat python/models/dynamic_factors.json
```

---

**Last Updated**: 2026-01-05 HKT
**Version**: 3.0.81
**Author**: Ma Tsz Kiu

