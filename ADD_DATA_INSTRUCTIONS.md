# 如何添加實際數據並查看比較結果

## 數據已準備好

已更新以下文件，包含 1/12 到 12/12 的實際數據：
- `add-actual-data-direct.js` - 直接連接數據庫
- `add-actual-data.js` - 通過 API
- `check-and-add-data.js` - 檢查並添加（推薦）

## 數據列表（1/12 到 12/12）

- 1/12: 276 人
- 2/12: 285 人
- 3/12: 253 人
- 4/12: 234 人
- 5/12: 262 人
- 6/12: 234 人
- 7/12: 244 人
- 8/12: 293 人
- 9/12: 253 人
- 10/12: 219 人
- 11/12: 275 人
- 12/12: 248 人

## 方法 1：使用 Node.js 腳本（推薦）

### 步驟 1：找到 Node.js

如果 `node` 命令不可用，嘗試：

```bash
# 檢查常見位置
which node
which nodejs

# 或使用完整路徑（如果已安裝）
/usr/local/bin/node --version
/opt/homebrew/bin/node --version

# 或使用 nvm（如果已安裝）
source ~/.nvm/nvm.sh
nvm use node
node --version
```

### 步驟 2：運行腳本

```bash
# 推薦：檢查並添加數據（會跳過已存在的數據）
node check-and-add-data.js

# 或直接添加數據（會覆蓋已存在的數據）
node add-actual-data-direct.js
```

## 方法 2：通過 API（需要服務器運行）

### 步驟 1：啟動服務器

```bash
node server.js
```

### 步驟 2：添加數據

在另一個終端運行：

```bash
# 使用 Node.js 腳本
node add-actual-data.js

# 或使用 curl
./add-actual-data-curl.sh
```

## 方法 3：在 Railway 上運行

如果項目已部署到 Railway：

1. 進入 Railway 控制台
2. 打開終端/Shell
3. 運行：
   ```bash
   node check-and-add-data.js
   ```

## 查看比較結果

添加數據後，系統會自動：

1. ✅ 將實際數據保存到 `actual_data` 表
2. ✅ 查找對應日期的預測數據
3. ✅ 計算誤差和誤差百分比
4. ✅ 檢查是否在 80% 和 95% 置信區間內
5. ✅ 將結果保存到 `prediction_accuracy` 表

然後在網頁上查看：

- 📊 **「實際 vs 預測對比」圖表** - 顯示實際人數、預測人數和置信區間
- 📋 **「詳細比較數據」表格** - 顯示每條記錄的詳細比較數據

## 故障排除

### 問題：找不到 node 命令

**解決方案：**
1. 確認 Node.js 已安裝：訪問 https://nodejs.org/
2. 檢查 PATH 環境變數
3. 使用完整路徑運行 Node.js

### 問題：數據庫連接失敗

**解決方案：**
1. 確認 `.env` 文件中有正確的 `DATABASE_URL`
2. 確認數據庫服務正在運行
3. 檢查網絡連接

### 問題：沒有看到比較結果

**解決方案：**
1. 確認數據已成功添加到數據庫
2. 確認對應日期有預測數據
3. 運行 `check-and-add-data.js` 檢查狀態
4. 刷新網頁查看更新

## 檢查數據狀態

運行以下腳本檢查數據庫中的數據：

```bash
node check-and-add-data.js
```

這會顯示：
- ✅ 哪些日期已有實際數據
- ⚠️ 哪些日期缺少數據
- 📊 哪些日期已計算準確度
- ⚠️ 哪些日期有預測但未計算準確度
