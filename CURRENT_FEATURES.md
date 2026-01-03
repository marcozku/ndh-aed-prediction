# XGBoost 精選特徵列表

**自動生成於**: 2026-01-04 03:20 HKT
**特徵數量**: 27 個
**模型版本**: 3.0.73

## 📊 模型性能

| 指標 | 數值 |
|------|------|
| MAE | 5.22 病人 |
| MAPE | 2.05% |
| R² | 0.925 |
| RMSE | 7.23 |

## 🎯 精選特徵列表

### 時間特徵 (3個)

- `Day_of_Week`
- `DayOfWeek_sin`
- `DayOfWeek_Target_Mean`

### 滯後特徵 (4個)

- `Attendance_Lag1`
- `Attendance_Lag7`
- `Attendance_Lag30`
- `Lag1_Diff`

### 滾動統計 (5個)

- `Attendance_Rolling7`
- `Attendance_Rolling14`
- `Attendance_Min7`
- `Attendance_Median14`
- `Attendance_Median3`

### EWMA 特徵 (3個)

- `Attendance_EWMA7`
- `Attendance_EWMA14`
- `Attendance_EWMA30`

### 變化特徵 (3個)

- `Daily_Change`
- `Monthly_Change`
- `Weekly_Change`

### 位置特徵 (3個)

- `Attendance_Position7`
- `Attendance_Position14`
- `Attendance_Position30`

### 事件指標 (3個)

- `Is_Winter_Flu_Season`
- `Is_Weekend`
- `Holiday_Factor`

### 其他 (3個)

- `Attendance_Same_Weekday_Avg`
- `AQHI_Risk`
- `AQHI_High`

## 📈 特徵重要性 (Top 10)

| 排名 | 特徵 | 重要性 |
|------|------|--------|
| 1 | `Attendance_EWMA7` | 52.00% |
| 2 | `Attendance_EWMA14` | 34.00% |
| 3 | `Daily_Change` | 2.00% |
| 4 | `Monthly_Change` | 2.00% |
| 5 | `Attendance_EWMA30` | 2.00% |
| 6 | `AQHI_General_Max` | 1.00% |

## 📝 備註

- 特徵列表由自動特徵優化系統生成
- 每次訓練後自動更新
- 特徵選擇基於 XGBoost 特徵重要性和交叉驗證
- 新的天氣特徵（颱風、暴雨等）會在重新訓練後被考慮

## 🔄 更新歷史

- 2026-01-04 03:20 HKT: 自動生成
