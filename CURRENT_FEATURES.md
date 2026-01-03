# XGBoost 精選特徵列表

**自動生成於**: 2026-01-04 03:40 HKT
**特徵數量**: 25 個
**模型版本**: 2.9.52

## 📊 模型性能

| 指標 | 數值 |
|------|------|
| MAE | 6.18 病人 |
| MAPE | 2.42% |
| R² | 0.898 |
| RMSE | 8.41 |

## 🎯 精選特徵列表

### 時間特徵 (2個)

- `Day_of_Week`
- `DayOfWeek_Target_Mean`

### 滯後特徵 (7個)

- `Attendance_Lag1`
- `Attendance_Lag3`
- `Attendance_Lag5`
- `Attendance_Lag7`
- `Attendance_Lag30`
- `Lag1_Diff`
- `Lag7_Diff`

### 滾動統計 (6個)

- `Attendance_Rolling14`
- `Attendance_Std3`
- `Attendance_Std7`
- `Attendance_Min7`
- `Attendance_Min90`
- `Attendance_Median30`

### EWMA 特徵 (1個)

- `Attendance_EWMA7`

### 變化特徵 (3個)

- `Daily_Change`
- `Weekly_Change`
- `Monthly_Change`

### 位置特徵 (3個)

- `Attendance_Position7`
- `Attendance_Position14`
- `Attendance_Position30`

### 事件指標 (1個)

- `Holiday_Factor`

### 其他 (2個)

- `Attendance_Same_Weekday_Avg`
- `Attendance_CV7`

## 📈 特徵重要性 (Top 10)

| 排名 | 特徵 | 重要性 |
|------|------|--------|
| 1 | `Attendance_EWMA7` | 86.89% |
| 2 | `Monthly_Change` | 2.82% |
| 3 | `Daily_Change` | 2.32% |
| 4 | `Attendance_Lag1` | 1.10% |
| 5 | `Weekly_Change` | 0.78% |
| 6 | `Attendance_Rolling7` | 0.48% |
| 7 | `Attendance_Lag30` | 0.47% |
| 8 | `Attendance_Position7` | 0.47% |
| 9 | `Day_of_Week` | 0.45% |
| 10 | `DayOfWeek_sin` | 0.39% |

## 📝 備註

- 特徵列表由自動特徵優化系統生成
- 每次訓練後自動更新
- 特徵選擇基於 XGBoost 特徵重要性和交叉驗證
- 新的天氣特徵（颱風、暴雨等）會在重新訓練後被考慮

## 🔄 更新歷史

- 2026-01-04 03:40 HKT: 自動生成
