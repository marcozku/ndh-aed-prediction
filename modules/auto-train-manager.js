/**
 * 自動訓練管理器
 * 當有新實際數據時，自動觸發模型重訓練
 * 訓練狀態現在使用 PostgreSQL 數據庫持久化，解決 Railway 部署後狀態重置問題
 * v2.9.20: 添加 SSE 實時日誌推送功能
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class AutoTrainManager {
    constructor() {
        this.isTraining = false;
        this.lastTrainingDate = null;
        this.lastDataCount = 0;
        this.trainingQueue = [];
        this.trainingStartTime = null;  // 訓練開始時間
        this.estimatedDuration = 30 * 60 * 1000;  // 預估訓練時間：30 分鐘（毫秒）
        this.lastTrainingOutput = '';  // 上次訓練的輸出
        this.lastTrainingError = '';  // 上次訓練的錯誤
        this._dbInitialized = false;  // 標記是否已從 DB 載入狀態
        this.currentProcess = null;  // 當前訓練進程引用
        this.currentTimeout = null;  // 當前超時計時器
        this.wasStopped = false;  // 標記是否被用戶停止
        
        // SSE 客戶端管理
        this.sseClients = new Set();  // 存儲所有連接的 SSE 客戶端
        
        // 配置
        this.config = {
            minDaysSinceLastTrain: 0,      // 至少間隔 0 天（允許同一天多次訓練，如果數據足夠）
            minNewDataRecords: 1,           // 至少 1 筆新數據才觸發（降低門檻，更靈敏）
            maxTrainingInterval: 7,         // 最多 7 天訓練一次
            trainingTimeout: 3600000,       // 訓練超時：1 小時
            enableAutoTrain: process.env.ENABLE_AUTO_TRAIN !== 'false', // 默認啟用
            // 🔬 自動特徵優化配置 (v2.9.52)
            enableAutoOptimize: process.env.ENABLE_AUTO_OPTIMIZE !== 'false', // 默認啟用
            optimizeEveryNTrains: 5,        // 每 5 次訓練自動優化一次特徵
            optimizeOnNewData: 50           // 每 50 筆新數據自動優化一次
        };
        
        // 優化追蹤
        this.trainCountSinceOptimize = 0;
        this.dataCountSinceOptimize = 0;
        this.lastOptimizeDate = null;
        this.isOptimizing = false;
        
        // 確保模型目錄存在
        const modelsDir = path.join(__dirname, '../python/models');
        if (!fs.existsSync(modelsDir)) {
            try {
                fs.mkdirSync(modelsDir, { recursive: true });
                console.log(`📁 創建模型目錄: ${modelsDir}`);
            } catch (err) {
                console.warn(`⚠️ 無法創建模型目錄: ${err.message}`);
            }
        }
    }

    /**
     * 從數據庫加載訓練狀態
     */
    async _loadTrainingStatusFromDB() {
        if (this._dbInitialized) return;
        
        try {
            const db = require('../database');
            const status = await db.getTrainingStatus('xgboost');
            
            if (status) {
                this.lastTrainingDate = status.last_training_date || status.updated_at || null;
                this.lastDataCount = status.last_data_count || 0;
                this.lastTrainingOutput = status.last_training_output || '';
                this.lastTrainingError = status.last_training_error || '';
                
                // 檢查是否仍在訓練中（DB 函數已處理超時重置）
                if (status.is_training && status.training_start_time) {
                    this.isTraining = true;
                    this.trainingStartTime = status.training_start_time;
                }
                
                console.log('✅ 從數據庫載入訓練狀態:', {
                    lastTrainingDate: this.lastTrainingDate,
                    lastDataCount: this.lastDataCount,
                    isTraining: this.isTraining
                });
            }
            this._dbInitialized = true;
        } catch (e) {
            console.warn('⚠️ 無法從數據庫加載訓練狀態:', e.message);
        }
    }

    /**
     * 保存模型指標到數據庫（訓練完成後調用）
     */
    async _saveModelMetricsToDB() {
        try {
            const metricsPath = path.join(__dirname, '../python/models/xgboost_metrics.json');
            
            if (!fs.existsSync(metricsPath)) {
                console.warn('⚠️ 模型指標文件不存在，跳過保存到數據庫');
                return null;
            }
            
            const metricsData = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
            
            const db = require('../database');
            const result = await db.saveModelMetrics('xgboost', {
                mae: metricsData.mae,
                rmse: metricsData.rmse,
                mape: metricsData.mape,
                r2: metricsData.r2,
                training_date: metricsData.training_date || new Date().toISOString(),
                data_count: metricsData.data_count,
                train_count: metricsData.train_count,
                test_count: metricsData.test_count,
                feature_count: metricsData.feature_count,
                ai_factors_count: metricsData.ai_factors_count || 0
            });
            
            console.log('✅ 模型指標已同步到數據庫');
            return result;
        } catch (e) {
            console.error('❌ 保存模型指標到數據庫失敗:', e.message);
            return null;
        }
    }

    /**
     * 保存訓練狀態到數據庫
     */
    async _saveTrainingStatusToDB(dataCount = null, isTraining = false) {
        try {
            const db = require('../database');
            
            // 如果訓練完成（isTraining = false），更新 lastTrainingDate
            if (!isTraining && this.isTraining) {
                this.lastTrainingDate = new Date().toISOString();
            }
            
            const status = {
                isTraining: isTraining,
                lastTrainingDate: !isTraining ? this.lastTrainingDate : null,
                lastDataCount: dataCount !== null ? dataCount : this.lastDataCount,
                trainingStartTime: isTraining ? (this.trainingStartTime || new Date().toISOString()) : null,
                lastTrainingOutput: this.lastTrainingOutput || null,
                lastTrainingError: this.lastTrainingError || null
            };
            
            await db.saveTrainingStatus('xgboost', status);
        } catch (e) {
            console.warn('⚠️ 無法保存訓練狀態到數據庫:', e.message);
        }
    }

    /**
     * 運行天氣影響分析
     * 在訓練前分析天氣警告與出席人數的關係
     */
    async _runWeatherAnalysis() {
        return new Promise((resolve, reject) => {
            const { exec } = require('child_process');
            const analysisScript = path.join(__dirname, '../python/auto_weather_analysis.py');
            
            exec(`python "${analysisScript}"`, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                    return;
                }
                
                try {
                    const result = JSON.parse(stdout);
                    console.log(`   天氣分析: ${result.total_days} 天, ${result.factors?.length || 0} 個因子`);
                    resolve(result);
                } catch (parseErr) {
                    resolve({ message: 'Analysis completed', logs: stderr });
                }
            });
        });
    }

    /**
     * 檢查是否需要訓練
     */
    async shouldTrain(currentDataCount) {
        // 確保從 DB 加載最新狀態
        await this._loadTrainingStatusFromDB();
        
        if (!this.config.enableAutoTrain) {
            return { shouldTrain: false, reason: '自動訓練已禁用' };
        }

        // 如果正在訓練，不重複觸發
        if (this.isTraining) {
            return { shouldTrain: false, reason: '正在訓練中' };
        }

        // 檢查是否有足夠的新數據
        const newDataCount = currentDataCount - this.lastDataCount;
        if (newDataCount < this.config.minNewDataRecords) {
            return { 
                shouldTrain: false, 
                reason: `新數據不足（${newDataCount}/${this.config.minNewDataRecords}）` 
            };
        }

        // 檢查距離上次訓練的時間
        if (this.lastTrainingDate) {
            const daysSinceLastTrain = (Date.now() - new Date(this.lastTrainingDate).getTime()) / (1000 * 60 * 60 * 24);
            
            if (daysSinceLastTrain < this.config.minDaysSinceLastTrain) {
                return { 
                    shouldTrain: false, 
                    reason: `距離上次訓練時間太短（${daysSinceLastTrain.toFixed(1)} 天）` 
                };
            }

            // 如果超過最大間隔，強制訓練
            if (daysSinceLastTrain >= this.config.maxTrainingInterval) {
                return { 
                    shouldTrain: true, 
                    reason: `距離上次訓練已 ${daysSinceLastTrain.toFixed(1)} 天，需要重新訓練` 
                };
            }
        }

        // 有足夠新數據且滿足時間間隔
        return { 
            shouldTrain: true, 
            reason: `有 ${newDataCount} 筆新數據，滿足訓練條件` 
        };
    }

    /**
     * 獲取當前數據總數
     */
    async getCurrentDataCount(db) {
        if (!db || !db.pool) {
            return 0;
        }
        try {
            const result = await db.pool.query('SELECT COUNT(*) as count FROM actual_data');
            return parseInt(result.rows[0].count) || 0;
        } catch (e) {
            console.error('獲取數據總數失敗:', e.message);
            return 0;
        }
    }

    /**
     * 觸發訓練檢查（在數據更新後調用）
     * @param {Object} db - 數據庫連接
     * @param {boolean} forceOnDataChange - 如果為 true，無論數據數量變化如何都會觸發訓練
     */
    async triggerTrainingCheck(db, forceOnDataChange = false) {
        // 確保從 DB 加載最新狀態
        await this._loadTrainingStatusFromDB();
        
        if (!this.config.enableAutoTrain) {
            return { triggered: false, reason: '自動訓練已禁用' };
        }

        // 如果正在訓練，不重複觸發
        if (this.isTraining) {
            return { triggered: false, reason: '正在訓練中' };
        }

        try {
            const currentDataCount = await this.getCurrentDataCount(db);
            
            // 強制訓練模式：用戶數據變更時觸發
            if (forceOnDataChange) {
                console.log(`🤖 用戶數據更新，強制觸發訓練（當前數據: ${currentDataCount} 筆）`);
                this.startTraining(db, currentDataCount).catch(err => {
                    console.error('自動訓練失敗:', err);
                });
                return { triggered: true, reason: '用戶數據更新，強制訓練' };
            }
            
            const checkResult = await this.shouldTrain(currentDataCount);

            if (checkResult.shouldTrain) {
                console.log(`🤖 自動訓練觸發: ${checkResult.reason}`);
                // 異步觸發訓練，不阻塞
                this.startTraining(db, currentDataCount).catch(err => {
                    console.error('自動訓練失敗:', err);
                });
                return { triggered: true, reason: checkResult.reason };
            } else {
                return { triggered: false, reason: checkResult.reason };
            }
        } catch (error) {
            console.error('訓練檢查失敗:', error);
            return { triggered: false, reason: error.message };
        }
    }

    /**
     * 開始訓練（後台執行）
     */
    async startTraining(db, dataCount = null) {
        // 確保從 DB 加載最新狀態
        await this._loadTrainingStatusFromDB();
        
        if (this.isTraining) {
            console.log('⚠️ 訓練已在進行中，跳過');
            return { success: false, reason: '訓練已在進行中' };
        }

        this.isTraining = true;
        this.trainingStartTime = new Date().toISOString();
        this.wasStopped = false;  // 重置停止標記
        this.currentProcess = null;  // 重置進程引用
        this.currentTimeout = null;  // 重置超時計時器
        const startTime = Date.now();
        
        // 重置輸出，準備接收新的訓練日誌
        this.lastTrainingOutput = '';
        this.lastTrainingError = '';
        
        // 保存訓練開始狀態到 DB
        await this._saveTrainingStatusToDB(dataCount, true);

        // 📊 訓練前先運行天氣影響分析
        try {
            console.log('📊 運行天氣影響分析...');
            await this._runWeatherAnalysis();
            console.log('✅ 天氣影響分析完成');
        } catch (err) {
            console.warn('⚠️ 天氣影響分析失敗（非關鍵）:', err.message);
        }

        console.log('🚀 開始自動訓練模型...');
        console.log(`   時間: ${this.trainingStartTime}`);
        if (dataCount !== null) {
            console.log(`   數據總數: ${dataCount}`);
        }
        
        // 🔴 廣播訓練開始狀態
        this.broadcastStatusChange({
            isTraining: true,
            trainingStartTime: this.trainingStartTime,
            message: '🚀 開始訓練模型...'
        });

        return new Promise((resolve) => {
            // 確保模型目錄存在
            const modelsDir = path.join(__dirname, '../python/models');
            if (!fs.existsSync(modelsDir)) {
                fs.mkdirSync(modelsDir, { recursive: true });
                console.log(`📁 創建模型目錄: ${modelsDir}`);
            }
            
            const pythonScript = path.join(__dirname, '../python/train_all_models.py');
            
            // 檢測可用的 Python 命令
            const detectPython = () => {
                return new Promise((resolveCmd) => {
                    const commands = ['python3', 'python'];
                    let currentIndex = 0;
                    
                    const tryNext = () => {
                        if (currentIndex >= commands.length) {
                            resolveCmd(null);
                            return;
                        }
                        
                        const cmd = commands[currentIndex];
                        const test = spawn(cmd, ['--version'], { stdio: 'pipe' });
                        
                        test.on('close', (code) => {
                            if (code === 0) {
                                resolveCmd(cmd);
                            } else {
                                currentIndex++;
                                tryNext();
                            }
                        });
                        
                        test.on('error', () => {
                            currentIndex++;
                            tryNext();
                        });
                    };
                    
                    tryNext();
                });
            };
            
            // 使用檢測到的 Python 命令
            detectPython().then(async (pythonCmd) => {
                if (!pythonCmd) {
                    const error = '無法找到 Python 命令（嘗試了 python3 和 python）';
                    console.error(`❌ ${error}`);
                    this.isTraining = false;
                    this.trainingStartTime = null;
                    await this._saveTrainingStatusToDB(dataCount, false);
                    resolve({ success: false, reason: error });
                    return;
                }
                
                console.log(`🐍 使用 Python 命令: ${pythonCmd}`);
                console.log(`📝 訓練腳本: ${pythonScript}`);
                console.log(`📂 工作目錄: ${path.join(__dirname, '../python')}`);
                console.log(`📁 模型目錄: ${modelsDir}`);
                
                const python = spawn(pythonCmd, [pythonScript], {
                    cwd: path.join(__dirname, '../python'),  // 在 python 目錄下運行
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: { ...process.env, PYTHONUNBUFFERED: '1' }  // 確保輸出不被緩衝
                });
                
                // 保存進程引用以便停止
                this.currentProcess = python;
                
                this._attachPythonHandlers(python, resolve, startTime, dataCount, modelsDir);
            });
        });
    }

    /**
     * 附加 Python 進程處理器
     */
    _attachPythonHandlers(python, resolve, startTime, dataCount, modelsDir) {
        let output = '';
        let error = '';

        // 節流保存，避免過於頻繁的 DB 寫入
        let lastSaveTime = 0;
        const saveThrottle = 5000; // 每 5 秒最多保存一次（DB 操作較慢）
        
        python.stdout.on('data', (data) => {
            const text = data.toString();
            output += text;
            // 實時更新輸出，讓前端可以獲取
            this.lastTrainingOutput = output;
            console.log(`[訓練] ${text.trim()}`);
            
            // 🔴 實時廣播到所有 SSE 客戶端
            this.broadcastLog(text.trim(), false);
            
            // 節流保存狀態（每 5 秒最多保存一次）
            const now = Date.now();
            if (now - lastSaveTime >= saveThrottle) {
                this._saveTrainingStatusToDB(dataCount, true).catch(() => {});
                lastSaveTime = now;
            }
        });

        python.stderr.on('data', (data) => {
            const text = data.toString();
            error += text;
            // 實時更新錯誤輸出
            this.lastTrainingError = error;
            console.error(`[訓練錯誤] ${text.trim()}`);
            
            // 🔴 實時廣播錯誤到所有 SSE 客戶端
            this.broadcastLog(text.trim(), true);
            
            // 錯誤輸出節流保存
            const now = Date.now();
            if (now - lastSaveTime >= saveThrottle) {
                this._saveTrainingStatusToDB(dataCount, true).catch(() => {});
                lastSaveTime = now;
            }
        });

        // 設置超時
        const timeout = setTimeout(async () => {
            python.kill();
            this.isTraining = false;
            this.currentProcess = null;
            this.currentTimeout = null;
            await this._saveTrainingStatusToDB(dataCount, false);
            console.error('❌ 訓練超時（1小時）');
            resolve({ success: false, reason: '訓練超時', output: output, error: error });
        }, this.config.trainingTimeout);
        
        // 保存超時計時器引用
        this.currentTimeout = timeout;

        python.on('close', async (code) => {
            clearTimeout(timeout);
            this.isTraining = false;
            this.trainingStartTime = null;
            this.currentProcess = null;
            this.currentTimeout = null;
            const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
            
            // 檢查是否被用戶停止
            if (this.wasStopped) {
                console.log('🛑 訓練已被用戶停止');
                this.wasStopped = false;
                await this._saveTrainingStatusToDB(dataCount, false);
                resolve({ success: false, reason: '訓練已被用戶停止', stopped: true, output: output, error: error });
                return;
            }

            // 檢查模型文件是否存在
            const { EnsemblePredictor } = require('./ensemble-predictor');
            const predictor = new EnsemblePredictor();
            const modelStatus = predictor.getModelStatus();

            // 保存訓練輸出和錯誤
            this.lastTrainingOutput = output;
            this.lastTrainingError = error;
            
            if (code === 0) {
                if (modelStatus.available) {
                    console.log(`✅ 模型訓練完成（耗時 ${duration} 分鐘）`);
                    console.log(`✅ 模型文件驗證通過`);
                    
                    // 🔴 保存模型指標到數據庫（持久化）
                    this.lastTrainingDate = new Date().toISOString();
                    if (dataCount !== null) {
                        this.lastDataCount = dataCount;
                    }
                    await this._saveModelMetricsToDB();
                    
                    await this._saveTrainingStatusToDB(dataCount, false);
                    // 🔴 廣播訓練完成狀態
                    this.broadcastStatusChange({
                        isTraining: false,
                        success: true,
                        message: `✅ 訓練完成（耗時 ${duration} 分鐘）`
                    });
                    
                    // 🔬 檢查是否需要自動特徵優化 (v2.9.52)
                    const newDataAdded = dataCount ? dataCount - this.lastDataCount : 0;
                    this.checkAndTriggerOptimization(newDataAdded).then(optResult => {
                        if (optResult.triggered) {
                            console.log(`🔬 已觸發自動特徵優化: ${optResult.reason}`);
                        }
                    }).catch(err => {
                        console.error('優化檢查失敗:', err);
                    });
                    
                    resolve({ success: true, duration: duration, models: modelStatus });
                } else {
                    console.warn(`⚠️ 訓練腳本退出成功，但模型文件未找到`);
                    console.warn(`模型目錄存在: ${modelStatus.modelsDirExists}`);
                    console.warn(`可用模型: ${Object.values(modelStatus.models).filter(Boolean).length}/1`);
                    console.warn(`完整輸出:\n${output}`);
                    if (error) {
                        console.warn(`錯誤輸出:\n${error}`);
                    }
                    await this._saveTrainingStatusToDB(dataCount, false);
                    // 🔴 廣播訓練失敗狀態
                    this.broadcastStatusChange({
                        isTraining: false,
                        success: false,
                        message: '⚠️ 訓練完成但模型文件缺失'
                    });
                    resolve({ 
                        success: false, 
                        reason: '訓練完成但模型文件缺失', 
                        error: error || '無錯誤輸出，但模型文件未生成。可能原因：1) Python 依賴未安裝 2) 數據庫連接失敗 3) 訓練腳本內部錯誤',
                        output: output || '無輸出',
                        modelStatus: modelStatus
                    });
                }
            } else {
                console.error(`❌ 模型訓練失敗（退出碼 ${code}）`);
                console.error('標準輸出:', output);
                console.error('錯誤輸出:', error);
                await this._saveTrainingStatusToDB(dataCount, false);
                // 🔴 廣播訓練失敗狀態
                this.broadcastStatusChange({
                    isTraining: false,
                    success: false,
                    message: `❌ 訓練失敗（退出碼 ${code}）`
                });
                resolve({ 
                    success: false, 
                    reason: `訓練失敗（退出碼 ${code}）`, 
                    error: error || output || '無錯誤信息',
                    output: output || '無輸出',
                    modelStatus: modelStatus
                });
            }
        });

        python.on('error', async (err) => {
            clearTimeout(timeout);
            this.isTraining = false;
            this.trainingStartTime = null;
            this.currentProcess = null;
            this.currentTimeout = null;
            await this._saveTrainingStatusToDB(dataCount, false);
            console.error('❌ 無法執行訓練腳本:', err.message);
            resolve({ success: false, reason: `無法執行訓練腳本: ${err.message}` });
        });
    }

    /**
     * 停止訓練
     */
    async stopTraining() {
        if (!this.isTraining) {
            return { success: false, reason: '沒有正在進行的訓練' };
        }
        
        console.log('🛑 用戶請求停止訓練...');
        this.wasStopped = true;
        
        // 清除超時計時器
        if (this.currentTimeout) {
            clearTimeout(this.currentTimeout);
            this.currentTimeout = null;
        }
        
        // 終止 Python 進程
        if (this.currentProcess) {
            try {
                this.currentProcess.kill('SIGTERM');
                console.log('🛑 已發送 SIGTERM 信號到訓練進程');
                
                // 等待 2 秒後如果還沒結束，強制終止
                setTimeout(() => {
                    if (this.currentProcess && !this.currentProcess.killed) {
                        this.currentProcess.kill('SIGKILL');
                        console.log('🛑 已發送 SIGKILL 信號強制終止訓練進程');
                    }
                }, 2000);
            } catch (e) {
                console.error('❌ 終止進程失敗:', e.message);
            }
        }
        
        // 更新狀態
        this.isTraining = false;
        this.trainingStartTime = null;
        this.currentProcess = null;
        this.lastTrainingOutput += '\n\n🛑 訓練已被用戶停止';
        
        // 保存狀態到數據庫
        await this._saveTrainingStatusToDB(this.lastDataCount, false);
        
        console.log('✅ 訓練已停止');
        return { success: true, message: '訓練已停止' };
    }

    /**
     * 手動觸發訓練
     */
    async manualTrain(db) {
        console.log('🔧 手動觸發模型訓練...');
        const dataCount = await this.getCurrentDataCount(db);
        return await this.startTraining(db, dataCount);
    }

    /**
     * 獲取訓練狀態（同步版本，使用內存中的狀態）
     */
    getStatus() {
        let estimatedRemainingTime = null;
        let elapsedTime = null;
        
        if (this.isTraining && this.trainingStartTime) {
            const startTime = new Date(this.trainingStartTime).getTime();
            const now = Date.now();
            elapsedTime = now - startTime;
            estimatedRemainingTime = Math.max(0, this.estimatedDuration - elapsedTime);
        }
        
        return {
            isTraining: this.isTraining,
            lastTrainingDate: this.lastTrainingDate,
            lastDataCount: this.lastDataCount,
            trainingStartTime: this.trainingStartTime,
            estimatedRemainingTime: estimatedRemainingTime,
            elapsedTime: elapsedTime,
            estimatedDuration: this.estimatedDuration,
            config: this.config,
            statusSource: 'database',
            lastTrainingOutput: this.lastTrainingOutput || '',
            lastTrainingError: this.lastTrainingError || ''
        };
    }

    /**
     * 獲取訓練狀態（異步版本，從 DB 加載最新狀態）
     */
    async getStatusAsync() {
        await this._loadTrainingStatusFromDB();
        return this.getStatus();
    }

    /**
     * 更新配置
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        console.log('訓練配置已更新:', this.config);
    }

    /**
     * 添加 SSE 客戶端
     */
    addSSEClient(res) {
        this.sseClients.add(res);
        console.log(`📡 SSE 客戶端已連接 (總數: ${this.sseClients.size})`);
        
        // 當連接關閉時移除客戶端
        res.on('close', () => {
            this.sseClients.delete(res);
            console.log(`📡 SSE 客戶端已斷開 (剩餘: ${this.sseClients.size})`);
        });
        
        // 立即發送當前狀態
        this._sendSSEEvent(res, 'status', {
            isTraining: this.isTraining,
            trainingStartTime: this.trainingStartTime,
            lastTrainingOutput: this.lastTrainingOutput || '',
            lastTrainingError: this.lastTrainingError || ''
        });
    }

    /**
     * 向單個客戶端發送 SSE 事件
     */
    _sendSSEEvent(res, eventType, data) {
        try {
            if (!res.writableEnded) {
                res.write(`event: ${eventType}\n`);
                res.write(`data: ${JSON.stringify(data)}\n\n`);
            }
        } catch (e) {
            // 客戶端可能已斷開
            this.sseClients.delete(res);
        }
    }

    /**
     * 廣播訓練日誌到所有 SSE 客戶端
     */
    broadcastLog(logLine, isError = false) {
        const eventType = isError ? 'error' : 'log';
        const data = {
            timestamp: new Date().toISOString(),
            message: logLine,
            isError: isError
        };
        
        for (const client of this.sseClients) {
            this._sendSSEEvent(client, eventType, data);
        }
    }

    /**
     * 廣播訓練狀態變更到所有 SSE 客戶端
     */
    broadcastStatusChange(status) {
        const data = {
            timestamp: new Date().toISOString(),
            ...status
        };
        
        for (const client of this.sseClients) {
            this._sendSSEEvent(client, 'status', data);
        }
    }
    
    // ============ 🔬 自動特徵優化 (v2.9.52) ============
    
    /**
     * 檢查是否需要運行特徵優化
     */
    shouldOptimize(newDataCount = 0) {
        if (!this.config.enableAutoOptimize) {
            return { shouldOptimize: false, reason: '自動優化已禁用' };
        }
        
        if (this.isOptimizing) {
            return { shouldOptimize: false, reason: '優化正在進行中' };
        }
        
        // 每 N 次訓練優化一次
        if (this.trainCountSinceOptimize >= this.config.optimizeEveryNTrains) {
            return { 
                shouldOptimize: true, 
                reason: `已訓練 ${this.trainCountSinceOptimize} 次，達到優化閾值` 
            };
        }
        
        // 每 N 筆新數據優化一次
        this.dataCountSinceOptimize += newDataCount;
        if (this.dataCountSinceOptimize >= this.config.optimizeOnNewData) {
            return { 
                shouldOptimize: true, 
                reason: `新增 ${this.dataCountSinceOptimize} 筆數據，達到優化閾值` 
            };
        }
        
        return { shouldOptimize: false, reason: '未達到優化條件' };
    }
    
    /**
     * 運行特徵優化
     */
    async runFeatureOptimization(quick = true) {
        if (this.isOptimizing) {
            console.log('⚠️ 優化已在進行中，跳過');
            return { success: false, reason: '優化已在進行中' };
        }
        
        this.isOptimizing = true;
        console.log('🔬 開始自動特徵優化...');
        
        return new Promise((resolve) => {
            const pythonScript = path.join(__dirname, '../python/auto_feature_optimizer.py');
            const args = quick ? ['--quick'] : [];
            
            const python = spawn('python3', [pythonScript, ...args], {
                cwd: path.join(__dirname, '../python'),
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env, PYTHONUNBUFFERED: '1' }
            });
            
            let output = '';
            let error = '';
            
            python.stdout.on('data', (data) => {
                output += data.toString();
                console.log(`[優化] ${data.toString().trim()}`);
            });
            
            python.stderr.on('data', (data) => {
                error += data.toString();
            });
            
            python.on('close', (code) => {
                this.isOptimizing = false;
                this.lastOptimizeDate = new Date().toISOString();
                this.trainCountSinceOptimize = 0;
                this.dataCountSinceOptimize = 0;
                
                if (code === 0) {
                    console.log('✅ 特徵優化完成');
                    
                    // 嘗試讀取優化結果
                    try {
                        const optimalPath = path.join(__dirname, '../python/models/optimal_features.json');
                        if (fs.existsSync(optimalPath)) {
                            const config = JSON.parse(fs.readFileSync(optimalPath, 'utf8'));
                            console.log(`📊 最佳配置: ${config.optimal_n_features} 特徵, MAE=${config.metrics?.mae?.toFixed(2)}`);
                        }
                    } catch (e) {
                        console.error('讀取優化結果失敗:', e);
                    }
                    
                    resolve({ success: true, output });
                } else {
                    console.error('❌ 特徵優化失敗:', error);
                    resolve({ success: false, error });
                }
            });
            
            python.on('error', (err) => {
                this.isOptimizing = false;
                console.error('❌ 無法啟動優化進程:', err);
                resolve({ success: false, error: err.message });
            });
        });
    }
    
    /**
     * 訓練後檢查並觸發優化
     */
    async checkAndTriggerOptimization(newDataCount = 0) {
        this.trainCountSinceOptimize++;
        
        const checkResult = this.shouldOptimize(newDataCount);
        
        if (checkResult.shouldOptimize) {
            console.log(`🔬 觸發自動優化: ${checkResult.reason}`);
            // 異步運行優化，不阻塞
            this.runFeatureOptimization(true).then(result => {
                if (result.success) {
                    console.log('✅ 自動特徵優化完成');
                } else {
                    console.error('❌ 自動特徵優化失敗');
                }
            }).catch(err => {
                console.error('❌ 自動優化異常:', err);
            });
            return { triggered: true, reason: checkResult.reason };
        }
        
        return { triggered: false, reason: checkResult.reason };
    }
    
    /**
     * 獲取優化狀態
     */
    getOptimizationStatus() {
        return {
            isOptimizing: this.isOptimizing,
            lastOptimizeDate: this.lastOptimizeDate,
            trainCountSinceOptimize: this.trainCountSinceOptimize,
            dataCountSinceOptimize: this.dataCountSinceOptimize,
            config: {
                enabled: this.config.enableAutoOptimize,
                everyNTrains: this.config.optimizeEveryNTrains,
                onNewData: this.config.optimizeOnNewData
            }
        };
    }
}

// 單例模式
let instance = null;

function getAutoTrainManager() {
    if (!instance) {
        instance = new AutoTrainManager();
    }
    return instance;
}

module.exports = { AutoTrainManager, getAutoTrainManager };

