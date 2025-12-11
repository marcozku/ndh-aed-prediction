/**
 * NDH AED 病人數量預測系統
 * North District Hospital AED Attendance Prediction Algorithm
 * 
 * 基於數據庫中的歷史數據分析（動態日期範圍）
 * 使用多因素預測模型：星期效應、假期效應、季節效應、流感季節等
 */

// ============================================
// 香港公眾假期 2024-2026
// ============================================
const HK_PUBLIC_HOLIDAYS = {
    // 2024
    '2024-12-25': { name: 'Christmas Day', type: 'western', factor: 0.91 },
    '2024-12-26': { name: 'Boxing Day', type: 'western', factor: 0.95 },
    // 2025
    '2025-01-01': { name: 'New Year', type: 'western', factor: 0.95 },
    '2025-01-29': { name: '農曆新年初一', type: 'lny', factor: 0.73 },
    '2025-01-30': { name: '農曆新年初二', type: 'lny', factor: 0.93 },
    '2025-01-31': { name: '農曆新年初三', type: 'lny', factor: 0.98 },
    '2025-02-01': { name: '農曆新年初四', type: 'lny', factor: 1.0 },
    '2025-04-04': { name: '清明節', type: 'traditional', factor: 0.85 },
    '2025-04-18': { name: 'Good Friday', type: 'western', factor: 0.95 },
    '2025-04-19': { name: 'Holy Saturday', type: 'western', factor: 0.95 },
    '2025-04-21': { name: 'Easter Monday', type: 'western', factor: 0.95 },
    '2025-05-01': { name: '勞動節', type: 'statutory', factor: 0.95 },
    '2025-05-05': { name: '佛誕', type: 'traditional', factor: 0.93 },
    '2025-05-31': { name: '端午節', type: 'traditional', factor: 0.90 },
    '2025-07-01': { name: '香港特區成立紀念日', type: 'statutory', factor: 0.92 },
    '2025-10-01': { name: '國慶日', type: 'statutory', factor: 0.92 },
    '2025-10-07': { name: '中秋節翌日', type: 'traditional', factor: 0.90 },
    '2025-10-29': { name: '重陽節', type: 'traditional', factor: 0.93 },
    '2025-12-25': { name: 'Christmas Day', type: 'western', factor: 0.91 },
    '2025-12-26': { name: 'Boxing Day', type: 'western', factor: 0.95 },
    // 2026
    '2026-01-01': { name: 'New Year', type: 'western', factor: 0.95 },
    '2026-02-17': { name: '農曆新年初一', type: 'lny', factor: 0.73 },
    '2026-02-18': { name: '農曆新年初二', type: 'lny', factor: 0.93 },
    '2026-02-19': { name: '農曆新年初三', type: 'lny', factor: 0.98 },
};

// ============================================
// 歷史數據（從數據庫動態獲取）
// ============================================
const HISTORICAL_DATA = [
    { date: '2024-12-03', attendance: 269 },
    { date: '2024-12-04', attendance: 230 },
    { date: '2024-12-05', attendance: 271 },
    { date: '2024-12-06', attendance: 260 },
    { date: '2024-12-07', attendance: 212 },
    { date: '2024-12-08', attendance: 228 },
    { date: '2024-12-09', attendance: 299 },
    { date: '2024-12-10', attendance: 247 },
    { date: '2024-12-11', attendance: 241 },
    { date: '2024-12-12', attendance: 261 },
    { date: '2024-12-13', attendance: 232 },
    { date: '2024-12-14', attendance: 233 },
    { date: '2024-12-15', attendance: 208 },
    { date: '2024-12-16', attendance: 280 },
    { date: '2024-12-17', attendance: 275 },
    { date: '2024-12-18', attendance: 253 },
    { date: '2024-12-19', attendance: 267 },
    { date: '2024-12-20', attendance: 254 },
    { date: '2024-12-21', attendance: 217 },
    { date: '2024-12-22', attendance: 231 },
    { date: '2024-12-23', attendance: 280 },
    { date: '2024-12-24', attendance: 245 },
    { date: '2024-12-25', attendance: 231 },
    { date: '2024-12-26', attendance: 250 },
    { date: '2024-12-27', attendance: 281 },
    { date: '2024-12-28', attendance: 224 },
    { date: '2024-12-29', attendance: 247 },
    { date: '2024-12-30', attendance: 317 },
    { date: '2024-12-31', attendance: 269 },
    { date: '2025-01-01', attendance: 280 },
    { date: '2025-01-02', attendance: 270 },
    { date: '2025-01-03', attendance: 280 },
    { date: '2025-01-04', attendance: 214 },
    { date: '2025-01-05', attendance: 283 },
    { date: '2025-01-06', attendance: 288 },
    { date: '2025-01-07', attendance: 265 },
    { date: '2025-01-08', attendance: 260 },
    { date: '2025-01-09', attendance: 263 },
    { date: '2025-01-10', attendance: 242 },
    { date: '2025-01-11', attendance: 239 },
    { date: '2025-01-12', attendance: 243 },
    { date: '2025-01-13', attendance: 286 },
    { date: '2025-01-14', attendance: 311 },
    { date: '2025-01-15', attendance: 273 },
    { date: '2025-01-16', attendance: 246 },
    { date: '2025-01-17', attendance: 243 },
    { date: '2025-01-18', attendance: 241 },
    { date: '2025-01-19', attendance: 274 },
    { date: '2025-01-20', attendance: 291 },
    { date: '2025-01-21', attendance: 276 },
    { date: '2025-01-22', attendance: 268 },
    { date: '2025-01-23', attendance: 275 },
    { date: '2025-01-24', attendance: 239 },
    { date: '2025-01-25', attendance: 232 },
    { date: '2025-01-26', attendance: 229 },
    { date: '2025-01-27', attendance: 229 },
    { date: '2025-01-28', attendance: 242 },
    { date: '2025-01-29', attendance: 186 },
    { date: '2025-01-30', attendance: 237 },
    { date: '2025-01-31', attendance: 269 },
    { date: '2025-02-01', attendance: 280 },
    { date: '2025-02-02', attendance: 265 },
    { date: '2025-02-03', attendance: 263 },
    { date: '2025-02-04', attendance: 281 },
    { date: '2025-02-05', attendance: 260 },
    { date: '2025-02-06', attendance: 302 },
    { date: '2025-02-07', attendance: 277 },
    { date: '2025-02-08', attendance: 222 },
    { date: '2025-02-09', attendance: 232 },
    { date: '2025-02-10', attendance: 286 },
    { date: '2025-02-11', attendance: 281 },
    { date: '2025-02-12', attendance: 269 },
    { date: '2025-02-13', attendance: 261 },
    { date: '2025-02-14', attendance: 293 },
    { date: '2025-02-15', attendance: 254 },
    { date: '2025-02-16', attendance: 267 },
    { date: '2025-02-17', attendance: 305 },
    { date: '2025-02-18', attendance: 291 },
    { date: '2025-02-19', attendance: 253 },
    { date: '2025-02-20', attendance: 271 },
    { date: '2025-02-21', attendance: 284 },
    { date: '2025-02-22', attendance: 240 },
    { date: '2025-02-23', attendance: 229 },
    { date: '2025-02-24', attendance: 256 },
    { date: '2025-02-25', attendance: 261 },
    { date: '2025-02-26', attendance: 256 },
    { date: '2025-02-27', attendance: 252 },
    { date: '2025-02-28', attendance: 262 },
    { date: '2025-03-01', attendance: 245 },
    { date: '2025-03-02', attendance: 269 },
    { date: '2025-03-03', attendance: 286 },
    { date: '2025-03-04', attendance: 274 },
    { date: '2025-03-05', attendance: 264 },
    { date: '2025-03-06', attendance: 258 },
    { date: '2025-03-07', attendance: 254 },
    { date: '2025-03-08', attendance: 231 },
    { date: '2025-03-09', attendance: 239 },
    { date: '2025-03-10', attendance: 329 },
    { date: '2025-03-11', attendance: 239 },
    { date: '2025-03-12', attendance: 276 },
    { date: '2025-03-13', attendance: 288 },
    { date: '2025-03-14', attendance: 259 },
    { date: '2025-03-15', attendance: 244 },
    { date: '2025-03-16', attendance: 242 },
    { date: '2025-03-17', attendance: 247 },
    { date: '2025-03-18', attendance: 237 },
    { date: '2025-03-19', attendance: 270 },
    { date: '2025-03-20', attendance: 258 },
    { date: '2025-03-21', attendance: 241 },
    { date: '2025-03-22', attendance: 246 },
    { date: '2025-03-23', attendance: 243 },
    { date: '2025-03-24', attendance: 292 },
    { date: '2025-03-25', attendance: 268 },
    { date: '2025-03-26', attendance: 238 },
    { date: '2025-03-27', attendance: 283 },
    { date: '2025-03-28', attendance: 246 },
    { date: '2025-03-29', attendance: 216 },
    { date: '2025-03-30', attendance: 197 },
    { date: '2025-03-31', attendance: 253 },
    { date: '2025-04-01', attendance: 246 },
    { date: '2025-04-02', attendance: 233 },
    { date: '2025-04-03', attendance: 262 },
    { date: '2025-04-04', attendance: 202 },
    { date: '2025-04-05', attendance: 196 },
    { date: '2025-04-06', attendance: 223 },
    { date: '2025-04-07', attendance: 283 },
    { date: '2025-04-08', attendance: 264 },
    { date: '2025-04-09', attendance: 265 },
    { date: '2025-04-10', attendance: 237 },
    { date: '2025-04-11', attendance: 253 },
    { date: '2025-04-12', attendance: 220 },
    { date: '2025-04-13', attendance: 236 },
    { date: '2025-04-14', attendance: 272 },
    { date: '2025-04-15', attendance: 262 },
    { date: '2025-04-16', attendance: 237 },
    { date: '2025-04-17', attendance: 239 },
    { date: '2025-04-18', attendance: 251 },
    { date: '2025-04-19', attendance: 237 },
    { date: '2025-04-20', attendance: 231 },
    { date: '2025-04-21', attendance: 236 },
    { date: '2025-04-22', attendance: 274 },
    { date: '2025-04-23', attendance: 278 },
    { date: '2025-04-24', attendance: 288 },
    { date: '2025-04-25', attendance: 243 },
    { date: '2025-04-26', attendance: 230 },
    { date: '2025-04-27', attendance: 214 },
    { date: '2025-04-28', attendance: 273 },
    { date: '2025-04-29', attendance: 249 },
    { date: '2025-04-30', attendance: 279 },
    { date: '2025-05-01', attendance: 247 },
    { date: '2025-05-02', attendance: 289 },
    { date: '2025-05-03', attendance: 231 },
    { date: '2025-05-04', attendance: 246 },
    { date: '2025-05-05', attendance: 231 },
    { date: '2025-05-06', attendance: 264 },
    { date: '2025-05-07', attendance: 216 },
    { date: '2025-05-08', attendance: 276 },
    { date: '2025-05-09', attendance: 252 },
    { date: '2025-05-10', attendance: 213 },
    { date: '2025-05-11', attendance: 222 },
    { date: '2025-05-12', attendance: 290 },
    { date: '2025-05-13', attendance: 226 },
    { date: '2025-05-14', attendance: 238 },
    { date: '2025-05-15', attendance: 295 },
    { date: '2025-05-16', attendance: 268 },
    { date: '2025-05-17', attendance: 216 },
    { date: '2025-05-18', attendance: 272 },
    { date: '2025-05-19', attendance: 300 },
    { date: '2025-05-20', attendance: 285 },
    { date: '2025-05-21', attendance: 240 },
    { date: '2025-05-22', attendance: 249 },
    { date: '2025-05-23', attendance: 264 },
    { date: '2025-05-24', attendance: 235 },
    { date: '2025-05-25', attendance: 244 },
    { date: '2025-05-26', attendance: 274 },
    { date: '2025-05-27', attendance: 261 },
    { date: '2025-05-28', attendance: 244 },
    { date: '2025-05-29', attendance: 237 },
    { date: '2025-05-30', attendance: 263 },
    { date: '2025-05-31', attendance: 209 },
    { date: '2025-06-01', attendance: 251 },
    { date: '2025-06-02', attendance: 290 },
    { date: '2025-06-03', attendance: 248 },
    { date: '2025-06-04', attendance: 238 },
    { date: '2025-06-05', attendance: 269 },
    { date: '2025-06-06', attendance: 293 },
    { date: '2025-06-07', attendance: 227 },
    { date: '2025-06-08', attendance: 232 },
    { date: '2025-06-09', attendance: 266 },
    { date: '2025-06-10', attendance: 249 },
    { date: '2025-06-11', attendance: 228 },
    { date: '2025-06-12', attendance: 246 },
    { date: '2025-06-13', attendance: 237 },
    { date: '2025-06-14', attendance: 238 },
    { date: '2025-06-15', attendance: 226 },
    { date: '2025-06-16', attendance: 272 },
    { date: '2025-06-17', attendance: 264 },
    { date: '2025-06-18', attendance: 265 },
    { date: '2025-06-19', attendance: 260 },
    { date: '2025-06-20', attendance: 243 },
    { date: '2025-06-21', attendance: 249 },
    { date: '2025-06-22', attendance: 234 },
    { date: '2025-06-23', attendance: 274 },
    { date: '2025-06-24', attendance: 286 },
    { date: '2025-06-25', attendance: 263 },
    { date: '2025-06-26', attendance: 254 },
    { date: '2025-06-27', attendance: 253 },
    { date: '2025-06-28', attendance: 218 },
    { date: '2025-06-29', attendance: 235 },
    { date: '2025-06-30', attendance: 271 },
    { date: '2025-07-01', attendance: 219 },
    { date: '2025-07-02', attendance: 266 },
    { date: '2025-07-03', attendance: 255 },
    { date: '2025-07-04', attendance: 265 },
    { date: '2025-07-05', attendance: 242 },
    { date: '2025-07-06', attendance: 246 },
    { date: '2025-07-07', attendance: 307 },
    { date: '2025-07-08', attendance: 255 },
    { date: '2025-07-09', attendance: 253 },
    { date: '2025-07-10', attendance: 235 },
    { date: '2025-07-11', attendance: 243 },
    { date: '2025-07-12', attendance: 229 },
    { date: '2025-07-13', attendance: 265 },
    { date: '2025-07-14', attendance: 289 },
    { date: '2025-07-15', attendance: 277 },
    { date: '2025-07-16', attendance: 271 },
    { date: '2025-07-17', attendance: 271 },
    { date: '2025-07-18', attendance: 252 },
    { date: '2025-07-19', attendance: 218 },
    { date: '2025-07-20', attendance: 151 },
    { date: '2025-07-21', attendance: 300 },
    { date: '2025-07-22', attendance: 256 },
    { date: '2025-07-23', attendance: 239 },
    { date: '2025-07-24', attendance: 269 },
    { date: '2025-07-25', attendance: 238 },
    { date: '2025-07-26', attendance: 253 },
    { date: '2025-07-27', attendance: 248 },
    { date: '2025-07-28', attendance: 275 },
    { date: '2025-07-29', attendance: 244 },
    { date: '2025-07-30', attendance: 263 },
    { date: '2025-07-31', attendance: 275 },
    { date: '2025-08-01', attendance: 277 },
    { date: '2025-08-02', attendance: 180 },
    { date: '2025-08-03', attendance: 233 },
    { date: '2025-08-04', attendance: 256 },
    { date: '2025-08-05', attendance: 226 },
    { date: '2025-08-06', attendance: 274 },
    { date: '2025-08-07', attendance: 231 },
    { date: '2025-08-08', attendance: 282 },
    { date: '2025-08-09', attendance: 231 },
    { date: '2025-08-10', attendance: 234 },
    { date: '2025-08-11', attendance: 276 },
    { date: '2025-08-12', attendance: 245 },
    { date: '2025-08-13', attendance: 266 },
    { date: '2025-08-14', attendance: 228 },
    { date: '2025-08-15', attendance: 255 },
    { date: '2025-08-16', attendance: 239 },
    { date: '2025-08-17', attendance: 233 },
    { date: '2025-08-18', attendance: 264 },
    { date: '2025-08-19', attendance: 251 },
    { date: '2025-08-20', attendance: 264 },
    { date: '2025-08-21', attendance: 282 },
    { date: '2025-08-22', attendance: 271 },
    { date: '2025-08-23', attendance: 216 },
    { date: '2025-08-24', attendance: 250 },
    { date: '2025-08-25', attendance: 281 },
    { date: '2025-08-26', attendance: 294 },
    { date: '2025-08-27', attendance: 273 },
    { date: '2025-08-28', attendance: 265 },
    { date: '2025-08-29', attendance: 279 },
    { date: '2025-08-30', attendance: 238 },
    { date: '2025-08-31', attendance: 284 },
    { date: '2025-09-01', attendance: 279 },
    { date: '2025-09-02', attendance: 260 },
    { date: '2025-09-03', attendance: 261 },
    { date: '2025-09-04', attendance: 277 },
    { date: '2025-09-05', attendance: 266 },
    { date: '2025-09-06', attendance: 231 },
    { date: '2025-09-07', attendance: 245 },
    { date: '2025-09-08', attendance: 241 },
    { date: '2025-09-09', attendance: 265 },
    { date: '2025-09-10', attendance: 268 },
    { date: '2025-09-11', attendance: 286 },
    { date: '2025-09-12', attendance: 282 },
    { date: '2025-09-13', attendance: 238 },
    { date: '2025-09-14', attendance: 229 },
    { date: '2025-09-15', attendance: 259 },
    { date: '2025-09-16', attendance: 313 },
    { date: '2025-09-17', attendance: 251 },
    { date: '2025-09-18', attendance: 282 },
    { date: '2025-09-19', attendance: 272 },
    { date: '2025-09-20', attendance: 265 },
    { date: '2025-09-21', attendance: 237 },
    { date: '2025-09-22', attendance: 280 },
    { date: '2025-09-23', attendance: 196 },
    { date: '2025-09-24', attendance: 148 },
    { date: '2025-09-25', attendance: 312 },
    { date: '2025-09-26', attendance: 260 },
    { date: '2025-09-27', attendance: 251 },
    { date: '2025-09-28', attendance: 278 },
    { date: '2025-09-29', attendance: 321 },
    { date: '2025-09-30', attendance: 269 },
    { date: '2025-10-01', attendance: 225 },
    { date: '2025-10-02', attendance: 289 },
    { date: '2025-10-03', attendance: 260 },
    { date: '2025-10-04', attendance: 250 },
    { date: '2025-10-05', attendance: 255 },
    { date: '2025-10-06', attendance: 250 },
    { date: '2025-10-07', attendance: 261 },
    { date: '2025-10-08', attendance: 303 },
    { date: '2025-10-09', attendance: 278 },
    { date: '2025-10-10', attendance: 303 },
    { date: '2025-10-11', attendance: 244 },
    { date: '2025-10-12', attendance: 259 },
    { date: '2025-10-13', attendance: 317 },
    { date: '2025-10-14', attendance: 253 },
    { date: '2025-10-15', attendance: 296 },
    { date: '2025-10-16', attendance: 277 },
    { date: '2025-10-17', attendance: 305 },
    { date: '2025-10-18', attendance: 251 },
    { date: '2025-10-19', attendance: 269 },
    { date: '2025-10-20', attendance: 309 },
    { date: '2025-10-21', attendance: 246 },
    { date: '2025-10-22', attendance: 269 },
    { date: '2025-10-23', attendance: 259 },
    { date: '2025-10-24', attendance: 253 },
    { date: '2025-10-25', attendance: 218 },
    { date: '2025-10-26', attendance: 252 },
    { date: '2025-10-27', attendance: 279 },
    { date: '2025-10-28', attendance: 263 },
    { date: '2025-10-29', attendance: 256 },
    { date: '2025-10-30', attendance: 282 },
    { date: '2025-10-31', attendance: 271 },
    { date: '2025-11-01', attendance: 228 },
    { date: '2025-11-02', attendance: 236 },
    { date: '2025-11-03', attendance: 274 },
    { date: '2025-11-04', attendance: 265 },
    { date: '2025-11-05', attendance: 266 },
    { date: '2025-11-06', attendance: 246 },
    { date: '2025-11-07', attendance: 249 },
    { date: '2025-11-08', attendance: 269 },
    { date: '2025-11-09', attendance: 242 },
    { date: '2025-11-10', attendance: 265 },
    { date: '2025-11-11', attendance: 247 },
    { date: '2025-11-12', attendance: 258 },
    { date: '2025-11-13', attendance: 236 },
    { date: '2025-11-14', attendance: 259 },
    { date: '2025-11-15', attendance: 243 },
    { date: '2025-11-16', attendance: 224 },
    { date: '2025-11-17', attendance: 291 },
    { date: '2025-11-18', attendance: 234 },
    { date: '2025-11-19', attendance: 240 },
    { date: '2025-11-20', attendance: 212 },
    { date: '2025-11-21', attendance: 251 },
    { date: '2025-11-22', attendance: 228 },
    { date: '2025-11-23', attendance: 221 },
    { date: '2025-11-24', attendance: 275 },
    { date: '2025-11-25', attendance: 278 },
    { date: '2025-11-26', attendance: 234 },
    { date: '2025-11-27', attendance: 215 },
    { date: '2025-11-28', attendance: 234 },
    { date: '2025-11-29', attendance: 218 },
    { date: '2025-11-30', attendance: 252 },
    { date: '2025-12-01', attendance: 276 },
    { date: '2025-12-02', attendance: 285 },
    { date: '2025-12-03', attendance: 269 },
];

// ============================================
// 預測類
// ============================================
class NDHAttendancePredictor {
    constructor() {
        this.data = HISTORICAL_DATA;
        this.globalMean = 0;
        this.stdDev = 0;
        this.dowFactors = {};
        this.monthFactors = {};
        this.fluSeasonFactor = 1.004;
        
        this._calculateFactors();
    }
    
    _calculateFactors() {
        // 計算全局平均
        const attendances = this.data.map(d => d.attendance);
        this.globalMean = attendances.reduce((a, b) => a + b, 0) / attendances.length;
        
        // 計算標準差
        const squaredDiffs = attendances.map(a => Math.pow(a - this.globalMean, 2));
        this.stdDev = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / attendances.length);
        
        // 計算星期因子
        const dowData = {};
        this.data.forEach(d => {
            const date = new Date(d.date);
            const dow = date.getDay(); // 0=Sunday
            if (!dowData[dow]) dowData[dow] = [];
            dowData[dow].push(d.attendance);
        });
        
        for (let dow = 0; dow < 7; dow++) {
            if (dowData[dow]) {
                const mean = dowData[dow].reduce((a, b) => a + b, 0) / dowData[dow].length;
                this.dowFactors[dow] = mean / this.globalMean;
            } else {
                this.dowFactors[dow] = 1.0;
            }
        }
        
        // 計算月份因子
        const monthData = {};
        this.data.forEach(d => {
            const date = new Date(d.date);
            const month = date.getMonth() + 1;
            if (!monthData[month]) monthData[month] = [];
            monthData[month].push(d.attendance);
        });
        
        for (let month = 1; month <= 12; month++) {
            if (monthData[month]) {
                const mean = monthData[month].reduce((a, b) => a + b, 0) / monthData[month].length;
                this.monthFactors[month] = mean / this.globalMean;
            } else {
                this.monthFactors[month] = 1.0;
            }
        }
    }
    
    predict(dateStr, weatherData = null, aiFactor = null) {
        const date = new Date(dateStr);
        const dow = date.getDay();
        const month = date.getMonth() + 1;
        const isWeekend = dow === 0 || dow === 6;
        const isFluSeason = [1, 2, 3, 7, 8].includes(month);
        
        // 檢查假期
        const holidayInfo = HK_PUBLIC_HOLIDAYS[dateStr];
        const isHoliday = !!holidayInfo;
        
        // 基準值 (月份效應)
        let baseline = this.globalMean * (this.monthFactors[month] || 1.0);
        
        // 星期效應
        let value = baseline * (this.dowFactors[dow] || 1.0);
        
        // 假期效應
        if (isHoliday) {
            value *= holidayInfo.factor;
        }
        
        // 流感季節效應
        if (isFluSeason) {
            value *= this.fluSeasonFactor;
        }
        
        // 天氣效應
        let weatherFactor = 1.0;
        let weatherImpacts = [];
        if (weatherData) {
            const weatherImpact = calculateWeatherImpact(weatherData);
            weatherFactor = weatherImpact.factor;
            weatherImpacts = weatherImpact.impacts;
        }
        value *= weatherFactor;
        
        // AI 分析因素效應
        let aiFactorValue = 1.0;
        let aiFactorDesc = null;
        if (aiFactor) {
            aiFactorValue = aiFactor.impactFactor || 1.0;
            aiFactorDesc = aiFactor.description || null;
            value *= aiFactorValue;
        } else if (aiFactors[dateStr]) {
            // 使用全局 AI 因素緩存
            aiFactorValue = aiFactors[dateStr].impactFactor || 1.0;
            aiFactorDesc = aiFactors[dateStr].description || null;
            value *= aiFactorValue;
        }
        
        // 信賴區間
        const ci80 = {
            lower: Math.max(0, Math.round(value - 1.28 * this.stdDev)),
            upper: Math.round(value + 1.28 * this.stdDev)
        };
        
        const ci95 = {
            lower: Math.max(0, Math.round(value - 1.96 * this.stdDev)),
            upper: Math.round(value + 1.96 * this.stdDev)
        };
        
        const dayNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        
        return {
            date: dateStr,
            dayName: dayNames[dow],
            predicted: Math.round(value),
            baseline: Math.round(baseline),
            globalMean: Math.round(this.globalMean),
            monthFactor: this.monthFactors[month] || 1.0,
            dowFactor: this.dowFactors[dow] || 1.0,
            weatherFactor: weatherFactor,
            weatherImpacts: weatherImpacts,
            aiFactor: aiFactorValue,
            aiFactorDesc: aiFactorDesc,
            isWeekend,
            isHoliday,
            holidayName: isHoliday ? holidayInfo.name : null,
            holidayFactor: isHoliday ? holidayInfo.factor : 1.0,
            isFluSeason,
            ci80,
            ci95
        };
    }
    
    predictRange(startDate, days, weatherForecast = null, aiFactorsMap = null) {
        const predictions = [];
        const start = new Date(startDate);
        
        for (let i = 0; i < days; i++) {
            const date = new Date(start);
            date.setDate(start.getDate() + i);
            // 驗證日期是否有效
            if (isNaN(date.getTime())) {
                console.error(`❌ 無效日期: ${startDate} + ${i} 天`);
                continue;
            }
            
            // 安全地生成日期字符串
            let dateStr;
            try {
                dateStr = date.toISOString().split('T')[0];
            } catch (error) {
                console.error(`❌ 日期轉換失敗: ${startDate} + ${i} 天`, error);
                // 使用備用方法生成日期字符串
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                dateStr = `${year}-${month}-${day}`;
            }
            
            // 獲取該日期的天氣數據
            let dayWeather = null;
            if (weatherForecast && Array.isArray(weatherForecast)) {
                dayWeather = weatherForecast.find(w => {
                    try {
                        const dateValue = w.forecastDate || w.date;
                        if (!dateValue) return false;
                        
                        // 如果已經是字符串格式 YYYY-MM-DD，直接比較
                        if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateValue)) {
                            return dateValue.split('T')[0] === dateStr;
                        }
                        
                        const wDate = new Date(dateValue);
                        // 檢查日期是否有效
                        if (isNaN(wDate.getTime())) return false;
                        
                        // 安全地調用 toISOString
                        try {
                            const wDateStr = wDate.toISOString().split('T')[0];
                            return wDateStr === dateStr;
                        } catch (isoError) {
                            console.warn('⚠️ 日期轉換失敗:', dateValue, isoError);
                            return false;
                        }
                    } catch (error) {
                        console.warn('⚠️ 天氣預報日期解析失敗:', w, error);
                        return false;
                    }
                });
            }
            
            // 獲取該日期的 AI 因素
            let dayAIFactor = null;
            if (aiFactorsMap && aiFactorsMap[dateStr]) {
                dayAIFactor = aiFactorsMap[dateStr];
            }
            
            predictions.push(this.predict(dateStr, dayWeather, dayAIFactor));
        }
        
        return predictions;
    }
    
    getStatistics() {
        const attendances = this.data.map(d => d.attendance);
        const maxIdx = attendances.indexOf(Math.max(...attendances));
        const minIdx = attendances.indexOf(Math.min(...attendances));
        
        return {
            totalDays: this.data.length,
            totalAttendance: attendances.reduce((a, b) => a + b, 0),
            globalMean: this.globalMean,
            stdDev: this.stdDev,
            max: { value: attendances[maxIdx], date: this.data[maxIdx].date },
            min: { value: attendances[minIdx], date: this.data[minIdx].date }
        };
    }
    
    getDOWMeans() {
        const dowData = {};
        this.data.forEach(d => {
            const date = new Date(d.date);
            const dow = date.getDay();
            if (!dowData[dow]) dowData[dow] = [];
            dowData[dow].push(d.attendance);
        });
        
        const result = [];
        for (let dow = 0; dow < 7; dow++) {
            if (dowData[dow]) {
                result.push(dowData[dow].reduce((a, b) => a + b, 0) / dowData[dow].length);
            } else {
                result.push(0);
            }
        }
        return result;
    }
    
    getMonthMeans() {
        const monthData = {};
        this.data.forEach(d => {
            const date = new Date(d.date);
            const month = date.getMonth() + 1;
            if (!monthData[month]) monthData[month] = [];
            monthData[month].push(d.attendance);
        });
        
        const result = [];
        for (let month = 1; month <= 12; month++) {
            if (monthData[month]) {
                result.push(monthData[month].reduce((a, b) => a + b, 0) / monthData[month].length);
            } else {
                result.push(0);
            }
        }
        return result;
    }
}

// ============================================
// 圖表渲染 - Professional World-Class Design
// ============================================
let forecastChart, dowChart, monthChart, historyChart, comparisonChart;
let currentHistoryRange = '1月'; // 當前選擇的歷史趨勢時間範圍
let historyPageOffset = 0; // 分頁偏移量（0 = 當前時間範圍，1 = 上一頁，-1 = 下一頁）

// Chart.js 全域設定 - 專業風格
Chart.defaults.font.family = "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif";
Chart.defaults.font.weight = 500;
Chart.defaults.color = '#64748b';

// 專業配色方案
const chartColors = {
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

// 獲取響應式 layout padding（根據屏幕寬度）
function getResponsivePadding() {
    const width = window.innerWidth;
    if (width <= 380) {
        return { top: 8, bottom: 8, left: 0, right: 0 };
    } else if (width <= 600) {
        return { top: 8, bottom: 8, left: 2, right: 2 };
    } else if (width <= 900) {
        return { top: 10, bottom: 10, left: 5, right: 5 };
    } else {
        return { top: 10, bottom: 10, left: 5, right: 15 };
    }
}

// 獲取響應式 maxTicksLimit（根據屏幕寬度）
function getResponsiveMaxTicksLimit() {
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

// 專業圖表選項 - 手機友好
const professionalOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
        intersect: false,
        mode: 'index'
    },
    layout: {
        padding: getResponsivePadding(),
        autoPadding: false
    },
    plugins: {
        legend: {
            display: true,
            position: 'top',
            align: 'center',
            labels: {
                usePointStyle: true,
                pointStyle: 'circle',
                padding: 15,
                color: chartColors.text,
                font: { size: 11, weight: 600 },
                boxWidth: 8,
                boxHeight: 8
            }
        },
        tooltip: {
            backgroundColor: '#1e293b',
            titleColor: '#fff',
            bodyColor: 'rgba(255,255,255,0.85)',
            borderColor: 'transparent',
            borderWidth: 0,
            cornerRadius: 10,
            padding: 12,
            boxPadding: 4,
            usePointStyle: true,
            titleFont: { size: 13, weight: 700 },
            bodyFont: { size: 12, weight: 500 },
            displayColors: true
        }
    },
    scales: {
        x: {
            ticks: { 
                color: chartColors.text,
                font: { size: 11, weight: 600 },
                padding: 8,
                maxRotation: 0,
                autoSkip: true,
                autoSkipPadding: 10
            },
            grid: { 
                display: false
            },
            border: {
                display: false
            }
        },
        y: {
            ticks: { 
                color: chartColors.textSecondary,
                font: { size: 11, weight: 500 },
                padding: 10,
                callback: function(value) {
                    return value;
                }
            },
            grid: { 
                color: 'rgba(0, 0, 0, 0.04)',
                drawBorder: false,
                lineWidth: 1
            },
            border: {
                display: false
            }
        }
    }
};

// 更新載入進度
function updateLoadingProgress(chartId, percent) {
    const loadingEl = document.getElementById(`${chartId}-chart-loading`);
    const percentEl = document.getElementById(`${chartId}-loading-percent`);
    const progressFill = document.getElementById(`${chartId}-progress-fill`);
    
    if (percentEl) {
        percentEl.textContent = `${Math.round(percent)}%`;
    }
    if (progressFill) {
        progressFill.style.width = `${percent}%`;
    }
}

// 完成圖表載入
function completeChartLoading(chartId) {
    const loadingEl = document.getElementById(`${chartId}-chart-loading`);
    const canvasEl = document.getElementById(`${chartId}-chart`);
    
    if (loadingEl) {
        loadingEl.style.display = 'none';
    }
    if (canvasEl) {
        canvasEl.style.display = 'block';
    }
}

// 設置歷史趨勢時間範圍選擇按鈕
function setupHistoryTimeRangeButtons() {
    const timeRangeContainer = document.getElementById('history-time-range');
    if (!timeRangeContainer) return;
    
    const buttons = timeRangeContainer.querySelectorAll('.time-range-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', async () => {
            // 移除所有active類
            buttons.forEach(b => b.classList.remove('active'));
            // 添加active類到當前按鈕
            btn.classList.add('active');
            
            // 獲取選擇的範圍
            const range = btn.getAttribute('data-range');
            currentHistoryRange = range;
            historyPageOffset = 0; // 重置分頁偏移量
            
            // 重新載入歷史趨勢圖
            console.log(`🔄 切換歷史趨勢範圍: ${range}, 重置分頁偏移量為 0`);
            await initHistoryChart(range, 0);
        });
    });
}

async function initCharts(predictor) {
    // 獲取今天日期 (香港時間 HKT UTC+8)
    const hk = getHKTime();
    const today = hk.dateStr;
    
    // 更新總體進度
    let totalProgress = 0;
    const totalCharts = 4;
    
    // 未來30天預測（包含天氣和 AI 因素）
    updateLoadingProgress('forecast', 10);
    const predictions = predictor.predictRange(today, 30, weatherForecastData, aiFactors);
    updateLoadingProgress('forecast', 30);
    
    // 1. 預測趨勢圖 - 專業線圖
    try {
        const forecastCanvas = document.getElementById('forecast-chart');
        if (!forecastCanvas) {
            console.error('❌ 找不到 forecast-chart canvas');
            updateLoadingProgress('forecast', 0);
            return;
        }
        const forecastCtx = forecastCanvas.getContext('2d');
        updateLoadingProgress('forecast', 50);
    
        // 創建漸變填充
        const forecastGradient = forecastCtx.createLinearGradient(0, 0, 0, 280);
        forecastGradient.addColorStop(0, 'rgba(5, 150, 105, 0.15)');
        forecastGradient.addColorStop(1, 'rgba(5, 150, 105, 0)');
        updateLoadingProgress('forecast', 70);
    
        forecastChart = new Chart(forecastCtx, {
        type: 'line',
        data: {
            labels: predictions.map(p => {
                return formatDateDDMM(p.date);
            }),
            datasets: [
                {
                    label: '預測值',
                    data: predictions.map(p => p.predicted),
                    borderColor: '#059669',
                    backgroundColor: forecastGradient,
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 5,
                    pointHoverRadius: 8,
                    pointBackgroundColor: predictions.map(p => 
                        p.isHoliday ? '#ef4444' : p.isWeekend ? '#64748b' : '#059669'
                    ),
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2
                },
                {
                    label: '95% CI',
                    data: predictions.map(p => p.ci95.upper),
                    borderColor: 'rgba(5, 150, 105, 0.2)',
                    borderWidth: 1.5,
                    borderDash: [4, 4],
                    fill: false,
                    pointRadius: 0,
                    tension: 0.35
                },
                {
                    label: '',
                    data: predictions.map(p => p.ci95.lower),
                    borderColor: 'rgba(5, 150, 105, 0.2)',
                    borderWidth: 1.5,
                    borderDash: [4, 4],
                    fill: '-1',
                    backgroundColor: 'rgba(5, 150, 105, 0.05)',
                    pointRadius: 0,
                    tension: 0.35
                },
                {
                    label: '平均線',
                    data: predictions.map(() => predictor.globalMean),
                    borderColor: '#ef4444',
                    borderWidth: 2,
                    borderDash: [8, 4],
                    fill: false,
                    pointRadius: 0
                }
            ]
        },
        options: {
            ...professionalOptions,
            plugins: {
                ...professionalOptions.plugins,
                legend: {
                    ...professionalOptions.plugins.legend,
                    labels: {
                        ...professionalOptions.plugins.legend.labels,
                        filter: function(item) {
                            return item.text !== '';
                        }
                    }
                },
                tooltip: {
                    ...professionalOptions.plugins.tooltip,
                    callbacks: {
                        title: function(items) {
                            const p = predictions[items[0].dataIndex];
                            return formatDateDDMM(p.date, true); // 工具提示顯示完整日期
                        },
                        label: function(item) {
                            if (item.datasetIndex === 0) {
                                return `預測: ${item.raw} 人`;
                            }
                            return null;
                        },
                        afterLabel: function(context) {
                            if (context.datasetIndex !== 0) return '';
                            const p = predictions[context.dataIndex];
                            let info = [];
                            if (p.isHoliday) info.push(`🎌 ${p.holidayName}`);
                            if (p.isWeekend) info.push('📅 週末');
                            if (p.isFluSeason) info.push('🤧 流感季節');
                            return info.length ? info.join(' · ') : '';
                        }
                    }
                }
            },
            scales: {
                x: {
                    ...professionalOptions.scales.x,
                    ticks: {
                        ...professionalOptions.scales.x.ticks,
                        maxTicksLimit: getResponsiveMaxTicksLimit()
                    }
                },
                y: {
                    ...professionalOptions.scales.y,
                    min: Math.floor(Math.min(...predictions.map(p => p.ci95.lower)) - 20),
                    max: Math.ceil(Math.max(...predictions.map(p => p.ci95.upper)) + 20),
                    ticks: {
                        ...professionalOptions.scales.y.ticks,
                        stepSize: 20
                    }
                }
            }
        }
    });
    
    updateLoadingProgress('forecast', 90);
    updateLoadingProgress('forecast', 100);
    completeChartLoading('forecast');
    totalProgress += 25;
    console.log('✅ 預測趨勢圖已載入');
    } catch (error) {
        console.error('❌ 預測趨勢圖載入失敗:', error);
        updateLoadingProgress('forecast', 0);
    }
    
    // 2. 星期效應圖 - 專業條形圖
    try {
        updateLoadingProgress('dow', 10);
        const dowMeans = predictor.getDOWMeans();
        updateLoadingProgress('dow', 30);
        const reorderedDOW = [dowMeans[1], dowMeans[2], dowMeans[3], dowMeans[4], dowMeans[5], dowMeans[6], dowMeans[0]];
        const avgDOW = reorderedDOW.reduce((a, b) => a + b, 0) / reorderedDOW.length;
        
        const dowCanvas = document.getElementById('dow-chart');
        if (!dowCanvas) {
            console.error('❌ 找不到 dow-chart canvas');
            updateLoadingProgress('dow', 0);
            return;
        }
        const dowCtx = dowCanvas.getContext('2d');
        updateLoadingProgress('dow', 50);
        
        // 創建漸變
        const dowGradients = reorderedDOW.map((val, i) => {
            const gradient = dowCtx.createLinearGradient(0, 0, 0, 250);
            if (i === 0) {
                gradient.addColorStop(0, '#ef4444');
                gradient.addColorStop(1, '#fca5a5');
            } else if (i >= 5) {
                gradient.addColorStop(0, '#64748b');
                gradient.addColorStop(1, '#94a3b8');
            } else {
                gradient.addColorStop(0, '#4f46e5');
                gradient.addColorStop(1, '#818cf8');
            }
            return gradient;
        });
        updateLoadingProgress('dow', 70);
        
        dowChart = new Chart(dowCtx, {
        type: 'bar',
        data: {
            labels: ['一', '二', '三', '四', '五', '六', '日'],
            datasets: [{
                label: '平均人數',
                data: reorderedDOW,
                backgroundColor: dowGradients,
                borderRadius: 10,
                borderSkipped: false,
                barPercentage: 0.7,
                categoryPercentage: 0.8
            }]
        },
        options: {
            ...professionalOptions,
            plugins: {
                ...professionalOptions.plugins,
                legend: { display: false },
                tooltip: {
                    ...professionalOptions.plugins.tooltip,
                    callbacks: {
                        title: function(items) {
                            const days = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
                            return days[items[0].dataIndex];
                        },
                        label: function(item) {
                            return `平均: ${Math.round(item.raw)} 人`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    ...professionalOptions.scales.x,
                    ticks: {
                        ...professionalOptions.scales.x.ticks,
                        font: { 
                            size: window.innerWidth <= 600 ? 10 : 13, 
                            weight: 700 
                        }
                    }
                },
                y: {
                    ...professionalOptions.scales.y,
                    beginAtZero: false,
                    min: Math.floor(Math.min(...reorderedDOW) - 15),
                    max: Math.ceil(Math.max(...reorderedDOW) + 10),
                    ticks: {
                        ...professionalOptions.scales.y.ticks,
                        stepSize: 15
                    }
                }
            }
        }
    });
    
        updateLoadingProgress('dow', 90);
        updateLoadingProgress('dow', 100);
        completeChartLoading('dow');
        totalProgress += 25;
        console.log('✅ 星期效應圖已載入');
    } catch (error) {
        console.error('❌ 星期效應圖載入失敗:', error);
        updateLoadingProgress('dow', 0);
    }
    
    // 3. 月份分佈圖 - 專業條形圖
    try {
        updateLoadingProgress('month', 10);
        const monthMeans = predictor.getMonthMeans();
        updateLoadingProgress('month', 30);
        
        const monthCanvas = document.getElementById('month-chart');
        if (!monthCanvas) {
            console.error('❌ 找不到 month-chart canvas');
            updateLoadingProgress('month', 0);
            return;
        }
        const monthCtx = monthCanvas.getContext('2d');
        updateLoadingProgress('month', 50);
    
        // 月份漸變
        const monthGradients = monthMeans.map((_, i) => {
            const gradient = monthCtx.createLinearGradient(0, 0, 0, 250);
            if ([0, 1, 2, 6, 7, 9].includes(i)) {
                gradient.addColorStop(0, '#ef4444');
                gradient.addColorStop(1, '#fca5a5');
            } else {
                gradient.addColorStop(0, '#4f46e5');
                gradient.addColorStop(1, '#818cf8');
            }
            return gradient;
        });
        updateLoadingProgress('month', 70);
        
        monthChart = new Chart(monthCtx, {
        type: 'bar',
        data: {
            labels: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
            datasets: [{
                label: '平均人數',
                data: monthMeans,
                backgroundColor: monthGradients,
                borderRadius: 8,
                borderSkipped: false,
                barPercentage: 0.75,
                categoryPercentage: 0.85
            }]
        },
        options: {
            ...professionalOptions,
            plugins: {
                ...professionalOptions.plugins,
                legend: { display: false },
                tooltip: {
                    ...professionalOptions.plugins.tooltip,
                    callbacks: {
                        title: function(items) {
                            return `${items[0].dataIndex + 1}月`;
                        },
                        label: function(item) {
                            const isFlu = [0, 1, 2, 6, 7, 9].includes(item.dataIndex);
                            return [
                                `平均: ${Math.round(item.raw)} 人`,
                                isFlu ? '🤧 流感高峰期' : ''
                            ].filter(Boolean);
                        }
                    }
                }
            },
            scales: {
                x: {
                    ...professionalOptions.scales.x,
                    ticks: {
                        ...professionalOptions.scales.x.ticks,
                        font: { size: 11, weight: 600 }
                    }
                },
                y: {
                    ...professionalOptions.scales.y,
                    beginAtZero: false,
                    min: Math.floor(Math.min(...monthMeans.filter(v => v > 0)) - 10),
                    max: Math.ceil(Math.max(...monthMeans) + 10),
                    ticks: {
                        ...professionalOptions.scales.y.ticks,
                        stepSize: 10
                    }
                }
            }
        }
    });
    
        updateLoadingProgress('month', 90);
        updateLoadingProgress('month', 100);
        completeChartLoading('month');
        totalProgress += 25;
        console.log('✅ 月份分佈圖已載入');
    } catch (error) {
        console.error('❌ 月份分佈圖載入失敗:', error);
        updateLoadingProgress('month', 0);
    }
    
    // 4. 歷史趨勢圖 - 從數據庫獲取數據
    await initHistoryChart();
    
    // 5. 實際vs預測對比圖
    await initComparisonChart();
    
    // 6. 詳細比較表格
    await initComparisonTable();
    
    // 強制所有圖表重新計算尺寸以確保響應式
    setTimeout(() => {
        forceChartsResize();
    }, 100);
    
    console.log('✅ 所有圖表載入完成');
}

// 強制所有圖表重新計算尺寸
function forceChartsResize() {
    const charts = [forecastChart, dowChart, monthChart, historyChart, comparisonChart];
    charts.forEach(chart => {
        if (chart) {
            // 更新響應式設置
            chart.options.layout.padding = getResponsivePadding();
            if (chart.options.scales && chart.options.scales.x && chart.options.scales.x.ticks) {
                chart.options.scales.x.ticks.maxTicksLimit = getResponsiveMaxTicksLimit();
                chart.options.scales.x.ticks.font.size = window.innerWidth <= 600 ? 9 : 11;
                chart.options.scales.x.ticks.padding = window.innerWidth <= 600 ? 4 : 8;
            }
            // 強制重新計算尺寸
            chart.resize();
            chart.update('none');
        }
    });
}

// 初始化歷史趨勢圖
async function initHistoryChart(range = currentHistoryRange, pageOffset = 0) {
    try {
        updateLoadingProgress('history', 10);
        const historyCanvas = document.getElementById('history-chart');
        if (!historyCanvas) {
            console.error('❌ 找不到 history-chart canvas');
            updateLoadingProgress('history', 0);
            return;
        }
        
        updateLoadingProgress('history', 20);
        // 從數據庫獲取數據（根據時間範圍和分頁偏移量）
        const { startDate, endDate } = getDateRangeWithOffset(range, pageOffset);
        console.log(`📅 查詢歷史數據：範圍=${range}, pageOffset=${pageOffset}, ${startDate} 至 ${endDate}`);
        
        // 如果日期範圍為 null（表示過早，超出數據庫範圍），顯示提示並禁用導航
        if (!startDate || !endDate) {
            console.warn(`⚠️ 日期範圍無效或過早 (範圍=${range}, pageOffset=${pageOffset})`);
            
            // 銷毀現有圖表（如果存在）
            if (historyChart) {
                historyChart.destroy();
                historyChart = null;
            }
            
            // 顯示友好的提示消息，而不是完全隱藏區塊
            const historyContainer = document.getElementById('history-chart-container');
            const historyCard = historyContainer?.closest('.chart-card');
            if (historyCard) {
                historyCard.style.display = '';
                if (historyContainer) {
                    historyContainer.innerHTML = `
                        <div style="padding: 40px; text-align: center; color: #666;">
                            <p style="font-size: 16px; margin-bottom: 10px;">📅 已到達數據庫的最早日期</p>
                            <p style="font-size: 14px;">無法顯示更早的歷史數據</p>
                        </div>
                    `;
                }
            }
            
            // 更新日期範圍顯示
            updateHistoryDateRange(null, null, range);
            
            // 更新按鈕狀態，禁用"上一頁"按鈕
            updateHistoryNavigationButtons(range, pageOffset, []);
            updateLoadingProgress('history', 0);
            return;
        }
        
        let historicalData = await fetchHistoricalData(startDate, endDate);
        
        // 確保數據被正確過濾到請求的範圍內（防止數據庫返回超出範圍的數據）
        if (startDate && endDate && historicalData.length > 0) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            const originalCount = historicalData.length;
            historicalData = historicalData.filter(d => {
                const date = new Date(d.date);
                return date >= start && date <= end;
            });
            if (originalCount !== historicalData.length) {
                console.log(`📊 數據過濾：從 ${originalCount} 個數據點過濾到 ${historicalData.length} 個（範圍：${startDate} 至 ${endDate}）`);
            }
        }
        
        if (historicalData.length === 0) {
            console.warn(`⚠️ 沒有歷史數據 (範圍=${range}, pageOffset=${pageOffset}, ${startDate} 至 ${endDate})`);
            
            // 銷毀現有圖表（如果存在）
            if (historyChart) {
                historyChart.destroy();
                historyChart = null;
            }
            
            // 顯示友好的提示消息，而不是完全隱藏區塊
            const historyContainer = document.getElementById('history-chart-container');
            const historyCard = historyContainer?.closest('.chart-card');
            if (historyCard) {
                historyCard.style.display = '';
                if (historyContainer) {
                    historyContainer.innerHTML = `
                        <div style="padding: 40px; text-align: center; color: #666;">
                            <p style="font-size: 16px; margin-bottom: 10px;">📊 此時間範圍內沒有數據</p>
                            <p style="font-size: 14px;">日期範圍：${startDate} 至 ${endDate}</p>
                        </div>
                    `;
                }
            }
            
            // 更新日期範圍顯示
            updateHistoryDateRange(startDate, endDate, range);
            
            // 更新按鈕狀態，禁用"上一頁"按鈕
            updateHistoryNavigationButtons(range, pageOffset, []);
            updateLoadingProgress('history', 0);
            return;
        }
        
        // 對於所有時間範圍，使用一致的數據處理邏輯，確保數據連續性和一致性
        const originalLength = historicalData.length;
        
        if (range === '5年' || range === '10年' || range === '全部') {
            // 長時間範圍：使用按月聚合，確保所有月份都有數據點
            historicalData = aggregateDataByMonth(historicalData);
            console.log(`📊 數據聚合：從 ${originalLength} 個數據點聚合到 ${historicalData.length} 個（按月平均）`);
        } else {
            // 對於其他時間範圍，使用智能均勻採樣，確保數據點在時間軸上均勻分佈
            // 這樣可以確保數據之間的一致性，不會突然缺失某些日期
            const maxTicks = getMaxTicksForRange(range, originalLength);
            
            // 根據時間範圍決定是否需要採樣
            let needsSampling = false;
            let targetPoints = originalLength;
            
            switch (range) {
                case '1D':
                case '1週':
                    // 短時間範圍：如果數據點超過50個，進行採樣
                    targetPoints = Math.min(50, originalLength);
                    needsSampling = originalLength > 50;
                    break;
                case '1月':
                    // 1月：如果數據點超過60個，進行採樣
                    targetPoints = Math.min(60, originalLength);
                    needsSampling = originalLength > 60;
                    break;
                case '3月':
                case '6月':
                    // 3-6月：如果數據點超過100個，進行採樣
                    targetPoints = Math.min(100, originalLength);
                    needsSampling = originalLength > 100;
                    break;
                case '1年':
                case '2年':
                    // 1-2年：如果數據點超過200個，進行採樣
                    targetPoints = Math.min(200, originalLength);
                    needsSampling = originalLength > 200;
                    break;
                default:
                    // 其他情況：如果數據點超過1000個，進行採樣
                    needsSampling = originalLength > 1000;
                    targetPoints = Math.min(1000, originalLength);
            }
            
            if (needsSampling) {
                historicalData = uniformSampleDataByAxis(historicalData, range, maxTicks, originalLength);
                console.log(`📊 智能採樣：從 ${originalLength} 個數據點採樣到 ${historicalData.length} 個（範圍：${range}，確保連續性）`);
            } else {
                // 即使不需要採樣，也確保數據點之間有連續性
                // 檢查是否有缺失的日期，如果有則進行插值
                historicalData = ensureDataConsistency(historicalData, range);
                console.log(`📊 數據一致性檢查：${historicalData.length} 個數據點（範圍：${range}）`);
            }
        }
        
        // 如果聚合/採樣後數據為空，顯示友好提示
        if (historicalData.length === 0) {
            console.warn(`⚠️ 數據處理後為空 (範圍=${range}, pageOffset=${pageOffset})`);
            
            // 銷毀現有圖表（如果存在）
            if (historyChart) {
                historyChart.destroy();
                historyChart = null;
            }
            
            // 顯示友好的提示消息，而不是完全隱藏區塊
            const historyContainer = document.getElementById('history-chart-container');
            const historyCard = historyContainer?.closest('.chart-card');
            if (historyCard) {
                historyCard.style.display = '';
                if (historyContainer) {
                    historyContainer.innerHTML = `
                        <div style="padding: 40px; text-align: center; color: #666;">
                            <p style="font-size: 16px; margin-bottom: 10px;">📊 此時間範圍內沒有數據</p>
                            <p style="font-size: 14px;">日期範圍：${startDate} 至 ${endDate}</p>
                        </div>
                    `;
                }
            }
            
            // 更新日期範圍顯示
            updateHistoryDateRange(startDate, endDate, range);
            
            // 更新按鈕狀態
            updateHistoryNavigationButtons(range, pageOffset, []);
            updateLoadingProgress('history', 0);
            return;
        }
        
        updateLoadingProgress('history', 40);
        const historyCtx = historyCanvas.getContext('2d');
        
        // 創建漸變
        const historyGradient = historyCtx.createLinearGradient(0, 0, 0, 320);
        historyGradient.addColorStop(0, 'rgba(79, 70, 229, 0.25)');
        historyGradient.addColorStop(0.5, 'rgba(79, 70, 229, 0.08)');
        historyGradient.addColorStop(1, 'rgba(79, 70, 229, 0)');
        
        updateLoadingProgress('history', 50);
        
        // 計算統計數據
        const values = historicalData.map(d => d.attendance);
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
        const stdDev = Math.sqrt(variance);
        
        // 根據選擇的時間範圍動態生成日期標籤（類似股票圖表）
        const labels = historicalData.map((d, i) => {
            const date = new Date(d.date);
            const totalDays = historicalData.length;
            const isFirst = i === 0;
            const isLast = i === historicalData.length - 1;
            
            // 根據時間範圍決定標籤格式和顯示頻率
            switch (range) {
                case '1D':
                    // 1天：顯示日期和時間（如果有時間數據）或只顯示日期
                    return formatDateDDMM(d.date, false);
                    
                case '1週':
                    // 1週：顯示日期（DD/MM），每天顯示
                    return formatDateDDMM(d.date, false);
                    
                case '1月':
                    // 1月：顯示日期（DD/MM），每2-3天顯示一次，確保均勻分佈
                    const step1Month = Math.max(1, Math.floor(totalDays / 15)); // 大約15個標籤
                    if (isFirst || isLast || i % step1Month === 0 || date.getDate() === 1 || date.getDate() === 15) {
                        return formatDateDDMM(d.date, false);
                    }
                    return '';
                    
                case '3月':
                    // 3月：顯示日期（DD/MM），每週顯示一次，確保均勻分佈
                    const step3Month = Math.max(1, Math.floor(totalDays / 20)); // 大約20個標籤
                    if (isFirst || isLast || i % step3Month === 0 || date.getDay() === 0 || date.getDate() === 1) {
                        return formatDateDDMM(d.date, false);
                    }
                    return '';
                    
                case '6月':
                    // 6月：顯示月份（MM月），每2週顯示一次，確保均勻分佈
                    const step6Month = Math.max(1, Math.floor(totalDays / 24)); // 大約24個標籤
                    if (isFirst || isLast || i % step6Month === 0 || date.getDate() === 1 || date.getDate() === 15) {
                        if (date.getDate() === 1) {
                            return `${date.getMonth() + 1}月`;
                        }
                        return formatDateDDMM(d.date, false);
                    }
                    return '';
                    
                case '1年':
                    // 1年：顯示月份（MM月），每2週顯示一次，確保均勻分佈
                    const step1Year = Math.max(1, Math.floor(totalDays / 24)); // 大約24個標籤
                    if (isFirst || isLast || i % step1Year === 0 || date.getDate() === 1) {
                        if (date.getDate() === 1) {
                            return `${date.getMonth() + 1}月`;
                        }
                        return formatDateDDMM(d.date, false);
                    }
                    return '';
                    
                case '2年':
                    // 2年：顯示年份和月份（YYYY年MM月），每季度顯示
                    if (isFirst || isLast || (date.getDate() === 1 && [0, 3, 6, 9].includes(date.getMonth()))) {
                        return `${date.getFullYear()}年${date.getMonth() + 1}月`;
                    }
                    return '';
                    
                case '5年':
                    // 5年：顯示年份和月份（YYYY年MM月），每半年顯示
                    if (isFirst || isLast || (date.getDate() === 1 && [0, 6].includes(date.getMonth()))) {
                        return `${date.getFullYear()}年${date.getMonth() + 1}月`;
                    }
                    return '';
                    
                case '10年':
                    // 10年：顯示年份（YYYY年），每年1月1號顯示
                    if (isFirst || isLast || (date.getMonth() === 0 && date.getDate() === 1)) {
                        return `${date.getFullYear()}年`;
                    }
                    return '';
                    
                case '全部':
                    // 全部：顯示年份（YYYY年），每年1月1號顯示
                    if (isFirst || isLast || (date.getMonth() === 0 && date.getDate() === 1)) {
                        return `${date.getFullYear()}年`;
                    }
                    return '';
                    
                default:
                    // 默認：根據數據量決定
                    if (totalDays <= 30) {
                        return formatDateDDMM(d.date, false);
                    } else if (totalDays <= 90) {
                        if (date.getDay() === 0 || isFirst || isLast) {
                            return formatDateDDMM(d.date, false);
                        }
                        return '';
                    } else {
                        if (date.getDate() === 1 || isFirst || isLast) {
                            return `${date.getMonth() + 1}月`;
                        }
                        return '';
                    }
            }
        });
        
        updateLoadingProgress('history', 70);
        
        // 如果已有圖表，先銷毀
        if (historyChart) {
            historyChart.destroy();
        }
        
        // 設置容器（使用responsive模式，不再需要滾動）
        const historyContainer = document.getElementById('history-chart-container');
        const containerWidth = historyContainer ? (historyContainer.offsetWidth || window.innerWidth) : window.innerWidth;
        
        if (historyContainer) {
            historyContainer.style.width = '100%';
            historyContainer.style.maxWidth = '100%';
            historyContainer.style.overflow = 'hidden'; // 移除滾動
        }
        if (historyCanvas) {
            historyCanvas.style.width = '100%';
            historyCanvas.style.height = '380px';
            historyCanvas.style.maxWidth = '100%';
        }
        
        // 將數據轉換為 {x: date, y: value} 格式以支持 time scale
        // Chart.js time scale 需要 Date 對象或時間戳，而不是字符串
        const dataPoints = historicalData.map((d, i) => {
            let date;
            if (typeof d.date === 'string') {
                // 如果是字符串，直接轉換為 Date 對象
                // 數據庫返回的日期已經是 ISO 格式（如 2025-11-07T00:00:00.000Z），不需要再添加時間部分
                date = new Date(d.date);
            } else if (d.date instanceof Date) {
                date = d.date;
            } else {
                date = new Date(d.date);
            }
            // 確保日期有效
            if (isNaN(date.getTime())) {
                console.warn('無效日期:', d.date, '類型:', typeof d.date);
                return null;
            }
            return {
                x: date.getTime(), // 使用時間戳，Chart.js time scale 支持
                y: d.attendance
            };
        }).filter(d => d !== null); // 過濾掉無效的數據點
        
        console.log(`📊 準備繪製圖表: ${dataPoints.length} 個數據點`);
        if (dataPoints.length > 0) {
            console.log('📊 第一個數據點:', dataPoints[0]);
            console.log('📊 最後一個數據點:', dataPoints[dataPoints.length - 1]);
        } else {
            console.error('❌ 沒有有效的數據點！');
        }
        
        historyChart = new Chart(historyCtx, {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: '實際人數',
                        data: dataPoints,
                        borderColor: '#4f46e5',
                        backgroundColor: historyGradient,
                        borderWidth: 2,
                        fill: true,
                        // 對於長時間範圍，使用更高的平滑度
                        tension: (range === '5年' || range === '10年' || range === '全部') ? 0.5 : 0.35,
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        pointBackgroundColor: 'transparent',
                        pointBorderColor: 'transparent',
                        pointBorderWidth: 0,
                        showLine: true,
                        spanGaps: false, // 不跨越缺失數據，保持線條連續
                        segment: {
                            borderColor: (ctx) => {
                                // 確保線條顏色一致
                                return '#4f46e5';
                            }
                        }
                    },
                    {
                        label: `平均 (${Math.round(mean)})`,
                        data: historicalData.map((d, i) => {
                            let date;
                            if (typeof d.date === 'string') {
                                date = new Date(d.date);
                            } else if (d.date instanceof Date) {
                                date = d.date;
                            } else {
                                date = new Date(d.date);
                            }
                            if (isNaN(date.getTime())) return null;
                            return {
                                x: date.getTime(),
                                y: mean
                            };
                        }).filter(d => d !== null),
                        borderColor: '#ef4444',
                        borderWidth: 2.5,
                        borderDash: [8, 4],
                        fill: false,
                        pointRadius: 0,
                        pointHoverRadius: 0
                    },
                    {
                        label: '±1σ 範圍',
                        data: historicalData.map((d, i) => {
                            let date;
                            if (typeof d.date === 'string') {
                                date = new Date(d.date);
                            } else if (d.date instanceof Date) {
                                date = d.date;
                            } else {
                                date = new Date(d.date);
                            }
                            if (isNaN(date.getTime())) return null;
                            return {
                                x: date.getTime(),
                                y: mean + stdDev
                            };
                        }).filter(d => d !== null),
                        borderColor: 'rgba(239, 68, 68, 0.25)',
                        borderWidth: 1.5,
                        borderDash: [4, 4],
                        fill: false,
                        pointRadius: 0,
                        pointHoverRadius: 0
                    },
                    {
                        label: '',
                        data: historicalData.map((d, i) => {
                            let date;
                            if (typeof d.date === 'string') {
                                date = new Date(d.date);
                            } else if (d.date instanceof Date) {
                                date = d.date;
                            } else {
                                date = new Date(d.date);
                            }
                            if (isNaN(date.getTime())) return null;
                            return {
                                x: date.getTime(),
                                y: mean - stdDev
                            };
                        }).filter(d => d !== null),
                        borderColor: 'rgba(239, 68, 68, 0.25)',
                        borderWidth: 1.5,
                        borderDash: [4, 4],
                        fill: '-1',
                        backgroundColor: 'rgba(239, 68, 68, 0.03)',
                        pointRadius: 0,
                        pointHoverRadius: 0
                    }
                ]
            },
            options: {
                ...professionalOptions,
                responsive: true, // 啟用響應式，讓圖表適應容器寬度
                maintainAspectRatio: false,
                plugins: {
                    ...professionalOptions.plugins,
                    legend: {
                        ...professionalOptions.plugins.legend,
                        labels: {
                            ...professionalOptions.plugins.legend.labels,
                            filter: function(item) {
                                return item.text !== '';
                            }
                        }
                    },
                    tooltip: {
                        ...professionalOptions.plugins.tooltip,
                        callbacks: {
                            title: function(items) {
                                if (!items || items.length === 0) return '';
                                try {
                                    const item = items[0];
                                    let date;
                                    
                                    // 處理不同的日期來源
                                    if (item.parsed && item.parsed.x !== undefined) {
                                        const xValue = item.parsed.x;
                                        // xValue 可能是時間戳（數字）或 Date 對象
                                        if (typeof xValue === 'number') {
                                            date = new Date(xValue);
                                        } else if (xValue instanceof Date) {
                                            date = xValue;
                                        } else if (typeof xValue === 'string') {
                                            date = new Date(xValue);
                                        } else {
                                            // 如果是對象，嘗試提取
                                            const timestamp = xValue?.value || xValue?.getTime?.() || xValue?.valueOf?.();
                                            if (timestamp) {
                                                date = new Date(timestamp);
                                            } else {
                                                // 回退到數據索引
                                                if (item.dataIndex !== undefined && historicalData[item.dataIndex]) {
                                                    date = new Date(historicalData[item.dataIndex].date);
                                                } else {
                                                    return '';
                                                }
                                            }
                                        }
                                    } else if (item.dataIndex !== undefined && historicalData[item.dataIndex]) {
                                        const dateValue = historicalData[item.dataIndex].date;
                                        if (dateValue instanceof Date) {
                                            date = dateValue;
                                        } else if (typeof dateValue === 'string') {
                                            date = new Date(dateValue);
                                        } else if (typeof dateValue === 'number') {
                                            date = new Date(dateValue);
                                        } else {
                                            return '';
                                        }
                                    } else {
                                        return '';
                                    }
                                    
                                    // 驗證日期
                                    if (!date || isNaN(date.getTime())) {
                                        return '';
                                    }
                                    
                                    // 格式化日期為字符串
                                    const dateStr = date.toISOString().split('T')[0];
                                    const formatted = formatDateDDMM(dateStr, true);
                                    
                                    // 確保返回字符串
                                    return (formatted && typeof formatted === 'string') ? formatted : '';
                                } catch (e) {
                                    console.warn('工具提示日期格式化錯誤:', e, items);
                                    return '';
                                }
                            },
                            label: function(item) {
                                if (!item) return null;
                                try {
                                    if (item.datasetIndex === 0) {
                                        let value = item.raw;
                                        // 處理不同的數據格式
                                        if (value === null || value === undefined) return null;
                                        
                                        // 如果是對象，提取 y 值
                                        if (typeof value === 'object' && value !== null) {
                                            value = value.y !== undefined ? value.y : 
                                                   value.value !== undefined ? value.value :
                                                   null;
                                        }
                                        
                                        // 確保是數字
                                        if (typeof value !== 'number' || isNaN(value)) {
                                            return null;
                                        }
                                        
                                        return `實際: ${Math.round(value)} 人`;
                                    }
                                    return null;
                                } catch (e) {
                                    console.warn('工具提示標籤格式化錯誤:', e);
                                    return null;
                                }
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'time', // 使用時間軸確保日期間距正確
                        time: {
                            unit: getTimeUnit(range), // 根據範圍動態設置時間單位
                            displayFormats: getTimeDisplayFormats(range),
                            tooltipFormat: 'yyyy-MM-dd',
                            // 對於長時間範圍，確保均勻分佈
                            stepSize: getTimeStepSize(range, historicalData.length),
                            // 確保時間軸使用均勻間距
                            round: false // 不四捨五入，保持精確時間
                        },
                        distribution: 'linear', // 使用線性分佈確保均勻間距
                        bounds: 'ticks', // 使用刻度邊界，確保標籤均勻分佈
                        offset: false, // 不偏移，確保數據點對齊到時間軸
                        ticks: {
                            autoSkip: false, // 禁用自動跳過，使用 stepSize 確保均勻間距
                            maxTicksLimit: getMaxTicksForRange(range, historicalData.length),
                            source: 'auto', // 使用自動源，讓 Chart.js 根據 stepSize 均勻分佈標籤
                            font: {
                                size: containerWidth <= 600 ? 8 : 10
                            },
                            padding: containerWidth <= 600 ? 2 : 6,
                            minRotation: 0,
                            maxRotation: containerWidth <= 600 ? 45 : 0, // 小屏幕允許旋轉
                            // 移除 stepSize，讓 time.stepSize 控制
                            // 使用自定義 callback 來格式化日期標籤，避免 [object Object]
                            callback: function(value, index, ticks) {
                                // 確保返回字符串，避免 [object Object]
                                if (value === undefined || value === null) {
                                    return '';
                                }
                                
                                try {
                                    let date;
                                    let timestamp;
                                    
                                    // 處理不同類型的 value
                                    if (value instanceof Date) {
                                        // 如果已經是 Date 對象，直接使用
                                        date = value;
                                    } else if (typeof value === 'number') {
                                        // 如果是數字（時間戳），轉換為 Date
                                        timestamp = value;
                                        date = new Date(timestamp);
                                    } else if (typeof value === 'string') {
                                        // 如果是字符串，轉換為 Date
                                        date = new Date(value);
                                    } else if (value && typeof value === 'object') {
                                        // 如果是對象，嘗試提取時間戳
                                        // Chart.js time scale 可能傳遞 {value: timestamp} 或其他格式
                                        if (value.value !== undefined) {
                                            timestamp = typeof value.value === 'number' ? value.value : 
                                                       typeof value.value === 'string' ? new Date(value.value).getTime() : null;
                                        } else if (value.getTime) {
                                            timestamp = value.getTime();
                                        } else if (value.valueOf) {
                                            timestamp = value.valueOf();
                                        } else if (value.x !== undefined) {
                                            timestamp = typeof value.x === 'number' ? value.x : null;
                                        } else if (value.t !== undefined) {
                                            timestamp = typeof value.t === 'number' ? value.t : null;
                                        } else {
                                            // 如果無法提取，嘗試直接轉換
                                            try {
                                                timestamp = Number(value);
                                                if (isNaN(timestamp)) {
                                                    console.warn('無法從對象中提取日期:', value);
                                                    return '';
                                                }
                                            } catch (e) {
                                                console.warn('日期對象轉換失敗:', e, value);
                                                return '';
                                            }
                                        }
                                        
                                        if (timestamp !== null && !isNaN(timestamp)) {
                                            date = new Date(timestamp);
                                        } else {
                                            return '';
                                        }
                                    } else {
                                        return '';
                                    }
                                    
                                    // 驗證日期有效性
                                    if (!date || isNaN(date.getTime())) {
                                        return '';
                                    }
                                    
                                    // 格式化日期
                                    const formatted = formatTimeLabel(date, range);
                                    
                                    // 確保返回字符串（雙重檢查）
                                    if (formatted && typeof formatted === 'string') {
                                        return formatted;
                                    } else {
                                        // 如果 formatTimeLabel 返回非字符串，手動格式化
                                        const day = String(date.getDate()).padStart(2, '0');
                                        const month = String(date.getMonth() + 1).padStart(2, '0');
                                        const year = date.getFullYear();
                                        
                                        // 根據範圍返回適當格式
                                        if (range === '10年' || range === '全部') {
                                            return `${year}年`;
                                        } else if (range === '1年' || range === '2年' || range === '5年') {
                                            if (date.getDate() === 1) {
                                                return `${month}月`;
                                            }
                                            return `${day}/${month}`;
                                        } else {
                                            return `${day}/${month}`;
                                        }
                                    }
                                } catch (e) {
                                    console.warn('日期格式化錯誤:', e, value, typeof value);
                                    // 返回空字符串而不是錯誤
                                    return '';
                                }
                            }
                        },
                        grid: {
                            ...professionalOptions.scales.x.grid,
                            display: true
                        },
                        // 注意：不使用 adapters.date.locale，因為 chartjs-adapter-date-fns 需要完整的 locale 對象
                        // 我們使用自定義的 callback 函數來格式化日期標籤
                    },
                    y: {
                        ...professionalOptions.scales.y,
                        min: Math.max(0, Math.min(...values) - 50),
                        max: Math.max(...values) + 50,
                        ticks: {
                            ...professionalOptions.scales.y.ticks,
                            // 計算統一的步長，確保Y軸間隔均勻
                            stepSize: (() => {
                                const valueRange = Math.max(...values) - Math.min(...values);
                                const idealStepSize = valueRange / 10;
                                // 將步長調整為合適的整數（5, 10, 20, 25, 50, 100等）
                                if (idealStepSize <= 5) return 5;
                                if (idealStepSize <= 10) return 10;
                                if (idealStepSize <= 20) return 20;
                                if (idealStepSize <= 25) return 25;
                                if (idealStepSize <= 50) return 50;
                                if (idealStepSize <= 100) return 100;
                                return Math.ceil(idealStepSize / 50) * 50; // 向上取整到50的倍數
                            })()
                        }
                    }
                }
            }
        });
        
        updateLoadingProgress('history', 90);
        
        // 確保圖表卡片是顯示的（如果有數據）
        const historyCard = document.getElementById('history-chart-container')?.closest('.chart-card');
        if (historyCard) {
            historyCard.style.display = '';
        }
        
        // 確保圖表正確顯示
        if (historyCanvas) {
            historyCanvas.style.display = 'block';
        }
        const historyLoadingEl = document.getElementById('history-chart-loading');
        if (historyLoadingEl) {
            historyLoadingEl.style.display = 'none';
        }
        
        // 確保有數據才顯示圖表
        if (historicalData.length === 0) {
            console.error('❌ 圖表創建後數據為空，這不應該發生');
            if (historyChart) {
                historyChart.destroy();
                historyChart = null;
            }
            if (historyCanvas) {
                historyCanvas.style.display = 'none';
            }
            if (historyLoadingEl) {
                historyLoadingEl.style.display = 'block';
                historyLoadingEl.innerHTML = `
                    <div style="text-align: center; color: var(--text-secondary); padding: var(--space-xl);">
                        <div style="font-size: 1.2rem; margin-bottom: 0.5rem;">⚠️ 數據處理錯誤</div>
                        <div style="font-size: 0.875rem; color: var(--text-secondary);">
                            請刷新頁面重試
                        </div>
                    </div>
                `;
            }
            return;
        }
        
        updateLoadingProgress('history', 100);
        completeChartLoading('history');
        
        // 更新導航按鈕和日期範圍顯示
        updateHistoryDateRange(startDate, endDate, range);
        updateHistoryNavigationButtons(range, pageOffset, historicalData);
        
        // 確保圖表正確顯示（使用響應式模式，適應容器寬度）
        setTimeout(() => {
            if (historyChart && historyCanvas && historyContainer) {
                // 確保容器和canvas使用響應式寬度（不滾動）
                historyContainer.style.overflow = 'hidden';
                historyCanvas.style.width = '100%';
                historyCanvas.style.maxWidth = '100%';
                
                // 更新圖表選項，特別是時間軸配置
                historyChart.options.layout.padding = getResponsivePadding();
                if (historyChart.options.scales && historyChart.options.scales.x) {
                    // 更新時間軸配置
                    historyChart.options.scales.x.time.unit = getTimeUnit(range);
                    historyChart.options.scales.x.time.displayFormats = getTimeDisplayFormats(range);
                    
                    if (historyChart.options.scales.x.ticks) {
                        historyChart.options.scales.x.ticks.autoSkip = true;
                        historyChart.options.scales.x.ticks.maxTicksLimit = getMaxTicksForRange(range, historicalData.length);
                        historyChart.options.scales.x.ticks.maxRotation = 0;
                    }
                }
                
                // 讓圖表自動適應容器寬度（響應式）
                historyChart.resize();
                // 使用 'none' 模式更新，然後強制重新渲染以確保 X 軸更新
                historyChart.update('none');
                
                // 確保canvas可見
                historyCanvas.style.display = 'block';
                historyCanvas.style.visibility = 'visible';
                
                // 再次強制更新，確保 X 軸時間線正確顯示
                setTimeout(() => {
                    if (historyChart) {
                        // 強制重新計算和渲染圖表
                        historyChart.update('active');
                        // 觸發 resize 以確保時間軸正確更新
                        historyChart.resize();
                    }
                }, 200);
            }
        }, 100);
        console.log(`✅ 歷史趨勢圖已載入 (${historicalData.length} 筆數據, 範圍: ${range}, 分頁偏移: ${pageOffset})`);
    } catch (error) {
        console.error('❌ 歷史趨勢圖載入失敗:', error);
        updateLoadingProgress('history', 0);
    }
}

// 初始化實際vs預測對比圖
async function initComparisonChart() {
    try {
        updateLoadingProgress('comparison', 10);
        const comparisonCanvas = document.getElementById('comparison-chart');
        if (!comparisonCanvas) {
            console.error('❌ 找不到 comparison-chart canvas');
            updateLoadingProgress('comparison', 0);
            return;
        }
        
        updateLoadingProgress('comparison', 20);
        // 從數據庫獲取比較數據
        const comparisonData = await fetchComparisonData(100);
        
        if (comparisonData.length === 0) {
            console.warn('⚠️ 沒有比較數據');
            // 顯示錯誤訊息而不是直接返回
            const loadingEl = document.getElementById('comparison-chart-loading');
            if (loadingEl) {
                loadingEl.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: var(--space-xl);">暫無比較數據</div>';
            }
            updateLoadingProgress('comparison', 0);
            return;
        }
        
        updateLoadingProgress('comparison', 40);
        const comparisonCtx = comparisonCanvas.getContext('2d');
        
        // 日期標籤
        const labels = comparisonData.map(d => formatDateDDMM(d.date, false));
        
        updateLoadingProgress('comparison', 60);
        
        // 如果已有圖表，先銷毀
        if (comparisonChart) {
            comparisonChart.destroy();
        }
        
        comparisonChart = new Chart(comparisonCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: '實際人數',
                        data: validComparisonData.map(d => d.actual || null),
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        borderWidth: 2,
                        fill: false,
                        tension: 0.4,
                        pointRadius: 3,
                        pointHoverRadius: 6
                    },
                    {
                        label: '預測人數',
                        data: validComparisonData.map(d => d.predicted || null),
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        fill: false,
                        tension: 0.4,
                        pointRadius: 3,
                        pointHoverRadius: 6
                    },
                    {
                        label: '80% CI 上限',
                        data: validComparisonData.map(d => d.ci80_high || null),
                        borderColor: 'rgba(156, 163, 175, 0.5)',
                        backgroundColor: 'rgba(156, 163, 175, 0.05)',
                        borderWidth: 1,
                        borderDash: [2, 2],
                        fill: '-1',
                        pointRadius: 0
                    },
                    {
                        label: '80% CI 下限',
                        data: validComparisonData.map(d => d.ci80_low || null),
                        borderColor: 'rgba(34, 197, 94, 0.5)',
                        backgroundColor: 'rgba(34, 197, 94, 0.05)',
                        borderWidth: 1,
                        borderDash: [2, 2],
                        fill: false,
                        pointRadius: 0
                    }
                ]
            },
            options: {
                ...professionalOptions,
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    ...professionalOptions.plugins,
                    tooltip: {
                        ...professionalOptions.plugins.tooltip,
                        callbacks: {
                            title: function(items) {
                                const idx = items[0].dataIndex;
                                return formatDateDDMM(validComparisonData[idx].date, true);
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        ...professionalOptions.scales.x,
                        ticks: {
                            ...professionalOptions.scales.x.ticks,
                            autoSkip: true,
                            maxTicksLimit: getResponsiveMaxTicksLimit()
                        }
                    },
                    y: {
                        ...professionalOptions.scales.y,
                        min: 0,
                        ticks: {
                            ...professionalOptions.scales.y.ticks,
                            stepSize: 20
                        }
                    }
                }
            }
        });
        
        updateLoadingProgress('comparison', 90);
        updateLoadingProgress('comparison', 100);
        completeChartLoading('comparison');
        // 確保圖表正確適應
        setTimeout(() => {
            if (comparisonChart) {
                comparisonChart.options.layout.padding = getResponsivePadding();
                if (comparisonChart.options.scales && comparisonChart.options.scales.x && comparisonChart.options.scales.x.ticks) {
                    comparisonChart.options.scales.x.ticks.maxTicksLimit = getResponsiveMaxTicksLimit();
                }
                comparisonChart.resize();
                comparisonChart.update('none');
            }
        }, 50);
        console.log(`✅ 實際vs預測對比圖已載入 (${validComparisonData.length} 筆有效數據，總共 ${comparisonData.length} 筆)`);
    } catch (error) {
        console.error('❌ 實際vs預測對比圖載入失敗:', error);
        updateLoadingProgress('comparison', 0);
    }
}

// 初始化詳細比較表格
async function initComparisonTable() {
    try {
        const tableBody = document.getElementById('comparison-table-body');
        const table = document.getElementById('comparison-table');
        const loading = document.getElementById('comparison-table-loading');
        
        if (!tableBody || !table) {
            console.error('❌ 找不到比較表格元素');
            return;
        }
        
        if (loading) loading.style.display = 'block';
        if (table) table.style.display = 'none';
        
        // 從數據庫獲取比較數據
        const comparisonData = await fetchComparisonData(100);
        
        // 過濾出有效的比較數據（必須同時有實際和預測）
        const validComparisonData = comparisonData.filter(d => d.actual != null && d.predicted != null);
        
        if (validComparisonData.length === 0) {
            console.warn('⚠️ 沒有有效的比較數據（需要同時有實際和預測數據）');
            if (loading) loading.style.display = 'none';
            tableBody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #64748b; padding: var(--space-xl);">暫無數據<br><small>需要同時有實際數據和預測數據</small></td></tr>';
            if (table) table.style.display = 'table';
            return;
        }
        
        // 生成表格行
        tableBody.innerHTML = validComparisonData.map(d => {
            const error = d.error || (d.predicted && d.actual ? d.predicted - d.actual : null);
            const errorRate = d.error_percentage || (error && d.actual ? ((error / d.actual) * 100).toFixed(2) : null);
            const ci80 = d.ci80_low && d.ci80_high ? `${d.ci80_low}-${d.ci80_high}` : '--';
            const ci95 = d.ci95_low && d.ci95_high ? `${d.ci95_low}-${d.ci95_high}` : '--';
            const accuracy = errorRate ? (100 - Math.abs(parseFloat(errorRate))).toFixed(2) + '%' : '--';
            
            return `
                <tr>
                    <td>${formatDateDDMM(d.date, true)}</td>
                    <td>${d.actual || '--'}</td>
                    <td>${d.predicted || '--'}</td>
                    <td>${error !== null ? (error > 0 ? '+' : '') + error : '--'}</td>
                    <td>${errorRate !== null ? (errorRate > 0 ? '+' : '') + errorRate + '%' : '--'}</td>
                    <td>${ci80}</td>
                    <td>${ci95}</td>
                    <td>${accuracy}</td>
                </tr>
            `;
        }).join('');
        
        if (loading) loading.style.display = 'none';
        if (table) table.style.display = 'table';
        console.log(`✅ 詳細比較表格已載入 (${validComparisonData.length} 筆有效數據，總共 ${comparisonData.length} 筆)`);
    } catch (error) {
        console.error('❌ 詳細比較表格載入失敗:', error);
        const loading = document.getElementById('comparison-table-loading');
        const table = document.getElementById('comparison-table');
        if (loading) loading.style.display = 'none';
        if (table) table.style.display = 'table';
    }
}

// ============================================
// 日期格式化工具函數
// ============================================
// 根據時間範圍獲取最大標籤數量
function getMaxTicksForRange(range, dataLength) {
    // 根據容器寬度動態調整標籤數量
    const containerWidth = window.innerWidth || 1200;
    const baseMaxTicks = containerWidth <= 600 ? 12 : containerWidth <= 900 ? 18 : 24;
    
    switch (range) {
        case '1D':
            return Math.min(24, dataLength); // 1天最多24個標籤
        case '1週':
            return Math.min(7, dataLength); // 1週最多7個標籤
        case '1月':
            return Math.min(15, dataLength); // 1月最多15個標籤（每2天）
        case '3月':
            return Math.min(20, dataLength); // 3月最多20個標籤（每週）
        case '6月':
            return Math.min(24, dataLength); // 6月最多24個標籤（每週）
        case '1年':
            return Math.min(24, dataLength); // 1年最多24個標籤（每2週）
        case '2年':
            return Math.min(24, dataLength); // 2年最多24個標籤（每月）
        case '5年':
            // 5年：每5年一個標籤，計算需要多少個標籤
            const years5 = dataLength / 365;
            return Math.min(Math.max(1, Math.ceil(years5 / 5)), 10); // 最多10個標籤
        case '10年':
            // 10年：每10年一個標籤，計算需要多少個標籤
            const years10 = dataLength / 365;
            return Math.min(Math.max(1, Math.ceil(years10 / 10)), 10); // 最多10個標籤
        case '全部':
            // 全部：根據數據範圍動態調整
            const yearsAll = dataLength / 365;
            if (yearsAll > 20) {
                // 超過20年：每10年一個標籤
                return Math.min(Math.max(2, Math.ceil(yearsAll / 10)), 15);
            } else if (yearsAll > 10) {
                // 10-20年：每5年一個標籤
                return Math.min(Math.max(2, Math.ceil(yearsAll / 5)), 10);
            } else {
                // 少於10年：每2年一個標籤
                return Math.min(Math.max(2, Math.ceil(yearsAll / 2)), 10);
            }
        default:
            return Math.min(baseMaxTicks, dataLength);
    }
}

// 根據時間範圍獲取時間單位
function getTimeUnit(range) {
    switch (range) {
        case '1D':
            return 'hour';
        case '1週':
            return 'day';
        case '1月':
            return 'day';
        case '3月':
            return 'week';
        case '6月':
            return 'week';
        case '1年':
            return 'day'; // 使用 day 單位，stepSize 為 60 天（每2個月）
        case '2年':
            return 'day'; // 使用 day 單位，stepSize 為 120 天（每4個月）
        case '5年':
            return 'day'; // 使用 day 單位，stepSize 為 180 天（每6個月）
        case '10年':
            return 'day'; // 使用 day 單位，stepSize 為 365 天（每年）
        case '全部':
            return 'day'; // 使用 day 單位，stepSize 動態計算
        default:
            return 'day';
    }
}

// 根據時間範圍獲取時間顯示格式
function getTimeDisplayFormats(range) {
    switch (range) {
        case '1D':
            return { hour: 'HH:mm' };
        case '1週':
            return { day: 'dd/MM' };
        case '1月':
            return { day: 'dd/MM' };
        case '3月':
            return { week: 'dd/MM', day: 'dd/MM' };
        case '6月':
            return { month: 'MM月', week: 'dd/MM' };
        case '1年':
            return { month: 'MM月' };
        case '2年':
            return { month: 'MM月', year: 'yyyy年' };
        case '5年':
            return { month: 'MM月', year: 'yyyy年' };
        case '10年':
            return { year: 'yyyy年' };
        case '全部':
            return { year: 'yyyy年' };
        default:
            return { day: 'dd/MM' };
    }
}

// 根據 X 軸標籤位置均勻採樣數據，確保數據點對齊到 X 軸標籤
function uniformSampleDataByAxis(data, range, maxTicks, originalLength) {
    if (!data || data.length === 0) {
        return data;
    }
    
    // 獲取第一個和最後一個數據點的時間戳
    const firstDate = new Date(data[0].date);
    const lastDate = new Date(data[data.length - 1].date);
    
    // 根據時間範圍計算 X 軸標籤的實際位置
    const sampled = [];
    const usedDates = new Set(); // 避免重複
    
    // 根據不同的時間範圍，計算 X 軸標籤的實際位置
    switch (range) {
        case '10年':
            // 10年視圖：每10年顯示一個標籤（例如 2014年, 2024年），數據點也應該對齊到每10年
            let currentYear10 = firstDate.getFullYear();
            const lastYear10 = lastDate.getFullYear();
            
            // 調整到第一個10年的倍數（例如 2014, 2024, 2034...）
            const firstDecade = Math.floor(currentYear10 / 10) * 10;
            if (currentYear10 !== firstDecade) {
                currentYear10 = firstDecade + 10; // 從下一個10年開始
            } else {
                currentYear10 = firstDecade; // 如果正好是10年的倍數，從這一年開始
            }
            
            while (currentYear10 <= lastYear10) {
                const targetDate = new Date(currentYear10, 0, 1); // 1月1日
                
                // 找到最接近目標日期的數據點
                let closestData = null;
                let minDiff = Infinity;
                
                for (const d of data) {
                    const date = new Date(d.date);
                    const diff = Math.abs(date.getTime() - targetDate.getTime());
                    // 允許在目標日期前後1年內
                    if (diff < minDiff && diff < 365 * 24 * 60 * 60 * 1000) {
                        minDiff = diff;
                        closestData = d;
                    }
                }
                
                if (closestData && !usedDates.has(closestData.date)) {
                    sampled.push(closestData);
                    usedDates.add(closestData.date);
                }
                
                currentYear10 += 10; // 每10年一個標籤
            }
            break;
            
        case '全部':
            // 全部視圖：根據數據範圍動態決定標籤間隔
            const firstYearAll = firstDate.getFullYear();
            const lastYearAll = lastDate.getFullYear();
            const yearSpan = lastYearAll - firstYearAll;
            
            let yearInterval;
            if (yearSpan > 20) {
                // 超過20年：每10年一個標籤
                yearInterval = 10;
            } else if (yearSpan > 10) {
                // 10-20年：每5年一個標籤
                yearInterval = 5;
            } else {
                // 少於10年：每2年一個標籤
                yearInterval = 2;
            }
            
            // 調整到第一個間隔的倍數
            let currentYearAll = Math.floor(firstYearAll / yearInterval) * yearInterval;
            if (currentYearAll < firstYearAll) {
                currentYearAll += yearInterval;
            }
            
            while (currentYearAll <= lastYearAll) {
                const targetDate = new Date(currentYearAll, 0, 1); // 1月1日
                
                // 找到最接近目標日期的數據點
                let closestData = null;
                let minDiff = Infinity;
                
                for (const d of data) {
                    const date = new Date(d.date);
                    const diff = Math.abs(date.getTime() - targetDate.getTime());
                    // 允許在目標日期前後1年內
                    if (diff < minDiff && diff < 365 * 24 * 60 * 60 * 1000) {
                        minDiff = diff;
                        closestData = d;
                    }
                }
                
                if (closestData && !usedDates.has(closestData.date)) {
                    sampled.push(closestData);
                    usedDates.add(closestData.date);
                }
                
                currentYearAll += yearInterval;
            }
            break;
            
        case '5年':
            // 5年視圖：每5年顯示一個標籤（例如 2015年, 2020年, 2025年），數據點也應該對齊到每5年
            let currentYear5 = firstDate.getFullYear();
            const lastYear5 = lastDate.getFullYear();
            
            // 調整到第一個5年的倍數（例如 2015, 2020, 2025...）
            const firstQuinquennium = Math.floor(currentYear5 / 5) * 5;
            if (currentYear5 !== firstQuinquennium) {
                currentYear5 = firstQuinquennium + 5; // 從下一個5年開始
            } else {
                currentYear5 = firstQuinquennium; // 如果正好是5年的倍數，從這一年開始
            }
            
            while (currentYear5 <= lastYear5) {
                const targetDate = new Date(currentYear5, 0, 1); // 1月1日
                
                // 找到最接近目標日期的數據點
                let closestData = null;
                let minDiff = Infinity;
                
                for (const d of data) {
                    const date = new Date(d.date);
                    const diff = Math.abs(date.getTime() - targetDate.getTime());
                    // 允許在目標日期前後1年內
                    if (diff < minDiff && diff < 365 * 24 * 60 * 60 * 1000) {
                        minDiff = diff;
                        closestData = d;
                    }
                }
                
                if (closestData && !usedDates.has(closestData.date)) {
                    sampled.push(closestData);
                    usedDates.add(closestData.date);
                }
                
                currentYear5 += 5; // 每5年一個標籤
            }
            break;
            
        case '1年':
            // 1年視圖：每2個月顯示標籤（例如 1月, 3月, 5月...），確保每2個月都有數據點
            let currentDate1 = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
            // 調整到最近的2個月間隔（1月、3月、5月、7月、9月、11月）
            const startMonth1 = currentDate1.getMonth();
            const adjustedMonth1 = Math.floor(startMonth1 / 2) * 2; // 調整到偶數月份（0,2,4,6,8,10）
            currentDate1 = new Date(currentDate1.getFullYear(), adjustedMonth1, 1);
            if (currentDate1 < firstDate) {
                currentDate1 = new Date(currentDate1.getFullYear(), currentDate1.getMonth() + 2, 1);
            }
            
            while (currentDate1 <= lastDate) {
                // 找到最接近目標日期的數據點
                let closestData = null;
                let minDiff = Infinity;
                
                for (const d of data) {
                    const date = new Date(d.date);
                    const diff = Math.abs(date.getTime() - currentDate1.getTime());
                    // 允許在目標日期前後30天內
                    if (diff < minDiff && diff < 30 * 24 * 60 * 60 * 1000) {
                        minDiff = diff;
                        closestData = d;
                    }
                }
                
                // 如果找到了數據點，添加它
                if (closestData && !usedDates.has(closestData.date)) {
                    sampled.push(closestData);
                    usedDates.add(closestData.date);
                } else if (closestData === null) {
                    // 如果這個月沒有數據，使用線性插值
                    if (sampled.length > 0) {
                        // 找到下一個有數據的月份
                        let nextData = null;
                        for (let checkMonth = 2; checkMonth <= 12; checkMonth += 2) {
                            const checkDate = new Date(currentDate1.getFullYear(), currentDate1.getMonth() + checkMonth, 1);
                            if (checkDate > lastDate) break;
                            
                            for (const d of data) {
                                const date = new Date(d.date);
                                if (date.getFullYear() === checkDate.getFullYear() && 
                                    date.getMonth() === checkDate.getMonth()) {
                                    nextData = d;
                                    break;
                                }
                            }
                            if (nextData) break;
                        }
                        
                        // 使用前一個和後一個數據點進行線性插值
                        const lastData = sampled[sampled.length - 1];
                        let interpolatedValue = lastData.attendance;
                        
                        if (nextData) {
                            const lastTime = new Date(lastData.date).getTime();
                            const nextTime = new Date(nextData.date).getTime();
                            const currentTime = currentDate1.getTime();
                            const ratio = (currentTime - lastTime) / (nextTime - lastTime);
                            interpolatedValue = Math.round(lastData.attendance + (nextData.attendance - lastData.attendance) * ratio);
                        }
                        
                        sampled.push({
                            date: currentDate1.toISOString().split('T')[0],
                            attendance: interpolatedValue
                        });
                        usedDates.add(currentDate1.toISOString().split('T')[0]);
                    }
                }
                
                // 移動到下一個2個月間隔（每2個月）
                currentDate1 = new Date(currentDate1.getFullYear(), currentDate1.getMonth() + 2, 1);
            }
            break;
            
        case '2年':
            // 2年視圖：每4個月顯示標籤（例如 1月, 5月, 9月...），確保每4個月都有數據點
            let currentDate2 = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
            // 調整到最近的4個月間隔（1月、5月、9月）
            const startMonth2 = currentDate2.getMonth();
            // 調整到 0(1月), 4(5月), 8(9月)
            let adjustedMonth2 = Math.floor(startMonth2 / 4) * 4;
            currentDate2 = new Date(currentDate2.getFullYear(), adjustedMonth2, 1);
            if (currentDate2 < firstDate) {
                currentDate2 = new Date(currentDate2.getFullYear(), currentDate2.getMonth() + 4, 1);
            }
            
            while (currentDate2 <= lastDate) {
                // 找到最接近目標日期的數據點
                let closestData = null;
                let minDiff = Infinity;
                
                for (const d of data) {
                    const date = new Date(d.date);
                    const diff = Math.abs(date.getTime() - currentDate2.getTime());
                    // 允許在目標日期前後60天內
                    if (diff < minDiff && diff < 60 * 24 * 60 * 60 * 1000) {
                        minDiff = diff;
                        closestData = d;
                    }
                }
                
                // 如果找到了數據點，添加它
                if (closestData && !usedDates.has(closestData.date)) {
                    sampled.push(closestData);
                    usedDates.add(closestData.date);
                } else if (closestData === null) {
                    // 如果這個月沒有數據，使用線性插值
                    if (sampled.length > 0) {
                        // 找到下一個有數據的月份
                        let nextData = null;
                        for (let checkMonth = 4; checkMonth <= 12; checkMonth += 4) {
                            const checkDate = new Date(currentDate2.getFullYear(), currentDate2.getMonth() + checkMonth, 1);
                            if (checkDate > lastDate) break;
                            
                            for (const d of data) {
                                const date = new Date(d.date);
                                if (date.getFullYear() === checkDate.getFullYear() && 
                                    date.getMonth() === checkDate.getMonth()) {
                                    nextData = d;
                                    break;
                                }
                            }
                            if (nextData) break;
                        }
                        
                        // 使用前一個和後一個數據點進行線性插值
                        const lastData = sampled[sampled.length - 1];
                        let interpolatedValue = lastData.attendance;
                        
                        if (nextData) {
                            const lastTime = new Date(lastData.date).getTime();
                            const nextTime = new Date(nextData.date).getTime();
                            const currentTime = currentDate2.getTime();
                            const ratio = (currentTime - lastTime) / (nextTime - lastTime);
                            interpolatedValue = Math.round(lastData.attendance + (nextData.attendance - lastData.attendance) * ratio);
                        }
                        
                        sampled.push({
                            date: currentDate2.toISOString().split('T')[0],
                            attendance: interpolatedValue
                        });
                        usedDates.add(currentDate2.toISOString().split('T')[0]);
                    }
                }
                
                // 移動到下一個4個月間隔（每4個月：1月->5月->9月->1月）
                currentDate2 = new Date(currentDate2.getFullYear(), currentDate2.getMonth() + 4, 1);
            }
            break;
            
        case '3月':
        case '6月':
            // 3-6月視圖：每週顯示標籤，確保每週都有數據點
            let currentDate3 = new Date(firstDate);
            // 調整到最近的週日
            const dayOfWeek = currentDate3.getDay();
            currentDate3.setDate(currentDate3.getDate() - dayOfWeek);
            
            while (currentDate3 <= lastDate) {
                // 找到最接近目標日期的數據點
                let closestData = null;
                let minDiff = Infinity;
                
                for (const d of data) {
                    const date = new Date(d.date);
                    const diff = Math.abs(date.getTime() - currentDate3.getTime());
                    // 允許在目標日期前後7天內
                    if (diff < minDiff && diff < 7 * 24 * 60 * 60 * 1000) {
                        minDiff = diff;
                        closestData = d;
                    }
                }
                
                // 如果找到了數據點，添加它
                if (closestData && !usedDates.has(closestData.date)) {
                    sampled.push(closestData);
                    usedDates.add(closestData.date);
                } else if (closestData === null) {
                    // 如果這週沒有數據，使用線性插值
                    if (sampled.length > 0) {
                        // 找到下一個有數據的週
                        let nextData = null;
                        let checkDate = new Date(currentDate3);
                        for (let i = 0; i < 8; i++) {
                            checkDate.setDate(checkDate.getDate() + 7);
                            if (checkDate > lastDate) break;
                            
                            for (const d of data) {
                                const date = new Date(d.date);
                                const diff = Math.abs(date.getTime() - checkDate.getTime());
                                if (diff < 3 * 24 * 60 * 60 * 1000) {
                                    nextData = d;
                                    break;
                                }
                            }
                            if (nextData) break;
                        }
                        
                        // 使用前一個和後一個數據點進行線性插值
                        const lastData = sampled[sampled.length - 1];
                        let interpolatedValue = lastData.attendance;
                        
                        if (nextData) {
                            const lastTime = new Date(lastData.date).getTime();
                            const nextTime = new Date(nextData.date).getTime();
                            const currentTime = currentDate3.getTime();
                            const ratio = (currentTime - lastTime) / (nextTime - lastTime);
                            interpolatedValue = Math.round(lastData.attendance + (nextData.attendance - lastData.attendance) * ratio);
                        }
                        
                        sampled.push({
                            date: currentDate3.toISOString().split('T')[0],
                            attendance: interpolatedValue
                        });
                        usedDates.add(currentDate3.toISOString().split('T')[0]);
                    }
                }
                
                // 移動到下一個週日
                currentDate3.setDate(currentDate3.getDate() + 7);
            }
            break;
            
        case '1月':
        case '1週':
        case '1D':
        default:
            // 短時間範圍：保持所有數據或根據標籤數量均勻採樣
            if (data.length <= maxTicks * 3) {
                // 即使數據量不大，也確保數據一致性
                return ensureDataConsistency(data, range);
            }
            
            // 根據標籤數量均勻採樣
            const timeSpan = lastDate.getTime() - firstDate.getTime();
            const interval = timeSpan / (maxTicks - 1);
            
            for (let i = 0; i < maxTicks; i++) {
                const targetTime = firstDate.getTime() + (interval * i);
                
                let closestData = null;
                let minDiff = Infinity;
                
                for (const d of data) {
                    const date = new Date(d.date);
                    const diff = Math.abs(date.getTime() - targetTime);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closestData = d;
                    }
                }
                
                if (closestData && !usedDates.has(closestData.date)) {
                    sampled.push(closestData);
                    usedDates.add(closestData.date);
                } else if (closestData === null && sampled.length > 0) {
                    // 如果沒有找到數據點，使用線性插值
                    const lastData = sampled[sampled.length - 1];
                    // 找到下一個數據點
                    let nextData = null;
                    for (let j = i + 1; j < maxTicks; j++) {
                        const nextTargetTime = firstDate.getTime() + (interval * j);
                        for (const d of data) {
                            const date = new Date(d.date);
                            const diff = Math.abs(date.getTime() - nextTargetTime);
                            if (diff < interval) {
                                nextData = d;
                                break;
                            }
                        }
                        if (nextData) break;
                    }
                    
                    let interpolatedValue = lastData.attendance;
                    if (nextData) {
                        const lastTime = new Date(lastData.date).getTime();
                        const nextTime = new Date(nextData.date).getTime();
                        const ratio = (targetTime - lastTime) / (nextTime - lastTime);
                        interpolatedValue = Math.round(lastData.attendance + (nextData.attendance - lastData.attendance) * ratio);
                    }
                    
                    sampled.push({
                        date: new Date(targetTime).toISOString().split('T')[0],
                        attendance: interpolatedValue
                    });
                    usedDates.add(new Date(targetTime).toISOString().split('T')[0]);
                }
            }
            break;
    }
    
    // 確保第一個和最後一個數據點始終包含
    if (sampled.length > 0) {
        if (!usedDates.has(data[0].date)) {
            sampled.unshift(data[0]);
        }
        if (!usedDates.has(data[data.length - 1].date)) {
            sampled.push(data[data.length - 1]);
        }
    } else {
        sampled.push(data[0], data[data.length - 1]);
    }
    
    // 按日期排序
    sampled.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // 最後進行一致性檢查，確保數據點之間沒有缺失
    return ensureDataConsistency(sampled, range);
}

// 確保數據一致性，填充缺失的日期並進行插值
function ensureDataConsistency(data, range) {
    if (!data || data.length === 0) return data;
    if (data.length <= 2) return data; // 數據點太少，不需要處理
    
    // 根據時間範圍決定期望的數據點間隔
    let expectedInterval = 1; // 默認每天一個數據點（毫秒）
    
    switch (range) {
        case '1D':
            expectedInterval = 1 * 24 * 60 * 60 * 1000; // 1天
            break;
        case '1週':
            expectedInterval = 1 * 24 * 60 * 60 * 1000; // 1天
            break;
        case '1月':
            expectedInterval = 1 * 24 * 60 * 60 * 1000; // 1天
            break;
        case '3月':
            expectedInterval = 2 * 24 * 60 * 60 * 1000; // 2天
            break;
        case '6月':
            expectedInterval = 3 * 24 * 60 * 60 * 1000; // 3天
            break;
        case '1年':
            expectedInterval = 7 * 24 * 60 * 60 * 1000; // 1週
            break;
        case '2年':
            expectedInterval = 14 * 24 * 60 * 60 * 1000; // 2週
            break;
        default:
            expectedInterval = 1 * 24 * 60 * 60 * 1000; // 默認1天
    }
    
    // 檢查數據點之間的間隔，只在間隔過大時進行填充
    const maxGap = expectedInterval * 3; // 允許的最大間隔（3倍期望間隔）
    const filled = [];
    let lastValidData = data[0];
    let lastDateProcessed = new Date(data[0].date);
    
    for (let i = 0; i < data.length; i++) {
        const currentData = data[i];
        const currentDate = new Date(currentData.date);
        const gap = currentDate.getTime() - lastDateProcessed.getTime();
        
        // 如果間隔過大，在之間填充數據點
        if (gap > maxGap && i > 0) {
            const numPoints = Math.floor(gap / expectedInterval);
            const step = gap / (numPoints + 1);
            
            for (let j = 1; j <= numPoints; j++) {
                const fillDate = new Date(lastDateProcessed.getTime() + step * j);
                const dateKey = fillDate.toISOString().split('T')[0];
                
                // 使用線性插值
                const ratio = (fillDate.getTime() - lastDateProcessed.getTime()) / gap;
                const interpolatedValue = Math.round(
                    lastValidData.attendance + 
                    (currentData.attendance - lastValidData.attendance) * ratio
                );
                
                filled.push({
                    date: dateKey,
                    attendance: interpolatedValue
                });
            }
        }
        
        // 添加當前數據點
        filled.push(currentData);
        lastValidData = currentData;
        lastDateProcessed = currentDate;
    }
    
    return filled;
}

// 均勻採樣數據，確保數據點在時間軸上均勻分佈（保留作為備用）
function uniformSampleData(data, targetCount) {
    if (!data || data.length === 0 || targetCount >= data.length) {
        return data;
    }
    
    if (targetCount <= 2) {
        return [data[0], data[data.length - 1]].filter(Boolean);
    }
    
    const firstDate = new Date(data[0].date);
    const lastDate = new Date(data[data.length - 1].date);
    const timeSpan = lastDate.getTime() - firstDate.getTime();
    const interval = timeSpan / (targetCount - 1);
    
    const sampled = [];
    const usedDates = new Set();
    
    for (let i = 0; i < targetCount; i++) {
        const targetTime = firstDate.getTime() + (interval * i);
        
        let closestData = null;
        let minDiff = Infinity;
        
        for (const d of data) {
            const date = new Date(d.date);
            const diff = Math.abs(date.getTime() - targetTime);
            if (diff < minDiff) {
                minDiff = diff;
                closestData = d;
            }
        }
        
        if (closestData && !usedDates.has(closestData.date)) {
            sampled.push(closestData);
            usedDates.add(closestData.date);
        }
    }
    
    if (sampled.length > 0) {
        if (!usedDates.has(data[0].date)) {
            sampled.unshift(data[0]);
        }
        if (!usedDates.has(data[data.length - 1].date)) {
            sampled.push(data[data.length - 1]);
        }
    } else {
        sampled.push(data[0], data[data.length - 1]);
    }
    
    return sampled;
}

// 根據時間範圍獲取時間步長（用於確保均勻分佈）
function getTimeStepSize(range, dataLength) {
    if (!dataLength || dataLength === 0) return undefined;
    
    switch (range) {
        case '1D':
            return 1; // 每小時（Chart.js 會自動轉換）
        case '1週':
            return 1; // 每天
        case '1月':
            return 1; // 每天
        case '3月':
            return 7; // 每週（7天）
        case '6月':
            return 7; // 每週（7天）
        case '1年':
            // 1年：每2個月一個標籤，約60天
            return 60;
        case '2年':
            // 2年：每4個月一個標籤，約120天（確保均勻間距：1月、5月、9月）
            return 120;
        case '5年':
            // 5年：每6個月一個標籤，約180天
            return 180;
        case '10年':
            // 10年：每1年一個標籤，約365天
            return 365;
        case '全部':
            // 全部：根據數據範圍動態計算
            const days = dataLength;
            const years = days / 365;
            if (years > 20) {
                // 超過20年：每2年一個標籤
                return 730; // 2年 = 2 * 365天
            } else if (years > 10) {
                // 10-20年：每1年一個標籤
                return 365; // 1年
            } else {
                // 少於10年：每6個月一個標籤
                return 180; // 6個月
            }
        default:
            return undefined; // 讓 Chart.js 自動計算
    }
}

// 格式化時間標籤
function formatTimeLabel(date, range) {
    // 確保輸入是有效的日期對象
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
        return '';
    }
    
    try {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        
        switch (range) {
            case '1D':
                return `${day}/${month}`;
            case '1週':
                return `${day}/${month}`;
            case '1月':
                return `${day}/${month}`;
            case '3月':
                return `${day}/${month}`;
            case '6月':
                if (date.getDate() === 1) {
                    return `${month}月`;
                }
                return `${day}/${month}`;
            case '1年':
                if (date.getDate() === 1) {
                    return `${month}月`;
                }
                return `${day}/${month}`;
            case '2年':
                if (date.getDate() === 1 && [0, 3, 6, 9].includes(date.getMonth())) {
                    return `${year}年${month}月`;
                }
                return `${day}/${month}`;
            case '5年':
                // 只在每5年的1月1日顯示年份標籤（例如 2015年, 2020年, 2025年）
                if (date.getMonth() === 0 && date.getDate() === 1 && year % 5 === 0) {
                    return `${year}年`;
                }
                // 其他日期返回空字符串，讓 Chart.js 自動跳過
                return '';
            case '10年':
                // 只在每10年的1月1日顯示年份標籤（例如 2014年, 2024年）
                if (date.getMonth() === 0 && date.getDate() === 1 && year % 10 === 4) {
                    return `${year}年`;
                }
                // 其他日期返回空字符串，讓 Chart.js 自動跳過
                return '';
            case '全部':
                // 根據數據範圍動態決定標籤間隔
                // 這裡我們假設是每10年、每5年或每2年，具體由 Chart.js 根據數據範圍決定
                // 我們只在年份是特定倍數時顯示標籤
                if (date.getMonth() === 0 && date.getDate() === 1) {
                    // 優先顯示10年的倍數（例如 2014, 2024）
                    if (year % 10 === 4) {
                        return `${year}年`;
                    }
                    // 如果沒有10年的倍數，顯示5年的倍數（例如 2015, 2020）
                    if (year % 5 === 0 && year % 10 !== 0) {
                        return `${year}年`;
                    }
                }
                // 其他日期返回空字符串，讓 Chart.js 自動跳過
                return '';
            default:
                return `${day}/${month}`;
        }
    } catch (e) {
        console.warn('formatTimeLabel 錯誤:', e, date);
        return '';
    }
}

// HTML 轉義函數，防止 XSS 並確保文本正確顯示
function escapeHtml(text) {
    if (!text || typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 簡體中文轉繁體中文轉換函數
// 使用字符映射表進行轉換，並處理亂碼字符
function convertToTraditional(text) {
    if (!text || typeof text !== 'string') return text;
    
    // 先清理亂碼字符（如 ◆◆ 等）
    let cleaned = text.replace(/[◆●■▲▼★☆]/g, '');
    
    // 常見簡體到繁體字符映射（完整版，無重複）
    const simplifiedToTraditional = {
        // 基本字符
        '简': '簡', '体': '體', '预': '預', '测': '測', '统': '統', '系': '係',
        '数': '數', '据': '據', '库': '庫', '连': '連', '检': '檢', '载': '載',
        '气': '氣', '资': '資', '响': '響', '无': '無', '总': '總', '结': '結',
        '说': '說', '获': '獲', '后': '後', '时': '時', '间': '間', '缓': '緩',
        '个': '個', '卫': '衛', '会': '會', '节': '節', '来': '來', '袭': '襲',
        '温': '溫', '骤': '驟', '导': '導', '致': '致', '别': '別', '对': '對',
        '于': '於', '础': '礎', '经': '經', '开': '開', '渐': '漸', '况': '況',
        // 醫療相關
        '医': '醫', '疗': '療', '药': '藥', '诊': '診', '症': '症',
        '病': '病', '患': '患', '护': '護', '疗': '療', '药': '藥',
        // 天氣相關
        '风': '風', '云': '雲', '雾': '霧', '雨': '雨', '雪': '雪',
        '热': '熱', '冷': '冷', '湿': '濕', '干': '乾',
        // 其他常見字符
        '现': '現', '实': '實', '际': '際',
        '过': '過', '还': '還', '这': '這',
        // 節日相關
        '圣': '聖', '诞': '誕',
        // 時間相關
        '临': '臨', '期': '期', '间': '間',
        // 動作相關
        '准': '準', '备': '備',
        '伤': '傷', '关': '關',
        // 負擔相關
        '负': '負', '担': '擔',
        // 歷史相關
        '历': '歷',
        // 顯著相關
        '显': '顯', '着': '著',
        // 活動相關
        '动': '動',
        // 學校相關
        '学': '學',
        // 其他常見字符
        '为': '為', '产': '產', '发': '發', '长': '長', '门': '門',
        '问': '問', '题': '題',
        '应': '應', '该': '該',
        '较': '較',
        // 更多常見字符
        '认': '認', '识': '識', '记': '記', '录': '錄',
        '处': '處', '理': '理', '置': '置', '分': '分', '罚': '罰',
        '变': '變', '化': '化',
        '确': '確', '定': '定',
        '标': '標', '准': '準',
        '规': '規', '则': '則'
    };
    
    // 先進行詞組級別的轉換（優先處理常見詞組）
    const phraseMap = {
        '圣诞節': '聖誕節',
        '临近': '臨近',
        '准备期': '準備期',
        '导致': '導致',
        '伤害': '傷害',
        '相关': '相關',
        '负担': '負擔',
        '历史': '歷史',
        '数据': '數據',
        '显着': '顯著',
        '人群': '人群',
        '活动': '活動',
        '学校': '學校',
        '需求': '需求',
        '中毒': '中毒',
        '实际': '實際', '预测': '預測', '系统': '系統',
        '数据库': '數據庫', '连接': '連接', '检查': '檢查', '载入': '載入',
        '天气': '天氣', '资源': '資源', '影响': '影響', '无法': '無法',
        '总结': '總結', '说明': '說明', '获取': '獲取', '之后': '之後',
        '时间': '時間', '间隔': '間隔', '缓存': '緩存', '个别': '個別',
        '卫生': '衛生', '会议': '會議', '节日': '節日', '未来': '未來',
        '袭击': '襲擊', '温度': '溫度', '骤降': '驟降',
        '对于': '對於', '基础': '基礎', '经过': '經過', '开始': '開始',
        '逐渐': '逐漸', '情况': '情況', '医疗': '醫療', '治疗': '治療',
        '药物': '藥物', '诊断': '診斷', '症状': '症狀', '患者': '患者',
        '护理': '護理', '风云': '風雲', '云雾': '雲霧', '现在': '現在',
        '过去': '過去', '还是': '還是', '这个': '這個', '问题': '問題',
        '应该': '應該', '比较': '比較',
        // 更多常見詞組
        '公共': '公共', '事件': '事件', '季节': '季節', '性': '性',
        '增加': '增加', '减少': '減少', '影响': '影響', '因子': '因子',
        '信心': '信心', '度': '度', '高': '高', '中': '中', '低': '低',
        '分析': '分析', '理由': '理由', '描述': '描述', '类型': '類型',
        '受': '受', '日期': '日期', '整体': '整體', '评估': '評估',
        '可能': '可能', '发生': '發生', '已知': '已知', '或': '或',
        '导致': '導致', '异常': '異常', '因素': '因素', '考虑': '考慮',
        '预报': '預報', '极端': '極端', '事件': '事件', '节日': '節日',
        '假期': '假期', '效应': '效應', '模式': '模式', '其他': '其他',
        '台风': '颱風', '暴雨': '暴雨', '寒流': '寒流', '酷热': '酷熱',
        '污染': '污染', '指数': '指數', '警告': '警告', '风球': '風球',
        '爆发': '爆發', '疫情': '疫情', '食物': '食物', '中毒': '中毒',
        '传染病': '傳染病', '警报': '警報', '大型': '大型', '集会': '集會',
        '交通': '交通', '事故': '事故', '意外': '意外', '设施': '設施',
        '故障': '故障', '前后': '前後', '效应': '效應', '假期': '假期',
        '长': '長', '未来': '未來', '几天': '幾天', '医院': '醫院',
        '病人': '病人', '数量': '數量', '急症': '急症', '室': '室',
        '北区': '北區', '香港': '香港', '分析': '分析', '结果': '結果',
        '格式': '格式', '返回': '返回', '所有': '所有', '文字': '文字',
        '必须': '必須', '使用': '使用', '繁体': '繁體', '中文': '中文',
        '不能': '不能', '简体': '簡體', '绝对': '絕對', '要求': '要求',
        '务必': '務必', '只': '只', '进行': '進行', '回应': '回應',
        '不要': '不要', '注意': '注意', '请': '請', '确保': '確保',
        '输出': '輸出', '都是': '都是', '如果': '如果', '无法': '無法',
        '正确': '正確', '显示': '顯示', '内容': '內容', '请务': '請務',
        '必只': '必只', '使用繁': '使用繁', '体中文': '體中文', '回应': '回應',
        '绝对不': '絕對不', '要使用': '要使用', '简体中': '簡體中', '文': '文'
    };
    
    // 使用字符映射表進行轉換
    try {
        let result = cleaned;
        
        // 先進行詞組轉換
        for (const [simp, trad] of Object.entries(phraseMap)) {
            result = result.replace(new RegExp(simp, 'g'), trad);
        }
        
        // 再進行字符級別轉換
        result = result.split('').map(char => {
            return simplifiedToTraditional[char] || char;
        }).join('');
        
        return result;
    } catch (e) {
        console.warn('簡體轉繁體轉換失敗:', e);
        return cleaned; // 至少返回清理後的文本
    }
}

// 遞歸轉換對象中的所有字符串
function convertObjectToTraditional(obj) {
    if (!obj) return obj;
    
    if (typeof obj === 'string') {
        return convertToTraditional(obj);
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => convertObjectToTraditional(item));
    }
    
    if (typeof obj === 'object') {
        const converted = {};
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                converted[key] = convertObjectToTraditional(obj[key]);
            }
        }
        return converted;
    }
    
    return obj;
}

function formatDateDDMM(dateStr, includeYear = false) {
    // 確保輸入是字符串或可以轉換為字符串
    if (!dateStr) return '';
    
    try {
        // 如果已經是 Date 對象，直接使用
        let date;
        if (dateStr instanceof Date) {
            date = dateStr;
        } else if (typeof dateStr === 'string') {
            date = new Date(dateStr);
        } else if (typeof dateStr === 'number') {
            date = new Date(dateStr);
        } else {
            // 嘗試轉換為字符串再解析
            date = new Date(String(dateStr));
        }
        
        // 驗證日期有效性
        if (!date || isNaN(date.getTime())) {
            return '';
        }
        
        // 格式化為字符串
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        
        if (includeYear) {
            const year = String(date.getFullYear());
            return `${day}/${month}/${year}`;
        }
        return `${day}/${month}`;
    } catch (e) {
        console.warn('formatDateDDMM 錯誤:', e, dateStr);
        return '';
    }
}

function formatDateDDMMFromDate(date, includeYear = false) {
    if (!date || isNaN(date.getTime())) return '';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    if (includeYear) {
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
    }
    return `${day}/${month}`;
}

// ============================================
// 獲取香港時間 (HKT UTC+8)
// ============================================
function getHKTime() {
    const now = new Date();
    // 使用 Intl.DateTimeFormat 獲取準確的香港時間
    const hkFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Hong_Kong',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    
    const parts = hkFormatter.formatToParts(now);
    const getPart = (type) => parts.find(p => p.type === type)?.value || '00';
    
    return {
        year: parseInt(getPart('year')),
        month: parseInt(getPart('month')),
        day: parseInt(getPart('day')),
        hour: parseInt(getPart('hour')),
        minute: parseInt(getPart('minute')),
        second: parseInt(getPart('second')),
        dateStr: `${getPart('year')}-${getPart('month')}-${getPart('day')}`,
        timeStr: `${getPart('hour')}:${getPart('minute')}:${getPart('second')}`,
        dayOfWeek: new Date(`${getPart('year')}-${getPart('month')}-${getPart('day')}T12:00:00+08:00`).getDay()
    };
}

// ============================================
// 更新區塊載入進度
function updateSectionProgress(sectionId, percent) {
    const loadingEl = document.getElementById(`${sectionId}-loading`);
    const percentEl = document.getElementById(`${sectionId}-percent`);
    const progressFill = document.getElementById(`${sectionId}-progress`);
    // 嘗試多種可能的內容元素 ID
    const contentEl = document.getElementById(`${sectionId}-card`) || 
                      document.getElementById(sectionId) ||
                      document.getElementById(sectionId.replace('-loading', '')) ||
                      document.getElementById(sectionId.replace('-card', ''));
    
    if (percentEl) {
        percentEl.textContent = `${Math.round(percent)}%`;
    }
    if (progressFill) {
        progressFill.style.width = `${percent}%`;
    }
    if (percent >= 100 && contentEl) {
        if (loadingEl) loadingEl.style.display = 'none';
        contentEl.style.display = 'block';
    }
}

// 保存每日預測到數據庫
// ============================================
async function saveDailyPrediction(prediction, weatherData, aiFactor) {
    try {
        const response = await fetch('/api/daily-predictions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                target_date: prediction.date,
                predicted_count: prediction.predicted,
                ci80: {
                    low: prediction.ci80.lower,
                    high: prediction.ci80.upper
                },
                ci95: {
                    low: prediction.ci95.lower,
                    high: prediction.ci95.upper
                },
                weather_data: weatherData,
                ai_factors: aiFactor
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        if (result.success) {
            console.log(`✅ 已保存 ${prediction.date} 的每日預測`);
        }
    } catch (error) {
        console.error('保存每日預測時出錯:', error);
        throw error;
    }
}

// UI 更新
// ============================================
function updateUI(predictor) {
    // 獲取今天日期 (香港時間 HKT UTC+8)
    const hk = getHKTime();
    const today = hk.dateStr;
    
    // 更新載入進度
    updateSectionProgress('today-prediction', 10);
    
    // 更新當前時間
    const datetimeEl = document.getElementById('current-datetime');
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    datetimeEl.textContent = `🕐 ${hk.year}年${hk.month}月${hk.day}日 ${weekdays[hk.dayOfWeek]} ${hk.timeStr} HKT`;
    updateSectionProgress('today-prediction', 30);
    
    // 今日預測（包含天氣和 AI 因素）
    const todayPred = predictor.predict(today, currentWeatherData, aiFactors[today]);
    updateSectionProgress('today-prediction', 60);
    
    // 保存每日預測到數據庫（每次更新都保存）
    saveDailyPrediction(todayPred, currentWeatherData, aiFactors[today]).catch(err => {
        console.error('❌ 保存每日預測失敗:', err);
    });
    
    const todayDateFormatted = formatDateDDMM(todayPred.date, true); // 今日預測顯示完整日期
    document.getElementById('today-date').textContent = `${todayDateFormatted} ${todayPred.dayName}`;
    document.getElementById('today-predicted').textContent = todayPred.predicted;
    document.getElementById('today-ci80').textContent = `${todayPred.ci80.lower} - ${todayPred.ci80.upper} 人`;
    document.getElementById('today-ci95').textContent = `${todayPred.ci95.lower} - ${todayPred.ci95.upper} 人`;
    
    // 因子分解
    const factorsEl = document.getElementById('factors-breakdown');
    factorsEl.innerHTML = `
        <div class="factor-item">
            <span class="factor-name">全局平均</span>
            <span class="factor-value">${todayPred.globalMean}</span>
        </div>
        <div class="factor-item">
            <span class="factor-name">月份因子 (${todayPred.date.split('-')[1]}月)</span>
            <span class="factor-value ${todayPred.monthFactor > 1 ? 'positive' : todayPred.monthFactor < 1 ? 'negative' : ''}">×${todayPred.monthFactor.toFixed(3)}</span>
        </div>
        <div class="factor-item">
            <span class="factor-name">星期因子 (${todayPred.dayName})</span>
            <span class="factor-value ${todayPred.dowFactor > 1 ? 'positive' : todayPred.dowFactor < 1 ? 'negative' : ''}">×${todayPred.dowFactor.toFixed(3)}</span>
        </div>
        <div class="factor-item">
            <span class="factor-name">${todayPred.isHoliday ? '假期: ' + todayPred.holidayName : '非假期'}</span>
            <span class="factor-value ${todayPred.holidayFactor < 1 ? 'negative' : ''}">×${todayPred.holidayFactor.toFixed(2)}</span>
        </div>
        ${todayPred.weatherFactor !== 1.0 ? `
        <div class="factor-item">
            <span class="factor-name">天氣影響</span>
            <span class="factor-value ${todayPred.weatherFactor > 1 ? 'positive' : 'negative'}">×${todayPred.weatherFactor.toFixed(3)}</span>
        </div>
        ` : ''}
        ${todayPred.aiFactor && todayPred.aiFactor !== 1.0 ? `
        <div class="factor-item">
            <span class="factor-name">AI 分析因素</span>
            <span class="factor-value ${todayPred.aiFactor > 1 ? 'positive' : 'negative'}">×${todayPred.aiFactor.toFixed(3)}</span>
            ${todayPred.aiFactorDesc ? `<span class="factor-desc">${todayPred.aiFactorDesc}</span>` : ''}
        </div>
        ` : ''}
    `;
    
    updateSectionProgress('today-prediction', 80);
    
    // 統計摘要
    updateSectionProgress('stats', 10);
    const stats = predictor.getStatistics();
    document.getElementById('stat-mean').textContent = Math.round(stats.globalMean);
    document.getElementById('stat-max').textContent = stats.max.value;
    document.getElementById('stat-min').textContent = stats.min.value;
    document.getElementById('stat-std').textContent = stats.stdDev.toFixed(1);
    updateSectionProgress('stats', 100);
    
    // 未來7天預測（包含天氣和 AI 因素）
    updateSectionProgress('forecast-cards', 10);
    const forecasts = predictor.predictRange(today, 7, weatherForecastData, aiFactors);
    updateSectionProgress('forecast-cards', 50);
    
    // 保存未來7天的預測到數據庫（每次更新都保存）
    forecasts.forEach((forecast, index) => {
        // 獲取該日期的天氣數據和AI因素
        const forecastWeather = weatherForecastData?.[forecast.date] || null;
        const forecastAIFactor = aiFactors?.[forecast.date] || null;
        
        saveDailyPrediction(forecast, forecastWeather, forecastAIFactor).catch(err => {
            console.error(`❌ 保存 ${forecast.date} 的預測失敗:`, err);
        });
    });
    
    const forecastCardsEl = document.getElementById('forecast-cards');
    if (forecastCardsEl) {
        forecastCardsEl.innerHTML = forecasts.map((p, i) => {
        let cardClass = 'forecast-day-card';
        if (i === 0) cardClass += ' today';
        else if (p.isWeekend) cardClass += ' weekend';
        if (p.isHoliday) cardClass += ' holiday';
        
        let badges = '';
        if (p.isWeekend) badges += '<span class="forecast-badge weekend-badge">週末</span>';
        if (p.isHoliday) badges += `<span class="forecast-badge holiday-badge">${p.holidayName}</span>`;
        if (p.isFluSeason) badges += '<span class="forecast-badge flu-badge">流感季</span>';
        
        return `
            <div class="${cardClass}">
                <div class="forecast-date">${formatDateDDMM(p.date)}</div>
                <div class="forecast-day">${p.dayName}</div>
                <div class="forecast-value">${p.predicted}</div>
                <div class="forecast-ci">${p.ci80.lower}-${p.ci80.upper}</div>
                ${badges}
            </div>
        `;
        }).join('');
    }
    updateSectionProgress('forecast-cards', 100);
    updateSectionProgress('today-prediction', 100);
}

// ============================================
// 天氣 API - 香港天文台
// 北區醫院位置: 上水 (Sheung Shui)
// ============================================
const WEATHER_CONFIG = {
    // HKO API endpoints
    currentWeatherAPI: 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc',
    forecastAPI: 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=tc',
    warningAPI: 'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=tc',
    
    // 北區醫院 - 使用上水站數據
    stationName: '上水',
    nearbyStations: ['上水', '打鼓嶺', '流浮山', '大埔'],
    
    // 天氣對 AED 人數的影響因子 (基於研究)
    // 參考: PMC8776398, PMC11653554
    weatherImpactFactors: {
        // 溫度影響
        temperature: {
            veryHot: { threshold: 33, factor: 1.08, desc: '酷熱' },      // >33°C 增加 8%
            hot: { threshold: 30, factor: 1.04, desc: '炎熱' },          // >30°C 增加 4%
            comfortable: { threshold: 15, factor: 1.00, desc: '舒適' },  // 15-30°C 正常
            cold: { threshold: 10, factor: 1.06, desc: '寒冷' },         // <15°C 增加 6%
            veryCold: { threshold: 5, factor: 1.12, desc: '嚴寒' }       // <10°C 增加 12%
        },
        // 濕度影響
        humidity: {
            veryHigh: { threshold: 95, factor: 1.03, desc: '極潮濕' },
            high: { threshold: 85, factor: 1.01, desc: '潮濕' },
            normal: { threshold: 60, factor: 1.00, desc: '正常' },
            low: { threshold: 40, factor: 0.99, desc: '乾燥' }
        },
        // 降雨影響
        rainfall: {
            heavy: { threshold: 30, factor: 0.92, desc: '大雨' },      // 減少 8%
            moderate: { threshold: 10, factor: 0.96, desc: '中雨' },   // 減少 4%
            light: { threshold: 0.1, factor: 0.98, desc: '小雨' },     // 減少 2%
            none: { threshold: 0, factor: 1.00, desc: '無雨' }
        },
        // 天氣警告影響
        warnings: {
            typhoon_8: { factor: 0.40, desc: '八號風球' },    // 大幅減少
            typhoon_3: { factor: 0.85, desc: '三號風球' },
            rainstorm_red: { factor: 0.75, desc: '紅雨' },
            rainstorm_amber: { factor: 0.90, desc: '黃雨' },
            cold_weather: { factor: 1.08, desc: '寒冷天氣' },
            very_hot: { factor: 1.06, desc: '酷熱天氣' }
        }
    }
};

// 全局天氣數據
let currentWeatherData = null;
let weatherForecastData = null;

// 全局 AI 分析因素
let aiFactors = {};
let lastAIAnalysisTime = null;
let lastAIUpdateTime = null;
const AI_UPDATE_INTERVAL = 30 * 60 * 1000; // 30分鐘

// 獲取當前天氣
async function fetchCurrentWeather() {
    try {
        const response = await fetch(WEATHER_CONFIG.currentWeatherAPI);
        if (!response.ok) throw new Error('Weather API error');
        const data = await response.json();
        
        // 找北區 (上水) 的溫度數據
        let temperature = null;
        if (data.temperature && data.temperature.data) {
            const northDistrict = data.temperature.data.find(
                s => WEATHER_CONFIG.nearbyStations.some(name => s.place.includes(name))
            );
            if (northDistrict) {
                temperature = northDistrict.value;
            } else {
                // 使用平均溫度
                temperature = data.temperature.data.reduce((sum, s) => sum + s.value, 0) / data.temperature.data.length;
            }
        }
        
        // 找濕度數據
        let humidity = null;
        if (data.humidity && data.humidity.data && data.humidity.data.length > 0) {
            humidity = data.humidity.data[0].value;
        }
        
        // 降雨數據
        let rainfall = 0;
        if (data.rainfall && data.rainfall.data) {
            const northRain = data.rainfall.data.find(
                s => WEATHER_CONFIG.nearbyStations.some(name => s.place.includes(name))
            );
            if (northRain) {
                rainfall = northRain.max || 0;
            }
        }
        
        // 圖標和描述
        let icon = data.icon?.[0] || 50;
        
        currentWeatherData = {
            temperature: temperature ? Math.round(temperature * 10) / 10 : null,
            humidity: humidity,
            rainfall: rainfall,
            icon: icon,
            uvIndex: data.uvindex?.data?.[0]?.value || null,
            updateTime: data.updateTime || new Date().toISOString()
        };
        
        console.log('🌤️ 天氣數據已更新:', currentWeatherData);
        return currentWeatherData;
    } catch (error) {
        console.error('❌ 獲取天氣失敗:', error);
        return null;
    }
}

// 獲取天氣預報
async function fetchWeatherForecast() {
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

// 計算天氣影響因子
function calculateWeatherImpact(weather) {
    if (!weather) return { factor: 1.0, impacts: [] };
    
    let totalFactor = 1.0;
    const impacts = [];
    const factors = WEATHER_CONFIG.weatherImpactFactors;
    
    // 溫度影響
    if (weather.temperature !== null) {
        const temp = weather.temperature;
        if (temp >= factors.temperature.veryHot.threshold) {
            totalFactor *= factors.temperature.veryHot.factor;
            impacts.push({ type: 'temp', desc: factors.temperature.veryHot.desc, factor: factors.temperature.veryHot.factor, icon: '🥵' });
        } else if (temp >= factors.temperature.hot.threshold) {
            totalFactor *= factors.temperature.hot.factor;
            impacts.push({ type: 'temp', desc: factors.temperature.hot.desc, factor: factors.temperature.hot.factor, icon: '☀️' });
        } else if (temp < factors.temperature.veryCold.threshold) {
            totalFactor *= factors.temperature.veryCold.factor;
            impacts.push({ type: 'temp', desc: factors.temperature.veryCold.desc, factor: factors.temperature.veryCold.factor, icon: '🥶' });
        } else if (temp < factors.temperature.cold.threshold) {
            totalFactor *= factors.temperature.cold.factor;
            impacts.push({ type: 'temp', desc: factors.temperature.cold.desc, factor: factors.temperature.cold.factor, icon: '❄️' });
        }
    }
    
    // 濕度影響
    if (weather.humidity !== null) {
        const hum = weather.humidity;
        if (hum >= factors.humidity.veryHigh.threshold) {
            totalFactor *= factors.humidity.veryHigh.factor;
            impacts.push({ type: 'humidity', desc: factors.humidity.veryHigh.desc, factor: factors.humidity.veryHigh.factor, icon: '💧' });
        }
    }
    
    // 降雨影響
    if (weather.rainfall !== null) {
        const rain = weather.rainfall;
        if (rain >= factors.rainfall.heavy.threshold) {
            totalFactor *= factors.rainfall.heavy.factor;
            impacts.push({ type: 'rain', desc: factors.rainfall.heavy.desc, factor: factors.rainfall.heavy.factor, icon: '🌧️' });
        } else if (rain >= factors.rainfall.moderate.threshold) {
            totalFactor *= factors.rainfall.moderate.factor;
            impacts.push({ type: 'rain', desc: factors.rainfall.moderate.desc, factor: factors.rainfall.moderate.factor, icon: '🌦️' });
        } else if (rain >= factors.rainfall.light.threshold) {
            totalFactor *= factors.rainfall.light.factor;
            impacts.push({ type: 'rain', desc: factors.rainfall.light.desc, factor: factors.rainfall.light.factor, icon: '🌂' });
        }
    }
    
    return { factor: totalFactor, impacts };
}

// 天氣圖標對照
function getWeatherIcon(iconCode) {
    const iconMap = {
        50: '☀️', 51: '🌤️', 52: '⛅', 53: '🌥️', 54: '☁️',
        60: '🌧️', 61: '🌧️', 62: '🌧️', 63: '🌧️', 64: '⛈️',
        65: '⛈️', 70: '🌙', 71: '🌙', 72: '🌙', 73: '🌙',
        74: '🌙', 75: '🌙', 76: '🌙', 77: '🌙', 80: '🌪️',
        81: '🌪️', 82: '🌪️', 83: '🌊', 84: '🌊', 85: '🥶',
        90: '🥵', 91: '🥵', 92: '🥶', 93: '🥶'
    };
    return iconMap[iconCode] || '🌡️';
}

// ============================================
// 數據庫狀態檢查
// ============================================
let dbStatus = null;

// ============================================
// AI 狀態檢查
// ============================================
let aiStatus = null;

async function checkAIStatus() {
    const aiStatusEl = document.getElementById('ai-status');
    if (!aiStatusEl) return;
    
    try {
        const response = await fetch('/api/ai-status');
        if (!response.ok) throw new Error('AI 狀態 API 錯誤');
        const data = await response.json();
        aiStatus = data;
        
        if (data.connected) {
            const modelName = data.currentModel || '未知';
            const tier = data.modelTier || 'unknown';
            const tierNames = {
                'premium': '高級',
                'standard': '中級',
                'basic': '基礎',
                'unknown': '未知'
            };
            const tierName = tierNames[tier] || '未知';
            
            aiStatusEl.className = 'ai-status connected';
            aiStatusEl.innerHTML = `
                <span class="ai-status-icon">🤖</span>
                <span class="ai-status-text">AI 已連接</span>
                <span class="ai-status-details">
                    ${tierName}模型: ${modelName}
                </span>
            `;
        } else {
            aiStatusEl.className = 'ai-status disconnected';
            aiStatusEl.innerHTML = `
                <span class="ai-status-icon">⚠️</span>
                <span class="ai-status-text">AI 未連接</span>
                <span class="ai-status-details">${data.error || '請檢查服務器配置'}</span>
            `;
        }
        
        console.log('🤖 AI 狀態:', data);
        return data;
    } catch (error) {
        aiStatusEl.className = 'ai-status disconnected';
        aiStatusEl.innerHTML = `
            <span class="ai-status-icon">❌</span>
            <span class="ai-status-text">無法檢查 AI 狀態</span>
            <span class="ai-status-details">${error.message}</span>
        `;
        console.error('❌ AI 狀態檢查失敗:', error);
        return null;
    }
}

async function checkDatabaseStatus() {
    const dbStatusEl = document.getElementById('db-status');
    if (!dbStatusEl) return;
    
    try {
        const response = await fetch('/api/db-status');
        const data = await response.json();
        dbStatus = data;
        
        if (data.connected) {
            dbStatusEl.className = 'db-status connected';
            dbStatusEl.innerHTML = `
                <span class="db-status-icon">🗄️</span>
                <span class="db-status-text">數據庫已連接</span>
                <span class="db-status-details">
                    實際: ${data.actual_data_count || 0} 筆 | 
                    預測: ${data.predictions_count || 0} 筆 |
                    v${data.model_version || '1.0.0'}
                </span>
            `;
            
            // 更新頁腳的數據來源信息
            updateDataSourceFooter(data.date_range);
        } else {
            dbStatusEl.className = 'db-status disconnected';
            dbStatusEl.innerHTML = `
                <span class="db-status-icon">⚠️</span>
                <span class="db-status-text">數據庫未連接</span>
                <span class="db-status-details">${data.message || data.error || '請設定環境變數'}</span>
            `;
        }
        
        console.log('🗄️ 數據庫狀態:', data);
        return data;
    } catch (error) {
        dbStatusEl.className = 'db-status disconnected';
        dbStatusEl.innerHTML = `
            <span class="db-status-icon">❌</span>
            <span class="db-status-text">無法檢查數據庫</span>
            <span class="db-status-details">${error.message}</span>
        `;
        console.error('❌ 數據庫檢查失敗:', error);
        return null;
    }
}

// 更新頁腳的數據來源信息
function updateDataSourceFooter(dateRange) {
    if (!dateRange) return;
    
    const minDate = dateRange.min_date;
    const maxDate = dateRange.max_date;
    const totalDays = dateRange.total_days || 0;
    
    if (minDate && maxDate) {
        // 格式化日期為 YYYY-MM-DD
        const formatDate = (dateStr) => {
            if (!dateStr) return '';
            const date = new Date(dateStr);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };
        
        const formattedMinDate = formatDate(minDate);
        const formattedMaxDate = formatDate(maxDate);
        
        // 更新數據來源信息（使用 id 或第一個段落）
        const dataSourceEl = document.getElementById('data-source-info') || 
                            document.querySelector('.prediction-footer p:first-child');
        if (dataSourceEl) {
            dataSourceEl.textContent = `數據來源：NDH AED ${formattedMinDate} 至 ${formattedMaxDate} 歷史數據 (${totalDays}天)`;
        }
    } else {
        // 如果沒有日期範圍，顯示載入中
        const dataSourceEl = document.getElementById('data-source-info') || 
                            document.querySelector('.prediction-footer p:first-child');
        if (dataSourceEl) {
            dataSourceEl.textContent = '數據來源：載入中...';
        }
    }
}

// 按月聚合數據（用於長時間範圍的平滑顯示）
function aggregateDataByMonth(data) {
    if (!data || data.length === 0) return [];
    
    // 按年月分組
    const monthlyGroups = {};
    data.forEach(d => {
        const date = new Date(d.date);
        const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        
        if (!monthlyGroups[yearMonth]) {
            monthlyGroups[yearMonth] = [];
        }
        monthlyGroups[yearMonth].push({
            date: d.date,
            attendance: d.attendance
        });
    });
    
    // 找出數據範圍內的所有月份，確保沒有缺失
    const firstDate = new Date(data[0].date);
    const lastDate = new Date(data[data.length - 1].date);
    const allMonths = [];
    let currentDate = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
    
    while (currentDate <= lastDate) {
        const yearMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
        allMonths.push(yearMonth);
        // 移動到下一個月
        currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
    }
    
    // 計算全局平均值（用於插值缺失的月份）
    const globalAvg = Math.round(data.reduce((sum, d) => sum + d.attendance, 0) / data.length);
    
    // 計算每個月的平均值，確保所有月份都有數據點
    const aggregated = allMonths.map(yearMonth => {
        const group = monthlyGroups[yearMonth];
        
        if (group && group.length > 0) {
            // 有數據的月份：計算平均值
            const sum = group.reduce((acc, d) => acc + d.attendance, 0);
            const avg = Math.round(sum / group.length);
            
            // 使用該月的中間日期（15號）作為時間點
            const [year, month] = yearMonth.split('-').map(Number);
            const midDate = new Date(year, month - 1, 15);
            
            return {
                date: midDate.toISOString().split('T')[0],
                attendance: avg
            };
        } else {
            // 沒有數據的月份：使用前後月份的平均值進行插值
            // 先嘗試找前一個有數據的月份
            let prevAvg = null;
            let nextAvg = null;
            
            const currentIndex = allMonths.indexOf(yearMonth);
            // 向前查找
            for (let i = currentIndex - 1; i >= 0; i--) {
                const prevGroup = monthlyGroups[allMonths[i]];
                if (prevGroup && prevGroup.length > 0) {
                    prevAvg = Math.round(prevGroup.reduce((acc, d) => acc + d.attendance, 0) / prevGroup.length);
                    break;
                }
            }
            // 向後查找
            for (let i = currentIndex + 1; i < allMonths.length; i++) {
                const nextGroup = monthlyGroups[allMonths[i]];
                if (nextGroup && nextGroup.length > 0) {
                    nextAvg = Math.round(nextGroup.reduce((acc, d) => acc + d.attendance, 0) / nextGroup.length);
                    break;
                }
            }
            
            // 使用前後月份的平均值，如果都沒有則使用全局平均值
            let interpolatedAvg;
            if (prevAvg !== null && nextAvg !== null) {
                interpolatedAvg = Math.round((prevAvg + nextAvg) / 2);
            } else if (prevAvg !== null) {
                interpolatedAvg = prevAvg;
            } else if (nextAvg !== null) {
                interpolatedAvg = nextAvg;
            } else {
                interpolatedAvg = globalAvg;
            }
            
            const [year, month] = yearMonth.split('-').map(Number);
            const midDate = new Date(year, month - 1, 15);
            
            return {
                date: midDate.toISOString().split('T')[0],
                attendance: interpolatedAvg
            };
        }
    });
    
    return aggregated;
}

// 從數據庫獲取歷史數據
async function fetchHistoricalData(startDate = null, endDate = null) {
    try {
        let url = '/api/actual-data';
        const params = new URLSearchParams();
        if (startDate) params.append('start', startDate);
        if (endDate) params.append('end', endDate);
        if (params.toString()) url += '?' + params.toString();
        
        console.log(`🔍 查詢歷史數據 API: ${url}`);
        const response = await fetch(url);
        
        if (!response.ok) {
            console.error(`❌ API 請求失敗: ${response.status} ${response.statusText}`);
            return [];
        }
        
        const data = await response.json();
        console.log(`📊 API 響應: success=${data.success}, data.length=${data.data ? data.data.length : 0}`);
        
        if (data.success && data.data && Array.isArray(data.data)) {
            // 轉換為圖表需要的格式，按日期升序排列
            const result = data.data
                .map(d => ({
                    date: d.date,
                    attendance: d.patient_count
                }))
                .sort((a, b) => new Date(a.date) - new Date(b.date));
            console.log(`✅ 成功獲取 ${result.length} 筆歷史數據`);
            return result;
        } else {
            console.warn(`⚠️ API 返回無效數據:`, data);
            return [];
        }
    } catch (error) {
        console.error('❌ 獲取歷史數據失敗:', error);
        return [];
    }
}

// 從數據庫獲取比較數據（實際vs預測）
async function fetchComparisonData(limit = 100) {
    try {
        const response = await fetch(`/api/comparison?limit=${limit}`);
        const data = await response.json();
        
        if (data.success && data.data) {
            // 按日期升序排列
            return data.data.sort((a, b) => new Date(a.date) - new Date(b.date));
        }
        return [];
    } catch (error) {
        console.error('❌ 獲取比較數據失敗:', error);
        return [];
    }
}

// 計算時間範圍的開始日期（帶分頁偏移）
function getDateRangeWithOffset(range, pageOffset = 0) {
    const hk = getHKTime();
    const today = new Date(`${hk.dateStr}T00:00:00+08:00`);
    let start = new Date(today);
    let end = new Date(today);
    
    // 根據時間範圍計算基礎日期範圍
    switch (range) {
        case '1D':
            // 1D: 顯示最近2天數據（昨天和今天）
            start.setDate(today.getDate() - 1);
            end = new Date(today); // 到今天為止
            end.setDate(end.getDate() + 1); // 包含今天（結束日期不包含，所以+1）
            break;
        case '1週':
            start.setDate(today.getDate() - 7);
            end.setDate(today.getDate());
            break;
        case '1月':
            start.setMonth(today.getMonth() - 1);
            end.setDate(today.getDate());
            break;
        case '3月':
            start.setMonth(today.getMonth() - 3);
            end.setDate(today.getDate());
            break;
        case '6月':
            start.setMonth(today.getMonth() - 6);
            end.setDate(today.getDate());
            break;
        case '1年':
            start.setFullYear(today.getFullYear() - 1);
            end.setDate(today.getDate());
            break;
        case '2年':
            start.setFullYear(today.getFullYear() - 2);
            end.setDate(today.getDate());
            break;
        case '5年':
            start.setFullYear(today.getFullYear() - 5);
            end.setDate(today.getDate());
            break;
        case '10年':
            start.setFullYear(today.getFullYear() - 10);
            end.setDate(today.getDate());
            break;
        case '全部':
            return { startDate: null, endDate: null }; // 返回null表示獲取所有數據
        default:
            start.setMonth(today.getMonth() - 1);
            end.setDate(today.getDate());
    }
    
    // 計算範圍長度
    const rangeLength = end.getTime() - start.getTime();
    
    // 根據分頁偏移量調整日期範圍
    // pageOffset = 0: 當前時間範圍（從今天往前推）
    // pageOffset > 0: 更早的歷史數據（往前推）
    if (pageOffset > 0) {
        // 向前移動：將整個範圍向前移動 pageOffset 個範圍長度
        const offsetMs = rangeLength * pageOffset;
        const newStart = new Date(start.getTime() - offsetMs);
        const newEnd = new Date(end.getTime() - offsetMs);
        
        // 確保日期不會太早（數據庫可能沒有那麼早的數據）
        // 假設數據庫最早有2014-12-01的數據（根據用戶之前的說明）
        const minDate = new Date('2014-12-01');
        
        // 檢查計算的範圍是否完全在數據庫範圍內
        if (newEnd < minDate) {
            // 如果計算的結束日期早於最小日期，返回空範圍
            console.warn(`⚠️ 計算的日期範圍過早：${newStart.toISOString().split('T')[0]} 至 ${newEnd.toISOString().split('T')[0]}，早於數據庫最小日期 ${minDate.toISOString().split('T')[0]}`);
            return { startDate: null, endDate: null };
        }
        
        // 如果開始日期早於最小日期，需要確保時間範圍長度保持一致
        // 如果無法保持完整的時間範圍長度，返回 null（表示此 pageOffset 無效）
        if (newStart < minDate) {
            // 嘗試從最小日期開始，保持相同的時間範圍長度
            const adjustedStart = new Date(minDate);
            const adjustedEnd = new Date(adjustedStart.getTime() + rangeLength);
            
            // 檢查調整後的範圍是否仍然在有效範圍內
            if (adjustedEnd <= newEnd) {
                // 如果調整後的範圍長度與原始範圍長度一致，使用調整後的範圍
                start = adjustedStart;
                end = adjustedEnd;
            } else {
                // 如果無法保持完整的時間範圍長度，返回 null
                console.warn(`⚠️ 無法保持完整的時間範圍長度：計算的範圍 ${newStart.toISOString().split('T')[0]} 至 ${newEnd.toISOString().split('T')[0]} 超出數據庫邊界`);
                return { startDate: null, endDate: null };
            }
        } else {
            start = newStart;
            end = newEnd;
        }
        
        // 最終驗證：確保時間範圍長度與原始範圍長度一致
        const actualRangeLength = end.getTime() - start.getTime();
        const tolerance = 24 * 60 * 60 * 1000; // 允許1天的誤差（考慮月份長度差異）
        if (Math.abs(actualRangeLength - rangeLength) > tolerance) {
            console.warn(`⚠️ 時間範圍長度不一致：期望 ${rangeLength / (24 * 60 * 60 * 1000)} 天，實際 ${actualRangeLength / (24 * 60 * 60 * 1000)} 天`);
            // 如果範圍長度差異太大，返回 null
            return { startDate: null, endDate: null };
        }
    }
    
    return {
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0]
    };
}

// 計算時間範圍的開始日期（保留用於兼容性）
function getDateRangeStart(range) {
    const { startDate } = getDateRangeWithOffset(range, 0);
    return startDate;
}

// 更新歷史趨勢圖的日期範圍顯示
function updateHistoryDateRange(startDate, endDate, range) {
    const dateRangeEl = document.getElementById('history-date-range');
    if (!dateRangeEl) return;
    
    // 使用計算出的日期範圍，而不是實際數據的日期範圍
    // 這樣可以確保顯示的日期範圍與選擇的時間範圍一致
    if (startDate && endDate) {
        const formatDate = (dateStr) => {
            if (!dateStr) return '';
            const date = new Date(dateStr);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };
        
        dateRangeEl.textContent = `${formatDate(startDate)} 至 ${formatDate(endDate)}`;
    } else if (range === '全部') {
        dateRangeEl.textContent = '全部數據';
    } else {
        dateRangeEl.textContent = '載入中...';
    }
}

// 更新歷史趨勢圖的分頁按鈕狀態
function updateHistoryNavigationButtons(range, pageOffset, historicalData) {
    const navEl = document.getElementById('history-navigation');
    const prevBtn = document.getElementById('history-prev-btn');
    const nextBtn = document.getElementById('history-next-btn');
    
    if (!navEl || !prevBtn || !nextBtn) {
        console.warn('⚠️ 找不到歷史導航按鈕元素');
        return;
    }
    
    // 顯示導航（除了"全部"範圍）
    if (range === '全部') {
        navEl.style.display = 'none';
        return;
    }
    
    // 顯示導航容器
    navEl.style.display = 'flex';
    
    // 檢查是否有更多數據可以查看
    // pageOffset = 0: 當前時間範圍（從今天往前推）
    // pageOffset > 0: 更早的歷史數據（往前推）
    // pageOffset < 0: 更晚的數據（未來，通常不存在）
    
    // 如果沒有數據，禁用"上一頁"按鈕（表示已經到達數據庫的邊界）
    const hasData = historicalData && historicalData.length > 0;
    
    // 檢查是否已經到達數據庫的開始邊界
    // 檢查下一個 pageOffset 是否會返回有效的日期範圍
    let hasMoreData = hasData;
    if (hasData) {
        // 檢查下一個偏移量是否會返回有效的日期範圍
        const { startDate: nextStartDate } = getDateRangeWithOffset(range, pageOffset + 1);
        if (!nextStartDate) {
            // 如果下一個偏移量返回null，說明已經到達邊界
            hasMoreData = false;
        } else {
            // 對於5年/10年，需要檢查獲取的數據是否覆蓋了完整的時間範圍
            if (range === '5年' || range === '10年') {
                // 檢查實際數據的第一個日期是否早於預期的開始日期
                const firstDataDate = new Date(historicalData[0].date);
                const expectedStartDate = new Date(nextStartDate);
                // 如果第一個數據日期已經接近或早於預期開始日期，可能沒有更多數據
                // 但為了安全起見，我們仍然允許嘗試查看
                hasMoreData = true;
            } else {
                hasMoreData = true;
            }
        }
    }
    
    // 上一頁：只有在有數據且可能有更多數據時才允許查看更早的數據
    prevBtn.disabled = !hasMoreData;
    
    // 下一頁：只有在歷史數據中（pageOffset > 0）才能返回
    nextBtn.disabled = pageOffset <= 0;
    
    // 移除舊的事件監聽器（避免重複添加）
    const newPrevBtn = prevBtn.cloneNode(true);
    const newNextBtn = nextBtn.cloneNode(true);
    prevBtn.parentNode.replaceChild(newPrevBtn, prevBtn);
    nextBtn.parentNode.replaceChild(newNextBtn, nextBtn);
    
    // 更新全局變量
    historyPageOffset = pageOffset;
    
    // 設置按鈕事件
    newPrevBtn.onclick = async () => {
        if (newPrevBtn.disabled) {
            console.warn('⚠️ 上一頁按鈕已禁用，無法查看更早的數據');
            return;
        }
        console.log(`⬅️ 上一頁：從 pageOffset=${historyPageOffset} 到 ${historyPageOffset + 1}`);
        historyPageOffset += 1;
        await initHistoryChart(range, historyPageOffset);
    };
    
    newNextBtn.onclick = async () => {
        if (newNextBtn.disabled || historyPageOffset <= 0) {
            console.warn('⚠️ 下一頁按鈕已禁用，無法返回');
            return;
        }
        console.log(`➡️ 下一頁：從 pageOffset=${historyPageOffset} 到 ${historyPageOffset - 1}`);
        historyPageOffset -= 1;
        await initHistoryChart(range, historyPageOffset);
    };
    
    console.log(`📊 歷史導航按鈕已更新：範圍=${range}, pageOffset=${pageOffset}, 上一頁=${!newPrevBtn.disabled}, 下一頁=${!newNextBtn.disabled}`);
}

// 更新天氣顯示
function updateWeatherDisplay() {
    const weatherEl = document.getElementById('weather-display');
    if (!weatherEl) return;
    
    if (!currentWeatherData) {
        weatherEl.innerHTML = '<span class="weather-loading">⏳ 載入天氣資料...</span>';
        return;
    }
    
    const weather = currentWeatherData;
    const impact = calculateWeatherImpact(weather);
    const icon = getWeatherIcon(weather.icon);
    
    // 構建影響顯示
    let impactHtml = '';
    if (impact.impacts.length > 0) {
        const mainImpact = impact.impacts[0];
        const impactClass = mainImpact.factor > 1 ? 'positive' : mainImpact.factor < 1 ? 'negative' : 'neutral';
        const impactText = mainImpact.factor > 1 
            ? `+${Math.round((mainImpact.factor - 1) * 100)}%` 
            : `${Math.round((mainImpact.factor - 1) * 100)}%`;
        impactHtml = `<span class="weather-impact ${impactClass}">${mainImpact.icon} ${mainImpact.desc} ${impactText}</span>`;
    }
    
    weatherEl.innerHTML = `
        <span class="weather-icon">${icon}</span>
        <span class="weather-temp">${weather.temperature !== null ? weather.temperature + '°C' : '--'}</span>
        <div class="weather-details">
            <span class="weather-detail-item">💧 ${weather.humidity !== null ? weather.humidity + '%' : '--'}</span>
            <span class="weather-detail-item">🌧️ ${weather.rainfall}mm</span>
            ${weather.uvIndex ? `<span class="weather-detail-item">☀️ UV ${weather.uvIndex}</span>` : ''}
        </div>
        ${impactHtml}
        <span class="weather-desc">📍 北區上水</span>
    `;
}

// ============================================
// 從數據庫載入緩存的 AI 因素（快速載入）
// ============================================
async function loadAIFactorsFromCache() {
    try {
        const cacheResponse = await fetch('/api/ai-factors-cache');
        if (cacheResponse.ok) {
            const cacheData = await cacheResponse.json();
            if (cacheData.success && cacheData.data) {
                const storedFactors = cacheData.data.factors_cache || {};
                const storedAnalysisData = cacheData.data.analysis_data || {};
                const storedUpdateTime = cacheData.data.last_update_time || 0;
                
                // 更新全局變數
                aiFactors = storedFactors;
                lastAIUpdateTime = parseInt(storedUpdateTime) || 0;
                
                // 如果有分析數據，返回完整格式
                if (storedAnalysisData.factors && Array.isArray(storedAnalysisData.factors) && storedAnalysisData.factors.length > 0) {
                    return {
                        factors: storedAnalysisData.factors,
                        summary: storedAnalysisData.summary || '使用緩存數據',
                        timestamp: storedAnalysisData.timestamp || cacheData.data.updated_at,
                        cached: true
                    };
                }
                
                // 如果有 summary 但沒有 factors，也返回（至少有意義的 summary）
                if (storedAnalysisData.summary && storedAnalysisData.summary !== '無分析數據' && storedAnalysisData.summary !== '無法獲取 AI 分析') {
                    return {
                        factors: storedAnalysisData.factors || [],
                        summary: storedAnalysisData.summary,
                        timestamp: storedAnalysisData.timestamp || cacheData.data.updated_at,
                        cached: true
                    };
                }
                
                // 如果沒有分析數據，但有意義的因素緩存，構建基本結構
                if (Object.keys(storedFactors).length > 0) {
                    const factors = Object.keys(storedFactors).map(date => ({
                        date: date,
                        type: storedFactors[date].type || '未知',
                        description: storedFactors[date].description || '',
                        impactFactor: storedFactors[date].impactFactor || 1.0,
                        confidence: storedFactors[date].confidence || '中',
                        affectedDays: [date]
                    }));
                    
                    return {
                        factors: factors,
                        summary: '使用緩存數據',
                        timestamp: cacheData.data.updated_at,
                        cached: true
                    };
                }
                
                // 如果緩存存在但為空，標記為需要生成
                if (storedUpdateTime > 0) {
                    console.log('⚠️ 緩存數據存在但為空，需要重新生成');
                    return { factors: [], summary: '', cached: false, needsGeneration: true };
                }
            }
        }
    } catch (e) {
        console.warn('⚠️ 無法從數據庫載入 AI 緩存:', e);
    }
    
    return { factors: [], summary: '無緩存數據', cached: false };
}

// ============================================
// AI 因素更新（基於時間，避免過度消耗）
// ============================================
async function updateAIFactors(force = false) {
    // 檢查是否需要更新（基於時間，而不是每次刷新）
    const now = Date.now();
    
    // 如果內存中沒有因素，先從數據庫載入
    if (!aiFactors || Object.keys(aiFactors).length === 0) {
        const cacheData = await loadAIFactorsFromCache();
        if (cacheData.cached && cacheData.factors && cacheData.factors.length > 0) {
            // 已經載入緩存，檢查是否需要更新
            if (!force && lastAIUpdateTime && (now - lastAIUpdateTime) < AI_UPDATE_INTERVAL) {
                const timeSinceUpdate = Math.floor((now - lastAIUpdateTime) / 1000 / 60);
                const minutesRemaining = Math.ceil((AI_UPDATE_INTERVAL - (now - lastAIUpdateTime)) / 1000 / 60);
                console.log(`⏭️ 跳過 AI 更新（距離上次更新僅 ${timeSinceUpdate} 分鐘，需等待 ${minutesRemaining} 分鐘）`);
                return cacheData;
            }
        }
    }
    
    // 檢查是否需要更新（基於時間）
    if (!force && lastAIUpdateTime && (now - lastAIUpdateTime) < AI_UPDATE_INTERVAL) {
        const timeSinceUpdate = Math.floor((now - lastAIUpdateTime) / 1000 / 60);
        const minutesRemaining = Math.ceil((AI_UPDATE_INTERVAL - (now - lastAIUpdateTime)) / 1000 / 60);
        console.log(`⏭️ 跳過 AI 更新（距離上次更新僅 ${timeSinceUpdate} 分鐘，需等待 ${minutesRemaining} 分鐘）`);
        // 返回當前緩存的數據
        const cacheData = await loadAIFactorsFromCache();
        return cacheData.cached ? cacheData : { factors: [], summary: '使用緩存數據', cached: true };
    }
    
    try {
        console.log('🤖 開始 AI 因素分析...');
        updateFactorsLoadingProgress(10);
        
        // 添加超時和重試機制
        let response;
        let lastError = null;
        const maxRetries = 3;
        const timeout = 60000; // 60秒超時
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (attempt > 1) {
                    console.log(`🔄 重試 AI 分析 (第 ${attempt} 次嘗試)...`);
                    updateFactorsLoadingProgress(15);
                    // 等待後再重試
                    await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
                }
                
                // 創建帶超時的 fetch
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);
                
                try {
                    response = await fetch('/api/ai-analyze', {
                        signal: controller.signal,
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    clearTimeout(timeoutId);
                } catch (fetchError) {
                    clearTimeout(timeoutId);
                    if (fetchError.name === 'AbortError') {
                        throw new Error('請求超時（60秒）');
                    }
                    throw fetchError;
                }
                
                updateFactorsLoadingProgress(30);
                break; // 成功，跳出重試循環
            } catch (error) {
                lastError = error;
                console.warn(`⚠️ AI 分析請求失敗 (第 ${attempt} 次嘗試):`, error.message);
                
                if (attempt === maxRetries) {
                    // 最後一次嘗試失敗
                    throw error;
                }
                // 繼續重試
            }
        }
        
        if (!response) {
            throw lastError || new Error('無法連接到服務器');
        }
        
        if (!response.ok) {
            const errorText = await response.text().catch(() => '無法讀取錯誤訊息');
            let errorData;
            try {
                errorData = JSON.parse(errorText);
            } catch (e) {
                errorData = { error: errorText || `HTTP ${response.status}` };
            }
            console.error('❌ AI 分析 API 錯誤:', response.status, errorData);
            throw new Error(errorData.error || `AI 分析 API 錯誤 (HTTP ${response.status})`);
        }
        
        const data = await response.json();
        updateFactorsLoadingProgress(60);
        
        console.log('📊 AI 分析響應:', {
            success: data.success,
            factorsCount: data.factors?.length || 0,
            hasSummary: !!data.summary,
            error: data.error
        });
        
        if (data.success && data.factors && Array.isArray(data.factors) && data.factors.length > 0) {
            // 更新全局 AI 因素緩存
            aiFactors = {};
            data.factors.forEach(factor => {
                if (factor.affectedDays && Array.isArray(factor.affectedDays)) {
                    factor.affectedDays.forEach(date => {
                        aiFactors[date] = {
                            impactFactor: factor.impactFactor || 1.0,
                            description: factor.description || '',
                            type: factor.type || '未知',
                            confidence: factor.confidence || '中'
                        };
                    });
                } else if (factor.date) {
                    aiFactors[factor.date] = {
                        impactFactor: factor.impactFactor || 1.0,
                        description: factor.description || '',
                        type: factor.type || '未知',
                        confidence: factor.confidence || '中'
                    };
                }
            });
            
            lastAIAnalysisTime = new Date();
            lastAIUpdateTime = now; // 記錄更新時間
            
            // 保存更新時間和因素到數據庫（跨設備和頁面刷新持久化）
            try {
                const saveResponse = await fetch('/api/ai-factors-cache', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        updateTime: now,
                        factorsCache: aiFactors,
                        analysisData: {
                            factors: data.factors,
                            summary: data.summary || '',
                            timestamp: data.timestamp || new Date().toISOString()
                        }
                    })
                });
                
                if (saveResponse.ok) {
                    console.log('💾 AI 更新時間和因素已保存到數據庫');
                } else {
                    console.warn('⚠️ 保存 AI 緩存到數據庫失敗:', await saveResponse.text());
                }
            } catch (e) {
                console.warn('⚠️ 無法保存到數據庫:', e);
            }
            
            console.log('✅ AI 因素已更新:', Object.keys(aiFactors).length, '個日期');
            updateFactorsLoadingProgress(90);
            
            // 返回完整的分析數據供顯示使用
            const result = {
                factors: data.factors,
                summary: data.summary || '',
                timestamp: data.timestamp || new Date().toISOString(),
                cached: false
            };
            updateFactorsLoadingProgress(100);
            return result;
        } else if (data.success && data.summary) {
            // 即使沒有 factors，如果有 summary，也保存到數據庫
            console.log('⚠️ AI 分析返回了總結但沒有因素:', data);
            
            // 保存到數據庫（即使只有 summary）
            try {
                const saveResponse = await fetch('/api/ai-factors-cache', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        updateTime: now,
                        factorsCache: aiFactors,
                        analysisData: {
                            factors: [],
                            summary: data.summary || '無分析數據',
                            timestamp: data.timestamp || new Date().toISOString()
                        }
                    })
                });
                
                if (saveResponse.ok) {
                    console.log('💾 AI 總結已保存到數據庫');
                }
            } catch (e) {
                console.warn('⚠️ 無法保存總結到數據庫:', e);
            }
            
            lastAIUpdateTime = now;
            updateFactorsLoadingProgress(100);
            return {
                factors: [],
                summary: data.summary || '無分析數據',
                timestamp: data.timestamp || new Date().toISOString(),
                cached: false
            };
        }
        
        // 檢查是否有錯誤訊息
        if (data.error) {
            console.error('❌ AI 分析返回錯誤:', data.error);
            updateFactorsLoadingProgress(100);
            return { 
                factors: [], 
                summary: `AI 分析失敗: ${data.error}`,
                error: data.error,
                cached: false 
            };
        }
        
        console.log('⚠️ AI 分析返回空數據:', data);
        updateFactorsLoadingProgress(100);
        return { factors: [], summary: '無分析數據', cached: false };
    } catch (error) {
        console.error('❌ AI 因素更新失敗:', error);
        console.error('錯誤詳情:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        
        // 根據錯誤類型提供更友好的錯誤訊息
        let errorMessage = error.message || '未知錯誤';
        let errorSummary = '無法獲取 AI 分析';
        
        if (error.message.includes('Load failed') || error.message.includes('Failed to fetch')) {
            errorMessage = '網絡連接失敗，請檢查網絡連接';
            errorSummary = '網絡連接失敗，請稍後重試';
        } else if (error.message.includes('timeout') || error.message.includes('超時')) {
            errorMessage = '請求超時，服務器響應時間過長';
            errorSummary = '請求超時，請稍後重試';
        } else if (error.message.includes('AbortError')) {
            errorMessage = '請求被取消或超時';
            errorSummary = '請求超時，請稍後重試';
        }
        
        updateFactorsLoadingProgress(100);
        return { 
            factors: [], 
            summary: `${errorSummary}: ${errorMessage}`,
            error: errorMessage 
        };
    }
}

// 更新 factors-loading 進度
function updateFactorsLoadingProgress(percent) {
    const percentEl = document.getElementById('factors-loading-percent');
    const progressFill = document.getElementById('factors-loading-progress');
    const loadingEl = document.getElementById('factors-loading');
    
    if (percentEl) {
        percentEl.textContent = `${Math.round(percent)}%`;
    }
    if (progressFill) {
        progressFill.style.width = `${percent}%`;
    }
    if (percent >= 100 && loadingEl) {
        loadingEl.style.display = 'none';
    } else if (loadingEl && percent < 100) {
        loadingEl.style.display = 'block';
    }
}

// 更新實時因素顯示
function updateRealtimeFactors(aiAnalysisData = null) {
    const factorsEl = document.getElementById('realtime-factors');
    const loadingEl = document.getElementById('realtime-factors-loading');
    if (!factorsEl) {
        console.warn('⚠️ 找不到 realtime-factors 元素');
        return;
    }
    
    updateSectionProgress('realtime-factors', 20);
    
    // 檢查 AI 分析數據
    console.log('📊 AI 分析數據:', aiAnalysisData);
    
    // 如果沒有 AI 分析數據，顯示載入狀態或空狀態
    // 檢查是否有有效的數據（factors 或有意義的 summary）
    const hasValidData = aiAnalysisData && 
        ((aiAnalysisData.factors && Array.isArray(aiAnalysisData.factors) && aiAnalysisData.factors.length > 0) ||
         (aiAnalysisData.summary && 
          aiAnalysisData.summary !== '無分析數據' && 
          aiAnalysisData.summary !== '無法獲取 AI 分析' && 
          aiAnalysisData.summary !== '' &&
          aiAnalysisData.summary.trim().length > 0));
    
    if (!hasValidData) {
        updateSectionProgress('realtime-factors', 100);
        updateFactorsLoadingProgress(100);
        if (loadingEl) loadingEl.style.display = 'none';
        factorsEl.style.display = 'block';
        // 檢查是否正在載入（factors-loading 是否可見）
        const factorsLoadingEl = document.getElementById('factors-loading');
        if (factorsLoadingEl && factorsLoadingEl.style.display !== 'none') {
            // 如果正在載入，保持顯示載入狀態
            return;
        }
        // 否則顯示空狀態或錯誤狀態
        // 確保隱藏 factors-loading 元素
        if (factorsLoadingEl) {
            factorsLoadingEl.style.display = 'none';
        }
        
        // 如果有錯誤訊息，顯示錯誤狀態
        if (aiAnalysisData?.error) {
            factorsEl.innerHTML = `
                <div class="factors-error">
                    <span class="error-icon">⚠️</span>
                    <span class="error-title">AI 分析生成失敗</span>
                    <p class="error-message">${aiAnalysisData.error}</p>
                    <p class="error-hint">系統將在稍後自動重試，或請刷新頁面</p>
                </div>
            `;
        } else {
            factorsEl.innerHTML = `
                <div class="factors-empty">
                    <span>📊 暫無實時影響因素</span>
                    <p>系統會自動分析可能影響預測的新聞和事件${aiAnalysisData?.cached ? '（使用緩存數據）' : ''}</p>
                </div>
            `;
        }
        return;
    }
    
    updateSectionProgress('realtime-factors', 40);
    updateFactorsLoadingProgress(40);
    
    // 確保 factors 是數組
    let factors = [];
    if (aiAnalysisData.factors) {
        if (Array.isArray(aiAnalysisData.factors)) {
            factors = aiAnalysisData.factors;
        } else {
            console.warn('⚠️ AI 因素不是數組格式:', aiAnalysisData.factors);
            factors = [];
        }
    }
    
    const summary = aiAnalysisData.summary || '';
    
    // 如果沒有因素但有總結，至少顯示總結
    // 檢查 summary 是否有意義（不是錯誤或空消息）
    const hasValidSummary = summary && 
        summary !== '無法獲取 AI 分析' && 
        summary !== '無分析數據' && 
        summary !== '' &&
        summary.trim().length > 0;
    
    if (factors.length === 0 && hasValidSummary) {
        updateSectionProgress('realtime-factors', 100);
        updateFactorsLoadingProgress(100);
        if (loadingEl) loadingEl.style.display = 'none';
        // 確保隱藏 factors-loading 元素
        const factorsLoadingEl = document.getElementById('factors-loading');
        if (factorsLoadingEl) {
            factorsLoadingEl.style.display = 'none';
        }
        factorsEl.style.display = 'block';
        const convertedSummary = convertToTraditional(summary);
        factorsEl.innerHTML = `
            <div class="factors-summary">
                <h3>📋 AI 分析總結</h3>
                <p>${escapeHtml(convertedSummary)}</p>
            </div>
        `;
        return;
    }
    
    // 如果完全沒有數據，顯示空狀態
    if (factors.length === 0) {
        updateSectionProgress('realtime-factors', 100);
        updateFactorsLoadingProgress(100);
        if (loadingEl) loadingEl.style.display = 'none';
        // 確保隱藏 factors-loading 元素
        const factorsLoadingEl = document.getElementById('factors-loading');
        if (factorsLoadingEl) {
            factorsLoadingEl.style.display = 'none';
        }
        factorsEl.style.display = 'block';
        factorsEl.innerHTML = `
            <div class="factors-empty">
                <span>📊 暫無實時影響因素</span>
                <p>系統會自動分析可能影響預測的新聞和事件</p>
            </div>
        `;
        return;
    }
    
    // 按影響因子排序（影響大的在前）
    const sortedFactors = [...factors].sort((a, b) => {
        const aFactor = Math.abs((a.impactFactor || 1.0) - 1.0);
        const bFactor = Math.abs((b.impactFactor || 1.0) - 1.0);
        return bFactor - aFactor;
    });
    
    let factorsHtml = '';
    
    sortedFactors.forEach((factor, index) => {
        const impactFactor = factor.impactFactor || 1.0;
        const isPositive = impactFactor > 1.0;
        const isNegative = impactFactor < 1.0;
        const impactPercent = Math.abs((impactFactor - 1.0) * 100).toFixed(1);
        
        // 轉換簡體中文到繁體中文（確保所有文本都經過轉換）
        const factorType = convertToTraditional(String(factor.type || '未知'));
        const factorConfidence = convertToTraditional(String(factor.confidence || '中'));
        const factorDescription = convertToTraditional(String(factor.description || '無描述'));
        const factorReasoning = factor.reasoning ? convertToTraditional(String(factor.reasoning)) : null;
        
        // 根據類型選擇圖標
        let icon = '📊';
        if (factor.type === '天氣') icon = '🌤️';
        else if (factor.type === '公共衛生') icon = '🏥';
        else if (factor.type === '社會事件') icon = '📰';
        else if (factor.type === '季節性') icon = '📅';
        
        // 根據信心度選擇顏色
        let confidenceClass = 'confidence-medium';
        if (factor.confidence === '高') confidenceClass = 'confidence-high';
        else if (factor.confidence === '低') confidenceClass = 'confidence-low';
        
        // 受影響的日期
        let affectedDaysHtml = '';
        if (factor.affectedDays && Array.isArray(factor.affectedDays) && factor.affectedDays.length > 0) {
            const daysList = factor.affectedDays.slice(0, 5).map(date => {
                return formatDateDDMM(date, true); // 受影響日期顯示完整日期
            }).join(', ');
            affectedDaysHtml = `
                <div class="factor-affected-days">
                    <span class="affected-days-label">受影響日期：</span>
                    <span class="affected-days-list">${daysList}${factor.affectedDays.length > 5 ? '...' : ''}</span>
                </div>
            `;
        } else if (factor.date) {
            affectedDaysHtml = `
                <div class="factor-affected-days">
                    <span class="affected-days-label">日期：</span>
                    <span class="affected-days-list">${formatDateDDMM(factor.date, true)}</span>
                </div>
            `;
        }
        
        factorsHtml += `
            <div class="factor-card ${isPositive ? 'factor-positive' : isNegative ? 'factor-negative' : 'factor-neutral'}">
                <div class="factor-header">
                    <span class="factor-icon">${icon}</span>
                    <div class="factor-title-group">
                        <span class="factor-type">${escapeHtml(factorType)}</span>
                        <span class="factor-confidence ${confidenceClass}">${escapeHtml(factorConfidence)}信心度</span>
                    </div>
                    <div class="factor-impact ${isPositive ? 'impact-positive' : isNegative ? 'impact-negative' : 'impact-neutral'}">
                        ${isPositive ? '+' : ''}${impactPercent}%
                    </div>
                </div>
                <div class="factor-description">
                    ${escapeHtml(factorDescription)}
                </div>
                ${factorReasoning ? `
                <div class="factor-reasoning">
                    <span class="reasoning-label">分析：</span>
                    <span class="reasoning-text">${escapeHtml(factorReasoning)}</span>
                </div>
                ` : ''}
                ${affectedDaysHtml}
                <div class="factor-impact-value">
                    <span class="impact-label">影響因子：</span>
                    <span class="impact-value">×${impactFactor.toFixed(3)}</span>
                </div>
            </div>
        `;
    });
    
    // 如果有總結，添加總結區塊（確保轉換為繁體中文）
    let summaryHtml = '';
    if (summary && summary !== '無法獲取 AI 分析') {
        // 確保 summary 是字符串並轉換為繁體中文
        const summaryStr = String(summary);
        const convertedSummary = convertToTraditional(summaryStr);
        summaryHtml = `
            <div class="factors-summary">
                <h3>📋 分析總結</h3>
                <p>${escapeHtml(convertedSummary)}</p>
            </div>
        `;
    }
    
    // 添加最後更新時間（從緩存數據的時間戳或分析時間）
    let lastUpdate = '未知';
    if (aiAnalysisData && aiAnalysisData.timestamp) {
        try {
            lastUpdate = new Date(aiAnalysisData.timestamp).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' });
        } catch (e) {
            lastUpdate = lastAIAnalysisTime 
                ? new Date(lastAIAnalysisTime).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })
                : '未知';
        }
    } else if (lastAIAnalysisTime) {
        lastUpdate = new Date(lastAIAnalysisTime).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' });
    }
    
    // 如果使用緩存，標註
    if (aiAnalysisData && aiAnalysisData.cached) {
        lastUpdate += ' (緩存)';
    }
    
    factorsEl.innerHTML = `
        <div class="factors-header-info">
            <span class="factors-count">共 ${sortedFactors.length} 個影響因素</span>
            <span class="factors-update-time">最後更新：${lastUpdate} HKT</span>
        </div>
        <div class="factors-grid">
            ${factorsHtml}
        </div>
        ${summaryHtml}
    `;
    
    updateSectionProgress('realtime-factors', 100);
    updateFactorsLoadingProgress(100);
    if (loadingEl) loadingEl.style.display = 'none';
    
    // 確保隱藏 factors-loading 元素
    const factorsLoadingEl = document.getElementById('factors-loading');
    if (factorsLoadingEl) {
        factorsLoadingEl.style.display = 'none';
    }
    
    factorsEl.style.display = 'block';
}

// 更新預測（當天氣或 AI 因素更新時）
async function refreshPredictions(predictor) {
    console.log('🔄 刷新預測數據...');
    
    // 獲取最新的天氣預報
    await fetchWeatherForecast();
    
    // 獲取最新的 AI 因素
    const aiAnalysisData = await updateAIFactors();
    
    // 更新實時因素顯示
    updateRealtimeFactors(aiAnalysisData);
    
    // 重新更新 UI
    updateUI(predictor);
    
    // 重新初始化圖表
    if (forecastChart) forecastChart.destroy();
    if (dowChart) dowChart.destroy();
    if (monthChart) monthChart.destroy();
    if (historyChart) historyChart.destroy();
    if (comparisonChart) comparisonChart.destroy();
    await initCharts(predictor);
    // 確保圖表正確適應
    setTimeout(() => forceChartsResize(), 200);
    
    console.log('✅ 預測數據已刷新');
}

// ============================================
// 初始化
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🏥 NDH AED 預測系統初始化...');
    
    const predictor = new NDHAttendancePredictor();
    
    // 檢查數據庫狀態
    updateSectionProgress('today-prediction', 5);
    await checkDatabaseStatus();
    
    // 檢查 AI 狀態
    updateSectionProgress('today-prediction', 8);
    await checkAIStatus();
    
    // 獲取並顯示天氣
    updateSectionProgress('today-prediction', 10);
    await fetchCurrentWeather();
    await fetchWeatherForecast();
    updateWeatherDisplay();
    updateSectionProgress('today-prediction', 15);
    
    // 立即從數據庫載入緩存的 AI 因素（快速顯示，不等待 API）
    updateSectionProgress('realtime-factors', 5);
    const factorsEl = document.getElementById('realtime-factors');
    if (factorsEl) {
        factorsEl.style.display = 'block';
    }
    updateFactorsLoadingProgress(5);
    let aiAnalysisData = await loadAIFactorsFromCache();
    updateSectionProgress('realtime-factors', 15);
    updateFactorsLoadingProgress(15);
    
    // 檢查是否需要生成 AI 數據
    // 檢查緩存數據是否真正有效（factors 或有意義的 summary）
    const hasValidData = aiAnalysisData && 
        aiAnalysisData.cached && 
        ((aiAnalysisData.factors && Array.isArray(aiAnalysisData.factors) && aiAnalysisData.factors.length > 0) || 
         (aiAnalysisData.summary && 
          aiAnalysisData.summary !== '無分析數據' && 
          aiAnalysisData.summary !== '無法獲取 AI 分析' && 
          aiAnalysisData.summary !== '' &&
          aiAnalysisData.summary.trim().length > 0));
    
    // 如果沒有有效的緩存數據，立即生成一次 AI 數據並保存到數據庫
    if (!hasValidData || aiAnalysisData?.needsGeneration) {
        console.log('🔄 沒有有效的 AI 緩存數據，立即生成一次...');
        updateFactorsLoadingProgress(20);
        updateRealtimeFactors({ factors: [], summary: '正在生成 AI 分析數據...' });
        // 強制生成一次 AI 數據（force = true）
        aiAnalysisData = await updateAIFactors(true);
        updateSectionProgress('realtime-factors', 30);
        updateFactorsLoadingProgress(30);
        
        // 如果生成成功，更新顯示
        // 檢查是否有有效的數據（factors 或有意義的 summary）
        const hasValidGeneratedData = aiAnalysisData && 
            ((aiAnalysisData.factors && Array.isArray(aiAnalysisData.factors) && aiAnalysisData.factors.length > 0) || 
             (aiAnalysisData.summary && 
              aiAnalysisData.summary !== '無分析數據' && 
              aiAnalysisData.summary !== '無法獲取 AI 分析' && 
              aiAnalysisData.summary !== '' &&
              aiAnalysisData.summary.trim().length > 0));
        
        if (hasValidGeneratedData) {
            updateRealtimeFactors(aiAnalysisData);
            console.log('✅ 已生成並保存 AI 因素到數據庫');
        } else {
            // 如果生成失敗，顯示錯誤狀態
            console.warn('⚠️ AI 數據生成失敗，返回的數據:', aiAnalysisData);
            updateRealtimeFactors({ 
                factors: [], 
                summary: 'AI 分析生成失敗，請稍後重試',
                error: '生成失敗'
            });
        }
    } else {
        // 有有效的緩存數據，立即顯示
        updateRealtimeFactors(aiAnalysisData);
        console.log('✅ 已從數據庫載入緩存的 AI 因素並顯示');
    }
    
    // 更新 UI（使用緩存的 AI 因素，快速顯示）
    updateUI(predictor);
    updateSectionProgress('today-prediction', 50);
    
    // 設置歷史趨勢時間範圍選擇按鈕
    setupHistoryTimeRangeButtons();
    
    // 初始化圖表（使用緩存的 AI 因素）
    await initCharts(predictor);
    updateSectionProgress('today-prediction', 100);
    
    // 在背景異步檢查並更新 AI 因素（如果需要，不阻塞 UI）
    // 如果已經在初始化時生成了數據，這裡只檢查是否需要更新（基於時間間隔）
    setTimeout(async () => {
        // 檢查是否已經有數據（剛生成的或緩存的）
        const hasData = aiAnalysisData && 
            ((aiAnalysisData.factors && aiAnalysisData.factors.length > 0) || aiAnalysisData.summary);
        
        if (hasData) {
            // 已經有數據，只檢查是否需要更新（基於時間間隔）
            updateSectionProgress('realtime-factors', 50);
            updateFactorsLoadingProgress(50);
            const freshAIAnalysisData = await updateAIFactors(false); // 不強制，基於時間間隔
            if (freshAIAnalysisData && !freshAIAnalysisData.cached) {
                // 如果有新的數據（超過時間間隔），更新顯示
                updateRealtimeFactors(freshAIAnalysisData);
                updateUI(predictor);
                // 重新初始化圖表以反映新的 AI 因素
                if (forecastChart) forecastChart.destroy();
                if (dowChart) dowChart.destroy();
                if (monthChart) monthChart.destroy();
                if (historyChart) historyChart.destroy();
                if (comparisonChart) comparisonChart.destroy();
                await initCharts(predictor);
                // 確保圖表正確適應
                setTimeout(() => forceChartsResize(), 200);
                console.log('✅ AI 因素已更新，UI 已刷新');
            } else {
                console.log('ℹ️ AI 因素無需更新，使用緩存數據');
            }
        } else {
            // 如果初始化時生成失敗，這裡再試一次
            console.log('🔄 初始化時生成失敗，再次嘗試生成 AI 數據...');
            updateSectionProgress('realtime-factors', 50);
            updateFactorsLoadingProgress(50);
            const freshAIAnalysisData = await updateAIFactors(true); // 強制生成
            if (freshAIAnalysisData && (freshAIAnalysisData.factors && freshAIAnalysisData.factors.length > 0 || freshAIAnalysisData.summary)) {
                updateRealtimeFactors(freshAIAnalysisData);
                updateUI(predictor);
                if (forecastChart) forecastChart.destroy();
                if (dowChart) dowChart.destroy();
                if (monthChart) monthChart.destroy();
                if (historyChart) historyChart.destroy();
                if (comparisonChart) comparisonChart.destroy();
                await initCharts(predictor);
                // 確保圖表正確適應
                setTimeout(() => forceChartsResize(), 200);
                console.log('✅ AI 因素已生成並保存到數據庫');
            }
        }
        updateSectionProgress('realtime-factors', 100);
        updateFactorsLoadingProgress(100);
    }, 1000); // 1秒後在背景執行，確保初始化完成
    
    // 每秒更新時間 (使用真實 HKT)
    setInterval(() => {
        const hk = getHKTime();
        const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        const datetimeEl = document.getElementById('current-datetime');
        datetimeEl.textContent = `🕐 ${hk.year}年${hk.month}月${hk.day}日 ${weekdays[hk.dayOfWeek]} ${hk.timeStr} HKT`;
    }, 1000);
    
    // 每分鐘更新天氣並觸發預測更新
    setInterval(async () => {
        const oldWeather = JSON.stringify(currentWeatherData);
        await fetchCurrentWeather();
        updateWeatherDisplay();
        
        // 如果天氣數據有變化，刷新預測
        if (JSON.stringify(currentWeatherData) !== oldWeather) {
            console.log('🌤️ 天氣數據已更新，觸發預測刷新');
            await refreshPredictions(predictor);
        } else {
            console.log('🌤️ 天氣已檢查（無變化）');
        }
    }, 60000); // 60 秒
    
    // 每30分鐘更新 AI 因素（基於時間，避免過度消耗）
    setInterval(async () => {
        const aiAnalysisData = await updateAIFactors(true); // 強制更新
        await refreshPredictions(predictor);
        updateRealtimeFactors(aiAnalysisData);
        await checkAIStatus(); // 更新 AI 狀態
        console.log('🤖 AI 因素已更新');
    }, 1800000); // 30 分鐘
    
    // 每5分鐘檢查數據庫狀態
    setInterval(async () => {
        await checkDatabaseStatus();
        console.log('🗄️ 數據庫狀態已更新');
    }, 300000); // 5 分鐘
    
    // 每10分鐘檢查 AI 狀態
    setInterval(async () => {
        await checkAIStatus();
        console.log('🤖 AI 狀態已更新');
    }, 600000); // 10 分鐘
    
    console.log('✅ NDH AED 預測系統就緒');
});

