const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class EnsemblePredictor {
    constructor() {
        this.pythonScript = path.join(__dirname, '../python/predict.py');
        this.modelsDir = path.join(__dirname, '../python/models');
        this.preferredModel = 'horizon_direct';
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

    async getPythonVersion(command) {
        return new Promise((resolve) => {
            const python = spawn(command, ['--version'], { stdio: 'pipe' });
            let output = '';
            let errorOutput = '';

            python.stdout.on('data', (data) => {
                output += data.toString();
            });

            python.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            python.on('close', (code) => {
                resolve(code === 0 ? (output || errorOutput).trim() : null);
            });

            python.on('error', () => {
                resolve(null);
            });
        });
    }

    async checkRuntimeStatus() {
        const pythonCommand = await this.detectPythonCommand();

        if (!pythonCommand) {
            return {
                ready: false,
                python: {
                    available: false,
                    command: null,
                    version: null
                },
                dependencies: {
                    available: false,
                    output: '',
                    error: 'Python command not found'
                },
                error: 'Python command not found'
            };
        }

        const version = await this.getPythonVersion(pythonCommand);

        const dependencies = await new Promise((resolve) => {
            const python = spawn(
                pythonCommand,
                ['-c', 'import xgboost; print("OK")'],
                {
                    cwd: path.join(__dirname, '..', 'python'),
                    stdio: ['pipe', 'pipe', 'pipe']
                }
            );

            let output = '';
            let error = '';

            python.stdout.on('data', (data) => {
                output += data.toString();
            });

            python.stderr.on('data', (data) => {
                error += data.toString();
            });

            python.on('close', (code) => {
                resolve({
                    available: code === 0,
                    output: output.trim(),
                    error: error.trim() || null
                });
            });

            python.on('error', (err) => {
                resolve({
                    available: false,
                    output: '',
                    error: err.message
                });
            });
        });

        return {
            ready: dependencies.available,
            python: {
                available: true,
                command: pythonCommand,
                version
            },
            dependencies,
            error: dependencies.available ? null : (dependencies.error || 'Python dependencies unavailable')
        };
    }

    normalizeMetrics(metrics = {}) {
        const toNumber = (value) => {
            const num = Number(value);
            return Number.isFinite(num) ? num : null;
        };

        const trainCount = toNumber(metrics.train_count ?? metrics.train_size);
        const testCount = toNumber(metrics.test_count ?? metrics.test_size);

        return {
            mae: toNumber(metrics.mae),
            mape: toNumber(metrics.mape),
            rmse: toNumber(metrics.rmse),
            r2: toNumber(metrics.r2),
            training_date: metrics.training_date || null,
            data_count: toNumber(metrics.data_count) ?? ((trainCount || 0) + (testCount || 0) || null),
            train_count: trainCount,
            test_count: testCount,
            feature_count: toNumber(metrics.feature_count ?? metrics.n_features),
            ai_factors_count: toNumber(metrics.ai_factors_count),
            baseline_mae: toNumber(metrics.baseline_mae),
            improvement_vs_baseline: metrics.improvement_vs_baseline || null
        };
    }

    parseMetricDate(value) {
        if (!value) {
            return new Date(0);
        }

        const parsed = new Date(String(value).replace(' HKT', '').trim());
        return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
    }

    isHorizonModelAvailable() {
        const requiredFiles = [
            'horizon_model_bundle.json',
            'horizon_short_model.json',
            'horizon_h7_model.json',
            'horizon_h14_model.json',
            'horizon_h30_model.json'
        ];

        return requiredFiles.every((file) => fs.existsSync(path.join(this.modelsDir, file)));
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
        if (this.isHorizonModelAvailable()) {
            this.preferredModel = 'horizon_direct';
            return true;
        }

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
            throw new Error('XGBoost 模型未訓練，請先執行 python/train_all_models.py');
        }

        const pythonCommand = await this.detectPythonCommand();
        if (!pythonCommand) {
            throw new Error('找不到可用的 Python 指令，請確認 python3 或 python 已加入 PATH');
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
                    reject(new Error(`Python 執行失敗 (code ${code}): ${error || output}`));
                    return;
                }

                try {
                    resolve(JSON.parse(output));
                } catch (err) {
                    reject(new Error(`無法解析 Python 輸出: ${err.message}\n輸出: ${output}`));
                }
            });

            python.on('error', (err) => {
                reject(new Error(`無法啟動 Python: ${err.message}`));
            });
        });
    }

    getModelStatus() {
        const modelFiles = {
            horizon_direct: {
                model: 'horizon_model_bundle.json',
                metrics: 'xgboost_metrics.json',
                required: [
                    'horizon_short_model.json',
                    'horizon_h7_model.json',
                    'horizon_h14_model.json',
                    'horizon_h30_model.json',
                    'horizon_walk_forward_report.json'
                ]
            },
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
                if (Array.isArray(fileName)) {
                    continue;
                }
                const filePath = path.join(this.modelsDir, fileName);
                modelDetails[modelKey].requiredFiles[fileKey] = {
                    name: fileName,
                    exists: fs.existsSync(filePath),
                    path: filePath
                };
            }

            for (const requiredName of files.required || []) {
                const filePath = path.join(this.modelsDir, requiredName);
                modelDetails[modelKey].requiredFiles[requiredName] = {
                    name: requiredName,
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
                    console.error(`無法解析 ${modelKey} metrics:`, err.message);
                    modelDetails[modelKey].metrics = null;
                }
            }
        }

        const currentModel = this.isHorizonModelAvailable()
            ? 'horizon_direct'
            : (this.isOpt10ModelAvailable() ? 'opt10' : 'xgboost');

        return {
            available: this.isModelAvailable(),
            currentModel,
            models,
            modelsDir: this.modelsDir,
            details: modelDetails,
            horizon_direct: modelDetails.horizon_direct || null,
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
        const currentDetails = status.details?.[currentModel] || status.current || null;
        const fileMetrics = currentDetails?.metrics || null;
        const fileModels = { ...status.models };
        const runtime = await this.checkRuntimeStatus();

        try {
            const db = require('../database');
            const metricCandidates = currentModel === 'horizon_direct'
                ? ['horizon_direct', 'xgboost']
                : [currentModel];
            let dbMetrics = null;

            for (const modelName of metricCandidates) {
                const candidate = await db.getModelMetrics(modelName);
                if (candidate && candidate.mae !== null) {
                    dbMetrics = candidate;
                    break;
                }
            }

            if (dbMetrics && dbMetrics.mae !== null) {
                const dbDate = this.parseMetricDate(dbMetrics.training_date);
                const fileDate = this.parseMetricDate(fileMetrics?.training_date);

                if (dbDate >= fileDate) {
                    const metrics = this.normalizeMetrics(dbMetrics);
                    if (status.details?.[currentModel]) {
                        status.details[currentModel].metrics = metrics;
                        status.details[currentModel].metricsSource = 'database';
                    }
                    if (status[currentModel]) {
                        status[currentModel].metrics = metrics;
                        status[currentModel].metricsSource = 'database';
                    }
                    if (status.current) {
                        status.current.metrics = metrics;
                        status.current.metricsSource = 'database';
                    }
                } else if (status.details?.[currentModel]) {
                    status.details[currentModel].metricsSource = 'file';
                    if (status[currentModel]) {
                        status[currentModel].metricsSource = 'file';
                    }
                    if (status.current) {
                        status.current.metricsSource = 'file';
                    }
                }
            }
        } catch (error) {
            console.warn('讀取資料庫模型指標失敗，改用檔案指標:', error.message);
        }

        status.fileAvailable = status.available;
        status.fileModels = fileModels;
        status.runtime = runtime;
        status.available = status.available && runtime.ready;
        status.models = Object.fromEntries(
            Object.entries(fileModels).map(([modelKey, exists]) => [modelKey, exists && runtime.ready])
        );

        return status;
    }

    async rollingForecast(startDate, days, historicalDataPath) {
        if (!this.isModelAvailable()) {
            throw new Error('XGBoost 模型未訓練，請先執行 python/train_all_models.py');
        }

        const pythonCommand = await this.detectPythonCommand();
        if (!pythonCommand) {
            throw new Error('找不到可用的 Python 指令，請確認 python3 或 python 已加入 PATH');
        }

        return new Promise((resolve, reject) => {
            const rollingPredictScript = path.join(__dirname, '../python/rolling_predict.py');
            const args = [
                rollingPredictScript,
                startDate,
                String(days)
            ];

            if (historicalDataPath) {
                args.push(historicalDataPath);
            }

            console.log(`開始 ${days} 天 direct multi-horizon 預測 (起始 ${startDate})`);

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
                error += data.toString();
            });

            python.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`滾動預測失敗 (code ${code}): ${error || output}`));
                    return;
                }

                try {
                    resolve(JSON.parse(output));
                } catch (err) {
                    reject(new Error(`無法解析滾動預測輸出: ${err.message}\n輸出: ${output}`));
                }
            });

            python.on('error', (err) => {
                reject(new Error(`無法啟動滾動預測: ${err.message}`));
            });
        });
    }
}

module.exports = { EnsemblePredictor };
