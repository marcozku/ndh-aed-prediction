#!/bin/bash
# 使用 curl 添加實際數據到系統

curl -X POST http://localhost:3001/api/actual-data \
  -H "Content-Type: application/json" \
  -d '[
    {"date": "2025-12-01", "patient_count": 276},
    {"date": "2025-12-02", "patient_count": 285},
    {"date": "2025-12-03", "patient_count": 253},
    {"date": "2025-12-04", "patient_count": 234},
    {"date": "2025-12-05", "patient_count": 262},
    {"date": "2025-12-06", "patient_count": 234},
    {"date": "2025-12-07", "patient_count": 244},
    {"date": "2025-12-08", "patient_count": 293},
    {"date": "2025-12-09", "patient_count": 253},
    {"date": "2025-12-10", "patient_count": 219},
    {"date": "2025-12-11", "patient_count": 275},
    {"date": "2025-12-12", "patient_count": 248}
  ]'

echo ""
echo "✅ 數據已發送！系統會自動計算準確度並與預測值比較"
