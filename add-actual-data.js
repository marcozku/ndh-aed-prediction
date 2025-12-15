/**
 * 添加實際數據並與預測數據進行比較
 * 使用方式: node add-actual-data.js
 */

const http = require('http');

// 實際數據（日期格式：DD/MM/YYYY -> 轉換為 YYYY-MM-DD）
// 1/12 到 12/12 的實際數據
const actualData = [
    { date: '2025-12-01', patient_count: 276 },
    { date: '2025-12-02', patient_count: 285 },
    { date: '2025-12-03', patient_count: 253 },
    { date: '2025-12-04', patient_count: 234 },
    { date: '2025-12-05', patient_count: 262 },
    { date: '2025-12-06', patient_count: 234 },
    { date: '2025-12-07', patient_count: 244 },
    { date: '2025-12-08', patient_count: 293 },
    { date: '2025-12-09', patient_count: 253 },
    { date: '2025-12-10', patient_count: 219 },
    { date: '2025-12-11', patient_count: 275 },
    { date: '2025-12-12', patient_count: 248 }
];

// 發送 POST 請求到 API
function addActualData() {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(actualData);
        
        const options = {
            hostname: 'localhost',
            port: process.env.PORT || 3001,
            path: '/api/actual-data',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };

        const req = http.request(options, (res) => {
            let responseData = '';

            res.on('data', (chunk) => {
                responseData += chunk;
            });

            res.on('end', () => {
                try {
                    const result = JSON.parse(responseData);
                    if (res.statusCode === 200 && result.success) {
                        console.log(`✅ 成功添加 ${result.inserted || result.data ? 1 : actualData.length} 筆實際數據`);
                        console.log('📊 數據已添加並自動計算準確度');
                        resolve(result);
                    } else {
                        console.error('❌ 添加數據失敗:', result.error || responseData);
                        reject(new Error(result.error || 'Unknown error'));
                    }
                } catch (error) {
                    console.error('❌ 解析響應失敗:', error.message);
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            console.error('❌ 請求失敗:', error.message);
            reject(error);
        });

        req.write(data);
        req.end();
    });
}

// 主函數
async function main() {
    console.log('📊 開始添加實際數據...');
    console.log('數據列表:');
    actualData.forEach(item => {
        console.log(`  ${item.date}: ${item.patient_count} 人`);
    });
    console.log('');

    try {
        await addActualData();
        console.log('');
        console.log('✅ 所有數據已成功添加！');
        console.log('💡 提示：系統會自動計算這些日期與預測數據的準確度');
        console.log('💡 你可以在網頁上查看「實際 vs 預測對比」圖表和「詳細比較數據」表格');
    } catch (error) {
        console.error('❌ 添加數據時發生錯誤:', error.message);
        process.exit(1);
    }
}

// 執行
if (require.main === module) {
    main();
}

module.exports = { addActualData, actualData };



