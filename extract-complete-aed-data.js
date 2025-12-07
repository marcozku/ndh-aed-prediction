/**
 * 從完整報告文本中提取所有 AED 日期和就診人數
 * 處理 2015-2025 年的完整數據集
 */

const fs = require('fs');
const path = require('path');

// 用戶提供的完整文本（從查詢中複製）
// 由於文本太長，我們將從標準輸入或文件讀取

/**
 * 智能解析報告文本
 * 策略：尋找日期和數字的配對模式
 */
function parseReportText(text) {
    const allData = [];
    
    // 方法1：尋找 "Reg. date" 後面的日期序列
    // 和對應的數字序列（在 "Date :Time :" 後面）
    
    // 將文本按報告期間分割
    const periodRegex = /For Period:\s*(\d{2}\/\d{2}\/\d{4})\s+to\s+(\d{2}\/\d{2}\/\d{4})/gi;
    const periods = [];
    let periodMatch;
    
    while ((periodMatch = periodRegex.exec(text)) !== null) {
        periods.push({
            start: periodMatch[1],
            end: periodMatch[2],
            index: periodMatch.index
        });
    }
    
    // 處理每個報告期間
    for (let i = 0; i < periods.length; i++) {
        const period = periods[i];
        const nextPeriodIndex = i < periods.length - 1 ? periods[i + 1].index : text.length;
        const reportText = text.substring(period.index, nextPeriodIndex);
        
        // 在這個報告中尋找日期和數字
        const dates = [];
        const dateRegex = /(\d{2}\/\d{2}\/\d{4})/g;
        let dateMatch;
        
        while ((dateMatch = dateRegex.exec(reportText)) !== null) {
            const dateStr = dateMatch[1];
            const [day, month, year] = dateStr.split('/');
            const dayNum = parseInt(day);
            const monthNum = parseInt(month);
            const yearNum = parseInt(year);
            
            // 驗證日期
            if (yearNum >= 2015 && yearNum <= 2025 && 
                monthNum >= 1 && monthNum <= 12 && 
                dayNum >= 1 && dayNum <= 31) {
                dates.push({
                    original: dateStr,
                    iso: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
                });
            }
        }
        
        // 尋找就診人數（在 "Date :Time :" 後面的數字序列）
        const attendanceSection = reportText.match(/Date :Time :\s*([\d\s\n]+)/i);
        if (attendanceSection) {
            const numbers = attendanceSection[1].match(/\b(\d{3,4})\b/g) || [];
            const attendances = numbers
                .map(n => parseInt(n))
                .filter(n => n >= 100 && n <= 9999 && n < 2015);
            
            // 配對日期和就診人數
            const minLength = Math.min(dates.length, attendances.length);
            
            // 如果數量接近，進行配對
            if (minLength > 0 && Math.abs(dates.length - attendances.length) <= 10) {
                for (let j = 0; j < minLength; j++) {
                    allData.push({
                        date: dates[j].iso,
                        attendance: attendances[j],
                        original_date: dates[j].original,
                        period: `${period.start} to ${period.end}`
                    });
                }
            }
        }
    }
    
    // 去重並排序
    const uniqueData = [];
    const seenDates = new Set();
    
    for (let item of allData) {
        if (!seenDates.has(item.date)) {
            seenDates.add(item.date);
            uniqueData.push(item);
        }
    }
    
    uniqueData.sort((a, b) => a.date.localeCompare(b.date));
    
    return uniqueData;
}

/**
 * 從文件讀取並解析
 */
function extractFromFile(filePath) {
    try {
        console.log(`📂 讀取文件: ${filePath}`);
        const text = fs.readFileSync(filePath, 'utf8');
        return parseReportText(text);
    } catch (error) {
        console.error(`❌ 讀取文件失敗: ${error.message}`);
        return [];
    }
}

/**
 * 保存結果
 */
function saveResults(data, outputDir = __dirname) {
    if (data.length === 0) {
        console.log('⚠️  沒有數據可保存');
        return;
    }
    
    // JSON 格式
    const jsonPath = path.join(outputDir, 'aed-data-all-years.json');
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`✅ JSON 已保存: ${jsonPath}`);
    
    // CSV 格式
    const csvPath = path.join(outputDir, 'aed-data-all-years.csv');
    const csvHeader = 'Date,Attendance,OriginalDate,Period\n';
    const csvRows = data.map(item => 
        `${item.date},${item.attendance},${item.original_date},"${item.period}"`
    );
    fs.writeFileSync(csvPath, csvHeader + csvRows.join('\n'), 'utf8');
    console.log(`✅ CSV 已保存: ${csvPath}`);
    
    // 簡化版 CSV（只有日期和就診人數）
    const simpleCsvPath = path.join(outputDir, 'aed-data-simple.csv');
    const simpleCsvHeader = 'Date,Attendance\n';
    const simpleCsvRows = data.map(item => `${item.date},${item.attendance}`);
    fs.writeFileSync(simpleCsvPath, simpleCsvHeader + simpleCsvRows.join('\n'), 'utf8');
    console.log(`✅ 簡化 CSV 已保存: ${simpleCsvPath}`);
    
    // 統計信息
    const dates = data.map(d => d.date).sort();
    const attendances = data.map(d => d.attendance);
    const stats = {
        total_records: data.length,
        date_range: `${dates[0]} 至 ${dates[dates.length - 1]}`,
        min_attendance: Math.min(...attendances),
        max_attendance: Math.max(...attendances),
        avg_attendance: Math.round(attendances.reduce((a, b) => a + b, 0) / attendances.length)
    };
    
    console.log('\n📊 統計信息：');
    console.log(`   總記錄數: ${stats.total_records}`);
    console.log(`   日期範圍: ${stats.date_range}`);
    console.log(`   就診人數範圍: ${stats.min_attendance} - ${stats.max_attendance}`);
    console.log(`   平均就診人數: ${stats.avg_attendance}`);
    
    // 保存統計信息
    const statsPath = path.join(outputDir, 'aed-data-stats.json');
    fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2), 'utf8');
    console.log(`✅ 統計信息已保存: ${statsPath}`);
}

/**
 * 從標準輸入讀取
 */
function extractFromStdin() {
    return new Promise((resolve) => {
        let text = '';
        process.stdin.setEncoding('utf8');
        
        process.stdin.on('data', (chunk) => {
            text += chunk;
        });
        
        process.stdin.on('end', () => {
            resolve(parseReportText(text));
        });
    });
}

// 主程序
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
        console.log('📊 AED 數據提取工具');
        console.log('\n使用方法：');
        console.log('  從文件讀取:');
        console.log('    node extract-complete-aed-data.js <輸入文件> [輸出目錄]');
        console.log('\n  從標準輸入讀取:');
        console.log('    cat aed-reports.txt | node extract-complete-aed-data.js -');
        console.log('    echo "文本內容" | node extract-complete-aed-data.js -');
        console.log('\n示例：');
        console.log('  node extract-complete-aed-data.js aed-reports.txt');
        console.log('  node extract-complete-aed-data.js aed-reports.txt ./output');
        process.exit(1);
    }
    
    const inputSource = args[0];
    const outputDir = args[1] || __dirname;
    
    console.log('🚀 開始提取 AED 數據...\n');
    
    if (inputSource === '-') {
        // 從標準輸入讀取
        extractFromStdin().then(results => {
            if (results.length > 0) {
                console.log(`\n✅ 提取完成，共 ${results.length} 筆數據\n`);
                saveResults(results, outputDir);
            } else {
                console.log('\n⚠️  未能提取到數據');
                console.log('   請檢查輸入格式是否正確');
                process.exit(1);
            }
        });
    } else {
        // 從文件讀取
        const results = extractFromFile(inputSource);
        
        if (results.length > 0) {
            console.log(`\n✅ 提取完成，共 ${results.length} 筆數據\n`);
            saveResults(results, outputDir);
        } else {
            console.log('\n⚠️  未能提取到數據');
            console.log('   請檢查輸入文件格式是否正確');
            process.exit(1);
        }
    }
}

module.exports = { parseReportText, extractFromFile, saveResults };
