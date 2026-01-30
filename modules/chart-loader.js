/**
 * 圖表懶載入管理器
 * 優化性能，只在圖表進入視窗時才載入
 */

export const LazyChartLoader = {
    observers: new Map(),
    loadedCharts: new Set(),
    predictor: null,

    // 設置預測器引用
    setPredictor(p) {
        this.predictor = p;
    },

    // 初始化懶載入觀察器
    init() {
        if (!('IntersectionObserver' in window)) {
            console.log('⚠️ IntersectionObserver 不支援，使用即時載入');
            return false;
        }
        return true;
    },

    // 為圖表設置懶載入
    observe(chartId, loadFunction) {
        const container = document.getElementById(`${chartId}-container`) ||
                         document.getElementById(`${chartId}-chart-container`) ||
                         document.querySelector(`#${chartId}-chart`)?.parentElement;

        if (!container) {
            console.warn(`找不到圖表容器: ${chartId}`);
            return;
        }

        // 如果已載入，跳過
        if (this.loadedCharts.has(chartId)) return;

        const observer = new IntersectionObserver(async (entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting && !this.loadedCharts.has(chartId)) {
                    console.log(`📊 懶載入圖表: ${chartId}`);
                    this.loadedCharts.add(chartId);
                    observer.disconnect();
                    this.observers.delete(chartId);

                    try {
                        await loadFunction();
                    } catch (error) {
                        console.error(`圖表 ${chartId} 載入失敗:`, error);
                        this.loadedCharts.delete(chartId); // 允許重試
                    }
                }
            }
        }, {
            rootMargin: '200px 0px', // 提前 200px 開始載入
            threshold: 0.01
        });

        observer.observe(container);
        this.observers.set(chartId, observer);
    },

    // 強制載入特定圖表
    async forceLoad(chartId, loadFunction) {
        if (this.loadedCharts.has(chartId)) return;
        this.loadedCharts.add(chartId);

        const observer = this.observers.get(chartId);
        if (observer) {
            observer.disconnect();
            this.observers.delete(chartId);
        }

        await loadFunction();
    },

    // 清除所有觀察器
    cleanup() {
        this.observers.forEach(observer => observer.disconnect());
        this.observers.clear();
    }
};
