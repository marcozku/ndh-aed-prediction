/**
 * 學習調度器
 * Learning Scheduler
 *
 * 每天自動執行學習任務
 *
 * Version: 4.0.00
 * Author: Ma Tsz Kiu
 * Date: 2026-01-18
 */

const { spawn } = require('child_process');
const path = require('path');

class LearningScheduler {
    constructor() {
        this.isRunning = false;
        this.cronJobs = [];
        this.lastRunTime = null;
        this.runCount = 0;
    }

    /**
     * 啟動調度器
     */
    start() {
        console.log('📚 Starting Learning Scheduler v4.0.00...');

        // 檢查是否安裝 node-cron
        let cron;
        try {
            cron = require('node-cron');
        } catch (e) {
            console.log('⚠️ node-cron not installed, scheduler will not run automatically');
            console.log('   Install with: npm install node-cron');
            return;
        }

        // 每天凌晨 12:30 執行每日學習
        const dailyJob = cron.schedule('30 0 * * *', () => {
            this.runDailyLearning().catch(err => {
                console.error('❌ Daily learning error:', err.message);
            });
        }, {
            scheduled: true,
            timezone: 'Asia/Hong_Kong'
        });

        this.cronJobs.push({ name: 'daily', job: dailyJob });

        // 每週一凌晨 1:00 執行完整學習 (更新模型)
        const weeklyJob = cron.schedule('0 1 * * 1', () => {
            this.runWeeklyLearning().catch(err => {
                console.error('❌ Weekly learning error:', err.message);
            });
        }, {
            scheduled: true,
            timezone: 'Asia/Hong_Kong'
        });

        this.cronJobs.push({ name: 'weekly', job: weeklyJob });

        // 每 6 小時緩存天氣預報
        const forecastJob = cron.schedule('0 */6 * * *', () => {
            this.cacheWeatherForecast().catch(err => {
                console.error('❌ Forecast cache error:', err.message);
            });
        }, {
            scheduled: true,
            timezone: 'Asia/Hong_Kong'
        });

        this.cronJobs.push({ name: 'forecast', job: forecastJob });

        console.log(`✅ Scheduled ${this.cronJobs.length} tasks:`);
        console.log('   - Daily Learning: 00:30 HKT');
        console.log('   - Weekly Learning: 01:00 HKT (Monday)');
        console.log('   - Forecast Cache: Every 6 hours');
    }

    /**
     * 停止調度器
     */
    stop() {
        console.log('🛑 Stopping Learning Scheduler...');
        this.cronJobs.forEach(({ name, job }) => {
            job.stop();
            console.log(`   Stopped: ${name}`);
        });
        this.cronJobs = [];
    }

    /**
     * 執行每日學習
     */
    async runDailyLearning() {
        if (this.isRunning) {
            console.log('⚠️ Learning already running, skipping');
            return;
        }

        this.isRunning = true;
        const startTime = Date.now();

        console.log('='.repeat(60));
        console.log('🔄 Running Daily Learning...');
        console.log(`   Time: ${new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}`);
        console.log('='.repeat(60));

        try {
            // 1. 運行持續學習腳本
            await this.runPythonScript('continuous_learner.py');

            // 2. 運行異常檢測
            await this.runPythonScript('anomaly_detector.py');

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`✅ Daily learning complete (${duration}s)`);

            this.lastRunTime = new Date();
            this.runCount++;

        } catch (error) {
            console.error(`❌ Daily learning failed: ${error.message}`);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * 執行每週學習
     */
    async runWeeklyLearning() {
        console.log('='.repeat(60));
        console.log('🔄 Running Weekly Learning...');
        console.log(`   Time: ${new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}`);
        console.log('='.repeat(60));

        try {
            // 1. 運行天氣影響學習
            await this.runPythonScript('weather_impact_learner.py');

            // 2. 緩存天氣預報
            await this.cacheWeatherForecast();

            console.log('✅ Weekly learning complete');

        } catch (error) {
            console.error(`❌ Weekly learning failed: ${error.message}`);
        }
    }

    /**
     * 緩存天氣預報
     */
    async cacheWeatherForecast() {
        console.log('🌤️ Caching weather forecast...');

        try {
            await this.runPythonScript('forecast_predictor.py', ['--cache']);
            console.log('✅ Weather forecast cached');

        } catch (error) {
            console.error(`❌ Forecast cache failed: ${error.message}`);
        }
    }

    /**
     * 運行 Python 腳本
     */
    runPythonScript(scriptName, args = []) {
        return new Promise((resolve, reject) => {
            const scriptPath = path.join(__dirname, '..', 'python', scriptName);

            // 嘗試多個 Python 命令
            const pythonCommands = [
                process.env.PYTHON,
                'python3',
                'python',
                '/usr/bin/python3',
                '/usr/local/bin/python3'
            ].filter(Boolean);

            let python = null;
            let lastError = null;

            // 測試哪個 Python 命令可用
            for (const cmd of pythonCommands) {
                try {
                    const testResult = require('child_process').spawnSync(cmd, ['--version'], {
                        stdio: 'pipe',
                        timeout: 5000
                    });
                    if (testResult.error === null) {
                        python = cmd;
                        console.log(`✅ Using Python: ${cmd}`);
                        break;
                    }
                } catch (e) {
                    lastError = e;
                }
            }

            if (!python) {
                return reject(new Error(
                    `Python not found. Tried: ${pythonCommands.join(', ')}\n` +
                    `Error: ${lastError?.message || 'Unknown'}\n` +
                    `Fix: Set PYTHON environment variable or install Python`
                ));
            }

            const pythonProcess = spawn(python, [scriptPath, ...args], {
                cwd: path.join(__dirname, '..'),
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let output = '';
            let error = '';

            pythonProcess.on('error', (err) => {
                reject(new Error(`Failed to start Python (${python}): ${err.message}`));
            });

            pythonProcess.stdout.on('data', (data) => {
                const text = data.toString();
                output += text;
                console.log(text.trim());
            });

            pythonProcess.stderr.on('data', (data) => {
                error += data.toString();
            });

            pythonProcess.on('close', (code) => {
                if (code === 0) resolve(output);
                else reject(new Error(`${scriptName} exited with code ${code}\nStderr: ${error}`));
            });
        });
    }

    /**
     * 獲取調度器狀態
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            scheduledTasks: this.cronJobs.length,
            lastRunTime: this.lastRunTime,
            runCount: this.runCount,
            tasks: this.cronJobs.map(({ name }) => name)
        };
    }
}

// 單例模式
let schedulerInstance = null;

function getScheduler() {
    if (!schedulerInstance) {
        schedulerInstance = new LearningScheduler();
    }
    return schedulerInstance;
}

module.exports = { LearningScheduler, getScheduler };

// 如果直接運行此文件
if (require.main === module) {
    const scheduler = getScheduler();

    // 解析命令行參數
    const command = process.argv[2];

    switch (command) {
        case 'start':
            scheduler.start();
            console.log('Press Ctrl+C to stop');
            break;

        case 'daily':
            scheduler.runDailyLearning();
            break;

        case 'weekly':
            scheduler.runWeeklyLearning();
            break;

        case 'status':
            console.log(JSON.stringify(scheduler.getStatus(), null, 2));
            break;

        default:
            console.log('Usage: node learning-scheduler.js [start|daily|weekly|status]');
    }
}
