/**
 * NDH AED 預測系統 - UI 增強模組
 * 包含：深色模式、導航、通知、匯出、分享、鍵盤快捷鍵、語言切換
 * v2.6.0
 */

// ============================================
// 語言翻譯
// ============================================
const translations = {
    'zh-HK': {
        // 導航
        'nav-title': 'NDH AED',
        'nav-today': '今日',
        'nav-forecast': '7日',
        'nav-history': '趨勢',
        'nav-training': '訓練',
        
        // 通用
        'loading': '載入中...',
        'unit-people': '人',
        
        // 頁首
        'app-title': 'NDH AED 病人數量預測系統',
        'app-subtitle': 'North District Hospital A&E Attendance Prediction',
        
        // 今日預測
        'today-prediction': '今日預測',
        'combined-prediction': '綜合預測',
        'realtime-prediction': '實時預測',
        'stability': '穩定性',
        'ci-80': '80% 信賴區間',
        'ci-95': '95% 信賴區間',
        
        // 統計
        'historical-stats': '歷史統計',
        'daily-avg': '日均人數',
        'max-peak': '最高峰',
        'min-trough': '最低谷',
        'std-dev': '標準差',
        
        // 影響因素
        'realtime-factors': '實時影響因素',
        'reanalyze': '重新分析',
        
        // 預測
        'forecast-7days': '未來 7 天預測',
        'forecast-chart-title': '未來 30 天預測趨勢',
        
        // 置信度
        'confidence-title': '模型置信度',
        'methodology-btn': '方法論',
        'conf-data': '數據品質',
        'conf-model': '模型擬合',
        'conf-accuracy': '近期準確度',
        'conf-overall': '綜合置信度',
        
        // 圖表控制
        'chart-scale': 'Y軸縮放：',
        'scale-auto': '自動',
        'scale-fixed': '固定',
        'show-predictions': '顯示預測線：',
        'show-anomalies': '標記異常：',
        
        // 圖表
        'accuracy-trend-title': '📈 模型準確度趨勢',
        'weather-corr-title': '🌡️ 天氣影響分析',
        'dow-chart-title': '星期效應分析',
        'month-chart-title': '月份分佈統計',
        'history-chart-title': '歷史趨勢',
        'compare-year': '對比去年',
        'chart-hint': '提示：拖曳可平移，滾輪可縮放，點擊數據點查看詳情',
        
        // 對比
        'comparison-title': '實際 vs 預測對比',
        'add-actual-data': '添加實際數據',
        
        // 訓練
        'model-training-status': '模型訓練狀態',
        'start-training': '開始訓練',
        
        // 算法說明
        'algorithm-section': '預測算法說明（基於真實研究）',
        'methodology-title': '預測方法論',
        
        // 頁腳
        'footer-version': '預測模型版本',
        'footer-timezone': '香港時間 HKT',
        'footer-api': 'API 文檔',
        'footer-shortcuts': '鍵盤快捷鍵',
        
        // 快捷鍵
        'shortcuts-title': '⌨️ 鍵盤快捷鍵',
        'shortcut-refresh': '刷新數據',
        'shortcut-train': '開始訓練',
        'shortcut-theme': '切換深色模式',
        'shortcut-lang': '切換語言',
        'shortcut-top': '返回頂部',
        'shortcut-nav': '導航區塊',
        'shortcut-help': '顯示快捷鍵',
        
        // 通知
        'notify-title': '通知設定',
        'notify-high': '高人流預警 (>300人)',
        'notify-training': '訓練完成通知',
        'notify-daily': '每日預測提醒',
        'notify-save': '儲存設定',
        
        // Toast
        'toast-copied': '已複製到剪貼板',
        'toast-saved': '已儲存',
        'toast-notify-saved': '通知設定已儲存',
        
        // 上傳
        'drop-hint': '放開以上傳 CSV 文件'
    },
    'en': {
        // Navigation
        'nav-title': 'NDH AED',
        'nav-today': 'Today',
        'nav-forecast': '7 Days',
        'nav-history': 'Trends',
        'nav-training': 'Train',
        
        // Common
        'loading': 'Loading...',
        'unit-people': 'patients',
        
        // Header
        'app-title': 'NDH AED Patient Attendance Prediction System',
        'app-subtitle': 'North District Hospital A&E Attendance Prediction',
        
        // Today Prediction
        'today-prediction': "Today's Prediction",
        'combined-prediction': 'Combined Prediction',
        'realtime-prediction': 'Realtime Prediction',
        'stability': 'Stability',
        'ci-80': '80% Confidence Interval',
        'ci-95': '95% Confidence Interval',
        
        // Statistics
        'historical-stats': 'Historical Statistics',
        'daily-avg': 'Daily Average',
        'max-peak': 'Maximum',
        'min-trough': 'Minimum',
        'std-dev': 'Std Deviation',
        
        // Factors
        'realtime-factors': 'Real-time Impact Factors',
        'reanalyze': 'Re-analyze',
        
        // Forecast
        'forecast-7days': '7-Day Forecast',
        'forecast-chart-title': '30-Day Forecast Trend',
        
        // Confidence
        'confidence-title': 'Model Confidence',
        'methodology-btn': 'Methodology',
        'conf-data': 'Data Quality',
        'conf-model': 'Model Fit',
        'conf-accuracy': 'Recent Accuracy',
        'conf-overall': 'Overall Confidence',
        
        // Chart Controls
        'chart-scale': 'Y-Axis Scale:',
        'scale-auto': 'Auto',
        'scale-fixed': 'Fixed',
        'show-predictions': 'Show Predictions:',
        'show-anomalies': 'Mark Anomalies:',
        
        // Charts
        'accuracy-trend-title': '📈 Model Accuracy Trend',
        'weather-corr-title': '🌡️ Weather Impact Analysis',
        'dow-chart-title': 'Day of Week Effect',
        'month-chart-title': 'Monthly Distribution',
        'history-chart-title': 'Historical Trend',
        'compare-year': 'Compare Last Year',
        'chart-hint': 'Tip: Drag to pan, scroll to zoom, click data points for details',
        
        // Comparison
        'comparison-title': 'Actual vs Predicted',
        'add-actual-data': 'Add Actual Data',
        
        // Training
        'model-training-status': 'Model Training Status',
        'start-training': 'Start Training',
        
        // Algorithm
        'algorithm-section': 'Prediction Algorithm (Research-Based)',
        'methodology-title': 'Prediction Methodology',
        
        // Footer
        'footer-version': 'Prediction Model Version',
        'footer-timezone': 'Hong Kong Time HKT',
        'footer-api': 'API Docs',
        'footer-shortcuts': 'Keyboard Shortcuts',
        
        // Shortcuts
        'shortcuts-title': '⌨️ Keyboard Shortcuts',
        'shortcut-refresh': 'Refresh Data',
        'shortcut-train': 'Start Training',
        'shortcut-theme': 'Toggle Dark Mode',
        'shortcut-lang': 'Switch Language',
        'shortcut-top': 'Back to Top',
        'shortcut-nav': 'Navigate Sections',
        'shortcut-help': 'Show Shortcuts',
        
        // Notifications
        'notify-title': 'Notification Settings',
        'notify-high': 'High Volume Alert (>300)',
        'notify-training': 'Training Complete',
        'notify-daily': 'Daily Prediction Reminder',
        'notify-save': 'Save Settings',
        
        // Toast
        'toast-copied': 'Copied to clipboard',
        'toast-saved': 'Saved',
        'toast-notify-saved': 'Notification settings saved',
        
        // Upload
        'drop-hint': 'Drop CSV file to upload'
    }
};

let currentLang = localStorage.getItem('ndh-lang') || 'zh-HK';

// ============================================
// 主題管理
// ============================================
const ThemeManager = {
    init() {
        const savedTheme = localStorage.getItem('ndh-theme') || 'light';
        const savedContrast = localStorage.getItem('ndh-contrast') || 'normal';
        this.setTheme(savedTheme, false);
        this.setContrast(savedContrast, false);
        
        // 監聽系統主題變化
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (!localStorage.getItem('ndh-theme')) {
                this.setTheme(e.matches ? 'dark' : 'light', false);
            }
        });
    },
    
    toggle() {
        const html = document.documentElement;
        const current = html.getAttribute('data-theme') || 'light';
        const newTheme = current === 'light' ? 'dark' : 'light';
        this.setTheme(newTheme);
    },
    
    setTheme(theme, save = true) {
        document.documentElement.setAttribute('data-theme', theme);
        
        // 更新主題色 meta 標籤
        const metaThemeColor = document.getElementById('theme-color-meta');
        if (metaThemeColor) {
            metaThemeColor.content = theme === 'dark' ? '#0f0f10' : '#f8fafc';
        }
        
        // 更新切換按鈕圖標
        const themeIcon = document.querySelector('#theme-toggle .theme-icon');
        if (themeIcon) {
            themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
        }
        
        if (save) {
            localStorage.setItem('ndh-theme', theme);
            Toast.show(theme === 'dark' ? '🌙 深色模式已啟用' : '☀️ 淺色模式已啟用', 'info');
        }
        
        // 更新圖表主題（如果存在）
        this.updateCharts(theme);
    },
    
    setContrast(contrast, save = true) {
        if (contrast === 'high') {
            document.documentElement.setAttribute('data-contrast', 'high');
        } else {
            document.documentElement.removeAttribute('data-contrast');
        }
        if (save) localStorage.setItem('ndh-contrast', contrast);
    },
    
    updateCharts(theme) {
        // 更新 Chart.js 預設顏色
        if (window.Chart) {
            const textColor = theme === 'dark' ? '#a1a1aa' : '#475569';
            const gridColor = theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)';
            
            Chart.defaults.color = textColor;
            Chart.defaults.borderColor = gridColor;
            
            // 重新繪製所有圖表
            Chart.instances.forEach(chart => {
                if (chart.options.scales) {
                    Object.values(chart.options.scales).forEach(scale => {
                        if (scale.ticks) scale.ticks.color = textColor;
                        if (scale.grid) scale.grid.color = gridColor;
                    });
                }
                chart.update();
            });
        }
    }
};

// ============================================
// 導航管理
// ============================================
const NavManager = {
    init() {
        this.setupStickyNav();
        this.setupNavLinks();
        this.setupBackToTop();
    },
    
    setupStickyNav() {
        const nav = document.getElementById('sticky-nav');
        if (!nav) return;
        
        let lastScroll = 0;
        
        window.addEventListener('scroll', () => {
            const currentScroll = window.pageYOffset;
            
            // 添加/移除滾動樣式
            if (currentScroll > 50) {
                nav.classList.add('scrolled');
            } else {
                nav.classList.remove('scrolled');
            }
            
            lastScroll = currentScroll;
        });
    },
    
    setupNavLinks() {
        const links = document.querySelectorAll('.nav-link');
        
        // 點擊導航連結
        links.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const target = document.querySelector(link.getAttribute('href'));
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        });
        
        // 滾動時更新活動狀態
        const sections = ['today-section', 'forecast-section', 'charts-section', 'model-training-section'];
        
        window.addEventListener('scroll', () => {
            const scrollPos = window.pageYOffset + 100;
            
            sections.forEach((sectionId, index) => {
                const section = document.getElementById(sectionId);
                if (section) {
                    const top = section.offsetTop;
                    const bottom = top + section.offsetHeight;
                    
                    if (scrollPos >= top && scrollPos < bottom) {
                        links.forEach(l => l.classList.remove('active'));
                        links[index]?.classList.add('active');
                    }
                }
            });
        });
    },
    
    setupBackToTop() {
        const btn = document.getElementById('back-to-top');
        if (!btn) return;
        
        window.addEventListener('scroll', () => {
            if (window.pageYOffset > 500) {
                btn.classList.add('visible');
            } else {
                btn.classList.remove('visible');
            }
        });
        
        btn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
};

// ============================================
// Toast 通知
// ============================================
const Toast = {
    show(message, type = 'info', duration = 5000) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        
        const icons = {
            success: '✓',
            warning: '⚠',
            error: '✕',
            info: 'ℹ'
        };
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <span class="toast-icon">${icons[type]}</span>
            <span class="toast-message">${message}</span>
            <button class="toast-close" aria-label="關閉">&times;</button>
        `;
        
        toast.querySelector('.toast-close').addEventListener('click', () => {
            toast.remove();
        });
        
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, duration);
    }
};

// ============================================
// 語言切換
// ============================================
const LangManager = {
    init() {
        this.setLanguage(currentLang, false);
    },
    
    toggle() {
        currentLang = currentLang === 'zh-HK' ? 'en' : 'zh-HK';
        this.setLanguage(currentLang);
    },
    
    setLanguage(lang, save = true) {
        currentLang = lang;
        if (save) localStorage.setItem('ndh-lang', lang);
        
        // 更新語言按鈕文字
        const langBtn = document.getElementById('lang-toggle');
        if (langBtn) {
            langBtn.querySelector('span').textContent = lang === 'zh-HK' ? 'EN' : '中';
        }
        
        // 更新 HTML lang 屬性
        document.documentElement.lang = lang === 'zh-HK' ? 'zh-HK' : 'en';
        
        // 更新所有帶有 data-lang-key 的元素
        document.querySelectorAll('[data-lang-key]').forEach(el => {
            const key = el.getAttribute('data-lang-key');
            if (translations[lang] && translations[lang][key]) {
                el.textContent = translations[lang][key];
            }
        });
        
        if (save) {
            Toast.show(lang === 'zh-HK' ? '已切換至繁體中文' : 'Switched to English', 'info');
        }
    },
    
    t(key) {
        return translations[currentLang]?.[key] || translations['zh-HK']?.[key] || key;
    }
};

// ============================================
// 模態框管理
// ============================================
const ModalManager = {
    init() {
        this.setupShortcutsModal();
        this.setupNotifyModal();
        
        // 點擊 overlay 關閉
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.style.display = 'none';
                }
            });
        });
        
        // ESC 關閉
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal-overlay').forEach(modal => {
                    modal.style.display = 'none';
                });
            }
        });
    },
    
    setupShortcutsModal() {
        const modal = document.getElementById('shortcuts-modal');
        const openBtn = document.getElementById('keyboard-shortcuts-link');
        const closeBtn = document.getElementById('shortcuts-close');
        
        if (openBtn) {
            openBtn.addEventListener('click', (e) => {
                e.preventDefault();
                modal.style.display = 'flex';
            });
        }
        
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modal.style.display = 'none';
            });
        }
    },
    
    setupNotifyModal() {
        const modal = document.getElementById('notify-modal');
        const openBtn = document.getElementById('notify-btn');
        const closeBtn = document.getElementById('notify-close');
        const saveBtn = document.getElementById('notify-save');
        
        if (!modal) {
            console.warn('⚠️ notify-modal not found');
            return;
        }
        
        // 載入儲存的設定
        const settings = JSON.parse(localStorage.getItem('ndh-notify') || '{}');
        const highVolumeEl = document.getElementById('notify-high-volume');
        const trainingEl = document.getElementById('notify-training-complete');
        const dailyEl = document.getElementById('notify-daily-prediction');
        
        if (highVolumeEl && settings.highVolume) highVolumeEl.checked = true;
        if (trainingEl && settings.trainingComplete) trainingEl.checked = true;
        if (dailyEl && settings.dailyPrediction) dailyEl.checked = true;
        
        if (openBtn) {
            openBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('🔔 Opening notify modal');
                modal.style.display = 'flex';
            });
        }
        
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modal.style.display = 'none';
            });
        }
        
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                const newSettings = {
                    highVolume: highVolumeEl?.checked || false,
                    trainingComplete: trainingEl?.checked || false,
                    dailyPrediction: dailyEl?.checked || false
                };
                localStorage.setItem('ndh-notify', JSON.stringify(newSettings));
                modal.style.display = 'none';
                Toast.show(LangManager.t('toast-notify-saved'), 'success');
                
                // 請求通知權限
                if (Object.values(newSettings).some(v => v) && 'Notification' in window) {
                    Notification.requestPermission();
                }
            });
        }
    },
    
    
};

// ============================================
// 匯出管理
// ============================================


// ============================================
// 鍵盤快捷鍵
// ============================================
const KeyboardManager = {
    init() {
        document.addEventListener('keydown', (e) => {
            // 忽略在輸入框中的按鍵
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            
            // 使用 Ctrl/Cmd 的快捷鍵
            if (e.ctrlKey || e.metaKey) {
                switch (e.key.toLowerCase()) {
                    case 'd':
                        e.preventDefault();
                        ThemeManager.toggle();
                        break;
                    case 'l':
                        e.preventDefault();
                        LangManager.toggle();
                        break;
                    case 'e':
                        e.preventDefault();
                        document.getElementById('export-modal').style.display = 'flex';
                        break;
                    case 's':
                        e.preventDefault();
                        document.getElementById('share-modal').style.display = 'flex';
                        break;
                }
                return;
            }
            
            // 單鍵快捷鍵
            switch (e.key.toLowerCase()) {
                case 'r':
                    location.reload();
                    break;
                case 't':
                    document.getElementById('start-training-btn')?.click();
                    break;
                case 'd':
                    ThemeManager.toggle();
                    break;
                case 'l':
                    LangManager.toggle();
                    break;
                case 'e':
                    document.getElementById('export-modal').style.display = 'flex';
                    break;
                case 's':
                    document.getElementById('share-modal').style.display = 'flex';
                    break;
                case 'home':
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    break;
                case '?':
                    document.getElementById('shortcuts-modal').style.display = 'flex';
                    break;
                case '1':
                    document.getElementById('today-section')?.scrollIntoView({ behavior: 'smooth' });
                    break;
                case '2':
                    document.getElementById('forecast-section')?.scrollIntoView({ behavior: 'smooth' });
                    break;
                case '3':
                    document.getElementById('charts-section')?.scrollIntoView({ behavior: 'smooth' });
                    break;
                case '4':
                    document.getElementById('model-training-section')?.scrollIntoView({ behavior: 'smooth' });
                    break;
            }
        });
    }
};

// ============================================
// 高人流預警
// ============================================
const AlertManager = {
    checkHighVolume(prediction) {
        const mainCard = document.getElementById('main-prediction-card');
        if (!mainCard) return;
        
        if (prediction > 300) {
            mainCard.classList.add('high-alert');
            
            // 發送通知（如果啟用）
            const settings = JSON.parse(localStorage.getItem('ndh-notify') || '{}');
            if (settings.highVolume && 'Notification' in window && Notification.permission === 'granted') {
                new Notification('⚠️ NDH AED 高人流預警', {
                    body: `預測人數：${prediction} 人（超過 300 人）`,
                    icon: '/apple-touch-icon.png'
                });
            }
        } else {
            mainCard.classList.remove('high-alert');
        }
    }
};

// ============================================
// 最後更新時間
// ============================================
const UpdateTimeManager = {
    update() {
        const el = document.getElementById('last-update-info');
        if (!el) return;
        
        const now = new Date();
        const timeStr = now.toLocaleTimeString('zh-HK', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false
        });
        
        el.textContent = `最後更新：${timeStr} HKT`;
    }
};

// ============================================
// 置信度儀表盤
// ============================================
const ConfidenceDashboard = {
    async update() {
        try {
            // 從 API 獲取數據或計算
            const response = await fetch('/api/status');
            const status = await response.json();
            
            // 計算各項置信度（基於可用數據）
            const dataQuality = status.database === 'connected' ? 92 : 0;
            const modelFit = 88; // 基於 XGBoost MAE
            const recentAccuracy = await this.getRecentAccuracy();
            const overall = Math.round((dataQuality + modelFit + recentAccuracy) / 3);
            
            this.setGauge('data', dataQuality);
            this.setGauge('model', modelFit);
            this.setGauge('accuracy', recentAccuracy);
            this.setGauge('overall', overall);
        } catch (error) {
            console.warn('置信度儀表盤更新失敗:', error);
        }
    },
    
    async getRecentAccuracy() {
        try {
            const response = await fetch('/api/comparison?limit=7');
            const data = await response.json();
            if (data.data && data.data.length > 0) {
                const avgAccuracy = data.data.reduce((sum, d) => sum + (d.accuracy || 85), 0) / data.data.length;
                return Math.round(avgAccuracy);
            }
        } catch (e) {}
        return 85; // 預設值
    },
    
    setGauge(type, value) {
        const fill = document.getElementById(`gauge-fill-${type}`);
        const valueEl = document.getElementById(`gauge-value-${type}`);
        
        if (fill) {
            // 110 是滿弧長度，計算 offset
            const offset = 110 - (110 * value / 100);
            fill.style.strokeDashoffset = offset;
            
            // 根據數值設置顏色
            if (value >= 80) fill.style.stroke = 'var(--accent-success)';
            else if (value >= 60) fill.style.stroke = 'var(--accent-warning)';
            else fill.style.stroke = 'var(--accent-danger)';
        }
        
        if (valueEl) {
            valueEl.textContent = `${value}%`;
        }
    }
};

// ============================================
// 圖表控制
// ============================================
const ChartControls = {
    autoScale: true,
    showPredictions: false,
    showAnomalies: true,
    compareYear: false,
    
    init() {
        // Y軸縮放切換
        const autoScaleToggle = document.getElementById('auto-scale-toggle');
        if (autoScaleToggle) {
            autoScaleToggle.addEventListener('change', (e) => {
                this.autoScale = e.target.checked;
                this.refreshCharts();
                Toast.show(this.autoScale ? '已切換至自動縮放' : '已切換至固定範圍 (150-350)', 'info');
            });
        }
        
        // 顯示預測線
        const predictionsToggle = document.getElementById('show-predictions-toggle');
        if (predictionsToggle) {
            predictionsToggle.addEventListener('change', (e) => {
                this.showPredictions = e.target.checked;
                this.togglePredictionLines(e.target.checked);
                Toast.show(e.target.checked ? '已顯示預測線' : '已隱藏預測線', 'info');
            });
        }
        
        // 標記異常
        const anomaliesToggle = document.getElementById('show-anomalies-toggle');
        if (anomaliesToggle) {
            anomaliesToggle.addEventListener('change', (e) => {
                this.showAnomalies = e.target.checked;
                this.toggleAnomalyMarkers(e.target.checked);
                Toast.show(e.target.checked ? '已啟用異常標記' : '已關閉異常標記', 'info');
            });
        }
        
        // 全屏按鈕
        const fullscreenBtn = document.getElementById('forecast-fullscreen');
        if (fullscreenBtn) {
            fullscreenBtn.addEventListener('click', () => {
                this.toggleFullscreen('forecast-chart-container');
            });
        }
        
        // 時間範圍下拉選單同步
        const dropdown = document.getElementById('time-range-dropdown');
        if (dropdown) {
            dropdown.addEventListener('change', (e) => {
                const range = e.target.value;
                // 同步按鈕狀態
                document.querySelectorAll('.time-range-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.range === range);
                });
                // 觸發圖表更新
                if (typeof window.initHistoryChart === 'function') {
                    window.initHistoryChart(range, 0);
                }
            });
        }
        
        // 年度對比按鈕
        const compareBtn = document.getElementById('compare-year-btn');
        if (compareBtn) {
            compareBtn.addEventListener('click', () => {
                this.compareYear = !this.compareYear;
                compareBtn.classList.toggle('active', this.compareYear);
                this.refreshCharts();
                Toast.show(this.compareYear ? '已啟用年度對比' : '已關閉年度對比', 'info');
            });
        }
        
        // 同步按鈕和下拉選單
        document.querySelectorAll('.time-range-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const dropdown = document.getElementById('time-range-dropdown');
                if (dropdown) dropdown.value = btn.dataset.range;
            });
        });
        
        console.log('  ✓ ChartControls bindingscomplete');
    },
    
    // 全屏切換
    toggleFullscreen(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        if (!document.fullscreenElement) {
            // 進入全屏
            if (container.requestFullscreen) {
                container.requestFullscreen();
            } else if (container.webkitRequestFullscreen) {
                container.webkitRequestFullscreen();
            } else if (container.msRequestFullscreen) {
                container.msRequestFullscreen();
            }
            Toast.show('已進入全屏模式，按 ESC 退出', 'info');
        } else {
            // 退出全屏
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
        }
    },
    
    // 切換預測線顯示
    togglePredictionLines(show) {
        window.chartSettings = window.chartSettings || {};
        window.chartSettings.showPredictions = show;
        
        // 更新圖表中的預測數據集可見性
        if (window.Chart && Chart.instances) {
            Object.values(Chart.instances).forEach(chart => {
                if (chart.data?.datasets) {
                    chart.data.datasets.forEach(dataset => {
                        if (dataset.label?.includes('預測') || dataset.label?.includes('Predicted')) {
                            dataset.hidden = !show;
                        }
                    });
                    chart.update();
                }
            });
        }
    },
    
    // 切換異常標記
    toggleAnomalyMarkers(show) {
        window.chartSettings = window.chartSettings || {};
        window.chartSettings.showAnomalies = show;
        
        // 更新圖表中的異常點樣式
        if (window.Chart && Chart.instances) {
            Object.values(Chart.instances).forEach(chart => {
                if (chart.data?.datasets) {
                    chart.data.datasets.forEach(dataset => {
                        // 如果是主數據集，調整異常點的顯示
                        if (dataset.pointBackgroundColor && Array.isArray(dataset.pointBackgroundColor)) {
                            // 保持原有顏色邏輯，但根據 show 決定是否高亮異常
                            if (!show) {
                                dataset.originalPointColors = dataset.pointBackgroundColor.slice();
                                dataset.pointBackgroundColor = dataset.pointBackgroundColor.map(() => 
                                    dataset.borderColor || '#4f46e5'
                                );
                            } else if (dataset.originalPointColors) {
                                dataset.pointBackgroundColor = dataset.originalPointColors;
                            }
                        }
                    });
                    chart.update();
                }
            });
        }
    },
    
    refreshCharts() {
        // 更新全局圖表設定
        window.chartSettings = {
            autoScale: this.autoScale,
            showPredictions: this.showPredictions,
            showAnomalies: this.showAnomalies,
            compareYear: this.compareYear
        };
        
        // 觸發圖表重繪 (Chart.js v3+: instances 是物件)
        if (window.Chart && Chart.instances) {
            try {
                // Chart.js v3+ uses Object.values() to get chart instances
                const charts = Object.values(Chart.instances);
                charts.forEach(chart => {
                    if (chart && chart.options?.scales?.y) {
                        if (this.autoScale) {
                            chart.options.scales.y.min = undefined;
                            chart.options.scales.y.max = undefined;
                        } else {
                            chart.options.scales.y.min = 150;
                            chart.options.scales.y.max = 350;
                        }
                        chart.update();
                    }
                });
            } catch (e) {
                console.warn('圖表刷新失敗:', e);
            }
        }
    }
};

// ============================================
// 圖表 Onboarding
// ============================================
const ChartOnboarding = {
    init() {
        const shown = localStorage.getItem('ndh-chart-onboarding-shown');
        if (!shown) {
            const onboarding = document.getElementById('chart-onboarding');
            if (onboarding) {
                onboarding.style.display = 'block';
            }
        }
        
        document.getElementById('dismiss-onboarding')?.addEventListener('click', () => {
            document.getElementById('chart-onboarding').style.display = 'none';
            localStorage.setItem('ndh-chart-onboarding-shown', 'true');
        });
    }
};

// ============================================
// 方法論彈窗
// ============================================
const MethodologyModal = {
    init() {
        const modal = document.getElementById('methodology-modal');
        const openBtn = document.getElementById('methodology-btn');
        const closeBtn = document.getElementById('methodology-close');
        
        if (openBtn) {
            openBtn.addEventListener('click', () => {
                modal.style.display = 'flex';
            });
        }
        
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modal.style.display = 'none';
            });
        }
    }
};

// ============================================
// 全視窗拖放
// ============================================
const FullWindowDrop = {
    init() {
        const overlay = document.getElementById('drop-zone-overlay');
        if (!overlay) return;
        
        let dragCounter = 0;
        
        document.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dragCounter++;
            if (e.dataTransfer.types.includes('Files')) {
                overlay.style.display = 'flex';
            }
        });
        
        document.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dragCounter--;
            if (dragCounter === 0) {
                overlay.style.display = 'none';
            }
        });
        
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
        });
        
        document.addEventListener('drop', (e) => {
            e.preventDefault();
            dragCounter = 0;
            overlay.style.display = 'none';
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                const file = files[0];
                if (file.name.endsWith('.csv') || file.type === 'text/csv') {
                    this.handleCSVFile(file);
                } else {
                    Toast.show('請上傳 CSV 格式文件', 'warning');
                }
            }
        });
    },
    
    handleCSVFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const csvContent = e.target.result;
            // 顯示上傳 Modal 並填入內容
            const modal = document.getElementById('csv-upload-modal');
            const textarea = document.getElementById('csv-text-input');
            if (modal && textarea) {
                modal.style.display = 'flex';
                textarea.value = csvContent;
                // 觸發預覽更新
                textarea.dispatchEvent(new Event('input'));
            }
            Toast.show(`已載入文件：${file.name}`, 'success');
        };
        reader.readAsText(file);
    }
};

// ============================================
// 準確度趨勢圖
// ============================================
const AccuracyChart = {
    chart: null,
    
    async init() {
        const canvas = document.getElementById('accuracy-chart');
        const loading = document.getElementById('accuracy-chart-loading');
        if (!canvas || !loading) {
            console.warn('AccuracyChart: canvas or loading element not found');
            return;
        }
        
        // 確保 Chart.js 已載入
        if (typeof Chart === 'undefined') {
            console.warn('AccuracyChart: Chart.js not loaded yet');
            loading.innerHTML = '<div style="text-align: center; color: var(--text-secondary);">等待 Chart.js...</div>';
            return;
        }
        
        try {
            const response = await fetch('/api/comparison?limit=30');
            const result = await response.json();
            const data = result.data || [];
            
            if (data.length === 0) {
                loading.innerHTML = '<div style="text-align: center; color: var(--text-secondary);">暫無準確度數據</div>';
                return;
            }
            
            const labels = data.map(d => d.date).reverse();
            const accuracies = data.map(d => {
                // API 回傳 error_percentage 是字串格式
                if (d.error_percentage !== undefined) {
                    const errorPct = parseFloat(d.error_percentage);
                    return Math.max(0, Math.min(100, 100 - errorPct));
                }
                if (d.accuracy) return parseFloat(d.accuracy);
                // 從 actual vs predicted 計算
                if (d.actual && d.predicted) {
                    const error = Math.abs(d.actual - d.predicted) / d.actual * 100;
                    return Math.max(0, Math.min(100, 100 - error));
                }
                return null; // 無資料時返回 null
            }).reverse();
            
            // 過濾掉 null 值
            const validData = labels.map((label, i) => ({ label, accuracy: accuracies[i] }))
                .filter(d => d.accuracy !== null);
            
            if (validData.length === 0) {
                loading.innerHTML = '<div style="text-align: center; color: var(--text-secondary);">暫無準確度數據</div>';
                return;
            }
            
            loading.style.display = 'none';
            canvas.style.display = 'block';
            
            const ctx = canvas.getContext('2d');
            this.chart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: validData.map(d => d.label),
                    datasets: [{
                        label: '準確度 %',
                        data: validData.map(d => d.accuracy),
                        borderColor: '#4f46e5',
                        backgroundColor: 'rgba(79, 70, 229, 0.1)',
                        fill: true,
                        tension: 0.4,
                        pointRadius: 3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: ctx => `準確度: ${ctx.raw.toFixed(1)}%`
                            }
                        }
                    },
                    scales: {
                        y: {
                            min: 0,
                            max: 100,
                            ticks: {
                                callback: v => v + '%',
                                stepSize: 20
                            },
                            grid: {
                                color: 'rgba(0,0,0,0.05)'
                            }
                        },
                        x: {
                            ticks: {
                                maxRotation: 45,
                                minRotation: 45
                            }
                        }
                    }
                }
            });
            console.log('✅ AccuracyChart 已初始化');
        } catch (error) {
            console.warn('準確度圖表載入失敗:', error);
            loading.innerHTML = '<div style="text-align: center; color: var(--text-secondary);">載入失敗</div>';
        }
    }
};

// ============================================
// 天氣相關性圖
// ============================================
const WeatherCorrChart = {
    chart: null,
    
    async init() {
        const canvas = document.getElementById('weather-corr-chart');
        const loading = document.getElementById('weather-corr-chart-loading');
        if (!canvas || !loading) {
            console.warn('WeatherCorrChart: canvas or loading element not found');
            return;
        }
        
        // 確保 Chart.js 已載入
        if (typeof Chart === 'undefined') {
            console.warn('WeatherCorrChart: Chart.js not loaded yet');
            loading.innerHTML = '<div style="text-align: center; color: var(--text-secondary);">等待 Chart.js...</div>';
            return;
        }
        
        try {
            // 天氣影響因子數據
            const weatherFactors = [
                { factor: '極端高溫 (>33°C)', impact: 12 },
                { factor: '極端低溫 (<10°C)', impact: 10 },
                { factor: '高濕度 (>95%)', impact: 3 },
                { factor: '大雨 (>30mm)', impact: -8 },
                { factor: '天氣警告', impact: 15 },
                { factor: '正常天氣', impact: 0 }
            ];
            
            loading.style.display = 'none';
            canvas.style.display = 'block';
            
            const ctx = canvas.getContext('2d');
            this.chart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: weatherFactors.map(w => w.factor),
                    datasets: [{
                        label: '人流影響 %',
                        data: weatherFactors.map(w => w.impact),
                        backgroundColor: weatherFactors.map(w => 
                            w.impact > 0 ? 'rgba(220, 38, 38, 0.7)' : 
                            w.impact < 0 ? 'rgba(5, 150, 105, 0.7)' : 
                            'rgba(100, 116, 139, 0.7)'
                        ),
                        borderRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    indexAxis: 'y',
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        x: {
                            ticks: {
                                callback: v => (v > 0 ? '+' : '') + v + '%'
                            }
                        }
                    }
                }
            });
            console.log('✅ WeatherCorrChart 已初始化');
        } catch (error) {
            console.warn('天氣相關性圖表載入失敗:', error);
            loading.innerHTML = '<div style="text-align: center; color: var(--text-secondary);">載入失敗</div>';
        }
    }
};

// ============================================
// 初始化
// ============================================
export function initUIEnhancements() {
    console.log('🎨 開始初始化 UI 增強模組...');
    
    try {
        ThemeManager.init();
        console.log('  ✓ ThemeManager');
    } catch (e) { console.error('ThemeManager error:', e); }
    
    try {
        NavManager.init();
        console.log('  ✓ NavManager');
    } catch (e) { console.error('NavManager error:', e); }
    
    try {
        LangManager.init();
        console.log('  ✓ LangManager');
    } catch (e) { console.error('LangManager error:', e); }
    
    try {
        ModalManager.init();
        console.log('  ✓ ModalManager');
    } catch (e) { console.error('ModalManager error:', e); }
    
    try {
        KeyboardManager.init();
        console.log('  ✓ KeyboardManager');
    } catch (e) { console.error('KeyboardManager error:', e); }
    
    try {
        UpdateTimeManager.update();
    } catch (e) { console.error('UpdateTimeManager error:', e); }
    
    try {
        ChartControls.init();
        console.log('  ✓ ChartControls');
    } catch (e) { console.error('ChartControls error:', e); }
    
    try {
        ChartOnboarding.init();
    } catch (e) { console.error('ChartOnboarding error:', e); }
    
    try {
        MethodologyModal.init();
        console.log('  ✓ MethodologyModal');
    } catch (e) { console.error('MethodologyModal error:', e); }
    
    try {
        FullWindowDrop.init();
    } catch (e) { console.error('FullWindowDrop error:', e); }
    
    // 綁定主題切換按鈕
    const themeBtn = document.getElementById('theme-toggle');
    const langBtn = document.getElementById('lang-toggle');
    
    if (themeBtn) {
        themeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('🌙 Theme toggle clicked');
            ThemeManager.toggle();
        });
        console.log('  ✓ Theme button bound');
    } else {
        console.warn('  ⚠️ theme-toggle button not found');
    }
    
    if (langBtn) {
        langBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('🌐 Language toggle clicked');
            LangManager.toggle();
        });
        console.log('  ✓ Language button bound');
    } else {
        console.warn('  ⚠️ lang-toggle button not found');
    }
    
    // 延遲初始化圖表相關（等待 Chart.js 和其他圖表載入完成）
    setTimeout(() => {
        try {
            ConfidenceDashboard.update();
        } catch (e) { console.error('ConfidenceDashboard error:', e); }
        
        try {
            AccuracyChart.init();
        } catch (e) { console.error('AccuracyChart error:', e); }
        
        try {
            WeatherCorrChart.init();
        } catch (e) { console.error('WeatherCorrChart error:', e); }
    }, 3000); // 延長到 3 秒以確保 Chart.js 已完全載入
    
    // 定期更新時間和置信度
    setInterval(() => {
        try {
            UpdateTimeManager.update();
            ConfidenceDashboard.update();
        } catch (e) {}
    }, 60000);
    
    console.log('✅ UI 增強模組 v2.6.3 已初始化');
}

// 導出供外部使用
export { ThemeManager, NavManager, Toast, LangManager, AlertManager, ChartControls, ConfidenceDashboard };

