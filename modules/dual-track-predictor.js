/**
 * Dual-Track Intelligent Prediction System
 * 
 * Purpose: Runs parallel production and experimental predictions
 *          to continuously validate AI factor effectiveness
 * 
 * Architecture:
 *   - Production Track: Uses validated weights (currently w_AI = 0.00)
 *   - Experimental Track: Tests AI factor integration (w_AI = 0.10)
 *   - Automatic validation and weight optimization
 * 
 * Author: Ma Tsz Kiu
 * Version: 3.0.82
 * Date: 2026-01-05
 */

const fs = require('fs').promises;
const path = require('path');

class DualTrackPredictor {
    constructor(pool) {
        this.pool = pool;
        this.configPath = path.join(__dirname, '../python/models/bayesian_weights_optimized.json');
        this.weights = {
            production: { w_base: 0.95, w_weather: 0.05, w_ai: 0.00 },
            experimental: { w_base: 0.85, w_weather: 0.05, w_ai: 0.10 }
        };
        this.minSamplesForValidation = 30;
        this.validationWindowDays = 90;
    }

    /**
     * Load current weights from optimization file
     */
    async loadWeights() {
        try {
            const data = await fs.readFile(this.configPath, 'utf8');
            const config = JSON.parse(data);
            
            this.weights.production = {
                w_base: config.optimized_weights.w_base,
                w_weather: config.optimized_weights.w_weather,
                w_ai: config.optimized_weights.w_AI
            };
            
            // Experimental: always tests AI factor
            this.weights.experimental = {
                w_base: Math.max(0.70, this.weights.production.w_base - 0.10),
                w_weather: this.weights.production.w_weather,
                w_ai: Math.min(0.20, this.weights.production.w_ai + 0.10)
            };
            
            console.log('✅ Loaded weights:', {
                production: this.weights.production,
                experimental: this.weights.experimental
            });
        } catch (error) {
            console.warn('⚠️  Using default weights:', error.message);
        }
    }

    /**
     * Generate dual-track predictions
     */
    async predict(date, xgboostBase, weatherFactor, aiFactor) {
        await this.loadWeights();
        
        // Production prediction (validated weights)
        const production = this.calculatePrediction(
            xgboostBase,
            weatherFactor,
            aiFactor,
            this.weights.production
        );
        
        // Experimental prediction (testing AI factor)
        const experimental = this.calculatePrediction(
            xgboostBase,
            weatherFactor,
            aiFactor,
            this.weights.experimental
        );
        
        const result = {
            date,
            xgboost_base: Math.round(xgboostBase * 10) / 10,
            
            // Production track
            production: {
                prediction: Math.round(production),
                weights: this.weights.production,
                formula: this.getFormulaString(this.weights.production)
            },
            
            // Experimental track
            experimental: {
                prediction: Math.round(experimental),
                weights: this.weights.experimental,
                formula: this.getFormulaString(this.weights.experimental)
            },
            
            // Factors
            factors: {
                weather: Math.round(weatherFactor * 1000) / 1000,
                ai: Math.round(aiFactor * 1000) / 1000
            },
            
            // Difference
            difference: Math.round(experimental - production),
            difference_pct: Math.round(((experimental - production) / production) * 1000) / 10,
            
            // Status
            status: 'pending_validation',
            ai_impact: aiFactor !== 1.0 ? this.describeAIImpact(aiFactor) : 'None'
        };
        
        // Save to database
        await this.savePredictions(result);
        
        return result;
    }

    /**
     * Calculate prediction using Bayesian fusion
     */
    calculatePrediction(xgboost, weather, ai, weights) {
        const weatherAdjusted = xgboost * weather;
        const aiAdjusted = xgboost * ai;
        
        return (
            weights.w_base * xgboost +
            weights.w_weather * weatherAdjusted +
            weights.w_ai * aiAdjusted
        );
    }

    /**
     * Get formula string for display
     */
    getFormulaString(weights) {
        return `${weights.w_base}×XGB + ${weights.w_weather}×Weather + ${weights.w_ai}×AI`;
    }

    /**
     * Describe AI impact in plain language
     */
    describeAIImpact(aiFactor) {
        const pctChange = ((aiFactor - 1) * 100).toFixed(1);
        if (aiFactor > 1.05) return `Major increase (+${pctChange}%)`;
        if (aiFactor > 1.0) return `Slight increase (+${pctChange}%)`;
        if (aiFactor < 0.95) return `Major decrease (${pctChange}%)`;
        if (aiFactor < 1.0) return `Slight decrease (${pctChange}%)`;
        return 'Neutral';
    }

    /**
     * Save dual-track predictions to database
     */
    async savePredictions(result) {
        const query = `
            INSERT INTO daily_predictions (
                prediction_date,
                predicted_attendance,
                prediction_production,
                prediction_experimental,
                xgboost_base,
                weather_factor,
                ai_factor,
                model_version,
                created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            ON CONFLICT (prediction_date) 
            DO UPDATE SET
                predicted_attendance = EXCLUDED.predicted_attendance,
                prediction_production = EXCLUDED.prediction_production,
                prediction_experimental = EXCLUDED.prediction_experimental,
                xgboost_base = EXCLUDED.xgboost_base,
                weather_factor = EXCLUDED.weather_factor,
                ai_factor = EXCLUDED.ai_factor,
                model_version = EXCLUDED.model_version,
                updated_at = NOW()
        `;
        
        await this.pool.query(query, [
            result.date,
            result.production.prediction, // Default to production
            result.production.prediction,
            result.experimental.prediction,
            result.xgboost_base,
            result.factors.weather,
            result.factors.ai,
            '3.0.82'
        ]);
        
        // Also save to AI validation table
        const validationQuery = `
            INSERT INTO ai_factor_validation (
                prediction_date,
                xgboost_base,
                production_pred,
                experimental_pred,
                ai_factor,
                weather_factor,
                event_description
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (prediction_date)
            DO UPDATE SET
                production_pred = EXCLUDED.production_pred,
                experimental_pred = EXCLUDED.experimental_pred,
                ai_factor = EXCLUDED.ai_factor,
                weather_factor = EXCLUDED.weather_factor,
                event_description = EXCLUDED.event_description
        `;
        
        await this.pool.query(validationQuery, [
            result.date,
            result.xgboost_base,
            result.production.prediction,
            result.experimental.prediction,
            result.factors.ai,
            result.factors.weather,
            result.ai_impact
        ]);
    }

    /**
     * Validate predictions when actual data arrives
     */
    async validatePrediction(date, actualAttendance) {
        // Get predictions
        const query = `
            SELECT 
                prediction_production,
                prediction_experimental,
                ai_factor
            FROM daily_predictions
            WHERE prediction_date = $1
        `;
        
        const result = await this.pool.query(query, [date]);
        if (result.rows.length === 0) {
            throw new Error(`No prediction found for ${date}`);
        }
        
        const pred = result.rows[0];
        const productionError = Math.abs(pred.prediction_production - actualAttendance);
        const experimentalError = Math.abs(pred.prediction_experimental - actualAttendance);
        const betterModel = experimentalError < productionError ? 'experimental' : 'production';
        const improvement = productionError - experimentalError;
        
        // Update prediction record
        const updateQuery = `
            UPDATE daily_predictions
            SET 
                actual_attendance = $1,
                production_error = $2,
                experimental_error = $3,
                better_model = $4,
                validation_date = NOW()
            WHERE prediction_date = $5
        `;
        
        await this.pool.query(updateQuery, [
            actualAttendance,
            productionError,
            experimentalError,
            betterModel,
            date
        ]);
        
        // Update AI validation table
        const validationUpdateQuery = `
            UPDATE ai_factor_validation
            SET 
                actual_attendance = $1,
                production_error = $2,
                experimental_error = $3,
                improvement = $4,
                validated_at = NOW()
            WHERE prediction_date = $5
        `;
        
        await this.pool.query(validationUpdateQuery, [
            actualAttendance,
            productionError,
            experimentalError,
            improvement,
            date
        ]);
        
        console.log(`✅ Validated ${date}: Production MAE=${productionError.toFixed(2)}, Experimental MAE=${experimentalError.toFixed(2)}, Winner=${betterModel}`);
        
        // Check if we should run optimization
        await this.checkOptimizationTrigger();
        
        return {
            date,
            actual: actualAttendance,
            production: {
                prediction: pred.prediction_production,
                error: productionError
            },
            experimental: {
                prediction: pred.prediction_experimental,
                error: experimentalError
            },
            winner: betterModel,
            improvement: improvement,
            improvement_pct: Math.round((improvement / productionError) * 1000) / 10
        };
    }

    /**
     * Check if we have enough data to trigger optimization
     */
    async checkOptimizationTrigger() {
        const query = `
            SELECT COUNT(*) as validated_count
            FROM daily_predictions
            WHERE validation_date IS NOT NULL
              AND prediction_date >= CURRENT_DATE - INTERVAL '${this.validationWindowDays} days'
        `;
        
        const result = await this.pool.query(query);
        const count = parseInt(result.rows[0].validated_count);
        
        if (count >= this.minSamplesForValidation && count % 10 === 0) {
            console.log(`🎯 Optimization trigger: ${count} validated samples. Running evaluation...`);
            // Trigger async optimization (don't wait)
            this.runOptimization().catch(err => 
                console.error('❌ Optimization failed:', err)
            );
        }
    }

    /**
     * Run weight optimization based on validation data
     */
    async runOptimization() {
        const { spawn } = require('child_process');
        
        return new Promise((resolve, reject) => {
            const process = spawn('python', [
                'python/optimize_bayesian_weights_adaptive.py'
            ]);
            
            let output = '';
            let errorOutput = '';
            
            process.stdout.on('data', (data) => {
                output += data.toString();
                console.log(data.toString());
            });
            
            process.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });
            
            process.on('close', (code) => {
                if (code === 0) {
                    console.log('✅ Weight optimization completed');
                    resolve(output);
                } else {
                    reject(new Error(`Optimization failed: ${errorOutput}`));
                }
            });
        });
    }

    /**
     * Get validation summary for dashboard
     */
    async getValidationSummary() {
        const query = `
            WITH recent_validations AS (
                SELECT 
                    COUNT(*) as total,
                    AVG(production_error) as prod_mae,
                    AVG(experimental_error) as exp_mae,
                    STDDEV(production_error) as prod_std,
                    STDDEV(experimental_error) as exp_std,
                    SUM(CASE WHEN better_model = 'experimental' THEN 1 ELSE 0 END) as exp_wins,
                    MIN(prediction_date) as first_date,
                    MAX(prediction_date) as last_date
                FROM daily_predictions
                WHERE validation_date IS NOT NULL
                  AND prediction_date >= CURRENT_DATE - INTERVAL '${this.validationWindowDays} days'
            ),
            latest_weights AS (
                SELECT *
                FROM weight_optimization_history
                ORDER BY optimization_date DESC
                LIMIT 1
            )
            SELECT 
                rv.*,
                lw.w_base_new as current_w_base,
                lw.w_weather_new as current_w_weather,
                lw.w_ai_new as current_w_ai,
                lw.optimization_date as last_optimization,
                lw.improvement_percentage as last_improvement
            FROM recent_validations rv
            CROSS JOIN latest_weights lw
        `;
        
        const result = await this.pool.query(query);
        const stats = result.rows[0];
        
        if (!stats || stats.total === 0) {
            return {
                status: 'collecting_data',
                message: `Collecting validation data (${this.minSamplesForValidation} samples needed)`,
                samples: 0
            };
        }
        
        const improvement = stats.prod_mae - stats.exp_mae;
        const improvementPct = (improvement / stats.prod_mae) * 100;
        const winRate = (stats.exp_wins / stats.total) * 100;
        
        return {
            status: stats.total >= this.minSamplesForValidation ? 'ready_for_optimization' : 'collecting_data',
            samples: {
                total: parseInt(stats.total),
                required: this.minSamplesForValidation,
                date_range: `${stats.first_date} to ${stats.last_date}`
            },
            production: {
                mae: parseFloat(stats.prod_mae).toFixed(3),
                std: parseFloat(stats.prod_std).toFixed(3)
            },
            experimental: {
                mae: parseFloat(stats.exp_mae).toFixed(3),
                std: parseFloat(stats.exp_std).toFixed(3),
                wins: parseInt(stats.exp_wins),
                win_rate: winRate.toFixed(1) + '%'
            },
            improvement: {
                absolute: improvement.toFixed(3),
                percentage: improvementPct.toFixed(2) + '%',
                better: improvement > 0 ? 'experimental' : 'production'
            },
            current_weights: {
                w_base: parseFloat(stats.current_w_base),
                w_weather: parseFloat(stats.current_w_weather),
                w_ai: parseFloat(stats.current_w_ai)
            },
            last_optimization: stats.last_optimization,
            recommendation: this.getRecommendation(improvementPct, parseInt(stats.total), winRate)
        };
    }

    /**
     * Generate recommendation based on validation stats
     */
    getRecommendation(improvementPct, samples, winRate) {
        if (samples < this.minSamplesForValidation) {
            return `Continue collecting data (${samples}/${this.minSamplesForValidation} samples)`;
        }
        
        if (improvementPct > 5 && winRate > 60) {
            return `Strong evidence for AI factor (${improvementPct.toFixed(1)}% improvement, ${winRate.toFixed(0)}% win rate). Recommend enabling w_AI=0.10`;
        } else if (improvementPct > 2 && winRate > 55) {
            return `Moderate evidence for AI factor (${improvementPct.toFixed(1)}% improvement). Consider enabling w_AI=0.05`;
        } else if (improvementPct < -5) {
            return `AI factor decreases performance (${Math.abs(improvementPct).toFixed(1)}% worse). Keep w_AI=0.00`;
        } else {
            return `Inconclusive results. Continue monitoring (${samples} samples, ${improvementPct.toFixed(1)}% improvement)`;
        }
    }
}

module.exports = DualTrackPredictor;

