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
                        
                        // 檢查回應內容是否為空
                        const content = jsonData.choices[0].message.content;
                        if (!content || content.trim().length === 0) {
                            console.error(`❌ AI API 返回空內容 (${model})`);
                            console.error('完整響應:', JSON.stringify(jsonData).substring(0, 500));
                            return reject(new Error('AI API 返回空內容，需要嘗試其他模型'));
                        }
                        
                        // 檢查回應是否包含有效的 JSON（基本檢查）
                        if (!content.includes('{') || !content.includes('}')) {
                            console.warn(`⚠️ AI 回應可能不是 JSON 格式 (${model}):`, content.substring(0, 200));
                            // 不拒絕，因為可能是純文本回應，讓上層處理
                        }
                        
                        console.log(`📝 AI 回應長度: ${content.length} 字符`);
                        
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
    const errors = [];
    
    console.log('🚀 開始調用 AI API，將依次嘗試所有可用模型...');
    
    // 如果指定了模型，先嘗試指定的模型
    if (model) {
        triedModels.push(model);
        try {
            console.log(`🤖 [1/?] 嘗試使用指定模型: ${model}`);
            const result = await callSingleModel(prompt, model, temperature, false);
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
        const errorMsg = '所有 AI 模型今日使用次數已達上限或無可用模型';
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
    
    for (const { model: modelName, tier } of availableModels) {
        // 檢查是否已經嘗試過
        if (triedModels.includes(modelName)) {
            continue;
        }
        
        triedModels.push(modelName);
        attemptCount++;
        
        try {
            console.log(`🤖 [${attemptCount}/${totalModels}] 嘗試使用模型: ${modelName} (${tier})`);
            const result = await callSingleModel(prompt, modelName, temperature, false);
            console.log(`✅ 模型 ${modelName} (${tier}) 調用成功！`);
            console.log(`📊 總共嘗試了 ${attemptCount} 個模型，最終成功使用: ${modelName}`);
            return result;
        } catch (error) {
            lastError = error;
            errors.push({ model: modelName, tier, error: error.message });
            console.warn(`⚠️ 模型 ${modelName} (${tier}) 失敗: ${error.message}`);
            
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
 * 搜索相關新聞和政策（使用 web search）
 */
async function searchNewsAndPolicies() {
    const today = getHKDateStr();
    const searchQueries = [
        `香港 北區醫院 急症室 政策 ${today}`,
        `醫院管理局 急症室 政策 公告 ${today}`,
        `衛生署 急症室 政策 ${today}`,
        `北區醫院 急症室 服務調整 ${today}`,
        `香港 急症室 收費 政策 ${today}`
    ];
    
    const searchResults = [];
    
    // 注意：這裡使用 AI 來模擬搜索結果，因為實際的 web search API 需要額外配置
    // 在實際部署時，可以整合 Google News API、Bing News API 或其他新聞 API
    console.log('🔍 準備搜索新聞和政策資訊...');
    
    // 返回搜索查詢，讓 AI 基於這些查詢來分析
    return {
        queries: searchQueries,
        sources: POLICY_MONITORING_SOURCES,
        date: today
    };
}

/**
 * 搜索可能影響北區醫院病人數量的新聞和事件
 */
async function searchRelevantNewsAndEvents() {
    console.log('🔍 開始搜索相關新聞和事件...');
    const today = getHKDateStr();
    const hkTime = new Date().toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' });
    
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
    
    const prompt = `**🆔 分析請求 ID：${requestId}**
**⏰ 當前時間：${formattedHKTime}（${currentDayName}）**

請針對【今天 ${today}】以及未來 7 天，分析可能影響香港北區醫院急症室病人數量的具體因素：

**📅 當前日期上下文：**
- 日期：${today}（${currentDayName}）
- 香港時間：${formattedHKTime}
- 這是 ${hkNow.getMonth() + 1} 月最後一週（年末）
- 請考慮距離今天最近的公眾假期和特殊日期

1. **健康政策變化**（⚠️ 重要 - 必須重點檢查）：
   - 醫院管理局（HA）最新政策公告
   - 急症室收費政策變更
   - 急症室分流政策調整
   - 衛生署最新醫療政策

2. **醫院當局公告**（⚠️ 重要 - 必須重點檢查）：
   - 醫院管理局官方公告
   - 北區醫院服務調整通知
   - 急症室運作模式變更

3. **新聞和媒體報導**（⚠️ 重要 - 必須重點檢查）：
   - 關於北區醫院急症室的新聞
   - 醫療政策相關新聞報導
   - 請基於以下搜索查詢來分析：
     ${newsSearchData.queries.map((q, i) => `${i + 1}. ${q}`).join('\n     ')}

4. **突發公共衛生事件**（僅限突發事件，不包括季節性流感）：
   - 新型傳染病爆發（非季節性流感）
   - 食物中毒群組事件
   - 特別傳染病警報

5. **社會事件**：
   - 大型活動或集會（影響交通或人流）
   - 重大交通事故或意外
   - 特別社會事件

6. **其他非常規因素**：
   - 醫院設施維修或臨時關閉
   - 附近醫院服務變更（導致轉介增加）
   - 其他無法由系統自動計算的因素

**🚫 請勿分析以下因素（系統已自動計算，避免重複）：**
- ❌ **天氣因素**：溫度、濕度、降雨、天氣警告（已由香港天文台數據自動計算）
- ❌ **公眾假期**：聖誕節、元旦、農曆新年等（已在 HK_PUBLIC_HOLIDAYS 中設定）
- ❌ **季節性流感**：冬季/夏季流感高峰（已由 fluSeasonFactor 自動處理）
- ❌ **週末效應**：週六日人流模式（已由 dowFactors 自動計算）
- ❌ **月份效應**：各月份的平均人流差異（已由 monthFactors 自動計算）

**⚠️ 特別重要：請優先檢查以下官方來源的最新政策變更：**
- 醫院管理局網站：https://www.ha.org.hk
- 衛生署網站：https://www.dh.gov.hk
- 衛生防護中心：https://www.chp.gov.hk

${getVerifiedPolicyFactsPrompt()}

**🎯 具體要求：**
基於當前日期 ${today}（${formattedHKTime}），請列出【具體會影響今天和未來 7 天】的因素。每個因素必須：
1. 指明具體受影響的日期（affectedDays）
2. 給出具體的影響因子（impactFactor）
3. 說明為什麼這個因素會在這些日期生效

**🚨 重要規則 - 區分真實因素與捏造資訊 🚨**

**✅ 允許且鼓勵報告的因素（系統無法自動計算的）：**
1. **突發公共衛生事件**：新型傳染病爆發、食物中毒群組（非季節性流感）- 來源：衛生防護中心公告
2. **重大社會事件**：大型活動、重大交通事故等
3. **醫院服務變更**：臨時關閉、設施維修、轉介變化
4. **政策變更**：急症室收費調整、分流政策變化（必須有官方來源）
5. **大型體育/文娛活動**：馬拉松、演唱會、球賽、煙花匯演等 - 可能增加創傷/中暑個案
6. **學校日曆事件**：開學日（傳染病+5-10%）、考試季（壓力相關）、學校假期
7. **傳染病/食物中毒爆發**：衛生防護中心公布的群組爆發

**🚫 請勿報告以下因素（系統已自動計算）：**
- 天氣（溫度/濕度/降雨/警告）→ 由 Weather Factor 處理
- 空氣質素（AQHI）→ 由 XGBoost AQHI 特徵處理
- 公眾假期 → 由 HK_PUBLIC_HOLIDAYS 處理  
- 季節性流感高峰 → 由 fluSeasonFactor 處理
- 週末效應 → 由 dowFactors 處理

**🚫 嚴格禁止捏造的內容：**
1. **醫院內部政策**：不要編造「快速分流通道」、「夜間通道」、「特別安排」等
2. **北區醫院特定措施**：除非有官方公告，不要假設任何特殊安排
3. **未經證實的政策變更**：只能引用已驗證的政策事實（如上方提供的急症室收費政策）
4. **虛假的官方公告**：不要編造政府或醫管局的公告

**📋 來源要求：**
- 政策變更：必須提供真實的 sourceUrl
- 突發事件：必須說明事件來源（新聞報導、官方公告等）
- 如有不確定，標註 "unverified": true

**⚠️ 重要提示**：
- 只報告系統無法自動計算的因素
- 不要報告天氣、假期、季節性流感、週末效應（這些已由系統處理）
- 如果沒有特別事件，可以返回空的 factors 數組

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
      "type": "健康政策/醫院當局公告/突發公衛/社會事件/服務變更/體育文娛活動/學校日曆/傳染病爆發",
      "description": "因素描述（如果是政策變更，請詳細說明政策內容和影響）",
      "impact": "增加/減少/無影響",
      "impactFactor": 1.05,  // 影響因子（1.0 = 無影響，>1.0 = 增加，<1.0 = 減少）
      "confidence": "高/中/低",
      "affectedDays": ["2025-01-XX", "2025-01-YY"],  // 受影響的日期
      "reasoning": "分析理由（如果是政策變更，請說明政策如何影響求診人數）",
      "source": "來源（如：醫院管理局、衛生署、新聞媒體等）",
      "sourceUrl": "來源網址（必須提供官方公告連結）",
      "unverified": false  // 如果資訊未經核實則設為 true
    }
  ],
  // 注意：請勿包含天氣/假期/季節性流感/週末效應，這些已由系統自動計算
  "policyChanges": [
    {
      "type": "健康政策/醫院當局公告",
      "description": "政策變更詳細描述",
      "announcementDate": "2025-01-XX",
      "effectiveDate": "2025-01-YY",
      "impact": "增加/減少/無影響",
      "impactFactor": 1.05,
      "reasoning": "政策如何影響急症室求診人數",
      "source": "政策來源",
      "sourceUrl": "來源網址（必須提供）"
    }
  ],
  "summary": "總結說明（特別強調是否有政策變更）"
}`;

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
        
        console.log(`✅ AI 分析完成，找到 ${result.factors ? result.factors.length : 0} 個影響因素`);
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
    
    const prompt = `請分析 ${startDate} 至 ${endDate} 期間，可能影響香港北區醫院急症室病人數量的因素。

${weatherData ? `當前天氣狀況：
- 溫度: ${weatherData.temperature}°C
- 濕度: ${weatherData.humidity}%
- 降雨: ${weatherData.rainfall}mm
` : ''}

請考慮（按重要性排序）：

1. **健康政策變化**（⚠️ 最高優先級）：
   - 醫院管理局（HA）在該期間的政策公告
   - 急症室收費或分流政策變更
   - 醫療服務政策調整
   - 衛生署最新醫療政策
   - 急症室服務時間或範圍調整

2. **醫院當局公告**（⚠️ 最高優先級）：
   - 醫院管理局官方公告
   - 北區醫院服務調整通知
   - 急症室運作模式變更
   - 醫療資源配置變更

3. **新聞和媒體報導**（⚠️ 重要）：
   - 關於北區醫院急症室的新聞
   - 醫療政策相關新聞報導
   - 請基於以下搜索查詢來分析：
     ${newsSearchData.queries.map((q, i) => `${i + 1}. ${q}`).join('\n     ')}

4. 突發公共衛生事件（非季節性流感）
5. 重大社會事件
6. 其他無法由系統自動計算的因素

**🚫 請勿分析以下因素（系統已自動計算，避免重複）：**
- ❌ **天氣因素**：溫度、濕度、降雨、天氣警告（已由 Weather Factor 處理）
- ❌ **公眾假期**：聖誕節、元旦、農曆新年等（已由 HK_PUBLIC_HOLIDAYS 處理）
- ❌ **季節性流感**：冬季/夏季流感高峰（已由 fluSeasonFactor 處理）
- ❌ **週末效應**：週六日人流模式（已由 dowFactors 處理）

${getVerifiedPolicyFactsPrompt()}

**🚨 重要規則 🚨**

**✅ 允許報告**：突發公衛事件、政策變更、重大社會事件、醫院服務變更
**🚫 禁止報告**：天氣、假期、季節性流感、週末效應（系統已處理）
**🚫 禁止編造**：醫院內部政策、分流通道、特殊安排等（除非有官方來源）

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
      "type": "健康政策/醫院當局公告/新聞報導/突發公衛/社會事件/服務變更",
      "description": "因素描述（如果是政策變更，請詳細說明）",
      "impactFactor": 1.05,
      "confidence": "高/中/低",
      "reasoning": "分析理由（如果是政策變更，請說明政策如何影響求診人數）",
      "source": "來源（必須是真實官方來源）",
      "sourceUrl": "來源網址（必須是真實可訪問的 URL，如無法提供則不要包含該因素）"
    }
  ],
  // 注意：請勿包含天氣/假期/季節性流感/週末效應，這些已由系統自動計算
  "policyChanges": [
    {
      "date": "YYYY-MM-DD",
      "type": "健康政策/醫院當局公告",
      "description": "政策變更詳細描述",
      "impactFactor": 1.05,
      "reasoning": "政策如何影響急症室求診人數",
      "source": "政策來源（必須是真實官方來源）",
      "sourceUrl": "來源網址（必須是真實可訪問的 URL）"
    }
  ],
  "overallImpact": "整體影響評估（如無確實影響因素，請說明「暫無已知影響因素」）"
}`;

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

