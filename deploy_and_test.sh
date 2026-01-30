#!/bin/bash
# Railway 特徵選擇測試部署腳本

echo "🚀 部署特徵選擇測試到 Railway..."

# 1. 推送到 GitHub
echo "📦 推送到 GitHub..."
git add python/test_feature_selection_railway.py
git commit -m "Add feature selection test for Railway"
git push origin main

echo "✅ 已推送到 GitHub"
echo ""
echo "🔧 接下來在 Railway 控制台:"
echo "1. 打開 Railway 項目"
echo "2. 等待自動部署完成"
echo "3. 在服務中運行測試:"
echo "   railway run \"python python/test_feature_selection_railway.py\""
echo ""
echo "或者查看日誌查看測試結果"
