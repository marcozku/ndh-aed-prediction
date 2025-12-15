# 快速開始 - 添加實際數據

## ✅ 自動方式（推薦）

**已設置自動化！** Railway 重新部署後會自動添加 1/12 到 12/12 的實際數據。

只需等待 Railway 完成部署（1-2 分鐘），然後刷新網頁即可看到比較結果。

## 🔧 手動方式（如果需要立即添加）

### 在 Railway 上執行：

1. 登入 Railway: https://railway.app
2. 選擇你的項目
3. 打開服務（Service）
4. 點擊 **"Deployments"** → 最新部署 → **"View Logs"**
5. 在底部找到終端/Shell
6. 執行：

```bash
node check-and-add-data.js
```

或

```bash
node add-actual-data-direct.js
```

### 如果 Railway 有 DATABASE_URL：

你也可以在本地設置環境變數後執行：

```bash
export DATABASE_URL="你的數據庫URL"
node check-and-add-data.js
```

## 📊 驗證數據已添加

部署完成後，在網頁上查看：
- **「實際 vs 預測對比」圖表** - 應該顯示 12 天的數據
- **「詳細比較數據」表格** - 應該顯示每條記錄的比較結果

## 🎯 當前狀態

- ✅ 代碼已推送到 GitHub
- ✅ Railway 會自動重新部署
- ✅ 部署後會自動添加數據
- ⏳ 等待部署完成（1-2 分鐘）
