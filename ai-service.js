/**
 * AI 服務模組
 * 支持多種 AI 模型，用於搜索和分析可能影響北區醫院病人數量的因素
 */

const https = require('https');
const http = require('http');
let chineseConv = null;

// 嘗試載入 chinese-conv（如果已安裝）
try {
    chineseConv = require('chinese-conv');
} catch (e) {
    console.warn('⚠️ chinese-conv 未安裝，將無法自動轉換簡體中文到繁體中文');
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
        '置', '分', '罚', '变', '化', '确', '定', '标', '准', '规', '则'
    ];
    
    for (let char of simplifiedChars) {
        if (text.includes(char)) {
            return true;
        }
    }
    
    return false;
}

// 轉換簡體中文到繁體中文的輔助函數
function convertToTraditional(text) {
    if (!text || typeof text !== 'string') return text;
    
    // 檢測是否包含簡體中文（轉換前）
    const hadSimplified = hasSimplifiedChinese(text);
    
    if (!chineseConv) {
        if (hadSimplified) {
            console.warn('⚠️ 檢測到簡體中文，但 chinese-conv 未安裝，無法自動轉換:', text.substring(0, 100));
        }
        return text; // 如果沒有轉換器，直接返回
    }
    
    try {
        // chinese-conv 使用 sify() 方法將簡體轉換為繁體
        const converted = chineseConv.sify(text);
        
        // 如果檢測到簡體中文，記錄警告
        if (hadSimplified) {
            console.warn('⚠️ 檢測到簡體中文並已自動轉換為繁體中文:', text.substring(0, 100));
        }
        
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
        // 檢測並轉換簡體中文
        if (hasSimplifiedChinese(obj)) {
            console.warn('⚠️ 檢測到簡體中文字符串並已自動轉換:', obj.substring(0, 100));
        }
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

// 獲取所有可用模型列表（按優先級排序，從高級到低級）
function getAllAvailableModels(excludeModels = []) {
    checkAndResetCounters();
    const models = [];
    
    // 高級模型（優先級 1）
    const premiumConfig = MODEL_CONFIG.premium;
    if (usageCounters.premium.count < premiumConfig.dailyLimit) {
        premiumConfig.models.forEach(model => {
            if (!excludeModels.includes(model)) {
                models.push({ model, tier: 'premium', priority: 1 });
            }
        });
    }
    
    // 中級模型（優先級 2）
    const standardConfig = MODEL_CONFIG.standard;
    if (usageCounters.standard.count < standardConfig.dailyLimit) {
        standardConfig.models.forEach(model => {
            if (!excludeModels.includes(model)) {
                models.push({ model, tier: 'standard', priority: 2 });
            }
        });
    }
    
    // 基礎模型（優先級 3）
    const basicConfig = MODEL_CONFIG.basic;
    if (usageCounters.basic.count < basicConfig.dailyLimit) {
        basicConfig.models.forEach(model => {
            if (!excludeModels.includes(model)) {
                models.push({ model, tier: 'basic', priority: 3 });
            }
        });
    }
    
    // 按優先級排序（優先級數字越小越優先）
    models.sort((a, b) => {
        if (a.priority !== b.priority) {
            return a.priority - b.priority;
        }
        // 如果優先級相同，保持原始順序
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
 */
async function callSingleModel(prompt, model, temperature = 0.7, skipUsageRecord = false) {
    return new Promise((resolve, reject) => {
        try {
            const tier = getModelTier(model);
            if (!skipUsageRecord) {
                recordUsage(tier);
            }
            
            // 使用當前選定的 API 主機
            const apiUrl = `https://${currentAPIHost}/v1/chat/completions`;
            const url = new URL(apiUrl);
            const postData = JSON.stringify({
                model: model,
                messages: [
                    {
                        role: 'system',
                        content: `你是一個專業的醫療數據分析助手，專門分析可能影響香港北區醫院急症室病人數量的各種因素。

**極其嚴格的要求 - 必須遵守：**

1. **語言要求（最高優先級）**：
   - 你必須只使用繁體中文（Traditional Chinese / 正體中文）進行回應
   - 絕對不能使用簡體中文（Simplified Chinese / 簡體中文）
   - 絕對不能使用簡體字，包括：实际、预测、分析、影响、因素、说明、描述、理由、总结 等
   - 必須使用繁體字：實際、預測、分析、影響、因素、說明、描述、理由、總結 等

2. **適用範圍**：
   - 所有描述性文字
   - JSON 中的所有字段值（type, description, reasoning, summary 等）
   - 所有分析理由和說明
   - 任何輸出的文本內容
   - 數字和標點符號後的文字

3. **違規後果**：
   - 如果使用簡體中文，系統將無法正確顯示內容
   - 這是一個硬性要求，沒有任何例外
   - 請在生成任何文字前，先確認使用的是繁體中文

4. **常見簡體字對照（必須使用繁體）**：
   - 实际 → 實際
   - 预测 → 預測
   - 分析 → 分析（相同）
   - 影响 → 影響
   - 因素 → 因素（相同）
   - 说明 → 說明
   - 描述 → 描述（相同）
   - 理由 → 理由（相同）
   - 总结 → 總結
   - 天气 → 天氣
   - 温度 → 溫度
   - 湿度 → 濕度
   - 降雨 → 降雨（相同）

請務必確保所有輸出都是繁體中文，沒有任何簡體中文。`
                    },
                    {
                        role: 'user',
                        content: prompt + `\n\n**極其重要的語言要求（必須遵守）：**

⚠️ 你必須只使用繁體中文（Traditional Chinese / 正體中文）回應，絕對不能使用簡體中文（Simplified Chinese / 簡體中文）。

**嚴格禁止使用簡體字，包括但不限於：**
- 实际、预测、影响、说明、描述、总结
- 天气、温度、湿度、降雨
- 任何簡體中文字符

**必須使用繁體字：**
- 實際、預測、影響、說明、描述、總結
- 天氣、溫度、濕度、降雨
- 所有文字都必須是繁體中文

**檢查清單（生成回應前必須確認）：**
1. ✅ 所有文字都是繁體中文
2. ✅ JSON 中的所有字段值都是繁體中文
3. ✅ 沒有任何簡體中文字符
4. ✅ 所有描述、分析、理由都是繁體中文

如果發現任何簡體中文，請立即轉換為繁體中文後再輸出。`
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
                        console.error(`❌ AI API HTTP 錯誤 (${model}): ${res.statusCode}`);
                        console.error('響應內容:', data.substring(0, 500));
                        
                        // 如果主機失敗且還有備用主機，嘗試切換
                        if (res.statusCode >= 500 && currentAPIHost === API_HOSTS.primary) {
                            console.warn(`⚠️ 主 API 主機 ${currentAPIHost} 返回錯誤，切換到備用主機...`);
                            currentAPIHost = API_HOSTS.fallback;
                            // 遞歸重試（但只重試一次）
                            return callSingleModel(prompt, model, temperature, skipUsageRecord).then(resolve).catch(reject);
                        }
                        
                        // 嘗試解析錯誤訊息
                        let errorMsg = `HTTP ${res.statusCode}`;
                        try {
                            const errorData = JSON.parse(data);
                            if (errorData.error) {
                                errorMsg = errorData.error.message || errorData.error.code || errorMsg;
                            }
                        } catch (e) {
                            // 忽略解析錯誤
                        }
                        
                        return reject(new Error(`AI API 錯誤: ${errorMsg}`));
                    }
                    
                    try {
                        const jsonData = JSON.parse(data);
                        
                        // 檢查是否有錯誤訊息
                        if (jsonData.error) {
                            const errorMsg = jsonData.error.message || jsonData.error.code || '未知錯誤';
                            console.error(`❌ AI API 返回錯誤 (${model}): ${errorMsg}`, jsonData.error);
                            return reject(new Error(`AI API 錯誤: ${errorMsg}`));
                        }
                        
                        // 檢查是否有響應內容
                        if (!jsonData.choices || !jsonData.choices[0] || !jsonData.choices[0].message) {
                            console.error(`❌ AI API 響應格式異常 (${model}):`, jsonData);
                            return reject(new Error('AI API 響應格式異常'));
                        }
                        
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
                        console.error(`❌ 解析 AI 響應失敗 (${model}):`, parseError);
                        console.error('原始響應:', data.substring(0, 500));
                        reject(new Error(`解析 AI 響應失敗: ${parseError.message}`));
                    }
                });
            });
            
            req.on('error', (error) => {
                console.error(`❌ AI API 請求失敗 (${currentAPIHost}, ${model}):`, error.message);
                // 如果是主主機失敗，嘗試切換到備用主機
                if (currentAPIHost === API_HOSTS.primary) {
                    console.warn(`⚠️ 主 API 主機 ${currentAPIHost} 連接失敗，切換到備用主機...`);
                    currentAPIHost = API_HOSTS.fallback;
                    // 遞歸重試（但只重試一次）
                    return callSingleModel(prompt, model, temperature, skipUsageRecord).then(resolve).catch(reject);
                }
                reject(error);
            });
            
            req.write(postData);
            req.end();
        } catch (error) {
            console.error(`❌ AI API 調用失敗 (${model}):`, error);
            reject(error);
        }
    });
}

/**
 * 調用 AI API (Node.js 環境)
 * 自動從高級模型到低級模型依次嘗試，直到成功
 */
async function callAI(prompt, model = null, temperature = 0.7) {
    const triedModels = [];
    
    // 如果指定了模型，先嘗試指定的模型
    if (model) {
        triedModels.push(model);
        try {
            console.log(`🤖 嘗試使用指定模型: ${model}`);
            const result = await callSingleModel(prompt, model, temperature);
            console.log(`✅ 模型 ${model} 調用成功`);
            return result;
        } catch (error) {
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
        throw new Error('所有 AI 模型今日使用次數已達上限或無可用模型');
    }
    
    // 依次嘗試每個模型
    let lastError = null;
    for (const { model: modelName, tier } of availableModels) {
        // 檢查是否已經嘗試過
        if (triedModels.includes(modelName)) {
            continue;
        }
        
        triedModels.push(modelName);
        try {
            console.log(`🤖 嘗試使用模型: ${modelName} (${tier})`);
            const result = await callSingleModel(prompt, modelName, temperature);
            console.log(`✅ 模型 ${modelName} 調用成功`);
            return result;
        } catch (error) {
            lastError = error;
            console.warn(`⚠️ 模型 ${modelName} 失敗: ${error.message}`);
            
            // 檢查是否為使用次數限制錯誤
            if (isRateLimitError(error.message)) {
                console.log(`⏭️ 模型 ${modelName} 達到使用限制，嘗試下一個模型...`);
                // 繼續嘗試下一個模型
                continue;
            }
            
            // 如果是其他錯誤（如網絡錯誤、API 錯誤等），也嘗試下一個模型
            console.log(`⏭️ 模型 ${modelName} 失敗 (${error.message})，嘗試下一個模型...`);
            
            // 重新獲取可用模型列表（可能因為錯誤而變化）
            availableModels = getAllAvailableModels(triedModels);
            
            // 如果還有其他模型可嘗試，繼續
            if (availableModels.length > 0) {
                continue;
            }
            
            // 如果沒有更多模型可嘗試，跳出循環
            break;
        }
    }
    
    // 如果所有模型都嘗試過了但都失敗
    if (lastError) {
        throw new Error(`所有 AI 模型都嘗試失敗。最後錯誤: ${lastError.message}`);
    }
    throw new Error('所有 AI 模型都嘗試失敗');
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

**⚠️ 極其重要的語言要求（最高優先級）：**

你必須只使用繁體中文（Traditional Chinese / 正體中文）進行回應，絕對不能使用簡體中文（Simplified Chinese / 簡體中文）。

**嚴格禁止的簡體字（必須使用繁體）：**
- 实际 → 實際
- 预测 → 預測
- 影响 → 影響
- 说明 → 說明
- 描述 → 描述
- 总结 → 總結
- 天气 → 天氣
- 温度 → 溫度
- 湿度 → 濕度

**所有文字、描述、分析、JSON 字段值都必須是繁體中文。生成回應前請確認沒有任何簡體中文字符。**

請以 JSON 格式返回分析結果（所有文字必須是繁體中文）：
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
        
        // 先轉換響應中的簡體中文到繁體中文
        const convertedResponse = convertToTraditional(response);
        
        // 嘗試解析 JSON
        let result;
        try {
            // 提取 JSON 部分（如果響應包含其他文本）
            const jsonMatch = convertedResponse.match(/\{[\s\S]*\}/);
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
                summary: convertedResponse,
                rawResponse: convertedResponse
            };
        }
        
        // 轉換結果中的所有字符串為繁體中文
        result = convertObjectToTraditional(result);
        
        return result;
    } catch (error) {
        console.error('❌ 搜索新聞和事件失敗:', error);
        console.error('錯誤詳情:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
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

**⚠️ 極其重要的語言要求（最高優先級）：**

你必須只使用繁體中文（Traditional Chinese / 正體中文）進行回應，絕對不能使用簡體中文（Simplified Chinese / 簡體中文）。

**嚴格禁止的簡體字（必須使用繁體）：**
- 实际 → 實際
- 预测 → 預測
- 影响 → 影響
- 说明 → 說明
- 描述 → 描述
- 总结 → 總結
- 天气 → 天氣
- 温度 → 溫度
- 湿度 → 濕度

**所有文字、描述、分析、JSON 字段值都必須是繁體中文。生成回應前請確認沒有任何簡體中文字符。**

請以 JSON 格式返回（所有文字必須是繁體中文）：
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
        
        // 先轉換響應中的簡體中文到繁體中文
        const convertedResponse = convertToTraditional(response);
        
        let result;
        try {
            const jsonMatch = convertedResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                result = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('無法找到 JSON 格式');
            }
        } catch (parseError) {
            console.warn('⚠️ AI 響應無法解析為 JSON');
            result = {
                factors: [],
                overallImpact: convertedResponse,
                rawResponse: convertedResponse
            };
        }
        
        // 轉換結果中的所有字符串為繁體中文
        result = convertObjectToTraditional(result);
        
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

