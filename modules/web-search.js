/**
 * 網絡搜尋模組 - 真正的互聯網新聞搜尋
 * 支持多種免費新聞 API 和 RSS 源
 */

const https = require('https');
const http = require('http');

// ============================================
// 新聞搜尋 API 配置
// ============================================

// 多個新聞 API（按優先級排序）
const NEWS_APIS = {
    // NewsData.io - 200 請求/天，每請求 10 篇文章
    newsdata: {
        name: 'NewsData.io',
        enabled: true,
        apiKey: process.env.NEWSDATA_API_KEY || 'pub_bf59cab04cf04d6ca98136fc944fed85',
        baseUrl: 'https://newsdata.io/api/1/news',
        freeQuota: 200,
        articlesPerCredit: 10
    },
    // GNews API - 已停用（對中文/香港新聞支援較差）
    gnews: {
        name: 'GNews',
        enabled: false,  // 停用：中文查詢返回結果很少
        apiKey: process.env.GNEWS_API_KEY || null,
        baseUrl: 'https://gnews.io/api/v4/search',
        freeQuota: 100
    },
    // Google News RSS - 免費無限制
    googleNewsRss: {
        name: 'Google News RSS',
        enabled: true,
        baseUrl: 'https://news.google.com/rss/search',
        freeQuota: Infinity
    }
};

// 可信新聞來源列表（用於事實核查）
const TRUSTED_NEWS_SOURCES = [
    // 官方來源
    'info.gov.hk',           // 香港政府新聞公報
    'ha.org.hk',             // 醫院管理局
    'chp.gov.hk',            // 衛生防護中心
    'dh.gov.hk',             // 衛生署
    'news.gov.hk',           // 政府新聞網
    
    // 主流媒體
    'rthk.hk',               // 香港電台
    'scmp.com',              // 南華早報
    'hk01.com',              // 香港01
    'mingpao.com',           // 明報
    'singtao.com',           // 星島日報
    'orientaldaily.on.cc',   // 東方日報
    'on.cc',                 // 東網
    'hkej.com',              // 信報
    'thestandard.com.hk',    // 英文虎報
    'bastillepost.com',      // 巴士的報
    'am730.com.hk',          // AM730
    'hket.com',              // 經濟日報
    'wenweipo.com',          // 文匯報
    'takungpao.com.hk',      // 大公報
    
    // 通訊社
    'hkcna.hk',              // 中國新聞社香港分社
    'reuters.com',           // 路透社
    'afp.com',               // 法新社
];

// API 使用計數器（每日重置）
let apiUsageCounters = {
    newsdata: { date: null, count: 0 },
    gnews: { date: null, count: 0 }
};

// 獲取今天的日期字符串
function getTodayStr() {
    return new Date().toISOString().split('T')[0];
}

// 檢查並重置 API 計數器
function checkAndResetApiCounters() {
    const today = getTodayStr();
    Object.keys(apiUsageCounters).forEach(api => {
        if (apiUsageCounters[api].date !== today) {
            apiUsageCounters[api].date = today;
            apiUsageCounters[api].count = 0;
        }
    });
}

// 記錄 API 使用
function recordApiUsage(api) {
    checkAndResetApiCounters();
    if (apiUsageCounters[api]) {
        apiUsageCounters[api].count++;
    }
}

// 檢查 API 是否還有配額
function hasApiQuota(api) {
    checkAndResetApiCounters();
    const config = NEWS_APIS[api];
    if (!config) return false;
    return apiUsageCounters[api].count < config.freeQuota;
}

// 搜尋關鍵詞配置
const SEARCH_KEYWORDS = {
    hospital: ['北區醫院', '急症室', 'North District Hospital', 'NDH', 'A&E'],
    policy: ['醫管局', '醫院管理局', '急症室政策', '收費', '分流', 'Hospital Authority'],
    health: ['衛生署', '衛生防護中心', '傳染病', '疫情', '公共衛生'],
    emergency: ['緊急', '突發', '意外', '交通事故', '大型活動']
};

// ============================================
// HTTP 請求輔助函數
// ============================================

/**
 * 發送 HTTP/HTTPS GET 請求（支持重定向）
 */
function httpGet(url, options = {}, redirectCount = 0) {
    const MAX_REDIRECTS = 5;
    
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const protocol = urlObj.protocol === 'https:' ? https : http;
        
        const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/html, application/xml, text/xml, application/rss+xml, */*',
                'Accept-Language': 'zh-TW,zh-HK,zh;q=0.9,en;q=0.8',
                'Accept-Encoding': 'identity',
                ...options.headers
            },
            timeout: options.timeout || 15000
        };

        const req = protocol.request(reqOptions, (res) => {
            // 處理重定向 (301, 302, 303, 307, 308)
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                if (redirectCount >= MAX_REDIRECTS) {
                    return reject(new Error(`超過最大重定向次數 (${MAX_REDIRECTS})`));
                }
                
                // 構建新的 URL
                let newUrl = res.headers.location;
                if (!newUrl.startsWith('http')) {
                    // 相對 URL
                    newUrl = new URL(newUrl, url).toString();
                }
                
                console.log(`🔄 重定向到: ${newUrl.substring(0, 80)}...`);
                return httpGet(newUrl, options, redirectCount + 1).then(resolve).catch(reject);
            }
            
            let data = '';
            res.setEncoding('utf8');
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    data: data
                });
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('請求超時'));
        });

        req.end();
    });
}

// ============================================
// Google News RSS 搜尋（免費無限制）
// ============================================

/**
 * 從 Google News RSS 搜尋新聞
 * @param {string} query - 搜尋關鍵詞
 * @param {string} language - 語言代碼 (zh-TW, zh-HK, en)
 */
async function searchGoogleNewsRss(query, language = 'zh-TW') {
    try {
        const encodedQuery = encodeURIComponent(query);
        // 嘗試多種 URL 格式
        const urls = [
            `https://news.google.com/rss/search?q=${encodedQuery}&hl=${language}&gl=HK&ceid=HK:zh-Hant`,
            `https://news.google.com/rss/search?q=${encodedQuery}+site:hk&hl=zh-Hant&gl=HK`,
            `https://news.google.com/rss/search?q=${encodedQuery}&hl=en&gl=HK`
        ];
        
        console.log(`🔍 [Google News RSS] 搜尋: ${query}`);
        
        for (const url of urls) {
            try {
                const response = await httpGet(url, { timeout: 10000 });
                
                if (response.statusCode === 200 && response.data) {
                    // 解析 RSS XML
                    const articles = parseRssXml(response.data);
                    if (articles.length > 0) {
                        console.log(`✅ [Google News RSS] 找到 ${articles.length} 篇文章`);
                        return articles.map(article => ({
                            ...article,
                            source: 'Google News RSS',
                            searchQuery: query
                        }));
                    }
                }
            } catch (urlError) {
                // 嘗試下一個 URL
                continue;
            }
        }
        
        console.warn(`⚠️ [Google News RSS] 所有 URL 都未能獲取結果`);
        return [];
    } catch (error) {
        console.error(`❌ [Google News RSS] 搜尋失敗:`, error.message);
        return [];
    }
}

/**
 * 簡單的 RSS XML 解析器
 */
function parseRssXml(xmlString) {
    const articles = [];
    
    // 使用正則表達式提取 <item> 標籤
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    const titleRegex = /<title>([\s\S]*?)<\/title>/i;
    const linkRegex = /<link>([\s\S]*?)<\/link>/i;
    const pubDateRegex = /<pubDate>([\s\S]*?)<\/pubDate>/i;
    const descriptionRegex = /<description>([\s\S]*?)<\/description>/i;
    const sourceRegex = /<source[^>]*>([\s\S]*?)<\/source>/i;

    let match;
    while ((match = itemRegex.exec(xmlString)) !== null) {
        const itemContent = match[1];
        
        const titleMatch = titleRegex.exec(itemContent);
        const linkMatch = linkRegex.exec(itemContent);
        const pubDateMatch = pubDateRegex.exec(itemContent);
        const descMatch = descriptionRegex.exec(itemContent);
        const sourceMatch = sourceRegex.exec(itemContent);

        if (titleMatch) {
            // 清理 CDATA 標記
            const cleanText = (text) => {
                if (!text) return '';
                return text
                    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
                    .replace(/<[^>]+>/g, '')
                    .trim();
            };

            articles.push({
                title: cleanText(titleMatch[1]),
                url: linkMatch ? cleanText(linkMatch[1]) : '',
                publishedAt: pubDateMatch ? new Date(cleanText(pubDateMatch[1])).toISOString() : null,
                description: descMatch ? cleanText(descMatch[1]).substring(0, 500) : '',
                newsSource: sourceMatch ? cleanText(sourceMatch[1]) : 'Google News'
            });
        }
    }

    return articles;
}

// ============================================
// NewsData.io API 搜尋
// ============================================

/**
 * 使用 NewsData.io API 搜尋新聞
 */
async function searchNewsDataIo(query, apiKey = null) {
    const key = apiKey || NEWS_APIS.newsdata.apiKey;
    
    if (!key) {
        console.log('⏭️ [NewsData.io] 未設置 API Key，跳過');
        return [];
    }

    // 檢查配額
    if (!hasApiQuota('newsdata')) {
        console.log('⏭️ [NewsData.io] 今日配額已用完，跳過');
        return [];
    }

    try {
        const encodedQuery = encodeURIComponent(query);
        // 搜尋香港相關新聞
        const url = `https://newsdata.io/api/1/news?apikey=${key}&q=${encodedQuery}&language=zh&country=hk`;
        
        console.log(`🔍 [NewsData.io] 搜尋: ${query}`);
        recordApiUsage('newsdata');
        
        const response = await httpGet(url, { timeout: 15000 });
        
        if (response.statusCode !== 200) {
            console.warn(`⚠️ [NewsData.io] HTTP ${response.statusCode}`);
            return [];
        }
        
        const data = JSON.parse(response.data);

        if (data.status !== 'success') {
            console.warn(`⚠️ [NewsData.io] API 錯誤:`, data.message || data.results?.message);
            return [];
        }

        const articles = (data.results || []).map(article => ({
            title: article.title,
            url: article.link,
            publishedAt: article.pubDate,
            description: article.description || '',
            newsSource: article.source_id || article.source_name,
            source: 'NewsData.io',
            searchQuery: query,
            // 事實核查標記
            isTrustedSource: isTrustedNewsSource(article.link || ''),
            category: article.category ? article.category.join(', ') : ''
        }));

        console.log(`✅ [NewsData.io] 找到 ${articles.length} 篇文章`);
        return articles;
    } catch (error) {
        console.error(`❌ [NewsData.io] 搜尋失敗:`, error.message);
        return [];
    }
}

// ============================================
// GNews API 搜尋
// ============================================

/**
 * 使用 GNews API 搜尋新聞
 */
async function searchGNews(query, apiKey = null) {
    const key = apiKey || NEWS_APIS.gnews.apiKey;
    
    if (!key) {
        console.log('⏭️ [GNews] 未設置 API Key，跳過');
        return [];
    }

    // 檢查配額
    if (!hasApiQuota('gnews')) {
        console.log('⏭️ [GNews] 今日配額已用完，跳過');
        return [];
    }

    try {
        // 記錄 API 使用（每次搜尋只計一次）
        recordApiUsage('gnews');
        
        // 嘗試多種查詢方式
        const queries = [
            query,
            query + ' Hong Kong',
            query.replace(/[\u4e00-\u9fa5]/g, '') || 'Hong Kong hospital' // 如果全中文，用英文查詢
        ];
        
        console.log(`🔍 [GNews] 搜尋: ${query}`);
        
        let allArticles = [];
        for (const q of queries) {
            if (!q.trim()) continue;
            const encodedQuery = encodeURIComponent(q.trim());
            const url = `https://gnews.io/api/v4/search?q=${encodedQuery}&max=10&sortby=publishedAt&token=${key}`;
            
            try {
                const response = await httpGet(url, { timeout: 10000 });
                if (response.statusCode === 200) {
                    const data = JSON.parse(response.data);
                    if (data.articles && data.articles.length > 0) {
                        allArticles = data.articles;
                        break; // 找到結果就停止
                    }
                }
            } catch (e) {
                continue;
            }
        }
        
        if (allArticles.length === 0) {
            console.log(`⚠️ [GNews] 未找到相關文章`);
            return [];
        }

        const articles = allArticles.map(article => ({
            title: article.title,
            url: article.url,
            publishedAt: article.publishedAt,
            description: article.description || '',
            newsSource: article.source?.name || 'Unknown',
            sourceUrl: article.source?.url || '',
            source: 'GNews',
            searchQuery: query,
            isTrustedSource: isTrustedNewsSource(article.url || article.source?.url || ''),
            image: article.image || null
        }));

        console.log(`✅ [GNews] 找到 ${articles.length} 篇文章`);
        return articles;
    } catch (error) {
        console.error(`❌ [GNews] 搜尋失敗:`, error.message);
        return [];
    }
}

/**
 * 檢查新聞來源是否可信
 */
function isTrustedNewsSource(url) {
    if (!url) return false;
    const lowerUrl = url.toLowerCase();
    return TRUSTED_NEWS_SOURCES.some(source => lowerUrl.includes(source.toLowerCase()));
}

/**
 * 對文章進行事實核查評分
 */
function factCheckArticle(article) {
    let score = 0;
    let flags = [];
    
    // 1. 來源可信度
    if (article.isTrustedSource) {
        score += 30;
        flags.push('✅ 可信來源');
    } else {
        flags.push('⚠️ 非主流來源');
    }
    
    // 2. 有明確發布時間
    if (article.publishedAt) {
        score += 20;
        // 檢查是否是最近的新聞
        const pubDate = new Date(article.publishedAt);
        const daysDiff = (Date.now() - pubDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysDiff <= 7) {
            score += 10;
            flags.push('✅ 最近7天發布');
        }
    } else {
        flags.push('⚠️ 無發布時間');
    }
    
    // 3. 有完整描述
    if (article.description && article.description.length > 50) {
        score += 20;
    }
    
    // 4. 有有效 URL
    if (article.url && (article.url.startsWith('http://') || article.url.startsWith('https://'))) {
        score += 20;
        flags.push('✅ 有來源連結');
    }
    
    return {
        score,
        maxScore: 100,
        percentage: score,
        flags,
        isReliable: score >= 50
    };
}

// ============================================
// 官方網站 RSS 源
// ============================================

// 香港官方新聞 RSS 源
const OFFICIAL_RSS_FEEDS = {
    govNews: {
        name: '香港政府新聞公報',
        url: 'https://www.info.gov.hk/gia/rss/general_zh.xml',
        category: 'government'
    },
    chp: {
        name: '衛生防護中心',
        url: 'https://www.chp.gov.hk/tc/index/24/rss.html',
        category: 'health'
    }
};

/**
 * 從官方 RSS 源獲取最新新聞
 */
async function fetchOfficialRssFeeds() {
    const allArticles = [];
    
    for (const [key, feed] of Object.entries(OFFICIAL_RSS_FEEDS)) {
        try {
            console.log(`🔍 [官方RSS] 獲取 ${feed.name}...`);
            const response = await httpGet(feed.url, { timeout: 10000 });
            
            if (response.statusCode === 200) {
                const articles = parseRssXml(response.data);
                articles.forEach(article => {
                    article.source = feed.name;
                    article.category = feed.category;
                });
                allArticles.push(...articles);
                console.log(`✅ [官方RSS] ${feed.name} 找到 ${articles.length} 篇文章`);
            }
        } catch (error) {
            console.warn(`⚠️ [官方RSS] ${feed.name} 獲取失敗:`, error.message);
        }
    }
    
    return allArticles;
}

// ============================================
// 綜合搜尋函數
// ============================================

/**
 * 執行綜合新聞搜尋
 * 同時使用多個來源搜尋相關新聞，並進行事實核查
 */
async function searchAllNewsSourcesWise(queries) {
    console.log('🌐 開始網絡新聞搜尋...');
    console.log(`📋 搜尋查詢: ${queries.join(', ')}`);

    const allArticles = [];
    const searchResults = {
        timestamp: new Date().toISOString(),
        queries: queries,
        sources: [],
        articles: [],
        trustedArticles: [],
        errors: [],
        apiUsage: {}
    };

    // 設置整體超時（40 秒，預留 20 秒給 AI 調用）
    const TIMEOUT_MS = 40000;
    const startTime = Date.now();

    // 超時檢查函數
    const checkTimeout = () => {
        const elapsed = Date.now() - startTime;
        if (elapsed > TIMEOUT_MS) {
            throw new Error(`網絡搜尋超時（${TIMEOUT_MS/1000}秒）`);
        }
    };

    try {
        // 1. Google News RSS 搜尋（免費無限制，最可靠）- 限制每個請求 6 秒
        for (const query of queries) {
            checkTimeout();
            try {
                const articles = await Promise.race([
                    searchGoogleNewsRss(query),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Google News RSS 超時')), 6000)
                    )
                ]);
                // 標記來源可信度
            articles.forEach(a => {
                a.isTrustedSource = isTrustedNewsSource(a.url || '');
            });
            allArticles.push(...articles);
            if (articles.length > 0) {
                searchResults.sources.push('Google News RSS');
            }
        } catch (error) {
            searchResults.errors.push({ source: 'Google News RSS', error: error.message });
        }
    }

    // 2. GNews API 已停用（對中文/香港新聞支援較差）
    // if (NEWS_APIS.gnews.enabled && NEWS_APIS.gnews.apiKey && hasApiQuota('gnews')) { ... }

    // 3. 使用 NewsData.io API（200 請求/天）- 只用 2 個查詢，每個 8 秒超時
    checkTimeout();
    if (NEWS_APIS.newsdata.apiKey && hasApiQuota('newsdata')) {
        const newsdataQueries = queries.slice(0, 2);
        for (const query of newsdataQueries) {
            checkTimeout();
            try {
                const articles = await Promise.race([
                    searchNewsDataIo(query),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('NewsData.io 超時')), 8000)
                    )
                ]);
                allArticles.push(...articles);
                if (articles.length > 0) {
                    searchResults.sources.push('NewsData.io');
                }
            } catch (error) {
                searchResults.errors.push({ source: 'NewsData.io', error: error.message });
            }
        }
    }

    // 4. 獲取官方 RSS 源（最可信）- 10 秒超時
    checkTimeout();
    try {
        const officialArticles = await Promise.race([
            fetchOfficialRssFeeds(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Official RSS 超時')), 10000)
            )
        ]);
        // 官方來源全部標記為可信
        officialArticles.forEach(a => {
            a.isTrustedSource = true;
            a.isOfficial = true;
        });
        allArticles.push(...officialArticles);
        if (officialArticles.length > 0) {
            searchResults.sources.push('Official RSS');
        }
    } catch (error) {
        searchResults.errors.push({ source: 'Official RSS', error: error.message });
    }

    // 去重（根據標題相似度）
    const uniqueArticles = deduplicateArticles(allArticles);
    
    // 過濾最近 7 天的新聞
    const recentArticles = filterRecentArticles(uniqueArticles, 7);
    
    // 對每篇文章進行事實核查評分
    recentArticles.forEach(article => {
        article.factCheck = factCheckArticle(article);
    });
    
    // 按相關性和時間排序
    const sortedArticles = sortArticlesByRelevance(recentArticles, queries);
    
    // 分離可信和不可信文章
    const trustedArticles = sortedArticles.filter(a => a.factCheck?.isReliable || a.isTrustedSource);
    const untrustedArticles = sortedArticles.filter(a => !a.factCheck?.isReliable && !a.isTrustedSource);

    // 優先返回可信來源的文章
    const finalArticles = [...trustedArticles, ...untrustedArticles].slice(0, 50);

    searchResults.articles = finalArticles;
    searchResults.trustedArticles = trustedArticles.slice(0, 30);
    searchResults.totalFound = allArticles.length;
    searchResults.uniqueCount = uniqueArticles.length;
    searchResults.recentCount = recentArticles.length;
    searchResults.trustedCount = trustedArticles.length;
    searchResults.apiUsage = {
        gnews: apiUsageCounters.gnews,
        newsdata: apiUsageCounters.newsdata
    };
    
    console.log(`✅ 網絡搜尋完成: 總共 ${allArticles.length} 篇 → 去重後 ${uniqueArticles.length} 篇 → 最近7天 ${recentArticles.length} 篇 → 可信來源 ${trustedArticles.length} 篇`);

    return searchResults;
    } catch (error) {
        // 捕獲超時錯誤
        if (error.message.includes('超時')) {
            console.warn(`⚠️ ${error.message}，返回已獲取的結果`);
            searchResults.errors.push({ source: '整體搜尋', error: error.message });
            // 即使超時，也返回已獲取的文章
            const uniqueArticles = deduplicateArticles(allArticles);
            const recentArticles = filterRecentArticles(uniqueArticles, 7);
            searchResults.articles = recentArticles.slice(0, 50);
            searchResults.trustedArticles = recentArticles.filter(a => a.isTrustedSource).slice(0, 30);
            searchResults.totalFound = allArticles.length;
            searchResults.uniqueCount = uniqueArticles.length;
            searchResults.recentCount = recentArticles.length;
            searchResults.partial = true; // 標記為部分結果
            return searchResults;
        }
        throw error; // 其他錯誤重新拋出
    }
}

/**
 * 去重文章（基於標題相似度）
 */
function deduplicateArticles(articles) {
    const seen = new Map();
    
    return articles.filter(article => {
        // 簡化標題用於比較
        const simplifiedTitle = article.title
            .toLowerCase()
            .replace(/[^\u4e00-\u9fa5a-z0-9]/g, '')
            .substring(0, 30);
        
        if (seen.has(simplifiedTitle)) {
            return false;
        }
        
        seen.set(simplifiedTitle, true);
        return true;
    });
}

/**
 * 過濾最近 N 天的文章
 */
function filterRecentArticles(articles, days) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    return articles.filter(article => {
        if (!article.publishedAt) return true; // 如果沒有日期，保留
        
        try {
            const articleDate = new Date(article.publishedAt);
            return articleDate >= cutoffDate;
        } catch {
            return true;
        }
    });
}

/**
 * 按相關性排序文章
 */
function sortArticlesByRelevance(articles, queries) {
    const keywords = queries.flatMap(q => q.split(/\s+/));
    
    return articles.sort((a, b) => {
        // 計算相關性分數
        const scoreA = calculateRelevanceScore(a, keywords);
        const scoreB = calculateRelevanceScore(b, keywords);
        
        if (scoreB !== scoreA) {
            return scoreB - scoreA;
        }
        
        // 相關性相同時，按時間排序（最新優先）
        const dateA = new Date(a.publishedAt || 0);
        const dateB = new Date(b.publishedAt || 0);
        return dateB - dateA;
    });
}

/**
 * 計算文章相關性分數
 */
function calculateRelevanceScore(article, keywords) {
    let score = 0;
    const content = `${article.title} ${article.description}`.toLowerCase();
    
    // 高權重關鍵詞
    const highPriorityKeywords = ['北區醫院', '急症室', '醫管局', '急症', '政策', '收費'];
    const mediumPriorityKeywords = ['醫院', '衛生', '健康', '病人', '求診'];
    
    for (const keyword of highPriorityKeywords) {
        if (content.includes(keyword.toLowerCase())) {
            score += 10;
        }
    }
    
    for (const keyword of mediumPriorityKeywords) {
        if (content.includes(keyword.toLowerCase())) {
            score += 5;
        }
    }
    
    for (const keyword of keywords) {
        if (content.includes(keyword.toLowerCase())) {
            score += 2;
        }
    }
    
    return score;
}

// ============================================
// 醫院相關新聞搜尋
// ============================================

/**
 * 搜尋北區醫院和急症室相關新聞
 */
async function searchHospitalNews() {
    const queries = [
        '北區醫院 急症室',
        '醫管局 急症室 政策',
        '香港 急症室 收費',
        '醫院管理局 公告',
        '衛生防護中心 疫情'
    ];
    
    return await searchAllNewsSourcesWise(queries);
}

/**
 * 搜尋突發事件新聞
 */
async function searchEmergencyNews() {
    const queries = [
        '香港 突發 意外',
        '香港 大型活動',
        '香港 交通事故 重大',
        '香港 傳染病 爆發'
    ];
    
    return await searchAllNewsSourcesWise(queries);
}

/**
 * 搜尋健康政策新聞
 */
async function searchHealthPolicyNews() {
    const queries = [
        '醫管局 政策 2026',
        '急症室 收費 調整',
        '醫療服務 變更',
        '衛生署 公告'
    ];
    
    return await searchAllNewsSourcesWise(queries);
}

// ============================================
// 格式化搜尋結果供 AI 分析
// ============================================

/**
 * 將搜尋結果格式化為 AI 可分析的文本
 * 優先顯示可信來源的新聞
 */
function formatSearchResultsForAI(searchResults) {
    if (!searchResults || !searchResults.articles || searchResults.articles.length === 0) {
        return `**網絡搜尋結果**：未找到相關新聞。\n搜尋時間：${new Date().toISOString()}`;
    }

    let formatted = `**🌐 網絡新聞搜尋結果（已事實核查）**\n`;
    formatted += `搜尋時間：${searchResults.timestamp}\n`;
    formatted += `搜尋來源：${[...new Set(searchResults.sources)].join(', ')}\n`;
    formatted += `找到文章：${searchResults.articles.length} 篇（最近 7 天）\n`;
    formatted += `可信來源：${searchResults.trustedCount || 0} 篇\n\n`;
    
    // 先顯示可信來源的新聞
    const trustedArticles = searchResults.articles.filter(a => a.isTrustedSource || a.isOfficial);
    const otherArticles = searchResults.articles.filter(a => !a.isTrustedSource && !a.isOfficial);
    
    if (trustedArticles.length > 0) {
        formatted += `**✅ 可信來源新聞（官方/主流媒體）：**\n\n`;
        trustedArticles.slice(0, 15).forEach((article, index) => {
            const trustBadge = article.isOfficial ? '🏛️ 官方' : '✅ 主流媒體';
            formatted += `${index + 1}. **${article.title}** [${trustBadge}]\n`;
            formatted += `   - 來源：${article.newsSource || article.source}\n`;
            if (article.publishedAt) {
                formatted += `   - 發布時間：${article.publishedAt}\n`;
            }
            if (article.description) {
                formatted += `   - 摘要：${article.description.substring(0, 200)}...\n`;
            }
            if (article.url) {
                formatted += `   - 連結：${article.url}\n`;
            }
            formatted += '\n';
        });
    }
    
    if (otherArticles.length > 0) {
        formatted += `\n**📰 其他新聞來源（請謹慎核實）：**\n\n`;
        otherArticles.slice(0, 10).forEach((article, index) => {
            formatted += `${index + 1}. **${article.title}** [⚠️ 待核實]\n`;
            formatted += `   - 來源：${article.newsSource || article.source}\n`;
            if (article.publishedAt) {
                formatted += `   - 發布時間：${article.publishedAt}\n`;
            }
            if (article.url) {
                formatted += `   - 連結：${article.url}\n`;
            }
            formatted += '\n';
        });
    }

    if (searchResults.errors && searchResults.errors.length > 0) {
        formatted += `\n**⚠️ 搜尋錯誤：**\n`;
        searchResults.errors.forEach(err => {
            formatted += `- ${err.source}: ${err.error}\n`;
        });
    }
    
    formatted += `\n**📊 事實核查說明：**\n`;
    formatted += `- ✅ 可信來源：官方網站（政府、醫管局）和主流媒體\n`;
    formatted += `- ⚠️ 待核實：其他來源，請交叉驗證後再引用\n`;
    formatted += `- 分析時請優先參考可信來源的資訊\n`;

    return formatted;
}

// ============================================
// 導出模組
// ============================================

module.exports = {
    // 搜尋函數
    searchGoogleNewsRss,
    searchNewsDataIo,
    searchGNews,
    fetchOfficialRssFeeds,
    searchAllNewsSourcesWise,
    
    // 專門搜尋
    searchHospitalNews,
    searchEmergencyNews,
    searchHealthPolicyNews,
    
    // 事實核查
    isTrustedNewsSource,
    factCheckArticle,
    
    // 工具函數
    formatSearchResultsForAI,
    
    // 配置
    NEWS_APIS,
    SEARCH_KEYWORDS,
    OFFICIAL_RSS_FEEDS,
    TRUSTED_NEWS_SOURCES,
    
    // API 使用統計
    getApiUsage: () => apiUsageCounters
};
