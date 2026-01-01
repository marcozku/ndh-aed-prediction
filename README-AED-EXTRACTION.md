# AED 數據提取說明

## 概述

此工具用於從 Hospital Authority Accident & Emergency Department Attendance Summary 報告中提取日期和就診人數。

## 使用方法

### 方法1：從文件讀取

1. 將完整的報告文本保存到文件（如 `aed-reports.txt`）
2. 運行提取腳本：

```bash
node extract-complete-aed-data.js aed-reports.txt
```

### 方法2：從標準輸入讀取

```bash
cat aed-reports.txt | node extract-complete-aed-data.js -
```

### 方法3：直接處理文本

將完整文本保存到文件後運行腳本。

## 輸出文件

腳本會生成以下文件：

1. `aed-data-all-years.json` - 完整的 JSON 格式數據
2. `aed-data-all-years.csv` - 完整的 CSV 格式數據（包含所有字段）
3. `aed-data-simple.csv` - 簡化的 CSV 格式（只有日期和就診人數）
4. `aed-data-stats.json` - 統計信息

## 數據格式

### JSON 格式

```json
{
  "date": "2016-01-07",
  "attendance": 296,
  "original_date": "07/01/2016",
  "period": "01/12/2015 to 01/12/2016"
}
```

### CSV 格式

```csv
Date,Attendance,OriginalDate,Period
2016-01-07,296,07/01/2016,"01/12/2015 to 01/12/2016"
```

## 注意事項

1. 數據格式複雜，提取結果可能需要手動驗證
2. 如果提取的數據量與預期不符，請檢查輸入文件格式
3. 建議先測試小範圍數據，確認提取邏輯正確後再處理完整數據

## 已提取的數據

- 2016年數據已成功提取（330筆）
- 其他年份的數據需要從完整文本中提取
