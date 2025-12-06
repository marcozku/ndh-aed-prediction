/**
 * NDH AED 病人數量預測系統
 * North District Hospital AED Attendance Prediction Algorithm
 * 
 * 基於 2024-12-03 至 2025-12-03 的歷史數據分析
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
// 歷史數據 (2024-12-03 至 2025-12-03)
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
let forecastChart, dowChart, monthChart, historyChart;

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

// 專業圖表選項 - 手機友好
const professionalOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
        intersect: false,
        mode: 'index'
    },
    layout: {
        padding: {
            top: 10,
            bottom: 10,
            left: 5,
            right: 15
        }
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

function initCharts(predictor) {
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
                        maxTicksLimit: 15
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
                        font: { size: 13, weight: 700 }
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
    
    // 4. 歷史趨勢圖 - 專業區域圖
    try {
        updateLoadingProgress('history', 10);
        const historyCanvas = document.getElementById('history-chart');
        if (!historyCanvas) {
            console.error('❌ 找不到 history-chart canvas');
            updateLoadingProgress('history', 0);
            return;
        }
        const historyCtx = historyCanvas.getContext('2d');
        updateLoadingProgress('history', 30);
        
        // 創建漸變
        const historyGradient = historyCtx.createLinearGradient(0, 0, 0, 320);
        historyGradient.addColorStop(0, 'rgba(79, 70, 229, 0.25)');
        historyGradient.addColorStop(0.5, 'rgba(79, 70, 229, 0.08)');
        historyGradient.addColorStop(1, 'rgba(79, 70, 229, 0)');
        updateLoadingProgress('history', 50);
        
        // 簡化日期標籤 - 只顯示月份
        const monthLabels = predictor.data.map((d, i) => {
            const date = new Date(d.date);
            const day = date.getDate();
            // 只在每月1號或15號顯示
            if (day === 1) {
                return `${date.getMonth()+1}月`;
            }
            return '';
        });
        updateLoadingProgress('history', 70);
        
        historyChart = new Chart(historyCtx, {
        type: 'line',
        data: {
            labels: monthLabels,
            datasets: [
                {
                    label: '實際人數',
                    data: predictor.data.map(d => d.attendance),
                    borderColor: '#4f46e5',
                    backgroundColor: historyGradient,
                    borderWidth: 2,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#4f46e5',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2
                },
                {
                    label: '平均 (256)',
                    data: predictor.data.map(() => predictor.globalMean),
                    borderColor: '#ef4444',
                    borderWidth: 2.5,
                    borderDash: [8, 4],
                    fill: false,
                    pointRadius: 0
                },
                {
                    label: '±1σ 範圍',
                    data: predictor.data.map(() => predictor.globalMean + predictor.stdDev),
                    borderColor: 'rgba(239, 68, 68, 0.25)',
                    borderWidth: 1.5,
                    borderDash: [4, 4],
                    fill: false,
                    pointRadius: 0
                },
                {
                    label: '',
                    data: predictor.data.map(() => predictor.globalMean - predictor.stdDev),
                    borderColor: 'rgba(239, 68, 68, 0.25)',
                    borderWidth: 1.5,
                    borderDash: [4, 4],
                    fill: '-1',
                    backgroundColor: 'rgba(239, 68, 68, 0.03)',
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
                            const idx = items[0].dataIndex;
                            return formatDateDDMM(predictor.data[idx].date, true); // 工具提示顯示完整日期
                        },
                        label: function(item) {
                            if (item.datasetIndex === 0) {
                                return `實際: ${item.raw} 人`;
                            }
                            return null;
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
                        maxTicksLimit: 12,
                        callback: function(value, index) {
                            return monthLabels[index] || null;
                        }
                    }
                },
                y: {
                    ...professionalOptions.scales.y,
                    min: 140,
                    max: 340,
                    ticks: {
                        ...professionalOptions.scales.y.ticks,
                        stepSize: 40
                    }
                }
            }
        }
    });
    
    updateLoadingProgress('history', 90);
    updateLoadingProgress('history', 100);
    completeChartLoading('history');
    totalProgress += 25;
    console.log('✅ 歷史趨勢圖已載入');
    console.log('✅ 所有圖表載入完成');
    } catch (error) {
        console.error('❌ 歷史趨勢圖載入失敗:', error);
        updateLoadingProgress('history', 0);
    }
}

// ============================================
// 日期格式化工具函數
// ============================================
function formatDateDDMM(dateStr, includeYear = false) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    if (includeYear) {
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
    }
    return `${day}/${month}`;
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
        factorsEl.innerHTML = `
            <div class="factors-summary">
                <h3>📋 AI 分析總結</h3>
                <p>${summary}</p>
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
        
        // 將簡體中文類型轉換為繁體中文
        const typeMapping = {
            '天气': '天氣',
            '天气相关事件': '天氣',
            '公共衛生': '公共衛生',
            '公共卫生': '公共衛生',
            '公共卫生事件': '公共衛生',
            '社會事件': '社會事件',
            '社会事件': '社會事件',
            '季節性': '季節性',
            '季节性': '季節性',
            '季节性因素': '季節性'
        };
        const factorType = typeMapping[factor.type] || factor.type || '未知';
        
        // 根據類型選擇圖標
        let icon = '📊';
        if (factorType === '天氣' || factor.type === '天氣' || factor.type === '天气' || factor.type === '天气相关事件') icon = '🌤️';
        else if (factorType === '公共衛生' || factor.type === '公共衛生' || factor.type === '公共卫生' || factor.type === '公共卫生事件') icon = '🏥';
        else if (factorType === '社會事件' || factor.type === '社會事件' || factor.type === '社会事件') icon = '📰';
        else if (factorType === '季節性' || factor.type === '季節性' || factor.type === '季节性' || factor.type === '季节性因素') icon = '📅';
        
        // 將簡體中文信心度轉換為繁體中文
        const confidenceMapping = {
            '高': '高',
            '中': '中',
            '低': '低'
        };
        const factorConfidence = confidenceMapping[factor.confidence] || factor.confidence || '中';
        
        // 根據信心度選擇顏色
        let confidenceClass = 'confidence-medium';
        if (factorConfidence === '高') confidenceClass = 'confidence-high';
        else if (factorConfidence === '低') confidenceClass = 'confidence-low';
        
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
                        <span class="factor-type">${factorType}</span>
                        <span class="factor-confidence ${confidenceClass}">${factorConfidence}信心度</span>
                    </div>
                    <div class="factor-impact ${isPositive ? 'impact-positive' : isNegative ? 'impact-negative' : 'impact-neutral'}">
                        ${isPositive ? '+' : ''}${impactPercent}%
                    </div>
                </div>
                <div class="factor-description">
                    ${factor.description || '無描述'}
                </div>
                ${factor.reasoning ? `
                <div class="factor-reasoning">
                    <span class="reasoning-label">分析：</span>
                    <span class="reasoning-text">${factor.reasoning}</span>
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
    
    // 如果有總結，添加總結區塊
    let summaryHtml = '';
    if (summary && summary !== '無法獲取 AI 分析') {
        summaryHtml = `
            <div class="factors-summary">
                <h3>📋 分析總結</h3>
                <p>${summary}</p>
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
    initCharts(predictor);
    
    console.log('✅ 預測數據已刷新');
}

// ============================================
// 初始化
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🏥 NDH AED 預測系統初始化...');
    
    // 獲取版本信息
    try {
        const versionResponse = await fetch('/api/version');
        if (versionResponse.ok) {
            const versionData = await versionResponse.json();
            if (versionData.success) {
                const modelVersionEl = document.getElementById('model-version');
                const appVersionEl = document.getElementById('app-version');
                if (modelVersionEl) modelVersionEl.textContent = versionData.modelVersion || '--';
                if (appVersionEl) appVersionEl.textContent = versionData.appVersion || '--';
            }
        }
    } catch (error) {
        console.warn('⚠️ 無法獲取版本信息:', error);
    }
    
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
    
    // 初始化圖表（使用緩存的 AI 因素）
    initCharts(predictor);
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
                initCharts(predictor);
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
                initCharts(predictor);
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

