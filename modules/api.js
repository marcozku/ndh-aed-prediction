/**
 * API 模組 - 處理所有 API 調用
 */
export class API {
    static async getHistoricalData() {
        try {
            const response = await fetch('/api/actual-data');
            const result = await response.json();
            if (result.success) {
                return result.data.map(d => ({
                    date: d.date,
                    attendance: d.patient_count
                }));
            }
            return [];
        } catch (error) {
            console.error('獲取歷史數據失敗:', error);
            return [];
        }
    }

    static async getComparisonData(limit = 100) {
        try {
            const response = await fetch(`/api/comparison?limit=${limit}`);
            const result = await response.json();
            return result.success ? result.data : [];
        } catch (error) {
            console.error('獲取比較數據失敗:', error);
            return [];
        }
    }

    static async updateAIFactors(force = false) {
        try {
            const response = await fetch('/api/ai-analyze');
            const result = await response.json();
            return result.success ? result : { factors: [], summary: '無法獲取 AI 分析' };
        } catch (error) {
            console.error('更新 AI 因素失敗:', error);
            return { factors: [], summary: '無法獲取 AI 分析', error: error.message };
        }
    }

    static async addActualData() {
        try {
            const response = await fetch('/api/auto-add-actual-data', { method: 'POST' });
            return await response.json();
        } catch (error) {
            console.error('添加實際數據失敗:', error);
            return { success: false, error: error.message };
        }
    }

    static async getDBStatus() {
        try {
            const response = await fetch('/api/db-status');
            return await response.json();
        } catch (error) {
            return { connected: false, error: error.message };
        }
    }

    static async getAIStatus() {
        try {
            const response = await fetch('/api/ai-status');
            return await response.json();
        } catch (error) {
            return { connected: false, error: error.message };
        }
    }
}
