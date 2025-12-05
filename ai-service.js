/**
 * AI 服務模組
 * 支持多種 AI 模型，用於搜索和分析可能影響北區醫院病人數量的因素
 */

const https = require('https');
const http = require('http');

const API_KEY = 'sk-hYb2t30UZbEPjt3QXVwBU4wXLvUzxBVL4DiLgbDWhKYIiFQW';

// API 轉發主機配置
// 優先使用國內中轉（延遲更低），失敗時自動切換到國外主機
const API_HOSTS = {
    primary: 'api.chatanywhere.tech',   // 國內中轉，延遲更低
    fallback: 'api.chatanywhere.org'   // 國外使用
};

let currentAPIHost = API_HOSTS.primary;

// 模型配置和使用限制
const MODEL_CONFIG = {
    // 高級模型 - 一天5次
    premium: {
        models: ['gpt-5.1', 'gpt-5', 'gpt-4o', 'gpt-4.1'],
        dailyLimit: 5,
        defaultModel: 'gpt-4o'
    },
    // 中級模型 - 一天30次
    standard: {
        models: ['deepseek-r1', 'deepseek-v3', 'deepseek-v3-2-exp'],
        dailyLimit: 30,
        defaultModel: 'deepseek-v3'
    },
    // 基礎模型 - 一天200次
    basic: {
        models: ['gpt-4o-mini', 'gpt-3.5-turbo', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-5-mini', 'gpt-5-nano'],
        dailyLimit: 200,
        defaultModel: 'gpt-4o-mini'
    }
};

// 使用計數器（按日期重置）
let usageCounters = {
    premium: { date: null, count: 0 },
    standard: { date: null, count: 0 },
    basic: { date: null, count: 0 }
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

// 獲取可用模型（優先使用高級模型）
function getAvailableModel(tier = 'premium') {
    checkAndResetCounters();
    const config = MODEL_CONFIG[tier];
    if (!config) {
        // 如果層級不存在，嘗試下一層級
        if (tier === 'premium') return getAvailableModel('standard');
        if (tier === 'standard') return getAvailableModel('basic');
        return MODEL_CONFIG.basic.defaultModel;
    }
    
    if (usageCounters[tier].count >= config.dailyLimit) {
        // 如果當前層級已用完，嘗試下一層級
        if (tier === 'premium') return getAvailableModel('standard');
        if (tier === 'standard') return getAvailableModel('basic');
        // 基礎層級也用完了
        return null;
    }
    
    return config.defaultModel;
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
 * 調用 AI API (Node.js 環境)
 */
async function callAI(prompt, model = null, temperature = 0.7) {
    return new Promise((resolve, reject) => {
        try {
            // 如果沒有指定模型，優先選擇高級模型
            if (!model) {
                model = getAvailableModel('premium'); // 從高級模型開始
                if (!model) {
                    return reject(new Error('所有 AI 模型今日使用次數已達上限'));
                }
            }
            
            const tier = getModelTier(model);
            recordUsage(tier);
            
            // 使用當前選定的 API 主機
            const apiUrl = `https://${currentAPIHost}/v1/chat/completions`;
            const url = new URL(apiUrl);
            const postData = JSON.stringify({
                model: model,
                messages: [
                    {
                        role: 'system',
                        content: '你是一個專業的醫療數據分析助手，專門分析可能影響香港北區醫院急症室病人數量的各種因素。'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: temperature,
                max_tokens: 2000
            });
            
            const options = {
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${API_KEY}`,
                    'Content-Length': Buffer.byteLength(postData)
                }
            };
            
            const req = https.request(options, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        // 如果主機失敗且還有備用主機，嘗試切換
                        if (res.statusCode >= 500 && currentAPIHost === API_HOSTS.primary) {
                            console.warn(`⚠️ 主 API 主機 ${currentAPIHost} 返回錯誤，切換到備用主機...`);
                            currentAPIHost = API_HOSTS.fallback;
                            // 遞歸重試（但只重試一次）
                            return callAI(prompt, model, temperature).then(resolve).catch(reject);
                        }
                        return reject(new Error(`AI API 錯誤: ${res.statusCode} - ${data}`));
                    }
                    
                    try {
                        const jsonData = JSON.parse(data);
                        // 成功後，如果使用的是備用主機，嘗試切換回主主機（下次使用）
                        if (currentAPIHost === API_HOSTS.fallback) {
                            console.log(`✅ 備用主機 ${currentAPIHost} 工作正常，下次將嘗試主主機`);
                            // 延遲切換回主主機，避免頻繁切換
                            setTimeout(() => {
                                if (currentAPIHost === API_HOSTS.fallback) {
                                    currentAPIHost = API_HOSTS.primary;
                                }
                            }, 60000); // 1分鐘後切換回主主機
                        }
                        resolve(jsonData.choices[0].message.content);
                    } catch (parseError) {
                        reject(new Error(`解析 AI 響應失敗: ${parseError.message}`));
                    }
                });
            });
            
            req.on('error', (error) => {
                console.error(`❌ AI API 請求失敗 (${currentAPIHost}):`, error.message);
                // 如果是主主機失敗，嘗試切換到備用主機
                if (currentAPIHost === API_HOSTS.primary) {
                    console.warn(`⚠️ 主 API 主機 ${currentAPIHost} 連接失敗，切換到備用主機...`);
                    currentAPIHost = API_HOSTS.fallback;
                    // 遞歸重試（但只重試一次）
                    return callAI(prompt, model, temperature).then(resolve).catch(reject);
                }
                reject(error);
            });
            
            req.write(postData);
            req.end();
        } catch (error) {
            console.error('❌ AI API 調用失敗:', error);
            reject(error);
        }
    });
}

/**
 * 搜索可能影響北區醫院病人數量的新聞和事件
 */
async function searchRelevantNewsAndEvents() {
    const today = getHKDateStr();
    const hkTime = new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' });
    
    const prompt = `請分析以下可能影響香港北區醫院急症室病人數量的因素：

1. **天氣相關事件**：
   - 極端天氣（颱風、暴雨、寒流、酷熱）
   - 空氣污染指數異常
   - 天氣警告（八號風球、紅雨、黑雨等）

2. **公共衛生事件**：
   - 流感爆發或疫情
   - 食物中毒事件
   - 傳染病警報

3. **社會事件**：
   - 大型活動或集會
   - 交通事故或意外
   - 公共設施故障

4. **季節性因素**：
   - 節日前後效應
   - 學校假期
   - 長假期

請基於當前日期（${today}，香港時間 ${hkTime}）和一般知識，分析是否有任何已知或可能發生的因素會影響未來幾天北區醫院的病人數量。

請以 JSON 格式返回分析結果：
{
  "factors": [
    {
      "type": "天氣/公共衛生/社會事件/季節性",
      "description": "因素描述",
      "impact": "增加/減少/無影響",
      "impactFactor": 1.05,  // 影響因子（1.0 = 無影響，>1.0 = 增加，<1.0 = 減少）
      "confidence": "高/中/低",
      "affectedDays": ["2025-01-XX", "2025-01-YY"],  // 受影響的日期
      "reasoning": "分析理由"
    }
  ],
  "summary": "總結說明"
}`;

    try {
        const response = await callAI(prompt, null, 0.5);
        
        // 嘗試解析 JSON
        let result;
        try {
            // 提取 JSON 部分（如果響應包含其他文本）
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                result = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('無法找到 JSON 格式');
            }
        } catch (parseError) {
            // 如果無法解析，創建一個基本結構
            console.warn('⚠️ AI 響應無法解析為 JSON，使用文本響應');
            result = {
                factors: [],
                summary: response,
                rawResponse: response
            };
        }
        
        return result;
    } catch (error) {
        console.error('❌ 搜索新聞和事件失敗:', error);
        return {
            factors: [],
            summary: '無法獲取 AI 分析',
            error: error.message
        };
    }
}

/**
 * 分析特定日期範圍的影響因素
 */
async function analyzeDateRangeFactors(startDate, endDate, weatherData = null) {
    const prompt = `請分析 ${startDate} 至 ${endDate} 期間，可能影響香港北區醫院急症室病人數量的因素。

${weatherData ? `當前天氣狀況：
- 溫度: ${weatherData.temperature}°C
- 濕度: ${weatherData.humidity}%
- 降雨: ${weatherData.rainfall}mm
` : ''}

請考慮：
1. 天氣預報和極端天氣事件
2. 已知的公共衛生事件
3. 節日和假期效應
4. 季節性模式
5. 其他可能導致急症室病人數量異常的因素

請以 JSON 格式返回：
{
  "factors": [
    {
      "date": "YYYY-MM-DD",
      "type": "天氣/公共衛生/社會事件/季節性",
      "description": "因素描述",
      "impactFactor": 1.05,
      "confidence": "高/中/低",
      "reasoning": "分析理由"
    }
  ],
  "overallImpact": "整體影響評估"
}`;

    try {
        const response = await callAI(prompt, null, 0.5);
        
        let result;
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                result = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('無法找到 JSON 格式');
            }
        } catch (parseError) {
            console.warn('⚠️ AI 響應無法解析為 JSON');
            result = {
                factors: [],
                overallImpact: response,
                rawResponse: response
            };
        }
        
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
            remaining: MODEL_CONFIG.premium.dailyLimit - usageCounters.premium.count
        },
        standard: {
            used: usageCounters.standard.count,
            limit: MODEL_CONFIG.standard.dailyLimit,
            remaining: MODEL_CONFIG.standard.dailyLimit - usageCounters.standard.count
        },
        basic: {
            used: usageCounters.basic.count,
            limit: MODEL_CONFIG.basic.dailyLimit,
            remaining: MODEL_CONFIG.basic.dailyLimit - usageCounters.basic.count
        },
        date: getHKDateStr(),
        apiHost: currentAPIHost,
        apiHosts: {
            primary: API_HOSTS.primary,
            fallback: API_HOSTS.fallback
        }
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
    getUsageStats,
    getAvailableModel,
    getCurrentModel,
    getModelTier,
    MODEL_CONFIG
};

