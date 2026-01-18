# 在 Railway 上執行添加數據腳本

## 前置：學習系統數據庫 (migration 004)

若使用自動學習系統（/api/learning/*），需先執行：

```bash
# 在 Railway 資料庫 Query / 或 railway run 後：
psql $DATABASE_URL -f migrations/004_continuous_learning.sql
```

或於 Railway 資料庫的 Data / Query 貼上 `migrations/004_continuous_learning.sql` 內容並執行。未執行時，學習 API 會降級回傳空資料，不影響主預測功能。

---

## 方法 1：使用 Railway Web 控制台（最簡單）

1. 登入 Railway (https://railway.app)
2. 選擇你的項目
3. 點擊服務（Service）
4. 打開 **"Deployments"** 標籤
5. 點擊最新的部署
6. 打開 **"Logs"** 標籤查看日誌
7. 或者打開 **"Settings"** → **"Variables"** 查看環境變數

### 執行腳本：

1. 在 Railway 項目中，打開 **"Settings"** → **"Service"**
2. 找到 **"Shell"** 或 **"Terminal"** 選項
3. 或者使用 **"Deployments"** → 點擊部署 → **"View Logs"** → 在底部有終端

執行以下命令：

```bash
node check-and-add-data.js
```

或

```bash
node add-actual-data-direct.js
```

## 方法 2：使用 Railway CLI

如果你安裝了 Railway CLI：

```bash
railway run node check-and-add-data.js
```

## 方法 3：使用 Python 腳本（如果 Node.js 不可用）

```bash
# 安裝依賴（如果需要）
pip3 install --user psycopg2-binary python-dotenv

# 執行腳本（DATABASE_URL 會自動從 Railway 環境變數獲取）
python3 add-actual-data.py
```

## 方法 4：直接執行 SQL（最快）

1. 在 Railway 項目中，打開數據庫服務
2. 打開 **"Data"** 標籤
3. 點擊 **"Query"** 或 **"SQL Editor"**
4. 複製 `add-actual-data-simple.sql` 的內容
5. 執行 SQL

這會直接插入數據，準確度計算會在下次應用程序運行時自動完成。

## 驗證數據已添加

執行以下 SQL 查詢：

```sql
SELECT 
    date,
    patient_count,
    source,
    created_at
FROM actual_data
WHERE date BETWEEN '2025-12-01' AND '2025-12-12'
ORDER BY date;
```

檢查準確度：

```sql
SELECT 
    target_date,
    actual_count,
    predicted_count,
    error_percentage,
    within_ci80,
    within_ci95
FROM prediction_accuracy
WHERE target_date BETWEEN '2025-12-01' AND '2025-12-12'
ORDER BY target_date;
```

## 如果腳本執行失敗

1. 檢查環境變數：確認 `DATABASE_URL` 已設置
2. 檢查數據庫連接：確認數據庫服務正在運行
3. 查看日誌：檢查 Railway 部署日誌中的錯誤訊息
