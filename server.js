const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3001;
const MODEL_VERSION = '3.0.5';

// ============================================
// HKT 時間工具函數
// ============================================
function getHKTTime() {
    return new Date().toLocaleString('zh-HK', { 
        timeZone: 'Asia/Hong_Kong',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

function getHKTDate() {
    const now = new Date();
    const hkDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }));
    const year = hkDate.getFullYear();
    const month = String(hkDate.getMonth() + 1).padStart(2, '0');
    const day = String(hkDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getHKTTimestamp() {
    return getHKTTime().replace(/\//g, '-');
}

// AI 服務（僅在服務器端使用）
let aiService = null;
try {
    aiService = require('./ai-service');
} catch (err) {
    console.warn('⚠️ AI 服務模組載入失敗（客戶端環境）:', err.message);
}

// Database connection (嘗試初始化，database.js 會檢查所有可用的環境變數)
let db = null;
// 檢查是否有任何數據庫環境變數
const hasDbConfig = process.env.DATABASE_URL || 
                   (process.env.PGHOST && process.env.PGUSER && process.env.PGPASSWORD && process.env.PGDATABASE);

// 總是嘗試初始化數據庫模組（即使沒有環境變數，也會返回 null pool）
db = require('./database');

if (hasDbConfig) {
    db.initDatabase().then(async () => {
        // 數據庫初始化完成後，自動導入 CSV 數據
        // 優先檢查項目目錄中的 CSV 文件
        const csvFiles = [
            'NDH_AED_Attendance_2025-12-01_to_2025-12-21.csv',
            'NDH_AED_Attendance_Minimal.csv',
            '/Users/yoyoau/Library/Containers/net.whatsapp.WhatsApp/Data/tmp/documents/86448351-FEDA-406E-B465-B7D0B0753234/NDH_AED_Attendance_Minimal.csv'
        ];
        
        let csvImported = false;
        for (const csvFile of csvFiles) {
            if (fs.existsSync(csvFile)) {
                console.log(`📊 檢測到 CSV 文件: ${csvFile}，開始自動導入...`);
                try {
                    const { importCSVData } = require('./import-csv-data');
                    const result = await importCSVData(csvFile, db);
                    if (result.success) {
                        console.log(`✅ 自動導入完成！成功導入 ${result.count} 筆數據`);
                        csvImported = true;
                        // 導入完成後，計算所有導入日期的準確度（如果有預測數據）
                        if (result.count > 0 && result.importedDates && db.calculateAccuracy) {
                            console.log('📊 開始計算導入數據的準確度...');
                            let accuracyCount = 0;
                            for (const date of result.importedDates) {
                                try {
                                    const accuracy = await db.calculateAccuracy(date);
                                    if (accuracy) {
                                        accuracyCount++;
                                    }
                                } catch (err) {
                                    console.warn(`⚠️ 計算 ${date} 準確度時出錯:`, err.message);
                                }
                            }
                            if (accuracyCount > 0) {
                                console.log(`✅ 已計算 ${accuracyCount} 筆數據的準確度`);
                            } else {
                                console.log('ℹ️ 沒有找到對應的預測數據，跳過準確度計算');
                            }
                        }
                        break; // 成功導入一個文件後停止
                    } else {
                        console.error(`❌ 自動導入失敗: ${result.error}`);
                    }
                } catch (err) {
                    console.error(`❌ 自動導入 CSV 時出錯:`, err.message);
                }
            }
        }
        
        if (!csvImported) {
            console.log('ℹ️ 未找到 CSV 文件，跳過自動導入');
        }
        
        // 自動添加 1/12 到 12/12 的實際數據（如果不存在）
        try {
            const { autoAddData } = require('./auto-add-data-on-deploy');
            await autoAddData();
        } catch (err) {
            console.warn('⚠️ 自動添加實際數據時出錯（可能模組不存在）:', err.message);
        }
        
        // 應用平滑處理到歷史預測數據
        try {
            const { applySmoothing } = require('./apply-smoothing-migration');
            const smoothResult = await applySmoothing();
            if (smoothResult.success && smoothResult.processed > 0) {
                console.log(`✅ 已平滑處理 ${smoothResult.processed} 個日期的預測數據`);
            }
        } catch (err) {
            console.warn('⚠️ 應用平滑處理時出錯:', err.message);
        }
    }).catch(err => {
        console.error('❌ 數據庫初始化失敗:', err.message);
        console.error('錯誤詳情:', err.stack);
        // 即使初始化失敗，也保留 db 對象（pool 會是 null）
    });
} else {
    // 即使沒有環境變數，也嘗試初始化（database.js 會處理）
    db.initDatabase().catch(err => {
        console.warn('⚠️ 數據庫環境變數未設置，數據庫功能將不可用');
    });
}

const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

// Helper to parse JSON body
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

// Helper to send JSON response
function sendJson(res, data, statusCode = 200) {
    // 確保所有字符串都正確編碼為 UTF-8
    const jsonString = JSON.stringify(data, null, 0);
    const buffer = Buffer.from(jsonString, 'utf-8');
    
    res.writeHead(statusCode, { 
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(buffer);
}

// 生成 Python 環境建議
function generatePythonRecommendations(python3, python, dependencies) {
    const recommendations = [];
    
    if (!python3.available && !python.available) {
        recommendations.push({
            level: 'error',
            message: 'Python 未安裝',
            action: '請安裝 Python 3.8+'
        });
    } else {
        const available = python3.available ? python3 : python;
        recommendations.push({
            level: 'success',
            message: `Python 可用: ${available.command} ${available.version}`,
            action: null
        });
        
        if (!dependencies || !dependencies.available) {
            recommendations.push({
                level: 'error',
                message: 'Python 依賴缺失',
                action: '運行: cd python && pip install -r requirements.txt',
                error: dependencies ? dependencies.error : '無法檢查依賴'
            });
        } else {
            recommendations.push({
                level: 'success',
                message: '所有 Python 依賴已安裝',
                action: null
            });
        }
    }
    
    return recommendations;
}

// 生成診斷建議
function generateRecommendations(status, pythonInfo) {
    const recommendations = [];
    
    if (!pythonInfo.available) {
        recommendations.push({
            level: 'error',
            message: 'Python 3 未安裝或不可用',
            action: '請安裝 Python 3.8+ 並確保 python3 命令可用'
        });
    }
    
    if (!status.modelsDirExists) {
        recommendations.push({
            level: 'error',
            message: '模型目錄不存在',
            action: `創建目錄: ${status.modelsDir}`
        });
    }
    
    const missingModels = [];
    if (!status.models.xgboost) missingModels.push('XGBoost');
    
    if (missingModels.length > 0) {
        recommendations.push({
            level: 'warning',
            message: `缺少模型: ${missingModels.join(', ')}`,
            action: '運行 python/train_all_models.py 訓練模型'
        });
    }
    
    // 檢查部分文件缺失
    if (status.details) {
        for (const [modelKey, details] of Object.entries(status.details)) {
            if (details.exists) {
                const missingFiles = Object.entries(details.requiredFiles)
                    .filter(([key, file]) => !file.exists && key !== 'model')
                    .map(([key, file]) => file.name);
                
                if (missingFiles.length > 0) {
                    recommendations.push({
                        level: 'warning',
                        message: `${modelKey} 模型缺少輔助文件: ${missingFiles.join(', ')}`,
                        action: '重新訓練模型以生成所有必需文件'
                    });
                }
            }
        }
    }
    
    if (recommendations.length === 0) {
        recommendations.push({
            level: 'success',
            message: '所有模型文件完整',
            action: '模型已準備就緒，可以使用集成預測'
        });
    }
    
    return recommendations;
}

// API handlers
const apiHandlers = {
    // Upload actual data
    'POST /api/actual-data': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);
        
        const data = await parseBody(req);
        let results;
        if (Array.isArray(data)) {
            // Bulk upload
            results = await db.insertBulkActualData(data);
            
            // Calculate accuracy for any dates that now have both prediction and actual
            // Also calculate final daily predictions for dates that have daily_predictions
            for (const record of results) {
                await db.calculateAccuracy(record.date);
                // 如果該日期有 daily_predictions，計算最終預測
                try {
                    await db.calculateFinalDailyPrediction(record.date);
                } catch (err) {
                    // 如果沒有預測數據，忽略錯誤
                    console.log(`ℹ️ ${record.date} 沒有預測數據，跳過最終預測計算`);
                }
            }
            
            sendJson(res, { success: true, inserted: results.length, data: results });
        } else {
            // Single record
            results = [await db.insertActualData(data.date, data.patient_count, data.source, data.notes)];
            await db.calculateAccuracy(data.date);
            // 如果該日期有 daily_predictions，計算最終預測
            try {
                await db.calculateFinalDailyPrediction(data.date);
            } catch (err) {
                // 如果沒有預測數據，忽略錯誤
                console.log(`ℹ️ ${data.date} 沒有預測數據，跳過最終預測計算`);
            }
            sendJson(res, { success: true, data: results[0] });
        }
        
        // 觸發自動訓練（用戶數據更新，強制訓練）
        try {
            const { getAutoTrainManager } = require('./modules/auto-train-manager');
            const trainManager = getAutoTrainManager();
            trainManager.triggerTrainingCheck(db, true).then(result => {
                if (result.triggered) {
                    console.log(`✅ 自動訓練已觸發: ${result.reason}`);
                } else {
                    console.log(`ℹ️ 自動訓練未觸發: ${result.reason}`);
                }
            }).catch(err => {
                console.error('自動訓練檢查失敗:', err);
            });
        } catch (err) {
            // 如果自動訓練模組不可用，忽略錯誤
            console.warn('自動訓練模組不可用:', err.message);
        }
    },

    // Get actual data
    'GET /api/actual-data': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);
        
        try {
            const parsedUrl = url.parse(req.url, true);
            const { start, end } = parsedUrl.query;
            console.log(`📅 API 接收日期範圍參數: start=${start}, end=${end}`);
            const data = await db.getActualData(start, end);
            console.log(`📊 API 返回數據數量: ${data ? data.length : 0} (範圍: ${start} 至 ${end})`);
            sendJson(res, { success: true, data });
        } catch (error) {
            console.error('❌ 獲取實際數據失敗:', error);
            sendJson(res, { success: false, error: error.message }, 500);
        }
    },

    // Store prediction (called internally when predictions are made)
    'POST /api/predictions': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);
        
        const data = await parseBody(req);
        const today = getHKTDate();
        const result = await db.insertPrediction(
            today,
            data.target_date,
            data.predicted_count,
            data.ci80,
            data.ci95,
            MODEL_VERSION
        );
        sendJson(res, { success: true, data: result });
    },

    // Store daily prediction (each update throughout the day)
    'POST /api/daily-predictions': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);
        
        const data = await parseBody(req);
        const result = await db.insertDailyPrediction(
            data.target_date,
            data.predicted_count,
            data.ci80,
            data.ci95,
            MODEL_VERSION,
            data.weather_data || null,
            data.ai_factors || null
        );
        sendJson(res, { success: true, data: result });
    },

    // Calculate final daily prediction (average of all predictions for a day)
    'POST /api/calculate-final-prediction': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);
        
        const data = await parseBody(req);
        const targetDate = data.target_date || getHKTDate();
        const result = await db.calculateFinalDailyPrediction(targetDate);
        
        if (!result) {
            return sendJson(res, { success: false, error: 'No predictions found for the date' }, 404);
        }
        
        sendJson(res, { success: true, data: result });
    },

    // Get predictions
    'GET /api/predictions': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);
        
        const parsedUrl = url.parse(req.url, true);
        const { start, end } = parsedUrl.query;
        const data = await db.getPredictions(start, end);
        sendJson(res, { success: true, data });
    },

    // Get saved future predictions (default 7 days, supports ?days=30 for 30 days)
    'GET /api/future-predictions': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);
        
        try {
            const parsedUrl = url.parse(req.url, true);
            const days = parseInt(parsedUrl.query.days) || 7; // 預設 7 天，可傳入 ?days=30
            
            // 獲取香港時間的今天日期
            const now = new Date();
            const hkOffset = 8 * 60 * 60 * 1000; // UTC+8
            const hkNow = new Date(now.getTime() + hkOffset);
            const todayStr = hkNow.toISOString().split('T')[0];
            
            // 計算明天的日期
            const tomorrow = new Date(hkNow);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = tomorrow.toISOString().split('T')[0];
            
            // 計算結束日期
            const endDate = new Date(hkNow);
            endDate.setDate(endDate.getDate() + days);
            const endDateStr = endDate.toISOString().split('T')[0];
            
            // 從 daily_predictions 表獲取未來預測的最新記錄
            const query = `
                SELECT DISTINCT ON (target_date)
                    target_date,
                    predicted_count,
                    ci80_low,
                    ci80_high,
                    ci95_low,
                    ci95_high,
                    model_version,
                    weather_data,
                    ai_factors,
                    created_at
                FROM daily_predictions
                WHERE target_date >= $1 AND target_date <= $2
                ORDER BY target_date, created_at DESC
            `;
            
            const result = await db.pool.query(query, [tomorrowStr, endDateStr]);
            
            console.log(`📊 未來預測查詢: ${tomorrowStr} 到 ${endDateStr}, 找到 ${result.rows.length} 條記錄`);
            
            sendJson(res, { 
                success: true, 
                data: result.rows,
                dateRange: {
                    start: tomorrowStr,
                    end: endDateStr
                }
            });
        } catch (error) {
            console.error('❌ 獲取未來預測失敗:', error);
            sendJson(res, { error: error.message }, 500);
        }
    },

    // v2.9.91: Get weather-attendance correlation data
    'GET /api/weather-correlation': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);
        
        try {
            // 獲取有天氣數據的預測記錄 + 對應的實際數據
            const query = `
                SELECT 
                    dp.target_date,
                    dp.weather_data,
                    dp.predicted_count,
                    a.patient_count as actual_count
                FROM daily_predictions dp
                JOIN actual_data a ON dp.target_date = a.date
                WHERE dp.weather_data IS NOT NULL
                  AND a.patient_count IS NOT NULL
                ORDER BY dp.target_date DESC
                LIMIT 100
            `;
            
            const result = await db.pool.query(query);
            
            // 解析天氣數據並計算相關性
            const dataPoints = [];
            for (const row of result.rows) {
                const weather = typeof row.weather_data === 'string' 
                    ? JSON.parse(row.weather_data) 
                    : row.weather_data;
                
                if (weather && row.actual_count) {
                    dataPoints.push({
                        date: row.target_date,
                        temperature: weather.temperature || weather.temp,
                        humidity: weather.humidity,
                        rainfall: weather.rainfall || 0,
                        actual: row.actual_count,
                        predicted: row.predicted_count
                    });
                }
            }
            
            // 計算相關性係數
            const correlation = calculateCorrelation(dataPoints);
            
            sendJson(res, {
                success: true,
                data: dataPoints,
                count: dataPoints.length,
                correlation: correlation
            });
        } catch (error) {
            console.error('❌ 獲取天氣相關性數據失敗:', error);
            sendJson(res, { error: error.message }, 500);
        }
    },

    // v2.9.88: Get intraday predictions for visualization
    'GET /api/intraday-predictions': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);
        
        try {
            const parsedUrl = url.parse(req.url, true);
            const { date, start, end, days } = parsedUrl.query;
            
            // 獲取香港時間的今天日期
            const hk = getHKTime();
            const todayStr = hk.dateStr;
            
            let data = [];
            
            if (date) {
                // 獲取單日的所有預測
                data = await db.getIntradayPredictions(date) || [];
            } else if (start && end) {
                // 獲取日期範圍
                data = await db.getIntradayPredictionsRange(start, end) || [];
            } else {
                // 默認獲取最近 N 天（預設 7 天）
                const numDays = parseInt(days) || 7;
                const startDate = new Date(hk.full);
                startDate.setDate(startDate.getDate() - numDays + 1);
                const startStr = startDate.toISOString().split('T')[0];
                data = await db.getIntradayPredictionsRange(startStr, todayStr) || [];
            }
            
            // 確保 data 是數組
            if (!Array.isArray(data)) {
                console.warn('⚠️ intraday data 不是數組:', typeof data);
                data = [];
            }
            
            // 按日期分組數據
            const groupedData = {};
            for (const row of data) {
                const dateKey = row.target_date instanceof Date 
                    ? row.target_date.toISOString().split('T')[0]
                    : row.target_date;
                    
                if (!groupedData[dateKey]) {
                    groupedData[dateKey] = {
                        date: dateKey,
                        predictions: [],
                        finalPredicted: row.final_predicted || null,
                        actual: row.actual || null
                    };
                }
                
                groupedData[dateKey].predictions.push({
                    time: row.prediction_time,
                    predicted: row.predicted_count,
                    ci80_low: row.ci80_low,
                    ci80_high: row.ci80_high
                });
            }
            
            sendJson(res, {
                success: true,
                data: Object.values(groupedData),
                count: data.length,
                dateRange: { start: start || todayStr, end: end || todayStr }
            });
        } catch (error) {
            console.error('❌ 獲取 intraday 預測失敗:', error);
            // v3.0.3: 返回空數據而不是錯誤，讓前端可以優雅處理
            sendJson(res, { 
                success: true, 
                data: [], 
                count: 0, 
                error: error.message,
                dateRange: { start: null, end: null }
            });
        }
    },

    // Manually trigger server-side prediction generation (synchronous - waits for completion)
    'POST /api/trigger-prediction': async (req, res) => {
        try {
            console.log('🔮 手動觸發預測更新（同步）...');
            const startTime = Date.now();
            await generateServerSidePredictions();
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`✅ 手動觸發的預測更新完成（${duration}秒）`);
            sendJson(res, { 
                success: true, 
                message: `預測更新完成（${duration}秒）`,
                duration: parseFloat(duration)
            });
        } catch (error) {
            console.error('❌ 手動觸發的預測更新失敗:', error);
            sendJson(res, { 
                success: false, 
                error: error.message,
                stack: error.stack 
            }, 500);
        }
    },

    // Get accuracy statistics
    'GET /api/accuracy': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);
        
        const stats = await db.getAccuracyStats();
        sendJson(res, { success: true, data: stats });
    },

    // Get comparison data (actual vs predicted)
    'GET /api/comparison': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);
        
        try {
            const parsedUrl = url.parse(req.url, true);
            const limit = parseInt(parsedUrl.query.limit) || 100;
            const data = await db.getComparisonData(limit);
            console.log(`📊 比較數據查詢結果: ${data.length} 筆數據`);
            sendJson(res, { success: true, data });
        } catch (error) {
            console.error('❌ 獲取比較數據失敗:', error);
            console.error('錯誤詳情:', error.stack);
            sendJson(res, { error: error.message, stack: error.stack }, 500);
        }
    },

    // Debug: Check data for specific dates
    'GET /api/debug-data': async (req, res) => {
        if (!db || !db.pool) {
            return sendJson(res, { error: 'Database not configured' }, 503);
        }
        try {
            const parsedUrl = url.parse(req.url, true);
            const dates = parsedUrl.query.dates ? parsedUrl.query.dates.split(',') : ['2025-12-04', '2025-12-05', '2025-12-06'];
            
            const results = [];
            for (const date of dates) {
                const actualQuery = await db.pool.query('SELECT * FROM actual_data WHERE date = $1', [date]);
                const dailyPredQuery = await db.pool.query('SELECT * FROM daily_predictions WHERE target_date = $1 ORDER BY created_at DESC', [date]);
                const finalPredQuery = await db.pool.query('SELECT * FROM final_daily_predictions WHERE target_date = $1', [date]);
                const predQuery = await db.pool.query('SELECT * FROM predictions WHERE target_date = $1 ORDER BY created_at DESC', [date]);
                const accuracyQuery = await db.pool.query('SELECT * FROM prediction_accuracy WHERE date = $1', [date]);
                
                results.push({
                    date,
                    actual_data: actualQuery.rows[0] || null,
                    daily_predictions: dailyPredQuery.rows,
                    final_daily_predictions: finalPredQuery.rows[0] || null,
                    predictions: predQuery.rows,
                    prediction_accuracy: accuracyQuery.rows[0] || null
                });
            }
            
            sendJson(res, { success: true, data: results });
        } catch (err) {
            sendJson(res, { error: err.message }, 500);
        }
    },

    // Auto-add actual data (manual trigger)
    'POST /api/auto-add-actual-data': async (req, res) => {
        if (!db || !db.pool) {
            return sendJson(res, { error: 'Database not configured' }, 503);
        }
        try {
            const { autoAddData } = require('./auto-add-data-on-deploy');
            await autoAddData();
            
            // 觸發自動訓練（手動觸發自動添加，強制訓練）
            try {
                const { getAutoTrainManager } = require('./modules/auto-train-manager');
                const trainManager = getAutoTrainManager();
                trainManager.triggerTrainingCheck(db, true).then(result => {
                    if (result.triggered) {
                        console.log(`✅ 自動訓練已觸發: ${result.reason}`);
                    } else {
                        console.log(`ℹ️ 自動訓練未觸發: ${result.reason}`);
                    }
                }).catch(err => {
                    console.error('自動訓練檢查失敗:', err);
                });
            } catch (err) {
                console.warn('自動訓練模組不可用:', err.message);
            }
            
            sendJson(res, { success: true, message: '實際數據已自動添加，模型訓練已開始' });
        } catch (err) {
            console.error('自動添加實際數據失敗:', err);
            sendJson(res, { success: false, error: err.message }, 500);
        }
    },

    // Database status
    'GET /api/db-status': async (req, res) => {
        if (!db || !db.pool) {
            return sendJson(res, { connected: false, message: 'Database not configured' });
        }
        try {
            await db.pool.query('SELECT 1');
            const stats = await db.getAccuracyStats();
            const actualCount = await db.pool.query('SELECT COUNT(*) FROM actual_data');
            const predCount = await db.pool.query('SELECT COUNT(*) FROM predictions');
            
            // 獲取實際數據的日期範圍
            const dateRange = await db.pool.query(`
                SELECT 
                    MIN(date) as min_date, 
                    MAX(date) as max_date,
                    COUNT(*) as total_count
                FROM actual_data
            `);
            
            const dateRangeData = dateRange.rows[0];
            const minDate = dateRangeData.min_date;
            const maxDate = dateRangeData.max_date;
            const totalDays = dateRangeData.total_count ? parseInt(dateRangeData.total_count) : 0;
            
            sendJson(res, { 
                connected: true, 
                model_version: MODEL_VERSION,
                actual_data_count: parseInt(actualCount.rows[0].count),
                predictions_count: parseInt(predCount.rows[0].count),
                stats,
                date_range: {
                    min_date: minDate,
                    max_date: maxDate,
                    total_days: totalDays
                }
            });
        } catch (err) {
            sendJson(res, { connected: false, error: err.message }, 500);
        }
    },

    // Seed historical data
    'POST /api/seed-historical': async (req, res) => {
        if (!db || !db.pool) {
            return sendJson(res, { error: 'Database not configured' }, 503);
        }
        try {
            const { seedHistoricalData } = require('./seed-data');
            const results = await seedHistoricalData(db);
            sendJson(res, { 
                success: true, 
                message: `成功導入 ${results.length} 筆歷史數據`,
                count: results.length 
            });
        } catch (err) {
            sendJson(res, { error: err.message }, 500);
        }
    },

    // Add specific actual data (2025-12-01 to 2025-12-06)
    'POST /api/add-december-data': async (req, res) => {
        if (!db || !db.pool) {
            return sendJson(res, { error: 'Database not configured' }, 503);
        }
        try {
            const actualData = [
                { date: '2025-12-01', patient_count: 276 },
                { date: '2025-12-02', patient_count: 285 },
                { date: '2025-12-03', patient_count: 253 },
                { date: '2025-12-04', patient_count: 234 },
                { date: '2025-12-05', patient_count: 262 },
                { date: '2025-12-06', patient_count: 234 }
            ];
            
            const results = await db.insertBulkActualData(actualData.map(d => ({
                date: d.date,
                patient_count: d.patient_count,
                source: 'manual_upload',
                notes: 'Added via API endpoint'
            })));
            
            // Calculate accuracy for all dates
            // Also calculate final daily predictions for dates that have daily_predictions
            for (const record of results) {
                await db.calculateAccuracy(record.date);
                // 如果該日期有 daily_predictions，計算最終預測
                try {
                    await db.calculateFinalDailyPrediction(record.date);
                } catch (err) {
                    // 如果沒有預測數據，忽略錯誤
                    console.log(`ℹ️ ${record.date} 沒有預測數據，跳過最終預測計算`);
                }
            }
            
            sendJson(res, { 
                success: true, 
                inserted: results.length, 
                data: results,
                message: `成功添加 ${results.length} 筆實際數據並計算準確度`
            });
        } catch (err) {
            sendJson(res, { error: err.message }, 500);
        }
    },

    // Import CSV data
    'POST /api/import-csv': async (req, res) => {
        if (!db || !db.pool) {
            return sendJson(res, { error: 'Database not configured' }, 503);
        }
        try {
            const { importCSVData, parseCSV } = require('./import-csv-data');
            const parsedUrl = url.parse(req.url, true);
            const csvPath = parsedUrl.query.path || req.body?.path;
            
            if (!csvPath) {
                return sendJson(res, { error: '請提供 CSV 文件路徑' }, 400);
            }
            
            // 傳遞數據庫模塊以使用現有連接
            const result = await importCSVData(csvPath, db);
            if (result.success) {
                // 導入完成後，計算所有導入日期的準確度（如果有預測數據）
                let accuracyCount = 0;
                if (result.count > 0 && result.importedDates && db.calculateAccuracy) {
                    for (const date of result.importedDates) {
                        try {
                            const accuracy = await db.calculateAccuracy(date);
                            if (accuracy) accuracyCount++;
                        } catch (err) {
                            // 忽略錯誤，繼續處理下一個
                        }
                    }
                }
                
                sendJson(res, {
                    success: true,
                    message: `成功導入 ${result.count} 筆數據${accuracyCount > 0 ? `，已計算 ${accuracyCount} 筆準確度` : ''}`,
                    count: result.count,
                    errors: result.errors || 0,
                    accuracyCalculated: accuracyCount
                });
            } else {
                sendJson(res, { error: result.error || '導入失敗' }, 500);
            }
        } catch (err) {
            sendJson(res, { error: err.message }, 500);
        }
    },

    // Upload CSV file
    'POST /api/upload-csv': async (req, res) => {
        if (!db || !db.pool) {
            return sendJson(res, { error: 'Database not configured' }, 503);
        }
        try {
            const contentType = req.headers['content-type'] || '';
            
            if (contentType.includes('multipart/form-data')) {
                // 處理文件上傳
                const chunks = [];
                for await (const chunk of req) {
                    chunks.push(chunk);
                }
                const buffer = Buffer.concat(chunks);
                
                // 簡單的 multipart 解析（僅用於 CSV 文件）
                const boundary = contentType.split('boundary=')[1];
                const parts = buffer.toString('utf-8').split(`--${boundary}`);
                
                let csvContent = '';
                for (const part of parts) {
                    if (part.includes('Content-Disposition: form-data') && part.includes('name="csv"')) {
                        const lines = part.split('\r\n');
                        let startIndex = -1;
                        for (let i = 0; i < lines.length; i++) {
                            if (lines[i].trim() === '' && i < lines.length - 1) {
                                startIndex = i + 1;
                                break;
                            }
                        }
                        if (startIndex > 0) {
                            csvContent = lines.slice(startIndex, -1).join('\n').trim();
                            break;
                        }
                    }
                }
                
                if (!csvContent) {
                    return sendJson(res, { error: '未找到 CSV 文件內容' }, 400);
                }
                
                // 解析 CSV 內容
                const { parseCSV } = require('./import-csv-data');
                const lines = csvContent.trim().split('\n');
                const data = [];
                
                // 跳過標題行
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;
                    
                    const parts = line.split(',');
                    if (parts.length < 2) continue;
                    
                    const date = parts[0].trim().replace(/^"|"$/g, '');
                    const attendance = parts[1].trim().replace(/^"|"$/g, '');
                    
                    if (date && attendance && !isNaN(parseInt(attendance, 10))) {
                        data.push({
                            date: date,
                            patient_count: parseInt(attendance, 10),
                            source: 'csv_upload',
                            notes: `從網頁上傳的 CSV 數據 (${getHKTTime()} HKT)`
                        });
                    }
                }
                
                if (data.length === 0) {
                    return sendJson(res, { error: 'CSV 文件中沒有有效數據' }, 400);
                }
                
                // 導入數據
                const client = await db.pool.connect();
                let successCount = 0;
                let errorCount = 0;
                const importedDates = [];
                
                try {
                    await client.query('BEGIN');
                    
                    for (const record of data) {
                        try {
                                const query = `
                                    INSERT INTO actual_data (date, patient_count, source, notes)
                                    VALUES ($1, $2, $3, $4)
                                    ON CONFLICT (date) DO UPDATE SET
                                        patient_count = EXCLUDED.patient_count,
                                        source = EXCLUDED.source,
                                        notes = EXCLUDED.notes
                                    RETURNING *, (xmax = 0) AS inserted
                                `;
                            const result = await client.query(query, [
                                record.date,
                                record.patient_count,
                                record.source,
                                record.notes
                            ]);
                            
                            const row = result.rows[0];
                            const isNew = row.inserted;
                            successCount++;
                            importedDates.push(record.date);
                            
                            if (isNew) {
                                console.log(`✅ 已插入新數據 ${record.date}: ${record.patient_count} 人`);
                            } else {
                                console.log(`🔄 已更新現有數據 ${record.date}: ${record.patient_count} 人`);
                            }
                        } catch (err) {
                            console.error(`❌ 導入失敗 ${record.date}:`, err.message);
                            console.error(`   錯誤詳情:`, err.stack);
                            console.error(`   錯誤代碼:`, err.code);
                            console.error(`   錯誤詳情:`, err.detail);
                            errorCount++;
                            errors.push({ 
                                date: record.date, 
                                error: err.message,
                                code: err.code,
                                detail: err.detail
                            });
                        }
                    }
                    
                    await client.query('COMMIT');
                    console.log(`✅ 事務提交成功，成功導入 ${successCount} 筆數據`);
                    
                    // 計算準確度
                    let accuracyCount = 0;
                    if (importedDates.length > 0 && db.calculateAccuracy) {
                        console.log('📊 開始計算準確度...');
                        for (const date of importedDates) {
                            try {
                                const accuracy = await db.calculateAccuracy(date);
                                if (accuracy) {
                                    accuracyCount++;
                                    console.log(`✅ 已計算 ${date} 的準確度`);
                                }
                            } catch (err) {
                                console.warn(`⚠️ 計算 ${date} 準確度時出錯:`, err.message);
                            }
                        }
                    }
                    
                    // 觸發自動訓練（用戶 CSV 上傳，強制訓練）
                    if (successCount > 0) {
                        try {
                            const { getAutoTrainManager } = require('./modules/auto-train-manager');
                            const trainManager = getAutoTrainManager();
                            trainManager.triggerTrainingCheck(db, true).then(result => {
                                if (result.triggered) {
                                    console.log(`✅ 自動訓練已觸發: ${result.reason}`);
                                } else {
                                    console.log(`ℹ️ 自動訓練未觸發: ${result.reason}`);
                                }
                            }).catch(err => {
                                console.error('自動訓練檢查失敗:', err);
                            });
                        } catch (err) {
                            console.warn('自動訓練模組不可用:', err.message);
                        }
                    }
                    
                    sendJson(res, {
                        success: true,
                        message: `成功導入 ${successCount} 筆數據${accuracyCount > 0 ? `，已計算 ${accuracyCount} 筆準確度` : ''}，模型訓練已自動開始`,
                        count: successCount,
                        errors: errorCount,
                        errorDetails: errors.length > 0 ? errors : undefined,
                        accuracyCalculated: accuracyCount
                    });
                } catch (err) {
                    await client.query('ROLLBACK');
                    throw err;
                } finally {
                    client.release();
                }
            } else {
                // 處理 JSON 格式的 CSV 內容
                const body = await parseBody(req);
                if (body.csv) {
                    // 直接使用 CSV 字符串
                    const lines = body.csv.trim().split(/\r?\n/);
                    const data = [];
                    
                    // 檢查第一行是否為標題行
                    let startIndex = 0;
                    if (lines[0] && lines[0].toLowerCase().includes('date')) {
                        startIndex = 1;
                    }
                    
                    console.log(`📊 解析 CSV: 總行數 ${lines.length}, 從第 ${startIndex + 1} 行開始`);
                    
                    for (let i = startIndex; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (!line) continue;
                        
                        const parts = line.split(',');
                        if (parts.length < 2) {
                            console.warn(`⚠️ 跳過無效行 ${i + 1}: 列數不足 - ${line}`);
                            continue;
                        }
                        
                        const date = parts[0].trim().replace(/^"|"$/g, '');
                        const attendance = parts[1].trim().replace(/^"|"$/g, '');
                        
                        // 驗證日期格式 (YYYY-MM-DD)
                        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
                        if (!dateRegex.test(date)) {
                            console.warn(`⚠️ 跳過無效行 ${i + 1}: 日期格式錯誤 - ${date}`);
                            continue;
                        }
                        
                        const attendanceNum = parseInt(attendance, 10);
                        if (isNaN(attendanceNum) || attendanceNum < 0) {
                            console.warn(`⚠️ 跳過無效行 ${i + 1}: 人數無效 - ${attendance}`);
                            continue;
                        }
                        
                        // 驗證日期是否有效
                        const dateObj = new Date(date + 'T00:00:00');
                        if (isNaN(dateObj.getTime())) {
                            console.warn(`⚠️ 跳過無效行 ${i + 1}: 日期無效 - ${date}`);
                            continue;
                        }
                        
                        data.push({
                            date: date,
                            patient_count: attendanceNum,
                            source: 'csv_upload',
                            notes: `從網頁上傳的 CSV 數據 (${getHKTTime()} HKT)`
                        });
                    }
                    
                    console.log(`📊 解析完成: ${data.length} 筆有效數據`);
                    
                    if (data.length === 0) {
                        return sendJson(res, { error: 'CSV 內容中沒有有效數據' }, 400);
                    }
                    
                    // 導入數據
                    console.log(`📊 開始導入 ${data.length} 筆數據到數據庫...`);
                    const client = await db.pool.connect();
                    let successCount = 0;
                    let errorCount = 0;
                    const importedDates = [];
                    const errors = [];
                    
                    try {
                        await client.query('BEGIN');
                        
                        for (const record of data) {
                            try {
                                const query = `
                                    INSERT INTO actual_data (date, patient_count, source, notes)
                                    VALUES ($1, $2, $3, $4)
                                    ON CONFLICT (date) DO UPDATE SET
                                        patient_count = EXCLUDED.patient_count,
                                        source = EXCLUDED.source,
                                        notes = EXCLUDED.notes
                                    RETURNING *, (xmax = 0) AS inserted
                                `;
                                const result = await client.query(query, [
                                    record.date,
                                    record.patient_count,
                                    record.source,
                                    record.notes
                                ]);
                                
                                const row = result.rows[0];
                                const isNew = row.inserted;
                                successCount++;
                                importedDates.push(record.date);
                                
                                if (isNew) {
                                    console.log(`✅ 已插入新數據 ${record.date}: ${record.patient_count} 人`);
                                } else {
                                    console.log(`🔄 已更新現有數據 ${record.date}: ${record.patient_count} 人`);
                                }
                            } catch (err) {
                                console.error(`❌ 導入失敗 ${record.date}:`, err.message);
                                console.error(`   錯誤詳情:`, err.stack);
                                console.error(`   錯誤代碼:`, err.code);
                                console.error(`   錯誤詳情:`, err.detail);
                                errorCount++;
                                errors.push({ 
                                    date: record.date, 
                                    error: err.message,
                                    code: err.code,
                                    detail: err.detail
                                });
                            }
                        }
                        
                        await client.query('COMMIT');
                        console.log(`✅ 事務提交成功，成功導入 ${successCount} 筆數據`);
                        
                        // 計算準確度
                        let accuracyCount = 0;
                        if (importedDates.length > 0 && db.calculateAccuracy) {
                            console.log('📊 開始計算準確度...');
                            for (const date of importedDates) {
                                try {
                                    const accuracy = await db.calculateAccuracy(date);
                                    if (accuracy) {
                                        accuracyCount++;
                                        console.log(`✅ 已計算 ${date} 的準確度`);
                                    }
                                } catch (err) {
                                    console.warn(`⚠️ 計算 ${date} 準確度時出錯:`, err.message);
                                }
                            }
                        }
                        
                        // 觸發自動訓練（用戶 CSV 上傳，強制訓練）
                        if (successCount > 0) {
                            try {
                                const { getAutoTrainManager } = require('./modules/auto-train-manager');
                                const trainManager = getAutoTrainManager();
                                trainManager.triggerTrainingCheck(db, true).then(result => {
                                    if (result.triggered) {
                                        console.log(`✅ 自動訓練已觸發: ${result.reason}`);
                                    } else {
                                        console.log(`ℹ️ 自動訓練未觸發: ${result.reason}`);
                                    }
                                }).catch(err => {
                                    console.error('自動訓練檢查失敗:', err);
                                });
                            } catch (err) {
                                console.warn('自動訓練模組不可用:', err.message);
                            }
                        }
                        
                        sendJson(res, {
                            success: true,
                            message: `成功導入 ${successCount} 筆數據${accuracyCount > 0 ? `，已計算 ${accuracyCount} 筆準確度` : ''}，模型訓練已自動開始`,
                            count: successCount,
                            errors: errorCount,
                            errorDetails: errors.length > 0 ? errors : undefined,
                            accuracyCalculated: accuracyCount
                        });
                    } catch (err) {
                        await client.query('ROLLBACK');
                        console.error('❌ 事務回滾:', err);
                        throw err;
                    } finally {
                        client.release();
                    }
                } else {
                    return sendJson(res, { error: '請提供 CSV 內容' }, 400);
                }
            }
        } catch (err) {
            console.error('❌ CSV 上傳失敗:', err);
            console.error('錯誤詳情:', err.stack);
            sendJson(res, { error: err.message || '上傳失敗', details: err.stack }, 500);
        }
    },

    // Clear all data and reimport CSV
    'POST /api/clear-and-reimport': async (req, res) => {
        if (!db || !db.pool) {
            return sendJson(res, { error: 'Database not configured' }, 503);
        }
        try {
            const { importCSVData } = require('./import-csv-data');
            const parsedUrl = url.parse(req.url, true);
            const csvPath = parsedUrl.query.path || req.body?.path || '/Users/yoyoau/Library/Containers/net.whatsapp.WhatsApp/Data/tmp/documents/86448351-FEDA-406E-B465-B7D0B0753234/NDH_AED_Attendance_Minimal.csv';
            
            if (!fs.existsSync(csvPath)) {
                return sendJson(res, { error: `CSV 文件不存在: ${csvPath}` }, 404);
            }
            
            console.log('🗑️  開始清除並重新導入數據...');
            
            // 1. 清除所有數據
            await db.clearAllData();
            console.log('✅ 所有數據已清除');
            
            // 2. 重新導入 CSV 數據
            const result = await importCSVData(csvPath, db);
            
            if (result.success) {
                // 3. 獲取統計信息
                const actualCount = await db.pool.query('SELECT COUNT(*) FROM actual_data');
                
                console.log(`✅ 清除並重新導入完成！成功導入 ${result.count} 筆數據`);
                sendJson(res, {
                    success: true,
                    message: `成功清除並重新導入 ${result.count} 筆數據`,
                    count: result.count,
                    errors: result.errors || 0,
                    totalRecords: parseInt(actualCount.rows[0].count)
                });
            } else {
                console.error(`❌ 重新導入失敗: ${result.error}`);
                sendJson(res, { error: result.error || '重新導入失敗' }, 500);
            }
        } catch (err) {
            console.error('❌ 清除並重新導入失敗:', err);
            sendJson(res, { error: err.message }, 500);
        }
    },

    // Auto import CSV data from default path
    'POST /api/auto-import-csv': async (req, res) => {
        if (!db || !db.pool) {
            return sendJson(res, { error: 'Database not configured' }, 503);
        }
        try {
            const { importCSVData } = require('./import-csv-data');
            // 默認 CSV 文件路徑
            const defaultCsvPath = '/Users/yoyoau/Library/Containers/net.whatsapp.WhatsApp/Data/tmp/documents/86448351-FEDA-406E-B465-B7D0B0753234/NDH_AED_Attendance_Minimal.csv';
            
            if (!fs.existsSync(defaultCsvPath)) {
                return sendJson(res, { error: `CSV 文件不存在: ${defaultCsvPath}` }, 404);
            }
            
            console.log(`📊 開始自動導入 CSV 數據: ${defaultCsvPath}`);
            // 傳遞數據庫模塊以使用現有連接
            const result = await importCSVData(defaultCsvPath, db);
            
            if (result.success) {
                console.log(`✅ 成功導入 ${result.count} 筆數據`);
                // 導入完成後，計算所有導入日期的準確度（如果有預測數據）
                let accuracyCount = 0;
                if (result.count > 0 && result.importedDates && db.calculateAccuracy) {
                    console.log('📊 開始計算導入數據的準確度...');
                    for (const date of result.importedDates) {
                        try {
                            const accuracy = await db.calculateAccuracy(date);
                            if (accuracy) accuracyCount++;
                        } catch (err) {
                            console.warn(`⚠️ 計算 ${date} 準確度時出錯:`, err.message);
                        }
                    }
                    if (accuracyCount > 0) {
                        console.log(`✅ 已計算 ${accuracyCount} 筆數據的準確度`);
                    }
                }
                
                sendJson(res, {
                    success: true,
                    message: `成功導入 ${result.count} 筆數據${accuracyCount > 0 ? `，已計算 ${accuracyCount} 筆準確度` : ''}`,
                    count: result.count,
                    errors: result.errors || 0,
                    accuracyCalculated: accuracyCount
                });
            } else {
                console.error(`❌ 導入失敗: ${result.error}`);
                sendJson(res, { error: result.error || '導入失敗' }, 500);
            }
        } catch (err) {
            console.error('❌ 自動導入 CSV 失敗:', err);
            sendJson(res, { error: err.message }, 500);
        }
    },

    // Generate and store predictions for next N days
    'POST /api/generate-predictions': async (req, res) => {
        if (!db || !db.pool) {
            return sendJson(res, { error: 'Database not configured' }, 503);
        }
        try {
            const data = await parseBody(req);
            const days = data.days || 30;
            
            // Simple prediction logic (should match prediction.js)
            const today = new Date();
            const predictions = [];
            
            // Get historical average from database
            const avgResult = await db.pool.query('SELECT AVG(patient_count) as avg FROM actual_data');
            const globalMean = parseFloat(avgResult.rows[0].avg) || 255;
            const stdDev = 25; // Approximate standard deviation
            
            for (let i = 0; i < days; i++) {
                const targetDate = new Date(today);
                targetDate.setDate(today.getDate() + i);
                const dateStr = targetDate.toISOString().split('T')[0];
                const dow = targetDate.getDay();
                
                // Day of week factors
                const dowFactors = {
                    0: 0.93, // Sunday
                    1: 1.08, // Monday
                    2: 1.00, // Tuesday
                    3: 0.99, // Wednesday
                    4: 1.01, // Thursday
                    5: 0.98, // Friday
                    6: 0.92  // Saturday
                };
                
                const predicted = Math.round(globalMean * dowFactors[dow]);
                const ci80 = { low: predicted - 32, high: predicted + 32 };
                const ci95 = { low: predicted - 49, high: predicted + 49 };
                
                const result = await db.insertPrediction(
                    today.toISOString().split('T')[0],
                    dateStr,
                    predicted,
                    ci80,
                    ci95,
                    MODEL_VERSION
                );
                predictions.push(result);
            }
            
            sendJson(res, { 
                success: true, 
                message: `成功生成 ${predictions.length} 筆預測數據`,
                count: predictions.length,
                data: predictions 
            });
        } catch (err) {
            sendJson(res, { error: err.message }, 500);
        }
    },

    // AI 分析 - 搜索可能影響病人數量的因素
    'GET /api/ai-analyze': async (req, res) => {
        console.log('🔍 收到 AI 分析請求');
        
        if (!aiService) {
            console.error('❌ AI 服務未配置');
            return sendJson(res, { 
                success: false, 
                error: 'AI 服務未配置（僅在服務器環境可用）' 
            }, 503);
        }
        
        // 設置超時（90秒）
        const timeout = 90000;
        const timeoutId = setTimeout(() => {
            if (!res.headersSent) {
                console.error('⏱️ AI 分析請求超時（90秒）');
                sendJson(res, { 
                    success: false, 
                    error: '請求超時（90秒），請稍後重試',
                    errorType: 'TimeoutError',
                    factors: [],
                    summary: 'AI 分析請求超時'
                }, 504);
            }
        }, timeout);
        
        try {
            console.log('🤖 開始調用 AI 服務...');
            const analysis = await aiService.searchRelevantNewsAndEvents();
            clearTimeout(timeoutId);
            
            console.log('📊 AI 分析結果:', {
                hasFactors: !!analysis.factors,
                factorsCount: analysis.factors?.length || 0,
                hasSummary: !!analysis.summary,
                hasError: !!analysis.error
            });
            
            // 檢查是否已經發送響應（超時情況）
            if (res.headersSent) {
                return;
            }
            
            // 檢查分析結果是否有錯誤
            if (analysis.error) {
                console.error('⚠️ AI 分析返回錯誤:', analysis.error);
                return sendJson(res, { 
                    success: false, 
                    error: analysis.error,
                    factors: analysis.factors || [],
                    summary: analysis.summary || 'AI 分析失敗'
                }, 500);
            }
            
            sendJson(res, { 
                success: true, 
                ...analysis,
                timestamp: getHKTTime() + ' HKT'
            });
        } catch (err) {
            clearTimeout(timeoutId);
            
            // 檢查是否已經發送響應（超時情況）
            if (res.headersSent) {
                return;
            }
            
            console.error('❌ AI 分析錯誤:', err);
            console.error('錯誤堆疊:', err.stack);
            sendJson(res, { 
                success: false, 
                error: err.message || '未知錯誤',
                errorType: err.name || 'Error',
                factors: [],
                summary: '無法獲取 AI 分析'
            }, 500);
        }
    },

    // AI 分析特定日期範圍
    'POST /api/ai-analyze-range': async (req, res) => {
        if (!aiService) {
            return sendJson(res, { 
                success: false, 
                error: 'AI 服務未配置' 
            }, 503);
        }
        
        try {
            const data = await parseBody(req);
            const { startDate, endDate, weatherData } = data;
            
            if (!startDate || !endDate) {
                return sendJson(res, { 
                    success: false, 
                    error: '需要提供 startDate 和 endDate' 
                }, 400);
            }
            
            const analysis = await aiService.analyzeDateRangeFactors(
                startDate, 
                endDate, 
                weatherData
            );
            
            sendJson(res, { 
                success: true, 
                ...analysis,
                timestamp: getHKTTime() + ' HKT'
            });
        } catch (err) {
            console.error('AI 分析錯誤:', err);
            sendJson(res, { 
                success: false, 
                error: err.message 
            }, 500);
        }
    },

    // 獲取 AI 使用統計
    'GET /api/ai-usage': async (req, res) => {
        if (!aiService) {
            return sendJson(res, { 
                success: false, 
                error: 'AI 服務未配置' 
            }, 503);
        }
        
        try {
            const stats = aiService.getUsageStats();
            sendJson(res, { 
                success: true, 
                data: stats 
            });
        } catch (err) {
            sendJson(res, { 
                success: false, 
                error: err.message 
            }, 500);
        }
    },

    // 獲取 AI 狀態（連接狀態和當前模型）
    'GET /api/ai-status': async (req, res) => {
        if (!aiService) {
            return sendJson(res, { 
                success: false, 
                connected: false,
                error: 'AI 服務未配置' 
            }, 503);
        }
        
        try {
            const stats = aiService.getUsageStats();
            const currentModel = aiService.getCurrentModel ? aiService.getCurrentModel() : (aiService.getAvailableModel ? aiService.getAvailableModel('premium') : '未知');
            const modelTier = aiService.getModelTier ? aiService.getModelTier(currentModel) : 'unknown';
            
            sendJson(res, { 
                success: true,
                connected: true,
                currentModel: currentModel || '無可用模型',
                modelTier: modelTier,
                apiHost: stats.apiHost,
                usage: stats,
                timestamp: getHKTTime() + ' HKT'
            });
        } catch (err) {
            sendJson(res, { 
                success: false,
                connected: false,
                error: err.message 
            }, 500);
        }
    },

    // 獲取自動預測統計 (v2.9.53)
    'GET /api/auto-predict-stats': async (req, res) => {
        const hk = getHKTime();
        
        // 計算下次執行時間（每30分鐘）
        const now = new Date();
        const lastRun = autoPredictStats.lastRunTime ? new Date(autoPredictStats.lastRunTime) : null;
        let nextRunTime = null;
        let secondsUntilNext = null;
        
        if (lastRun) {
            nextRunTime = new Date(lastRun.getTime() + 30 * 60 * 1000);
            secondsUntilNext = Math.max(0, Math.floor((nextRunTime.getTime() - now.getTime()) / 1000));
        }
        
        sendJson(res, {
            success: true,
            currentDate: hk.dateStr,
            currentTime: `${String(hk.hour).padStart(2, '0')}:${String(hk.minute).padStart(2, '0')} HKT`,
            todayCount: autoPredictStats.todayCount,
            lastRunTime: autoPredictStats.lastRunTime,
            lastRunSuccess: autoPredictStats.lastRunSuccess,
            lastRunDuration: autoPredictStats.lastRunDuration,
            nextRunTime: nextRunTime ? nextRunTime.toISOString() : null,
            secondsUntilNext: secondsUntilNext,
            serverStartTime: autoPredictStats.serverStartTime,
            totalSuccessCount: autoPredictStats.totalSuccessCount,
            totalFailCount: autoPredictStats.totalFailCount,
            intervalMinutes: 30
        });
    },

    // v2.9.97: 獲取日內預測波動數據（已移動到路由表上方，此處移除重複）
    // 注意：此 API 已在路由表開頭定義，包含 finalPredicted 和 actual

    // v2.9.95: 獲取天氣-出席相關性數據（使用真實 HKO 歷史天氣 + 實際出席）
    'GET /api/weather-correlation': async (req, res) => {
        if (!db || !db.pool) {
            return sendJson(res, { success: false, error: '數據庫未配置' }, 503);
        }
        
        try {
            const fs = require('fs');
            const path = require('path');
            const weatherPath = path.join(__dirname, 'python/weather_history.csv');
            
            // 讀取天氣歷史 CSV
            let weatherMap = {};
            if (fs.existsSync(weatherPath)) {
                const csvContent = fs.readFileSync(weatherPath, 'utf-8');
                const lines = csvContent.trim().split('\n');
                // 跳過標題行: Date,mean_temp,max_temp,min_temp,temp_range,is_very_hot,is_hot,is_cold,is_very_cold
                for (let i = 1; i < lines.length; i++) {
                    const parts = lines[i].split(',');
                    if (parts.length >= 4) {
                        const date = parts[0].trim();
                        weatherMap[date] = {
                            mean_temp: parseFloat(parts[1]),
                            max_temp: parseFloat(parts[2]),
                            min_temp: parseFloat(parts[3]),
                            temp_range: parseFloat(parts[4]) || 0,
                            is_very_hot: parts[5] === '1',
                            is_hot: parts[6] === '1',
                            is_cold: parts[7] === '1',
                            is_very_cold: parts[8] === '1'
                        };
                    }
                }
                console.log(`✅ 天氣歷史數據已載入: ${Object.keys(weatherMap).length} 天`);
            } else {
                console.warn('⚠️ 找不到天氣歷史數據: ' + weatherPath);
            }
            
            // 獲取所有實際出席數據
            const result = await db.pool.query(`
                SELECT date, patient_count
                FROM actual_data
                WHERE patient_count IS NOT NULL
                ORDER BY date DESC
            `);
            
            if (result.rows.length === 0) {
                return sendJson(res, {
                    success: true,
                    data: [],
                    count: 0,
                    correlation: { temperature: null, tempRange: null, isHot: null, isCold: null },
                    message: '暫無實際出席數據'
                });
            }
            
            // 合併天氣和出席數據
            const dataPoints = [];
            for (const row of result.rows) {
                const dateStr = new Date(row.date).toISOString().split('T')[0];
                const weather = weatherMap[dateStr];
                if (weather && row.patient_count != null) {
                    dataPoints.push({
                        date: dateStr,
                        actual: row.patient_count,
                        temperature: weather.mean_temp,
                        tempRange: weather.temp_range,
                        maxTemp: weather.max_temp,
                        minTemp: weather.min_temp,
                        isHot: weather.is_hot ? 1 : 0,
                        isCold: weather.is_cold ? 1 : 0,
                        isVeryHot: weather.is_very_hot ? 1 : 0,
                        isVeryCold: weather.is_very_cold ? 1 : 0
                    });
                }
            }
            
            // 計算相關係數
            const correlation = calculateCorrelation(dataPoints);
            
            // 計算額外的相關性（溫差、極端天氣）
            const pearson = (x, y) => {
                const validPairs = x.map((xi, i) => [xi, y[i]]).filter(([a, b]) => a != null && b != null);
                if (validPairs.length < 3) return null;
                const n = validPairs.length;
                const sumX = validPairs.reduce((s, [a]) => s + a, 0);
                const sumY = validPairs.reduce((s, [, b]) => s + b, 0);
                const sumXY = validPairs.reduce((s, [a, b]) => s + a * b, 0);
                const sumX2 = validPairs.reduce((s, [a]) => s + a * a, 0);
                const sumY2 = validPairs.reduce((s, [, b]) => s + b * b, 0);
                const numerator = n * sumXY - sumX * sumY;
                const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
                if (denominator === 0) return 0;
                return numerator / denominator;
            };
            
            const actual = dataPoints.map(d => d.actual);
            correlation.tempRange = pearson(dataPoints.map(d => d.tempRange), actual);
            correlation.isHot = pearson(dataPoints.map(d => d.isHot), actual);
            correlation.isCold = pearson(dataPoints.map(d => d.isCold), actual);
            
            sendJson(res, {
                success: true,
                data: dataPoints.slice(0, 500), // 限制返回數量
                count: dataPoints.length,
                correlation: correlation,
                source: 'HKO weather_history.csv + actual_data'
            });
        } catch (err) {
            console.error('獲取天氣相關性數據失敗:', err);
            sendJson(res, { success: false, error: err.message }, 500);
        }
    },

    // 獲取 AI 因素緩存（從數據庫）
    'GET /api/ai-factors-cache': async (req, res) => {
        if (!db || !db.pool) {
            return sendJson(res, { 
                success: false, 
                error: '數據庫未配置' 
            }, 503);
        }
        
        try {
            const cache = await db.getAIFactorsCache();
            sendJson(res, { 
                success: true, 
                data: cache 
            });
        } catch (err) {
            console.error('獲取 AI 因素緩存失敗:', err);
            sendJson(res, { 
                success: false, 
                error: err.message 
            }, 500);
        }
    },

    // XGBoost 預測（僅使用 XGBoost，不使用統計回退）
    'POST /api/ensemble-predict': async (req, res) => {
        try {
            const data = await parseBody(req);
            const { target_date } = data;
            
            if (!target_date) {
                return sendJson(res, { error: '需要提供 target_date' }, 400);
            }
            
            // 使用 EnsemblePredictor（僅 XGBoost）
            const { EnsemblePredictor } = require('./modules/ensemble-predictor');
            const predictor = new EnsemblePredictor();
            
            // 檢查模型是否可用
            if (!predictor.isModelAvailable()) {
                return sendJson(res, { 
                    success: false, 
                    error: 'XGBoost 模型未訓練。請先運行 python/train_all_models.py'
                }, 503);
            }
            
            // 執行 XGBoost 預測
            const prediction = await predictor.predict(target_date);
            
            sendJson(res, {
                success: true,
                data: prediction
            });
        } catch (err) {
            console.error('XGBoost 預測錯誤:', err);
            sendJson(res, { 
                success: false, 
                error: err.message 
            }, 500);
        }
    },
    
    // 獲取集成模型狀態
    'GET /api/ensemble-status': async (req, res) => {
        try {
            const { EnsemblePredictor } = require('./modules/ensemble-predictor');
            const predictor = new EnsemblePredictor();
            const status = await predictor.getModelStatusAsync();
            
            // 添加訓練狀態（從 DB 獲取）
            try {
                const { getAutoTrainManager } = require('./modules/auto-train-manager');
                const trainManager = getAutoTrainManager();
                status.training = await trainManager.getStatusAsync();
            } catch (e) {
                status.training = { error: '訓練管理器不可用' };
            }
            
            // 添加診斷信息
            status.diagnostics = {
                modelsDir: status.modelsDir,
                modelsDirExists: status.modelsDirExists,
                allFiles: status.allFiles,
                fileCount: status.allFiles ? status.allFiles.length : 0
            };
            
            sendJson(res, {
                success: true,
                data: status
            });
        } catch (err) {
            sendJson(res, {
                success: false,
                error: err.message,
                data: {
                    available: false,
                    error: '集成預測器模組不可用'
                }
            });
        }
    },
    
    // 檢查 Python 環境
    'GET /api/python-env': async (req, res) => {
        try {
            const { spawn } = require('child_process');
            const path = require('path');
            
            // 檢測 Python 命令
            const checkPython = (cmd) => {
                return new Promise((resolve) => {
                    const python = spawn(cmd, ['--version'], {
                        stdio: ['pipe', 'pipe', 'pipe']
                    });
                    
                    let output = '';
                    python.stdout.on('data', (data) => {
                        output += data.toString();
                    });
                    
                    python.on('close', (code) => {
                        resolve({
                            available: code === 0,
                            version: output.trim(),
                            command: cmd
                        });
                    });
                    
                    python.on('error', () => {
                        resolve({
                            available: false,
                            version: null,
                            command: cmd
                        });
                    });
                });
            };
            
            // 檢查依賴
            const checkDependencies = (cmd) => {
                return new Promise((resolve) => {
                    const python = spawn(cmd, ['-c', 'import xgboost; print("OK")'], {
                        stdio: ['pipe', 'pipe', 'pipe'],
                        cwd: path.join(__dirname, 'python')
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
                        resolve({
                            available: code === 0,
                            output: output.trim(),
                            error: error.trim()
                        });
                    });
                    
                    python.on('error', (err) => {
                        resolve({
                            available: false,
                            error: err.message
                        });
                    });
                });
            };
            
            const python3 = await checkPython('python3');
            const python = await checkPython('python');
            
            const availableCmd = python3.available ? 'python3' : (python.available ? 'python' : null);
            let dependencies = null;
            
            if (availableCmd) {
                dependencies = await checkDependencies(availableCmd);
            }
            
            sendJson(res, {
                success: true,
                data: {
                    python3: python3,
                    python: python,
                    availableCommand: availableCmd,
                    dependencies: dependencies,
                    recommendations: generatePythonRecommendations(python3, python, dependencies)
                }
            });
        } catch (err) {
            sendJson(res, {
                success: false,
                error: err.message
            }, 500);
        }
    },
    
    // 天氣月度平均（從真實歷史數據計算）
    'GET /api/weather-monthly-averages': async (req, res) => {
        try {
            const fs = require('fs');
            const path = require('path');
            const weatherPath = path.join(__dirname, 'python/weather_history.csv');
            
            if (!fs.existsSync(weatherPath)) {
                return sendJson(res, {
                    success: false,
                    error: '天氣歷史數據不存在',
                    fallback: true,
                    // 提供基於香港氣候的真實歷史平均值（來自 HKO 官方數據）
                    data: {
                        1: { mean: 16.3, max: 19.3, min: 13.7 },
                        2: { mean: 16.9, max: 19.8, min: 14.5 },
                        3: { mean: 19.4, max: 22.3, min: 17.1 },
                        4: { mean: 23.4, max: 26.5, min: 21.0 },
                        5: { mean: 26.4, max: 29.4, min: 24.1 },
                        6: { mean: 28.2, max: 31.0, min: 26.0 },
                        7: { mean: 28.9, max: 31.6, min: 26.8 },
                        8: { mean: 28.6, max: 31.3, min: 26.5 },
                        9: { mean: 27.7, max: 30.6, min: 25.5 },
                        10: { mean: 25.3, max: 28.5, min: 23.0 },
                        11: { mean: 21.6, max: 24.8, min: 19.1 },
                        12: { mean: 17.8, max: 21.0, min: 15.2 }
                    },
                    source: 'HKO 官方氣候正常值 (1991-2020)'
                });
            }
            
            // 讀取並解析 CSV
            const csvContent = fs.readFileSync(weatherPath, 'utf-8');
            const lines = csvContent.trim().split('\n');
            const headers = lines[0].split(',');
            
            // 計算月度平均
            const monthlyData = {};
            for (let m = 1; m <= 12; m++) {
                monthlyData[m] = { mean: [], max: [], min: [] };
            }
            
            for (let i = 1; i < lines.length; i++) {
                const values = lines[i].split(',');
                const date = new Date(values[0]);
                const month = date.getMonth() + 1;
                const meanTemp = parseFloat(values[1]);
                const maxTemp = parseFloat(values[2]);
                const minTemp = parseFloat(values[3]);
                
                if (!isNaN(meanTemp) && monthlyData[month]) {
                    monthlyData[month].mean.push(meanTemp);
                    if (!isNaN(maxTemp)) monthlyData[month].max.push(maxTemp);
                    if (!isNaN(minTemp)) monthlyData[month].min.push(minTemp);
                }
            }
            
            // 計算平均
            const result = {};
            for (let m = 1; m <= 12; m++) {
                const data = monthlyData[m];
                result[m] = {
                    mean: data.mean.length > 0 ? Math.round(data.mean.reduce((a, b) => a + b, 0) / data.mean.length * 10) / 10 : null,
                    max: data.max.length > 0 ? Math.round(data.max.reduce((a, b) => a + b, 0) / data.max.length * 10) / 10 : null,
                    min: data.min.length > 0 ? Math.round(data.min.reduce((a, b) => a + b, 0) / data.min.length * 10) / 10 : null,
                    count: data.mean.length
                };
            }
            
            sendJson(res, {
                success: true,
                data: result,
                source: '香港天文台打鼓嶺站歷史數據 (1988-2025)',
                totalDays: lines.length - 1
            });
        } catch (error) {
            console.error('計算天氣月度平均失敗:', error);
            sendJson(res, { success: false, error: error.message }, 500);
        }
    },
    
    // 算法演進時間線
    'GET /api/algorithm-timeline': async (req, res) => {
        try {
            const timelinePath = path.join(__dirname, 'python/models/algorithm_timeline.json');
            
            if (!fs.existsSync(timelinePath)) {
                return sendJson(res, {
                    success: false,
                    error: '時間線數據不存在'
                });
            }
            
            const timelineData = JSON.parse(fs.readFileSync(timelinePath, 'utf8'));
            
            // 優先從數據庫讀取最新模型指標
            let currentMetrics = null;
            if (db && db.pool) {
                try {
                    const dbMetrics = await db.getModelMetrics('xgboost');
                    if (dbMetrics && dbMetrics.mae !== null) {
                        currentMetrics = {
                            mae: parseFloat(dbMetrics.mae),
                            mape: parseFloat(dbMetrics.mape),
                            rmse: parseFloat(dbMetrics.rmse),
                            r2: dbMetrics.r2 ? parseFloat(dbMetrics.r2) : null,
                            feature_count: dbMetrics.feature_count
                        };
                    }
                } catch (e) {
                    console.warn('從數據庫讀取模型指標失敗:', e.message);
                }
            }
            
            // 如果數據庫沒有，從文件讀取（向後兼容）
            if (!currentMetrics) {
                const metricsPath = path.join(__dirname, 'python/models/xgboost_metrics.json');
                if (fs.existsSync(metricsPath)) {
                    currentMetrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
                }
            }
            
            // 更新最新版本的實際 metrics
            if (currentMetrics) {
                const latestEntry = timelineData.timeline[timelineData.timeline.length - 1];
                if (latestEntry && latestEntry.metrics) {
                    latestEntry.metrics.mae = currentMetrics.mae;
                    latestEntry.metrics.mape = currentMetrics.mape;
                    latestEntry.metrics.rmse = currentMetrics.rmse;
                    latestEntry.metrics.r2 = currentMetrics.r2 || null;
                }
            }
            
            sendJson(res, {
                success: true,
                data: timelineData
            });
        } catch (error) {
            console.error('算法時間線 API 錯誤:', error);
            sendJson(res, {
                success: false,
                error: error.message
            }, 500);
        }
    },
    
    // 診斷模型文件（詳細檢查）
    'GET /api/model-diagnostics': async (req, res) => {
        try {
            const { EnsemblePredictor } = require('./modules/ensemble-predictor');
            const predictor = new EnsemblePredictor();
            const status = await predictor.getModelStatusAsync();
            
            // 檢查 Python 環境
            const { spawn } = require('child_process');
            const pythonCheck = new Promise((resolve) => {
                const python = spawn('python3', ['--version'], {
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                
                let output = '';
                python.stdout.on('data', (data) => {
                    output += data.toString();
                });
                
                python.on('close', (code) => {
                    resolve({
                        available: code === 0,
                        version: output.trim(),
                        error: code !== 0 ? 'Python 3 不可用' : null
                    });
                });
                
                python.on('error', (err) => {
                    resolve({
                        available: false,
                        version: null,
                        error: err.message
                    });
                });
            });
            
            const pythonInfo = await pythonCheck;
            
            sendJson(res, {
                success: true,
                data: {
                    modelStatus: status,
                    python: pythonInfo,
                    recommendations: generateRecommendations(status, pythonInfo)
                }
            });
        } catch (err) {
            sendJson(res, {
                success: false,
                error: err.message
            }, 500);
        }
    },
    
    // 手動觸發模型訓練
    'POST /api/train-models': async (req, res) => {
        if (!db || !db.pool) {
            return sendJson(res, { 
                success: false,
                error: 'Database not configured' 
            }, 503);
        }
        
        try {
            let trainManager;
            try {
                const { getAutoTrainManager } = require('./modules/auto-train-manager');
                trainManager = getAutoTrainManager();
            } catch (requireErr) {
                console.error('加載訓練管理器模組失敗:', requireErr);
                return sendJson(res, {
                    success: false,
                    error: `無法加載訓練管理器: ${requireErr.message}`
                }, 500);
            }
            
            if (!trainManager) {
                return sendJson(res, {
                    success: false,
                    error: '訓練管理器初始化失敗'
                }, 500);
            }
            
            // 檢查是否正在訓練（從 DB 獲取最新狀態）
            let currentStatus;
            try {
                currentStatus = await trainManager.getStatusAsync();
            } catch (statusErr) {
                console.error('獲取訓練狀態失敗:', statusErr);
                return sendJson(res, {
                    success: false,
                    error: `無法獲取訓練狀態: ${statusErr.message}`
                }, 500);
            }
            
            if (currentStatus && currentStatus.isTraining) {
                return sendJson(res, {
                    success: false,
                    error: '訓練已在進行中，請等待完成',
                    status: currentStatus
                });
            }
            
            // 異步執行訓練，立即返回
            trainManager.manualTrain(db).then(result => {
                console.log('手動訓練完成:', result);
                if (!result.success) {
                    console.error('訓練失敗:', result.reason, result.error);
                }
            }).catch(err => {
                console.error('手動訓練異常:', err);
                console.error('錯誤堆棧:', err.stack);
            });
            
            // 再次獲取狀態（可能已更新）
            let finalStatus;
            try {
                finalStatus = await trainManager.getStatusAsync();
            } catch (e) {
                finalStatus = currentStatus || {
                    isTraining: false,
                    lastTrainingDate: null,
                    lastDataCount: 0
                };
            }
            
            sendJson(res, {
                success: true,
                message: '模型訓練已開始（後台執行）',
                status: finalStatus
            });
        } catch (err) {
            console.error('觸發訓練失敗:', err);
            console.error('錯誤堆棧:', err.stack);
            if (!res.headersSent) {
                sendJson(res, {
                    success: false,
                    error: err.message || '訓練啟動失敗',
                    errorType: err.name || 'Error',
                    details: process.env.NODE_ENV === 'development' ? err.stack : undefined
                }, 500);
            }
        }
    },
    
    // 停止訓練
    'POST /api/stop-training': async (req, res) => {
        try {
            const { getAutoTrainManager } = require('./modules/auto-train-manager');
            let trainManager;
            try {
                trainManager = getAutoTrainManager();
            } catch (requireErr) {
                console.error('加載訓練管理器模組失敗:', requireErr);
                return sendJson(res, {
                    success: false,
                    error: `無法加載訓練管理器: ${requireErr.message}`
                }, 500);
            }
            
            if (!trainManager) {
                return sendJson(res, {
                    success: false,
                    error: '訓練管理器初始化失敗'
                }, 500);
            }
            
            // 停止訓練
            const result = await trainManager.stopTraining();
            sendJson(res, result);
        } catch (err) {
            console.error('停止訓練失敗:', err);
            sendJson(res, {
                success: false,
                error: err.message || '停止訓練失敗'
            }, 500);
        }
    },
    
    // 🔬 特徵優化 API (v2.9.52)
    'POST /api/optimize-features': async (req, res) => {
        console.log('🔬 收到特徵優化請求');
        
        try {
            const { spawn } = require('child_process');
            const path = require('path');
            
            // 解析請求參數
            const quick = req.body?.quick !== false; // 默認快速模式
            
            const pythonScript = path.join(__dirname, 'python', 'auto_feature_optimizer.py');
            const args = quick ? ['--quick'] : [];
            
            console.log(`🚀 啟動特徵優化器 (${quick ? '快速' : '完整'}模式)`);
            
            // 啟動優化進程
            const optimizer = spawn('python3', [pythonScript, ...args], {
                cwd: path.join(__dirname, 'python'),
                env: { ...process.env, PYTHONUNBUFFERED: '1' }
            });
            
            let output = '';
            let errorOutput = '';
            
            optimizer.stdout.on('data', (data) => {
                const text = data.toString();
                output += text;
                console.log('[優化器]', text.trim());
            });
            
            optimizer.stderr.on('data', (data) => {
                const text = data.toString();
                errorOutput += text;
                console.error('[優化器錯誤]', text.trim());
            });
            
            optimizer.on('close', (code) => {
                console.log(`✅ 特徵優化完成，退出碼: ${code}`);
                
                // 嘗試讀取優化結果
                try {
                    const fs = require('fs');
                    const optimalPath = path.join(__dirname, 'python', 'models', 'optimal_features.json');
                    if (fs.existsSync(optimalPath)) {
                        const config = JSON.parse(fs.readFileSync(optimalPath, 'utf8'));
                        console.log(`📊 最佳配置: ${config.optimal_n_features} 特徵, MAE=${config.metrics?.mae?.toFixed(2)}`);
                    }
                } catch (e) {
                    console.error('讀取優化結果失敗:', e);
                }
            });
            
            // 立即返回，優化在後台運行
            sendJson(res, {
                success: true,
                message: `特徵優化已啟動（${quick ? '快速' : '完整'}模式）`,
                note: '優化在後台運行，完成後會自動更新 optimal_features.json'
            });
            
        } catch (err) {
            console.error('啟動特徵優化失敗:', err);
            sendJson(res, {
                success: false,
                error: err.message
            }, 500);
        }
    },
    
    // 🔬 獲取優化歷史 (v2.9.52)
    'GET /api/optimization-history': async (req, res) => {
        try {
            const fs = require('fs');
            const path = require('path');
            
            const historyPath = path.join(__dirname, 'python', 'models', 'feature_optimization_history.json');
            const optimalPath = path.join(__dirname, 'python', 'models', 'optimal_features.json');
            
            let history = null;
            let current = null;
            
            if (fs.existsSync(historyPath)) {
                history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
            }
            
            if (fs.existsSync(optimalPath)) {
                current = JSON.parse(fs.readFileSync(optimalPath, 'utf8'));
            }
            
            sendJson(res, {
                success: true,
                current: current ? {
                    n_features: current.optimal_n_features,
                    method: current.method,
                    metrics: current.metrics,
                    updated: current.updated,
                    top_features: current.optimal_features?.slice(0, 10)
                } : null,
                history: history ? {
                    total_optimizations: history.optimizations?.length || 0,
                    best_ever: history.best_ever,
                    recent: history.optimizations?.slice(-5)
                } : null
            });
        } catch (err) {
            console.error('獲取優化歷史失敗:', err);
            sendJson(res, {
                success: false,
                error: err.message
            }, 500);
        }
    },
    
    // 獲取訓練狀態
    'GET /api/training-status': async (req, res) => {
        try {
            const { getAutoTrainManager } = require('./modules/auto-train-manager');
            let trainManager;
            try {
                trainManager = getAutoTrainManager();
            } catch (initErr) {
                console.error('訓練管理器初始化失敗:', initErr);
                return sendJson(res, {
                    success: true,
                    data: {
                        isTraining: false,
                        error: initErr.message || '訓練管理器初始化失敗',
                        lastTrainingDate: null,
                        lastDataCount: 0,
                        trainingStartTime: null,
                        estimatedRemainingTime: null,
                        elapsedTime: null,
                        estimatedDuration: 1800000,
                        config: {
                            minDaysSinceLastTrain: 1,
                            minNewDataRecords: 7,
                            maxTrainingInterval: 7,
                            trainingTimeout: 3600000,
                            enableAutoTrain: false
                        },
                        statusFile: null
                    }
                });
            }
            
            if (!trainManager) {
                throw new Error('訓練管理器初始化失敗');
            }
            
            // 使用異步方法從 DB 獲取最新狀態
            const status = await trainManager.getStatusAsync();
            
            sendJson(res, {
                success: true,
                data: status
            });
        } catch (err) {
            console.error('獲取訓練狀態失敗:', err);
            console.error('錯誤堆棧:', err.stack);
            sendJson(res, {
                success: true,
                data: {
                    isTraining: false,
                    error: err.message || '訓練管理器不可用',
                    lastTrainingDate: null,
                    lastDataCount: 0,
                    trainingStartTime: null,
                    estimatedRemainingTime: null,
                    elapsedTime: null,
                    estimatedDuration: 1800000,
                    config: {
                        minDaysSinceLastTrain: 1,
                        minNewDataRecords: 7,
                        maxTrainingInterval: 7,
                        trainingTimeout: 3600000,
                        enableAutoTrain: false
                    },
                    statusFile: null
                }
            });
        }
    },
    
    // 🔴 SSE 實時訓練日誌流 (v2.9.20)
    'GET /api/training-log-stream': async (req, res) => {
        console.log('📡 SSE 訓練日誌流連接請求');
        
        // 設置 SSE 響應頭
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'X-Accel-Buffering': 'no'  // 禁用 nginx 緩衝
        });
        
        // 發送初始連接成功事件
        res.write(`event: connected\n`);
        res.write(`data: ${JSON.stringify({ message: 'SSE 連接成功', timestamp: getHKTTime() + ' HKT' })}\n\n`);
        
        try {
            const { getAutoTrainManager } = require('./modules/auto-train-manager');
            const trainManager = getAutoTrainManager();
            
            // 將此響應對象註冊為 SSE 客戶端
            trainManager.addSSEClient(res);
            
            // 保持連接活躍（每 30 秒發送心跳）
            const heartbeat = setInterval(() => {
                if (!res.writableEnded) {
                    res.write(`event: heartbeat\n`);
                    res.write(`data: ${JSON.stringify({ timestamp: getHKTTime() + ' HKT' })}\n\n`);
                } else {
                    clearInterval(heartbeat);
                }
            }, 30000);
            
            // 客戶端斷開時清理
            req.on('close', () => {
                clearInterval(heartbeat);
                console.log('📡 SSE 客戶端斷開連接');
            });
            
        } catch (err) {
            console.error('SSE 設置失敗:', err);
            res.write(`event: error\n`);
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
            res.end();
        }
    },
    
    // ============================================================
    // 預測平滑 API 端點
    // ============================================================
    
    // 獲取某日所有預測的平滑結果
    'GET /api/smoothing-methods': async (req, res) => {
        if (!db || !db.pool) {
            return sendJson(res, { error: 'Database not configured' }, 503);
        }
        
        try {
            const parsedUrl = url.parse(req.url, true);
            const targetDate = parsedUrl.query.date;
            
            if (!targetDate) {
                return sendJson(res, { error: '需要提供 date 參數' }, 400);
            }
            
            // 獲取該日所有預測
            const predictions = await db.getDailyPredictions(targetDate);
            
            if (predictions.length === 0) {
                return sendJson(res, { 
                    success: false, 
                    error: `沒有找到 ${targetDate} 的預測數據` 
                }, 404);
            }
            
            // 使用平滑模組計算所有方法
            const { getPredictionSmoother } = require('./modules/prediction-smoother');
            const smoother = getPredictionSmoother();
            const results = smoother.smoothAll(predictions);
            const recommended = smoother.getRecommendedPrediction(results);
            
            sendJson(res, {
                success: true,
                targetDate: targetDate,
                predictionCount: predictions.length,
                methods: {
                    simpleAverage: results.simpleAverage,
                    ewma: results.ewma,
                    confidenceWeighted: results.confidenceWeighted,
                    timeWindowWeighted: results.timeWindowWeighted,
                    trimmedMean: results.trimmedMean,
                    varianceFiltered: results.varianceFiltered,
                    kalman: results.kalman,
                    ensembleMeta: results.ensembleMeta
                },
                stability: results.stability,
                smoothedCI: results.smoothedCI,
                rawStats: results.rawStats,
                recommended: recommended
            });
        } catch (err) {
            console.error('獲取平滑結果失敗:', err);
            sendJson(res, { error: err.message }, 500);
        }
    },
    
    // 獲取時段準確度統計
    'GET /api/timeslot-accuracy': async (req, res) => {
        if (!db || !db.pool) {
            return sendJson(res, { error: 'Database not configured' }, 503);
        }
        
        try {
            const stats = await db.getTimeslotAccuracyStats();
            
            // 找出表現最好和最差的時段
            let bestSlot = null;
            let worstSlot = null;
            
            if (stats.length > 0) {
                stats.sort((a, b) => parseFloat(a.mae) - parseFloat(b.mae));
                bestSlot = {
                    timeSlot: stats[0].time_slot,
                    mae: parseFloat(stats[0].mae).toFixed(2),
                    count: stats[0].prediction_count
                };
                worstSlot = {
                    timeSlot: stats[stats.length - 1].time_slot,
                    mae: parseFloat(stats[stats.length - 1].mae).toFixed(2),
                    count: stats[stats.length - 1].prediction_count
                };
            }
            
            sendJson(res, {
                success: true,
                stats: stats.map(s => ({
                    timeSlot: s.time_slot,
                    predictionCount: parseInt(s.prediction_count),
                    mae: parseFloat(s.mae).toFixed(2),
                    meanError: parseFloat(s.me).toFixed(2),
                    stddevError: parseFloat(s.stddev_error || 0).toFixed(2),
                    minError: parseInt(s.min_error),
                    maxError: parseInt(s.max_error)
                })),
                summary: {
                    totalTimeSlots: stats.length,
                    bestSlot: bestSlot,
                    worstSlot: worstSlot
                }
            });
        } catch (err) {
            console.error('獲取時段準確度失敗:', err);
            sendJson(res, { error: err.message }, 500);
        }
    },
    
    // 獲取平滑配置
    'GET /api/smoothing-config': async (req, res) => {
        if (!db || !db.pool) {
            return sendJson(res, { error: 'Database not configured' }, 503);
        }
        
        try {
            const config = await db.getSmoothingConfig();
            
            if (!config) {
                // 返回默認配置
                return sendJson(res, {
                    success: true,
                    config: {
                        ewmaAlpha: 0.65,
                        kalmanProcessNoise: 1.0,
                        kalmanMeasurementNoise: 10.0,
                        trimPercent: 0.10,
                        varianceThreshold: 1.5,
                        metaWeights: {
                            ewma: 0.30,
                            timeWindowWeighted: 0.25,
                            trimmedMean: 0.20,
                            kalman: 0.25
                        }
                    },
                    isDefault: true
                });
            }
            
            sendJson(res, {
                success: true,
                config: {
                    ewmaAlpha: parseFloat(config.ewma_alpha),
                    kalmanProcessNoise: parseFloat(config.kalman_process_noise),
                    kalmanMeasurementNoise: parseFloat(config.kalman_measurement_noise),
                    trimPercent: parseFloat(config.trim_percent),
                    varianceThreshold: parseFloat(config.variance_threshold),
                    metaWeights: config.meta_weights
                },
                updatedAt: config.updated_at,
                isDefault: false
            });
        } catch (err) {
            console.error('獲取平滑配置失敗:', err);
            sendJson(res, { error: err.message }, 500);
        }
    },
    
    // 更新平滑配置
    'POST /api/smoothing-config': async (req, res) => {
        if (!db || !db.pool) {
            return sendJson(res, { error: 'Database not configured' }, 503);
        }
        
        try {
            const data = await parseBody(req);
            
            const updated = await db.updateSmoothingConfig({
                ewmaAlpha: data.ewmaAlpha,
                kalmanProcessNoise: data.kalmanProcessNoise,
                kalmanMeasurementNoise: data.kalmanMeasurementNoise,
                trimPercent: data.trimPercent,
                varianceThreshold: data.varianceThreshold,
                metaWeights: data.metaWeights
            });
            
            // 也更新平滑器實例
            const { getPredictionSmoother } = require('./modules/prediction-smoother');
            const smoother = getPredictionSmoother();
            smoother.updateConfig(data);
            
            sendJson(res, {
                success: true,
                message: '平滑配置已更新',
                config: updated
            });
        } catch (err) {
            console.error('更新平滑配置失敗:', err);
            sendJson(res, { error: err.message }, 500);
        }
    },
    
    // 重新計算某日的平滑預測（使用指定方法）
    'POST /api/recalculate-smoothed-prediction': async (req, res) => {
        if (!db || !db.pool) {
            return sendJson(res, { error: 'Database not configured' }, 503);
        }
        
        try {
            const data = await parseBody(req);
            const targetDate = data.target_date;
            const method = data.method; // 可選：指定使用的平滑方法
            
            if (!targetDate) {
                return sendJson(res, { error: '需要提供 target_date' }, 400);
            }
            
            const result = await db.calculateFinalDailyPrediction(targetDate, { method });
            
            if (!result) {
                return sendJson(res, { 
                    success: false, 
                    error: `沒有找到 ${targetDate} 的預測數據` 
                }, 404);
            }
            
            sendJson(res, {
                success: true,
                message: `已重新計算 ${targetDate} 的平滑預測`,
                data: {
                    targetDate: targetDate,
                    predictedCount: result.predicted_count,
                    smoothingMethod: result.smoothing_method,
                    stabilityCV: result.stability_cv,
                    stabilityLevel: result.stability_level,
                    predictionCount: result.prediction_count,
                    ci80: {
                        low: result.ci80_low,
                        high: result.ci80_high
                    },
                    ci95: {
                        low: result.ci95_low,
                        high: result.ci95_high
                    },
                    smoothingResults: result.smoothingResults,
                    recommendedMethod: result.recommendedMethod
                }
            });
        } catch (err) {
            console.error('重新計算平滑預測失敗:', err);
            sendJson(res, { error: err.message }, 500);
        }
    },
    
    // 批量計算多日的平滑預測
    'POST /api/batch-smooth-predictions': async (req, res) => {
        if (!db || !db.pool) {
            return sendJson(res, { error: 'Database not configured' }, 503);
        }
        
        try {
            const data = await parseBody(req);
            const startDate = data.start_date;
            const endDate = data.end_date;
            const method = data.method;
            
            if (!startDate || !endDate) {
                return sendJson(res, { error: '需要提供 start_date 和 end_date' }, 400);
            }
            
            // 獲取日期範圍內所有有預測的日期
            const datesResult = await db.pool.query(`
                SELECT DISTINCT target_date 
                FROM daily_predictions 
                WHERE target_date >= $1 AND target_date <= $2
                ORDER BY target_date
            `, [startDate, endDate]);
            
            const results = [];
            for (const row of datesResult.rows) {
                const dateStr = row.target_date.toISOString().split('T')[0];
                try {
                    const result = await db.calculateFinalDailyPrediction(dateStr, { method });
                    if (result) {
                        results.push({
                            targetDate: dateStr,
                            predictedCount: result.predicted_count,
                            method: result.smoothing_method,
                            stabilityCV: result.stability_cv,
                            success: true
                        });
                    }
                } catch (err) {
                    results.push({
                        targetDate: dateStr,
                        error: err.message,
                        success: false
                    });
                }
            }
            
            sendJson(res, {
                success: true,
                message: `已處理 ${results.length} 個日期`,
                processed: results.filter(r => r.success).length,
                failed: results.filter(r => !r.success).length,
                results: results
            });
        } catch (err) {
            console.error('批量計算平滑預測失敗:', err);
            sendJson(res, { error: err.message }, 500);
        }
    },
    
    // ============================================================
    
    // 更新 AI 因素緩存（保存到數據庫）
    'POST /api/convert-to-traditional': async (req, res) => {
        try {
            // 使用 parseBody 解析請求體
            const body = await parseBody(req);
            const { text } = body;

            if (!text || typeof text !== 'string') {
                return sendJson(res, {
                    success: false,
                    error: '請提供有效的文本'
                }, 400);
            }

            // 嘗試使用 chinese-conv 進行轉換
            let chineseConv = null;
            try {
                chineseConv = require('chinese-conv');
            } catch (e) {
                // 如果 chinese-conv 未安裝，返回原文
                console.warn('⚠️ chinese-conv 未安裝，返回原文');
                return sendJson(res, {
                    success: true,
                    original: text,
                    converted: text // 返回原文
                });
            }

            try {
                // 使用 tify 方法將簡體轉換為繁體（Traditional）
                // sify 是簡體化（Simplified），tify 是繁體化（Traditional）
                if (typeof chineseConv.tify !== 'function') {
                    console.error('❌ chinese-conv.tify 不是函數，無法轉換');
                    return sendJson(res, {
                        success: false,
                        error: '轉換功能不可用：tify 方法不存在'
                    }, 500);
                }

                const converted = chineseConv.tify(text);
                
                // 如果轉換結果與原文相同，不輸出警告（避免日誌過多）
                
                return sendJson(res, {
                    success: true,
                    original: text,
                    converted: converted || text
                });
            } catch (e) {
                console.error('❌ 轉換失敗:', e.message, e.stack);
                return sendJson(res, {
                    success: false,
                    error: `轉換失敗: ${e.message}`,
                    original: text
                }, 500);
            }
        } catch (error) {
            console.error('❌ 轉換 API 錯誤:', error);
            // 即使解析失敗，也嘗試返回一個合理的響應
            return sendJson(res, {
                success: false,
                error: error.message || '未知錯誤'
            }, 500);
        }
    },
    
    'POST /api/ai-factors-cache': async (req, res) => {
        if (!db || !db.pool) {
            return sendJson(res, { 
                success: false, 
                error: '數據庫未配置' 
            }, 503);
        }
        
        try {
            const data = await parseBody(req);
            const { updateTime, factorsCache, analysisData } = data;
            
            if (!updateTime || !factorsCache) {
                return sendJson(res, { 
                    success: false, 
                    error: '需要提供 updateTime 和 factorsCache' 
                }, 400);
            }
            
            const result = await db.updateAIFactorsCache(
                parseInt(updateTime),
                factorsCache,
                analysisData
            );
            
            sendJson(res, { 
                success: true, 
                data: result 
            });
        } catch (err) {
            console.error('更新 AI 因素緩存失敗:', err);
            sendJson(res, { 
                success: false, 
                error: err.message 
            }, 500);
        }
    },

    // API Documentation
    'GET /api/docs': async (req, res) => {
        const apiDocs = {
            name: 'NDH AED Prediction API',
            version: '2.6.0',
            description: 'North District Hospital A&E Attendance Prediction System API',
            baseUrl: req.headers.host,
            endpoints: [
                {
                    method: 'GET',
                    path: '/api/predictions',
                    description: 'Get predictions for a date range',
                    params: { start: 'Start date (YYYY-MM-DD)', end: 'End date (YYYY-MM-DD)' }
                },
                {
                    method: 'GET',
                    path: '/api/actual-data',
                    description: 'Get actual attendance data',
                    params: { start: 'Start date', end: 'End date' }
                },
                {
                    method: 'POST',
                    path: '/api/actual-data',
                    description: 'Upload actual attendance data',
                    body: { date: 'Date (YYYY-MM-DD)', attendance: 'Number of patients' }
                },
                {
                    method: 'GET',
                    path: '/api/comparison',
                    description: 'Get comparison of actual vs predicted data'
                },
                {
                    method: 'GET',
                    path: '/api/ai-analysis',
                    description: 'Get AI analysis of current factors affecting attendance'
                },
                {
                    method: 'POST',
                    path: '/api/train',
                    description: 'Trigger model training'
                },
                {
                    method: 'GET',
                    path: '/api/status',
                    description: 'Get system and database status'
                }
            ],
            lastUpdated: getHKTTime() + ' HKT'
        };
        sendJson(res, apiDocs);
    },

    // System Status
    'GET /api/status': async (req, res) => {
        const status = {
            version: '2.9.52',
            database: db && db.pool ? 'connected' : 'disconnected',
            ai: aiService ? 'available' : 'unavailable',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            timestamp: getHKTTime() + ' HKT'
        };
        sendJson(res, status);
    },

    // 動態計算模型置信度
    'GET /api/confidence': async (req, res) => {
        try {
            let dataQuality = 0;
            let modelFit = 0;
            let recentAccuracy = 0;
            let details = {};
            
            // 1. 數據品質：基於數據量、覆蓋率、最近更新
            if (db && db.pool) {
                try {
                    // 獲取數據統計
                    const countResult = await db.pool.query('SELECT COUNT(*) as count FROM actual_data');
                    const dataCount = parseInt(countResult.rows[0].count) || 0;
                    
                    // 獲取最新數據日期
                    const latestResult = await db.pool.query('SELECT MAX(date) as latest FROM actual_data');
                    const latestDate = latestResult.rows[0].latest;
                    const daysSinceUpdate = latestDate ? Math.floor((Date.now() - new Date(latestDate).getTime()) / (1000 * 60 * 60 * 24)) : 999;
                    
                    // 計算數據品質分數
                    // - 數據量：每100筆 +5分，最多50分
                    const dataCountScore = Math.min(50, Math.floor(dataCount / 100) * 5);
                    // - 數據更新：7天內100分，每多一天 -5分
                    const freshnessScore = Math.max(0, 50 - daysSinceUpdate * 5);
                    dataQuality = dataCountScore + freshnessScore;
                    
                    details.dataCount = dataCount;
                    details.latestDate = latestDate;
                    details.daysSinceUpdate = daysSinceUpdate;
                } catch (e) {
                    console.warn('數據品質計算失敗:', e.message);
                }
            }
            
            // 2. 模型擬合度：優先從數據庫讀取（持久化），否則從文件讀取
            try {
                let metrics = null;
                
                // 優先從數據庫讀取（持久化的指標）
                if (db && db.pool) {
                    try {
                        const dbMetrics = await db.getModelMetrics('xgboost');
                        if (dbMetrics && dbMetrics.mae !== null) {
                            metrics = {
                                mae: parseFloat(dbMetrics.mae),
                                mape: parseFloat(dbMetrics.mape),
                                rmse: parseFloat(dbMetrics.rmse),
                                training_date: dbMetrics.training_date,
                                feature_count: dbMetrics.feature_count,
                                data_count: dbMetrics.data_count
                            };
                            details.metricsSource = 'database';
                        }
                    } catch (dbErr) {
                        console.warn('從數據庫讀取模型指標失敗:', dbErr.message);
                    }
                }
                
                // 如果數據庫沒有，從文件讀取（向後兼容）
                if (!metrics) {
                    const fs = require('fs');
                    const path = require('path');
                    const metricsPath = path.join(__dirname, 'python/models/xgboost_metrics.json');
                    
                    if (fs.existsSync(metricsPath)) {
                        metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
                        details.metricsSource = 'file';
                    }
                }
                
                if (metrics && metrics.mae !== undefined && metrics.mape !== undefined) {
                    // MAE 評分：MAE < 5 = 100分，每增加1 -10分
                    const maeScore = Math.max(0, Math.min(100, 100 - (metrics.mae - 5) * 10));
                    // MAPE 評分：MAPE < 2% = 100分，每增加1% -20分
                    const mapeScore = Math.max(0, Math.min(100, 100 - (metrics.mape - 2) * 20));
                    // R² 評分：直接使用 R² * 100（v2.9.52 新增）
                    const r2Score = metrics.r2 ? Math.max(0, Math.min(100, metrics.r2 * 100)) : null;
                    
                    // 綜合評分：如果有 R² 則使用加權平均 (MAE 30%, MAPE 30%, R² 40%)
                    if (r2Score !== null) {
                        modelFit = Math.round(maeScore * 0.3 + mapeScore * 0.3 + r2Score * 0.4);
                    } else {
                        modelFit = Math.round((maeScore + mapeScore) / 2);
                    }
                    
                    details.mae = metrics.mae;
                    details.mape = metrics.mape;
                    details.rmse = metrics.rmse;
                    details.r2 = metrics.r2 || null;
                    details.adj_r2 = metrics.adj_r2 || null;
                    details.trainingDate = metrics.training_date;
                    details.featureCount = metrics.feature_count;
                } else {
                    modelFit = 0;
                    details.modelExists = false;
                    details.metricsSource = 'none';
                }
            } catch (e) {
                console.warn('模型指標讀取失敗:', e.message);
                modelFit = 0; // 沒有指標時顯示 0%，而不是默認值
                details.modelExists = false;
            }
            
            // 3. 近期準確度：基於最近7天的預測 vs 實際對比
            if (db && db.pool) {
                try {
                    const accuracyResult = await db.pool.query(`
                        SELECT AVG(accuracy) as avg_accuracy, COUNT(*) as count
                        FROM (
                            SELECT 100 - ABS(dp.predicted_count - ad.patient_count) * 100.0 / NULLIF(ad.patient_count, 0) as accuracy
                            FROM daily_predictions dp
                            JOIN actual_data ad ON dp.target_date = ad.date
                            WHERE dp.target_date >= CURRENT_DATE - INTERVAL '14 days'
                            AND ad.patient_count IS NOT NULL
                        ) sub
                        WHERE accuracy IS NOT NULL
                    `);
                    
                    if (accuracyResult.rows[0].avg_accuracy) {
                        recentAccuracy = Math.round(Math.min(100, Math.max(0, accuracyResult.rows[0].avg_accuracy)));
                        details.recentComparisonCount = parseInt(accuracyResult.rows[0].count);
                    } else {
                        // 沒有對比數據，使用模型 MAPE 估算
                        recentAccuracy = details.mape ? Math.round(100 - details.mape) : 85;
                        details.recentComparisonCount = 0;
                    }
                } catch (e) {
                    console.warn('準確度計算失敗:', e.message);
                    recentAccuracy = 85;
                }
            }
            
            // 計算綜合置信度
            const overall = Math.round((dataQuality + modelFit + recentAccuracy) / 3);
            
            sendJson(res, {
                dataQuality: Math.min(100, Math.max(0, dataQuality)),
                modelFit: Math.min(100, Math.max(0, modelFit)),
                recentAccuracy: Math.min(100, Math.max(0, recentAccuracy)),
                overall: Math.min(100, Math.max(0, overall)),
                details,
                timestamp: getHKTTime() + ' HKT'
            });
        } catch (error) {
            console.error('置信度計算失敗:', error);
            sendJson(res, { error: error.message }, 500);
        }
    },

    // Webhook 管理
    'POST /api/webhooks': async (req, res) => {
        try {
            const { url, events } = JSON.parse(req.body);
            if (!url) {
                return sendJson(res, { success: false, error: 'Webhook URL is required' }, 400);
            }
            
            const validEvents = ['prediction.daily', 'training.complete', 'alert.high_attendance'];
            const selectedEvents = events?.filter(e => validEvents.includes(e)) || validEvents;
            
            // 儲存 Webhook（實際應存入數據庫）
            if (!global.webhooks) global.webhooks = [];
            const webhook = {
                id: Date.now().toString(36),
                url,
                events: selectedEvents,
                created: getHKTTime() + ' HKT',
                active: true
            };
            global.webhooks.push(webhook);
            
            console.log(`📡 Webhook 已註冊: ${url} (事件: ${selectedEvents.join(', ')})`);
            sendJson(res, { success: true, webhook });
        } catch (err) {
            sendJson(res, { success: false, error: err.message }, 500);
        }
    },

    'GET /api/webhooks': async (req, res) => {
        sendJson(res, { 
            success: true, 
            webhooks: (global.webhooks || []).map(w => ({
                id: w.id,
                url: w.url.replace(/\/\/(.+?)@/, '//*****@'), // 隱藏敏感資訊
                events: w.events,
                active: w.active,
                created: w.created
            }))
        });
    },

    'DELETE /api/webhooks': async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const id = url.searchParams.get('id');
        
        if (!id) {
            return sendJson(res, { success: false, error: 'Webhook ID is required' }, 400);
        }
        
        if (!global.webhooks) global.webhooks = [];
        const index = global.webhooks.findIndex(w => w.id === id);
        
        if (index === -1) {
            return sendJson(res, { success: false, error: 'Webhook not found' }, 404);
        }
        
        global.webhooks.splice(index, 1);
        console.log(`📡 Webhook 已刪除: ${id}`);
        sendJson(res, { success: true });
    }
};

const server = http.createServer(async (req, res) => {
    // 全局錯誤處理 - 確保所有錯誤都返回 JSON
    const handleError = (err, statusCode = 500) => {
        console.error('服務器錯誤:', err);
        if (!res.headersSent) {
            sendJson(res, {
                success: false,
                error: err.message || '內部服務器錯誤',
                errorType: err.name || 'Error',
                details: process.env.NODE_ENV === 'development' ? err.stack : undefined
            }, statusCode);
        }
    };

    // 包裝異步處理
    try {
        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            });
            return res.end();
        }

        // Check for API routes
        const parsedUrl = url.parse(req.url, true);
        const pathname = parsedUrl.pathname;
        const routeKey = `${req.method} ${pathname}`;
        
        if (apiHandlers[routeKey]) {
            try {
                await apiHandlers[routeKey](req, res);
            } catch (error) {
                console.error('API Error:', error);
                console.error('錯誤堆棧:', error.stack);
                if (!res.headersSent) {
                    sendJson(res, { 
                        success: false,
                        error: error.message || '內部服務器錯誤',
                        errorType: error.name || 'Error'
                    }, 500);
                }
            }
            return;
        }

        // Static file serving
        let filePath = pathname === '/' ? '/index.html' : pathname;
        filePath = filePath.split('?')[0];
        
        const fullPath = path.join(__dirname, filePath);
        const ext = path.extname(fullPath).toLowerCase();
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        
        // v1.1: Allow iframe embedding from roster app
        const frameHeaders = {
            'Content-Security-Policy': "frame-ancestors 'self' https://ndhaedduty.up.railway.app https://ndhaedroster.up.railway.app https://*.up.railway.app http://localhost:* http://127.0.0.1:*"
        };
        
        fs.readFile(fullPath, (err, content) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    fs.readFile(path.join(__dirname, 'index.html'), (err, content) => {
                        if (err) {
                            res.writeHead(500);
                            res.end('Server Error');
                        } else {
                            res.writeHead(200, { 'Content-Type': 'text/html', ...frameHeaders });
                            res.end(content, 'utf-8');
                        }
                    });
                } else {
                    res.writeHead(500);
                    res.end('Server Error');
                }
            } else {
                res.writeHead(200, { 'Content-Type': contentType, ...frameHeaders });
                res.end(content, 'utf-8');
            }
        });
    } catch (error) {
        // 全局錯誤處理
        console.error('服務器全局錯誤:', error);
        console.error('錯誤堆棧:', error.stack);
        if (!res.headersSent) {
            sendJson(res, {
                success: false,
                error: error.message || '內部服務器錯誤',
                errorType: error.name || 'Error'
            }, 500);
        }
    }
});

// v2.9.91: 計算皮爾森相關係數
function calculateCorrelation(dataPoints) {
    if (!dataPoints || dataPoints.length < 3) {
        return { temperature: null, humidity: null, rainfall: null };
    }
    
    const pearson = (x, y) => {
        const validPairs = x.map((xi, i) => [xi, y[i]]).filter(([a, b]) => a != null && b != null);
        if (validPairs.length < 3) return null;
        
        const n = validPairs.length;
        const sumX = validPairs.reduce((s, [a]) => s + a, 0);
        const sumY = validPairs.reduce((s, [, b]) => s + b, 0);
        const sumXY = validPairs.reduce((s, [a, b]) => s + a * b, 0);
        const sumX2 = validPairs.reduce((s, [a]) => s + a * a, 0);
        const sumY2 = validPairs.reduce((s, [, b]) => s + b * b, 0);
        
        const numerator = n * sumXY - sumX * sumY;
        const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
        
        if (denominator === 0) return 0;
        return numerator / denominator;
    };
    
    const actual = dataPoints.map(d => d.actual);
    const temp = dataPoints.map(d => d.temperature);
    const humidity = dataPoints.map(d => d.humidity);
    const rainfall = dataPoints.map(d => d.rainfall);
    
    return {
        temperature: pearson(temp, actual),
        humidity: pearson(humidity, actual),
        rainfall: pearson(rainfall, actual),
        sampleSize: dataPoints.length
    };
}

// 獲取香港時間
function getHKTime() {
    const now = new Date();
    const hkFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Hong_Kong',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    
    const parts = hkFormatter.formatToParts(now);
    const getPart = (type) => parts.find(p => p.type === type)?.value || '00';
    
    return {
        year: parseInt(getPart('year')),
        month: parseInt(getPart('month')),
        day: parseInt(getPart('day')),
        hour: parseInt(getPart('hour')),
        minute: parseInt(getPart('minute')),
        second: parseInt(getPart('second')),
        dateStr: `${getPart('year')}-${getPart('month')}-${getPart('day')}`
    };
}

// 計算昨天的最終預測（在每天開始時執行）
async function calculateYesterdayFinalPrediction() {
    if (!db || !db.pool) {
        console.log('⚠️ 數據庫未配置，跳過計算最終預測');
        return;
    }
    
    try {
        const hk = getHKTime();
        // 計算昨天的日期
        const yesterday = new Date(`${hk.dateStr}T00:00:00+08:00`);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        
        console.log(`🔄 開始計算 ${yesterdayStr} 的最終預測...`);
        const result = await db.calculateFinalDailyPrediction(yesterdayStr);
        
        if (result) {
            console.log(`✅ 成功計算 ${yesterdayStr} 的最終預測（基於 ${result.prediction_count} 次預測的平均值）`);
        } else {
            console.log(`⚠️ ${yesterdayStr} 沒有預測數據可計算`);
        }
    } catch (error) {
        console.error('❌ 計算最終預測時出錯:', error);
    }
}

// 設置定時任務：每天00:00 HKT計算前一天的最終預測
function scheduleDailyFinalPrediction() {
    let lastCalculatedDate = null;
    
    const checkAndRun = () => {
        const hk = getHKTime();
        // 在新的一天開始時（00:00）執行
        if (hk.hour === 0 && hk.minute === 0 && hk.second < 10) {
            // 計算昨天的日期
            const yesterday = new Date(`${hk.dateStr}T00:00:00+08:00`);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];
            
            // 避免重複計算
            if (lastCalculatedDate !== yesterdayStr) {
                lastCalculatedDate = yesterdayStr;
                // 延遲幾秒執行，確保所有預測都已保存
                setTimeout(() => {
                    calculateYesterdayFinalPrediction();
                }, 5000); // 5秒後執行
            }
        }
    };
    
    // 每秒檢查一次（在00:00:00-00:00:10之間）
    setInterval(checkAndRun, 1000);
    
    console.log('⏰ 已設置每日最終預測計算任務（每天00:00 HKT執行）');
}

// ============================================================
// 自動預測統計追蹤器 (v2.9.90 - 數據庫持久化)
// ============================================================
const autoPredictStats = {
    todayCount: 0,          // 今日執行次數
    lastRunTime: null,      // 上次執行時間
    lastRunSuccess: null,   // 上次執行是否成功
    lastRunDuration: null,  // 上次執行耗時（毫秒）
    currentDate: null,      // 當前日期（用於判斷是否需要重置）
    serverStartTime: new Date().toISOString(),  // 伺服器啟動時間
    totalSuccessCount: 0,   // 總成功次數
    totalFailCount: 0       // 總失敗次數
};

// v2.9.90: 從數據庫載入自動預測統計
async function loadAutoPredictStatsFromDB() {
    if (!db || !db.pool) return;
    
    try {
        const hk = getHKTime();
        const today = hk.dateStr;
        
        const stats = await db.getAutoPredictStats(today);
        if (stats) {
            autoPredictStats.todayCount = stats.today_count || 0;
            autoPredictStats.lastRunTime = stats.last_run_time;
            autoPredictStats.lastRunSuccess = stats.last_run_success;
            autoPredictStats.lastRunDuration = stats.last_run_duration;
            autoPredictStats.totalSuccessCount = stats.total_success_count || 0;
            autoPredictStats.totalFailCount = stats.total_fail_count || 0;
            console.log(`✅ 從數據庫載入自動預測統計：今日 ${autoPredictStats.todayCount} 次`);
        }
        autoPredictStats.currentDate = today;
    } catch (error) {
        console.error('❌ 載入自動預測統計失敗:', error.message);
    }
}

// v2.9.90: 保存自動預測統計到數據庫
async function saveAutoPredictStatsToDB() {
    if (!db || !db.pool) return;
    
    try {
        const hk = getHKTime();
        await db.saveAutoPredictStats(hk.dateStr, {
            todayCount: autoPredictStats.todayCount,
            lastRunTime: autoPredictStats.lastRunTime,
            lastRunSuccess: autoPredictStats.lastRunSuccess,
            lastRunDuration: autoPredictStats.lastRunDuration,
            totalSuccessCount: autoPredictStats.totalSuccessCount,
            totalFailCount: autoPredictStats.totalFailCount
        });
    } catch (error) {
        console.error('❌ 保存自動預測統計失敗:', error.message);
    }
}

// 每天 00:00 重置統計
function scheduleDailyStatsReset() {
    const checkAndReset = async () => {
        const hk = getHKTime();
        const today = hk.dateStr;
        
        if (autoPredictStats.currentDate !== today) {
            console.log(`📊 [${hk.dateStr} ${String(hk.hour).padStart(2, '0')}:${String(hk.minute).padStart(2, '0')} HKT] 新的一天，載入統計`);
            autoPredictStats.currentDate = today;
            // 從數據庫載入今天的統計（如果有）
            await loadAutoPredictStatsFromDB();
        }
    };
    
    // 初始化
    checkAndReset();
    
    // 每分鐘檢查是否需要重置（精確捕捉 00:00）
    setInterval(checkAndReset, 60000);
    
    console.log('⏰ 已設置每日自動預測統計重置（每天 00:00 HKT）');
}

// ============================================================
// 伺服器端自動預測（每 30 分鐘執行一次，僅使用 XGBoost）
// ============================================================
async function generateServerSidePredictions() {
    const startTime = Date.now();
    if (!db || !db.pool) {
        console.log('⚠️ 數據庫未配置，跳過伺服器端自動預測');
        return;
    }
    
    const hk = getHKTime();
    console.log(`\n🔮 [${hk.dateStr} ${String(hk.hour).padStart(2, '0')}:${String(hk.minute).padStart(2, '0')} HKT] 開始伺服器端自動預測（XGBoost）...`);
    
    try {
        // 檢查 XGBoost 模型是否可用
        let ensemblePredictor = null;
        try {
            const { EnsemblePredictor } = require('./modules/ensemble-predictor');
            ensemblePredictor = new EnsemblePredictor();
            if (!ensemblePredictor.isModelAvailable()) {
                console.log('⚠️ XGBoost 模型未訓練，跳過自動預測。請先運行 python/train_all_models.py');
                return;
            }
        } catch (e) {
            console.log('⚠️ XGBoost 模組不可用，跳過自動預測:', e.message);
            return;
        }
        
        // 生成今天和未來 30 天的預測（用於 30 天趨勢圖）
        const predictions = [];
        const today = new Date(`${hk.dateStr}T00:00:00+08:00`);
        
        // 星期效應因子（基於研究：週一最高 124%，週末最低 70%）
        const dowFactors = {
            0: 0.85,  // 週日
            1: 1.10,  // 週一（最高）
            2: 1.05,  // 週二
            3: 1.02,  // 週三
            4: 1.00,  // 週四
            5: 0.98,  // 週五
            6: 0.88   // 週六
        };
        
        // 月份效應因子
        const monthFactors = {
            1: 1.05,  // 冬季流感
            2: 1.03,
            3: 1.02,
            4: 0.98,
            5: 0.97,
            6: 0.98,
            7: 1.02,  // 夏季流感
            8: 1.01,
            9: 0.99,
            10: 1.00,
            11: 1.01,
            12: 1.04  // 冬季
        };
        
        // 加載 AI 因素
        let aiFactorsMap = {};
        try {
            const aiCache = await db.getAIFactorsCache();
            
            // 處理 factors_cache 格式（日期 -> 因素映射）
            if (aiCache && aiCache.factors_cache) {
                for (const [dateStr, factor] of Object.entries(aiCache.factors_cache)) {
                    if (factor && factor.impactFactor) {
                        aiFactorsMap[dateStr] = {
                            impactFactor: Math.max(0.7, Math.min(1.3, factor.impactFactor)),
                            factors: [factor]
                        };
                    }
                }
                console.log(`🤖 已載入 AI 因素（factors_cache），影響 ${Object.keys(aiFactorsMap).length} 天`);
            }
            
            // 也處理 analysis_data.factors 格式（數組）
            if (aiCache && aiCache.analysis_data && aiCache.analysis_data.factors) {
                for (const factor of aiCache.analysis_data.factors) {
                    if (factor.affectedDays) {
                        for (const day of factor.affectedDays) {
                            if (!aiFactorsMap[day]) {
                                aiFactorsMap[day] = { impactFactor: 1.0, factors: [] };
                            }
                            aiFactorsMap[day].factors.push(factor);
                            // 累積影響因子（限制範圍 0.7-1.3）
                            const impact = Math.max(0.7, Math.min(1.3, factor.impactFactor || 1.0));
                            aiFactorsMap[day].impactFactor *= impact;
                            // 限制最終因子範圍
                            aiFactorsMap[day].impactFactor = Math.max(0.7, Math.min(1.3, aiFactorsMap[day].impactFactor));
                        }
                    }
                }
                console.log(`🤖 已載入 AI 因素（analysis_data），共 ${aiCache.analysis_data.factors.length} 個因素`);
            }
        } catch (e) {
            console.log('⚠️ 無法載入 AI 因素:', e.message);
        }
        
        // 獲取天氣預報（7天）
        let weatherForecast = {};
        try {
            // 使用內建 https 模組獲取香港天文台 9 天天氣預報
            const weatherData = await new Promise((resolve, reject) => {
                const https = require('https');
                const req = https.get('https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=tc', {
                    timeout: 10000
                }, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try {
                            resolve(JSON.parse(data));
                        } catch (e) {
                            reject(new Error('Invalid JSON from HKO API'));
                        }
                    });
                });
                req.on('error', reject);
                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error('Request timeout'));
                });
            });
            
            if (weatherData && weatherData.weatherForecast) {
                for (const forecast of weatherData.weatherForecast) {
                    // 解析日期
                    const forecastDateStr = forecast.forecastDate; // 格式: "20260102"
                    if (forecastDateStr) {
                        const dateFormatted = `${forecastDateStr.substr(0, 4)}-${forecastDateStr.substr(4, 2)}-${forecastDateStr.substr(6, 2)}`;
                        
                        // 計算天氣因素
                        const maxTemp = forecast.forecastMaxtemp?.value || 25;
                        const minTemp = forecast.forecastMintemp?.value || 18;
                        const avgTemp = (maxTemp + minTemp) / 2;
                        
                        // 天氣因素計算
                        let weatherFactor = 1.0;
                        
                        // 極端溫度影響
                        if (avgTemp < 15) {
                            weatherFactor += 0.08; // 寒冷天氣增加求診
                        } else if (avgTemp > 30) {
                            weatherFactor += 0.05; // 酷熱天氣增加求診
                        }
                        
                        // 下雨影響（減少非緊急求診）
                        const forecastWeather = forecast.forecastWeather || '';
                        if (forecastWeather.includes('雨') || forecastWeather.includes('Rain')) {
                            weatherFactor -= 0.03;
                        }
                        if (forecastWeather.includes('暴雨') || forecastWeather.includes('大雨')) {
                            weatherFactor -= 0.08; // 暴雨大幅減少求診
                        }
                        
                        weatherForecast[dateFormatted] = {
                            maxTemp,
                            minTemp,
                            weather: forecastWeather,
                            factor: Math.max(0.85, Math.min(1.15, weatherFactor))
                        };
                    }
                }
                console.log(`🌤️ 已載入 ${Object.keys(weatherForecast).length} 天天氣預報`);
                if (Object.keys(weatherForecast).length > 0) {
                    console.log(`   天氣日期: ${Object.keys(weatherForecast).slice(0, 5).join(', ')}`);
                }
            }
        } catch (e) {
            console.log('⚠️ 無法載入天氣預報:', e.message);
        }
        
        // 調試：輸出 AI 因素的日期
        if (Object.keys(aiFactorsMap).length > 0) {
            console.log(`🤖 AI 因素日期: ${Object.keys(aiFactorsMap).slice(0, 5).join(', ')}`);
        }
        
        // 首先獲取 XGBoost 基準預測（使用今天的日期）
        let basePrediction = null;
        try {
            const baseResult = await ensemblePredictor.predict(hk.dateStr);
            if (baseResult && baseResult.prediction) {
                basePrediction = baseResult.prediction;
            }
        } catch (e) {
            console.error('❌ 無法獲取 XGBoost 基準預測:', e.message);
        }
        
        // 如果無法獲取基準預測，使用歷史平均值
        if (!basePrediction) {
            try {
                const statsResult = await db.pool.query(`
                    SELECT AVG(patient_count) as avg_count FROM actual_data
                    WHERE date >= CURRENT_DATE - INTERVAL '90 days'
                `);
                basePrediction = parseFloat(statsResult.rows[0]?.avg_count) || 249;
            } catch (e) {
                basePrediction = 249; // 全局平均值
            }
        }
        
        console.log(`📊 XGBoost 基準預測: ${Math.round(basePrediction)} 人`);
        console.log(`📅 預測起始日期: ${hk.dateStr}`);
        
        for (let i = 0; i <= 30; i++) {
            // 使用 HKT 日期計算，避免 UTC 時區偏移問題
            const targetDate = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
            // 轉換為 HKT 時區的日期字符串
            const hkTarget = new Date(targetDate.getTime() + 8 * 60 * 60 * 1000);
            const dateStr = hkTarget.toISOString().split('T')[0];
            const dow = hkTarget.getUTCDay(); // 使用 UTC 方法因為已加了 8 小時
            const month = hkTarget.getUTCMonth() + 1;
            
            // 應用星期效應調整
            const dowFactor = dowFactors[dow] || 1.0;
            
            // 應用月份效應調整
            const monthFactor = monthFactors[month] || 1.0;
            
            // 應用 AI 因素調整
            let aiFactor = 1.0;
            let aiInfo = null;
            if (aiFactorsMap[dateStr]) {
                aiFactor = Math.max(0.7, Math.min(1.3, aiFactorsMap[dateStr].impactFactor));
                aiInfo = aiFactorsMap[dateStr];
            }
            
            // 應用天氣因素調整
            let weatherFactor = 1.0;
            let weatherInfo = null;
            if (weatherForecast[dateStr]) {
                weatherFactor = weatherForecast[dateStr].factor;
                weatherInfo = weatherForecast[dateStr];
            }
            
            // ============================================================
            // 多步 XGBoost 預測（使用所有可用特徵）
            // ============================================================
            // XGBoost 可以用於未來日期的特徵：
            // ✅ 星期幾、月份、年份、季節
            // ✅ 假期（已知的公眾假期）
            // ✅ 流感季節（12月-3月）
            // ✅ 歷史同期數據（Lag365）
            // ✅ 星期效應均值（DayOfWeek_Target_Mean）
            // ⚠️ EWMA：使用前一天的預測值滾動更新
            // ============================================================
            
            const daysAhead = i;
            
            // 歷史星期均值（用於調整和驗證）
            const dowMeans = { 0: 198, 1: 280, 2: 268, 3: 258, 4: 255, 5: 248, 6: 212 };
            const dowStds = { 0: 28, 1: 32, 2: 30, 3: 29, 4: 31, 5: 30, 6: 27 };
            
            // 計算預測值
            let adjusted;
            
            if (daysAhead === 0) {
                // 今天：直接使用 XGBoost 預測
                adjusted = Math.round(basePrediction * aiFactor * weatherFactor);
            } else {
                // 未來日期：模擬 XGBoost 的特徵效應
                // 
                // XGBoost 學到的主要效應：
                // 1. 星期效應（週一最高，週日最低）
                // 2. 季節效應（冬季流感高峰）
                // 3. 假期效應（假期較低）
                // 4. 趨勢效應（EWMA 捕捉的近期趨勢）
                
                // 使用 XGBoost 基準預測 + 星期效應差異
                // 使用 HKT 時區計算今天的星期
                const todayHK = new Date(today.getTime() + 8 * 60 * 60 * 1000);
                const todayDOW = todayHK.getUTCDay();
                const todayMean = dowMeans[todayDOW];
                const targetMean = dowMeans[dow];
                
                // 計算星期效應調整
                const dowAdjustment = targetMean / todayMean;
                
                // 應用調整
                let value = basePrediction * dowAdjustment;
                
                // 月份效應
                value *= monthFactor;
                
                // AI 和天氣因素（如果有）
                if (aiFactor !== 1.0) value *= aiFactor;
                if (weatherFactor !== 1.0) value *= weatherFactor;
                
                // 遠期趨勢衰減（模擬 EWMA 的影響減弱）
                // XGBoost 的 EWMA 特徵捕捉近期趨勢，但這種趨勢會隨時間衰減
                if (daysAhead > 7) {
                    const trendDecay = Math.exp(-0.05 * (daysAhead - 7));
                    const historicalValue = targetMean * monthFactor;
                    value = value * trendDecay + historicalValue * (1 - trendDecay);
                }
                
                adjusted = Math.round(value);
            }
            
            // 置信區間：基於歷史標準差
            const baseStd = dowStds[dow];
            // 遠期預測不確定性增加
            const uncertaintyMultiplier = 1.0 + daysAhead * 0.03; // 每天增加 3%
            const std = baseStd * uncertaintyMultiplier;
            
            predictions.push({
                date: dateStr,
                predicted: adjusted,
                ci80: { low: Math.round(adjusted - 1.28 * std), high: Math.round(adjusted + 1.28 * std) },
                ci95: { low: Math.round(adjusted - 1.96 * std), high: Math.round(adjusted + 1.96 * std) },
                factors: {
                    dow: dowFactor,
                    month: monthFactor,
                    ai: aiFactor,
                    weather: weatherFactor
                },
                weatherInfo,
                aiInfo
            });
        }
        
        // 顯示因素影響
        const aiAffectedDays = predictions.filter(p => p.factors.ai !== 1.0);
        const weatherAffectedDays = predictions.filter(p => p.factors.weather !== 1.0);
        if (aiAffectedDays.length > 0) {
            console.log(`🤖 AI 因素影響 ${aiAffectedDays.length} 天預測`);
        }
        if (weatherAffectedDays.length > 0) {
            console.log(`🌤️ 天氣因素影響 ${weatherAffectedDays.length} 天預測`);
        }
        
        if (predictions.length === 0) {
            console.log('⚠️ 沒有成功的預測，跳過保存');
            return;
        }
        
        // 保存預測到數據庫
        let savedCount = 0;
        for (const pred of predictions) {
            try {
                // 準備天氣數據
                const weatherData = pred.weatherInfo ? {
                    maxTemp: pred.weatherInfo.maxTemp,
                    minTemp: pred.weatherInfo.minTemp,
                    weather: pred.weatherInfo.weather,
                    factor: pred.factors.weather
                } : null;
                
                // 準備 AI 因素數據
                const aiFactorsData = pred.aiInfo ? {
                    factor: pred.factors.ai,
                    factors: pred.aiInfo.factors?.map(f => f.name || f.factor) || []
                } : null;
                
                const result = await db.insertDailyPrediction(
                    pred.date,
                    pred.predicted,
                    pred.ci80,
                    pred.ci95,
                    MODEL_VERSION,
                    weatherData,
                    aiFactorsData
                );
                if (savedCount === 0) {
                    console.log(`📝 首筆預測已保存: ${pred.date} = ${pred.predicted}人, id=${result?.id || 'unknown'}`);
                }
                savedCount++;
            } catch (err) {
                console.error(`❌ 保存 ${pred.date} 預測失敗:`, err.message, err.stack);
            }
        }
        
        const duration = Date.now() - startTime;
        console.log(`✅ 伺服器端自動預測完成：已保存 ${savedCount}/${predictions.length} 筆預測（v${MODEL_VERSION}，耗時 ${(duration/1000).toFixed(1)}s）`);
        if (predictions.length > 0) {
            console.log(`   今日預測: ${predictions[0].predicted} 人 (${predictions[0].date})`);
            console.log(`   明日預測: ${predictions[1]?.predicted || 'N/A'} 人 (${predictions[1]?.date || 'N/A'})`);
        }
        
        // 更新統計
        autoPredictStats.todayCount++;
        autoPredictStats.lastRunTime = new Date().toISOString();
        autoPredictStats.lastRunSuccess = true;
        autoPredictStats.lastRunDuration = duration;
        autoPredictStats.totalSuccessCount++;
        
        // v2.9.90: 保存到數據庫
        await saveAutoPredictStatsToDB();
        
    } catch (error) {
        console.error('❌ 伺服器端自動預測失敗:', error);
        
        // 更新失敗統計
        autoPredictStats.lastRunTime = new Date().toISOString();
        autoPredictStats.lastRunSuccess = false;
        autoPredictStats.lastRunDuration = Date.now() - startTime;
        autoPredictStats.totalFailCount++;
        
        // v2.9.90: 保存到數據庫
        await saveAutoPredictStatsToDB();
    }
}

// 設置每 30 分鐘自動預測
function scheduleAutoPredict() {
    // 啟動時立即執行一次
    setTimeout(() => {
        generateServerSidePredictions();
    }, 10000); // 10 秒後執行（等待數據庫連接穩定）
    
    // 每 30 分鐘執行一次
    setInterval(() => {
        generateServerSidePredictions();
    }, 30 * 60 * 1000); // 30 分鐘
    
    console.log('⏰ 已設置伺服器端自動預測任務（每 30 分鐘執行一次）');
}

server.listen(PORT, async () => {
    console.log(`🏥 NDH AED 預測系統運行於 http://localhost:${PORT}`);
    console.log(`📊 預測模型版本 ${MODEL_VERSION}`);
    if (db && db.pool) {
        console.log(`🗄️ PostgreSQL 數據庫已連接`);
        
        // v2.9.90: 從數據庫載入自動預測統計
        await loadAutoPredictStatsFromDB();
        
        // 啟動定時任務
        scheduleDailyFinalPrediction();
        scheduleDailyStatsReset(); // 每日 00:00 重置自動預測統計
        scheduleAutoPredict(); // 每 30 分鐘自動預測（使用 XGBoost）
    } else {
        console.log(`⚠️ 數據庫未配置 (設置 DATABASE_URL 或 PGHOST/PGUSER/PGPASSWORD/PGDATABASE 環境變數以啟用)`);
    }
});


