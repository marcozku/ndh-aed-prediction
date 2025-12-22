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
        
        // 配置
        this.config = {
            minDaysSinceLastTrain: 1,      // 至少間隔 1 天
            minNewDataRecords: 7,           // 至少 7 筆新數據才觸發
            maxTrainingInterval: 7,         // 最多 7 天訓練一次
            trainingTimeout: 3600000,       // 訓練超時：1 小時
            enableAutoTrain: process.env.ENABLE_AUTO_TRAIN !== 'false' // 默認啟用
        };
        
        // 訓練狀態文件
        this.statusFile = path.join(__dirname, '../python/models/.training_status.json');
        this._loadTrainingStatus();
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
            const status = {
                lastTrainingDate: new Date().toISOString(),
                lastDataCount: dataCount || this.lastDataCount,
                lastUpdate: new Date().toISOString(),
                trainingStartTime: isTraining ? (this.trainingStartTime || new Date().toISOString()) : null
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
        
        // 保存訓練開始狀態
        this._saveTrainingStatus(dataCount, true);

        console.log('🚀 開始自動訓練模型...');
        console.log(`   時間: ${this.trainingStartTime}`);
        if (dataCount !== null) {
            console.log(`   數據總數: ${dataCount}`);
        }

        return new Promise((resolve) => {
            const pythonScript = path.join(__dirname, '../python/train_all_models.py');
            const python = spawn('python3', [pythonScript], {
                cwd: path.join(__dirname, '..'),
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let output = '';
            let error = '';

            python.stdout.on('data', (data) => {
                const text = data.toString();
                output += text;
                console.log(`[訓練] ${text.trim()}`);
            });

            python.stderr.on('data', (data) => {
                const text = data.toString();
                error += text;
                console.error(`[訓練錯誤] ${text.trim()}`);
            });

            // 設置超時
            const timeout = setTimeout(() => {
                python.kill();
                this.isTraining = false;
                console.error('❌ 訓練超時（1小時）');
                resolve({ success: false, reason: '訓練超時' });
            }, this.config.trainingTimeout);

            python.on('close', (code) => {
                clearTimeout(timeout);
                this.isTraining = false;
                this.trainingStartTime = null;
                const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

                if (code === 0) {
                    console.log(`✅ 模型訓練完成（耗時 ${duration} 分鐘）`);
                    this._saveTrainingStatus(dataCount, false);
                    resolve({ success: true, duration: duration });
                } else {
                    console.error(`❌ 模型訓練失敗（退出碼 ${code}）`);
                    console.error('錯誤輸出:', error);
                    this._saveTrainingStatus(dataCount, false);
                    resolve({ success: false, reason: `訓練失敗（退出碼 ${code}）`, error: error });
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
            statusFile: this.statusFile
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

