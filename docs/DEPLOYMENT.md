# NDH AED 預測系統部署指南

## 版本：v4.0.04

---

## 目錄

1. [環境要求](#環境要求)
2. [本地開發](#本地開發)
3. [Railway 部署](#railway-部署)
4. [環境變數配置](#環境變數配置)
5. [數據庫遷移](#數據庫遷移)
6. [故障排除](#故障排除)
7. [性能優化](#性能優化)

---

## 環境要求

### 必需軟件

- **Node.js**: 18.x 或更高
- **Python**: 3.11 或更高
- **PostgreSQL**: 14.x 或更高
- **Git**: 最新版本

### Python 依賴

```bash
cd python
pip install -r requirements.txt
```

主要依賴：
- xgboost >= 2.0.0
- pandas >= 2.0.0
- numpy >= 1.24.0
- scikit-learn >= 1.3.0
- optuna >= 3.0.0

### Node.js 依賴

```bash
npm install
```

主要依賴：
- pg (PostgreSQL 客戶端)
- chart.js (圖表庫)

---

## 本地開發

### 1. 克隆倉庫

```bash
git clone https://github.com/your-org/ndh-aed-prediction.git
cd ndh-aed-prediction
```

### 2. 配置環境變數

創建 `.env` 文件：

```bash
# 數據庫配置
DATABASE_URL=postgresql://user:password@localhost:5432/ndh_aed
PGHOST=localhost
PGUSER=postgres
PGPASSWORD=your_password
PGDATABASE=ndh_aed
PGPORT=5432

# AI 服務
ANTHROPIC_API_KEY=your_api_key_here

# 應用配置
PORT=3001
NODE_ENV=development
MODEL_VERSION=4.0.04
```

### 3. 初始化數據庫

```bash
# 創建數據庫
createdb ndh_aed

# 運行遷移
psql -d ndh_aed -f migrations/001_initial.sql
psql -d ndh_aed -f migrations/004_continuous_learning.sql
psql -d ndh_aed -f migrations/005_performance_indexes.sql
```

### 4. 導入歷史數據

```bash
# 方法 1: 使用 CSV 導入
node import-csv-data.js path/to/your/data.csv

# 方法 2: 通過 API 上傳
# 啟動服務器後訪問 http://localhost:3001
# 使用 UI 上傳 CSV 文件
```

### 5. 訓練模型

```bash
cd python
python train_all_models.py
```

這將生成：
- `models/xgboost_opt10_model.json`
- `models/feature_names.json`
- `models/scaler.pkl`

### 6. 啟動服務器

```bash
node server.js
```

訪問 http://localhost:3001

---

## Railway 部署

### 1. 準備 Railway 項目

1. 訪問 [Railway.app](https://railway.app)
2. 創建新項目
3. 添加 PostgreSQL 服務
4. 連接 GitHub 倉庫

### 2. 配置環境變數

在 Railway 控制台設置：

```bash
# 數據庫（自動生成）
DATABASE_URL=${{Postgres.DATABASE_URL}}
PGHOST=${{Postgres.PGHOST}}
PGUSER=${{Postgres.PGUSER}}
PGPASSWORD=${{Postgres.PGPASSWORD}}
PGDATABASE=${{Postgres.PGDATABASE}}
PGPORT=${{Postgres.PGPORT}}

# AI 服務
ANTHROPIC_API_KEY=your_api_key_here

# 應用配置
PORT=3001
NODE_ENV=production
MODEL_VERSION=4.0.04
```

### 3. 配置構建設置

Railway 使用 Nixpacks 自動檢測構建配置。

**nixpacks.toml** (可選):

```toml
[phases.setup]
nixPkgs = ["nodejs-18_x", "python311"]

[phases.install]
cmds = [
  "npm install",
  "cd python && pip install -r requirements.txt"
]

[start]
cmd = "node server.js"
```

### 4. 部署

```bash
# 推送到 main 分支自動部署
git add .
git commit -m "部署到 Railway"
git push origin main
```

### 5. 運行數據庫遷移

```bash
# 方法 1: 使用 Railway CLI
railway run psql -f migrations/005_performance_indexes.sql

# 方法 2: 通過 Railway 控制台
# 打開 PostgreSQL 服務 → Query → 執行 SQL
```

### 6. 驗證部署

```bash
# 檢查服務狀態
curl https://your-app.railway.app/api/db-status

# 檢查 API
curl https://your-app.railway.app/api/list-routes
```

---

## 環境變數配置

### 必需變數

| 變數 | 說明 | 示例 |
|------|------|------|
| DATABASE_URL | PostgreSQL 連接字符串 | postgresql://user:pass@host:5432/db |
| PGHOST | 數據庫主機 | postgres.railway.internal |
| PGUSER | 數據庫用戶 | postgres |
| PGPASSWORD | 數據庫密碼 | *** |
| PGDATABASE | 數據庫名稱 | railway |
| PGPORT | 數據庫端口 | 5432 |

### 可選變數

| 變數 | 說明 | 默認值 |
|------|------|--------|
| ANTHROPIC_API_KEY | Claude AI API 密鑰 | 無 (AI 功能禁用) |
| PORT | 服務器端口 | 3001 |
| NODE_ENV | 環境 | development |
| MODEL_VERSION | 模型版本 | 4.0.04 |

---

## 數據庫遷移

### 遷移文件

```
migrations/
├── 001_initial.sql              # 初始表結構
├── 004_continuous_learning.sql  # 持續學習系統
└── 005_performance_indexes.sql  # 性能優化索引
```

### 執行遷移

#### 本地

```bash
psql -d ndh_aed -f migrations/005_performance_indexes.sql
```

#### Railway

```bash
# 使用 Railway CLI
railway run psql -f migrations/005_performance_indexes.sql

# 或通過 Railway 控制台
# PostgreSQL → Query → 粘貼 SQL → 執行
```

### 驗證遷移

```sql
-- 檢查索引
SELECT
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- 檢查視圖
SELECT
    viewname,
    definition
FROM pg_views
WHERE schemaname = 'public';
```

---

## 故障排除

### 問題 1: Railway API 404

**症狀**: 所有 `/api/*` 端點返回 404

**原因**:
- 環境變數未正確設置
- 數據庫連接失敗
- 構建失敗

**解決方案**:

```bash
# 1. 檢查部署日誌
railway logs

# 2. 檢查環境變數
railway variables

# 3. 驗證數據庫連接
railway run node -e "require('./database').pool.query('SELECT 1')"

# 4. 重新部署
git commit --allow-empty -m "觸發重新部署"
git push origin main
```

### 問題 2: 數據庫連接超時

**症狀**: `ETIMEDOUT` 或 `ECONNREFUSED`

**解決方案**:

```javascript
// database.js 已實現重試機制
// 檢查連接池配置
const poolConfig = {
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 20000
};
```

### 問題 3: Python 依賴缺失

**症狀**: `ModuleNotFoundError: No module named 'xgboost'`

**解決方案**:

```bash
# Railway 構建時自動安裝
# 如果失敗，檢查 python/requirements.txt

# 本地測試
cd python
pip install -r requirements.txt
python -c "import xgboost; print(xgboost.__version__)"
```

### 問題 4: 模型文件缺失

**症狀**: `ENOENT: no such file or directory, open 'models/xgboost_opt10_model.json'`

**解決方案**:

```bash
# 1. 確保模型文件已提交到 Git
git add models/
git commit -m "添加模型文件"
git push

# 2. 或在 Railway 上訓練模型
railway run python python/train_all_models.py
```

### 問題 5: 記憶體不足

**症狀**: `JavaScript heap out of memory`

**解決方案**:

```bash
# 增加 Node.js 記憶體限制
NODE_OPTIONS="--max-old-space-size=4096" node server.js

# Railway 設置環境變數
NODE_OPTIONS=--max-old-space-size=4096
```

---

## 性能優化

### 1. 數據庫優化

```sql
-- 執行性能優化遷移
\i migrations/005_performance_indexes.sql

-- 分析查詢性能
EXPLAIN ANALYZE
SELECT * FROM actual_data
WHERE date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY date DESC;

-- 更新統計信息
ANALYZE actual_data;
ANALYZE predictions;
ANALYZE daily_predictions;
```

### 2. 連接池調優

```javascript
// database.js
const poolConfig = {
    max: 20,                      // 最大連接數
    idleTimeoutMillis: 30000,     // 空閒超時
    connectionTimeoutMillis: 20000 // 連接超時
};
```

### 3. 快取策略

```javascript
// Service Worker 快取
// sw.js 自動快取靜態資源

// AI 因素快取（24 小時）
const CACHE_DURATION = 24 * 60 * 60 * 1000;
```

### 4. 監控查詢性能

```sql
-- 啟用慢查詢日誌
ALTER DATABASE railway SET log_min_duration_statement = 1000;

-- 查看慢查詢
SELECT
    query,
    calls,
    total_time,
    mean_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;
```

---

## 健康檢查

### API 端點

```bash
# 數據庫狀態
curl https://your-app.railway.app/api/db-status

# AI 狀態
curl https://your-app.railway.app/api/ai-status

# 自動預測統計
curl https://your-app.railway.app/api/auto-predict-stats

# 列出所有路由
curl https://your-app.railway.app/api/list-routes
```

### 預期響應

```json
{
  "connected": true,
  "host": "postgres.railway.internal",
  "database": "railway",
  "tables": 15,
  "totalRecords": 5000
}
```

---

## 備份和恢復

### 備份數據庫

```bash
# Railway
railway run pg_dump > backup.sql

# 本地
pg_dump ndh_aed > backup.sql
```

### 恢復數據庫

```bash
# Railway
railway run psql < backup.sql

# 本地
psql ndh_aed < backup.sql
```

### 導出實際數據

```bash
# 使用 API
curl https://your-app.railway.app/api/actual-data > actual_data.json

# 使用 SQL
psql -d railway -c "COPY actual_data TO STDOUT CSV HEADER" > actual_data.csv
```

---

## 更新和維護

### 更新代碼

```bash
# 1. 拉取最新代碼
git pull origin main

# 2. 安裝依賴
npm install
cd python && pip install -r requirements.txt

# 3. 運行遷移
psql -d ndh_aed -f migrations/005_performance_indexes.sql

# 4. 重啟服務器
# Railway 自動重啟
# 本地需要手動重啟
```

### 更新模型

```bash
# 1. 訓練新模型
cd python
python train_all_models.py

# 2. 提交模型文件
git add models/
git commit -m "更新模型到 v4.0.05"
git push

# 3. Railway 自動部署
```

### 清理舊數據

```sql
-- 清理 90 天前的 intraday_predictions
DELETE FROM intraday_predictions
WHERE prediction_time < CURRENT_DATE - INTERVAL '90 days';

-- 清理舊的訓練日誌
DELETE FROM training_status
WHERE updated_at < CURRENT_DATE - INTERVAL '30 days';

-- 真空清理
VACUUM ANALYZE;
```

---

## 安全最佳實踐

### 1. 環境變數

- ✅ 使用 Railway Secrets 存儲敏感信息
- ✅ 不要在代碼中硬編碼密鑰
- ✅ 定期輪換 API 密鑰

### 2. 數據庫

- ✅ 使用參數化查詢防止 SQL 注入
- ✅ 限制數據庫用戶權限
- ✅ 啟用 SSL 連接

### 3. API

- ✅ 實施速率限制（未來）
- ✅ 添加 API 認證（未來）
- ✅ 記錄所有 API 調用

---

## 監控和日誌

### Railway 日誌

```bash
# 實時日誌
railway logs --follow

# 過濾錯誤
railway logs | grep "ERROR"

# 導出日誌
railway logs > logs.txt
```

### 應用日誌

```javascript
// 結構化日誌
console.log('📊 預測生成', {
  date: '2026-01-30',
  predicted: 287,
  duration: 2.3
});
```

---

## 支援和聯繫

如有問題：
1. 檢查 [故障排除](#故障排除) 部分
2. 查看 Railway 部署日誌
3. 聯繫開發團隊

**文檔版本**: 1.0.0
**最後更新**: 2026-01-30
