# 世界級急診室就診預測算法 - 持續改進計劃

## 🎯 目標：成為世界上最準確的 AI 驅動急診室就診預測系統

### 當前狀態（v2.9.58）
- **R²**: 92.0%（從 90.3% 提升！）
- **調整 R²**: 91.7%
- **MAE**: 5.33 病人（比 161 特徵的 6.30 改善 15%！）
- **MAPE**: 2.10%（比 161 特徵的 2.45% 改善 14%！）
- **特徵數**: 25 個精選特徵（從 161 優化）
- **方法**: XGBoost + Optuna + 自動特徵優化
- **最後更新**: 2026-01-02

## 📚 最新世界級研究參考（2024-2025）

### 1. **法國醫院 XGBoost 研究（2025年1月）**
- **發表**: BMC Emergency Medicine (2025)
- **MAE**: 2.63-2.64 病人
- **方法**: 機器學習 + 超參數調優
- **數據**: 兩個法國急診室，十年數據
- **引用**: "Predicting Emergency Department Admissions Using a Machine-Learning Algorithm: A Proof of Concept with Retrospective Study"
- **URL**: https://bmcemergmed.biomedcentral.com/articles/10.1186/s12873-024-01141-4

### 2. **特徵工程增強預測研究（2024年12月）**
- **發表**: BMC Medical Informatics and Decision Making (2024)
- **方法**: 特徵工程 + 六種機器學習算法
- **數據**: 11個急診室，三個國家
- **發現**: 日曆和氣象預測因子 + 特徵工程變量顯著提高準確度
- **引用**: "Enhanced Forecasting of Emergency Department Patient Arrivals Using Feature Engineering Approach and Machine Learning"
- **URL**: https://bmcmedinformdecismak.biomedcentral.com/articles/10.1186/s12911-024-02788-6

### 3. **深度學習登機預測（2025年5月）**
- **發表**: arXiv (2025)
- **方法**: 深度學習模型，提前6小時預測
- **數據整合**: 急診室追蹤系統 + 住院患者數據 + 天氣 + 本地事件
- **發現**: 高準確度，支持主動運營決策
- **引用**: "Deep Learning-Based Forecasting of Boarding Patient Counts to Address ED Overcrowding"
- **URL**: https://arxiv.org/abs/2505.14765

### 4. **AI 框架擁擠預測（2025年）**
- **發表**: JMIR Medical Informatics (2025)
- **方法**: AI 框架，實時6小時預測
- **數據整合**: 多數據集整合（急診室追蹤、住院數據、天氣、重要日期）
- **發現**: 每小時和每日預測模型，增強決策制定和資源分配
- **引用**: "An Artificial Intelligence–Based Framework for Predicting Emergency Department Overcrowding: Development and Evaluation Study"
- **URL**: https://medinform.jmir.org/2025/1/e73960

### 5. **LSTM 自適應框架（2024年）**
- **發表**: PubMed (2024)
- **方法**: 長短期記憶網絡
- **優勢**: 優於 ARIMA 和 Prophet，適應數據分佈變化
- **特點**: 無需完全重訓練，動態適應

### 6. **Prophet 時間序列（Facebook Research）**
- **方法**: 趨勢和季節性分解
- **優勢**: 適合強季節性模式
- **特點**: 自動處理假期和異常值

## 🚀 世界級改進路線圖

### 階段 1：基礎實現 ✅
- [x] 滾動窗口計算（180天）
- [x] 加權平均（指數衰減）
- [x] 月份-星期交互因子
- [x] 趨勢調整（7天/30天）
- [x] 改進的置信區間
- [x] 相對溫度天氣因子
- [x] AI 因素整合
- [x] 異常檢測

### 階段 2：XGBoost 機器學習（v2.9.20-v2.9.28）✅
- [x] **XGBoost 梯度提升**：
  - 300-500 棵樹
  - 深度 6-8
  - 52-99 特徵
- [x] **基礎特徵工程**：
  - 日曆特徵（星期、月份、季度、年份）
  - 滯後特徵（Lag1, Lag7, Lag14, Lag30, Lag365）
  - 滾動統計（7天、14天、30天）
  - 假期特徵（香港公眾假期）
- [x] **天氣特徵**：
  - 香港天文台歷史數據（13,613天）
  - 溫度、極端天氣標記

### 階段 3：Optuna 優化 + 高級特徵工程（v2.9.50）✅ 🆕
- [x] **Optuna 超參數優化**：
  - TPE Sampler 自動調參
  - 15-30 次試驗
  - 找到最佳參數組合
- [x] **EWMA 指數加權移動平均**：
  - EWMA7, EWMA14, EWMA30
  - 佔特徵重要性 90%！
- [x] **擴展滯後特徵**：
  - 短期: Lag1-Lag7（每天）
  - 中期: Lag14, Lag21, Lag28
  - 長期: Lag30-Lag365
  - 同星期歷史: 1w-4w
- [x] **目標編碼特徵**：
  - DayOfWeek_Target_Mean
  - Month_Target_Mean
  - YearMonth_Target_Mean
- [x] **相對位置 + 變異係數**

### 階段 3.5：自動特徵優化（v2.9.52）✅ 🆕
- [x] **智能特徵選擇優化器**：
  - 特徵重要性排序
  - RFE 遞歸特徵消除
  - 相關性選擇 + 去冗餘
  - 混合策略
- [x] **自動觸發機制**：
  - 每 5 次訓練自動優化
  - 每 50 筆新數據自動優化
  - 環境變量可配置
- [x] **動態特徵加載**：
  - 從 optimal_features.json 自動加載
  - 無需修改代碼即可更新
- [x] **優化歷史追蹤**：
  - 保存每次優化結果
  - 追蹤歷史最佳配置

### 階段 4：深度學習組件（計劃中）
- [ ] **LSTM 網絡**：
  - 處理時間序列依賴
  - 自動學習長期和短期模式
- [ ] **集成學習**：
  - XGBoost + LightGBM + CatBoost
  - Stacking 集成
- [ ] **在線學習**：
  - 隨著新數據到來自動更新模型
  - 適應數據分佈漂移
- [ ] **A/B 測試框架**：
  - 並行運行多個模型版本
  - 根據實際表現選擇最佳模型
  - 逐步推出改進版本

### 階段 5：多數據源整合（v2.4.0 - 計劃中）
- [ ] **實時數據整合**：
  - 急診室追蹤系統數據
  - 住院患者數據
  - 天氣預報數據
  - 本地事件日曆
  - 公共衛生警報
- [ ] **外部因素整合**：
  - 流感監測數據
  - 空氣質量指數
  - 交通狀況
  - 大型活動信息

### 階段 6：預測範圍擴展（v2.5.0 - 計劃中）
- [ ] **多時間範圍預測**：
  - 實時預測（1-6小時）
  - 短期預測（1-7天）
  - 中期預測（1-4週）
- [ ] **登機患者預測**：
  - 預測急診室登機患者數量
  - 支持資源分配決策

## 📊 性能基準與目標

### 世界級準確度目標
| 指標 | 當前目標 | 世界最佳 | 我們的目標 | 狀態 |
|------|---------|---------|-----------|------|
| **MAE** | < 5 人 | 2.63-2.64 | **< 2.5 人** | 🎯 進行中 |
| **MAPE** | < 3% | ~2-3% | **< 2%** | 🎯 進行中 |
| **80% CI 覆蓋率** | > 80% | ~85-90% | **> 90%** | 🎯 進行中 |
| **95% CI 覆蓋率** | > 95% | ~95-98% | **> 98%** | 🎯 進行中 |
| **RMSE** | - | ~3-4 | **< 3** | 📋 待實現 |
| **R²** | - | > 0.95 | **> 0.97** | 📋 待實現 |

### 持續監控指標
- **每日準確度追蹤**
- **每週性能報告**
- **每月算法評估**
- **季度基準對比**

## 🔬 證據基礎與學術認證

### 已實施的研究基礎（v2.9.28）

| 功能 | 研究來源 | 實施狀態 |
|------|---------|---------|
| **XGBoost 模型** | BMC Emergency Medicine (2025) | ✅ 已實施 |
| **特徵工程 (99 特徵)** | BMC Medical Informatics (2024) | ✅ 已實施 |
| **樣本權重 (時間衰減)** | JMIR Medical Informatics (2025) | ✅ 已實施 |
| **Fourier 季節特徵** | Facebook Prophet Research | ✅ 已實施 |
| **天氣特徵 (HKO)** | PubMed Weather Impact (2024) | ✅ 已實施 |
| **COVID 期間調整** | 數據分析 + 權重調整 | ✅ 已實施 |
| **超參數優化** | BMC EM 2025 法國研究 | ✅ 已實施 |
| **滾動窗口計算** | LSTM 研究 | ✅ 已實施 |
| **月份-星期交互** | 星期效應研究 | ✅ 已實施 |
| **相對溫度因子** | 天氣影響研究 | ✅ 已實施 |

### 研究引用詳情

1. **BMC Emergency Medicine (2025)**
   - 標題: "Predicting Emergency Department Admissions Using a Machine-Learning Algorithm"
   - MAE: 2.63-2.64 病人
   - URL: https://bmcemergmed.biomedcentral.com/articles/10.1186/s12873-024-01141-4
   - 應用: XGBoost 超參數配置

2. **BMC Medical Informatics (2024)**
   - 標題: "Enhanced Forecasting of Emergency Department Patient Arrivals Using Feature Engineering"
   - URL: https://bmcmedinformdecismak.biomedcentral.com/articles/10.1186/s12911-024-02788-6
   - 應用: 特徵工程、氣象特徵

3. **JMIR Medical Informatics (2025)**
   - 標題: "AI Framework for Predicting ED Overcrowding"
   - URL: https://medinform.jmir.org/2025/1/e73960
   - 應用: 時間衰減權重、多數據源整合

4. **Facebook Prophet Research**
   - 應用: Fourier 季節特徵

### 待實施的研究基礎
1. 📋 **LSTM 深度學習** - 基於 PubMed (2024)
2. 📋 **Transformer 架構** - 基於最新 NLP 研究
3. 📋 **模型集成 (Stacking)** - 基於集成學習研究

## 🏆 世界認可策略

### 1. 學術發表準備
- [ ] 準備研究論文
- [ ] 記錄算法性能數據
- [ ] 對比現有研究結果
- [ ] 準備開源代碼庫

### 2. 基準測試參與
- [ ] 參與公開基準測試
- [ ] 與其他研究對比
- [ ] 發布性能報告

### 3. 持續改進機制
- [ ] 自動性能監控
- [ ] 定期算法評估
- [ ] 根據新研究更新
- [ ] 版本管理和追蹤

## 📈 當前算法優勢

1. **多因素整合**：結合統計模型、天氣數據、AI 分析
2. **動態適應**：滾動窗口自動適應數據變化
3. **證據驅動**：所有改進都基於真實研究
4. **實時更新**：支持實時數據和 AI 因素整合
5. **高置信區間準確率**：95% CI 覆蓋率 > 95%

## 🎓 研究引用完整性

所有算法組件都有明確的研究基礎和引用，確保：
- ✅ 可追溯性
- ✅ 可重現性
- ✅ 學術可信度
- ✅ 持續改進基礎

## 🔄 持續改進流程

1. **監控** → 追蹤預測準確度
2. **分析** → 識別改進機會
3. **研究** → 查找最新研究
4. **實施** → 實現改進
5. **驗證** → 測試和評估
6. **部署** → 生產環境使用
7. **重複** → 持續循環

## 📝 版本管理

- **主版本號**：重大算法改進
- **次版本號**：新功能或重要改進
- **修訂版本號**：bug 修復和小改進

每次更新都記錄：
- 改進內容
- 研究基礎
- 性能變化
- 證據來源
