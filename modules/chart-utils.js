/**
 * 圖表工具函數模組
 * 包含圖表配置、顏色、響應式設置等工具函數
 */

// 圖表顏色配置
export const chartColors = {
    primary: '#4f46e5',
    primaryLight: 'rgba(79, 70, 229, 0.1)',
    success: '#059669',
    successLight: 'rgba(5, 150, 105, 0.08)',
    danger: '#dc2626',
    dangerLight: 'rgba(220, 38, 38, 0.1)',
    warning: '#d97706',
    muted: '#94a3b8',
    mutedLight: 'rgba(148, 163, 184, 0.15)',
    text: '#1e293b',
    textSecondary: '#64748b',
    grid: 'rgba(0, 0, 0, 0.06)',
    border: 'rgba(0, 0, 0, 0.1)'
};

/**
 * 獲取響應式 layout padding（根據屏幕寬度）
 */
export function getResponsivePadding() {
    const width = window.innerWidth;
    if (width <= 380) {
        return { top: 8, bottom: 20, left: 8, right: 8 };
    } else if (width <= 600) {
        return { top: 10, bottom: 25, left: 10, right: 10 };
    } else if (width <= 900) {
        return { top: 10, bottom: 30, left: 12, right: 12 };
    } else {
        return { top: 12, bottom: 35, left: 15, right: 15 };
    }
}

/**
 * 獲取對比圖表的響應式 layout padding
 */
export function getComparisonChartPadding() {
    const width = window.innerWidth;
    if (width <= 380) {
        return { top: 8, bottom: 25, left: 5, right: 5 };
    } else if (width <= 600) {
        return { top: 10, bottom: 30, left: 8, right: 8 };
    } else if (width <= 900) {
        return { top: 10, bottom: 35, left: 10, right: 10 };
    } else {
        return { top: 12, bottom: 40, left: 10, right: 15 };
    }
}

/**
 * 獲取響應式 maxTicksLimit
 */
export function getResponsiveMaxTicksLimit() {
    const width = window.innerWidth;
    if (width <= 380) {
        return 5;
    } else if (width <= 600) {
        return 8;
    } else if (width <= 900) {
        return 12;
    } else {
        return 15;
    }
}

/**
 * 將數值四捨五入到整數（用於 Y 軸標籤）
 */
export function roundToInteger(value) {
    return Math.round(value);
}

/**
 * 計算合適的 Y 軸範圍，確保標籤是整數
 */
export function calculateNiceAxisRange(minVal, maxVal, stepSize = 50) {
    const padding = 20;
    const min = Math.floor((minVal - padding) / stepSize) * stepSize;
    const max = Math.ceil((maxVal + padding) / stepSize) * stepSize;
    return { min, max };
}

/**
 * 處理圖表載入錯誤
 */
export function handleChartLoadingError(chartId, error) {
    console.error(`圖表 ${chartId} 載入失敗:`, error);

    const container = document.getElementById(`${chartId}-container`) ||
                     document.getElementById(`${chartId}-chart-container`);

    if (container) {
        const loadingEl = container.querySelector('.chart-loading');
        if (loadingEl) {
            loadingEl.innerHTML = `
                <div class="error-state">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>圖表載入失敗</p>
                    <button onclick="location.reload()" class="btn-retry">重試</button>
                </div>
            `;
        }
    }
}

/**
 * 安全銷毀圖表實例
 */
export function safeDestroyChart(chartVar, canvasId) {
    if (chartVar) {
        try {
            chartVar.destroy();
        } catch (e) {
            console.warn(`銷毀圖表 ${canvasId} 時出錯:`, e);
        }
    }
}

/**
 * 更新載入進度
 */
export function updateLoadingProgress(chartId, percent) {
    const container = document.getElementById(`${chartId}-container`) ||
                     document.getElementById(`${chartId}-chart-container`);

    if (container) {
        const progressBar = container.querySelector('.progress-bar');
        if (progressBar) {
            progressBar.style.width = `${percent}%`;
        }
    }
}

/**
 * 完成圖表載入
 */
export function completeChartLoading(chartId) {
    const container = document.getElementById(`${chartId}-container`) ||
                     document.getElementById(`${chartId}-chart-container`);

    if (container) {
        const loadingEl = container.querySelector('.chart-loading');
        if (loadingEl) {
            loadingEl.style.display = 'none';
        }
    }
}

/**
 * 設置圖表響應式調整
 */
export function setupChartResize(chart, containerId) {
    if (!chart) return;

    const resizeObserver = new ResizeObserver(() => {
        if (chart && !chart.destroyed) {
            chart.resize();
        }
    });

    const container = document.getElementById(containerId);
    if (container) {
        resizeObserver.observe(container);
    }

    return resizeObserver;
}

/**
 * 設置全局圖表響應式調整
 */
export function setupGlobalChartResize() {
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            forceChartsResize();
        }, 250);
    });
}

/**
 * 強制所有圖表重新調整大小
 */
export function forceChartsResize() {
    const charts = [
        window.historyChart,
        window.comparisonChart,
        window.weatherCorrChart,
        window.volatilityChart,
        window.dualTrackChart
    ];

    charts.forEach(chart => {
        if (chart && !chart.destroyed) {
            try {
                chart.resize();
            } catch (e) {
                console.warn('圖表調整大小失敗:', e);
            }
        }
    });
}

/**
 * 獲取專業圖表選項
 */
export function getProfessionalOptions() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            intersect: false,
            mode: 'index'
        },
        layout: {
            padding: getResponsivePadding(),
            autoPadding: true
        },
        plugins: {
            legend: {
                display: true,
                position: 'top',
                align: 'center',
                fullSize: true,
                labels: {
                    usePointStyle: true,
                    pointStyle: 'circle',
                    padding: window.innerWidth <= 600 ? 10 : 15,
                    color: chartColors.text,
                    font: {
                        size: window.innerWidth <= 600 ? 11 : 12,
                        weight: 600
                    },
                    boxWidth: 8,
                    boxHeight: 8
                }
            },
            tooltip: {
                enabled: true,
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                titleColor: '#fff',
                bodyColor: '#fff',
                borderColor: chartColors.border,
                borderWidth: 1,
                padding: 12,
                displayColors: true,
                callbacks: {
                    label: function(context) {
                        let label = context.dataset.label || '';
                        if (label) {
                            label += ': ';
                        }
                        if (context.parsed.y !== null) {
                            label += Math.round(context.parsed.y) + ' 人';
                        }
                        return label;
                    }
                }
            }
        },
        scales: {
            x: {
                grid: {
                    display: true,
                    color: chartColors.grid,
                    drawBorder: false
                },
                ticks: {
                    color: chartColors.textSecondary,
                    font: {
                        size: window.innerWidth <= 600 ? 10 : 11
                    },
                    maxRotation: 45,
                    minRotation: 0,
                    autoSkip: true,
                    maxTicksLimit: getResponsiveMaxTicksLimit()
                }
            },
            y: {
                beginAtZero: false,
                grid: {
                    display: true,
                    color: chartColors.grid,
                    drawBorder: false
                },
                ticks: {
                    color: chartColors.textSecondary,
                    font: {
                        size: window.innerWidth <= 600 ? 10 : 11
                    },
                    callback: roundToInteger
                }
            }
        }
    };
}
