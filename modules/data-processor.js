/**
 * 數據處理模組
 * 包含數據轉換、格式化、聚合等函數
 */

// 轉換緩存（避免重複調用 API）
const conversionCache = new Map();
const pendingConversions = new Map();
const MAX_CACHE_SIZE = 1000;

/**
 * HTML 轉義
 */
export function escapeHtml(text) {
    if (!text || typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 清理問題 Unicode 字符
 */
export function cleanProblematicCharacters(text) {
    if (!text || typeof text !== 'string') return text;

    let cleaned = text
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
        .replace(/\uFFFD/g, '')
        .replace(/[◆●■▲▼★☆]/g, '');

    cleaned = cleaned.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '');

    let result = '';
    for (let i = 0; i < cleaned.length; i++) {
        const code = cleaned.charCodeAt(i);
        if (code >= 0xDC00 && code <= 0xDFFF) {
            if (i > 0) {
                const prevCode = cleaned.charCodeAt(i - 1);
                if (prevCode >= 0xD800 && prevCode <= 0xDBFF) {
                    result += cleaned[i];
                }
            }
        } else {
            result += cleaned[i];
        }
    }
    cleaned = result;

    try {
        cleaned = cleaned.normalize('NFC');
    } catch (e) {
        // 忽略標準化錯誤
    }

    return cleaned;
}

/**
 * 異步轉換繁體中文
 */
export async function convertToTraditionalAsync(text) {
    if (!text || typeof text !== 'string') return text;

    let cleaned = text.replace(/[◆●■▲▼★☆]/g, '');

    if (conversionCache.has(cleaned)) {
        return conversionCache.get(cleaned);
    }

    if (pendingConversions.has(cleaned)) {
        return await pendingConversions.get(cleaned);
    }

    if (conversionCache.size >= MAX_CACHE_SIZE) {
        const firstKey = conversionCache.keys().next().value;
        conversionCache.delete(firstKey);
    }

    const conversionPromise = (async () => {
        try {
            const response = await fetch('/api/convert-to-traditional', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: cleaned })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success && data.converted) {
                    conversionCache.set(cleaned, data.converted);
                    return data.converted;
                }
            }

            conversionCache.set(cleaned, cleaned);
            return cleaned;
        } catch (error) {
            conversionCache.set(cleaned, cleaned);
            return cleaned;
        } finally {
            pendingConversions.delete(cleaned);
        }
    })();

    pendingConversions.set(cleaned, conversionPromise);
    return await conversionPromise;
}

/**
 * 同步轉換繁體中文
 */
export function convertToTraditional(text) {
    if (!text || typeof text !== 'string') return text;

    let cleaned = cleanProblematicCharacters(text);

    if (conversionCache.has(cleaned)) {
        return conversionCache.get(cleaned);
    }

    convertToTraditionalAsync(cleaned).catch(() => {});
    return cleaned;
}

/**
 * 轉換對象為繁體中文
 */
export function convertObjectToTraditional(obj) {
    if (!obj) return obj;

    if (typeof obj === 'string') {
        return convertToTraditional(obj);
    }

    if (Array.isArray(obj)) {
        return obj.map(item => convertObjectToTraditional(item));
    }

    if (typeof obj === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = convertObjectToTraditional(value);
        }
        return result;
    }

    return obj;
}

/**
 * 異步轉換對象為繁體中文
 */
export async function convertObjectToTraditionalAsync(obj) {
    if (!obj) return obj;

    if (typeof obj === 'string') {
        return await convertToTraditionalAsync(obj);
    }

    if (Array.isArray(obj)) {
        return await Promise.all(obj.map(item => convertObjectToTraditionalAsync(item)));
    }

    if (typeof obj === 'object') {
        const result = {};
        const entries = Object.entries(obj);
        const values = await Promise.all(entries.map(([, value]) => convertObjectToTraditionalAsync(value)));
        entries.forEach(([key], index) => {
            result[key] = values[index];
        });
        return result;
    }

    return obj;
}

/**
 * 格式化日期為 DD/MM 格式
 */
export function formatDateDDMM(dateStr, includeYear = false) {
    if (!dateStr) return '';

    try {
        const date = new Date(dateStr + 'T00:00:00+08:00');
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');

        if (includeYear) {
            const year = date.getFullYear();
            return `${day}/${month}/${year}`;
        }

        return `${day}/${month}`;
    } catch (e) {
        return dateStr;
    }
}

/**
 * 從 Date 對象格式化日期
 */
export function formatDateDDMMFromDate(date, includeYear = false) {
    if (!date) return '';

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');

    if (includeYear) {
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
    }

    return `${day}/${month}`;
}

/**
 * 獲取香港時間
 */
export function getHKTime() {
    const now = new Date();
    const hkTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }));
    return hkTime;
}

/**
 * 按月聚合數據
 */
export function aggregateDataByMonth(data) {
    if (!data || data.length === 0) return [];

    const monthlyData = {};

    data.forEach(item => {
        const date = new Date(item.date);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

        if (!monthlyData[monthKey]) {
            monthlyData[monthKey] = {
                month: monthKey,
                totalAttendance: 0,
                count: 0,
                dates: []
            };
        }

        monthlyData[monthKey].totalAttendance += item.attendance;
        monthlyData[monthKey].count += 1;
        monthlyData[monthKey].dates.push(item.date);
    });

    return Object.values(monthlyData).map(month => ({
        month: month.month,
        avgAttendance: Math.round(month.totalAttendance / month.count),
        count: month.count,
        dates: month.dates
    })).sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * 均勻採樣數據
 */
export function uniformSampleData(data, targetCount) {
    if (!data || data.length <= targetCount) return data;

    const step = data.length / targetCount;
    const sampled = [];

    for (let i = 0; i < targetCount; i++) {
        const index = Math.floor(i * step);
        sampled.push(data[index]);
    }

    return sampled;
}

/**
 * 確保數據一致性
 */
export function ensureDataConsistency(data, range) {
    if (!data || data.length === 0) return data;

    const sorted = [...data].sort((a, b) => {
        const dateA = new Date(a.date || a.target_date);
        const dateB = new Date(b.date || b.target_date);
        return dateA - dateB;
    });

    return sorted;
}

/**
 * 計算準確度統計
 */
export function calculateAccuracyStats(comparisonData) {
    if (!comparisonData || comparisonData.length === 0) {
        return {
            mae: 0,
            rmse: 0,
            mape: 0,
            r2: 0,
            count: 0
        };
    }

    const errors = comparisonData.map(d => Math.abs(d.predicted - d.actual));
    const squaredErrors = comparisonData.map(d => Math.pow(d.predicted - d.actual, 2));
    const percentErrors = comparisonData.map(d =>
        d.actual > 0 ? Math.abs((d.predicted - d.actual) / d.actual) * 100 : 0
    );

    const mae = errors.reduce((a, b) => a + b, 0) / errors.length;
    const rmse = Math.sqrt(squaredErrors.reduce((a, b) => a + b, 0) / squaredErrors.length);
    const mape = percentErrors.reduce((a, b) => a + b, 0) / percentErrors.length;

    const actualMean = comparisonData.reduce((sum, d) => sum + d.actual, 0) / comparisonData.length;
    const totalSS = comparisonData.reduce((sum, d) => sum + Math.pow(d.actual - actualMean, 2), 0);
    const residualSS = squaredErrors.reduce((a, b) => a + b, 0);
    const r2 = totalSS > 0 ? 1 - (residualSS / totalSS) : 0;

    return {
        mae: Math.round(mae * 100) / 100,
        rmse: Math.round(rmse * 100) / 100,
        mape: Math.round(mape * 100) / 100,
        r2: Math.round(r2 * 10000) / 10000,
        count: comparisonData.length
    };
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * 格式化訓練日期
 */
export function formatTrainingDate(dateStr) {
    if (!dateStr) return '';

    try {
        const date = new Date(dateStr);
        return date.toLocaleString('zh-HK', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Hong_Kong'
        });
    } catch (e) {
        return dateStr;
    }
}
