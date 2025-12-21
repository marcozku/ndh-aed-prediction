/**
 * 部署時自動添加數據的腳本
 * 如果數據庫中沒有 1/12 到 12/12 的實際數據，自動添加
 * 可以在 server.js 啟動時調用，或作為獨立腳本運行
 */

require('dotenv').config();

const db = require('./database');

const ACTUAL_DATA = [
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

async function autoAddData() {
    if (!db || !db.pool) {
        console.log('⚠️ 數據庫未配置，跳過自動添加數據');
        return;
    }

    try {
        console.log('📊 檢查是否需要添加實際數據...');
        
        let addedCount = 0;
        let existingCount = 0;

        for (const data of ACTUAL_DATA) {
            try {
                // 檢查是否已存在
                const existing = await db.pool.query(
                    'SELECT * FROM actual_data WHERE date = $1',
                    [data.date]
                );

                if (existing.rows.length === 0) {
                    // 添加數據
                    await db.insertActualData(
                        data.date,
                        data.patient_count,
                        'auto_deploy',
                        'Auto-added on deployment'
                    );
                    
                    // 計算準確度
                    try {
                        await db.calculateAccuracy(data.date);
                    } catch (err) {
                        // 如果沒有預測數據，忽略錯誤
                    }
                    
                    addedCount++;
                    console.log(`  ✅ 已添加 ${data.date}: ${data.patient_count} 人`);
                } else {
                    existingCount++;
                }
            } catch (err) {
                console.error(`  ❌ 處理 ${data.date} 時出錯:`, err.message);
            }
        }

        if (addedCount > 0) {
            console.log(`\n✅ 自動添加了 ${addedCount} 筆新數據`);
        }
        if (existingCount > 0) {
            console.log(`ℹ️  ${existingCount} 筆數據已存在`);
        }
        if (addedCount === 0 && existingCount === ACTUAL_DATA.length) {
            console.log('✅ 所有數據已存在，無需添加');
        }
    } catch (error) {
        console.error('❌ 自動添加數據時出錯:', error.message);
    }
}

// 如果直接運行此腳本
if (require.main === module) {
    db.initDatabase().then(() => {
        return autoAddData();
    }).then(() => {
        process.exit(0);
    }).catch(err => {
        console.error('❌ 執行失敗:', err);
        process.exit(1);
    });
}

module.exports = { autoAddData };
