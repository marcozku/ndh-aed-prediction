/**
 * 網絡搜尋模組 - 真正的互聯網新聞搜尋
 * 支持多種免費新聞 API 和 RSS 源
 */

const https = require('https');
const http = require('http');

// ============================================
// 新聞搜尋 API 配置
// ============================================

// 多個免費新聞 API（按優先級排序）
const NEWS_APIS = {
    // NewsData.io - 免費 200 請求/天
    newsdata: {
        name: 'NewsData.io',
        enabled: true,
        apiKey: process.env.NEWSDATA_API_KEY || null,
        baseUrl: 'https://newsdata.io/api/1/news',
        freeQuota: 200
    },
    // GNews API - 免費 100 請求/天
    gnews: {
        name: 'GNews',
        enabled: true,
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
async function searchNewsDataIo(query, apiKey) {
    if (!apiKey) {
        console.log('⏭️ [NewsData.io] 未設置 API Key，跳過');
        return [];
    }

    try {
        const encodedQuery = encodeURIComponent(query);
        const url = `https://newsdata.io/api/1/news?apikey=${apiKey}&q=${encodedQuery}&language=zh&country=hk`;
        
        console.log(`🔍 [NewsData.io] 搜尋: ${query}`);
        
        const response = await httpGet(url);
        const data = JSON.parse(response.data);

        if (data.status !== 'success') {
            console.warn(`⚠️ [NewsData.io] API 錯誤:`, data.message);
            return [];
        }

        const articles = (data.results || []).map(article => ({
            title: article.title,
            url: article.link,
            publishedAt: article.pubDate,
            description: article.description || '',
            newsSource: article.source_id,
            source: 'NewsData.io',
            searchQuery: query
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
async function searchGNews(query, apiKey) {
    if (!apiKey) {
        console.log('⏭️ [GNews] 未設置 API Key，跳過');
        return [];
    }

    try {
        const encodedQuery = encodeURIComponent(query);
        const url = `https://gnews.io/api/v4/search?q=${encodedQuery}&lang=zh&country=hk&token=${apiKey}`;
        
        console.log(`🔍 [GNews] 搜尋: ${query}`);
        
        const response = await httpGet(url);
        const data = JSON.parse(response.data);

        if (data.errors) {
            console.warn(`⚠️ [GNews] API 錯誤:`, data.errors);
            return [];
        }

        const articles = (data.articles || []).map(article => ({
            title: article.title,
            url: article.url,
            publishedAt: article.publishedAt,
            description: article.description || '',
            newsSource: article.source?.name || 'Unknown',
            source: 'GNews',
            searchQuery: query
        }));

        console.log(`✅ [GNews] 找到 ${articles.length} 篇文章`);
        return articles;
    } catch (error) {
        console.error(`❌ [GNews] 搜尋失敗:`, error.message);
        return [];
    }
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
 * 同時使用多個來源搜尋相關新聞
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
        errors: []
    };

    // 1. Google News RSS 搜尋（免費無限制，最可靠）
    for (const query of queries) {
        try {
            const articles = await searchGoogleNewsRss(query);
            allArticles.push(...articles);
            searchResults.sources.push('Google News RSS');
        } catch (error) {
            searchResults.errors.push({ source: 'Google News RSS', error: error.message });
        }
    }

    // 2. 嘗試 NewsData.io（如果有 API Key）
    if (NEWS_APIS.newsdata.apiKey) {
        for (const query of queries.slice(0, 2)) { // 限制查詢數量以節省配額
            try {
                const articles = await searchNewsDataIo(query, NEWS_APIS.newsdata.apiKey);
                allArticles.push(...articles);
                searchResults.sources.push('NewsData.io');
            } catch (error) {
                searchResults.errors.push({ source: 'NewsData.io', error: error.message });
            }
        }
    }

    // 3. 嘗試 GNews（如果有 API Key）
    if (NEWS_APIS.gnews.apiKey) {
        for (const query of queries.slice(0, 2)) {
            try {
                const articles = await searchGNews(query, NEWS_APIS.gnews.apiKey);
                allArticles.push(...articles);
                searchResults.sources.push('GNews');
            } catch (error) {
                searchResults.errors.push({ source: 'GNews', error: error.message });
            }
        }
    }

    // 4. 獲取官方 RSS 源
    try {
        const officialArticles = await fetchOfficialRssFeeds();
        allArticles.push(...officialArticles);
        searchResults.sources.push('Official RSS');
    } catch (error) {
        searchResults.errors.push({ source: 'Official RSS', error: error.message });
    }

    // 去重（根據標題相似度）
    const uniqueArticles = deduplicateArticles(allArticles);
    
    // 過濾最近 7 天的新聞
    const recentArticles = filterRecentArticles(uniqueArticles, 7);
    
    // 按相關性和時間排序
    const sortedArticles = sortArticlesByRelevance(recentArticles, queries);

    searchResults.articles = sortedArticles.slice(0, 50); // 最多返回 50 篇
    searchResults.totalFound = allArticles.length;
    searchResults.uniqueCount = uniqueArticles.length;
    searchResults.recentCount = recentArticles.length;
    
    console.log(`✅ 網絡搜尋完成: 總共 ${allArticles.length} 篇 → 去重後 ${uniqueArticles.length} 篇 → 最近7天 ${recentArticles.length} 篇`);
    
    return searchResults;
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
 */
function formatSearchResultsForAI(searchResults) {
    if (!searchResults || !searchResults.articles || searchResults.articles.length === 0) {
        return `**網絡搜尋結果**：未找到相關新聞。\n搜尋時間：${new Date().toISOString()}`;
    }

    let formatted = `**🌐 網絡新聞搜尋結果**\n`;
    formatted += `搜尋時間：${searchResults.timestamp}\n`;
    formatted += `搜尋來源：${[...new Set(searchResults.sources)].join(', ')}\n`;
    formatted += `找到文章：${searchResults.articles.length} 篇（最近 7 天）\n\n`;
    
    formatted += `**📰 相關新聞列表：**\n\n`;
    
    searchResults.articles.slice(0, 20).forEach((article, index) => {
        formatted += `${index + 1}. **${article.title}**\n`;
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

    if (searchResults.errors && searchResults.errors.length > 0) {
        formatted += `\n**⚠️ 搜尋錯誤：**\n`;
        searchResults.errors.forEach(err => {
            formatted += `- ${err.source}: ${err.error}\n`;
        });
    }

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
    
    // 工具函數
    formatSearchResultsForAI,
    
    // 配置
    NEWS_APIS,
    SEARCH_KEYWORDS,
    OFFICIAL_RSS_FEEDS
};
