const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3001;
const MODEL_VERSION = '1.3.4';

// AI 服務（僅在服務器端使用）
let aiService = null;
try {
    aiService = require('./ai-service');
} catch (err) {
    console.warn('⚠️ AI 服務模組載入失敗（客戶端環境）:', err.message);
}

// Database connection (only if DATABASE_URL is set)
let db = null;
if (process.env.DATABASE_URL) {
    db = require('./database');
    db.initDatabase().then(async () => {
        // 數據庫初始化完成後，自動導入 CSV 數據
        const defaultCsvPath = '/Users/yoyoau/Library/Containers/net.whatsapp.WhatsApp/Data/tmp/documents/86448351-FEDA-406E-B465-B7D0B0753234/NDH_AED_Attendance_Minimal.csv';
        if (fs.existsSync(defaultCsvPath)) {
            console.log('📊 檢測到 CSV 文件，開始自動導入...');
            try {
                const { importCSVData } = require('./import-csv-data');
            const result = await importCSVData(defaultCsvPath, db);
            if (result.success) {
                console.log(`✅ 自動導入完成！成功導入 ${result.count} 筆數據`);
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
            } else {
                console.error(`❌ 自動導入失敗: ${result.error}`);
            }
            } catch (err) {
                console.error('❌ 自動導入 CSV 時出錯:', err.message);
            }
        }
    }).catch(err => {
        console.error('Failed to initialize database:', err.message);
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
    res.writeHead(statusCode, { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(data));
}

// API handlers
const apiHandlers = {
    // Upload actual data
    'POST /api/actual-data': async (req, res) => {
        if (!db) return sendJson(res, { error: 'Database not configured' }, 503);
        
        const data = await parseBody(req);
        if (Array.isArray(data)) {
            // Bulk upload
            const results = await db.insertBulkActualData(data);
            
            // Calculate accuracy for any dates that now have both prediction and actual
            for (const record of results) {
                await db.calculateAccuracy(record.date);
            }
            
            sendJson(res, { success: true, inserted: results.length, data: results });
        } else {
            // Single record
            const result = await db.insertActualData(data.date, data.patient_count, data.source, data.notes);
            await db.calculateAccuracy(data.date);
            sendJson(res, { success: true, data: result });
        }
    },

    // Get actual data
    'GET /api/actual-data': async (req, res) => {
        if (!db) return sendJson(res, { error: 'Database not configured' }, 503);
        
        const parsedUrl = url.parse(req.url, true);
        const { start, end } = parsedUrl.query;
        const data = await db.getActualData(start, end);
        sendJson(res, { success: true, data });
    },

    // Store prediction (called internally when predictions are made)
    'POST /api/predictions': async (req, res) => {
        if (!db) return sendJson(res, { error: 'Database not configured' }, 503);
        
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
        if (!db) return sendJson(res, { error: 'Database not configured' }, 503);
        
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
        if (!db) return sendJson(res, { error: 'Database not configured' }, 503);
        
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
        if (!db) return sendJson(res, { error: 'Database not configured' }, 503);
        
        const parsedUrl = url.parse(req.url, true);
        const { start, end } = parsedUrl.query;
        const data = await db.getPredictions(start, end);
        sendJson(res, { success: true, data });
    },

    // Get accuracy statistics
    'GET /api/accuracy': async (req, res) => {
        if (!db) return sendJson(res, { error: 'Database not configured' }, 503);
        
        const stats = await db.getAccuracyStats();
        sendJson(res, { success: true, data: stats });
    },

    // Get comparison data (actual vs predicted)
    'GET /api/comparison': async (req, res) => {
        if (!db) return sendJson(res, { error: 'Database not configured' }, 503);
        
        const parsedUrl = url.parse(req.url, true);
        const limit = parseInt(parsedUrl.query.limit) || 30;
        const data = await db.getComparisonData(limit);
        sendJson(res, { success: true, data });
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
            for (const record of results) {
                await db.calculateAccuracy(record.date);
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
        if (!aiService) {
            return sendJson(res, { 
                success: false, 
                error: 'AI 服務未配置（僅在服務器環境可用）' 
            }, 503);
        }
        
        // 設置超時（90秒）
        const timeout = 90000;
        const timeoutId = setTimeout(() => {
            if (!res.headersSent) {
                console.error('⏱️ AI 分析請求超時');
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
            const analysis = await aiService.searchRelevantNewsAndEvents();
            clearTimeout(timeoutId);
            
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

    // 更新 AI 因素緩存（保存到數據庫）
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
    }
};

const server = http.createServer(async (req, res) => {
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
            sendJson(res, { error: error.message }, 500);
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

server.listen(PORT, () => {
    console.log(`🏥 NDH AED 預測系統運行於 http://localhost:${PORT}`);
    console.log(`📊 預測模型版本 ${MODEL_VERSION}`);
    if (process.env.DATABASE_URL) {
        console.log(`🗄️ PostgreSQL 數據庫已連接`);
        // 啟動定時任務
        scheduleDailyFinalPrediction();
    } else {
        console.log(`⚠️ 數據庫未配置 (設置 DATABASE_URL 環境變數以啟用)`);
    }
});


