/**
 * 天氣模組 - 使用香港天文台 Open Data API
 * 此模組作為備用，主要天氣邏輯在 prediction.js 中
 */

const HKO_API = {
    current: 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc',
    forecast: 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=tc',
    warning: 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=tc'
};

// 北區醫院附近站點
const NORTH_DISTRICT_STATIONS = ['上水', '打鼓嶺', '流浮山', '大埔'];

export class Weather {
    static currentWeather = null;
    static forecast = null;
    static lastFetch = null;
    static cacheTTL = 10 * 60 * 1000; // 10 分鐘緩存

    static async init() {
        await this.fetchCurrent();
        await this.fetchForecast();
        this.updateDisplay();
    }

    static async update() {
        await this.fetchCurrent();
        this.updateDisplay();
    }

    static async fetchCurrent() {
        // 檢查緩存
        if (this.currentWeather && this.lastFetch && (Date.now() - this.lastFetch) < this.cacheTTL) {
            return this.currentWeather;
        }

        try {
            const response = await fetch(HKO_API.current);
            if (!response.ok) throw new Error('HKO API error');
            
            const data = await response.json();
            
            // 獲取北區溫度
            let temperature = null;
            if (data.temperature?.data) {
                const northStation = data.temperature.data.find(
                    s => NORTH_DISTRICT_STATIONS.some(name => s.place.includes(name))
                );
                temperature = northStation?.value || data.temperature.data[0]?.value;
            }
            
            // 獲取濕度
            const humidity = data.humidity?.data?.[0]?.value || null;
            
            // 獲取降雨
            let rainfall = 0;
            if (data.rainfall?.data) {
                const northRain = data.rainfall.data.find(
                    s => NORTH_DISTRICT_STATIONS.some(name => s.place.includes(name))
                );
                rainfall = northRain?.max || 0;
            }
            
            this.currentWeather = {
                temperature: temperature ? Math.round(temperature * 10) / 10 : null,
                humidity: humidity,
                rainfall: rainfall,
                icon: data.icon?.[0] || 50,
                uvIndex: data.uvindex?.data?.[0]?.value || null,
                description: this.getWeatherDescription(data.icon?.[0])
            };
            
            this.lastFetch = Date.now();
            console.log('🌤️ 天氣數據已更新 (HKO API):', this.currentWeather);
            
            return this.currentWeather;
        } catch (error) {
            console.error('❌ 獲取 HKO 天氣失敗:', error);
            return null;
        }
    }

    static async fetchForecast() {
        try {
            const response = await fetch(HKO_API.forecast);
            if (!response.ok) throw new Error('HKO Forecast API error');
            
            const data = await response.json();
            this.forecast = data.weatherForecast || [];
            console.log('📅 天氣預報已更新:', this.forecast.length, '天');
            
            return this.forecast;
        } catch (error) {
            console.error('❌ 獲取天氣預報失敗:', error);
            return [];
        }
    }

    static getWeatherDescription(iconCode) {
        // HKO 天氣圖標代碼完整對照表
        // https://www.hko.gov.hk/en/weathericon/weathericon.htm
        const descriptions = {
            50: '晴天', 51: '間有陽光', 52: '短暫陽光', 53: '多雲', 54: '密雲',
            60: '有雨', 61: '間有驟雨', 62: '有驟雨', 63: '有雷暴', 64: '雷暴',
            65: '大雷暴', 
            70: '天晴', 71: '天晴', 72: '天晴', 73: '晴間多雲',
            74: '多雲', 75: '多雲', 76: '多雲', 77: '密雲',  // 夜間多雲
            80: '大風', 81: '乾燥', 82: '潮濕', 83: '霧', 84: '薄霧',
            85: '煙霞', 90: '熱帶氣旋', 91: '颱風', 92: '強颱風', 93: '超強颱風'
        };
        return descriptions[iconCode] || `天氣(${iconCode})`;
    }

    static getWeatherIcon(iconCode) {
        // HKO 天氣圖標代碼完整對照表
        const icons = {
            50: '☀️', 51: '🌤️', 52: '⛅', 53: '🌥️', 54: '☁️',
            60: '🌧️', 61: '🌧️', 62: '🌧️', 63: '⛈️', 64: '⛈️',
            65: '⛈️', 
            70: '🌙', 71: '🌙', 72: '🌙', 73: '🌙',
            74: '🌥️', 75: '🌥️', 76: '☁️', 77: '☁️',  // 夜間多雲
            80: '💨', 81: '🏜️', 82: '💧', 83: '🌫️', 84: '🌫️',
            85: '😷', 90: '🌀', 91: '🌀', 92: '🌀', 93: '🌀'
        };
        return icons[iconCode] || '🌤️';
    }

    static updateDisplay() {
        const el = document.getElementById('weather-display');
        if (!el) return;
        
        if (!this.currentWeather) {
            el.innerHTML = '<span class="weather-loading">⏳ 載入天氣資料...</span>';
            return;
        }

        const weather = this.currentWeather;
        const icon = this.getWeatherIcon(weather.icon);
        
        el.innerHTML = `
            <span class="weather-icon">${icon}</span>
            <span class="weather-temp">${weather.temperature !== null ? weather.temperature + '°C' : '--'}</span>
            <span class="weather-desc">${weather.description}</span>
        `;
    }
}
