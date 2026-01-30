/**
 * 天氣 API 模組
 * 處理天氣數據獲取、快取和影響計算
 */

// 天氣配置
export const WEATHER_CONFIG = {
    currentWeatherAPI: 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc',
    forecastAPI: 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=tc',
    warningAPI: 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=tc',

    stationName: '上水',
    nearbyStations: ['上水', '打鼓嶺', '流浮山', '大埔'],

    weatherImpactFactors: {
        temperature: {
            veryHot: { threshold: 33, factor: 1.08, desc: '酷熱' },
            hot: { threshold: 30, factor: 1.04, desc: '炎熱' },
            comfortable: { threshold: 15, factor: 1.00, desc: '舒適' },
            cold: { threshold: 10, factor: 1.06, desc: '寒冷' },
            veryCold: { threshold: 5, factor: 1.12, desc: '嚴寒' }
        },
        humidity: {
            veryHigh: { threshold: 95, factor: 1.03, desc: '極潮濕' },
            high: { threshold: 85, factor: 1.01, desc: '潮濕' },
            normal: { threshold: 60, factor: 1.00, desc: '正常' },
            low: { threshold: 40, factor: 0.99, desc: '乾燥' }
        },
        rainfall: {
            heavy: { threshold: 30, factor: 0.92, desc: '大雨' },
            moderate: { threshold: 10, factor: 0.96, desc: '中雨' },
            light: { threshold: 0.1, factor: 0.98, desc: '小雨' },
            none: { threshold: 0, factor: 1.00, desc: '無雨' }
        },
        warnings: {
            typhoon_8: { factor: 0.40, desc: '八號風球' },
            typhoon_3: { factor: 0.85, desc: '三號風球' },
            rainstorm_red: { factor: 0.75, desc: '紅雨' },
            rainstorm_amber: { factor: 0.90, desc: '黃雨' },
            cold_weather: { factor: 1.08, desc: '寒冷天氣' },
            very_hot: { factor: 1.06, desc: '酷熱天氣' }
        }
    }
};

// 全局天氣數據
export let currentWeatherData = null;
export let weatherForecastData = null;
export let weatherMonthlyAverages = null;
export let currentAQHI = null;

// 天氣快取
const weatherCache = {
    current: { data: null, timestamp: 0, ttl: 10 * 60 * 1000 },
    forecast: { data: null, timestamp: 0, ttl: 60 * 60 * 1000 },
    warnings: { data: null, timestamp: 0, ttl: 5 * 60 * 1000 },
    monthlyAvg: { data: null, timestamp: 0, ttl: 24 * 60 * 60 * 1000 }
};

/**
 * 獲取月度天氣平均
 */
export async function fetchWeatherMonthlyAverages() {
    const cache = weatherCache.monthlyAvg;
    const now = Date.now();
    if (cache.data && (now - cache.timestamp) < cache.ttl) {
        weatherMonthlyAverages = cache.data;
        return cache.data;
    }

    try {
        const response = await fetch('/api/weather-monthly-averages');
        if (!response.ok) throw new Error('API error');

        const result = await response.json();
        if (result.success || result.data) {
            weatherMonthlyAverages = result.data;
            weatherCache.monthlyAvg.data = result.data;
            weatherCache.monthlyAvg.timestamp = Date.now();
            console.log('📊 天氣月度平均已載入 (來源:', result.source || 'API', ')');
            return result.data;
        }
    } catch (error) {
        console.warn('⚠️ 無法獲取天氣月度平均:', error.message);
    }

    return null;
}

/**
 * 獲取當前天氣（帶快取）
 */
export async function fetchCurrentWeather() {
    const cache = weatherCache.current;
    const now = Date.now();
    if (cache.data && (now - cache.timestamp) < cache.ttl) {
        console.log('⚡ 使用天氣快取 (剩餘', Math.round((cache.ttl - (now - cache.timestamp)) / 1000), '秒)');
        currentWeatherData = cache.data;
        return cache.data;
    }

    try {
        const response = await fetch(WEATHER_CONFIG.currentWeatherAPI);
        if (!response.ok) throw new Error('Weather API error');
        const data = await response.json();

        let temperature = null;
        if (data.temperature && data.temperature.data) {
            const northDistrict = data.temperature.data.find(
                s => WEATHER_CONFIG.nearbyStations.some(name => s.place.includes(name))
            );
            if (northDistrict) {
                temperature = northDistrict.value;
            } else {
                temperature = data.temperature.data.reduce((sum, s) => sum + s.value, 0) / data.temperature.data.length;
            }
        }

        let humidity = null;
        if (data.humidity && data.humidity.data && data.humidity.data.length > 0) {
            humidity = data.humidity.data[0].value;
        }

        let rainfall = 0;
        if (data.rainfall && data.rainfall.data) {
            const northRain = data.rainfall.data.find(
                s => WEATHER_CONFIG.nearbyStations.some(name => s.place.includes(name))
            );
            if (northRain) {
                rainfall = northRain.max || 0;
            }
        }

        let icon = data.icon?.[0] || 50;

        currentWeatherData = {
            temperature: temperature ? Math.round(temperature * 10) / 10 : null,
            humidity: humidity,
            rainfall: rainfall,
            icon: icon,
            uvIndex: data.uvindex?.data?.[0]?.value || null,
            updateTime: data.updateTime || new Date().toISOString()
        };

        weatherCache.current.data = currentWeatherData;
        weatherCache.current.timestamp = Date.now();

        console.log('🌤️ 天氣數據已更新並快取:', JSON.stringify(currentWeatherData, null, 2));
        return currentWeatherData;
    } catch (error) {
        console.error('❌ 獲取天氣失敗:', error);
        if (weatherCache.current.data) {
            console.warn('⚠️ 使用過期天氣快取');
            return weatherCache.current.data;
        }
        return null;
    }
}

/**
 * 獲取天氣預報
 */
export async function fetchWeatherForecast() {
    try {
        const response = await fetch(WEATHER_CONFIG.forecastAPI);
        if (!response.ok) throw new Error('Forecast API error');
        const data = await response.json();

        weatherForecastData = data.weatherForecast || [];
        console.log('📅 天氣預報已更新:', weatherForecastData.length, '天');
        return weatherForecastData;
    } catch (error) {
        console.error('❌ 獲取天氣預報失敗:', error);
        return [];
    }
}

/**
 * 獲取 AQHI 空氣質素數據
 */
export async function fetchCurrentAQHI() {
    try {
        const response = await fetch('/api/aqhi-current');
        if (!response.ok) throw new Error('AQHI API error');
        const result = await response.json();

        if (result.success && result.data) {
            currentAQHI = result.data;
            console.log('🌫️ AQHI 已更新:', currentAQHI.value);
            return result.data;
        }
    } catch (error) {
        console.error('❌ 獲取 AQHI 失敗:', error);
    }

    return null;
}

/**
 * 計算天氣影響
 */
export function calculateWeatherImpact(weather, historicalData = null) {
    if (!weather) return 1.0;

    let factor = 1.0;
    const impacts = [];

    // 溫度影響
    if (weather.temperature !== null) {
        const temp = weather.temperature;
        const tempFactors = WEATHER_CONFIG.weatherImpactFactors.temperature;

        if (temp >= tempFactors.veryHot.threshold) {
            factor *= tempFactors.veryHot.factor;
            impacts.push(tempFactors.veryHot.desc);
        } else if (temp >= tempFactors.hot.threshold) {
            factor *= tempFactors.hot.factor;
            impacts.push(tempFactors.hot.desc);
        } else if (temp < tempFactors.cold.threshold) {
            if (temp < tempFactors.veryCold.threshold) {
                factor *= tempFactors.veryCold.factor;
                impacts.push(tempFactors.veryCold.desc);
            } else {
                factor *= tempFactors.cold.factor;
                impacts.push(tempFactors.cold.desc);
            }
        }
    }

    // 濕度影響
    if (weather.humidity !== null) {
        const humidity = weather.humidity;
        const humidityFactors = WEATHER_CONFIG.weatherImpactFactors.humidity;

        if (humidity >= humidityFactors.veryHigh.threshold) {
            factor *= humidityFactors.veryHigh.factor;
            impacts.push(humidityFactors.veryHigh.desc);
        } else if (humidity >= humidityFactors.high.threshold) {
            factor *= humidityFactors.high.factor;
            impacts.push(humidityFactors.high.desc);
        } else if (humidity < humidityFactors.low.threshold) {
            factor *= humidityFactors.low.factor;
            impacts.push(humidityFactors.low.desc);
        }
    }

    // 降雨影響
    if (weather.rainfall > 0) {
        const rainfall = weather.rainfall;
        const rainfallFactors = WEATHER_CONFIG.weatherImpactFactors.rainfall;

        if (rainfall >= rainfallFactors.heavy.threshold) {
            factor *= rainfallFactors.heavy.factor;
            impacts.push(rainfallFactors.heavy.desc);
        } else if (rainfall >= rainfallFactors.moderate.threshold) {
            factor *= rainfallFactors.moderate.factor;
            impacts.push(rainfallFactors.moderate.desc);
        } else if (rainfall >= rainfallFactors.light.threshold) {
            factor *= rainfallFactors.light.factor;
            impacts.push(rainfallFactors.light.desc);
        }
    }

    return {
        factor: Math.round(factor * 1000) / 1000,
        impacts: impacts,
        description: impacts.length > 0 ? impacts.join(', ') : '正常天氣'
    };
}

/**
 * 獲取天氣圖標
 */
export function getWeatherIcon(iconCode) {
    const iconMap = {
        50: '☀️', 51: '☀️', 52: '⛅', 53: '⛅', 54: '☁️',
        60: '☁️', 61: '☁️', 62: '🌧️', 63: '🌧️', 64: '⛈️',
        65: '⛈️', 70: '🌦️', 76: '🌦️', 77: '⛈️',
        80: '🌧️', 81: '🌧️', 82: '⛈️', 83: '⛈️',
        90: '🌫️', 91: '🌫️', 92: '🌫️'
    };

    return iconMap[iconCode] || '🌤️';
}

/**
 * 應用極端條件調整
 */
export function applyExtremeConditionAdjustments(prediction, weather, aqhi) {
    let adjusted = prediction;
    const adjustments = [];

    if (weather) {
        if (weather.temperature !== null && weather.temperature < 10) {
            adjusted *= 1.08;
            adjustments.push('寒冷天氣 +8%');
        }

        if (weather.temperature !== null && weather.temperature > 33) {
            adjusted *= 1.06;
            adjustments.push('酷熱天氣 +6%');
        }

        if (weather.rainfall > 30) {
            adjusted *= 0.92;
            adjustments.push('大雨 -8%');
        }
    }

    if (aqhi && aqhi.value >= 7) {
        adjusted *= 1.05;
        adjustments.push(`AQHI ${aqhi.value} +5%`);
    }

    return {
        adjusted: Math.round(adjusted),
        adjustments: adjustments
    };
}
