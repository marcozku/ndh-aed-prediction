const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3001;
const MODEL_VERSION = '4.0.25'; // v4.0.25: 修復 Railway 預測持平（server.js 混合策略+擾動）

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

// ============================================
// 天氣影響分析工具函數
// ============================================
function triggerWeatherAnalysis() {
    return new Promise((resolve, reject) => {
        const { exec } = require('child_process');
        const pythonScript = path.join(__dirname, 'python', 'auto_weather_analysis.py');
        
        console.log('📊 觸發天氣影響分析...');
        
        exec(`python "${pythonScript}"`, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                console.error('天氣分析錯誤:', error.message);
                reject(error);
                return;
            }
            
            try {
                const result = JSON.parse(stdout);
                console.log(`✅ 天氣影響分析完成，分析了 ${result.total_days} 天數據`);
                resolve(result);
            } catch (parseErr) {
                console.log('天氣分析完成（無 JSON 輸出）');
                console.log(stderr);
                resolve({ message: 'Analysis completed', logs: stderr });
            }
        });
    });
}

// ============================================
// v3.0.83: 可靠度學習工具函數
// ============================================
async function triggerReliabilityLearning(importedDates) {
    if (!db || !db.pool || !importedDates || importedDates.length === 0) {
        return { message: 'No dates to process', count: 0 };
    }
    
    console.log(`📊 觸發可靠度學習 (${importedDates.length} 天)...`);
    
    let learningCount = 0;
    for (const date of importedDates) {
        try {
            // 獲取該日期的實際數據
            const actualData = await db.getActualData(date, date);
            if (!actualData || actualData.length === 0) continue;
            
            const actual = actualData[0].attendance;
            
            // 獲取該日期的預測數據
            const predictions = await db.getPredictions(date, date);
            if (!predictions || predictions.length === 0) continue;
            
            // 取最後一次預測
            const pred = predictions[predictions.length - 1];
            
            // 組裝預測數據
            const predictionData = {
                xgboost: pred.predicted_count || pred.prediction,
                ai: pred.ai_prediction || null,
                weather: pred.weather_prediction || null
            };
            
            // 執行可靠度學習
            const result = await db.updateReliabilityLearning(date, actual, predictionData);
            if (result) learningCount++;
            
        } catch (err) {
            console.warn(`可靠度學習跳過 ${date}:`, err.message);
        }
    }
    
    console.log(`✅ 可靠度學習完成: ${learningCount}/${importedDates.length} 天`);
    return { message: 'Reliability learning completed', count: learningCount };
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
    if (res.headersSent) return;
    // 確保所有字符串都正確編碼為 UTF-8
    const jsonString = JSON.stringify(data, null, 0);
    const buffer = Buffer.from(jsonString, 'utf-8');
    
    res.writeHead(statusCode, { 
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        // v3.0.90: 避免任何 CDN / edge / browser 快取 API 回應（防止 JSON 變成舊 HTML 被快取）
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache'
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
            
            // 觸發天氣影響分析（異步，不阻塞響應）
            triggerWeatherAnalysis().catch(err => {
                console.warn('天氣影響分析失敗（非關鍵）:', err.message);
            });
            
            sendJson(res, { success: true, inserted: results.length, data: results, weatherAnalysis: 'triggered' });
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

    // v3.0.86: 只支援 7 天預測（Day 8+ 準確度不可靠）
    'GET /api/future-predictions': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);
        
        try {
            const parsedUrl = url.parse(req.url, true);
            const days = Math.min(parseInt(parsedUrl.query.days) || 30, 30); // v3.3.00: 最多 30 天
            
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
            const { date, start, end, days, refresh } = parsedUrl.query;
            
            // 獲取香港時間的今天日期
            const hk = getHKTime();
            const todayStr = hk.dateStr;
            
            // v3.1.03: 刷新 final_daily_predictions（確保數據一致）
            if (refresh === 'true') {
                const numDays = parseInt(days) || 7;
                const [year, month, day] = todayStr.split('-').map(Number);
                const startDate = new Date(year, month - 1, day);
                startDate.setDate(startDate.getDate() - numDays + 1);
                const startStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
                
                console.log(`🔄 刷新 ${startStr} 到 ${todayStr} 的 final_daily_predictions...`);
                const datesResult = await db.pool.query(`
                    SELECT DISTINCT target_date 
                    FROM daily_predictions 
                    WHERE target_date >= $1 AND target_date <= $2
                    ORDER BY target_date
                `, [startStr, todayStr]);
                
                for (const row of datesResult.rows) {
                    const dateStr = row.target_date.toISOString().split('T')[0];
                    try {
                        await db.calculateFinalDailyPrediction(dateStr);
                    } catch (err) {
                        // 忽略計算錯誤
                    }
                }
                console.log(`✅ 刷新完成（${datesResult.rows.length} 個日期）`);
            }
            
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
                
                // v3.0.24: HKT 日期計算
                const [year, month, day] = todayStr.split('-').map(Number);
                // 創建 HKT 日期並減去天數
                const startDate = new Date(year, month - 1, day);
                startDate.setDate(startDate.getDate() - numDays + 1);
                const startStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
                
                console.log(`📅 Intraday 查詢範圍 (HKT): ${startStr} 到 ${todayStr}`);
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
                    ci80_high: row.ci80_high,
                    source: row.source || 'auto'  // v3.0.65: 加入來源類型
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

    // v3.0.50: Cleanup duplicate intraday predictions
    'POST /api/cleanup-intraday': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);
        
        try {
            const data = await parseBody(req);
            const targetDate = data?.date || null;
            
            console.log(`🧹 開始清理重複的 intraday 預測${targetDate ? ` (日期: ${targetDate})` : ' (所有日期)'}...`);
            const result = await db.cleanupDuplicateIntradayPredictions(targetDate);
            
            console.log(`✅ 清理完成：刪除 ${result.totalDeleted} 筆重複記錄`);
            sendJson(res, {
                success: true,
                message: `已刪除 ${result.totalDeleted} 筆重複記錄`,
                ...result
            });
        } catch (error) {
            console.error('❌ 清理 intraday 預測失敗:', error);
            sendJson(res, { success: false, error: error.message }, 500);
        }
    },

    // Manually trigger server-side prediction generation (synchronous - waits for completion)
    // v3.0.65: 傳遞 source='manual' 區分手動觸發
    // v3.0.68: 支援 source 參數：manual/training/upload，預設為 manual
    'POST /api/trigger-prediction': async (req, res) => {
        try {
            const parsedUrl = url.parse(req.url, true);
            // 支援 query string 或 body 傳遞 source
            const body = await parseBody(req).catch(() => ({}));
            const validSources = ['manual', 'training', 'upload'];
            const source = validSources.includes(parsedUrl.query.source) 
                ? parsedUrl.query.source 
                : validSources.includes(body?.source) 
                    ? body.source 
                    : 'manual';
            
            const sourceEmoji = source === 'manual' ? '🔧' : source === 'training' ? '🎓' : '📤';
            const sourceLabel = source === 'manual' ? '手動' : source === 'training' ? '訓練後' : '上傳後';
            console.log(`🔮 ${sourceEmoji} ${sourceLabel}觸發預測更新（同步）...`);
            const startTime = Date.now();
            await generateServerSidePredictions(source);
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`✅ ${sourceLabel}預測更新完成（${duration}秒）`);
            sendJson(res, { 
                success: true, 
                message: `預測更新完成（${duration}秒）`,
                duration: parseFloat(duration),
                source
            });
        } catch (error) {
            console.error('❌ 預測更新失敗:', error);
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

    // v4.0.14: 獲取最近準確度視圖數據（使用性能視圖）
    'GET /api/recent-accuracy': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);

        try {
            // 嘗試使用性能視圖，如果不存在則使用原始查詢
            let result;
            try {
                result = await db.pool.query('SELECT * FROM v_recent_accuracy');
            } catch (viewErr) {
                // 視圖不存在，使用原始查詢
                console.log('⚠️ v_recent_accuracy 視圖不存在，使用原始查詢');
                result = await db.pool.query(`
                    SELECT
                        pa.target_date,
                        pa.predicted_count,
                        pa.actual_count,
                        pa.error,
                        pa.error_percentage
                    FROM prediction_accuracy pa
                    ORDER BY pa.target_date DESC
                    LIMIT 100
                `);
            }

            sendJson(res, {
                success: true,
                data: result.rows,
                count: result.rows.length,
                source: 'v_recent_accuracy'
            });
        } catch (err) {
            console.error('獲取最近準確度失敗:', err);
            sendJson(res, { error: err.message }, 500);
        }
    },

    // v4.0.14: 獲取模型性能視圖數據（使用性能視圖）
    'GET /api/model-performance': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);

        try {
            // 嘗試使用性能視圖，如果不存在則使用原始查詢
            let result;
            try {
                result = await db.pool.query('SELECT * FROM v_model_performance');
            } catch (viewErr) {
                // 視圖不存在，使用原始查詢
                console.log('⚠️ v_model_performance 視圖不存在，使用原始查詢');
                result = await db.pool.query(`
                    SELECT
                        model_name,
                        mae,
                        rmse,
                        mape,
                        r2,
                        training_date,
                        data_count
                    FROM model_metrics
                    ORDER BY updated_at DESC
                `);
            }

            sendJson(res, {
                success: true,
                data: result.rows,
                count: result.rows.length,
                source: 'v_model_performance'
            });
        } catch (err) {
            console.error('獲取模型性能失敗:', err);
            sendJson(res, { error: err.message }, 500);
        }
    },

    // v4.0.15: 獲取訓練性能 vs 實際性能對比數據
    'GET /api/performance-comparison': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);

        try {
            // 1. 獲取訓練理論性能 (model_metrics)
            const trainingResult = await db.pool.query(`
                SELECT
                    model_name,
                    version,
                    mae as training_mae,
                    rmse as training_rmse,
                    mape as training_mape,
                    r2 as training_r2,
                    n_features,
                    optimization_method,
                    training_date
                FROM model_metrics
                WHERE model_name = 'xgboost'
                ORDER BY updated_at DESC
                LIMIT 1
            `);

            // 2. 獲取實際預測性能 (prediction_accuracy)
            const realResult = await db.pool.query(`
                SELECT
                    COUNT(*) as total_predictions,
                    AVG(ABS(predicted_count - actual_count)) as real_mae,
                    SQRT(AVG(POWER(predicted_count - actual_count, 2))) as real_rmse,
                    AVG(ABS(predicted_count - actual_count)::float / NULLIF(actual_count, 0) * 100) as real_mape,
                    SUM(CASE WHEN within_ci80 THEN 1 ELSE 0 END)::float / COUNT(*) * 100 as ci80_accuracy,
                    SUM(CASE WHEN within_ci95 THEN 1 ELSE 0 END)::float / COUNT(*) * 100 as ci95_accuracy
                FROM prediction_accuracy
                WHERE actual_count IS NOT NULL
            `);

            // 2b. 計算實際 R² = 1 - (SS_res / SS_tot)
            const r2Result = await db.pool.query(`
                WITH stats AS (
                    SELECT
                        AVG(actual_count) as mean_actual,
                        SUM(POWER(actual_count - predicted_count, 2)) as ss_res
                    FROM prediction_accuracy
                    WHERE actual_count IS NOT NULL
                ),
                ss_tot_calc AS (
                    SELECT
                        SUM(POWER(actual_count - (SELECT mean_actual FROM stats), 2)) as ss_tot
                    FROM prediction_accuracy
                    WHERE actual_count IS NOT NULL
                )
                SELECT
                    CASE WHEN st.ss_tot > 0 THEN 1 - (s.ss_res / st.ss_tot) ELSE 0 END as real_r2
                FROM stats s, ss_tot_calc st
            `);

            // 3. 獲取最近 30 天的實際性能
            const recent30Result = await db.pool.query(`
                SELECT
                    COUNT(*) as total_predictions,
                    AVG(ABS(predicted_count - actual_count)) as real_mae,
                    SQRT(AVG(POWER(predicted_count - actual_count, 2))) as real_rmse,
                    AVG(ABS(predicted_count - actual_count)::float / NULLIF(actual_count, 0) * 100) as real_mape
                FROM prediction_accuracy
                WHERE actual_count IS NOT NULL
                AND target_date >= CURRENT_DATE - INTERVAL '30 days'
            `);

            const training = trainingResult.rows[0] || {};
            const real = realResult.rows[0] || {};
            const recent30 = recent30Result.rows[0] || {};
            const realR2 = r2Result.rows[0]?.real_r2 || 0;

            // 4. 計算差距和改進建議
            const trainingMAE = parseFloat(training.training_mae) || 0;
            const realMAE = parseFloat(real.real_mae) || 0;
            const maeGap = realMAE - trainingMAE;
            const maeGapPercent = trainingMAE > 0 ? ((maeGap / trainingMAE) * 100) : 0;

            const improvements = [];
            if (maeGapPercent > 100) {
                improvements.push({
                    area: '模型泛化能力',
                    severity: 'high',
                    suggestion: '實際 MAE 遠高於訓練 MAE，建議增加訓練數據多樣性或調整模型複雜度'
                });
            }
            if (parseFloat(real.ci80_accuracy) < 80) {
                improvements.push({
                    area: '置信區間校準',
                    severity: 'medium',
                    suggestion: `80% CI 準確率僅 ${parseFloat(real.ci80_accuracy).toFixed(1)}%，建議重新校準置信區間`
                });
            }
            if (parseFloat(recent30.real_mae) > realMAE * 1.2) {
                improvements.push({
                    area: '近期性能下降',
                    severity: 'high',
                    suggestion: '近 30 天性能明顯下降，建議檢查數據分佈變化或重新訓練模型'
                });
            }

            sendJson(res, {
                success: true,
                data: {
                    training: {
                        model_name: training.model_name || 'xgboost',
                        version: training.version || 'unknown',
                        mae: parseFloat(training.training_mae) || 0,
                        rmse: parseFloat(training.training_rmse) || 0,
                        mape: parseFloat(training.training_mape) || 0,
                        r2: parseFloat(training.training_r2) || 0,
                        n_features: training.n_features || 0,
                        optimization_method: training.optimization_method || '',
                        training_date: training.training_date
                    },
                    real: {
                        total_predictions: parseInt(real.total_predictions) || 0,
                        mae: parseFloat(real.real_mae) || 0,
                        rmse: parseFloat(real.real_rmse) || 0,
                        mape: parseFloat(real.real_mape) || 0,
                        r2: parseFloat(realR2) || 0,
                        ci80_accuracy: parseFloat(real.ci80_accuracy) || 0,
                        ci95_accuracy: parseFloat(real.ci95_accuracy) || 0
                    },
                    recent30: {
                        total_predictions: parseInt(recent30.total_predictions) || 0,
                        mae: parseFloat(recent30.real_mae) || 0,
                        rmse: parseFloat(recent30.real_rmse) || 0,
                        mape: parseFloat(recent30.real_mape) || 0
                    },
                    gap_analysis: {
                        mae_gap: maeGap,
                        mae_gap_percent: maeGapPercent,
                        status: maeGapPercent > 200 ? 'critical' : maeGapPercent > 100 ? 'warning' : 'good'
                    },
                    improvements: improvements
                }
            });
        } catch (err) {
            console.error('獲取性能對比失敗:', err);
            sendJson(res, { error: err.message }, 500);
        }
    },

    // Get comparison data (actual vs predicted)
    'GET /api/comparison': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);
        
        try {
            const parsedUrl = url.parse(req.url, true);
            const limit = parseInt(parsedUrl.query.limit) || 100;
            const refresh = parsedUrl.query.refresh === 'true';
            
            // v3.1.02: 自動刷新最近7天的 final_daily_predictions（確保數據一致）
            if (refresh) {
                const hk = getHKTime();
                const endDate = hk.dateStr;
                const startDateObj = new Date(hk.dateStr);
                startDateObj.setDate(startDateObj.getDate() - 7);
                const startDate = startDateObj.toISOString().split('T')[0];
                
                console.log(`🔄 刷新 ${startDate} 到 ${endDate} 的 final_daily_predictions...`);
                const datesResult = await db.pool.query(`
                    SELECT DISTINCT target_date 
                    FROM daily_predictions 
                    WHERE target_date >= $1 AND target_date <= $2
                    ORDER BY target_date
                `, [startDate, endDate]);
                
                for (const row of datesResult.rows) {
                    const dateStr = row.target_date.toISOString().split('T')[0];
                    try {
                        await db.calculateFinalDailyPrediction(dateStr);
                    } catch (err) {
                        // 忽略計算錯誤
                    }
                }
                console.log(`✅ 刷新完成（${datesResult.rows.length} 個日期）`);
            }
            
            const data = await db.getComparisonData(limit);
            console.log(`📊 比較數據查詢結果: ${data.length} 筆數據`);
            sendJson(res, { success: true, data });
        } catch (error) {
            console.error('❌ 獲取比較數據失敗:', error);
            console.error('錯誤詳情:', error.stack);
            sendJson(res, { error: error.message, stack: error.stack }, 500);
        }
    },
    
    // v3.0.89: 列出所有可用路由
    'GET /api/list-routes': async (req, res) => {
        const routes = Object.keys(apiHandlers).sort();
        sendJson(res, { 
            success: true, 
            version: MODEL_VERSION,
            totalRoutes: routes.length,
            routes: routes,
            hasAccuracyHistory: routes.includes('GET /api/accuracy-history')
        });
    },

    // v3.0.87: 準確度歷史（用於可靠度學習）
    // v3.0.98: 改進查詢以包含尚未有實際數據的預測（實時顯示）
    'GET /api/accuracy-history': async (req, res) => {
        console.log('📊 accuracy-history API 被調用');
        if (!db || !db.pool) {
            return sendJson(res, { error: 'Database not configured' }, 503);
        }
        try {
            const parsedUrl = url.parse(req.url, true);
            const days = parseInt(parsedUrl.query.days) || 30;
            console.log(`📊 查詢 ${days} 天的準確度歷史（包含待驗證預測）`);
            
            // v3.0.98: 使用 FULL OUTER JOIN 合併實際數據和預測數據
            // v3.0.99: 增加 intraday_predictions 以包含今日即時預測
            // v3.1.04: 使用 HKT 時區確保日期範圍正確
            // 這樣可以顯示：1) 有實際數據的歷史 2) 有預測但尚無實際數據的日期
            const query = `
                WITH hkt_today AS (
                    SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Hong_Kong')::date AS today
                ),
                date_range AS (
                    SELECT generate_series(
                        ((SELECT today FROM hkt_today) - $1::interval)::date,
                        (SELECT today FROM hkt_today),
                        '1 day'::interval
                    )::date AS date
                ),
                predictions AS (
                    SELECT DISTINCT ON (target_date)
                        target_date,
                        predicted_count,
                        prediction_production,
                        prediction_experimental,
                        xgboost_base,
                        ai_factor,
                        weather_factor
                    FROM daily_predictions
                    WHERE target_date >= (SELECT today FROM hkt_today) - $1::interval
                      AND target_date <= (SELECT today FROM hkt_today)
                    ORDER BY target_date, created_at DESC
                ),
                final_predictions AS (
                    SELECT target_date, predicted_count
                    FROM final_daily_predictions
                    WHERE target_date >= (SELECT today FROM hkt_today) - $1::interval
                      AND target_date <= (SELECT today FROM hkt_today)
                ),
                intraday AS (
                    SELECT DISTINCT ON (target_date)
                        target_date,
                        predicted_count
                    FROM intraday_predictions
                    WHERE target_date >= (SELECT today FROM hkt_today) - $1::interval
                      AND target_date <= (SELECT today FROM hkt_today)
                    ORDER BY target_date, prediction_time DESC
                )
                SELECT 
                    dr.date::text as date,
                    COALESCE(
                        fp.predicted_count,
                        p.predicted_count,
                        i.predicted_count
                    )::integer as predicted,
                    a.patient_count::integer as actual,
                    p.prediction_production,
                    p.prediction_experimental,
                    p.xgboost_base,
                    p.ai_factor,
                    p.weather_factor,
                    -- v3.1.05: 計算 Experimental 值（與 /api/dual-track/summary 一致）
                    CASE 
                        WHEN fp.predicted_count IS NOT NULL AND p.ai_factor IS NOT NULL AND p.ai_factor != 1.0 THEN
                            -- 使用 final_daily_predictions 的值作為 Production，計算 Experimental
                            fp.predicted_count + ROUND((p.ai_factor - 1.0) * COALESCE(p.xgboost_base, fp.predicted_count) * 0.10)
                        WHEN fp.predicted_count IS NOT NULL THEN
                            -- 無 AI 影響時，Experimental = Production
                            fp.predicted_count
                        WHEN p.prediction_experimental IS NOT NULL THEN
                            -- Fallback: 使用 daily_predictions 中的值
                            p.prediction_experimental
                        ELSE NULL
                    END::integer as experimental_predicted
                FROM date_range dr
                LEFT JOIN actual_data a ON a.date = dr.date
                LEFT JOIN predictions p ON p.target_date = dr.date
                LEFT JOIN final_predictions fp ON fp.target_date = dr.date
                LEFT JOIN intraday i ON i.target_date = dr.date
                WHERE (a.patient_count IS NOT NULL OR p.predicted_count IS NOT NULL OR fp.predicted_count IS NOT NULL OR i.predicted_count IS NOT NULL)
                ORDER BY dr.date DESC
            `;
            
            const result = await db.pool.query(query, [`${days} days`]);
            console.log(`📊 查詢返回 ${result.rows.length} 筆數據（包含 ${result.rows.filter(r => r.actual === null).length} 筆待驗證）`);
            
            sendJson(res, {
                success: true,
                history: result.rows,
                count: result.rows.length,
                days: days
            });
        } catch (error) {
            console.error('❌ 獲取準確度歷史失敗:', error);
            sendJson(res, { success: false, error: error.message }, 500);
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

    // 運行天氣影響分析
    'POST /api/analyze-weather-impact': async (req, res) => {
        try {
            const { exec } = require('child_process');
            const path = require('path');
            const pythonScript = path.join(__dirname, 'python', 'auto_weather_analysis.py');
            
            console.log('📊 開始運行天氣影響分析...');
            
            // 運行 Python 分析腳本
            exec(`python "${pythonScript}"`, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
                if (error) {
                    console.error('天氣分析錯誤:', error);
                    return sendJson(res, { 
                        success: false, 
                        error: error.message,
                        stderr: stderr
                    }, 500);
                }
                
                try {
                    const result = JSON.parse(stdout);
                    console.log(`✅ 天氣影響分析完成，分析了 ${result.total_days} 天數據`);
                    sendJson(res, { 
                        success: true, 
                        message: `分析完成，共 ${result.total_days} 天數據`,
                        result 
                    });
                } catch (parseErr) {
                    console.log('分析輸出:', stdout);
                    console.log('分析日誌:', stderr);
                    sendJson(res, { 
                        success: true, 
                        message: '分析完成',
                        output: stdout,
                        logs: stderr
                    });
                }
            });
        } catch (err) {
            console.error('天氣分析失敗:', err);
            sendJson(res, { success: false, error: err.message }, 500);
        }
    },

    // 獲取天氣影響分析結果
    'GET /api/weather-impact': async (req, res) => {
        try {
            const path = require('path');
            const analysisPath = path.join(__dirname, 'python', 'models', 'weather_impact_analysis.json');
            
            if (!fs.existsSync(analysisPath)) {
                return sendJson(res, { 
                    success: false, 
                    error: '天氣影響分析數據不存在，請先運行分析' 
                }, 404);
            }
            
            const analysisData = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
            sendJson(res, analysisData);
        } catch (err) {
            console.error('獲取天氣影響分析失敗:', err);
            sendJson(res, { success: false, error: err.message }, 500);
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
                
                // 觸發天氣影響分析（異步，不阻塞響應）
                triggerWeatherAnalysis().catch(err => {
                    console.warn('天氣影響分析失敗（非關鍵）:', err.message);
                });
                
                // v3.0.83: 觸發可靠度學習（異步，不阻塞響應）
                triggerReliabilityLearning(result.importedDates).catch(err => {
                    console.warn('可靠度學習失敗（非關鍵）:', err.message);
                });
                
                sendJson(res, {
                    success: true,
                    message: `成功導入 ${result.count} 筆數據${accuracyCount > 0 ? `，已計算 ${accuracyCount} 筆準確度` : ''}`,
                    count: result.count,
                    errors: result.errors || 0,
                    accuracyCalculated: accuracyCount,
                    weatherAnalysis: 'triggered',
                    reliabilityLearning: 'triggered'
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

    // 獲取自動預測統計 (v2.9.53, v3.0.32: 加入實際記錄數)
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
        
        // v3.0.32: 從 intraday_predictions 獲取實際記錄數（更準確）
        let actualIntradayCount = autoPredictStats.todayCount;
        if (db && db.pool) {
            try {
                const countResult = await db.pool.query(
                    `SELECT COUNT(*) as cnt FROM intraday_predictions WHERE target_date = $1`,
                    [hk.dateStr]
                );
                actualIntradayCount = parseInt(countResult.rows[0]?.cnt) || 0;
            } catch (e) {
                console.warn('⚠️ 無法獲取 intraday 記錄數:', e.message);
            }
        }
        
        sendJson(res, {
            success: true,
            currentDate: hk.dateStr,
            currentTime: `${String(hk.hour).padStart(2, '0')}:${String(hk.minute).padStart(2, '0')} HKT`,
            todayCount: actualIntradayCount,  // v3.0.32: 使用實際記錄數
            statsCount: autoPredictStats.todayCount,  // 舊的統計計數（僅供參考）
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
            
            // v3.0.9: 讀取天氣警告歷史數據（颱風、暴雨等）
            const warningsPath = path.join(__dirname, 'python/weather_warnings_history.csv');
            let warningsMap = {};
            if (fs.existsSync(warningsPath)) {
                const warningsContent = fs.readFileSync(warningsPath, 'utf-8');
                const warningsLines = warningsContent.trim().split('\n');
                for (const line of warningsLines) {
                    if (line.startsWith('#') || line.startsWith('Date')) continue;
                    const parts = line.split(',');
                    if (parts.length >= 5) {
                        const date = parts[0].trim();
                        warningsMap[date] = {
                            typhoonSignal: parseInt(parts[1]) || 0,
                            rainstormWarning: parseInt(parts[2]) || 0,
                            hotWarning: parseInt(parts[3]) || 0,
                            coldWarning: parseInt(parts[4]) || 0,
                            notes: parts[5] || ''
                        };
                    }
                }
                console.log(`✅ 天氣警告數據已載入: ${Object.keys(warningsMap).length} 天`);
            }
            
            // 合併警告數據到 dataPoints
            for (const d of dataPoints) {
                const warning = warningsMap[d.date];
                if (warning) {
                    d.typhoonSignal = warning.typhoonSignal;
                    d.rainstormWarning = warning.rainstormWarning;
                    d.hotWarning = warning.hotWarning;
                    d.coldWarning = warning.coldWarning;
                } else {
                    d.typhoonSignal = 0;
                    d.rainstormWarning = 0;
                    d.hotWarning = 0;
                    d.coldWarning = 0;
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
            
            // v3.0.7: 更有意義的天氣分析
            // 1. 計算溫度變化（今天 vs 昨天）
            const sortedData = [...dataPoints].sort((a, b) => a.date.localeCompare(b.date));
            for (let i = 1; i < sortedData.length; i++) {
                const prevDate = new Date(sortedData[i-1].date);
                const currDate = new Date(sortedData[i].date);
                const daysDiff = (currDate - prevDate) / (1000 * 60 * 60 * 24);
                if (daysDiff === 1) {
                    sortedData[i].tempChange = sortedData[i].temperature - sortedData[i-1].temperature;
                }
            }
            
            // 2. 加入星期資訊
            for (const d of sortedData) {
                const date = new Date(d.date);
                d.dayOfWeek = date.getDay();
                d.isWeekend = d.dayOfWeek === 0 || d.dayOfWeek === 6;
            }
            
            // 3. 計算溫度變化相關性
            const tempChangeData = sortedData.filter(d => d.tempChange !== undefined);
            correlation.tempChange = pearson(
                tempChangeData.map(d => d.tempChange),
                tempChangeData.map(d => d.actual)
            );
            
            // 4. 計算極端溫度變化的影響
            const bigTempDrop = tempChangeData.filter(d => d.tempChange <= -5);
            const bigTempRise = tempChangeData.filter(d => d.tempChange >= 5);
            const stableTemp = tempChangeData.filter(d => Math.abs(d.tempChange) < 3);
            
            const avgBigDrop = bigTempDrop.length > 0 
                ? Math.round(bigTempDrop.reduce((s, d) => s + d.actual, 0) / bigTempDrop.length) : null;
            const avgBigRise = bigTempRise.length > 0 
                ? Math.round(bigTempRise.reduce((s, d) => s + d.actual, 0) / bigTempRise.length) : null;
            const avgStable = stableTemp.length > 0 
                ? Math.round(stableTemp.reduce((s, d) => s + d.actual, 0) / stableTemp.length) : null;
            
            // 5. 計算星期 × 天氣交互效應
            const dowNames = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
            const dowWeatherStats = {};
            for (let dow = 0; dow <= 6; dow++) {
                const dowData = sortedData.filter(d => d.dayOfWeek === dow);
                const hotDow = dowData.filter(d => d.isHot);
                const coldDow = dowData.filter(d => d.isCold);
                const normalDow = dowData.filter(d => !d.isHot && !d.isCold);
                
                dowWeatherStats[dowNames[dow]] = {
                    overall: dowData.length > 0 ? Math.round(dowData.reduce((s, d) => s + d.actual, 0) / dowData.length) : null,
                    hot: hotDow.length > 0 ? Math.round(hotDow.reduce((s, d) => s + d.actual, 0) / hotDow.length) : null,
                    cold: coldDow.length > 0 ? Math.round(coldDow.reduce((s, d) => s + d.actual, 0) / coldDow.length) : null,
                    normal: normalDow.length > 0 ? Math.round(normalDow.reduce((s, d) => s + d.actual, 0) / normalDow.length) : null,
                    hotCount: hotDow.length,
                    coldCount: coldDow.length,
                    normalCount: normalDow.length
                };
            }
            
            // 6. 計算整體平均
            const overallAvg = Math.round(sortedData.reduce((s, d) => s + d.actual, 0) / sortedData.length);
            
            // 7. 季節 × 天氣交互分析
            const getMonth = (d) => new Date(d.date).getMonth() + 1;
            const isWinter = (d) => [12, 1, 2].includes(getMonth(d));
            const isSummer = (d) => [6, 7, 8].includes(getMonth(d));
            
            const seasonWeatherStats = {
                winterCold: { // 冬季寒冷日
                    days: sortedData.filter(d => isWinter(d) && d.isCold),
                    get avg() { return this.days.length > 0 ? Math.round(this.days.reduce((s, d) => s + d.actual, 0) / this.days.length) : null; }
                },
                winterNormal: { // 冬季普通日
                    days: sortedData.filter(d => isWinter(d) && !d.isCold && !d.isHot),
                    get avg() { return this.days.length > 0 ? Math.round(this.days.reduce((s, d) => s + d.actual, 0) / this.days.length) : null; }
                },
                summerHot: { // 夏季酷熱日
                    days: sortedData.filter(d => isSummer(d) && d.isHot),
                    get avg() { return this.days.length > 0 ? Math.round(this.days.reduce((s, d) => s + d.actual, 0) / this.days.length) : null; }
                },
                summerNormal: { // 夏季普通日
                    days: sortedData.filter(d => isSummer(d) && !d.isHot && !d.isCold),
                    get avg() { return this.days.length > 0 ? Math.round(this.days.reduce((s, d) => s + d.actual, 0) / this.days.length) : null; }
                }
            };
            
            // 8. 極端溫差日分析（日溫差 > 10°C）
            const bigTempRange = sortedData.filter(d => d.tempRange > 10);
            const normalTempRange = sortedData.filter(d => d.tempRange <= 10 && d.tempRange >= 5);
            const smallTempRange = sortedData.filter(d => d.tempRange < 5);
            
            const tempRangeEffect = {
                bigRange: { // 日溫差 > 10°C
                    avg: bigTempRange.length > 0 ? Math.round(bigTempRange.reduce((s, d) => s + d.actual, 0) / bigTempRange.length) : null,
                    count: bigTempRange.length,
                    desc: '日溫差 >10°C'
                },
                normalRange: { // 日溫差 5-10°C
                    avg: normalTempRange.length > 0 ? Math.round(normalTempRange.reduce((s, d) => s + d.actual, 0) / normalTempRange.length) : null,
                    count: normalTempRange.length,
                    desc: '日溫差 5-10°C'
                },
                smallRange: { // 日溫差 < 5°C
                    avg: smallTempRange.length > 0 ? Math.round(smallTempRange.reduce((s, d) => s + d.actual, 0) / smallTempRange.length) : null,
                    count: smallTempRange.length,
                    desc: '日溫差 <5°C'
                }
            };
            
            // 9. 極端天氣日分析
            const veryHotDays = sortedData.filter(d => d.isVeryHot);
            const veryColdDays = sortedData.filter(d => d.isVeryCold);
            const extremeWeather = {
                veryHot: {
                    avg: veryHotDays.length > 0 ? Math.round(veryHotDays.reduce((s, d) => s + d.actual, 0) / veryHotDays.length) : null,
                    count: veryHotDays.length,
                    desc: '酷熱日 (max>33°C)'
                },
                veryCold: {
                    avg: veryColdDays.length > 0 ? Math.round(veryColdDays.reduce((s, d) => s + d.actual, 0) / veryColdDays.length) : null,
                    count: veryColdDays.length,
                    desc: '嚴寒日 (min<10°C)'
                }
            };
            
            // 10. 颱風日分析
            const typhoonDays = sortedData.filter(d => d.typhoonSignal >= 3);
            const t8Days = sortedData.filter(d => d.typhoonSignal >= 8);
            const nonTyphoonDays = sortedData.filter(d => d.typhoonSignal === 0);
            
            const typhoonEffect = {
                typhoon: {
                    avg: typhoonDays.length > 0 ? Math.round(typhoonDays.reduce((s, d) => s + d.actual, 0) / typhoonDays.length) : null,
                    count: typhoonDays.length,
                    desc: '颱風日 (T3+)'
                },
                t8Plus: {
                    avg: t8Days.length > 0 ? Math.round(t8Days.reduce((s, d) => s + d.actual, 0) / t8Days.length) : null,
                    count: t8Days.length,
                    desc: '8號風球+'
                },
                normal: {
                    avg: nonTyphoonDays.length > 0 ? Math.round(nonTyphoonDays.reduce((s, d) => s + d.actual, 0) / nonTyphoonDays.length) : null,
                    count: nonTyphoonDays.length,
                    desc: '非颱風日'
                }
            };
            
            // 11. 暴雨日分析
            const blackRainDays = sortedData.filter(d => d.rainstormWarning >= 3);
            const redRainDays = sortedData.filter(d => d.rainstormWarning >= 2);
            const rainstormEffect = {
                blackRain: {
                    avg: blackRainDays.length > 0 ? Math.round(blackRainDays.reduce((s, d) => s + d.actual, 0) / blackRainDays.length) : null,
                    count: blackRainDays.length,
                    desc: '黑色暴雨'
                },
                redRain: {
                    avg: redRainDays.length > 0 ? Math.round(redRainDays.reduce((s, d) => s + d.actual, 0) / redRainDays.length) : null,
                    count: redRainDays.length,
                    desc: '紅/黑雨'
                }
            };
            
            // 12. 天氣警告日分析
            const hotWarningDays = sortedData.filter(d => d.hotWarning > 0);
            const coldWarningDays = sortedData.filter(d => d.coldWarning > 0);
            const warningEffect = {
                hotWarning: {
                    avg: hotWarningDays.length > 0 ? Math.round(hotWarningDays.reduce((s, d) => s + d.actual, 0) / hotWarningDays.length) : null,
                    count: hotWarningDays.length,
                    desc: '酷熱警告日'
                },
                coldWarning: {
                    avg: coldWarningDays.length > 0 ? Math.round(coldWarningDays.reduce((s, d) => s + d.actual, 0) / coldWarningDays.length) : null,
                    count: coldWarningDays.length,
                    desc: '寒冷警告日'
                }
            };
            
            // 研究參考文獻
            const researchReferences = [
                {
                    finding: '溫度急劇變化比絕對溫度更影響急診就診',
                    source: 'Environmental Health Perspectives, 2019',
                    doi: '10.1289/EHP4898'
                },
                {
                    finding: '颱風期間急診就診減少 20-40%（交通受阻），風後 2-3 天反彈',
                    source: 'Disaster Medicine and Public Health Preparedness, 2018',
                    doi: '10.1017/dmp.2017.149'
                },
                {
                    finding: '暴雨警告日急診就診減少，但創傷個案增加',
                    source: 'Hong Kong Medical Journal, 2020',
                    doi: '10.12809/hkmj198354'
                },
                {
                    finding: '寒冷天氣增加心血管和呼吸系統疾病急診',
                    source: 'International Journal of Cardiology, 2017',
                    doi: '10.1016/j.ijcard.2017.01.097'
                },
                {
                    finding: '酷熱天氣增加中暑、熱衰竭和腎臟疾病急診',
                    source: 'Environmental Research, 2021',
                    doi: '10.1016/j.envres.2020.110509'
                }
            ];
            
            sendJson(res, {
                success: true,
                data: sortedData.slice(-500),
                count: dataPoints.length,
                correlation: correlation,
                analysis: {
                    overallAvg,
                    tempChangeEffect: {
                        bigDrop: { avg: avgBigDrop, count: bigTempDrop.length, desc: '驟降≥5°C' },
                        bigRise: { avg: avgBigRise, count: bigTempRise.length, desc: '驟升≥5°C' },
                        stable: { avg: avgStable, count: stableTemp.length, desc: '穩定(<3°C)' }
                    },
                    seasonWeather: {
                        winterCold: { avg: seasonWeatherStats.winterCold.avg, count: seasonWeatherStats.winterCold.days.length },
                        winterNormal: { avg: seasonWeatherStats.winterNormal.avg, count: seasonWeatherStats.winterNormal.days.length },
                        summerHot: { avg: seasonWeatherStats.summerHot.avg, count: seasonWeatherStats.summerHot.days.length },
                        summerNormal: { avg: seasonWeatherStats.summerNormal.avg, count: seasonWeatherStats.summerNormal.days.length }
                    },
                    tempRangeEffect,
                    extremeWeather,
                    typhoonEffect,
                    rainstormEffect,
                    warningEffect,
                    dowWeatherStats
                },
                researchReferences,
                source: 'HKO weather_history.csv + weather_warnings_history.csv + actual_data'
            });
        } catch (err) {
            console.error('獲取天氣相關性數據失敗:', err);
            sendJson(res, { success: false, error: err.message }, 500);
        }
    },

    // 獲取 AI 因素緩存（從數據庫）
    'GET /api/ai-factors-cache': async (req, res) => {
        if (!db || !db.pool) {
            return sendJson(res, { success: false, error: '數據庫未配置' }, 503);
        }
        const REQ_TIMEOUT_MS = 20000;
        try {
            await Promise.race([
                (async () => {
                    const cache = await db.getAIFactorsCache();
                    sendJson(res, { success: true, data: cache });
                })(),
                new Promise((_, r) => setTimeout(() => r(new Error('REQUEST_TIMEOUT')), REQ_TIMEOUT_MS))
            ]);
        } catch (err) {
            if (err.message === 'REQUEST_TIMEOUT' && !res.headersSent) {
                return sendJson(res, { success: false, error: 'Request timeout' }, 503);
            }
            if (err.code === '42P01' || /does not exist/i.test(String(err.message || ''))) {
                return sendJson(res, { success: true, data: { last_update_time: 0, factors_cache: {}, analysis_data: {}, updated_at: null } });
            }
            console.error('獲取 AI 因素緩存失敗:', err);
            sendJson(res, { success: false, error: err.message }, 500);
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
    
    // ============================================
    // AQHI 空氣質素健康指數 API (v3.0.72)
    // ============================================
    'GET /api/aqhi-current': async (req, res) => {
        try {
            const https = require('https');
            
            // EPD AQHI RSS Feed (XML format)
            const fetchAQHI = () => new Promise((resolve, reject) => {
                const url = 'https://www.aqhi.gov.hk/epd/ddata/html/out/aqhi_ind_rss_eng.xml';
                https.get(url, (response) => {
                    let data = '';
                    response.on('data', chunk => data += chunk);
                    response.on('end', () => resolve(data));
                }).on('error', reject);
            });
            
            const xmlData = await fetchAQHI();
            
            // 解析 XML 提取 AQHI 數值
            // 格式: <title>General Stations AQHI : 3 (Low)</title>
            const generalMatch = xmlData.match(/General Stations AQHI\s*:\s*(\d+)/i);
            const roadsideMatch = xmlData.match(/Roadside Stations AQHI\s*:\s*(\d+)/i);
            
            const general = generalMatch ? parseInt(generalMatch[1]) : null;
            const roadside = roadsideMatch ? parseInt(roadsideMatch[1]) : null;
            
            // 計算風險等級
            const maxAqhi = Math.max(general || 0, roadside || 0);
            let risk = 1;
            let riskLabel = 'Low';
            if (maxAqhi >= 11) { risk = 5; riskLabel = 'Serious'; }
            else if (maxAqhi >= 8) { risk = 4; riskLabel = 'Very High'; }
            else if (maxAqhi >= 7) { risk = 3; riskLabel = 'High'; }
            else if (maxAqhi >= 4) { risk = 2; riskLabel = 'Moderate'; }
            
            const result = {
                success: true,
                timestamp: new Date().toISOString(),
                data: {
                    general,
                    roadside,
                    risk,
                    riskLabel,
                    high: maxAqhi >= 7,
                    veryHigh: maxAqhi >= 8
                },
                source: 'Hong Kong EPD AQHI'
            };
            
            // 保存到歷史記錄
            const today = new Date().toISOString().split('T')[0];
            const aqhiPath = require('path').join(__dirname, 'python/aqhi_history.csv');
            const fs = require('fs');
            
            try {
                let existingData = '';
                if (fs.existsSync(aqhiPath)) {
                    existingData = fs.readFileSync(aqhiPath, 'utf8');
                }
                
                // 檢查今天是否已有記錄
                if (!existingData.includes(today)) {
                    const newLine = `${today},${general || 3},${roadside || 4},${risk}\n`;
                    if (!existingData) {
                        fs.writeFileSync(aqhiPath, 'Date,AQHI_General,AQHI_Roadside,AQHI_Risk\n' + newLine);
                    } else {
                        fs.appendFileSync(aqhiPath, newLine);
                    }
                    console.log(`✅ AQHI 已保存: ${today} - General: ${general}, Roadside: ${roadside}`);
                }
            } catch (saveErr) {
                console.error('⚠️ 保存 AQHI 歷史失敗:', saveErr.message);
            }
            
            sendJson(res, result);
        } catch (error) {
            console.error('❌ 獲取 AQHI 失敗:', error.message);
            sendJson(res, {
                success: false,
                error: error.message,
                fallback: {
                    general: 3,
                    roadside: 4,
                    risk: 1,
                    riskLabel: 'Low'
                }
            }, 500);
        }
    },
    
    // AQHI 歷史數據
    'GET /api/aqhi-history': async (req, res) => {
        try {
            const fs = require('fs');
            const path = require('path');
            const aqhiPath = path.join(__dirname, 'python/aqhi_history.csv');
            
            if (!fs.existsSync(aqhiPath)) {
                return sendJson(res, { success: false, error: 'AQHI 歷史數據不存在' });
            }
            
            const content = fs.readFileSync(aqhiPath, 'utf8');
            const lines = content.trim().split('\n');
            const headers = lines[0].split(',');
            const data = lines.slice(1).map(line => {
                const values = line.split(',');
                return {
                    date: values[0],
                    general: parseInt(values[1]) || 3,
                    roadside: parseInt(values[2]) || 4,
                    risk: parseInt(values[3]) || 1
                };
            });
            
            sendJson(res, {
                success: true,
                count: data.length,
                data,
                source: 'aqhi_history.csv'
            });
        } catch (error) {
            sendJson(res, { success: false, error: error.message }, 500);
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
    
    // v3.0.86: 動態假期因子 API
    'GET /api/holiday-factors': async (req, res) => {
        try {
            const fs = require('fs');
            const path = require('path');
            const factorsPath = path.join(__dirname, 'python/models/dynamic_factors.json');
            
            if (fs.existsSync(factorsPath)) {
                const data = JSON.parse(fs.readFileSync(factorsPath, 'utf8'));
                sendJson(res, {
                    success: true,
                    data: data.holiday_factors || {},
                    dow_factors: data.dow_factors || {},
                    overall_mean: data.overall_mean,
                    total_days: data.total_days,
                    updated: data.updated,
                    source: data.source
                });
            } else {
                // Fallback: 使用靜態值
                sendJson(res, {
                    success: true,
                    fallback: true,
                    data: {
                        '農曆新年': { factor: 0.951, count: 132 },
                        '聖誕節': { factor: 0.920, count: 12 },
                        '聖誕節翌日': { factor: 1.002, count: 12 },
                        '元旦': { factor: 0.955, count: 12 },
                        '清明節': { factor: 0.967, count: 22 },
                        '端午節': { factor: 1.027, count: 132 },
                        '中秋節翌日': { factor: 1.035, count: 132 },
                        '重陽節': { factor: 1.038, count: 132 },
                        '佛誕': { factor: 1.041, count: 132 },
                        '勞動節': { factor: 1.003, count: 11 },
                        '耶穌受難日': { factor: 0.987, count: 121 },
                        '耶穌受難日翌日': { factor: 0.987, count: 121 },
                        '復活節星期一': { factor: 0.988, count: 121 },
                        '香港特別行政區成立紀念日': { factor: 0.967, count: 11 },
                        '國慶日': { factor: 0.972, count: 11 }
                    },
                    updated: 'static fallback',
                    source: 'hardcoded values'
                });
            }
        } catch (error) {
            console.error('獲取假期因子失敗:', error);
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
    
    // v3.0.83: 獲取可靠度學習狀態
    'GET /api/reliability': async (req, res) => {
        try {
            if (!db || !db.pool) {
                return sendJson(res, { 
                    success: true, 
                    data: {
                        xgboost: 0.95,
                        ai: 0.00,
                        weather: 0.05,
                        source: 'default'
                    }
                });
            }
            
            const state = await db.getReliabilityState();
            const history = await db.getReliabilityHistory(30);
            
            sendJson(res, {
                success: true,
                data: {
                    current: {
                        xgboost: parseFloat(state.xgboost_reliability) || 0.95,
                        ai: parseFloat(state.ai_reliability) || 0.00,
                        weather: parseFloat(state.weather_reliability) || 0.05
                    },
                    learningRate: parseFloat(state.learning_rate) || 0.10,
                    totalSamples: parseInt(state.total_samples) || 0,
                    lastUpdated: state.last_updated,
                    recentHistory: history.slice(0, 10),
                    source: 'database'
                }
            });
        } catch (error) {
            console.error('獲取可靠度狀態失敗:', error);
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
            
            // v3.1.05: 優先使用 final_daily_predictions 的值（與預測波動分析一致）
            const finalPredResult = await db.pool.query(
                'SELECT * FROM final_daily_predictions WHERE target_date = $1',
                [targetDate]
            );
            
            if (finalPredResult.rows.length > 0) {
                const finalPred = finalPredResult.rows[0];
                const smoothingDetails = finalPred.smoothing_details || {};
                const allMethods = smoothingDetails.allMethods || {};
                const recommended = smoothingDetails.recommended || {
                    value: finalPred.predicted_count,
                    method: finalPred.smoothing_method || 'ensembleMeta',
                    reason: '來自 final_daily_predictions'
                };
                
                // 構建完整的結果結構（與實時計算格式一致）
                const results = {
                    simpleAverage: { value: allMethods.simpleAverage || finalPred.predicted_count },
                    ewma: { value: allMethods.ewma || finalPred.predicted_count },
                    confidenceWeighted: { value: allMethods.confidenceWeighted || finalPred.predicted_count },
                    timeWindowWeighted: { value: allMethods.timeWindowWeighted || finalPred.predicted_count },
                    trimmedMean: { value: allMethods.trimmedMean || finalPred.predicted_count },
                    varianceFiltered: { value: allMethods.varianceFiltered || finalPred.predicted_count },
                    kalman: { value: allMethods.kalman || finalPred.predicted_count },
                    ensembleMeta: { value: allMethods.ensembleMeta || finalPred.predicted_count },
                    stability: {
                        cv: finalPred.stability_cv || 0.1,
                        confidenceLevel: finalPred.stability_level || 'medium'
                    },
                    smoothedCI: {
                        ci80: {
                            low: finalPred.ci80_low,
                            high: finalPred.ci80_high
                        },
                        ci95: {
                            low: finalPred.ci95_low,
                            high: finalPred.ci95_high
                        }
                    },
                    rawStats: smoothingDetails.rawStats || {}
                };
                
                // v3.0.38: 使用 OptimalDailyPredictionSelector 選擇最佳每日預測
                let optimalResult = null;
                try {
                    const predictions = await db.getDailyPredictions(targetDate);
                    if (predictions.length > 0) {
                        const { getOptimalSelector } = require('./modules/pragmatic-bayesian');
                        const selector = getOptimalSelector();
                        optimalResult = selector.selectBest(predictions);
                    }
                } catch (e) {
                    console.log('⚠️ OptimalDailyPredictionSelector 不可用:', e.message);
                }
                
                sendJson(res, {
                    success: true,
                    targetDate: targetDate,
                    predictionCount: finalPred.prediction_count || 0,
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
                    recommended: recommended,
                    optimal: optimalResult,
                    source: 'final_daily_predictions' // 標記數據來源
                });
                return;
            }
            
            // 如果沒有 final_daily_predictions，回退到實時計算
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
            
            // v3.0.38: 使用 OptimalDailyPredictionSelector 選擇最佳每日預測
            let optimalResult = null;
            try {
                const { getOptimalSelector } = require('./modules/pragmatic-bayesian');
                const selector = getOptimalSelector();
                optimalResult = selector.selectBest(predictions);
            } catch (e) {
                console.log('⚠️ OptimalDailyPredictionSelector 不可用:', e.message);
            }
            
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
                recommended: recommended,
                optimal: optimalResult  // v3.0.38: 最佳每日預測選擇結果
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
            
            // 2. 訓練指標：從數據庫或文件讀取（模型的「潛力」）
            let trainingMetrics = null;
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
                    trainingMetrics = metrics;
                    details.trainingMAE = metrics.mae;
                    details.trainingMAPE = metrics.mape;
                    details.trainingRMSE = metrics.rmse;
                    details.trainingR2 = metrics.r2 || null;
                    details.trainingDate = metrics.training_date;
                    details.featureCount = metrics.feature_count;
                } else {
                    details.modelExists = false;
                    details.metricsSource = 'none';
                }
            } catch (e) {
                console.warn('訓練指標讀取失敗:', e.message);
                details.modelExists = false;
            }

            // 3. 實時誤差：基於最近實際預測 vs 實際數據
            let liveMAE = null;
            let liveMAPE = null;
            let liveRMSE = null;

            if (db && db.pool) {
                try {
                    const errorResult = await db.pool.query(`
                        SELECT
                            AVG(ABS(dp.predicted_count - ad.patient_count)) as mae,
                            AVG(ABS(dp.predicted_count - ad.patient_count) * 100.0 / NULLIF(ad.patient_count, 0)) as mape,
                            STDDEV(dp.predicted_count - ad.patient_count) as rmse,
                            COUNT(*) as count,
                            MIN(dp.target_date) as from_date,
                            MAX(dp.target_date) as to_date
                        FROM daily_predictions dp
                        JOIN actual_data ad ON dp.target_date = ad.date
                        WHERE dp.target_date >= CURRENT_DATE - INTERVAL '14 days'
                        AND ad.patient_count IS NOT NULL
                    `);

                    if (errorResult.rows[0].count > 0) {
                        liveMAE = parseFloat(errorResult.rows[0].mae);
                        liveMAPE = parseFloat(errorResult.rows[0].mape);
                        liveRMSE = parseFloat(errorResult.rows[0].rmse) || null;
                        details.liveMAE = liveMAE;
                        details.liveMAPE = liveMAPE;
                        details.liveRMSE = liveRMSE;
                        details.liveComparisonCount = parseInt(errorResult.rows[0].count);
                        details.liveFromDate = errorResult.rows[0].from_date;
                        details.liveToDate = errorResult.rows[0].to_date;
                    }
                } catch (e) {
                    console.warn('實時誤差計算失敗:', e.message);
                }
            }

            // 4. 模型擬合度：優先使用實時誤差，否則使用訓練指標
            if (liveMAE !== null && liveMAPE !== null) {
                // 使用實時誤差計算
                const NAIVE_MAE = 18.3;
                const mase = liveMAE / NAIVE_MAE;

                let skillScore;
                if (mase <= 0.5) {
                    skillScore = 100;
                } else if (mase < 1.0) {
                    skillScore = Math.round(100 - (mase - 0.5) * 100);
                } else if (mase < 1.5) {
                    skillScore = Math.round(50 - (mase - 1.0) * 100);
                } else {
                    skillScore = 0;
                }

                let mapeScore;
                if (liveMAPE < 5) mapeScore = 100;
                else if (liveMAPE < 8) mapeScore = 85;
                else if (liveMAPE < 10) mapeScore = 70;
                else if (liveMAPE < 12) mapeScore = 60;
                else if (liveMAPE < 15) mapeScore = 50;
                else mapeScore = Math.max(0, 40 - (liveMAPE - 15) * 2);

                modelFit = Math.round(skillScore * 0.6 + mapeScore * 0.4);
                details.fitSource = 'live';
                details.mase = parseFloat(mase.toFixed(3));
                details.skillScore = skillScore;
                details.naiveMAE = NAIVE_MAE;
            } else if (trainingMetrics) {
                // 回退到訓練指標
                const NAIVE_MAE = 18.3;
                const mase = trainingMetrics.mae / NAIVE_MAE;

                let skillScore;
                if (mase <= 0.5) {
                    skillScore = 100;
                } else if (mase < 1.0) {
                    skillScore = Math.round(100 - (mase - 0.5) * 100);
                } else if (mase < 1.5) {
                    skillScore = Math.round(50 - (mase - 1.0) * 100);
                } else {
                    skillScore = 0;
                }

                let mapeScore;
                if (trainingMetrics.mape < 5) mapeScore = 100;
                else if (trainingMetrics.mape < 8) mapeScore = 85;
                else if (trainingMetrics.mape < 10) mapeScore = 70;
                else if (trainingMetrics.mape < 12) mapeScore = 60;
                else if (trainingMetrics.mape < 15) mapeScore = 50;
                else mapeScore = Math.max(0, 40 - (trainingMetrics.mape - 15) * 2);

                modelFit = Math.round(skillScore * 0.6 + mapeScore * 0.4);
                details.fitSource = 'training';
                details.mase = parseFloat(mase.toFixed(3));
                details.skillScore = skillScore;
                details.naiveMAE = NAIVE_MAE;
            } else {
                modelFit = 0;
                details.fitSource = 'none';
            }

            // 5. 近期準確度（保留向後兼容）
            recentAccuracy = liveMAPE !== null ? Math.round(100 - liveMAPE) : (trainingMetrics ? Math.round(100 - trainingMetrics.mape) : 85);
            
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
    },
    
    // ============================================
    // Dual-Track Prediction System API (v3.0.82)
    // ============================================
    
    // Get dual-track summary
    // v3.0.87: 使用正確的欄位名稱，處理缺失欄位
    'GET /api/dual-track/summary': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);
        
        try {
            // 首先檢查欄位是否存在
            let hasColumns = false;
            try {
                await db.pool.query(`SELECT prediction_production FROM daily_predictions LIMIT 1`);
                hasColumns = true;
            } catch (e) {
                // 欄位不存在，嘗試創建
                try {
                    await db.pool.query(`ALTER TABLE daily_predictions ADD COLUMN IF NOT EXISTS prediction_production DECIMAL(10,2)`);
                    await db.pool.query(`ALTER TABLE daily_predictions ADD COLUMN IF NOT EXISTS prediction_experimental DECIMAL(10,2)`);
                    await db.pool.query(`ALTER TABLE daily_predictions ADD COLUMN IF NOT EXISTS xgboost_base DECIMAL(10,2)`);
                    await db.pool.query(`ALTER TABLE daily_predictions ADD COLUMN IF NOT EXISTS ai_factor DECIMAL(5,3)`);
                    await db.pool.query(`ALTER TABLE daily_predictions ADD COLUMN IF NOT EXISTS weather_factor DECIMAL(5,3)`);
                    hasColumns = true;
                    console.log('✅ 雙軌欄位已創建');
                } catch (err) {
                    console.warn('⚠️ 無法創建雙軌欄位:', err.message);
                }
            }
            
            // Get today's prediction
            const today = getHKTDate();
            
            // v3.1.05: 優先使用 final_daily_predictions 的值（與綜合預測一致）
            const finalPredResult = await db.pool.query(
                'SELECT * FROM final_daily_predictions WHERE target_date = $1',
                [today]
            );
            
            // 獲取 daily_predictions 中的 AI 因子和 XGBoost 基礎值
            let aiFactor = 1.0;
            let xgbBase = null;
            let weatherFactor = 1.0;
            if (hasColumns) {
                const dailyPredResult = await db.pool.query(`
                    SELECT xgboost_base, ai_factor, weather_factor
                    FROM daily_predictions
                    WHERE target_date = $1
                    ORDER BY created_at DESC
                    LIMIT 1
                `, [today]);
                if (dailyPredResult.rows.length > 0) {
                    xgbBase = parseFloat(dailyPredResult.rows[0].xgboost_base);
                    aiFactor = parseFloat(dailyPredResult.rows[0].ai_factor) || 1.0;
                    weatherFactor = parseFloat(dailyPredResult.rows[0].weather_factor) || 1.0;
                }
            }
            
            // 獲取當前可靠度權重
            let reliability = { xgboost_reliability: 0.95, ai_reliability: 0.00, weather_reliability: 0.05 };
            try {
                const relState = await db.getReliabilityState();
                if (relState) reliability = relState;
            } catch (error) {
                console.error('[Server] Error getting reliability state:', error.message);
            }
            
            let todayPrediction = null;
            
            if (finalPredResult.rows.length > 0) {
                // v3.1.05: 使用 final_daily_predictions 的值作為 Production（與綜合預測一致）
                const finalPred = finalPredResult.rows[0];
                const prodPred = parseInt(finalPred.predicted_count);
                
                // 計算 Experimental：基於 Production + AI 影響
                // 如果沒有 xgbBase，使用 prodPred 作為基礎
                const baseForExp = xgbBase || prodPred;
                let expPred = prodPred;
                if (aiFactor !== 1.0) {
                    // Experimental = Production + AI 影響
                    // AI 影響 = (aiFactor - 1.0) * base * w_ai (0.10)
                    const aiImpact = (aiFactor - 1.0) * baseForExp * 0.10;
                    expPred = Math.round(prodPred + aiImpact);
                }
                
                todayPrediction = {
                    date: today,
                    xgboost_base: xgbBase ? Math.round(xgbBase) : prodPred,
                    production: {
                        prediction: prodPred,
                        weights: { 
                            w_base: parseFloat(reliability.xgboost_reliability) || 0.95, 
                            w_weather: parseFloat(reliability.weather_reliability) || 0.05, 
                            w_ai: 0.00 
                        },
                        ci80: { 
                            low: parseInt(finalPred.ci80_low) || Math.round(prodPred - 8), 
                            high: parseInt(finalPred.ci80_high) || Math.round(prodPred + 8) 
                        }
                    },
                    experimental: {
                        prediction: expPred,
                        weights: { 
                            w_base: Math.max(0.70, parseFloat(reliability.xgboost_reliability) - 0.10), 
                            w_weather: parseFloat(reliability.weather_reliability) || 0.05, 
                            w_ai: Math.min(0.20, parseFloat(reliability.ai_reliability) + 0.10) 
                        },
                        ci80: { 
                            low: Math.round(expPred - 8), 
                            high: Math.round(expPred + 8) 
                        }
                    },
                    aiImpact: aiFactor !== 1.0 ? 
                        `${((aiFactor - 1) * 100).toFixed(1)}%` : 'None'
                };
            } else if (hasColumns) {
                // Fallback: 使用 daily_predictions 的值
                const query = `
                    SELECT 
                        target_date,
                        predicted_count,
                        prediction_production,
                        prediction_experimental,
                        xgboost_base,
                        ai_factor,
                        weather_factor,
                        ci80_low,
                        ci80_high
                    FROM daily_predictions
                    WHERE target_date = $1
                    ORDER BY created_at DESC
                    LIMIT 1
                `;
                const result = await db.pool.query(query, [today]);
                
                if (result.rows.length > 0 && result.rows[0].prediction_production !== null) {
                    const pred = result.rows[0];
                    const prodPred = parseFloat(pred.prediction_production);
                    const expPred = parseFloat(pred.prediction_experimental);
                    const xgbBase = parseFloat(pred.xgboost_base);
                    const aiFactor = parseFloat(pred.ai_factor) || 1.0;
                    
                    todayPrediction = {
                        date: today,
                        xgboost_base: Math.round(xgbBase),
                        production: {
                            prediction: Math.round(prodPred),
                            weights: { 
                                w_base: parseFloat(reliability.xgboost_reliability) || 0.95, 
                                w_weather: parseFloat(reliability.weather_reliability) || 0.05, 
                                w_ai: 0.00 
                            },
                            ci80: { 
                                low: pred.ci80_low || Math.round(prodPred - 8), 
                                high: pred.ci80_high || Math.round(prodPred + 8) 
                            }
                        },
                        experimental: {
                            prediction: Math.round(expPred),
                            weights: { 
                                w_base: Math.max(0.70, parseFloat(reliability.xgboost_reliability) - 0.10), 
                                w_weather: parseFloat(reliability.weather_reliability) || 0.05, 
                                w_ai: Math.min(0.20, parseFloat(reliability.ai_reliability) + 0.10) 
                            },
                            ci80: { 
                                low: Math.round(expPred - 8), 
                                high: Math.round(expPred + 8) 
                            }
                        },
                        aiImpact: aiFactor !== 1.0 ? 
                            `${((aiFactor - 1) * 100).toFixed(1)}%` : 'None'
                    };
                }
            }
            
            // 計算驗證統計（過去30天）
            let valStats = {
                sample_count: 0,
                prod_mae: null,
                exp_mae: null,
                prod_wins: 0,
                exp_wins: 0,
                ties: 0
            };
            try {
                // v4.0.14: 計算雙軌驗證統計
                const validationQuery = hasColumns ? `
                    WITH comparison_data AS (
                        SELECT
                            dp.target_date,
                            dp.predicted_count as production_pred,
                            dp.prediction_experimental as experimental_pred,
                            ad.patient_count as actual
                        FROM daily_predictions dp
                        INNER JOIN actual_data ad ON ad.date = dp.target_date
                        WHERE dp.target_date >= CURRENT_DATE - INTERVAL '30 days'
                          AND ad.patient_count IS NOT NULL
                    )
                    SELECT
                        COUNT(*) as sample_count,
                        AVG(ABS(production_pred - actual)) as prod_mae,
                        AVG(ABS(experimental_pred - actual)) as exp_mae,
                        SUM(CASE WHEN ABS(production_pred - actual) < ABS(experimental_pred - actual) THEN 1 ELSE 0 END) as prod_wins,
                        SUM(CASE WHEN ABS(experimental_pred - actual) < ABS(production_pred - actual) THEN 1 ELSE 0 END) as exp_wins,
                        SUM(CASE WHEN ABS(production_pred - actual) = ABS(experimental_pred - actual) THEN 1 ELSE 0 END) as ties
                    FROM comparison_data
                ` : `
                    SELECT 0 as sample_count, NULL::float as prod_mae, NULL::float as exp_mae, 0 as prod_wins, 0 as exp_wins, 0 as ties
                `;
                const valResult = await db.pool.query(validationQuery);
                if (valResult.rows.length > 0) {
                    valStats = { ...valStats, ...valResult.rows[0] };
                }
            } catch (e) {
                console.warn('⚠️ 驗證統計查詢失敗:', e.message);
            }

            // 計算改進百分比和勝率
            let mae_improvement_pct = '--';
            let win_rate_pct = '--';

            if (valStats.sample_count > 0) {
                const prodMae = parseFloat(valStats.prod_mae) || 0;
                const expMae = parseFloat(valStats.exp_mae) || 0;
                const totalComparisons = valStats.prod_wins + valStats.exp_wins + valStats.ties;

                // 改進百分比 (Exp 比 Prod 好多少)
                if (prodMae > 0 && expMae > 0) {
                    const improvement = ((prodMae - expMae) / prodMae) * 100;
                    mae_improvement_pct = (improvement > 0 ? '+' : '') + improvement.toFixed(1) + '%';
                }

                // 勝率 (Exp 勝的比例)
                if (totalComparisons > 0) {
                    win_rate_pct = ((valStats.exp_wins / totalComparisons) * 100).toFixed(1) + '%';
                }
            }

            const validation = {
                total_comparisons: parseInt(valStats.sample_count) || 0,
                prod_mae: valStats.prod_mae ? parseFloat(valStats.prod_mae).toFixed(1) : '--',
                exp_mae: valStats.exp_mae ? parseFloat(valStats.exp_mae).toFixed(1) : '--',
                mae_improvement_pct: mae_improvement_pct,
                win_rate_pct: win_rate_pct,
                prod_wins: parseInt(valStats.prod_wins) || 0,
                exp_wins: parseInt(valStats.exp_wins) || 0,
                recommendation: valStats.sample_count >= 30 ?
                    (parseFloat(mae_improvement_pct) < 0 ? 'Experimental 表現較佳，考慮切換' : 'Production 表現穩定，繼續觀察') :
                    `需要 ${30 - (valStats.sample_count || 0)} 天更多數據`
            };
            
            sendJson(res, {
                success: true,
                today: todayPrediction,
                validation: validation,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('❌ Dual-track summary error:', error);
            sendJson(res, { success: false, error: error.message }, 500);
        }
    },
    
    // Get validation history for chart
    'GET /api/dual-track/history': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);

        try {
            const query = `
                SELECT
                    target_date,
                    production_error,
                    experimental_error
                FROM daily_predictions
                WHERE validation_date IS NOT NULL
                  AND target_date >= CURRENT_DATE - INTERVAL '90 days'
                ORDER BY target_date
            `;

            const result = await db.pool.query(query);

            const dates = result.rows.map(r => r.target_date);
            const productionErrors = result.rows.map(r => parseFloat(r.production_error));
            const experimentalErrors = result.rows.map(r => parseFloat(r.experimental_error));

            sendJson(res, {
                success: true,
                dates,
                productionErrors,
                experimentalErrors
            });

        } catch (error) {
            console.error('❌ Validation history error:', error);
            sendJson(res, { success: false, error: error.message }, 500);
        }
    },
    
    // Validate prediction when actual data arrives
    'POST /api/dual-track/validate': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);
        
        try {
            const data = await parseBody(req);
            const { date, actualAttendance } = data;
            
            if (!date || !actualAttendance) {
                return sendJson(res, { error: 'Missing date or actualAttendance' }, 400);
            }
            
            const DualTrackPredictor = require('./modules/dual-track-predictor');
            const dualTrack = new DualTrackPredictor(db.pool);
            
            const validationResult = await dualTrack.validatePrediction(date, actualAttendance);
            
            sendJson(res, {
                success: true,
                validation: validationResult
            });
            
        } catch (error) {
            console.error('❌ Validation error:', error);
            sendJson(res, { success: false, error: error.message }, 500);
        }
    },
    
    // Trigger weight optimization
    'POST /api/dual-track/optimize': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);
        
        try {
            const { spawn } = require('child_process');
            
            // Run optimization script asynchronously
            const process = spawn('python', ['python/optimize_bayesian_weights_adaptive.py']);
            
            let output = '';
            let errorOutput = '';
            
            process.stdout.on('data', (data) => {
                output += data.toString();
            });
            
            process.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });
            
            process.on('close', (code) => {
                if (code === 0) {
                    console.log('✅ Weight optimization completed:', output);
                } else {
                    console.error('❌ Weight optimization failed:', errorOutput);
                }
            });
            
            // Respond immediately (optimization runs in background)
            sendJson(res, {
                success: true,
                message: 'Weight optimization triggered. Results will be available in ~30 seconds.'
            });
            
        } catch (error) {
            console.error('❌ Optimization trigger error:', error);
            sendJson(res, { success: false, error: error.message }, 500);
        }
    },

    // ============================================================
    // v4.0.00: Continuous Learning System API Endpoints
    // ============================================================

    // 獲取學習系統摘要
    'GET /api/learning/summary': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);
        try {
            await Promise.race([
                (async () => {
                    const result = await db.pool.query(`SELECT * FROM learning_system_status`);
                    const avgR = await db.pool.query(`SELECT COALESCE(ROUND(AVG(ABS(prediction_error))::numeric, 2), 0)::float AS a FROM learning_records WHERE prediction_error IS NOT NULL`);
                    const weatherImpacts = await db.pool.query(`SELECT * FROM current_weather_impacts ORDER BY ABS(parameter_value) DESC LIMIT 10`);
                    const recentAnomalies = await db.pool.query(`SELECT date, actual_attendance, final_prediction, prediction_error, is_very_cold, is_heavy_rain, ai_event_type FROM learning_records WHERE is_anomaly = TRUE ORDER BY date DESC LIMIT 10`);
                    const status = result.rows[0] || {};
                    const avgErr = parseFloat(avgR.rows[0]?.a) || 0;
                    sendJson(res, { success: true, data: { total_learning_days: status.total_records || 0, average_error: avgErr, anomaly_count: status.total_anomalies || 0, last_learning_date: status.last_learning_date || null } });
                })(),
                new Promise((_, r) => setTimeout(() => r(new Error('REQUEST_TIMEOUT')), 20000))
            ]);
        } catch (error) {
            if (error.message === 'REQUEST_TIMEOUT' && !res.headersSent) return sendJson(res, { success: false, error: 'Request timeout' }, 503);
            console.error('❌ Learning summary error:', error);
            if (error.code === '42P01' || (error.message && error.message.includes('does not exist'))) {
                return sendJson(res, { success: true, data: { total_learning_days: 0, average_error: 0, anomaly_count: 0, last_learning_date: null } });
            }
            sendJson(res, { success: false, error: error.message }, 500);
        }
    },

    // 獲取當前天氣影響參數
    'GET /api/learning/weather-impacts': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);
        try {
            await Promise.race([
                (async () => {
                    const result = await db.pool.query(`SELECT * FROM current_weather_impacts ORDER BY ABS(parameter_value) DESC`);
                    sendJson(res, { success: true, data: { parameters: result.rows } });
                })(),
                new Promise((_, r) => setTimeout(() => r(new Error('REQUEST_TIMEOUT')), 20000))
            ]);
        } catch (error) {
            if (error.message === 'REQUEST_TIMEOUT' && !res.headersSent) return sendJson(res, { success: false, error: 'Request timeout' }, 503);
            console.error('❌ Weather impacts error:', error);
            if (error.code === '42P01' || (error.message && error.message.includes('does not exist'))) {
                return sendJson(res, { success: true, data: { parameters: [] } });
            }
            sendJson(res, { success: false, error: error.message }, 500);
        }
    },

    // 獲取異常列表
    'GET /api/learning/anomalies': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);
        const limit = parseInt(req.query && req.query.limit) || 30;
        const offset = parseInt(req.query && req.query.offset) || 0;
        try {
            await Promise.race([
                (async () => {
                    const result = await db.pool.query(`SELECT date, actual_attendance, final_prediction, prediction_error, error_pct, is_very_cold, is_very_hot, is_heavy_rain, is_strong_wind, ai_event_type, ai_factor, COALESCE(ai_event_type, '未知')::text as anomaly_type FROM learning_records WHERE is_anomaly = TRUE ORDER BY date DESC LIMIT $1 OFFSET $2`, [limit, offset]);
                    const countResult = await db.pool.query(`SELECT COUNT(*) FROM learning_records WHERE is_anomaly = TRUE`);
                    sendJson(res, { success: true, data: { anomalies: result.rows, total: parseInt(countResult.rows[0].count, 10), limit, offset } });
                })(),
                new Promise((_, r) => setTimeout(() => r(new Error('REQUEST_TIMEOUT')), 20000))
            ]);
        } catch (error) {
            if (error.message === 'REQUEST_TIMEOUT' && !res.headersSent) return sendJson(res, { success: false, error: 'Request timeout' }, 503);
            console.error('❌ Anomalies error:', error);
            if (error.code === '42P01' || error.code === '42703' || (error.message && /does not exist|relation.*does not exist/i.test(String(error.message)))) {
                return sendJson(res, { success: true, data: { anomalies: [], total: 0, limit, offset } }, 200);
            }
            sendJson(res, { success: false, error: error.message }, 500);
        }
    },

    // 獲取 AI 事件學習摘要
    'GET /api/learning/ai-events': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);
        try {
            await Promise.race([
                (async () => {
                    const result = await db.pool.query(`SELECT * FROM ai_learning_summary ORDER BY total_occurrences DESC`);
                    sendJson(res, { success: true, data: { events: result.rows } });
                })(),
                new Promise((_, r) => setTimeout(() => r(new Error('REQUEST_TIMEOUT')), 20000))
            ]);
        } catch (error) {
            if (error.message === 'REQUEST_TIMEOUT' && !res.headersSent) return sendJson(res, { success: false, error: 'Request timeout' }, 503);
            console.error('❌ AI events error:', error);
            if (error.code === '42P01' || (error.message && error.message.includes('does not exist'))) {
                return sendJson(res, { success: true, data: { events: [] } });
            }
            sendJson(res, { success: false, error: error.message }, 500);
        }
    },

    // 獲取天氣組合影響
    'GET /api/learning/combinations': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);

        try {
            const result = await db.pool.query(`
                SELECT
                    conditions_json->>'condition' as condition_name,
                    sample_count,
                    mean_attendance,
                    baseline_mean,
                    impact_factor,
                    impact_absolute,
                    t_statistic,
                    is_significant
                FROM weather_combination_impacts
                WHERE sample_count >= 5
                ORDER BY ABS(impact_absolute) DESC
            `);

            sendJson(res, {
                success: true,
                combinations: result.rows
            });
        } catch (error) {
            console.error('❌ Combinations error:', error);
            sendJson(res, { success: false, error: error.message }, 500);
        }
    },

    // 觸發手動學習更新
    'POST /api/learning/update': async (req, res) => {
        const { spawn } = require('child_process');

        try {
            const body = await parseBody(req).catch(() => ({}));
            const { type = 'daily' } = body || {};
            const effectiveType = (type === 'all') ? 'daily' : type;

            let script;
            if (effectiveType === 'daily') {
                script = 'continuous_learner.py';
            } else if (effectiveType === 'weekly') {
                script = 'weather_impact_learner.py';
            } else if (effectiveType === 'anomaly') {
                script = 'anomaly_detector.py';
            } else {
                return sendJson(res, { success: false, error: 'Invalid type. Use: daily, weekly, anomaly, or all' }, 400);
            }

            const scriptPath = path.join(__dirname, 'python', script);
            const py = process.env.PYTHON || 'python3';
            const args = [scriptPath];
            if (effectiveType === 'daily') args.push('--catch-up');
            const python = spawn(py, args, { cwd: __dirname });

            python.on('error', (err) => {
                console.error(`❌ Learning update spawn error: ${err.message}`);
            });

            let output = '';
            python.stdout.on('data', (data) => { output += data.toString(); });

            python.on('close', (code) => {
                if (code === 0) {
                    console.log(`✅ Learning update (${effectiveType}) complete:`, output);
                } else {
                    console.error(`❌ Learning update (${effectiveType}) failed (code ${code})`);
                }
            });

            sendJson(res, {
                success: true,
                message: `${effectiveType} learning update triggered`,
                script
            });

        } catch (error) {
            console.error('❌ Learning update error:', error);
            sendJson(res, { success: false, error: error.message }, 500);
        }
    },

    // 獲取天氣預報預測
    'GET /api/learning/forecast-prediction': async (req, res) => {
        if (!db || !db.pool) return sendJson(res, { error: 'Database not configured' }, 503);

        try {
            const { date } = req.query;
            const targetDate = date || new Date().toISOString().split('T')[0];

            // 從緩存獲取預報
            const result = await db.pool.query(`
                SELECT
                    forecast_date,
                    temp_min_forecast,
                    temp_max_forecast,
                    rain_prob_forecast,
                    weather_desc,
                    predicted_impact_absolute,
                    confidence_level
                FROM weather_forecast_cache
                WHERE forecast_date = $1
                ORDER BY fetch_date DESC
                LIMIT 1
            `, [targetDate]);

            if (result.rows.length === 0) {
                return sendJson(res, {
                    success: true,
                    message: 'No forecast data available',
                    date: targetDate
                });
            }

            sendJson(res, {
                success: true,
                forecast: result.rows[0],
                date: targetDate
            });

        } catch (error) {
            console.error('❌ Forecast prediction error:', error);
            sendJson(res, { success: false, error: error.message }, 500);
        }
    },

    // 獲取學習調度器狀態
    'GET /api/learning/scheduler-status': async (req, res) => {
        try {
            await Promise.race([
                (async () => {
                    let getScheduler;
                    try {
                        ({ getScheduler } = require('./modules/learning-scheduler'));
                    } catch (moduleError) {
                        sendJson(res, { success: true, data: { is_running: false, scheduler_active: false, scheduled_tasks: 0, last_run_time: null, run_count: 0, tasks: [], next_run: '未配置', error: 'Scheduler module not loaded' } });
                        return;
                    }
                    const scheduler = getScheduler();
                    const status = scheduler.getStatus();
                    let lastRunTime = status.lastRunTime || null;
                    // 若記憶體無上次執行，以 learning_records 最後一筆作 fallback（重啟後仍能顯示）
                    if (!lastRunTime && db && db.pool) {
                        try {
                            const r = await db.pool.query('SELECT MAX(created_at) AS t FROM learning_records');
                            if (r.rows[0] && r.rows[0].t) lastRunTime = r.rows[0].t;
                        } catch (_) {}
                    }
                    const schedulerActive = (status.scheduledTasks || status.tasks?.length || 0) > 0;
                    sendJson(res, { success: true, data: { is_running: status.isRunning || false, scheduler_active: schedulerActive, scheduled_tasks: status.scheduledTasks || status.tasks?.length || 0, last_run_time: lastRunTime, run_count: status.runCount || 0, tasks: status.tasks || [], next_run: '每日 00:30 HKT' } });
                })(),
                new Promise((_, r) => setTimeout(() => r(new Error('REQUEST_TIMEOUT')), 20000))
            ]);
        } catch (error) {
            if (error.message === 'REQUEST_TIMEOUT' && !res.headersSent) return sendJson(res, { success: false, error: 'Request timeout' }, 503);
            console.error('❌ Scheduler status error:', error);
            sendJson(res, { success: true, data: { is_running: false, scheduler_active: false, scheduled_tasks: 0, last_run_time: null, run_count: 0, tasks: [], next_run: '每日 00:30 HKT' } });
        }
    },

    // 手動觸發調度器任務
    'POST /api/learning/scheduler-run': async (req, res) => {
        const { getScheduler } = require('./modules/learning-scheduler');

        try {
            const body = await parseBody(req).catch(() => ({}));
            const { task = 'daily' } = body || {};
            const scheduler = getScheduler();

            if (task === 'daily') {
                scheduler.runDailyLearning();
            } else if (task === 'weekly') {
                scheduler.runWeeklyLearning();
            } else if (task === 'forecast') {
                await scheduler.cacheWeatherForecast();
            } else {
                return sendJson(res, { success: false, error: 'Invalid task. Use: daily, weekly, or forecast' }, 400);
            }

            sendJson(res, {
                success: true,
                message: `Scheduler task '${task}' triggered`
            });

        } catch (error) {
            console.error('❌ Scheduler run error:', error);
            sendJson(res, { success: false, error: error.message }, 500);
        }
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
        req.query = parsedUrl.query || {};

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

        // v3.0.90: API fallback 保持 JSON，不再回退到 index.html
        if (pathname.startsWith('/api/')) {
            return sendJson(res, { success: false, error: 'API route not found', route: routeKey }, 404);
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
        
        // v3.0.69: 靜態資源快取策略
        const getCacheHeaders = (ext) => {
            // 可變更文件（使用版本號）- 1小時
            if (['.html', '.js', '.css'].includes(ext)) {
                return { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' };
            }
            // 圖片資源 - 7天
            if (['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif', '.ico'].includes(ext)) {
                return { 'Cache-Control': 'public, max-age=604800, immutable' };
            }
            // 字體資源 - 30天
            if (['.woff', '.woff2', '.ttf', '.eot'].includes(ext)) {
                return { 'Cache-Control': 'public, max-age=2592000, immutable' };
            }
            // JSON 配置 - 1小時
            if (ext === '.json') {
                return { 'Cache-Control': 'public, max-age=3600' };
            }
            // 預設 - 不快取
            return { 'Cache-Control': 'no-cache' };
        };
        
        // v3.0.83: 嘗試多個位置查找靜態文件
        const tryReadFile = (paths, index = 0) => {
            if (index >= paths.length) {
                // 所有路徑都找不到，返回 index.html (SPA fallback)
                fs.readFile(path.join(__dirname, 'index.html'), (err, content) => {
                    if (err) {
                        res.writeHead(500);
                        res.end('Server Error');
                    } else {
                        res.writeHead(200, { 
                            'Content-Type': 'text/html', 
                            'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
                            ...frameHeaders 
                        });
                        res.end(content, 'utf-8');
                    }
                });
                return;
            }
            
            fs.readFile(paths[index], (err, content) => {
                if (err) {
                    if (err.code === 'ENOENT') {
                        // 嘗試下一個路徑
                        tryReadFile(paths, index + 1);
                    } else {
                        res.writeHead(500);
                        res.end('Server Error');
                    }
                } else {
                    res.writeHead(200, { 
                        'Content-Type': contentType, 
                        ...getCacheHeaders(ext),
                        ...frameHeaders 
                    });
                    res.end(content, 'utf-8');
                }
            });
        };
        
        // 查找順序: 根目錄 -> public 資料夾
        const searchPaths = [
            fullPath,
            path.join(__dirname, 'public', filePath)
        ];
        tryReadFile(searchPaths);
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
    
    const dateStr = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
    const timeStr = `${getPart('hour')}:${getPart('minute')}:${getPart('second')}`;
    
    return {
        year: parseInt(getPart('year')),
        month: parseInt(getPart('month')),
        day: parseInt(getPart('day')),
        hour: parseInt(getPart('hour')),
        minute: parseInt(getPart('minute')),
        second: parseInt(getPart('second')),
        dateStr: dateStr,
        timeStr: timeStr,
        full: `${dateStr}T${timeStr}+08:00`  // v3.0.16: 添加完整的 ISO 時間字符串
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
// v3.0.65: 新增 source 參數區分自動預測 vs 手動刷新
// ============================================================
async function generateServerSidePredictions(source = 'auto') {
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
        
        // v3.3.01: 生成今天和未來 30 天的預測（已修復數據洩漏，長期預測更可靠）
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

        // v4.0.19: 載入香港公眾假期數據
        let holidaySet = new Set();
        try {
            const fs = require('fs');
            const holidayPath = path.join(__dirname, 'python/hk_public_holidays.json');
            if (fs.existsSync(holidayPath)) {
                const holidayData = JSON.parse(fs.readFileSync(holidayPath, 'utf8'));
                // 將所有年份的假期日期加入 Set
                for (const year in holidayData.holidays) {
                    for (const date of holidayData.holidays[year]) {
                        holidaySet.add(date);
                    }
                }
                console.log(`🎌 已載入 ${holidaySet.size} 個公眾假期日期`);
            }
        } catch (e) {
            console.log('⚠️ 無法載入假期數據:', e.message);
        }

        // 假期因子（基於歷史數據分析）
        const HOLIDAY_FACTOR = 0.92; // 假期平均減少 8% 求診人數

        // v4.0.21: 使用 Python XGBoost 滾動預測（真實歷史數據）
        // 一次性獲取所有 31 天的 XGBoost 基準預測
        let xgboostPredictions = {}; // { 'YYYY-MM-DD': prediction }
        let basePrediction = 249; // 默認值

        try {
            // 調用 Python 滾動預測腳本
            const { spawn } = require('child_process');
            const pythonScript = path.join(__dirname, 'python', 'rolling_predict.py');

            console.log(`🔄 調用 Python XGBoost 滾動預測 (31 天)...`);

            const pythonResult = await new Promise((resolve, reject) => {
                const python = spawn('python', [pythonScript, hk.dateStr, '31'], {
                    cwd: __dirname,
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                let output = '';
                let error = '';

                python.stdout.on('data', (data) => {
                    output += data.toString();
                });

                python.stderr.on('data', (data) => {
                    error += data.toString();
                    // 輸出進度信息
                    const msg = data.toString();
                    if (msg.includes('📊') || msg.includes('✅')) {
                        console.log(msg.trim());
                    }
                });

                python.on('close', (code) => {
                    if (code === 0) {
                        try {
                            resolve(JSON.parse(output));
                        } catch (e) {
                            reject(new Error(`無法解析 Python 輸出: ${e.message}`));
                        }
                    } else {
                        reject(new Error(`Python 錯誤 (code ${code}): ${error || output}`));
                    }
                });

                python.on('error', (err) => {
                    reject(new Error(`無法執行 Python: ${err.message}`));
                });
            });

            // 將預測結果轉換為 map
            if (pythonResult && pythonResult.predictions) {
                for (const pred of pythonResult.predictions) {
                    xgboostPredictions[pred.date] = pred.prediction;
                }
                console.log(`✅ XGBoost 滾動預測完成: ${Object.keys(xgboostPredictions).length} 天`);

                // 設置 Day 0 的基準預測
                if (xgboostPredictions[hk.dateStr]) {
                    basePrediction = xgboostPredictions[hk.dateStr];
                }
            }
        } catch (e) {
            console.error('❌ XGBoost 滾動預測失敗，使用備用方法:', e.message);

            // 備用方法：單日預測
            try {
                const baseResult = await ensemblePredictor.predict(hk.dateStr);
                if (baseResult && baseResult.prediction) {
                    basePrediction = baseResult.prediction;
                    xgboostPredictions[hk.dateStr] = basePrediction;
                }
            } catch (e2) {
                console.error('❌ 單日預測也失敗:', e2.message);
            }
        }

        // 如果沒有任何預測，使用歷史平均值
        if (Object.keys(xgboostPredictions).length === 0) {
            try {
                const statsResult = await db.pool.query(`
                    SELECT AVG(patient_count) as avg_count FROM actual_data
                    WHERE date >= CURRENT_DATE - INTERVAL '90 days'
                `);
                basePrediction = parseFloat(statsResult.rows[0]?.avg_count) || 249;
            } catch (e) {
                basePrediction = 249;
            }
        }

        console.log(`📊 XGBoost Day 0 預測: ${Math.round(basePrediction)} 人`);
        console.log(`📅 預測起始日期: ${hk.dateStr}`);

        // v3.3.01: 強制擴展到 30 天預測（Day 0-30）
        console.log('🔥 [FORCE-30DAY] 開始生成 30 天滾動預測...');
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
            
            // 應用天氣因素調整（只使用真實天氣預報數據）
            let weatherFactor = 1.0;
            let weatherInfo = null;
            if (weatherForecast[dateStr]) {
                weatherFactor = weatherForecast[dateStr].factor;
                weatherInfo = weatherForecast[dateStr];
            }
            // Day 10+ 沒有天氣預報數據，weatherFactor 保持 1.0

            // v4.0.19: 應用假期因子
            let holidayFactor = 1.0;
            let isHoliday = false;
            if (holidaySet.has(dateStr)) {
                holidayFactor = HOLIDAY_FACTOR;
                isHoliday = true;
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
            
            // 歷史星期均值（Post-COVID 2023-2025 實際數據）
            // 來源: AI-AED-Algorithm-Specification.txt - Post-COVID Baseline (2023-2025)
            // Mean: 253.8 ± 28, Monday: 270 ± 35, Saturday: 235 ± 32
            const dowMeans = { 0: 225, 1: 270, 2: 260, 3: 255, 4: 252, 5: 245, 6: 235 };
            const dowStds = { 0: 28, 1: 35, 2: 30, 3: 28, 4: 28, 5: 28, 6: 32 };
            // v3.0.85: 移除硬上限，改用異常標記
            // 歷史參考範圍（用於異常檢測，不再 clip）
            const NORMAL_MIN = 180;  // Post-COVID 歷史低值
            const NORMAL_MAX = 320;  // Post-COVID 95% CI 上限
            
            // 計算預測值
            let adjusted;
            let predictionMethod = 'multiplicative';
            let bayesianResult = null;
            
            // ============================================================
            // v4.0.21: 使用 Python XGBoost 滾動預測（真實歷史數據）
            // ============================================================
            // 獲取該日期的 XGBoost 基準預測
            let xgboostBase = xgboostPredictions[dateStr] || basePrediction;
            const targetMean = dowMeans[dow];

            if (daysAhead === 0) {
                // Day 0：XGBoost + Pragmatic Bayesian 融合
                try {
                    const { getPragmaticBayesian } = require('./modules/pragmatic-bayesian');
                    const bayesian = getPragmaticBayesian({
                        baseStd: dowStds[dow] || 15
                    });
                    bayesianResult = bayesian.predict(xgboostBase, aiFactor, weatherFactor);
                    adjusted = bayesianResult.prediction;

                    // 應用假期因子（乘法調整）
                    if (isHoliday) {
                        adjusted = Math.round(adjusted * holidayFactor);
                    }

                    predictionMethod = 'xgboost_bayesian';
                    console.log(`🎯 Day 0: XGBoost=${Math.round(xgboostBase)}, AI=${aiFactor.toFixed(2)}, Weather=${weatherFactor.toFixed(2)}${isHoliday ? ', 🎌假期' : ''} → ${adjusted}`);
                } catch (e) {
                    // Fallback
                    adjusted = Math.round(xgboostBase);
                    if (isHoliday) {
                        adjusted = Math.round(adjusted * holidayFactor);
                    }
                    predictionMethod = 'xgboost_fallback';
                }

            } else {
                // ============================================================
                // Day 1-30：混合預測策略（v4.0.25）
                // ============================================================
                // 問題：XGBoost 滾動預測在 Railway 可能失敗，導致使用固定 basePrediction
                // 解決：結合 XGBoost（如果有）+ 星期歷史均值 + 隨機擾動
                
                // 檢查是否有有效的 XGBoost 預測
                const hasValidXgboost = xgboostPredictions[dateStr] && xgboostPredictions[dateStr] !== basePrediction;
                
                // v4.0.25: 混合預測 = XGBoost + 星期均值
                // 如果 XGBoost 失敗，主要依賴星期均值
                let value;
                let xgbWeight;
                
                if (hasValidXgboost) {
                    // XGBoost 成功：逐漸降低權重
                    xgbWeight = daysAhead <= 7 ? 0.8 : Math.max(0.4, 0.8 - (daysAhead - 7) * 0.02);
                    value = xgboostBase * xgbWeight + targetMean * (1 - xgbWeight);
                } else {
                    // XGBoost 失敗：主要使用星期均值
                    xgbWeight = 0.2;
                    value = basePrediction * xgbWeight + targetMean * (1 - xgbWeight);
                }

                // 應用 AI 因素（加法調整，長期影響減弱）
                const aiWeight = daysAhead <= 7 ? 0.5 : Math.max(0.3, 0.5 - 0.01 * (daysAhead - 7));
                if (aiFactor !== 1.0) {
                    value += (aiFactor - 1.0) * targetMean * aiWeight;
                }

                // 應用天氣因素（加法調整，長期影響減弱）
                const weatherWeight = daysAhead <= 7 ? 0.3 : Math.max(0.15, 0.3 - 0.01 * (daysAhead - 7));
                if (weatherFactor !== 1.0) {
                    value += (weatherFactor - 1.0) * targetMean * weatherWeight;
                }

                // 應用月份效應
                value += (monthFactor - 1.0) * targetMean * 0.3;
                
                // v4.0.25: 添加隨機擾動模擬真實世界變化
                // 使用日期作為種子確保可重現
                const seed = parseInt(dateStr.replace(/-/g, '')) + daysAhead;
                const pseudoRandom = Math.sin(seed) * 10000 - Math.floor(Math.sin(seed) * 10000);
                const noiseStd = (dowStds[dow] || 28) * 0.4; // 40% 的歷史標準差
                const noise = (pseudoRandom - 0.5) * 2 * noiseStd;
                value += noise;

                adjusted = Math.round(value);
                predictionMethod = hasValidXgboost ? 'xgboost_hybrid' : 'dowmean_hybrid';

                // 應用假期因子（乘法調整）
                if (isHoliday) {
                    adjusted = Math.round(adjusted * holidayFactor);
                    predictionMethod += '_holiday';
                }
                
                // 確保在合理範圍內
                adjusted = Math.max(150, Math.min(350, adjusted));

                if (daysAhead <= 7 || daysAhead % 7 === 0) {
                    console.log(`📈 Day ${daysAhead}: XGB=${Math.round(xgboostBase)} (${hasValidXgboost ? 'valid' : 'fallback'}), Mean=${targetMean}, Weight=${(xgbWeight*100).toFixed(0)}%${isHoliday ? ', 🎌假期' : ''} → ${adjusted}`);
                }
            }

            // 置信區間：基於歷史標準差
            const baseStd = dowStds[dow];
            // 遠期預測不確定性增加
            const uncertaintyMultiplier = 1.0 + daysAhead * 0.03; // 每天增加 3%
            const std = baseStd * uncertaintyMultiplier;
            
            // v3.0.85: 異常檢測標記
            let anomaly = null;
            if (adjusted < NORMAL_MIN) {
                anomaly = { type: 'low', message: `預測值 ${adjusted} 低於歷史範圍 (${NORMAL_MIN})` };
            } else if (adjusted > NORMAL_MAX) {
                anomaly = { type: 'high', message: `預測值 ${adjusted} 高於歷史範圍 (${NORMAL_MAX})` };
            }
            
            // v3.0.91: 雙軌預測（與主預測一致）
            // Production = 主預測（不含 AI 因子）
            // Experimental = 主預測（含 AI 因子）
            // 這樣當 AI = 0 時，Production = Experimental = 主預測
            
            // adjusted 已經是最終預測（可能包含 AI）
            // 我們需要計算 "不含 AI" 版本
            
            let prodPrediction = adjusted;
            let expPrediction = adjusted;
            
            // 計算 AI 對預測的影響量
            const targetMeanForAI = dowMeans[dow] || 247;
            const aiImpact = aiFactor !== 1.0 ? (aiFactor - 1.0) * targetMeanForAI * 0.15 : 0;
            
            if (aiFactor !== 1.0) {
                // Production = 主預測 - AI 影響（即不含 AI 的預測）
                prodPrediction = Math.round(adjusted - aiImpact);
                // Experimental = 主預測（已含 AI）
                expPrediction = adjusted;
            } else {
                // AI = 1.0（無影響），兩者相同
                prodPrediction = adjusted;
                expPrediction = adjusted;
            }
            
            predictions.push({
                date: dateStr,
                predicted: adjusted,
                ci80: { low: Math.round(adjusted - 1.28 * std), high: Math.round(adjusted + 1.28 * std) },
                ci95: { low: Math.round(adjusted - 1.96 * std), high: Math.round(adjusted + 1.96 * std) },
                factors: {
                    dow: dowFactor,
                    month: monthFactor,
                    ai: aiFactor,
                    weather: weatherFactor,
                    holiday: holidayFactor  // v4.0.19: 假期因子
                },
                weatherInfo,
                aiInfo,
                isHoliday,  // v4.0.19: 是否假期
                anomaly,  // v3.0.85: 異常標記
                // v3.0.86: 雙軌數據
                dualTrack: {
                    xgboostBase: basePrediction,
                    production: prodPrediction,
                    experimental: expPrediction,
                    aiFactor: aiFactor,
                    weatherFactor: weatherFactor
                }
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
                
                // 準備 AI 因素數據（完整格式，包含 type、description 等欄位）
                let aiFactorsData = null;
                if (pred.aiInfo && pred.aiInfo.factors && pred.aiInfo.factors.length > 0) {
                    // 取第一個完整因素作為主要數據（兼容學習系統需要的格式）
                    const primaryFactor = pred.aiInfo.factors[0];
                    aiFactorsData = {
                        type: primaryFactor.type || '未知',
                        description: primaryFactor.description || '',
                        confidence: primaryFactor.confidence || '中',
                        impactFactor: primaryFactor.impactFactor || pred.factors.ai || 1.0
                    };
                }
                
                const result = await db.insertDailyPrediction(
                    pred.date,
                    pred.predicted,
                    pred.ci80,
                    pred.ci95,
                    MODEL_VERSION,
                    weatherData,
                    aiFactorsData,
                    source,  // v3.0.65: 傳遞來源類型
                    pred.dualTrack  // v3.0.86: 雙軌數據
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

// v3.0.83: 同步數據庫 metrics 與文件（取較新者）
async function syncModelMetricsFromFile() {
    try {
        const metricsPath = path.join(__dirname, 'python/models/xgboost_metrics.json');
        if (!fs.existsSync(metricsPath)) return;
        
        const fileMetrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
        const dbMetrics = await db.getModelMetrics('xgboost');
        
        const fileDate = fileMetrics.training_date ? new Date(fileMetrics.training_date) : new Date(0);
        const dbDate = dbMetrics?.training_date ? new Date(dbMetrics.training_date) : new Date(0);
        
        if (fileDate > dbDate) {
            console.log('📊 檢測到文件 metrics 較新，同步到數據庫...');
            await db.saveModelMetrics('xgboost', {
                mae: fileMetrics.mae,
                rmse: fileMetrics.rmse,
                mape: fileMetrics.mape,
                r2: fileMetrics.r2,
                training_date: fileMetrics.training_date,
                data_count: fileMetrics.data_count,
                train_count: fileMetrics.train_count,
                test_count: fileMetrics.test_count,
                feature_count: fileMetrics.feature_count,
                ai_factors_count: fileMetrics.ai_factors_count || 0
            });
            console.log('✅ Metrics 已同步: MAE=' + parseFloat(fileMetrics.mae).toFixed(2) + ', MAPE=' + parseFloat(fileMetrics.mape).toFixed(2) + '%');
        } else {
            console.log('📊 數據庫 metrics 是最新的: MAE=' + parseFloat(dbMetrics?.mae || 0).toFixed(2) + ', MAPE=' + parseFloat(dbMetrics?.mape || 0).toFixed(2) + '%');
        }
    } catch (e) {
        console.warn('⚠️ 同步 metrics 失敗:', e.message);
    }
}

server.listen(PORT, async () => {
    console.log(`🏥 NDH AED 預測系統運行於 http://localhost:${PORT}`);
    console.log(`📊 預測模型版本 ${MODEL_VERSION}`);
    if (db && db.pool) {
        console.log(`🗄️ PostgreSQL 數據庫已連接`);

        // v3.0.83: 同步 metrics
        await syncModelMetricsFromFile();

        // v2.9.90: 從數據庫載入自動預測統計
        await loadAutoPredictStatsFromDB();

        // 啟動定時任務
        scheduleDailyFinalPrediction();
        scheduleDailyStatsReset(); // 每日 00:00 重置自動預測統計
        scheduleAutoPredict(); // 每 30 分鐘自動預測（使用 XGBoost）

        // v4.0.00: 啟動學習調度器
        try {
            const { getScheduler } = require('./modules/learning-scheduler');
            const learningScheduler = getScheduler();
            learningScheduler.start();
            console.log(`📚 Learning Scheduler started`);
        } catch (e) {
            console.log(`⚠️ Learning Scheduler not available: ${e.message}`);
        }
    } else {
        console.log(`⚠️ 數據庫未配置 (設置 DATABASE_URL 或 PGHOST/PGUSER/PGPASSWORD/PGDATABASE 環境變數以啟用)`);
    }
});


