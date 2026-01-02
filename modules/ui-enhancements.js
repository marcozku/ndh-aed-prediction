/**
 * NDH AED 預測系統 - UI 增強模組
 * 包含：深色模式、導航、通知、鍵盤快捷鍵
 * v2.6.5
 */

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
            
            // 重新繪製所有圖表 (Chart.js v3+ 用 Object.values)
            Object.values(Chart.instances || {}).forEach(chart => {
                if (chart && chart.options && chart.options.scales) {
                    Object.values(chart.options.scales).forEach(scale => {
                        if (scale.ticks) scale.ticks.color = textColor;
                        if (scale.grid) scale.grid.color = gridColor;
                    });
                }
                if (chart) chart.update();
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
                Toast.show('通知設定已儲存', 'success');
                
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
// 置信度儀表盤 - 動態計算
// ============================================
const ConfidenceDashboard = {
    lastUpdate: null,
    cachedData: null,
    
    async update(forceRefresh = false) {
        try {
            // 緩存 30 秒，除非強制刷新
            if (!forceRefresh && this.cachedData && this.lastUpdate && (Date.now() - this.lastUpdate < 30000)) {
                this.applyValues(this.cachedData);
                return;
            }
            
            // 從新的動態 API 獲取數據
            const response = await fetch('/api/confidence');
            if (!response.ok) throw new Error('API error');
            
            const data = await response.json();
            this.cachedData = data;
            this.lastUpdate = Date.now();
            
            this.applyValues(data);
            
            // 更新詳細資訊（如果有詳細面板）
            this.updateDetails(data.details);
            
        } catch (error) {
            console.warn('置信度儀表盤更新失敗:', error);
            // 回退到基礎計算
            this.fallbackUpdate();
        }
    },
    
    applyValues(data) {
        this.setGauge('data', data.dataQuality || 0);
        this.setGauge('model', data.modelFit || 0);
        this.setGauge('accuracy', data.recentAccuracy || 0);
        this.setGauge('overall', data.overall || 0);
    },
    
    async fallbackUpdate() {
        try {
            const response = await fetch('/api/status');
            const status = await response.json();
            const dataQuality = status.database === 'connected' ? 85 : 0;
            const modelFit = 80;
            const recentAccuracy = 85;
            const overall = Math.round((dataQuality + modelFit + recentAccuracy) / 3);
            
            this.setGauge('data', dataQuality);
            this.setGauge('model', modelFit);
            this.setGauge('accuracy', recentAccuracy);
            this.setGauge('overall', overall);
        } catch (e) {}
    },
    
    updateDetails(details) {
        if (!details) return;
        
        // 可以在這裡更新額外的詳細資訊面板
        // 例如：顯示 MAE、數據量等
        const detailsEl = document.getElementById('confidence-details');
        if (detailsEl && details) {
            detailsEl.innerHTML = `
                <div class="confidence-detail-item">📊 數據量: ${details.dataCount || '--'} 筆</div>
                <div class="confidence-detail-item">📅 最新數據: ${details.latestDate || '--'}</div>
                <div class="confidence-detail-item">🎯 MAE: ${details.mae?.toFixed(2) || '--'} 人</div>
                <div class="confidence-detail-item">📈 MAPE: ${details.mape?.toFixed(2) || '--'}%</div>
            `;
        }
    },
    
    setGauge(type, value) {
        const fill = document.getElementById(`gauge-fill-${type}`);
        const valueEl = document.getElementById(`gauge-value-${type}`);
        
        if (fill) {
            // 126 是滿弧長度（π × 40 ≈ 125.66，SVG 會將 radius 35 調整為 40 以適應 80px 寬度）
            const offset = 126 - (126 * value / 100);
            fill.style.strokeDashoffset = offset;
            
            // 根據數值設置顏色
            if (value >= 80) fill.style.stroke = 'var(--accent-success)';
            else if (value >= 60) fill.style.stroke = 'var(--accent-warning)';
            else fill.style.stroke = 'var(--accent-danger)';
        }
        
        if (valueEl) {
            valueEl.textContent = `${value}%`;
        }
    },
    
    // 清除緩存，強制下次更新時重新獲取
    invalidateCache() {
        this.cachedData = null;
        this.lastUpdate = null;
    }
};

// ============================================
// 圖表控制
// ============================================
const ChartControls = {
    autoScale: true,
    showPredictions: true,
    showAnomalies: true,
    compareYear: false,
    
    init() {
        // Y軸縮放切換
        const autoScaleToggle = document.getElementById('auto-scale-toggle');
        if (autoScaleToggle) {
            // 同步初始狀態
            this.autoScale = autoScaleToggle.checked;
            autoScaleToggle.addEventListener('change', (e) => {
                this.autoScale = e.target.checked;
                this.refreshCharts();
                Toast.show(this.autoScale ? '已切換至自動縮放' : '已切換至固定範圍 (150-350)', 'info');
            });
        }
        
        // 顯示預測線
        const predictionsToggle = document.getElementById('show-predictions-toggle');
        if (predictionsToggle) {
            // 同步初始狀態（預設關閉）
            this.showPredictions = predictionsToggle.checked;
            predictionsToggle.addEventListener('change', (e) => {
                this.showPredictions = e.target.checked;
                this.togglePredictionLines(e.target.checked);
                Toast.show(e.target.checked ? '已顯示預測線' : '已隱藏預測線', 'info');
            });
        }
        
        // 標記異常
        const anomaliesToggle = document.getElementById('show-anomalies-toggle');
        if (anomaliesToggle) {
            // 同步初始狀態（預設開啟）
            this.showAnomalies = anomaliesToggle.checked;
            anomaliesToggle.addEventListener('change', (e) => {
                this.showAnomalies = e.target.checked;
                this.toggleAnomalyMarkers(e.target.checked);
                Toast.show(e.target.checked ? '已啟用異常標記' : '已關閉異常標記', 'info');
            });
        }
        
        // 初始化全局設定（供圖表使用）
        window.chartSettings = {
            autoScale: this.autoScale,
            showPredictions: this.showPredictions,
            showAnomalies: this.showAnomalies,
            compareYear: this.compareYear
        };
        
        // 圖表預設會顯示所有數據集，只有當用戶取消勾選時才隱藏
        // 不需要在初始化時調用 togglePredictionLines(true)，因為圖表預設就是顯示的
        
        // 全屏按鈕 - v3.0.27: 使用箭頭函數保持 this 綁定
        const fullscreenBtn = document.getElementById('forecast-fullscreen');
        if (fullscreenBtn) {
            const self = this;
            fullscreenBtn.addEventListener('click', () => {
                self.toggleFullscreen('forecast-chart-container');
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
            compareBtn.addEventListener('click', async () => {
                this.compareYear = !this.compareYear;
                compareBtn.classList.toggle('active', this.compareYear);
                
                // 同步到全局設定（供圖表重新載入時使用）
                window.chartSettings = window.chartSettings || {};
                window.chartSettings.compareYear = this.compareYear;
                
                // 調用歷史圖表的年度對比功能（帶重試機制）
                const tryYearComparison = async (retries = 3, delay = 500) => {
                    if (typeof window.toggleHistoryYearComparison !== 'function') {
                        if (retries > 0) {
                            console.log(`⏳ 等待年度對比功能載入... (剩餘 ${retries} 次)`);
                            await new Promise(r => setTimeout(r, delay));
                            return tryYearComparison(retries - 1, delay);
                        }
                        return false;
                    }
                    
                    const success = await window.toggleHistoryYearComparison(this.compareYear);
                    if (success === false && retries > 0) {
                        console.log(`⏳ 圖表未就緒，重試中... (剩餘 ${retries} 次)`);
                        await new Promise(r => setTimeout(r, delay));
                        return tryYearComparison(retries - 1, delay);
                    }
                    return success;
                };
                
                const success = await tryYearComparison();
                if (success === false) {
                    // 失敗時重置按鈕狀態
                    this.compareYear = false;
                    compareBtn.classList.remove('active');
                    Toast.show('圖表載入中，請稍後再試', 'warning');
                } else {
                    Toast.show(this.compareYear ? '已啟用年度對比（橙色線為去年同期）' : '已關閉年度對比', 'info');
                }
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
    
    // 全屏切換 - v3.0.27: 增加錯誤處理和日誌
    toggleFullscreen(containerId) {
        console.log('🖥️ 嘗試切換全屏:', containerId);
        const container = document.getElementById(containerId);
        if (!container) {
            console.error('❌ 找不到容器:', containerId);
            Toast.show('找不到圖表容器', 'error');
            return;
        }
        
        if (!document.fullscreenElement) {
            // 進入全屏
            const requestFS = container.requestFullscreen || 
                              container.webkitRequestFullscreen || 
                              container.msRequestFullscreen;
            
            if (requestFS) {
                requestFS.call(container)
                    .then(() => {
                        console.log('✅ 已進入全屏模式');
                        Toast.show('已進入全屏模式，按 ESC 退出', 'info');
                        // v3.0.29: 全屏時更新圖表字體大小
                        this.updateChartsForFullscreen(true);
                    })
                    .catch(err => {
                        console.error('❌ 全屏失敗:', err);
                        Toast.show('無法進入全屏: ' + err.message, 'error');
                    });
            } else {
                Toast.show('瀏覽器不支持全屏模式', 'warning');
            }
        } else {
            // 退出全屏
            const exitFS = document.exitFullscreen || 
                           document.webkitExitFullscreen || 
                           document.msExitFullscreen;
            if (exitFS) {
                exitFS.call(document);
                // v3.0.29: 恢復正常字體大小
                this.updateChartsForFullscreen(false);
            }
        }
    },
    
    // v3.0.29: 更新圖表以適應全屏模式
    updateChartsForFullscreen(isFullscreen) {
        if (!window.Chart || !Chart.instances) return;
        
        const fontSize = isFullscreen ? 16 : 12;
        const titleSize = isFullscreen ? 20 : 14;
        const tickColor = isFullscreen ? '#e2e8f0' : '#94a3b8';
        
        Object.values(Chart.instances).forEach(chart => {
            if (chart.options?.scales) {
                // 更新 X 軸
                if (chart.options.scales.x) {
                    chart.options.scales.x.ticks = chart.options.scales.x.ticks || {};
                    chart.options.scales.x.ticks.font = { size: fontSize, weight: isFullscreen ? '500' : '400' };
                    chart.options.scales.x.ticks.color = tickColor;
                    if (chart.options.scales.x.title) {
                        chart.options.scales.x.title.font = { size: titleSize, weight: '600' };
                        chart.options.scales.x.title.color = tickColor;
                    }
                }
                // 更新 Y 軸
                if (chart.options.scales.y) {
                    chart.options.scales.y.ticks = chart.options.scales.y.ticks || {};
                    chart.options.scales.y.ticks.font = { size: fontSize, weight: isFullscreen ? '500' : '400' };
                    chart.options.scales.y.ticks.color = tickColor;
                    if (chart.options.scales.y.title) {
                        chart.options.scales.y.title.font = { size: titleSize, weight: '600' };
                        chart.options.scales.y.title.color = tickColor;
                    }
                }
            }
            // 更新圖例
            if (chart.options?.plugins?.legend?.labels) {
                chart.options.plugins.legend.labels.font = { size: fontSize };
                chart.options.plugins.legend.labels.color = tickColor;
            }
            chart.update('none');
        });
        
        console.log(`📊 圖表已更新為${isFullscreen ? '全屏' : '正常'}模式`);
    },
    
    // 切換預測線顯示
    togglePredictionLines(show) {
        window.chartSettings = window.chartSettings || {};
        window.chartSettings.showPredictions = show;
        
        // 更新圖表中的預測數據集可見性（包括 CI 置信區間）
        if (window.Chart && Chart.instances) {
            Object.values(Chart.instances).forEach(chart => {
                if (chart.data?.datasets) {
                    chart.data.datasets.forEach(dataset => {
                        const label = dataset.label || '';
                        // 隱藏預測值、CI 置信區間等預測相關數據集
                        if (label.includes('預測') || 
                            label.includes('Predicted') || 
                            label.includes('CI') ||
                            label.includes('置信')) {
                            dataset.hidden = !show;
                        }
                    });
                    chart.update('none'); // 使用 'none' 避免動畫
                }
            });
        }
        console.log('預測線顯示:', show);
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
    
    // 重新應用圖表控制設定（解決時序問題）
    applySettings() {
        console.log('📊 重新應用圖表控制設定:', {
            showPredictions: this.showPredictions,
            showAnomalies: this.showAnomalies
        });
        this.togglePredictionLines(this.showPredictions);
        this.toggleAnomalyMarkers(this.showAnomalies);
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
// 方法論彈窗
// ============================================
const MethodologyModal = {
    metricsLoaded: false,
    timelineLoaded: false,
    timelineChart: null,
    
    init() {
        const modal = document.getElementById('methodology-modal');
        const openBtn = document.getElementById('methodology-btn');
        const closeBtn = document.getElementById('methodology-close');
        
        if (openBtn) {
            openBtn.addEventListener('click', () => {
                modal.style.display = 'flex';
                this.loadModelMetrics();
                this.loadAlgorithmTimeline();
            });
        }
        
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                modal.style.display = 'none';
            });
        }
    },
    
    async loadAlgorithmTimeline() {
        if (this.timelineLoaded) return;
        
        const container = document.getElementById('algorithm-timeline');
        if (!container) {
            console.warn('❌ 找不到 algorithm-timeline 容器');
            return;
        }
        
        console.log('📈 開始載入算法時間線...');
        
        try {
            const response = await fetch('/api/algorithm-timeline');
            console.log('📈 API 響應狀態:', response.status);
            
            if (!response.ok) {
                throw new Error(`API 錯誤: ${response.status}`);
            }
            
            const result = await response.json();
            console.log('📈 API 數據:', result);
            
            if (!result.success || !result.data?.timeline) {
                // 使用本地備用數據
                const fallbackTimeline = [
                    { version: '2.9.20', date: '2025-12-30', description: '基礎 XGBoost', metrics: { mae: 3.84, mape: 1.56, feature_count: 52 }, changes: ['300樹', '深度6'] },
                    { version: '2.9.24', date: '2025-12-31', description: '天氣特徵', metrics: { mae: 3.75, mape: 1.52, feature_count: 89 }, changes: ['HKO數據'] },
                    { version: '2.9.28', date: '2026-01-02', description: '研究優化', metrics: { mae: 3.84, mape: 1.56, feature_count: 99 }, changes: ['500樹', 'Fourier'] },
                    { version: '2.9.50', date: '2026-01-01', description: 'Optuna+EWMA', metrics: { mae: 6.30, mape: 2.45, r2: 0.90, feature_count: 161 }, changes: ['Optuna優化', 'EWMA'] },
                    { version: '2.9.52', date: '2026-01-02', description: '自動特徵優化', metrics: { mae: 5.33, mape: 2.10, r2: 0.92, feature_count: 25 }, changes: ['智能優化器', '25特徵', 'R²92%'] }
                ];
                this.renderTimeline(container, fallbackTimeline);
                this.renderAccuracyChart(fallbackTimeline);
                console.log('📈 使用備用時間線數據');
                return;
            }
            
            const timeline = result.data.timeline;
            this.renderTimeline(container, timeline);
            this.renderAccuracyChart(timeline);
            this.timelineLoaded = true;
            console.log('✅ 算法時間線載入成功');
            
        } catch (error) {
            console.error('❌ 載入算法時間線失敗:', error);
            // 顯示錯誤但仍然嘗試顯示備用數據
            const fallbackTimeline = [
                { version: '2.9.20', date: '2025-12-30', description: '基礎 XGBoost', metrics: { mae: 3.84, mape: 1.56, feature_count: 52 }, changes: ['300樹'] },
                { version: '2.9.28', date: '2026-01-02', description: '研究優化', metrics: { mae: 3.84, mape: 1.56, feature_count: 99 }, changes: ['500樹', 'Fourier'] },
                { version: '2.9.50', date: '2026-01-01', description: 'Optuna+EWMA', metrics: { mae: 6.30, mape: 2.45, r2: 0.90, feature_count: 161 }, changes: ['Optuna優化'] },
                { version: '2.9.52', date: '2026-01-02', description: '特徵優化', metrics: { mae: 4.73, mape: 1.87, r2: 0.933, feature_count: 25 }, changes: ['25特徵', 'R²93%'] }
            ];
            this.renderTimeline(container, fallbackTimeline);
            this.renderAccuracyChart(fallbackTimeline);
        }
    },
    
    renderTimeline(container, timeline) {
        let html = '';
        const latestIdx = timeline.length - 1;
        
        // 反向顯示（最新在上）
        for (let i = latestIdx; i >= 0; i--) {
            const item = timeline[i];
            const isLatest = i === latestIdx;
            const prevItem = i > 0 ? timeline[i - 1] : null;
            
            // 計算改進幅度
            let maeImproved = false;
            let mapeImproved = false;
            if (prevItem && item.metrics.mae && prevItem.metrics.mae) {
                maeImproved = item.metrics.mae < prevItem.metrics.mae;
            }
            if (prevItem && item.metrics.mape && prevItem.metrics.mape) {
                mapeImproved = item.metrics.mape < prevItem.metrics.mape;
            }
            
            html += `
                <div class="timeline-item ${isLatest ? 'latest' : ''}">
                    <div class="timeline-version">${item.version}${isLatest ? ' 🆕' : ''}</div>
                    <div class="timeline-info">
                        <div class="timeline-date">${item.date}</div>
                        <div class="timeline-desc">${item.description}</div>
                        <div class="timeline-metrics">
                            <span class="timeline-metric ${maeImproved ? 'improved' : ''}">
                                <strong>MAE:</strong> ${item.metrics.mae !== null ? item.metrics.mae.toFixed(2) : '--'}
                                ${maeImproved ? '↓' : ''}
                            </span>
                            <span class="timeline-metric ${mapeImproved ? 'improved' : ''}">
                                <strong>MAPE:</strong> ${item.metrics.mape !== null ? item.metrics.mape.toFixed(2) + '%' : '--'}
                                ${mapeImproved ? '↓' : ''}
                            </span>
                            <span class="timeline-metric">
                                <strong>特徵:</strong> ${item.metrics.feature_count || '--'}
                            </span>
                        </div>
                        ${item.changes && item.changes.length > 0 ? `
                        <div class="timeline-changes">
                            ${item.changes.map(c => `<span class="timeline-tag">${c}</span>`).join('')}
                        </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }
        
        container.innerHTML = html;
    },
    
    renderAccuracyChart(timeline) {
        const canvas = document.getElementById('accuracy-trend-chart');
        if (!canvas) {
            console.warn('❌ 找不到 accuracy-trend-chart canvas');
            return;
        }
        
        // 等待 Chart.js 載入
        if (typeof Chart === 'undefined') {
            console.warn('⏳ Chart.js 尚未載入，延遲渲染圖表');
            setTimeout(() => this.renderAccuracyChart(timeline), 500);
            return;
        }
        
        // 過濾有效數據（至少需要 1 個數據點）
        const validData = timeline.filter(t => t.metrics && t.metrics.mae !== null);
        if (validData.length === 0) {
            console.warn('❌ 沒有有效的時間線數據');
            return;
        }
        
        const labels = validData.map(t => t.version);
        const maeData = validData.map(t => t.metrics.mae);
        const mapeData = validData.map(t => t.metrics.mape);
        const featureData = validData.map(t => t.metrics.feature_count);
        
        // 銷毀舊圖表
        if (this.timelineChart) {
            this.timelineChart.destroy();
            this.timelineChart = null;
        }
        
        try {
            const ctx = canvas.getContext('2d');
            this.timelineChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: 'MAE (人)',
                            data: maeData,
                            borderColor: '#4f46e5',
                            backgroundColor: 'rgba(79, 70, 229, 0.15)',
                            borderWidth: 3,
                            pointRadius: 6,
                            pointBackgroundColor: '#4f46e5',
                            pointBorderColor: '#fff',
                            pointBorderWidth: 2,
                            tension: 0.3,
                            fill: true
                        },
                        {
                            label: 'MAPE (%)',
                            data: mapeData,
                            borderColor: '#059669',
                            backgroundColor: 'rgba(5, 150, 105, 0.1)',
                            borderWidth: 2,
                            pointRadius: 5,
                            pointBackgroundColor: '#059669',
                            pointBorderColor: '#fff',
                            pointBorderWidth: 2,
                            tension: 0.3,
                            borderDash: [5, 5],
                            fill: false
                        },
                        {
                            label: '特徵數',
                            data: featureData,
                            borderColor: '#f59e0b',
                            backgroundColor: 'transparent',
                            borderWidth: 2,
                            pointRadius: 4,
                            pointBackgroundColor: '#f59e0b',
                            tension: 0.3,
                            borderDash: [2, 2],
                            yAxisID: 'y1'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        intersect: false,
                        mode: 'index'
                    },
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: { 
                                boxWidth: 12, 
                                padding: 10, 
                                font: { size: 11, weight: 'bold' },
                                usePointStyle: true
                            }
                        },
                        title: {
                            display: true,
                            text: '📊 算法更新對準確度的影響',
                            font: { size: 13, weight: 'bold' },
                            padding: { bottom: 15 }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(0,0,0,0.8)',
                            titleFont: { size: 12, weight: 'bold' },
                            bodyFont: { size: 11 },
                            padding: 12,
                            cornerRadius: 8
                        }
                    },
                    scales: {
                        y: {
                            type: 'linear',
                            display: true,
                            position: 'left',
                            beginAtZero: false,
                            title: { 
                                display: true, 
                                text: 'MAE / MAPE', 
                                font: { size: 11, weight: 'bold' } 
                            },
                            grid: { color: 'rgba(0,0,0,0.08)' },
                            ticks: { font: { size: 10 } }
                        },
                        y1: {
                            type: 'linear',
                            display: true,
                            position: 'right',
                            beginAtZero: false,
                            title: { 
                                display: true, 
                                text: '特徵數', 
                                font: { size: 11, weight: 'bold' } 
                            },
                            grid: { drawOnChartArea: false },
                            ticks: { font: { size: 10 } }
                        },
                        x: {
                            title: { 
                                display: true, 
                                text: '版本', 
                                font: { size: 11, weight: 'bold' } 
                            },
                            grid: { display: false },
                            ticks: { font: { size: 10, weight: 'bold' } }
                        }
                    }
                }
            });
            console.log('✅ 時間線圖表已渲染，數據點:', validData.length);
        } catch (error) {
            console.error('❌ 渲染時間線圖表失敗:', error);
        }
    },
    
    async loadModelMetrics() {
        // 只載入一次，除非強制刷新
        if (this.metricsLoaded) return;
        
        try {
            const response = await fetch('/api/model-diagnostics');
            if (!response.ok) throw new Error('Failed to fetch model diagnostics');
            
            const result = await response.json();
            // 嘗試多個路徑獲取 metrics
            const modelStatus = result.data?.modelStatus;
            const metrics = modelStatus?.xgboost?.metrics || 
                           modelStatus?.details?.xgboost?.metrics ||
                           null;
            
            if (result.success && metrics) {
                
                // 更新方法論中的性能指標
                const maeEl = document.getElementById('methodology-mae');
                const mapeEl = document.getElementById('methodology-mape');
                const trainDateEl = document.getElementById('methodology-train-date');
                const dataCountEl = document.getElementById('methodology-data-count');
                
                if (maeEl && metrics.mae !== undefined) {
                    maeEl.textContent = metrics.mae.toFixed(2);
                }
                if (mapeEl && metrics.mape !== undefined) {
                    mapeEl.textContent = metrics.mape.toFixed(2);
                }
                if (trainDateEl && metrics.training_date) {
                    // 格式化為 HKT 時間
                    const date = new Date(metrics.training_date);
                    const hktDate = date.toLocaleString('zh-HK', {
                        timeZone: 'Asia/Hong_Kong',
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false
                    });
                    trainDateEl.textContent = hktDate;
                }
                if (dataCountEl && metrics.data_count !== undefined) {
                    dataCountEl.textContent = metrics.data_count.toLocaleString();
                }
                
                this.metricsLoaded = true;
                console.log('📊 方法論模型指標已更新:', metrics);
            }
        } catch (error) {
            console.error('❌ 載入模型指標失敗:', error);
            // 設置錯誤顯示
            const maeEl = document.getElementById('methodology-mae');
            const mapeEl = document.getElementById('methodology-mape');
            if (maeEl) maeEl.textContent = 'N/A';
            if (mapeEl) mapeEl.textContent = 'N/A';
        }
    },
    
    // 強制刷新指標（訓練後調用）
    refreshMetrics() {
        this.metricsLoaded = false;
        this.timelineLoaded = false;
        this.loadModelMetrics();
        this.loadAlgorithmTimeline();
    }
};

// ============================================
// 主頁面算法時間線
// ============================================
const MainPageTimeline = {
    chart: null,
    loaded: false,
    
    async init() {
        const container = document.getElementById('main-algorithm-timeline');
        const canvas = document.getElementById('main-accuracy-chart');
        
        if (!container) {
            console.warn('MainPageTimeline: container not found');
            return;
        }
        
        console.log('📈 初始化主頁面時間線...');
        
        // 獲取時間線數據
        let timeline;
        try {
            const response = await fetch('/api/algorithm-timeline');
            if (response.ok) {
                const result = await response.json();
                if (result.success && result.data?.timeline) {
                    timeline = result.data.timeline;
                }
            }
        } catch (e) {
            console.warn('API 獲取失敗，使用備用數據');
        }
        
        // 備用數據
        if (!timeline) {
            timeline = [
                { version: '2.9.20', date: '2025-12-30', description: '基礎 XGBoost', metrics: { mae: 3.84, mape: 1.56, feature_count: 52 }, changes: ['300樹', '深度6'] },
                { version: '2.9.24', date: '2025-12-31', description: '天氣特徵整合', metrics: { mae: 3.75, mape: 1.52, feature_count: 89 }, changes: ['HKO數據', '10天氣特徵'] },
                { version: '2.9.28', date: '2026-01-02', description: '研究基礎優化', metrics: { mae: 3.84, mape: 1.56, feature_count: 99 }, changes: ['500樹', 'Fourier', '樣本權重'] },
                { version: '2.9.50', date: '2026-01-01', description: 'Optuna 超參數優化', metrics: { mae: 6.30, mape: 2.45, r2: 0.90, feature_count: 161 }, changes: ['Optuna TPE', 'EWMA特徵', 'R²90.3%'] },
                { version: '2.9.52', date: '2026-01-02', description: '自動特徵優化', metrics: { mae: 5.33, mape: 2.10, r2: 0.92, feature_count: 25 }, changes: ['智能優化器', '25特徵', 'R²92%'] }
            ];
        }
        
        // 渲染時間線列表
        this.renderTimeline(container, timeline);
        
        // 渲染圖表
        if (canvas && typeof Chart !== 'undefined') {
            this.renderChart(canvas, timeline);
        } else if (canvas) {
            // 延遲等待 Chart.js
            setTimeout(() => {
                if (typeof Chart !== 'undefined') {
                    this.renderChart(canvas, timeline);
                }
            }, 1000);
        }
        
        this.loaded = true;
        console.log('✅ 主頁面時間線初始化完成');
    },
    
    renderTimeline(container, timeline) {
        let html = '';
        const latestIdx = timeline.length - 1;
        
        for (let i = latestIdx; i >= 0; i--) {
            const item = timeline[i];
            const isLatest = i === latestIdx;
            const prevItem = i > 0 ? timeline[i - 1] : null;
            
            let maeImproved = false, mapeImproved = false;
            if (prevItem && item.metrics?.mae && prevItem.metrics?.mae) {
                maeImproved = item.metrics.mae < prevItem.metrics.mae;
            }
            if (prevItem && item.metrics?.mape && prevItem.metrics?.mape) {
                mapeImproved = item.metrics.mape < prevItem.metrics.mape;
            }
            
            html += `
                <div class="timeline-item ${isLatest ? 'latest' : ''}">
                    <div class="timeline-version">${item.version}${isLatest ? ' 🆕' : ''}</div>
                    <div class="timeline-info">
                        <div class="timeline-date">${item.date}</div>
                        <div class="timeline-desc">${item.description}</div>
                        <div class="timeline-metrics">
                            <span class="timeline-metric ${maeImproved ? 'improved' : ''}">
                                <strong>MAE:</strong> ${item.metrics?.mae?.toFixed(2) || '--'}${maeImproved ? ' ↓' : ''}
                            </span>
                            <span class="timeline-metric ${mapeImproved ? 'improved' : ''}">
                                <strong>MAPE:</strong> ${item.metrics?.mape?.toFixed(2) || '--'}%${mapeImproved ? ' ↓' : ''}
                            </span>
                            <span class="timeline-metric">
                                <strong>特徵:</strong> ${item.metrics?.feature_count || '--'}
                            </span>
                        </div>
                        ${item.changes?.length > 0 ? `
                        <div class="timeline-changes">
                            ${item.changes.map(c => `<span class="timeline-tag">${c}</span>`).join('')}
                        </div>` : ''}
                    </div>
                </div>
            `;
        }
        
        container.innerHTML = html;
    },
    
    renderChart(canvas, timeline) {
        const validData = timeline.filter(t => t.metrics?.mae != null);
        if (validData.length === 0) return;
        
        const labels = validData.map(t => t.version);
        const maeData = validData.map(t => t.metrics.mae);
        const mapeData = validData.map(t => t.metrics.mape);
        const featureData = validData.map(t => t.metrics.feature_count);
        
        if (this.chart) {
            this.chart.destroy();
        }
        
        try {
            this.chart = new Chart(canvas.getContext('2d'), {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'MAE (人)',
                            data: maeData,
                            borderColor: '#4f46e5',
                            backgroundColor: 'rgba(79, 70, 229, 0.15)',
                            borderWidth: 3,
                            pointRadius: 8,
                            pointBackgroundColor: '#4f46e5',
                            pointBorderColor: '#fff',
                            pointBorderWidth: 2,
                            tension: 0.3,
                            fill: true
                        },
                        {
                            label: 'MAPE (%)',
                            data: mapeData,
                            borderColor: '#059669',
                            borderWidth: 2,
                            pointRadius: 6,
                            pointBackgroundColor: '#059669',
                            tension: 0.3,
                            borderDash: [5, 5]
                        },
                        {
                            label: '特徵數',
                            data: featureData,
                            borderColor: '#f59e0b',
                            borderWidth: 2,
                            pointRadius: 5,
                            pointBackgroundColor: '#f59e0b',
                            tension: 0.3,
                            borderDash: [2, 2],
                            yAxisID: 'y1'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'top',
                            labels: { boxWidth: 12, padding: 10, font: { size: 11 }, usePointStyle: true }
                        },
                        title: {
                            display: true,
                            text: '📊 算法更新效果分析',
                            font: { size: 14, weight: 'bold' }
                        }
                    },
                    scales: {
                        y: {
                            type: 'linear',
                            position: 'left',
                            title: { display: true, text: 'MAE / MAPE', font: { size: 11 } }
                        },
                        y1: {
                            type: 'linear',
                            position: 'right',
                            title: { display: true, text: '特徵數', font: { size: 11 } },
                            grid: { drawOnChartArea: false }
                        }
                    }
                }
            });
            console.log('✅ 主頁面圖表已渲染');
        } catch (e) {
            console.error('圖表渲染失敗:', e);
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
                // error_percentage = (predicted - actual) / actual * 100
                // 可能是負數（預測偏低）或正數（預測偏高）
                if (d.error_percentage !== undefined && d.error_percentage !== null) {
                    const errorPct = parseFloat(d.error_percentage);
                    // 使用絕對值計算準確度
                    const accuracy = 100 - Math.abs(errorPct);
                    return Math.max(0, Math.min(100, accuracy));
                }
                if (d.accuracy) return parseFloat(d.accuracy);
                // 從 actual vs predicted 計算
                if (d.actual && d.predicted) {
                    const error = Math.abs(d.actual - d.predicted) / d.actual * 100;
                    return Math.max(0, Math.min(100, 100 - error));
                }
                return null; // 無資料時返回 null
            }).reverse();
            
            console.log('📊 AccuracyChart 原始數據:', accuracies.map(a => a?.toFixed(2)));
            
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
                                title: ctx => ctx[0].label,
                                label: ctx => `準確度: ${ctx.raw.toFixed(2)}%`,
                                afterLabel: ctx => {
                                    const errorPct = (100 - ctx.raw).toFixed(2);
                                    return `誤差率: ${errorPct}%`;
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            min: 40,
                            max: 100,
                            ticks: {
                                callback: v => v.toFixed(0) + '%',
                                stepSize: 10
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
            // 天氣影響因子數據（基於歷史分析）
            // 正數 = 人流增加，負數 = 人流減少
            // v3.0.60: 基於真實數據分析的天氣警告影響
            // 數據來源: NDH 2015-2025 出席記錄 + HKO 警告歷史
            // 基準: 無警告日平均 251.3 人 (2539 天)
            const weatherFactors = [
                { factor: '🌧️ 黃色暴雨', impact: -16.4, days: 4, mean: 210.0, color: 'rain' },
                { factor: '🌀 八號颱風 (T8+)', impact: -12.1, days: 23, mean: 220.9, color: 'typhoon' },
                { factor: '⛈️ 黑色暴雨', impact: -8.0, days: 29, mean: 231.3, color: 'rainstorm' },
                { factor: '⛈️ 紅色暴雨', impact: -6.0, days: 13, mean: 236.2, color: 'rainstorm' },
                { factor: '🌀 三號颱風 (T3)', impact: -3.9, days: 21, mean: 241.6, color: 'typhoon' },
                { factor: '❄️ 寒冷警告', impact: -3.4, days: 380, mean: 242.7, color: 'cold' },
                { factor: '🔥 酷熱警告', impact: -1.8, days: 454, mean: 246.9, color: 'hot' }
            ];
            // 注：所有警告均降低出席（人們留家/交通受阻）
            
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
                        backgroundColor: weatherFactors.map(w => {
                            // 根據警告類型設定顏色
                            if (w.color === 'typhoon') return 'rgba(139, 92, 246, 0.8)';  // 紫色
                            if (w.color === 'rainstorm') return 'rgba(59, 130, 246, 0.8)';  // 藍色
                            if (w.color === 'hot') return 'rgba(239, 68, 68, 0.8)';  // 紅色
                            if (w.color === 'cold') return 'rgba(56, 189, 248, 0.8)';  // 淺藍色
                            if (w.color === 'rain') return 'rgba(34, 197, 94, 0.8)';  // 綠色
                            return 'rgba(100, 116, 139, 0.7)';  // 灰色
                        }),
                        borderRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    indexAxis: 'y',
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: ctx => {
                                    const val = ctx.raw;
                                    const factor = weatherFactors[ctx.dataIndex];
                                    if (val > 0) return `人流增加 +${val}%`;
                                    if (val < 0) return `人流減少 ${val}%`;
                                    return '無影響（基準線）';
                                },
                                afterLabel: ctx => {
                                    const factor = weatherFactors[ctx.dataIndex];
                                    return `平均 ${factor.mean} 人 (${factor.days} 天樣本)`;
                                },
                                footer: () => '📊 基準: 無警告日 251 人'
                            }
                        }
                    },
                    scales: {
                        x: {
                            ticks: {
                                callback: v => (v > 0 ? '+' : '') + v + '%'
                            },
                            grid: {
                                color: ctx => ctx.tick.value === 0 ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.05)'
                            }
                        }
                    }
                }
            });
            
            // 添加說明文字到 chart-card 底部（避免溢出容器）
            const chartCard = canvas.closest('.chart-card');
            if (chartCard && !chartCard.querySelector('.chart-note')) {
                const note = document.createElement('div');
                note.className = 'chart-note';
                note.style.cssText = 'font-size: 11px; color: var(--text-muted); text-align: center; padding: 8px 12px; border-top: 1px solid var(--border-color, rgba(0,0,0,0.05)); background: var(--bg-secondary, #f8f9fa);';
                note.innerHTML = '📊 0% = 正常天氣（基準線）| <span style="color:#dc2626">紅色</span> = 人流↑ | <span style="color:#059669">綠色</span> = 人流↓';
                chartCard.appendChild(note);
            }
            
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
        // 暴露重新應用設定功能到全局（解決時序問題）
        window.applyChartControlsSettings = () => ChartControls.applySettings();
        console.log('  ✓ ChartControls');
    } catch (e) { console.error('ChartControls error:', e); }
    
    
    try {
        MethodologyModal.init();
        console.log('  ✓ MethodologyModal');
    } catch (e) { console.error('MethodologyModal error:', e); }
    
    try {
        MainPageTimeline.init();
        console.log('  ✓ MainPageTimeline');
    } catch (e) { console.error('MainPageTimeline error:', e); }
    
    try {
        FullWindowDrop.init();
    } catch (e) { console.error('FullWindowDrop error:', e); }
    
    // 綁定主題切換按鈕
    const themeBtn = document.getElementById('theme-toggle');
    
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
    
    // 延遲初始化圖表相關（等待 Chart.js 和其他圖表載入完成）
    setTimeout(() => {
        try {
            ConfidenceDashboard.update();
        } catch (e) { console.error('ConfidenceDashboard error:', e); }
        
        try {
            AccuracyChart.init();
        } catch (e) { console.error('AccuracyChart error:', e); }
        
        // v3.0.1: 禁用舊版 WeatherCorrChart（prediction.js 有使用真實 HKO 數據的版本）
        // try {
        //     WeatherCorrChart.init();
        // } catch (e) { console.error('WeatherCorrChart error:', e); }
    }, 3000); // 延長到 3 秒以確保 Chart.js 已完全載入
    
    // 定期更新時間和置信度
    setInterval(() => {
        try {
            UpdateTimeManager.update();
            ConfidenceDashboard.update();
        } catch (e) {}
    }, 60000);
    
    // 暴露模組到全局，讓 prediction.js 可以訪問
    window.UIEnhancements = {
        ConfidenceDashboard,
        UpdateTimeManager,
        Toast,
        AlertManager,
        ChartControls
    };
    
    console.log('✅ UI 增強模組 v3.0.30 已初始化');
}

// 導出供外部使用
export { ThemeManager, NavManager, Toast, AlertManager, ChartControls, ConfidenceDashboard };

