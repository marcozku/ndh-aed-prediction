/**
 * XGBoost 預測器模組
 * 支持標準模型與 opt10 模型，並在執行時自動檢測可用的 Python 命令。
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class EnsemblePredictor {
    constructor() {
        this.pythonScript = path.join(__dirname, '../python/predict.py');
        this.modelsDir = path.join(__dirname, '../python/models');
        this.preferredModel = 'opt10';
        this.pythonCommand = null;
    }

    detectPythonCommand() {
        if (this.pythonCommand) {
            return Promise.resolve(this.pythonCommand);
        }

        const commands = ['python3', 'python'];

        return new Promise((resolve) => {
            const tryCommand = (index) => {
                if (index >= commands.length) {
                    resolve(null);
                    return;
                }

                const command = commands[index];
                const python = spawn(command, ['--version'], { stdio: 'pipe' });

                python.on('close', (code) => {
                    if (code === 0) {
                        this.pythonCommand = command;
                        resolve(command);
                        return;
                    }

                    tryCommand(index + 1);
                });

                python.on('error', () => {
                    tryCommand(index + 1);
                });
            };

            tryCommand(0);
        });
    }

    isOpt10ModelAvailable() {
        const requiredFiles = [
            'xgboost_opt10_model.json',
            'xgboost_opt10_features.json'
        ];

        return requiredFiles.every((file) => fs.existsSync(path.join(this.modelsDir, file)));
    }

    isStandardModelAvailable() {
        const requiredFiles = [
            'xgboost_model.json',
            'xgboost_features.json'
        ];

        return requiredFiles.every((file) => fs.existsSync(path.join(this.modelsDir, file)));
    }

    isModelAvailable() {
        if (this.isOpt10ModelAvailable()) {
            this.preferredModel = 'opt10';
            return true;
        }

        this.preferredModel = 'xgboost';
        return this.isStandardModelAvailable();
    }

    getCurrentModel() {
        return this.preferredModel;
    }

    async predict(targetDate, historicalData = null) {
        void historicalData;

        if (!this.isModelAvailable()) {
            throw new Error('XGBoost 模型未訓練。請先運行 python/train_all_models.py');
        }

        const pythonCommand = await this.detectPythonCommand();
        if (!pythonCommand) {
            throw new Error('無法找到 Python 執行檔。請確認 python3 或 python 可於 PATH 使用。');
        }

        return new Promise((resolve, reject) => {
            const python = spawn(pythonCommand, [
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
                if (code !== 0) {
                    reject(new Error(`Python 腳本錯誤 (code ${code}): ${error || output}`));
                    return;
                }

                try {
                    resolve(JSON.parse(output));
                } catch (err) {
                    reject(new Error(`無法解析 Python 輸出: ${err.message}\n輸出: ${output}`));
                }
            });

            python.on('error', (err) => {
                reject(new Error(`無法執行 Python 腳本: ${err.message}`));
            });
        });
    }

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
            const modelPath = path.join(this.modelsDir, files.model);
            const exists = fs.existsSync(modelPath);

            models[modelKey] = exists;
            modelDetails[modelKey] = {
                exists,
                path: modelPath,
                fileSize: exists ? fs.statSync(modelPath).size : 0,
                lastModified: exists ? fs.statSync(modelPath).mtime : null,
                requiredFiles: {}
            };

            for (const [fileKey, fileName] of Object.entries(files)) {
                const filePath = path.join(this.modelsDir, fileName);
                modelDetails[modelKey].requiredFiles[fileKey] = {
                    name: fileName,
                    exists: fs.existsSync(filePath),
                    path: filePath
                };
            }

            const metricsPath = path.join(this.modelsDir, files.metrics);
            if (fs.existsSync(metricsPath)) {
                try {
                    modelDetails[modelKey].metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
                    modelDetails[modelKey].metricsSource = 'file';
                } catch (err) {
                    console.error(`無法讀取 ${modelKey} metrics:`, err.message);
                    modelDetails[modelKey].metrics = null;
                }
            }
        }

        const currentModel = this.isOpt10ModelAvailable() ? 'opt10' : 'xgboost';

        return {
            available: this.isModelAvailable(),
            currentModel,
            models,
            modelsDir: this.modelsDir,
            details: modelDetails,
            opt10: modelDetails.opt10 || null,
            xgboost: modelDetails.xgboost || null,
            current: modelDetails[currentModel] || null,
            modelsDirExists: fs.existsSync(this.modelsDir),
            allFiles: fs.existsSync(this.modelsDir) ? fs.readdirSync(this.modelsDir) : []
        };
    }

    async getModelStatusAsync() {
        const status = this.getModelStatus();
        const currentModel = status.currentModel || 'xgboost';
        const fileMetrics = status[currentModel]?.metrics ||
                           status.details?.[currentModel]?.metrics ||
                           status.xgboost?.metrics ||
                           status.details?.xgboost?.metrics;

        try {
            const db = require('../database');
            const dbMetrics = await db.getModelMetrics('xgboost');

            if (dbMetrics && dbMetrics.mae !== null) {
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

                if (dbDate >= fileDate) {
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

                    if (status.details?.xgboost) {
                        status.details.xgboost.metrics = metrics;
                        status.details.xgboost.metricsSource = 'database';
                    }
                    if (status.xgboost) {
                        status.xgboost.metrics = metrics;
                        status.xgboost.metricsSource = 'database';
                    }
                } else {
                    console.log('📊 使用文件版本的 metrics (較新):', fileDate.toISOString());
                    if (status.details?.xgboost) {
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

    async rollingForecast(startDate, days, historicalDataPath) {
        if (!this.isModelAvailable()) {
            throw new Error('XGBoost 模型未訓練。請先運行 python/train_all_models.py');
        }

        const pythonCommand = await this.detectPythonCommand();
        if (!pythonCommand) {
            throw new Error('無法找到 Python 執行檔。請確認 python3 或 python 可於 PATH 使用。');
        }

        return new Promise((resolve, reject) => {
            const ensemblePredictScript = path.join(__dirname, '../python/ensemble_predict.py');
            const args = [
                ensemblePredictScript,
                '--rolling',
                startDate,
                String(days)
            ];

            if (historicalDataPath) {
                args.push(historicalDataPath);
            }

            console.log(`🔄 啟動 ${days} 天滾動預測 (從 ${startDate})`);

            const python = spawn(pythonCommand, args, {
                cwd: path.join(__dirname, '..'),
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let output = '';
            let error = '';

            python.stdout.on('data', (data) => {
                output += data.toString();
            });

            python.stderr.on('data', (data) => {
                const message = data.toString();
                error += message;
                if (message.includes('📊') || message.includes('🔄')) {
                    console.log(message.trim());
                }
            });

            python.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`滾動預測錯誤 (code ${code}): ${error || output}`));
                    return;
                }

                try {
                    const result = JSON.parse(output);
                    console.log(`✅ 滾動預測完成: ${result.predictions?.length || 0} 天`);
                    resolve(result);
                } catch (err) {
                    reject(new Error(`無法解析滾動預測輸出: ${err.message}\n輸出: ${output}`));
                }
            });

            python.on('error', (err) => {
                reject(new Error(`無法執行滾動預測: ${err.message}`));
            });
        });
    }
}

module.exports = { EnsemblePredictor };
