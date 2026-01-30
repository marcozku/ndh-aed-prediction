#!/bin/bash
echo "=== 驗證 Railway v4.0.16 部署 ==="
echo ""
echo "1. 檢查版本號："
curl -s "https://ndhaedprediction.up.railway.app/api/model-performance" | grep -o '"modelVersion":"[^"]*"' || echo "無法獲取版本"
echo ""
echo "2. 檢查預測天數："
PRED_COUNT=$(curl -s "https://ndhaedprediction.up.railway.app/api/predictions" | grep -o '"date":"2026-[^"]*"' | wc -l)
echo "預測天數: $PRED_COUNT 天"
echo ""
echo "3. 檢查 Day 8-15 預測值（應該有變化，不再是簡單循環）："
curl -s "https://ndhaedprediction.up.railway.app/api/predictions" | grep -o '"date":"2026-02-0[89]","predicted":[0-9]*' | head -8
curl -s "https://ndhaedprediction.up.railway.app/api/predictions" | grep -o '"date":"2026-02-1[0-5]","predicted":[0-9]*' | head -6
echo ""
echo "4. 檢查預測方法（Day 8+ 應該顯示 long_term_mean_reversion_with_factors）："
curl -s "https://ndhaedprediction.up.railway.app/api/predictions" | grep -o '"date":"2026-02-1[0-2]","predicted":[0-9]*,"method":"[^"]*"' | head -3
