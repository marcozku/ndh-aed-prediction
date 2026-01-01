const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3001;
const MODEL_VERSION = '2.9.21';

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
        const today = new Date().toISOString().split('T')[0];
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
        const targetDate = data.target_date || new Date().toISOString().split('T')[0];
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
                            notes: `從網頁上傳的 CSV 數據 (${new Date().toISOString()})`
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
                            notes: `從網頁上傳的 CSV 數據 (${new Date().toISOString()})`
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
                timestamp: new Date().toISOString()
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
                timestamp: new Date().toISOString()
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
                timestamp: new Date().toISOString()
            });
        } catch (err) {
            sendJson(res, { 
                success: false,
                connected: false,
                error: err.message 
            }, 500);
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
            const status = predictor.getModelStatus();
            
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
    
    // 診斷模型文件（詳細檢查）
    'GET /api/model-diagnostics': async (req, res) => {
        try {
            const { EnsemblePredictor } = require('./modules/ensemble-predictor');
            const predictor = new EnsemblePredictor();
            const status = predictor.getModelStatus();
            
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
        res.write(`data: ${JSON.stringify({ message: 'SSE 連接成功', timestamp: new Date().toISOString() })}\n\n`);
        
        try {
            const { getAutoTrainManager } = require('./modules/auto-train-manager');
            const trainManager = getAutoTrainManager();
            
            // 將此響應對象註冊為 SSE 客戶端
            trainManager.addSSEClient(res);
            
            // 保持連接活躍（每 30 秒發送心跳）
            const heartbeat = setInterval(() => {
                if (!res.writableEnded) {
                    res.write(`event: heartbeat\n`);
                    res.write(`data: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
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
            lastUpdated: new Date().toISOString()
        };
        sendJson(res, apiDocs);
    },

    // System Status
    'GET /api/status': async (req, res) => {
        const status = {
            version: '2.9.10',
            database: db && db.pool ? 'connected' : 'disconnected',
            ai: aiService ? 'available' : 'unavailable',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            timestamp: new Date().toISOString()
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
            
            // 2. 模型擬合度：基於 XGBoost 模型指標
            try {
                const fs = require('fs');
                const path = require('path');
                const metricsPath = path.join(__dirname, 'python/models/xgboost_metrics.json');
                
                if (fs.existsSync(metricsPath)) {
                    const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
                    
                    // MAE 評分：MAE < 5 = 100分，每增加1 -10分
                    const maeScore = Math.max(0, 100 - (metrics.mae - 5) * 10);
                    // MAPE 評分：MAPE < 2% = 100分，每增加1% -20分
                    const mapeScore = Math.max(0, 100 - (metrics.mape - 2) * 20);
                    
                    modelFit = Math.round((maeScore + mapeScore) / 2);
                    
                    details.mae = metrics.mae;
                    details.mape = metrics.mape;
                    details.rmse = metrics.rmse;
                    details.trainingDate = metrics.training_date;
                    details.featureCount = metrics.feature_count;
                } else {
                    modelFit = 0;
                    details.modelExists = false;
                }
            } catch (e) {
                console.warn('模型指標讀取失敗:', e.message);
                modelFit = 50; // 預設值
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
                timestamp: new Date().toISOString()
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
                created: new Date().toISOString(),
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
// 伺服器端自動預測（每 30 分鐘執行一次，僅使用 XGBoost）
// ============================================================
async function generateServerSidePredictions() {
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
        
        // 生成今天和未來 7 天的預測
        const predictions = [];
        const today = new Date(`${hk.dateStr}T00:00:00+08:00`);
        
        for (let i = 0; i <= 7; i++) {
            const targetDate = new Date(today);
            targetDate.setDate(today.getDate() + i);
            const dateStr = targetDate.toISOString().split('T')[0];
            
            try {
                const result = await ensemblePredictor.predict(dateStr);
                if (result && result.prediction) {
                    predictions.push({
                        date: dateStr,
                        predicted: Math.round(result.prediction),
                        ci80: result.ci80 || { low: Math.round(result.prediction) - 32, high: Math.round(result.prediction) + 32 },
                        ci95: result.ci95 || { low: Math.round(result.prediction) - 49, high: Math.round(result.prediction) + 49 }
                    });
                } else {
                    console.error(`❌ ${dateStr} XGBoost 預測返回空結果`);
                }
            } catch (e) {
                console.error(`❌ ${dateStr} XGBoost 預測失敗:`, e.message);
            }
        }
        
        if (predictions.length === 0) {
            console.log('⚠️ 沒有成功的預測，跳過保存');
            return;
        }
        
        // 保存預測到數據庫
        let savedCount = 0;
        for (const pred of predictions) {
            try {
                await db.insertDailyPrediction(
                    pred.date,
                    pred.predicted,
                    pred.ci80,
                    pred.ci95,
                    MODEL_VERSION,
                    null, // weather_data
                    null  // ai_factors
                );
                savedCount++;
            } catch (err) {
                console.error(`❌ 保存 ${pred.date} 預測失敗:`, err.message);
            }
        }
        
        console.log(`✅ 伺服器端自動預測完成：已保存 ${savedCount}/${predictions.length} 筆預測（XGBoost）`);
        console.log(`   今日預測: ${predictions[0].predicted} 人 (${predictions[0].date})`);
        
    } catch (error) {
        console.error('❌ 伺服器端自動預測失敗:', error);
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

server.listen(PORT, () => {
    console.log(`🏥 NDH AED 預測系統運行於 http://localhost:${PORT}`);
    console.log(`📊 預測模型版本 ${MODEL_VERSION}`);
    if (db && db.pool) {
        console.log(`🗄️ PostgreSQL 數據庫已連接`);
        // 啟動定時任務
        scheduleDailyFinalPrediction();
        scheduleAutoPredict(); // 每 30 分鐘自動預測（使用 XGBoost）
    } else {
        console.log(`⚠️ 數據庫未配置 (設置 DATABASE_URL 或 PGHOST/PGUSER/PGPASSWORD/PGDATABASE 環境變數以啟用)`);
    }
});


