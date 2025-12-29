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
        'nav-title': 'NDH AED',
        'nav-today': '今日',
        'nav-forecast': '7日',
        'nav-history': '趨勢',
        'nav-training': '訓練',
        'loading': '載入中...',
        'footer-version': '預測模型版本',
        'footer-timezone': '香港時間 HKT',
        'footer-api': 'API 文檔',
        'footer-shortcuts': '鍵盤快捷鍵',
        'shortcuts-title': '⌨️ 鍵盤快捷鍵',
        'shortcut-refresh': '刷新數據',
        'shortcut-train': '開始訓練',
        'shortcut-theme': '切換深色模式',
        'shortcut-lang': '切換語言',
        'shortcut-export': '匯出數據',
        'shortcut-share': '分享',
        'shortcut-top': '返回頂部',
        'shortcut-nav': '導航區塊',
        'shortcut-help': '顯示快捷鍵',
        'notify-title': '通知設定',
        'notify-high': '高人流預警 (>300人)',
        'notify-training': '訓練完成通知',
        'notify-daily': '每日預測提醒',
        'notify-save': '儲存設定',
        'export-title': '匯出數據',
        'export-range': '數據範圍：',
        'export-7days': '過去 7 天',
        'export-30days': '過去 30 天',
        'export-90days': '過去 90 天',
        'export-all': '全部數據',
        'share-title': '分享預測',
        'share-link': '複製連結',
        'share-image': '儲存為圖片',
        'share-report': '生成報告',
        'toast-copied': '已複製到剪貼板',
        'toast-saved': '已儲存',
        'toast-export-success': '匯出成功',
        'toast-notify-saved': '通知設定已儲存'
    },
    'en': {
        'nav-title': 'NDH AED',
        'nav-today': 'Today',
        'nav-forecast': '7 Days',
        'nav-history': 'Trends',
        'nav-training': 'Train',
        'loading': 'Loading...',
        'footer-version': 'Prediction Model Version',
        'footer-timezone': 'Hong Kong Time HKT',
        'footer-api': 'API Docs',
        'footer-shortcuts': 'Keyboard Shortcuts',
        'shortcuts-title': '⌨️ Keyboard Shortcuts',
        'shortcut-refresh': 'Refresh Data',
        'shortcut-train': 'Start Training',
        'shortcut-theme': 'Toggle Dark Mode',
        'shortcut-lang': 'Switch Language',
        'shortcut-export': 'Export Data',
        'shortcut-share': 'Share',
        'shortcut-top': 'Back to Top',
        'shortcut-nav': 'Navigate Sections',
        'shortcut-help': 'Show Shortcuts',
        'notify-title': 'Notification Settings',
        'notify-high': 'High Volume Alert (>300)',
        'notify-training': 'Training Complete',
        'notify-daily': 'Daily Prediction Reminder',
        'notify-save': 'Save Settings',
        'export-title': 'Export Data',
        'export-range': 'Date Range:',
        'export-7days': 'Last 7 Days',
        'export-30days': 'Last 30 Days',
        'export-90days': 'Last 90 Days',
        'export-all': 'All Data',
        'share-title': 'Share Prediction',
        'share-link': 'Copy Link',
        'share-image': 'Save as Image',
        'share-report': 'Generate Report',
        'toast-copied': 'Copied to clipboard',
        'toast-saved': 'Saved',
        'toast-export-success': 'Export successful',
        'toast-notify-saved': 'Notification settings saved'
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
        this.setupExportModal();
        this.setupShareModal();
        
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
        
        // 載入儲存的設定
        const settings = JSON.parse(localStorage.getItem('ndh-notify') || '{}');
        if (settings.highVolume) document.getElementById('notify-high-volume').checked = true;
        if (settings.trainingComplete) document.getElementById('notify-training-complete').checked = true;
        if (settings.dailyPrediction) document.getElementById('notify-daily-prediction').checked = true;
        
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
        
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                const newSettings = {
                    highVolume: document.getElementById('notify-high-volume').checked,
                    trainingComplete: document.getElementById('notify-training-complete').checked,
                    dailyPrediction: document.getElementById('notify-daily-prediction').checked
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
    
    setupExportModal() {
        const modal = document.getElementById('export-modal');
        const openBtn = document.getElementById('export-btn');
        const closeBtn = document.getElementById('export-close');
        
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
        
        // 匯出按鈕
        document.getElementById('export-csv')?.addEventListener('click', () => ExportManager.exportCSV());
        document.getElementById('export-excel')?.addEventListener('click', () => ExportManager.exportExcel());
        document.getElementById('export-pdf')?.addEventListener('click', () => ExportManager.exportPDF());
    },
    
    setupShareModal() {
        const modal = document.getElementById('share-modal');
        const openBtn = document.getElementById('share-btn');
        const closeBtn = document.getElementById('share-close');
        
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
        
        // 分享按鈕
        document.getElementById('share-link')?.addEventListener('click', () => ShareManager.copyLink());
        document.getElementById('share-image')?.addEventListener('click', () => ShareManager.saveImage());
        document.getElementById('share-report')?.addEventListener('click', () => ShareManager.generateReport());
    }
};

// ============================================
// 匯出管理
// ============================================
const ExportManager = {
    async getData() {
        const range = document.getElementById('export-range-select')?.value || '30';
        try {
            let url = '/api/history';
            if (range !== 'all') {
                const endDate = new Date();
                const startDate = new Date();
                startDate.setDate(startDate.getDate() - parseInt(range));
                url += `?start=${startDate.toISOString().split('T')[0]}&end=${endDate.toISOString().split('T')[0]}`;
            }
            const response = await fetch(url);
            const data = await response.json();
            return data.data || data || [];
        } catch (error) {
            console.error('獲取數據失敗:', error);
            return [];
        }
    },
    
    async exportCSV() {
        const data = await this.getData();
        if (!data.length) {
            Toast.show('沒有數據可匯出', 'warning');
            return;
        }
        
        const headers = ['Date', 'Attendance', 'Predicted', 'Error'];
        const rows = data.map(d => [
            d.date,
            d.attendance || d.actual || '',
            d.predicted || '',
            d.error || ''
        ]);
        
        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        this.download(csv, 'ndh-aed-data.csv', 'text/csv');
        
        document.getElementById('export-modal').style.display = 'none';
        Toast.show(LangManager.t('toast-export-success'), 'success');
    },
    
    async exportExcel() {
        // 簡化版：使用 CSV 格式（Excel 可以打開）
        await this.exportCSV();
    },
    
    async exportPDF() {
        // 開啟技術文檔 PDF
        window.open('/NDH_AED_Technical_Documentation.pdf', '_blank');
        document.getElementById('export-modal').style.display = 'none';
        Toast.show(LangManager.t('toast-export-success'), 'success');
    },
    
    download(content, filename, type) {
        const blob = new Blob([content], { type: type + ';charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    }
};

// ============================================
// 分享管理
// ============================================
const ShareManager = {
    copyLink() {
        navigator.clipboard.writeText(window.location.href).then(() => {
            document.getElementById('share-modal').style.display = 'none';
            Toast.show(LangManager.t('toast-copied'), 'success');
        });
    },
    
    async saveImage() {
        try {
            // 使用 html2canvas（如果可用）
            if (typeof html2canvas === 'undefined') {
                Toast.show('請安裝 html2canvas 以使用此功能', 'warning');
                return;
            }
            
            const mainCard = document.getElementById('main-prediction-card');
            if (!mainCard) return;
            
            const canvas = await html2canvas(mainCard);
            const link = document.createElement('a');
            link.download = 'ndh-aed-prediction.png';
            link.href = canvas.toDataURL();
            link.click();
            
            document.getElementById('share-modal').style.display = 'none';
            Toast.show(LangManager.t('toast-saved'), 'success');
        } catch (error) {
            Toast.show('無法生成圖片', 'error');
        }
    },
    
    generateReport() {
        window.open('/NDH_AED_Technical_Documentation.pdf', '_blank');
        document.getElementById('share-modal').style.display = 'none';
    }
};

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
// 初始化
// ============================================
export function initUIEnhancements() {
    ThemeManager.init();
    NavManager.init();
    LangManager.init();
    ModalManager.init();
    KeyboardManager.init();
    UpdateTimeManager.update();
    
    // 定期更新時間
    setInterval(() => UpdateTimeManager.update(), 60000);
    
    // 綁定主題切換按鈕
    document.getElementById('theme-toggle')?.addEventListener('click', () => ThemeManager.toggle());
    document.getElementById('lang-toggle')?.addEventListener('click', () => LangManager.toggle());
    
    console.log('✅ UI 增強模組已初始化');
}

// 導出供外部使用
export { ThemeManager, NavManager, Toast, LangManager, AlertManager, ExportManager, ShareManager };

