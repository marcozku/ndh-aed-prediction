/**
 * XGBoost 預測器模組
 * 調用 Python XGBoost 預測腳本
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class EnsemblePredictor {
    constructor() {
        this.pythonScript = path.join(__dirname, '../python/predict.py');
        this.modelsDir = path.join(__dirname, '../python/models');
    }

    /**
     * 檢查模型是否已訓練
     */
    isModelAvailable() {
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
     * 獲取模型狀態（詳細版本）
     */
    getModelStatus() {
        const modelFiles = {
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
        }

        return {
            available: this.isModelAvailable(),
            models: models,
            modelsDir: this.modelsDir,
            details: modelDetails,
            // 檢查目錄是否存在
            modelsDirExists: fs.existsSync(this.modelsDir),
            // 列出目錄中的所有文件
            allFiles: fs.existsSync(this.modelsDir) ? fs.readdirSync(this.modelsDir) : []
        };
    }
}

module.exports = { EnsemblePredictor };

