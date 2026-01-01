/**
 * 從 Hospital Authority AED 報告中提取所有日期和就診人數
 * 處理 2015-2025 年的完整數據
 */

const fs = require('fs');
const path = require('path');

/**
 * 從報告文本中提取日期和就診人數的配對
 * 策略：尋找 "Reg. date" 後面的日期序列和對應的數字序列
 */
function extractDataFromReports(fullText) {
    const allData = [];
    
    // 將文本按報告分割（每個報告以 "For Period:" 開始）
    const reports = fullText.split(/For Period:\s*\d{2}\/\d{2}\/\d{4}\s+to\s+\d{2}\/\d{2}\/\d{4}/gi);
    
    for (let reportIndex = 0; reportIndex < reports.length; reportIndex++) {
        const report = reports[reportIndex];
        
        // 提取報告期間
        const periodMatch = report.match(/For Period:\s*(\d{2}\/\d{2}\/\d{4})\s+to\s+(\d{2}\/\d{2}\/\d{4})/i);
        if (!periodMatch) continue;
        
        const startDate = periodMatch[1];
        const endDate = periodMatch[2];
        
        // 在報告中尋找 "Reg. date" 後面的日期列表
        const regDateSection = report.match(/Reg\. date([\s\S]*?)(?=Date :Time :|Attendance|Hospital Authority|$)/i);
        if (!regDateSection) continue;
        
        // 提取所有日期
        const dateRegex = /(\d{2}\/\d{2}\/\d{4})/g;
        const dates = [];
        let dateMatch;
        while ((dateMatch = dateRegex.exec(regDateSection[1])) !== null) {
            dates.push(dateMatch[1]);
        }
        
        // 尋找對應的就診人數（在 "Date :Time :" 後面）
        const attendanceSection = report.match(/Date :Time :\s*([\d\s]+)/i);
        if (!attendanceSection) continue;
        
        // 提取數字序列
        const numberRegex = /\b(\d{3,4})\b/g;
        const attendances = [];
        let numMatch;
        while ((numMatch = numberRegex.exec(attendanceSection[1])) !== null) {
            const num = parseInt(numMatch[1]);
            // 過濾：排除年份、頁碼等
            if (num >= 100 && num <= 9999 && num < 2015) {
                attendances.push(num);
            }
        }
        
        // 配對日期和就診人數
        const minLength = Math.min(dates.length, attendances.length);
        for (let i = 0; i < minLength; i++) {
            const dateStr = dates[i];
            const attendance = attendances[i];
            
            // 轉換日期格式
            const [day, month, year] = dateStr.split('/');
            const isoDate = `${year}-${month}-${day}`;
            
            allData.push({
                date: isoDate,
                attendance: attendance,
                original_date: dateStr,
                report_period: `${startDate} to ${endDate}`
            });
        }
    }
    
    // 去重（基於日期）
    const uniqueData = [];
    const seenDates = new Set();
    
    for (let item of allData) {
        if (!seenDates.has(item.date)) {
            seenDates.add(item.date);
            uniqueData.push(item);
        } else {
            // 如果日期重複，保留較新的數據（後面的報告）
            const existingIndex = uniqueData.findIndex(d => d.date === item.date);
            if (existingIndex >= 0) {
                uniqueData[existingIndex] = item;
            }
        }
    }
    
    // 按日期排序
    uniqueData.sort((a, b) => a.date.localeCompare(b.date));
    
    return uniqueData;
}

/**
 * 手動構建完整的數據集（基於用戶提供的可見數據）
 * 這是更可靠的方法，因為原始文本格式複雜
 */
function buildCompleteDataset() {
    const allData = [];
    
    // 由於數據量巨大且格式複雜，我們需要從用戶提供的文本中
    // 系統性地提取每個報告期間的數據
    
    // 這裡我們創建一個結構來存儲所有年份的數據
    // 實際數據需要從用戶提供的完整文本中提取
    
    console.log('📝 請將完整的報告文本保存到文件，然後使用 extractDataFromReports() 函數解析');
    
    return allData;
}

// 如果直接運行此腳本
if (require.main === module) {
    console.log('📊 AED 數據提取工具');
    console.log('使用方法：');
    console.log('1. 將完整的報告文本保存到文件（如：aed-reports.txt）');
    console.log('2. 使用 extractDataFromReports() 函數解析');
    console.log('\n或者直接從用戶提供的文本中手動提取數據');
}

module.exports = { extractDataFromReports, buildCompleteDataset };
