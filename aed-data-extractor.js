/**
 * 從 Hospital Authority AED 報告中提取所有日期和就診人數
 * 完整處理 2015-2025 年的數據
 */

const fs = require('fs');
const path = require('path');

/**
 * 從完整文本中提取所有日期和就診人數
 * 這個函數會處理用戶提供的完整報告文本
 */
function extractAllAEDData(fullText) {
    const results = [];
    
    // 策略1：尋找 "Reg. date" 後面的日期序列
    // 和 "Date :Time :" 後面的數字序列
    
    // 將文本按頁面分割
    const pages = fullText.split(/Page :\s*AE_ATT02\s+of\s+\d+/gi);
    
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const page = pages[pageIndex];
        
        // 提取日期（格式：DD/MM/YYYY）
        const dateMatches = [];
        const dateRegex = /(\d{2}\/\d{2}\/\d{4})/g;
        let dateMatch;
        while ((dateMatch = dateRegex.exec(page)) !== null) {
            const dateStr = dateMatch[1];
            // 驗證日期格式（排除明顯的錯誤）
            const [day, month, year] = dateStr.split('/');
            const dayNum = parseInt(day);
            const monthNum = parseInt(month);
            const yearNum = parseInt(year);
            
            // 基本驗證
            if (yearNum >= 2015 && yearNum <= 2025 && monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
                dateMatches.push(dateStr);
            }
        }
        
        // 提取就診人數（3-4位數字，範圍 100-9999）
        const attendanceMatches = [];
        const attendanceRegex = /\b(\d{3,4})\b/g;
        let attMatch;
        while ((attMatch = attendanceRegex.exec(page)) !== null) {
            const num = parseInt(attMatch[1]);
            // 過濾：排除年份、頁碼、總計等
            if (num >= 100 && num <= 9999 && num < 2015) {
                attendanceMatches.push(num);
            }
        }
        
        // 嘗試配對日期和就診人數
        // 由於格式不規則，我們需要找到正確的對應關係
        // 通常日期和數字是按順序對應的
        
        const minLength = Math.min(dateMatches.length, attendanceMatches.length);
        
        // 如果數量匹配或接近，進行配對
        if (minLength > 0 && Math.abs(dateMatches.length - attendanceMatches.length) <= 5) {
            for (let i = 0; i < minLength; i++) {
                const dateStr = dateMatches[i];
                const attendance = attendanceMatches[i];
                
                // 轉換日期格式
                const [day, month, year] = dateStr.split('/');
                const isoDate = `${year}-${month}-${day}`;
                
                results.push({
                    date: isoDate,
                    attendance: attendance,
                    original_date: dateStr,
                    page: pageIndex + 1
                });
            }
        }
    }
    
    // 去重（基於日期）
    const uniqueResults = [];
    const seenDates = new Set();
    
    for (let item of results) {
        if (!seenDates.has(item.date)) {
            seenDates.add(item.date);
            uniqueResults.push(item);
        } else {
            // 如果日期重複，保留較新的數據
            const existingIndex = uniqueResults.findIndex(d => d.date === item.date);
            if (existingIndex >= 0 && item.page > uniqueResults[existingIndex].page) {
                uniqueResults[existingIndex] = item;
            }
        }
    }
    
    // 按日期排序
    uniqueResults.sort((a, b) => a.date.localeCompare(b.date));
    
    return uniqueResults;
}

/**
 * 從文件讀取並解析
 */
function extractFromFile(filePath) {
    try {
        const fullText = fs.readFileSync(filePath, 'utf8');
        return extractAllAEDData(fullText);
    } catch (error) {
        console.error(`❌ 讀取文件失敗: ${error.message}`);
        return [];
    }
}

/**
 * 保存結果到文件
 */
function saveResults(data, outputDir = __dirname) {
    // 保存為 JSON
    const jsonPath = path.join(outputDir, 'aed-data-complete.json');
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`✅ JSON 數據已保存到 ${jsonPath}`);
    
    // 保存為 CSV
    const csvPath = path.join(outputDir, 'aed-data-complete.csv');
    const csvHeader = 'Date,Attendance,OriginalDate\n';
    const csvContent = data.map(item => 
        `${item.date},${item.attendance},${item.original_date}`
    ).join('\n');
    fs.writeFileSync(csvPath, csvHeader + csvContent, 'utf8');
    console.log(`✅ CSV 數據已保存到 ${csvPath}`);
    
    // 統計信息
    if (data.length > 0) {
        const dates = data.map(d => d.date).sort();
        const attendances = data.map(d => d.attendance);
        const minAtt = Math.min(...attendances);
        const maxAtt = Math.max(...attendances);
        const avgAtt = Math.round(attendances.reduce((a, b) => a + b, 0) / attendances.length);
        
        console.log('\n📊 統計信息：');
        console.log(`   總記錄數: ${data.length}`);
        console.log(`   日期範圍: ${dates[0]} 至 ${dates[dates.length - 1]}`);
        console.log(`   就診人數範圍: ${minAtt} - ${maxAtt}`);
        console.log(`   平均就診人數: ${avgAtt}`);
    }
}

// 如果直接運行此腳本
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('📊 AED 數據提取工具');
        console.log('\n使用方法：');
        console.log('  node aed-data-extractor.js <輸入文件> [輸出目錄]');
        console.log('\n示例：');
        console.log('  node aed-data-extractor.js aed-reports.txt ./output');
        console.log('\n或者將完整文本作為參數傳入：');
        console.log('  node aed-data-extractor.js --text "完整文本內容..."');
    } else if (args[0] === '--text' && args[1]) {
        // 從命令行參數讀取文本
        const fullText = args.slice(1).join(' ');
        const results = extractAllAEDData(fullText);
        console.log(`\n✅ 提取完成，共 ${results.length} 筆數據`);
        
        if (results.length > 0) {
            const outputDir = args[2] || __dirname;
            saveResults(results, outputDir);
        }
    } else {
        // 從文件讀取
        const inputFile = args[0];
        const outputDir = args[1] || __dirname;
        
        console.log(`📂 讀取文件: ${inputFile}`);
        const results = extractFromFile(inputFile);
        
        if (results.length > 0) {
            console.log(`✅ 提取完成，共 ${results.length} 筆數據`);
            saveResults(results, outputDir);
        } else {
            console.log('⚠️  未能提取到數據');
        }
    }
}

module.exports = { extractAllAEDData, extractFromFile, saveResults };
