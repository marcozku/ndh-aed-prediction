# 歷史數據導入說明

## 導入2015-2024年歷史數據

### 方法1: 通過Railway CLI執行

```bash
# 連接到Railway服務
railway run node import-historical-data.js
```

### 方法2: 通過Railway Dashboard執行

1. 登入 Railway Dashboard
2. 選擇你的項目
3. 進入服務的終端（Terminal）
4. 執行以下命令：

```bash
node import-historical-data.js
```

### 方法3: 通過API端點導入（如果已配置）

如果服務器已運行，可以通過API批量導入：

```bash
curl -X POST https://your-app.railway.app/api/actual-data \
  -H "Content-Type: application/json" \
  -d @historical-data.json
```

### 數據說明

- **數據範圍**: 2015-12-03 至 2024-12-03
- **數據筆數**: 774筆
- **數據來源**: `historical_analysis_2015_2024`
- **覆蓋範圍**: 
  - 疫情前正常年份（2015-2019）
  - 疫情期間（2020-2022）
  - 疫情後恢復期（2023-2024）

### 注意事項

1. 導入腳本會自動處理重複數據（使用 `ON CONFLICT` 更新）
2. 確保數據庫連接已正確配置（DATABASE_URL或PG環境變數）
3. 導入過程可能需要幾秒到幾分鐘，取決於數據庫性能
4. 導入成功後，預測算法將自動使用這些歷史數據進行更準確的預測

### 驗證導入

導入完成後，可以通過以下方式驗證：

```bash
# 檢查數據庫中的記錄數
railway run psql $DATABASE_URL -c "SELECT COUNT(*) FROM actual_data WHERE source = 'historical_analysis_2015_2024';"

# 查看數據範圍
railway run psql $DATABASE_URL -c "SELECT MIN(date), MAX(date) FROM actual_data WHERE source = 'historical_analysis_2015_2024';"
```
