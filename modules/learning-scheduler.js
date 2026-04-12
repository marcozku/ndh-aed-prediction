/**
 * Learning Scheduler
 *
 * Runs the daily learning jobs on a cron schedule when `node-cron`
 * is available and falls back to lightweight timer checks otherwise.
 */

const { spawn, spawnSync } = require('child_process');
const path = require('path');

class LearningScheduler {
    constructor() {
        this.isRunning = false;
        this.cronJobs = [];
        this.lastRunTime = null;
        this.runCount = 0;
        this.schedulerMode = 'inactive';
        this.lastError = null;
    }

    start() {
        console.log('Starting Learning Scheduler v4.0.00...');

        if (this.cronJobs.length > 0) {
            this.stop();
        }

        this.schedulerMode = 'inactive';
        this.lastError = null;

        let cron = null;
        try {
            cron = require('node-cron');
        } catch (error) {
            this.lastError = error.message;
            console.log('node-cron not installed, using fallback timer scheduler');
        }

        if (cron) {
            this.schedulerMode = 'cron';

            const dailyJob = cron.schedule('30 0 * * *', () => {
                this.runDailyLearning().catch((err) => {
                    console.error('Daily learning error:', err.message);
                });
            }, {
                scheduled: true,
                timezone: 'Asia/Hong_Kong'
            });

            const weeklyJob = cron.schedule('0 1 * * 1', () => {
                this.runWeeklyLearning().catch((err) => {
                    console.error('Weekly learning error:', err.message);
                });
            }, {
                scheduled: true,
                timezone: 'Asia/Hong_Kong'
            });

            const forecastJob = cron.schedule('0 */6 * * *', () => {
                this.cacheWeatherForecast().catch((err) => {
                    console.error('Forecast cache error:', err.message);
                });
            }, {
                scheduled: true,
                timezone: 'Asia/Hong_Kong'
            });

            this.cronJobs.push({ name: 'daily', job: dailyJob, stop: () => dailyJob.stop(), nextRun: '每日 00:30 HKT' });
            this.cronJobs.push({ name: 'weekly', job: weeklyJob, stop: () => weeklyJob.stop(), nextRun: '每週一 01:00 HKT' });
            this.cronJobs.push({ name: 'forecast', job: forecastJob, stop: () => forecastJob.stop(), nextRun: '每 6 小時' });
        } else {
            this.schedulerMode = 'timer';
            this.registerFallbackTask(
                'daily',
                { hour: 0, minute: 30 },
                () => this.runDailyLearning(),
                '每日 00:30 HKT'
            );
            this.registerFallbackTask(
                'weekly',
                { hour: 1, minute: 0, dayOfWeek: 1 },
                () => this.runWeeklyLearning(),
                '每週一 01:00 HKT'
            );
            this.registerFallbackTask(
                'forecast',
                { hours: [0, 6, 12, 18], minute: 0 },
                () => this.cacheWeatherForecast(),
                '每 6 小時'
            );
        }

        console.log(`Scheduled ${this.cronJobs.length} tasks using ${this.schedulerMode} mode`);
        console.log('  - Daily Learning: 00:30 HKT');
        console.log('  - Weekly Learning: 01:00 HKT (Monday)');
        console.log('  - Forecast Cache: Every 6 hours');

        return this.getStatus();
    }

    stop() {
        console.log('Stopping Learning Scheduler...');
        this.cronJobs.forEach(({ name, job, stop }) => {
            try {
                if (typeof stop === 'function') {
                    stop();
                } else if (job && typeof job.stop === 'function') {
                    job.stop();
                } else if (job) {
                    clearInterval(job);
                    clearTimeout(job);
                }
                console.log(`  Stopped: ${name}`);
            } catch (error) {
                console.warn(`  Failed to stop ${name}: ${error.message}`);
            }
        });
        this.cronJobs = [];
        this.schedulerMode = 'inactive';
    }

    registerFallbackTask(name, schedule, runner, nextRun) {
        const state = { lastTriggerKey: null };

        const tick = () => {
            const nowHKT = this.getHKTDate();
            const minuteMatch = nowHKT.getMinutes() === schedule.minute;
            const hourMatch = Array.isArray(schedule.hours)
                ? schedule.hours.includes(nowHKT.getHours())
                : nowHKT.getHours() === schedule.hour;
            const dayMatch = schedule.dayOfWeek === undefined || nowHKT.getDay() === schedule.dayOfWeek;

            if (!minuteMatch || !hourMatch || !dayMatch) {
                return;
            }

            const triggerKey = [
                nowHKT.getFullYear(),
                String(nowHKT.getMonth() + 1).padStart(2, '0'),
                String(nowHKT.getDate()).padStart(2, '0'),
                String(nowHKT.getHours()).padStart(2, '0'),
                String(nowHKT.getMinutes()).padStart(2, '0')
            ].join('-');

            if (state.lastTriggerKey === triggerKey) {
                return;
            }

            state.lastTriggerKey = triggerKey;

            Promise.resolve(runner()).catch((error) => {
                console.error(`${name} fallback task error:`, error.message);
            });
        };

        const interval = setInterval(tick, 60 * 1000);
        tick();

        this.cronJobs.push({
            name,
            job: interval,
            stop: () => clearInterval(interval),
            nextRun
        });
    }

    getHKTDate() {
        return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }));
    }

    async runDailyLearning() {
        if (this.isRunning) {
            console.log('Learning already running, skipping');
            return;
        }

        this.isRunning = true;
        const startTime = Date.now();

        console.log('='.repeat(60));
        console.log('Running Daily Learning...');
        console.log(`Time: ${new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}`);
        console.log('='.repeat(60));

        try {
            await this.runPythonScript('continuous_learner.py', ['--catch-up']);
            await this.runPythonScript('anomaly_detector.py');

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`Daily learning complete (${duration}s)`);

            this.lastRunTime = new Date();
            this.runCount++;
        } catch (error) {
            console.error(`Daily learning failed: ${error.message}`);
        } finally {
            this.isRunning = false;
        }
    }

    async runWeeklyLearning() {
        console.log('='.repeat(60));
        console.log('Running Weekly Learning...');
        console.log(`Time: ${new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}`);
        console.log('='.repeat(60));

        try {
            await this.runPythonScript('weather_impact_learner.py');
            await this.cacheWeatherForecast();
            console.log('Weekly learning complete');
        } catch (error) {
            console.error(`Weekly learning failed: ${error.message}`);
        }
    }

    async cacheWeatherForecast() {
        console.log('Caching weather forecast...');

        try {
            await this.runPythonScript('forecast_predictor.py', ['--cache']);
            console.log('Weather forecast cached');
        } catch (error) {
            console.error(`Forecast cache failed: ${error.message}`);
        }
    }

    runPythonScript(scriptName, args = []) {
        return new Promise((resolve, reject) => {
            const scriptPath = path.join(__dirname, '..', 'python', scriptName);
            const pythonCommands = [
                process.env.PYTHON,
                'python3',
                'python',
                '/usr/bin/python3',
                '/usr/local/bin/python3'
            ].filter(Boolean);

            let python = null;
            let lastError = null;

            for (const command of pythonCommands) {
                try {
                    const testResult = spawnSync(command, ['--version'], {
                        stdio: 'pipe',
                        timeout: 5000
                    });
                    if (testResult.error === null && testResult.status === 0) {
                        python = command;
                        console.log(`Using Python: ${command}`);
                        break;
                    }
                } catch (error) {
                    lastError = error;
                }
            }

            if (!python) {
                return reject(new Error(
                    `Python not found. Tried: ${pythonCommands.join(', ')}\n` +
                    `Error: ${lastError?.message || 'Unknown'}\n` +
                    'Fix: Set PYTHON environment variable or install Python'
                ));
            }

            const pythonProcess = spawn(python, [scriptPath, ...args], {
                cwd: path.join(__dirname, '..'),
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let output = '';
            let errorOutput = '';

            pythonProcess.on('error', (error) => {
                reject(new Error(`Failed to start Python (${python}): ${error.message}`));
            });

            pythonProcess.stdout.on('data', (data) => {
                const text = data.toString();
                output += text;
                console.log(text.trim());
            });

            pythonProcess.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            pythonProcess.on('close', (code) => {
                if (code === 0) {
                    resolve(output);
                    return;
                }

                reject(new Error(`${scriptName} exited with code ${code}\nStderr: ${errorOutput}`));
            });
        });
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            schedulerMode: this.schedulerMode,
            schedulerActive: this.cronJobs.length > 0,
            scheduledTasks: this.cronJobs.length,
            lastRunTime: this.lastRunTime,
            runCount: this.runCount,
            tasks: this.cronJobs.map(({ name }) => name),
            nextRuns: this.cronJobs.reduce((acc, { name, nextRun }) => {
                acc[name] = nextRun || null;
                return acc;
            }, {}),
            lastError: this.lastError
        };
    }
}

let schedulerInstance = null;

function getScheduler() {
    if (!schedulerInstance) {
        schedulerInstance = new LearningScheduler();
    }
    return schedulerInstance;
}

module.exports = { LearningScheduler, getScheduler };

if (require.main === module) {
    const scheduler = getScheduler();
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
