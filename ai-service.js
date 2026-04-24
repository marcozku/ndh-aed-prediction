/**
 * AI 服務模組
 * 支持多種 AI 模型，用於搜索和分析可能影響北區醫院病人數量的因素
 * 
 * v3.0.99: 新增真正的網絡新聞搜尋功能
 * - 整合 Google News RSS（免費無限制）
 * - 支援 NewsData.io 和 GNews API（需設置環境變量）
 * - 自動搜尋香港政府新聞公報和衛生防護中心 RSS
 */

const https = require('https');
const http = require('http');
let chineseConv = null;

// 載入網絡搜尋模組
let webSearch = null;
try {
    webSearch = require('./modules/web-search.js');
    console.log('✅ 網絡搜尋模組已載入');
} catch (e) {
    console.warn('⚠️ 網絡搜尋模組載入失敗，將使用 AI 模擬搜尋:', e.message);
}

// 嘗試載入 chinese-conv（如果已安裝）
try {
    chineseConv = require('chinese-conv');
} catch (e) {
    console.warn('⚠️ chinese-conv 未安裝，將無法自動轉換簡體中文到繁體中文');
}

// ============================================
// AI 分析結果緩存
// ============================================

const ANALYSIS_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 小時緩存
const analysisCache = new Map();

/**
 * 從緩存獲取分析結果
 */
function getCachedAnalysis(cacheKey) {
    const cached = analysisCache.get(cacheKey);
    if (!cached) return null;

    const now = Date.now();
    if (now - cached.timestamp > ANALYSIS_CACHE_TTL) {
        analysisCache.delete(cacheKey);
        console.log(`📦 緩存過期: ${cacheKey}`);
        return null;
    }

    console.log(`📦 使用緩存的分析結果 (${Math.round((now - cached.timestamp) / 1000)}秒前)`);
    return cached.data;
}

/**
 * 保存分析結果到緩存
 */
function setCachedAnalysis(cacheKey, data) {
    analysisCache.set(cacheKey, {
        timestamp: Date.now(),
        data: data
    });
    console.log(`📦 分析結果已緩存: ${cacheKey}`);

    // 清理舊緩存（保留最近 10 個）
    if (analysisCache.size > 10) {
        const oldestKey = analysisCache.keys().next().value;
        analysisCache.delete(oldestKey);
        console.log(`📦 清理舊緩存: ${oldestKey}`);
    }
}

// 檢測是否包含簡體中文字符
function hasSimplifiedChinese(text) {
    if (!text || typeof text !== 'string') return false;
    
    // 常見簡體中文字符列表（用於檢測）
    const simplifiedChars = [
        '简', '体', '预', '测', '统', '系', '数', '据', '库', '连', '检', '载',
        '气', '资', '响', '无', '总', '结', '说', '获', '后', '时', '间', '缓',
        '个', '卫', '会', '节', '来', '袭', '温', '骤', '导', '致', '别', '对',
        '于', '础', '经', '开', '渐', '况', '医', '疗', '药', '诊', '症', '病',
        '患', '护', '风', '云', '雾', '雨', '雪', '热', '冷', '湿', '干', '现',
        '实', '际', '过', '还', '这', '圣', '诞', '临', '期', '准', '备', '伤',
        '关', '负', '担', '历', '显', '着', '动', '学', '为', '产', '发', '长',
        '门', '问', '题', '应', '该', '较', '认', '识', '记', '录', '处', '理',
        '置', '分', '罚', '变', '化', '确', '定', '标', '准', '规', '则',
        // 新增遺漏的簡體字符
        '传', '监', '转', '将', '诱', '恶', '险', '紧', '持', '续', '剧', '调',
        '并', '机'
    ];
    
    for (let char of simplifiedChars) {
        if (text.includes(char)) {
            return true;
        }
    }
    
    return false;
}

// 清理問題 Unicode 字符（修復顯示為 ? 的字符）
function cleanProblematicCharacters(text) {
    if (!text || typeof text !== 'string') return text;
    
    // 移除零寬字符和控制字符
    let cleaned = text
        .replace(/[\u200B-\u200D\uFEFF]/g, '') // 零寬字符
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // 控制字符
        .replace(/\uFFFD/g, '') // 替換字符 (�)
        .replace(/[\uD800-\uDFFF]/g, ''); // 孤立的代理對
    
    // 標準化 Unicode（將兼容字符轉換為標準形式）
    try {
        cleaned = cleaned.normalize('NFC');
    } catch (e) {
        // 忽略標準化錯誤
    }
    
    return cleaned;
}

// 轉換簡體中文到繁體中文的輔助函數
function convertToTraditional(text) {
    if (!text || typeof text !== 'string') return text;
    
    // 先清理問題字符
    text = cleanProblematicCharacters(text);
    
    // 檢測是否包含簡體中文（轉換前）
    const hadSimplified = hasSimplifiedChinese(text);
    
    if (!chineseConv) {
        if (hadSimplified) {
            console.warn('⚠️ 檢測到簡體中文，但 chinese-conv 未安裝，無法自動轉換:', text.substring(0, 100));
        }
        return text; // 如果沒有轉換器，直接返回
    }
    
    try {
        // chinese-conv 使用 tify() 方法將簡體轉換為繁體（Traditional）
        // sify() 是簡體化（Simplified），tify() 是繁體化（Traditional）
        const converted = chineseConv.tify(text);
        
        // 簡體中文轉換成功，不再輸出警告（避免日誌過多）
        return converted;
    } catch (e) {
        console.warn('⚠️ 轉換簡體中文失敗:', e.message);
        if (hadSimplified) {
            console.warn('⚠️ 原始文本包含簡體中文但轉換失敗，返回原文:', text.substring(0, 100));
        }
        return text; // 轉換失敗時返回原文
    }
}

// 遞歸轉換對象中的所有字符串
function convertObjectToTraditional(obj) {
    if (!obj) return obj;
    
    if (typeof obj === 'string') {
        // 轉換簡體中文（不輸出警告，避免日誌過多）
        return convertToTraditional(obj);
    } else if (Array.isArray(obj)) {
        return obj.map(item => convertObjectToTraditional(item));
    } else if (typeof obj === 'object') {
        const converted = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                converted[key] = convertObjectToTraditional(obj[key]);
            }
        }
        return converted;
    }
    
    return obj;
}

// 載入環境變數
require('dotenv').config();

function normalizeBaseUrl(baseUrl, defaultBaseUrl = '') {
    const value = String(baseUrl || defaultBaseUrl || '').trim();
    if (!value) {
        return '';
    }

    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return withProtocol.replace(/\/+$/, '');
}

function parsePositiveInt(value, fallbackValue) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
}

function getApiHost(baseUrl) {
    if (!baseUrl) {
        return '';
    }

    try {
        return new URL(baseUrl).host;
    } catch (error) {
        return baseUrl;
    }
}

function sanitizeApiConfigs() {
    return Object.fromEntries(
        Object.entries(API_CONFIGS).map(([name, config]) => [
            name,
            {
                baseUrl: config.baseUrl,
                fallbackBaseUrl: config.fallbackBaseUrl || '',
                host: getApiHost(config.baseUrl),
                fallbackHost: getApiHost(config.fallbackBaseUrl),
                configured: Boolean(config.apiKey),
                maxTokens: config.maxTokens
            }
        ])
    );
}

function isApiConfigEnabled(apiConfigName) {
    const apiConfig = API_CONFIGS[apiConfigName];
    return Boolean(apiConfig && apiConfig.baseUrl && apiConfig.apiKey);
}

const PRIMARY_MODEL = process.env.AI_MODEL || 'gpt-5.5';
const PRIMARY_FALLBACK_MODEL = process.env.AI_FALLBACK_MODEL || 'gpt-5.4';
const PRIMARY_BASIC_MODEL = process.env.AI_BASIC_MODEL || 'gpt-5';
const FREE_DEFAULT_MODEL = process.env.FREE_AI_MODEL || 'gpt-4o-mini';
const PRIMARY_REASONING_EFFORT = process.env.AI_REASONING_EFFORT || 'none';

// 多 API 配置（主服務優先，免費服務作為備援）
const API_CONFIGS = {
    primary: {
        baseUrl: normalizeBaseUrl(
            process.env.AI_BASE_URL || process.env.CHATANYWHERE_BASE_URL,
            'https://code.newcli.com/codex/v1'
        ),
        fallbackBaseUrl: normalizeBaseUrl(
            process.env.AI_FALLBACK_BASE_URL || process.env.CHATANYWHERE_FALLBACK_BASE_URL
        ),
        apiKey: process.env.AI_API_KEY || process.env.CHATANYWHERE_API_KEY || '',
        maxTokens: parsePositiveInt(process.env.AI_MAX_TOKENS, 2000)
    },
    free: {
        baseUrl: normalizeBaseUrl(process.env.FREE_API_BASE_URL, 'https://free.v36.cm/v1'),
        fallbackBaseUrl: normalizeBaseUrl(
            process.env.FREE_API_FALLBACK_BASE_URL || process.env.FREE_API_BASE_URL,
            'https://free.v36.cm/v1'
        ),
        apiKey: process.env.FREE_API_KEY || '',
        maxTokens: parsePositiveInt(process.env.FREE_API_MAX_TOKENS, 1500)  // 免費 API token 限制較嚴
    }
};

// 當前使用的 API（會自動切換）
let currentAPIConfig = 'primary';
let currentAPIHost = getApiHost(API_CONFIGS.primary.baseUrl);

// 模型配置（從高級到免費，依次嘗試）
const MODEL_CONFIG = {
    // 主模型
    premium: {
        models: [PRIMARY_MODEL],
        dailyLimit: 9999,
        defaultModel: PRIMARY_MODEL,
        api: 'primary'
    },
    // 次選模型
    standard: {
        models: [PRIMARY_FALLBACK_MODEL],
        dailyLimit: 9999,
        defaultModel: PRIMARY_FALLBACK_MODEL,
        api: 'primary'
    },
    // 基礎模型
    basic: {
        models: [PRIMARY_BASIC_MODEL],
        dailyLimit: 9999,
        defaultModel: PRIMARY_BASIC_MODEL,
        api: 'primary'
    },
    // 免費模型（free.v36.cm API）- 無限制
    free: {
        models: [FREE_DEFAULT_MODEL, 'gpt-3.5-turbo', 'gpt-3.5-turbo-16k'],
        dailyLimit: 9999,
        defaultModel: FREE_DEFAULT_MODEL,
        api: 'free'
    }
};

function shouldUseResponsesApi(apiConfigName) {
    return apiConfigName === 'primary';
}

function extractTextFromResponseOutput(outputItems = []) {
    const texts = [];

    for (const item of outputItems) {
        if (!item || !Array.isArray(item.content)) {
            continue;
        }

        for (const contentPart of item.content) {
            if (contentPart && contentPart.type === 'output_text' && contentPart.text) {
                texts.push(contentPart.text);
            }
        }
    }

    return texts.join('\n').trim();
}

function extractTextFromResponsesApiBody(bodyText) {
    if (!bodyText || typeof bodyText !== 'string') {
        return '';
    }

    let completedText = '';
    let streamedText = '';
    let currentEvent = '';

    for (const rawLine of bodyText.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }

        if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
            continue;
        }

        if (!line.startsWith('data:')) {
            continue;
        }

        const dataText = line.slice(5).trim();
        if (!dataText || dataText === '[DONE]') {
            continue;
        }

        let payload = null;
        try {
            payload = JSON.parse(dataText);
        } catch (error) {
            continue;
        }

        if (currentEvent === 'response.output_text.delta' && payload.delta) {
            streamedText += payload.delta;
        }

        if (currentEvent === 'response.output_text.done' && payload.text) {
            completedText = payload.text;
        }

        if (!completedText && payload.response && Array.isArray(payload.response.output)) {
            const extracted = extractTextFromResponseOutput(payload.response.output);
            if (extracted) {
                completedText = extracted;
            }
        }
    }

    return (completedText || streamedText).trim();
}

function parseApiErrorMessage(rawText, statusCode) {
    let errorMsg = `HTTP ${statusCode}`;

    try {
        const errorData = JSON.parse(rawText);
        if (errorData.error) {
            errorMsg = errorData.error.message || errorData.error.code || errorMsg;
        } else if (errorData.detail) {
            errorMsg = errorData.detail;
        }
    } catch (error) {
        // 忽略解析錯誤，保留原始 HTTP 狀態
    }

    return errorMsg;
}

async function callResponsesApi(prompt, model, temperature, apiConfigName, apiConfig) {
    const apiBaseUrl = apiConfig.baseUrl;
    const fallbackBaseUrl = apiConfig.fallbackBaseUrl;
    const apiKey = apiConfig.apiKey;
    const maxTokens = apiConfig.maxTokens;

    const body = {
        model,
        instructions: '你是香港北區醫院急症室分析助手。只用繁體中文回應。',
        input: prompt,
        temperature,
        max_output_tokens: maxTokens,
        stream: false,
        reasoning: {
            effort: PRIMARY_REASONING_EFFORT
        },
        text: {
            format: { type: 'text' },
            verbosity: 'medium'
        }
    };

    try {
        const response = await fetch(`${apiBaseUrl}/responses`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(body)
        });

        const rawText = await response.text();

        if (!response.ok) {
            console.error(`❌ AI API HTTP 錯誤 (${model}): ${response.status}`);
            console.error('響應內容:', rawText.substring(0, 500));

            if (response.status >= 500 && fallbackBaseUrl && apiBaseUrl === apiConfig.baseUrl && fallbackBaseUrl !== apiBaseUrl) {
                console.warn(`⚠️ 主 API ${apiBaseUrl} 返回錯誤，切換到備用 base URL...`);
                const fallbackConfig = { ...apiConfig, baseUrl: fallbackBaseUrl };
                API_CONFIGS[apiConfigName] = fallbackConfig;
                return callResponsesApi(prompt, model, temperature, apiConfigName, fallbackConfig);
            }

            throw new Error(`AI API 錯誤: ${parseApiErrorMessage(rawText, response.status)}`);
        }

        const content = extractTextFromResponsesApiBody(rawText);
        if (!content) {
            console.error(`❌ AI API 返回空內容 (${model})`);
            console.error('完整響應:', rawText.substring(0, 1000));
            throw new Error('AI API 返回空內容，需要嘗試其他模型');
        }

        console.log(`📝 AI 回應長度: ${content.length} 字符`);
        currentAPIConfig = apiConfigName;
        currentAPIHost = getApiHost(apiBaseUrl);
        console.log(`✅ API ${apiConfigName} (${currentAPIHost}) 調用成功`);
        return content;
    } catch (error) {
        if (fallbackBaseUrl && apiBaseUrl === apiConfig.baseUrl && fallbackBaseUrl !== apiBaseUrl) {
            console.warn(`⚠️ 主 API ${apiBaseUrl} 連接失敗，切換到備用 base URL...`);
            const fallbackConfig = { ...apiConfig, baseUrl: fallbackBaseUrl };
            API_CONFIGS[apiConfigName] = fallbackConfig;
            return callResponsesApi(prompt, model, temperature, apiConfigName, fallbackConfig);
        }

        throw error;
    }
}

function callChatCompletionsApi(prompt, model, temperature, apiConfigName, apiConfig) {
    return new Promise((resolve, reject) => {
        const apiBaseUrl = apiConfig.baseUrl;
        const fallbackBaseUrl = apiConfig.fallbackBaseUrl;
        const apiKey = apiConfig.apiKey;
        const maxTokens = apiConfig.maxTokens;

        const apiUrl = `${apiBaseUrl}/chat/completions`;
        const url = new URL(apiUrl);
        const postData = JSON.stringify({
            model: model,
            messages: [
                {
                    role: 'system',
                    content: '你是香港北區醫院急症室分析助手。只用繁體中文回應。'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: temperature,
            max_tokens: maxTokens
        });

        const requestClient = url.protocol === 'http:' ? http : https;
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'http:' ? 80 : 443),
            path: `${url.pathname}${url.search}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = requestClient.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    console.error(`❌ AI API HTTP 錯誤 (${model}): ${res.statusCode}`);
                    console.error('響應內容:', data.substring(0, 500));
                    
                    if (res.statusCode >= 500 && fallbackBaseUrl && apiBaseUrl === apiConfig.baseUrl && fallbackBaseUrl !== apiBaseUrl) {
                        console.warn(`⚠️ 主 API ${apiBaseUrl} 返回錯誤，切換到備用 base URL...`);
                        const fallbackConfig = { ...apiConfig, baseUrl: fallbackBaseUrl };
                        API_CONFIGS[apiConfigName] = fallbackConfig;
                        return callChatCompletionsApi(prompt, model, temperature, apiConfigName, fallbackConfig).then(resolve).catch(reject);
                    }
                    
                    return reject(new Error(`AI API 錯誤: ${parseApiErrorMessage(data, res.statusCode)}`));
                }
                
                try {
                    const jsonData = JSON.parse(data);
                    
                    if (jsonData.error) {
                        const errorMsg = jsonData.error.message || jsonData.error.code || '未知錯誤';
                        console.error(`❌ AI API 返回錯誤 (${model}): ${errorMsg}`, jsonData.error);
                        return reject(new Error(`AI API 錯誤: ${errorMsg}`));
                    }
                    
                    if (!jsonData.choices || !jsonData.choices[0] || !jsonData.choices[0].message) {
                        console.error(`❌ AI API 響應格式異常 (${model}):`, jsonData);
                        return reject(new Error('AI API 響應格式異常'));
                    }
                    
                    const content = jsonData.choices[0].message.content;
                    if (!content || content.trim().length === 0) {
                        console.error(`❌ AI API 返回空內容 (${model})`);
                        console.error('完整響應:', JSON.stringify(jsonData).substring(0, 500));
                        return reject(new Error('AI API 返回空內容，需要嘗試其他模型'));
                    }
                    
                    if (!content.includes('{') || !content.includes('}')) {
                        console.warn(`⚠️ AI 回應可能不是 JSON 格式 (${model}):`, content.substring(0, 200));
                    }
                    
                    console.log(`📝 AI 回應長度: ${content.length} 字符`);
                    currentAPIConfig = apiConfigName;
                    currentAPIHost = getApiHost(apiBaseUrl);
                    console.log(`✅ API ${apiConfigName} (${currentAPIHost}) 調用成功`);
                    resolve(content);
                } catch (parseError) {
                    console.error(`❌ 解析 AI 響應失敗 (${model}):`, parseError);
                    console.error('原始響應:', data.substring(0, 500));
                    reject(new Error(`解析 AI 響應失敗: ${parseError.message}`));
                }
            });
        });

        req.on('error', (error) => {
            console.error(`❌ AI API 請求失敗 (${apiConfigName}/${getApiHost(apiBaseUrl)}, ${model}):`, error.message);
            if (fallbackBaseUrl && apiBaseUrl === apiConfig.baseUrl && fallbackBaseUrl !== apiBaseUrl) {
                console.warn(`⚠️ 主 API ${apiBaseUrl} 連接失敗，切換到備用 base URL...`);
                const fallbackConfig = { ...apiConfig, baseUrl: fallbackBaseUrl };
                API_CONFIGS[apiConfigName] = fallbackConfig;
                return callChatCompletionsApi(prompt, model, temperature, apiConfigName, fallbackConfig).then(resolve).catch(reject);
            }
            reject(error);
        });

        req.write(postData);
        req.end();
    });
}

// 使用計數器（按日期重置）
let usageCounters = {
    premium: { date: null, count: 0 },
    standard: { date: null, count: 0 },
    basic: { date: null, count: 0 },
    free: { date: null, count: 0 }
};

// 獲取香港時間的日期字符串
function getHKDateStr() {
    const now = new Date();
    const hkFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Hong_Kong',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    return hkFormatter.format(now);
}

// 檢查並重置計數器
function checkAndResetCounters() {
    const today = getHKDateStr();
    Object.keys(usageCounters).forEach(tier => {
        if (usageCounters[tier].date !== today) {
            usageCounters[tier].date = today;
            usageCounters[tier].count = 0;
        }
    });
}

// 獲取可用模型（優先使用高級模型，最後用免費模型）
function getAvailableModel(tier = 'premium') {
    checkAndResetCounters();
    const config = MODEL_CONFIG[tier];
    if (!config) {
        // 如果層級不存在，嘗試下一層級
        if (tier === 'premium') return getAvailableModel('standard');
        if (tier === 'standard') return getAvailableModel('basic');
        if (tier === 'basic') return getAvailableModel('free');
        return MODEL_CONFIG.free.defaultModel;
    }

    if (!isApiConfigEnabled(config.api)) {
        if (tier === 'premium') return getAvailableModel('standard');
        if (tier === 'standard') return getAvailableModel('basic');
        if (tier === 'basic') return getAvailableModel('free');
        return null;
    }
    
    if (usageCounters[tier].count >= config.dailyLimit) {
        // 如果當前層級已用完，嘗試下一層級
        if (tier === 'premium') return getAvailableModel('standard');
        if (tier === 'standard') return getAvailableModel('basic');
        if (tier === 'basic') return getAvailableModel('free');
        // 免費層級也用完了（不太可能）
        return null;
    }
    
    return config.defaultModel;
}

// 獲取所有可用模型列表（按優先級排序，從高級到免費）
function getAllAvailableModels(excludeModels = []) {
    checkAndResetCounters();
    const models = [];
    
    // 高級模型（優先級 1）
    const premiumConfig = MODEL_CONFIG.premium;
    if (isApiConfigEnabled(premiumConfig.api) && usageCounters.premium.count < premiumConfig.dailyLimit) {
        premiumConfig.models.forEach(model => {
            if (!excludeModels.includes(model + '_premium')) {
                models.push({ model, tier: 'premium', priority: 1, api: premiumConfig.api });
            }
        });
    }
    
    // 中級模型（優先級 2）
    const standardConfig = MODEL_CONFIG.standard;
    if (isApiConfigEnabled(standardConfig.api) && usageCounters.standard.count < standardConfig.dailyLimit) {
        standardConfig.models.forEach(model => {
            if (!excludeModels.includes(model + '_standard')) {
                models.push({ model, tier: 'standard', priority: 2, api: standardConfig.api });
            }
        });
    }
    
    // 基礎模型（優先級 3）
    const basicConfig = MODEL_CONFIG.basic;
    if (isApiConfigEnabled(basicConfig.api) && usageCounters.basic.count < basicConfig.dailyLimit) {
        basicConfig.models.forEach(model => {
            if (!excludeModels.includes(model + '_basic')) {
                models.push({ model, tier: 'basic', priority: 3, api: basicConfig.api });
            }
        });
    }
    
    // 免費模型（優先級 4）- free.v36.cm API
    const freeConfig = MODEL_CONFIG.free;
    if (isApiConfigEnabled(freeConfig.api) && usageCounters.free.count < freeConfig.dailyLimit) {
        freeConfig.models.forEach(model => {
            if (!excludeModels.includes(model + '_free')) {
                models.push({ model, tier: 'free', priority: 4, api: freeConfig.api });
            }
        });
    }
    
    // 按優先級排序（優先級數字越小越優先）
    models.sort((a, b) => {
        if (a.priority !== b.priority) {
            return a.priority - b.priority;
        }
        return 0;
    });
    
    return models;
}

// 檢查錯誤是否是因為模型使用次數限制
function isRateLimitError(errorMessage) {
    if (!errorMessage) return false;
    const lowerMsg = errorMessage.toLowerCase();
    return lowerMsg.includes('limit') || 
           lowerMsg.includes('每日') || 
           lowerMsg.includes('per day') ||
           lowerMsg.includes('00:00') ||
           lowerMsg.includes('免費') ||
           lowerMsg.includes('free');
}

// 記錄使用
function recordUsage(tier) {
    checkAndResetCounters();
    if (usageCounters[tier]) {
        usageCounters[tier].count++;
    }
}

// 獲取模型層級
function getModelTier(model) {
    for (const [tier, config] of Object.entries(MODEL_CONFIG)) {
        if (config.models.includes(model)) {
            return tier;
        }
    }
    return 'basic';
}

/**
 * 調用單個 AI 模型
 * @param {string} prompt - 提示詞
 * @param {string} model - 模型名稱
 * @param {number} temperature - 溫度
 * @param {boolean} skipUsageRecord - 是否跳過使用記錄
 * @param {string} apiConfigName - 使用的 API 配置（primary 或 free）
 */
async function callSingleModel(prompt, model, temperature = 0.7, skipUsageRecord = false, apiConfigName = 'primary') {
    const tier = getModelTier(model);
    if (!skipUsageRecord) {
        recordUsage(tier);
    }

    const apiConfig = API_CONFIGS[apiConfigName] || API_CONFIGS.primary;
    if (!apiConfig.baseUrl || !apiConfig.apiKey) {
        throw new Error(`AI API 未配置完成: ${apiConfigName}`);
    }

    if (shouldUseResponsesApi(apiConfigName)) {
        return callResponsesApi(prompt, model, temperature, apiConfigName, apiConfig);
    }

    return callChatCompletionsApi(prompt, model, temperature, apiConfigName, apiConfig);
}

/**
 * 調用 AI API (Node.js 環境)
 * 自動從高級模型到低級模型依次嘗試，直到成功
 */
async function callAI(prompt, model = null, temperature = 0.7) {
    const triedModels = [];
    const errors = [];
    
    console.log('🚀 開始調用 AI API，將依次嘗試所有可用模型...');
    
    // 如果指定了模型，先嘗試指定的模型（默認使用 primary API）
    if (model) {
        triedModels.push(model + '_specified');
        try {
            console.log(`🤖 [1/?] 嘗試使用指定模型: ${model} (primary)`);
            const result = await callSingleModel(prompt, model, temperature, false, 'primary');
            console.log(`✅ 模型 ${model} 調用成功`);
            return result;
        } catch (error) {
            errors.push({ model, error: error.message });
            console.warn(`⚠️ 指定模型 ${model} 失敗: ${error.message}`);
            // 無論什麼錯誤，都繼續嘗試其他模型（包括使用限制錯誤）
            if (isRateLimitError(error.message)) {
                console.log(`⏭️ 指定模型 ${model} 達到使用限制，嘗試其他模型...`);
            } else {
                console.log(`⏭️ 指定模型 ${model} 失敗，嘗試其他模型...`);
            }
        }
    }
    
    // 獲取所有可用模型（排除已嘗試的）
    let availableModels = getAllAvailableModels(triedModels);
    
    if (availableModels.length === 0) {
        const errorMsg = '沒有可用的 AI 模型；請檢查 API 金鑰、base URL 或模型設定';
        console.error(`❌ ${errorMsg}`);
        console.error('已嘗試的模型:', triedModels);
        console.error('錯誤記錄:', errors);
        throw new Error(errorMsg);
    }
    
    const totalModels = availableModels.length + (model ? 1 : 0);
    console.log(`📋 找到 ${availableModels.length} 個可用模型，將依次嘗試（總共最多 ${totalModels} 個模型）...`);
    
    // 依次嘗試每個模型
    let lastError = null;
    let attemptCount = triedModels.length;
    
    for (const { model: modelName, tier, api } of availableModels) {
        // 使用 modelName + tier 作為唯一標識符
        const modelKey = modelName + '_' + tier;
        
        // 檢查是否已經嘗試過
        if (triedModels.includes(modelKey)) {
            continue;
        }
        
        triedModels.push(modelKey);
        attemptCount++;
        
        try {
            console.log(`🤖 [${attemptCount}/${totalModels}] 嘗試使用模型: ${modelName} (${tier}/${api})`);
            const result = await callSingleModel(prompt, modelName, temperature, false, api);
            console.log(`✅ 模型 ${modelName} (${tier}/${api}) 調用成功！`);
            console.log(`📊 總共嘗試了 ${attemptCount} 個模型，最終成功使用: ${modelName}`);
            return result;
        } catch (error) {
            lastError = error;
            errors.push({ model: modelName, tier, api, error: error.message });
            console.warn(`⚠️ 模型 ${modelName} (${tier}/${api}) 失敗: ${error.message}`);
            
            // 檢查是否為使用次數限制錯誤
            if (isRateLimitError(error.message)) {
                console.log(`⏭️ 模型 ${modelName} 達到使用限制，嘗試下一個模型...`);
                // 繼續嘗試下一個模型
                continue;
            }
            
            // 如果是其他錯誤（如網絡錯誤、API 錯誤等），也嘗試下一個模型
            console.log(`⏭️ 模型 ${modelName} 失敗 (${error.message})，嘗試下一個模型...`);
            
            // 重新獲取可用模型列表（可能因為錯誤而變化）
            const remainingModels = getAllAvailableModels(triedModels);
            
            // 如果還有其他模型可嘗試，繼續
            if (remainingModels.length > 0) {
                console.log(`📋 還有 ${remainingModels.length} 個模型可嘗試...`);
                continue;
            }
            
            // 如果沒有更多模型可嘗試，跳出循環
            console.warn(`⚠️ 沒有更多模型可嘗試，已嘗試 ${triedModels.length} 個模型`);
            break;
        }
    }
    
    // 如果所有模型都嘗試過了但都失敗
    if (lastError) {
        const errorMsg = `所有 AI 模型都嘗試失敗（已嘗試 ${triedModels.length} 個模型）。最後錯誤: ${lastError.message}`;
        console.error(`❌ ${errorMsg}`);
        console.error('已嘗試的模型:', triedModels);
        console.error('所有錯誤記錄:', errors);
        throw new Error(errorMsg);
    }
    
    const errorMsg = `所有 AI 模型都嘗試失敗（已嘗試 ${triedModels.length} 個模型）`;
    console.error(`❌ ${errorMsg}`);
    console.error('已嘗試的模型:', triedModels);
    throw new Error(errorMsg);
}

/**
 * 政策監控數據源配置
 */
const POLICY_MONITORING_SOURCES = {
    hospitalAuthority: {
        name: '醫院管理局',
        websites: [
            'https://www.ha.org.hk',
            'https://www.ha.org.hk/haho/ho/pad/',
            'https://www.ha.org.hk/haho/ho/pad/NewsRelease.aspx'
    ],
        keywords: ['急症室', 'A&E', '急症', '分流', '收費', '政策', '服務調整', '公告']
    },
    departmentOfHealth: {
        name: '衛生署',
        websites: [
            'https://www.dh.gov.hk',
            'https://www.chp.gov.hk'
    ],
        keywords: ['急症', '醫院', '醫療服務', '政策', '公告', '指引']
    },
    newsSources: {
        name: '新聞來源',
        keywords: ['北區醫院', '急症室', '醫院政策', '醫療服務', '急症收費', '分流政策']
    }
};

/**
 * 已驗證的政策事實 - 必須提供來源參考
 * 所有政策資訊必須經過事實核查，並附上官方來源
 */
const VERIFIED_POLICY_FACTS = {
    haEmergencyFeeReform: {
        title: '醫管局急症室分級收費制度',
        effectiveDate: '2026-01-01',
        description: '醫院管理局將於2026年1月1日起實施急症室分級收費制度，收費由現時180元增至400元。被評為「危殆」和「危急」的病人可獲豁免收費。',
        impact: '預計非緊急求診人數將下降約15-20%',
        sources: [
            'https://www.ha.org.hk',
            'https://www.info.gov.hk/gia/general/202412/17/P2024121700356.htm',
            'https://www.tkww.hk/a/202512/17/AP6941f995e4b032040a155f4e.html'
        ],
        lastVerified: '2025-12-26'
    }
};

/**
 * 生成已驗證政策事實的提示文本
 */
function getVerifiedPolicyFactsPrompt() {
    const facts = Object.values(VERIFIED_POLICY_FACTS).map(fact => {
        return `- ${fact.title}：
  - 生效日期：${fact.effectiveDate}
  - 描述：${fact.description}
  - 影響：${fact.impact}
  - 來源：${fact.sources.join(', ')}
  - 最後驗證日期：${fact.lastVerified}`;
    }).join('\n');
    
    return `
**⚠️ 已驗證的政策事實（請使用這些經過核實的資料）：**
${facts}

**⚠️ 事實核查要求：**
1. 對於政策變更，必須使用上述已驗證的資料
2. 如果資訊與已驗證事實不符，以已驗證事實為準
3. 不要憑記憶或推測政策日期，必須引用確切來源
4. 所有政策資訊必須附上來源 URL 或官方機構名稱
`;
}

/**
 * 自動事實核查：檢查 AI 生成的因素是否與已驗證事實匹配
 * @param {Object} factor - AI 生成的因素對象
 * @returns {Object} - 包含驗證結果的對象 {isVerified, matchedFact, reason}
 */
function factCheckFactor(factor) {
    if (!factor || typeof factor !== 'object') {
        return { isVerified: false, matchedFact: null, reason: '無效的因素對象' };
    }
    
    const factorType = String(factor.type || '').toLowerCase();
    const factorDescription = String(factor.description || '').toLowerCase();
    const factorSource = String(factor.source || '').toLowerCase();
    const factorSourceUrl = String(factor.sourceUrl || '').toLowerCase();
    
    // 檢查是否為政策相關因素
    const isPolicyRelated = factorType.includes('政策') || 
                           factorType.includes('policy') ||
                           factorDescription.includes('政策') ||
                           factorDescription.includes('收費') ||
                           factorDescription.includes('分流') ||
                           factorDescription.includes('急症室');
    
    // 如果與政策無關，檢查是否有可信來源
    if (!isPolicyRelated) {
        // 檢查來源是否為官方或可信來源
        const trustedSources = [
            'ha.org.hk', '醫管局', '醫院管理局',
            'dh.gov.hk', 'chp.gov.hk', '衛生署', '衛生防護中心',
            'info.gov.hk', '政府', 'gov.hk'
        ];
        
        const hasTrustedSource = trustedSources.some(source => 
            factorSource.includes(source) || 
            factorSourceUrl.includes(source)
        );
        
        if (hasTrustedSource) {
            return { 
                isVerified: true, 
                matchedFact: null, 
                reason: '來源為官方或可信機構' 
            };
        }
        
        // 如果有來源 URL 但未標記為未驗證，保持原狀態
        if (factorSourceUrl && factorSourceUrl.startsWith('http')) {
            return { 
                isVerified: factor.unverified !== true, 
                matchedFact: null, 
                reason: '有來源連結，依 AI 標記' 
            };
        }
        
        // 無來源或來源不明確，標記為未驗證
        if (!factorSource && !factorSourceUrl) {
            return { 
                isVerified: false, 
                matchedFact: null, 
                reason: '無來源資訊' 
            };
        }
    }
    
    // 對於政策相關因素，檢查是否匹配已驗證事實
    for (const [key, verifiedFact] of Object.entries(VERIFIED_POLICY_FACTS)) {
        const factTitle = verifiedFact.title.toLowerCase();
        const factDescription = verifiedFact.description.toLowerCase();
        
        // 檢查標題或描述是否匹配
        const titleMatch = factorDescription.includes(factTitle) || 
                          factorType.includes(factTitle.split(' ')[0]);
        const descMatch = factorDescription.includes('急症室') && 
                         (factorDescription.includes('收費') || 
                          factorDescription.includes('400') ||
                          factorDescription.includes('180'));
        
        // 檢查日期是否匹配
        const factDate = verifiedFact.effectiveDate;
        const hasMatchingDate = factor.affectedDays && 
            factor.affectedDays.some(date => date.startsWith(factDate.substring(0, 7))); // 匹配年月
        
        // 檢查來源是否匹配
        const sourceMatch = verifiedFact.sources.some(source => 
            factorSourceUrl.includes(source) || 
            factorSource.includes(source)
        );
        
        if (titleMatch || (descMatch && hasMatchingDate) || sourceMatch) {
            // 匹配已驗證事實，標記為已驗證並更新來源
            return { 
                isVerified: true, 
                matchedFact: key, 
                reason: `匹配已驗證事實：${verifiedFact.title}`,
                verifiedSource: verifiedFact.sources[0],
                verifiedDescription: verifiedFact.description
            };
        }
    }
    
    // 政策相關但未匹配已驗證事實
    if (isPolicyRelated) {
        return { 
            isVerified: false, 
            matchedFact: null, 
            reason: '政策相關但未匹配已驗證事實，需要人工核查' 
        };
    }
    
    // 其他情況，保持 AI 的標記或標記為未驗證
    return { 
        isVerified: factor.unverified !== true && (factorSource || factorSourceUrl), 
        matchedFact: null, 
        reason: '依來源和 AI 標記判斷' 
    };
}

/**
 * 對所有 AI 生成的因素進行自動事實核查
 * @param {Object} result - AI 分析結果
 * @returns {Object} - 添加了驗證標記的結果
 */
function factCheckAllFactors(result) {
    if (!result || !result.factors || !Array.isArray(result.factors)) {
        return result;
    }
    
    let verifiedCount = 0;
    let unverifiedCount = 0;
    
    result.factors = result.factors.map(factor => {
        const factCheck = factCheckFactor(factor);
        
        if (factCheck.isVerified) {
            verifiedCount++;
            factor.verified = true;
            factor.unverified = false;
            
            // 如果匹配了已驗證事實，更新來源資訊
            if (factCheck.matchedFact && factCheck.verifiedSource) {
                if (!factor.sourceUrl) {
                    factor.sourceUrl = factCheck.verifiedSource;
                }
                if (!factor.source || factor.source === '內部通告' || factor.source === '未知') {
                    factor.source = '已驗證政策事實';
                }
            }
        } else {
            unverifiedCount++;
            factor.verified = false;
            factor.unverified = true;
            factor.verificationReason = factCheck.reason;
        }
        
        return factor;
    });
    
    console.log(`✅ 事實核查完成：${verifiedCount} 個已驗證，${unverifiedCount} 個未驗證`);
    
    return result;
}

/**
 * 搜索相關新聞和政策（使用真正的網絡搜尋）
 * 
 * 功能更新：
 * - 使用 Google News RSS 進行真正的互聯網搜尋
 * - 支援 NewsData.io 和 GNews API（如有 API Key）
 * - 自動獲取香港政府新聞公報和衛生防護中心 RSS
 */
async function searchNewsAndPolicies() {
    const today = getHKDateStr();
    const searchQueries = [
        '香港 北區醫院 急症室',
        '醫院管理局 急症室 政策',
        '衛生署 急症室',
        '香港 急症室 收費',
        '醫管局 公告'
    ];
    
    console.log('🌐 開始真正的網絡新聞搜尋...');
    
    // 如果網絡搜尋模組可用，執行真正的搜尋
    if (webSearch) {
        try {
            console.log('🔍 使用網絡搜尋模組搜尋新聞...');
            
            // 執行綜合新聞搜尋
            const searchResults = await webSearch.searchAllNewsSourcesWise(searchQueries);
            
            // 格式化搜尋結果供 AI 分析
            const formattedResults = webSearch.formatSearchResultsForAI(searchResults);
            
            console.log(`✅ 網絡搜尋完成，找到 ${searchResults.articles?.length || 0} 篇相關新聞`);
            
            return {
                queries: searchQueries,
                sources: POLICY_MONITORING_SOURCES,
                date: today,
                realSearchResults: searchResults,
                formattedNews: formattedResults,
                isRealSearch: true
            };
        } catch (error) {
            console.error('❌ 網絡搜尋失敗，回退到 AI 模擬搜尋:', error.message);
            // 繼續使用 AI 模擬搜尋
        }
    } else {
        console.log('⚠️ 網絡搜尋模組未載入，使用 AI 模擬搜尋');
    }
    
    // 回退：返回搜索查詢，讓 AI 基於這些查詢來分析
    return {
        queries: searchQueries,
        sources: POLICY_MONITORING_SOURCES,
        date: today,
        isRealSearch: false
    };
}

/**
 * 搜索可能影響北區醫院病人數量的新聞和事件
 */
async function searchRelevantNewsAndEvents() {
    console.log('🔍 開始搜索相關新聞和事件...');
    const today = getHKDateStr();
    const hkTime = new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' });

    // 📦 檢查緩存（基於日期和小時生成緩存鍵）
    const currentHour = new Date().getHours();
    const cacheKey = `analysis-${today}-${currentHour}`;
    const cached = getCachedAnalysis(cacheKey);
    if (cached) {
        return {
            ...cached,
            cached: true,
            timestamp: hkTime + ' HKT'
        };
    }

    // 生成唯一請求 ID 確保每次分析都是獨立的
    const requestId = `REQ-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    console.log(`📋 AI 分析請求 ID: ${requestId}`);
    
    // 獲取當前香港時間的詳細資訊
    const now = new Date();
    const hkFormatter = new Intl.DateTimeFormat('zh-HK', {
        timeZone: 'Asia/Hong_Kong',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    const formattedHKTime = hkFormatter.format(now);
    
    // 計算星期幾
    const hkNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }));
    const dayOfWeek = hkNow.getDay(); // 0 = Sunday
    const dayNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const currentDayName = dayNames[dayOfWeek];
    
    // 獲取新聞和政策搜索結果
    const newsSearchData = await searchNewsAndPolicies();
    
    // 獲取已驗證的政策事實提示
    const verifiedFactsPrompt = getVerifiedPolicyFactsPrompt();
    
    // 精簡版提示詞（適用於免費 API token 限制）
    const prompt = `日期：${today}（${currentDayName}）

分析今天及未來7天影響香港北區醫院急症室人數的因素：

${verifiedFactsPrompt}

請分析：
1. 政策變更（急症室收費/分流）
2. 突發公衛事件（非季節性流感）
3. 大型活動（馬拉松/演唱會）
4. 醫院服務變更

不要分析（系統已處理）：天氣、假期、流感季、週末效應

${newsSearchData.isRealSearch && newsSearchData.formattedNews ? 
`新聞：${newsSearchData.formattedNews.substring(0, 500)}` : ''}

JSON格式回應（繁體中文）：
{"factors":[{"type":"類型","description":"描述","impactFactor":1.05,"affectedDays":["${today}"],"source":"來源","sourceUrl":"來源URL（如有）","unverified":false}],"summary":"總結"}

重要：如果資訊無法從已驗證事實或新聞來源確認，請設置 "unverified": true`;

    try {
        console.log('🤖 調用 AI 分析服務（將自動嘗試所有可用模型）...');
        const response = await callAI(prompt, null, 0.5);
        console.log('✅ AI 調用成功，開始解析響應...');
        console.log('📝 原始 AI 響應長度:', response?.length || 0);
        console.log('📝 原始 AI 響應前 300 字符:', (response || '').substring(0, 300));
        
        // 檢查 AI 回應是否為空
        if (!response || response.trim().length === 0) {
            console.error('❌ AI 返回空回應！');
            throw new Error('AI 返回空回應，將嘗試其他模型');
        }
        
        // 先轉換響應中的簡體中文到繁體中文
        const convertedResponse = convertToTraditional(response);
        
        // 嘗試解析 JSON
        let result;
        try {
            // 提取 JSON 部分（如果響應包含其他文本或markdown代碼塊）
            // 先嘗試移除 markdown 代碼塊標記
            let cleanedResponse = convertedResponse
                .replace(/```json\s*/gi, '')
                .replace(/```\s*/g, '')
                .trim();
            
            const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
            
            // 修復 AI 常見的 JSON 格式問題
            let jsonStr = jsonMatch ? jsonMatch[0] : null;
            if (jsonStr) {
                // 移除 trailing commas（結尾逗號）- JSON 不允許
                jsonStr = jsonStr
                    .replace(/,\s*}/g, '}')  // 移除 object 結尾的逗號
                    .replace(/,\s*]/g, ']'); // 移除 array 結尾的逗號
            }
            if (jsonStr) {
                result = JSON.parse(jsonStr);
                console.log('✅ JSON 解析成功');
                console.log('📊 解析後的 factors 數量:', result.factors?.length || 0);
                console.log('📊 解析後的 summary 長度:', result.summary?.length || 0);
                console.log('📊 factors 是否為數組:', Array.isArray(result.factors));
                if (result.factors && result.factors.length > 0) {
                    console.log('📊 第一個 factor:', JSON.stringify(result.factors[0], null, 2));
                }
            } else {
                throw new Error('無法找到 JSON 格式');
            }
        } catch (parseError) {
            // 如果無法解析，創建一個基本結構
            console.warn('⚠️ AI 響應無法解析為 JSON，使用文本響應');
            console.warn('原始響應（前500字符）:', convertedResponse.substring(0, 500));
            console.error('解析錯誤:', parseError.message);
            result = {
                factors: [],
                summary: convertedResponse,
                rawResponse: convertedResponse
            };
        }
        
        // 轉換結果中的所有字符串為繁體中文
        result = convertObjectToTraditional(result);
        
        // 對所有因素進行自動事實核查
        result = factCheckAllFactors(result);

        console.log(`✅ AI 分析完成，找到 ${result.factors ? result.factors.length : 0} 個影響因素`);

        // 📦 保存到緩存
        setCachedAnalysis(cacheKey, result);

        return result;
    } catch (error) {
        console.error('❌ 搜索新聞和事件失敗:', error);
        console.error('錯誤詳情:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        console.error('⚠️ 所有 AI 模型都嘗試失敗，返回錯誤結果');
        return {
            factors: [],
            summary: `無法獲取 AI 分析: ${error.message}`,
            error: error.message,
            errorType: error.name
        };
    }
}

/**
 * 分析特定日期範圍的影響因素
 */
async function analyzeDateRangeFactors(startDate, endDate, weatherData = null) {
    // 獲取新聞和政策搜索結果
    const newsSearchData = await searchNewsAndPolicies();
    
    // 獲取已驗證的政策事實提示
    const verifiedFactsPrompt = getVerifiedPolicyFactsPrompt();
    
    // 精簡版提示詞
    const prompt = `分析 ${startDate} 至 ${endDate} 期間影響香港北區醫院急症室人數的因素。

${verifiedFactsPrompt}

請分析：政策變更、突發公衛事件、大型活動、醫院服務變更
不要分析（系統已處理）：天氣、假期、流感季、週末效應

JSON格式回應（繁體中文）：
{"factors":[{"date":"日期","type":"類型","description":"描述","impactFactor":1.05,"source":"來源","sourceUrl":"來源URL（如有）","unverified":false}],"overallImpact":"總結"}

重要：如果資訊無法從已驗證事實或新聞來源確認，請設置 "unverified": true`;

    try {
        const response = await callAI(prompt, null, 0.5);
        
        // 先轉換響應中的簡體中文到繁體中文
        const convertedResponse = convertToTraditional(response);
        
        let result;
        try {
            // 移除 markdown 代碼塊標記
            let cleanedResponse = convertedResponse
                .replace(/```json\s*/gi, '')
                .replace(/```\s*/g, '')
                .trim();
            
            const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
            let jsonStr = jsonMatch ? jsonMatch[0] : null;
            
            if (jsonStr) {
                // 移除 trailing commas
                jsonStr = jsonStr
                    .replace(/,\s*}/g, '}')
                    .replace(/,\s*]/g, ']');
                result = JSON.parse(jsonStr);
            } else {
                throw new Error('無法找到 JSON 格式');
            }
        } catch (parseError) {
            console.warn('⚠️ AI 響應無法解析為 JSON:', parseError.message);
            result = {
                factors: [],
                overallImpact: convertedResponse,
                rawResponse: convertedResponse
            };
        }
        
        // 轉換結果中的所有字符串為繁體中文
        result = convertObjectToTraditional(result);
        
        // 對所有因素進行自動事實核查
        result = factCheckAllFactors(result);
        
        return result;
    } catch (error) {
        console.error('❌ 分析日期範圍因素失敗:', error);
        return {
            factors: [],
            overallImpact: '無法獲取 AI 分析',
            error: error.message
        };
    }
}

/**
 * 獲取使用統計
 */
function getUsageStats() {
    checkAndResetCounters();
    return {
        premium: {
            used: usageCounters.premium.count,
            limit: MODEL_CONFIG.premium.dailyLimit,
            remaining: MODEL_CONFIG.premium.dailyLimit - usageCounters.premium.count,
            api: getApiHost(API_CONFIGS[MODEL_CONFIG.premium.api]?.baseUrl) || MODEL_CONFIG.premium.api
        },
        standard: {
            used: usageCounters.standard.count,
            limit: MODEL_CONFIG.standard.dailyLimit,
            remaining: MODEL_CONFIG.standard.dailyLimit - usageCounters.standard.count,
            api: getApiHost(API_CONFIGS[MODEL_CONFIG.standard.api]?.baseUrl) || MODEL_CONFIG.standard.api
        },
        basic: {
            used: usageCounters.basic.count,
            limit: MODEL_CONFIG.basic.dailyLimit,
            remaining: MODEL_CONFIG.basic.dailyLimit - usageCounters.basic.count,
            api: getApiHost(API_CONFIGS[MODEL_CONFIG.basic.api]?.baseUrl) || MODEL_CONFIG.basic.api
        },
        free: {
            used: usageCounters.free.count,
            limit: MODEL_CONFIG.free.dailyLimit,
            remaining: MODEL_CONFIG.free.dailyLimit - usageCounters.free.count,
            api: getApiHost(API_CONFIGS[MODEL_CONFIG.free.api]?.baseUrl) || MODEL_CONFIG.free.api
        },
        date: getHKDateStr(),
        apiHost: currentAPIHost,
        currentApiConfig: currentAPIConfig,
        apiConfigs: sanitizeApiConfigs()
    };
}

/**
 * 獲取當前使用的模型（不記錄使用，優先高級模型）
 */
function getCurrentModel() {
    return getAvailableModel('premium'); // 優先使用高級模型
}

/**
 * 獲取模型層級（導出供外部使用）
 */
function getModelTier(model) {
    for (const [tier, config] of Object.entries(MODEL_CONFIG)) {
        if (config.models.includes(model)) {
            return tier;
        }
    }
    return 'basic';
}

module.exports = {
    callAI,
    searchRelevantNewsAndEvents,
    analyzeDateRangeFactors,
    searchNewsAndPolicies,
    getUsageStats,
    getAvailableModel,
    getCurrentModel,
    getModelTier,
    MODEL_CONFIG,
    // 網絡搜尋模組（如已載入）
    webSearch: webSearch,
    isWebSearchEnabled: !!webSearch
};

