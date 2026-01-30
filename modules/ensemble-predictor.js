/**
 * XGBoost 預測器模組
 * v3.2.01: 最佳 10 特徵 + Optuna 優化參數
 * 調用 Python XGBoost 預測腳本
 *
 * 模型性能數據從數據庫動態獲取，不使用硬編碼值
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class EnsemblePredictor {
    constructor() {
        this.pythonScript = path.join(__dirname, '../python/predict.py');
        this.modelsDir = path.join(__dirname, '../python/models');
        // v3.2.00: 優先使用最佳 10 特徵模型
        this.preferredModel = 'opt10'; // 'opt10' or 'xgboost'
    }

    /**
     * 檢查模型是否已訓練
     * v3.2.00: 優先檢查 opt10 模型，然後檢查標準 xgboost 模型
     */
    isModelAvailable() {
        // 優先使用最佳 10 特徵模型
        if (this.isOpt10ModelAvailable()) {
            this.preferredModel = 'opt10';
            return true;
        }
        // 回退到標準 XGBoost 模型
        this.preferredModel = 'xgboost';
        return this.isStandardModelAvailable();
    }

    /**
     * 檢查最佳 10 特徵模型是否可用
     */
    isOpt10ModelAvailable() {
        const requiredFiles = [
            'xgboost_opt10_model.json',
            'xgboost_opt10_features.json'
        ];

        return requiredFiles.every(file => {
            const filePath = path.join(this.modelsDir, file);
            return fs.existsSync(filePath);
        });
    }

    /**
     * 檢查標準 XGBoost 模型是否可用
     */
    isStandardModelAvailable() {
        const requiredFiles = [
            'xgboost_model.json',
            'xgboost_features.json'
        ];

        return requiredFiles.every(file => {
            const filePath = path.join(this.modelsDir, file);
            return fs.existsSync(filePath);
        });
    }

    /**
     * 獲取當前使用的模型類型
     */
    getCurrentModel() {
        return this.preferredModel;
    }

    /**
     * 執行集成預測
     * @param {string} targetDate - 目標日期 (YYYY-MM-DD)
     * @param {Array} historicalData - 歷史數據數組 [{date, attendance}, ...]
     * @returns {Promise<Object>} 預測結果
     */
    async predict(targetDate, historicalData = null) {
        return new Promise((resolve, reject) => {
            // 檢查模型是否可用
            if (!this.isModelAvailable()) {
                return reject(new Error('XGBoost 模型未訓練。請先運行 python/train_all_models.py'));
            }

            // 準備 Python 命令
            const python = spawn('python3', [
                this.pythonScript,
                targetDate
            ], {
                cwd: path.join(__dirname, '..'),
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let output = '';
            let error = '';

            python.stdout.on('data', (data) => {
                output += data.toString();
            });

            python.stderr.on('data', (data) => {
                error += data.toString();
            });

            python.on('close', (code) => {
                if (code === 0) {
                    try {
                        const result = JSON.parse(output);
                        resolve(result);
                    } catch (e) {
                        reject(new Error(`無法解析 Python 輸出: ${e.message}\n輸出: ${output}`));
                    }
                } else {
                    reject(new Error(`Python 腳本錯誤 (code ${code}): ${error || output}`));
                }
            });

            python.on('error', (err) => {
                reject(new Error(`無法執行 Python 腳本: ${err.message}\n請確保已安裝 Python 3 和所有依賴`));
            });
        });
    }

    /**
     * 獲取模型狀態（詳細版本）- 同步版本，從文件讀取
     * v3.2.00: 支持檢查 opt10 和 xgboost 模型
     */
    getModelStatus() {
        const modelFiles = {
            opt10: {
                model: 'xgboost_opt10_model.json',
                features: 'xgboost_opt10_features.json',
                metrics: 'xgboost_opt10_metrics.json'
            },
            xgboost: {
                model: 'xgboost_model.json',
                features: 'xgboost_features.json',
                metrics: 'xgboost_metrics.json'
            }
        };

        const models = {};
        const modelDetails = {};

        for (const [modelKey, files] of Object.entries(modelFiles)) {
            const modelFile = files.model;
            const modelPath = path.join(this.modelsDir, modelFile);
            const exists = fs.existsSync(modelPath);

            models[modelKey] = exists;

            // 獲取詳細信息
            modelDetails[modelKey] = {
                exists: exists,
                path: modelPath,
                fileSize: exists ? fs.statSync(modelPath).size : 0,
                lastModified: exists ? fs.statSync(modelPath).mtime : null,
                requiredFiles: {}
            };

            // 檢查所有必需文件
            for (const [fileKey, fileName] of Object.entries(files)) {
                const filePath = path.join(this.modelsDir, fileName);
                modelDetails[modelKey].requiredFiles[fileKey] = {
                    name: fileName,
                    exists: fs.existsSync(filePath),
                    path: filePath
                };
            }

            // 讀取 metrics 文件內容（如果存在）- 用於快速檢查
            const metricsPath = path.join(this.modelsDir, files.metrics);
            if (fs.existsSync(metricsPath)) {
                try {
                    const metricsContent = fs.readFileSync(metricsPath, 'utf8');
                    modelDetails[modelKey].metrics = JSON.parse(metricsContent);
                    modelDetails[modelKey].metricsSource = 'file';
                } catch (err) {
                    console.error(`無法讀取 ${modelKey} metrics:`, err.message);
                    modelDetails[modelKey].metrics = null;
                }
            }
        }

        // 確定當前使用的模型
        const currentModel = this.isOpt10ModelAvailable() ? 'opt10' : 'xgboost';

        return {
            available: this.isModelAvailable(),
            currentModel: currentModel,
            models: models,
            modelsDir: this.modelsDir,
            details: modelDetails,
            // v3.2.00: 優先返回當前使用模型的 metrics
            opt10: modelDetails.opt10 || null,
            xgboost: modelDetails.xgboost || null,
            current: modelDetails[currentModel] || null,
            // 檢查目錄是否存在
            modelsDirExists: fs.existsSync(this.modelsDir),
            // 列出目錄中的所有文件
            allFiles: fs.existsSync(this.modelsDir) ? fs.readdirSync(this.modelsDir) : []
        };
    }

    /**
     * 獲取模型狀態（異步版本）- 優先從數據庫讀取 metrics
     */
    async getModelStatusAsync() {
        const status = this.getModelStatus();
        // v3.2.02: 優先使用當前模型的 metrics（opt10 優先於 xgboost）
        const currentModel = status.currentModel || 'xgboost';
        const fileMetrics = status[currentModel]?.metrics ||
                           status.details?.[currentModel]?.metrics ||
                           status.xgboost?.metrics ||
                           status.details?.xgboost?.metrics;
        
        // 優先從數據庫讀取 metrics，但比較日期選擇最新的
        try {
            const db = require('../database');
            const dbMetrics = await db.getModelMetrics('xgboost');
            
            if (dbMetrics && dbMetrics.mae !== null) {
                // 安全地解析日期，處理無效日期
                let dbDate = new Date(0);
                if (dbMetrics.training_date) {
                    const parsedDbDate = new Date(dbMetrics.training_date);
                    if (!isNaN(parsedDbDate.getTime())) {
                        dbDate = parsedDbDate;
                    }
                }
                
                let fileDate = new Date(0);
                if (fileMetrics?.training_date) {
                    const parsedFileDate = new Date(fileMetrics.training_date);
                    if (!isNaN(parsedFileDate.getTime())) {
                        fileDate = parsedFileDate;
                    }
                }
                
                // 使用較新的數據源
                const useDatabase = dbDate >= fileDate;
                
                if (useDatabase) {
                    const metrics = {
                        mae: parseFloat(dbMetrics.mae),
                        mape: parseFloat(dbMetrics.mape),
                        rmse: parseFloat(dbMetrics.rmse),
                        r2: dbMetrics.r2 ? parseFloat(dbMetrics.r2) : null,
                        training_date: dbMetrics.training_date,
                        data_count: dbMetrics.data_count,
                        train_count: dbMetrics.train_count,
                        test_count: dbMetrics.test_count,
                        feature_count: dbMetrics.feature_count,
                        ai_factors_count: dbMetrics.ai_factors_count
                    };
                    
                    // 更新 status 中的 metrics
                    if (status.details && status.details.xgboost) {
                        status.details.xgboost.metrics = metrics;
                        status.details.xgboost.metricsSource = 'database';
                    }
                    if (status.xgboost) {
                        status.xgboost.metrics = metrics;
                        status.xgboost.metricsSource = 'database';
                    }
                } else {
                    // 文件較新，保持 status 中的 file metrics
                    console.log('📊 使用文件版本的 metrics (較新):', fileDate.toISOString());
                    if (status.details && status.details.xgboost) {
                        status.details.xgboost.metricsSource = 'file';
                    }
                    if (status.xgboost) {
                        status.xgboost.metricsSource = 'file';
                    }
                }
            }
        } catch (e) {
            console.warn('從數據庫讀取模型指標失敗，使用文件版本:', e.message);
        }
        
        return status;
    }
}

module.exports = { EnsemblePredictor };

