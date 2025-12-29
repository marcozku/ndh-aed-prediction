// Check database for missing data gaps
const https = require('https');

function fetchData(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
}

async function checkDataGaps() {
    try {
        console.log('🔍 Fetching data from API...\n');
        const json = await fetchData('https://ndhaedprediction.up.railway.app/api/actual-data');
        
        if (json.success && json.data) {
            const dates = json.data.map(d => new Date(d.date)).sort((a, b) => a - b);
            
            console.log('=== 數據庫統計 ===');
            console.log('總數據筆數:', dates.length);
            console.log('日期範圍:', dates[0].toISOString().split('T')[0], '至', dates[dates.length - 1].toISOString().split('T')[0]);
            
            // Calculate how many days should be there
            const startDate = dates[0];
            const endDate = dates[dates.length - 1];
            const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
            console.log('理論天數:', totalDays);
            console.log('實際數據筆數:', dates.length);
            console.log('缺失天數:', totalDays - dates.length);
            console.log('數據覆蓋率:', ((dates.length / totalDays) * 100).toFixed(2) + '%');
            
            // Find gaps greater than 7 days
            console.log('\n=== 大於 7 天的數據間隙 ===');
            let gapCount = 0;
            const gaps = [];
            for (let i = 1; i < dates.length; i++) {
                const diff = (dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24);
                if (diff > 7) {
                    const gap = {
                        from: dates[i - 1].toISOString().split('T')[0],
                        to: dates[i].toISOString().split('T')[0],
                        days: Math.floor(diff)
                    };
                    gaps.push(gap);
                    console.log(`${gap.from} → ${gap.to} (${gap.days} 天)`);
                    gapCount++;
                }
            }
            console.log(`\n總計 ${gapCount} 個大於 7 天的間隙`);
            
            // Find gaps greater than 30 days (significant gaps)
            console.log('\n=== 大於 30 天的重大間隙 ===');
            const majorGaps = gaps.filter(g => g.days > 30);
            majorGaps.forEach(gap => {
                console.log(`${gap.from} → ${gap.to} (${gap.days} 天)`);
            });
            console.log(`總計 ${majorGaps.length} 個大於 30 天的重大間隙`);
            
            // Analyze by year
            console.log('\n=== 按年份分析 ===');
            const yearData = {};
            dates.forEach(d => {
                const year = d.getFullYear();
                if (!yearData[year]) yearData[year] = [];
                yearData[year].push(d);
            });
            
            Object.keys(yearData).sort().forEach(year => {
                const yearDates = yearData[year];
                const minDate = yearDates[0];
                const maxDate = yearDates[yearDates.length - 1];
                console.log(`${year}: ${yearDates.length} 筆 (${minDate.toISOString().split('T')[0]} 至 ${maxDate.toISOString().split('T')[0]})`);
            });
            
        } else {
            console.error('API 返回無效數據:', json);
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
}

checkDataGaps();

