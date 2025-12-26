/**
 * 自動訓練管理器
 * 當有新實際數據時，自動觸發模型重訓練
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
        
        // 配置
        this.config = {
            minDaysSinceLastTrain: 0,      // 至少間隔 0 天（允許同一天多次訓練，如果數據足夠）
            minNewDataRecords: 1,           // 至少 1 筆新數據才觸發（降低門檻，更靈敏）
            maxTrainingInterval: 7,         // 最多 7 天訓練一次
            trainingTimeout: 3600000,       // 訓練超時：1 小時
            enableAutoTrain: process.env.ENABLE_AUTO_TRAIN !== 'false' // 默認啟用
        };
        
        // 訓練狀態文件
        this.statusFile = path.join(__dirname, '../python/models/.training_status.json');
        
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
        
        // 加載訓練狀態
        try {
            this._loadTrainingStatus();
        } catch (err) {
            console.warn('⚠️ 加載訓練狀態失敗:', err.message);
            // 繼續使用默認值
        }
    }

    /**
     * 加載訓練狀態
     */
    _loadTrainingStatus() {
        try {
            if (fs.existsSync(this.statusFile)) {
                const status = JSON.parse(fs.readFileSync(this.statusFile, 'utf8'));
                this.lastTrainingDate = status.lastTrainingDate;
                this.lastDataCount = status.lastDataCount || 0;
                // 如果訓練開始時間存在且距離現在不超過超時時間，認為仍在訓練
                if (status.trainingStartTime) {
                    const startTime = new Date(status.trainingStartTime).getTime();
                    const now = Date.now();
                    const elapsed = now - startTime;
                    if (elapsed < this.config.trainingTimeout) {
                        this.isTraining = true;
                        this.trainingStartTime = status.trainingStartTime;
                    }
                }
                // 加載保存的輸出（如果存在）
                if (status.lastTrainingOutput) {
                    this.lastTrainingOutput = status.lastTrainingOutput;
                }
                if (status.lastTrainingError) {
                    this.lastTrainingError = status.lastTrainingError;
                }
            }
        } catch (e) {
            console.warn('無法加載訓練狀態:', e.message);
        }
    }

    /**
     * 保存訓練狀態
     */
    _saveTrainingStatus(dataCount = null, isTraining = false) {
        try {
            // 如果訓練完成（isTraining = false），更新 lastTrainingDate
            if (!isTraining) {
                this.lastTrainingDate = new Date().toISOString();
            }
            
            const status = {
                lastTrainingDate: this.lastTrainingDate,
                lastDataCount: dataCount !== null ? dataCount : this.lastDataCount,
                lastUpdate: new Date().toISOString(),
                trainingStartTime: isTraining ? (this.trainingStartTime || new Date().toISOString()) : null,
                lastTrainingOutput: this.lastTrainingOutput || '',
                lastTrainingError: this.lastTrainingError || ''
            };
            fs.writeFileSync(this.statusFile, JSON.stringify(status, null, 2));
        } catch (e) {
            console.warn('無法保存訓練狀態:', e.message);
        }
    }

    /**
     * 檢查是否需要訓練
     */
    async shouldTrain(currentDataCount) {
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
     */
    async triggerTrainingCheck(db) {
        if (!this.config.enableAutoTrain) {
            return { triggered: false, reason: '自動訓練已禁用' };
        }

        try {
            const currentDataCount = await this.getCurrentDataCount(db);
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
        if (this.isTraining) {
            console.log('⚠️ 訓練已在進行中，跳過');
            return { success: false, reason: '訓練已在進行中' };
        }

        this.isTraining = true;
        this.trainingStartTime = new Date().toISOString();
        const startTime = Date.now();
        
        // 重置輸出，準備接收新的訓練日誌
        this.lastTrainingOutput = '';
        this.lastTrainingError = '';
        
        // 保存訓練開始狀態
        this._saveTrainingStatus(dataCount, true);

        console.log('🚀 開始自動訓練模型...');
        console.log(`   時間: ${this.trainingStartTime}`);
        if (dataCount !== null) {
            console.log(`   數據總數: ${dataCount}`);
        }

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
            detectPython().then((pythonCmd) => {
                if (!pythonCmd) {
                    const error = '無法找到 Python 命令（嘗試了 python3 和 python）';
                    console.error(`❌ ${error}`);
                    this.isTraining = false;
                    this.trainingStartTime = null;
                    this._saveTrainingStatus(dataCount, false);
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

        // 節流保存，避免過於頻繁的文件寫入
        let lastSaveTime = 0;
        const saveThrottle = 2000; // 每 2 秒最多保存一次
        
        python.stdout.on('data', (data) => {
            const text = data.toString();
            output += text;
            // 實時更新輸出，讓前端可以獲取
            this.lastTrainingOutput = output;
            console.log(`[訓練] ${text.trim()}`);
            
            // 節流保存狀態（每 2 秒最多保存一次）
            const now = Date.now();
            if (now - lastSaveTime >= saveThrottle) {
                this._saveTrainingStatus(dataCount, true);
                lastSaveTime = now;
            }
        });

        python.stderr.on('data', (data) => {
            const text = data.toString();
            error += text;
            // 實時更新錯誤輸出
            this.lastTrainingError = error;
            console.error(`[訓練錯誤] ${text.trim()}`);
            
            // 錯誤輸出立即保存
            this._saveTrainingStatus(dataCount, true);
            lastSaveTime = Date.now();
        });

        // 設置超時
        const timeout = setTimeout(() => {
            python.kill();
            this.isTraining = false;
            console.error('❌ 訓練超時（1小時）');
            resolve({ success: false, reason: '訓練超時', output: output, error: error });
        }, this.config.trainingTimeout);

        python.on('close', (code) => {
            clearTimeout(timeout);
            this.isTraining = false;
            this.trainingStartTime = null;
            const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

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
                    this._saveTrainingStatus(dataCount, false);
                    resolve({ success: true, duration: duration, models: modelStatus });
                } else {
                    console.warn(`⚠️ 訓練腳本退出成功，但模型文件未找到`);
                    console.warn(`模型目錄存在: ${modelStatus.modelsDirExists}`);
                    console.warn(`可用模型: ${Object.values(modelStatus.models).filter(Boolean).length}/1`);
                    console.warn(`完整輸出:\n${output}`);
                    if (error) {
                        console.warn(`錯誤輸出:\n${error}`);
                    }
                    this._saveTrainingStatus(dataCount, false);
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
                this._saveTrainingStatus(dataCount, false);
                resolve({ 
                    success: false, 
                    reason: `訓練失敗（退出碼 ${code}）`, 
                    error: error || output || '無錯誤信息',
                    output: output || '無輸出',
                    modelStatus: modelStatus
                });
            }
        });

        python.on('error', (err) => {
            clearTimeout(timeout);
            this.isTraining = false;
            this.trainingStartTime = null;
            this._saveTrainingStatus(dataCount, false);
            console.error('❌ 無法執行訓練腳本:', err.message);
            resolve({ success: false, reason: `無法執行訓練腳本: ${err.message}` });
        });
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
     * 獲取訓練狀態
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
            statusFile: this.statusFile,
            lastTrainingOutput: this.lastTrainingOutput || '',
            lastTrainingError: this.lastTrainingError || ''
        };
    }

    /**
     * 更新配置
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        console.log('訓練配置已更新:', this.config);
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

