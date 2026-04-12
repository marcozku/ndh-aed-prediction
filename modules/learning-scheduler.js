/**
 * Learning Scheduler
 *
 * Runs the daily learning jobs on a cron schedule when `node-cron`
 * is available and falls back to lightweight timer checks otherwise.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class LearningScheduler {
    constructor() {
        this.isRunning = false;
        this.cronJobs = [];
        this.lastRunTime = null;
        this.runCount = 0;
        this.schedulerMode = 'inactive';
        this.lastError = null;
        this.currentTask = null;
        this.lastStartedAt = null;
        this.lastCompletedAt = null;
        this.lastTaskStatus = null;
        this.lastTaskMessage = null;
        this.lastDurationMs = null;
        this.pythonCommand = null;
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

    getPythonCandidates() {
        const candidates = new Set();
        const addCandidate = (value) => {
            if (!value || typeof value !== 'string') return;
            const trimmed = value.trim();
            if (!trimmed) return;
            candidates.add(trimmed);
        };

        [
            process.env.PYTHON,
            'python3',
            'python',
            'python3.11',
            'python3.10',
            'python311',
            'py'
        ].forEach(addCandidate);

        const pathDirs = (process.env.PATH || '')
            .split(path.delimiter)
            .map(dir => dir && dir.trim())
            .filter(Boolean);

        const commonDirs = [
            ...pathDirs,
            '/usr/bin',
            '/usr/local/bin',
            '/opt/venv/bin',
            '/nix/var/nix/profiles/default/bin',
            '/nix/profile/bin'
        ];

        const seenDirs = new Set();
        for (const dir of commonDirs) {
            if (seenDirs.has(dir)) continue;
            seenDirs.add(dir);

            try {
                if (!fs.existsSync(dir)) continue;
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
                    const name = entry.name;
                    if (/^(python(\d+(\.\d+)?)?|py)(\.exe)?$/i.test(name)) {
                        addCandidate(path.join(dir, name));
                    }
                }
            } catch (_) {
                // Ignore unreadable directories.
            }
        }

        return Array.from(candidates);
    }

    detectPythonCommand() {
        if (this.pythonCommand) {
            return Promise.resolve(this.pythonCommand);
        }

        const candidates = this.getPythonCandidates();

        return new Promise((resolve) => {
            const tryCommand = (index) => {
                if (index >= candidates.length) {
                    resolve(null);
                    return;
                }

                const command = candidates[index];
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

    startTask(taskName, trigger = 'scheduler') {
        if (this.isRunning) {
            return {
                success: false,
                task: taskName,
                status: 'already_running',
                message: `${this.currentTask || 'learning'} is already running`,
                currentTask: this.currentTask,
                startedAt: this.lastStartedAt
            };
        }

        this.isRunning = true;
        this.currentTask = taskName;
        this.lastStartedAt = new Date();
        this.lastTaskStatus = 'running';
        this.lastTaskMessage = `${taskName} started (${trigger})`;
        this.lastDurationMs = null;
        this.lastError = null;

        return null;
    }

    finishTask(taskName, startTime, result) {
        const completedAt = new Date();
        const durationMs = Date.now() - startTime;

        this.lastCompletedAt = completedAt;
        this.lastDurationMs = durationMs;
        this.lastRunTime = completedAt;
        this.lastTaskStatus = result.success ? 'success' : (result.status || 'failed');
        this.lastTaskMessage = result.message;

        if (result.success) {
            this.runCount++;
            this.lastError = null;
        } else if (result.error) {
            this.lastError = result.error;
        }

        this.isRunning = false;
        this.currentTask = null;

        return {
            ...result,
            task: taskName,
            startedAt: this.lastStartedAt,
            completedAt,
            durationMs
        };
    }

    async runDailyLearning(trigger = 'scheduler') {
        const existingRun = this.startTask('daily', trigger);
        if (existingRun) {
            console.log('Learning already running, skipping');
            return existingRun;
        }

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

            return this.finishTask('daily', startTime, {
                success: true,
                status: 'completed',
                message: `Daily learning complete (${duration}s)`
            });
        } catch (error) {
            console.error(`Daily learning failed: ${error.message}`);
            return this.finishTask('daily', startTime, {
                success: false,
                status: 'failed',
                message: `Daily learning failed: ${error.message}`,
                error: error.message
            });
        }
    }

    async runWeeklyLearning(trigger = 'scheduler') {
        const existingRun = this.startTask('weekly', trigger);
        if (existingRun) {
            console.log('Learning already running, skipping weekly task');
            return existingRun;
        }

        const startTime = Date.now();

        console.log('='.repeat(60));
        console.log('Running Weekly Learning...');
        console.log(`Time: ${new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}`);
        console.log('='.repeat(60));

        try {
            await this.runPythonScript('weather_impact_learner.py');
            await this.cacheWeatherForecast(trigger, { nested: true });
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`Weekly learning complete (${duration}s)`);
            return this.finishTask('weekly', startTime, {
                success: true,
                status: 'completed',
                message: `Weekly learning complete (${duration}s)`
            });
        } catch (error) {
            console.error(`Weekly learning failed: ${error.message}`);
            return this.finishTask('weekly', startTime, {
                success: false,
                status: 'failed',
                message: `Weekly learning failed: ${error.message}`,
                error: error.message
            });
        }
    }

    async cacheWeatherForecast(trigger = 'scheduler', options = {}) {
        const nested = Boolean(options?.nested);
        let startTime = Date.now();

        if (!nested) {
            const existingRun = this.startTask('forecast', trigger);
            if (existingRun) {
                console.log('Learning already running, skipping forecast cache');
                return existingRun;
            }
            startTime = Date.now();
        }

        console.log('Caching weather forecast...');

        try {
            await this.runPythonScript('forecast_predictor.py', ['--cache']);
            console.log('Weather forecast cached');
            if (nested) {
                return {
                    success: true,
                    status: 'completed',
                    task: 'forecast',
                    message: 'Weather forecast cached'
                };
            }
            return this.finishTask('forecast', startTime, {
                success: true,
                status: 'completed',
                message: 'Weather forecast cached'
            });
        } catch (error) {
            console.error(`Forecast cache failed: ${error.message}`);
            if (nested) {
                throw error;
            }
            return this.finishTask('forecast', startTime, {
                success: false,
                status: 'failed',
                message: `Forecast cache failed: ${error.message}`,
                error: error.message
            });
        }
    }

    async runPythonScript(scriptName, args = []) {
        const scriptPath = path.join(__dirname, '..', 'python', scriptName);
        const pythonCandidates = this.getPythonCandidates();
        const python = await this.detectPythonCommand();

        if (!python) {
            throw new Error(
                `Python not found. Tried: ${pythonCandidates.join(', ')}\n` +
                'Fix: Set PYTHON environment variable or install Python'
            );
        }

        console.log(`Using Python: ${python}`);

        return new Promise((resolve, reject) => {
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
            currentTask: this.currentTask,
            lastStartedAt: this.lastStartedAt,
            lastCompletedAt: this.lastCompletedAt,
            lastTaskStatus: this.lastTaskStatus,
            lastTaskMessage: this.lastTaskMessage,
            lastDurationMs: this.lastDurationMs,
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
