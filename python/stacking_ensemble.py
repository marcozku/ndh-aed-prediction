"""
Stacking Ensemble 模型
使用多個基模型的預測作為元特徵，訓練元學習器

預期改善: MAE 15.77 → 14.5 (約 8% 改善)
"""
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.linear_model import Ridge, Lasso, ElasticNet
from sklearn.model_selection import TimeSeriesSplit, cross_val_score
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import json
import os
from datetime import datetime

try:
    from lightgbm import LGBMRegressor
    LIGHTGBM_AVAILABLE = True
except:
    LIGHTGBM_AVAILABLE = False

try:
    import catboost
    from catboost import CatBoostRegressor
    CATBOOST_AVAILABLE = True
except:
    CATBOOST_AVAILABLE = False


class StackingEnsemble:
    """
    Stacking Ensemble 預測器

    第一層 (Base Models):
    - XGBoost
    - LightGBM (如果可用)
    - Random Forest
    - Gradient Boosting
    - CatBoost (如果可用)

    第二層 (Meta Learner):
    - Ridge Regression (L2 正則化)
    - 選項: ElasticNet, XGBoost meta-learner
    """

    def __init__(self, use_meta='ridge'):
        self.use_meta = use_meta
        self.base_models = {}
        self.meta_model = None
        self.feature_cols = None

    def _get_base_models(self):
        """定義基模型"""
        models = {
            'xgboost': xgb.XGBRegressor(
                n_estimators=500,
                max_depth=8,
                learning_rate=0.05,
                subsample=0.85,
                colsample_bytree=0.85,
                objective='reg:squarederror',
                tree_method='hist',
                random_state=42,
                n_jobs=-1
            ),
            'randomforest': RandomForestRegressor(
                n_estimators=200,
                max_depth=12,
                min_samples_split=10,
                random_state=42,
                n_jobs=-1
            ),
            'gradientboosting': GradientBoostingRegressor(
                n_estimators=200,
                max_depth=6,
                learning_rate=0.05,
                random_state=42
            )
        }

        if LIGHTGBM_AVAILABLE:
            models['lightgbm'] = LGBMRegressor(
                n_estimators=300,
                max_depth=8,
                learning_rate=0.05,
                random_state=42,
                verbose=-1,
                n_jobs=-1
            )

        if CATBOOST_AVAILABLE:
            models['catboost'] = CatBoostRegressor(
                iterations=500,
                depth=8,
                learning_rate=0.05,
                random_state=42,
                verbose=False
            )

        return models

    def _get_meta_model(self):
        """定義元學習器"""
        if self.use_meta == 'ridge':
            return Ridge(alpha=1.0)
        elif self.use_meta == 'elasticnet':
            return ElasticNet(alpha=0.5, l1_ratio=0.5)
        elif self.use_meta == 'xgboost':
            return xgb.XGBRegressor(
                n_estimators=100,
                max_depth=3,
                learning_rate=0.1,
                objective='reg:squarederror',
                random_state=42
            )
        else:
            return Ridge(alpha=1.0)

    def fit(self, X_train, y_train, X_val=None, y_val=None):
        """
        訓練 Stacking Ensemble

        使用 Out-of-Fold 預測作為元特徵，避免數據洩漏
        """
        print(f"\n{'='*60}")
        print("🔗 訓練 Stacking Ensemble")
        print(f"{'='*60}")

        self.feature_cols = X_train.columns.tolist()
        base_models = self._get_base_models()

        # ========================================
        # 第一層: 訓練基模型
        # ========================================
        print(f"\n📊 第一層: 訓練 {len(base_models)} 個基模型")

        for name, model in base_models.items():
            print(f"   訓練 {name}...", end=" ")

            if name == 'catboost' and CATBOOST_AVAILABLE:
                # CatBoost 直接處理 NaN
                model.fit(X_train, y_train, eval_set=(X_val, y_val) if X_val is not None else None)
            elif name == 'xgboost':
                model.fit(X_train, y_train, verbose=False)
            else:
                # RandomForest 和 GradientBoosting 不接受 verbose 參數
                model.fit(X_train, y_train)

            self.base_models[name] = model

            # 計算訓練集 MAE
            train_pred = model.predict(X_train)
            train_mae = mean_absolute_error(y_train, train_pred)
            print(f"MAE={train_mae:.2f}")

        # ========================================
        # 第二層: 準備元特徵 (Out-of-Fold)
        # ========================================
        print(f"\n📊 第二層: 生成 Out-of-Fold 元特徵")

        # 使用 TimeSeriesSplit 生成 OOF 預測
        n_splits = 5
        tscv = TimeSeriesSplit(n_splits=n_splits)

        # 初始化 OOF 預測數組
        oof_predictions = np.zeros((len(X_train), len(base_models)))
        model_names = list(base_models.keys())

        for fold_idx, (train_idx, val_idx) in enumerate(tscv.split(X_train)):
            print(f"   Fold {fold_idx + 1}/{n_splits}: 訓練 {len(train_idx)}, 驗證 {len(val_idx)}", end=" ")

            X_fold_train = X_train.iloc[train_idx] if hasattr(X_train, 'iloc') else X_train[train_idx]
            y_fold_train = y_train[train_idx] if isinstance(y_train, np.ndarray) else y_train.iloc[train_idx]
            X_fold_val = X_train.iloc[val_idx] if hasattr(X_train, 'iloc') else X_train[val_idx]

            for i, (name, model_template) in enumerate(base_models.items()):
                # 創建新模型實例
                if name == 'xgboost':
                    model = xgb.XGBRegressor(
                        n_estimators=300, max_depth=6, learning_rate=0.1,
                        objective='reg:squarederror', random_state=42, n_jobs=-1
                    )
                elif name == 'randomforest':
                    model = RandomForestRegressor(
                        n_estimators=100, max_depth=10, random_state=42, n_jobs=-1
                    )
                elif name == 'gradientboosting':
                    model = GradientBoostingRegressor(
                        n_estimators=100, max_depth=5, learning_rate=0.1, random_state=42
                    )
                elif name == 'lightgbm' and LIGHTGBM_AVAILABLE:
                    model = LGBMRegressor(
                        n_estimators=100, max_depth=6, learning_rate=0.1,
                        random_state=42, verbose=-1, n_jobs=-1
                    )
                elif name == 'catboost' and CATBOOST_AVAILABLE:
                    model = CatBoostRegressor(
                        iterations=100, depth=6, learning_rate=0.1,
                        random_state=42, verbose=False
                    )
                else:
                    continue

                # 根據模型類型決定是否使用 verbose 參數
                if name in ['xgboost', 'lightgbm']:
                    model.fit(X_fold_train, y_fold_train, verbose=False)
                elif name == 'catboost':
                    model.fit(X_fold_train, y_fold_train, verbose=False)
                else:
                    model.fit(X_fold_train, y_fold_train)

                oof_predictions[val_idx, i] = model.predict(X_fold_val)

            print("✓")

        # ========================================
        # 第三層: 訓練元學習器
        # ========================================
        print(f"\n📊 第三層: 訓練元學習器 ({self.use_meta})")

        # 添加原始特徵作為輔助 (可選)
        meta_X_train = oof_predictions
        meta_feature_names = [f'{name}_pred' for name in model_names]

        # 訓練元學習器
        self.meta_model = self._get_meta_model()
        self.meta_model.fit(meta_X_train, y_train)

        print(f"   元特徵: {meta_feature_names}")
        print(f"   元學習器: {self.meta_model.__class__.__name__}")

        # 顯示元學習器權重 (如果是線性模型)
        if hasattr(self.meta_model, 'coef_'):
            print(f"\n   元學習器權重:")
            for name, weight in zip(model_names, self.meta_model.coef_):
                print(f"      {name}: {weight:.4f}")

        return self

    def predict(self, X):
        """預測"""
        # 第一層: 獲取基模型預測
        base_predictions = []
        for name in self._get_base_models().keys():
            if name in self.base_models:
                pred = self.base_models[name].predict(X)
                base_predictions.append(pred)

        # 堆疊成元特徵
        meta_X = np.column_stack(base_predictions)

        # 第二層: 元學習器預測
        prediction = self.meta_model.predict(meta_X)

        return prediction

    def predict_with_base(self, X):
        """返回基模型預測和最終預測"""
        base_preds = {}
        for name, model in self.base_models.items():
            base_preds[name] = model.predict(X)

        # 最終預測
        final_pred = self.predict(X)

        return {
            'final': final_pred,
            'base_predictions': base_preds
        }


def train_and_evaluate_stacking(train_data, test_data, feature_cols, use_meta='ridge'):
    """
    訓練並評估 Stacking Ensemble
    """
    X_train = train_data[feature_cols].fillna(0)
    y_train = train_data['Attendance'].values
    X_test = test_data[feature_cols].fillna(0)
    y_test = test_data['Attendance'].values

    # 創建驗證集
    val_size = len(X_train) // 5
    X_val = X_train[-val_size:]
    y_val = y_train[-val_size:]
    X_train_sub = X_train[:-val_size]
    y_train_sub = y_train[:-val_size]

    # 訓練 Stacking
    stacking = StackingEnsemble(use_meta=use_meta)
    stacking.fit(X_train_sub, y_train_sub, X_val, y_val)

    # 預測
    results = stacking.predict_with_base(X_test)

    # 評估
    final_pred = results['final']
    mae = mean_absolute_error(y_test, final_pred)
    rmse = np.sqrt(mean_squared_error(y_test, final_pred))
    r2 = r2_score(y_test, final_pred)

    print(f"\n{'='*60}")
    print(f"📊 Stacking Ensemble 結果")
    print(f"{'='*60}")
    print(f"   MAE:  {mae:.2f}")
    print(f"   RMSE: {rmse:.2f}")
    print(f"   R²:   {r2:.4f}")

    # 輸出基模型結果
    print(f"\n   基模型比較:")
    for name, pred in results['base_predictions'].items():
        mae_base = mean_absolute_error(y_test, pred)
        print(f"      {name}: MAE = {mae_base:.2f}")

    return stacking, {
        'mae': mae,
        'rmse': rmse,
        'r2': r2,
        'base_predictions': {k: mean_absolute_error(y_test, v) for k, v in results['base_predictions'].items()}
    }


def compare_all_ensembles(train_data, test_data, feature_cols):
    """
    比較所有 Ensemble 方法
    """
    print("\n" + "=" * 80)
    print("🔬 比較所有 Ensemble 方法")
    print("=" * 80)

    results = {}

    X_train = train_data[feature_cols].fillna(0)
    y_train = train_data['Attendance'].values
    X_test = test_data[feature_cols].fillna(0)
    y_test = test_data['Attendance'].values

    # ========================================
    # 1. Simple Average
    # ========================================
    print("\n1️⃣ Simple Average Ensemble")

    base_models = {
        'xgboost': xgb.XGBRegressor(n_estimators=500, max_depth=8, learning_rate=0.05,
                                     objective='reg:squarederror', random_state=42, n_jobs=-1),
        'randomforest': RandomForestRegressor(n_estimators=200, max_depth=12, random_state=42, n_jobs=-1),
        'gradientboosting': GradientBoostingRegressor(n_estimators=200, max_depth=6, learning_rate=0.05, random_state=42)
    }

    base_preds = {}
    for name, model in base_models.items():
        if name == 'xgboost':
            model.fit(X_train, y_train, verbose=False)
        else:
            model.fit(X_train, y_train)
        base_preds[name] = model.predict(X_test)

    # Simple Average
    simple_avg = np.mean(list(base_preds.values()), axis=0)
    mae_simple = mean_absolute_error(y_test, simple_avg)

    print(f"   MAE: {mae_simple:.2f}")
    results['simple_average'] = {'mae': mae_simple, 'predictions': simple_avg}

    # ========================================
    # 2. Weighted Average (驗證集優化)
    # ========================================
    print("\n2️⃣ Weighted Average Ensemble")

    val_size = len(X_train) // 5
    X_val = X_train[-val_size:]
    y_val = y_train[-val_size:]
    X_train_sub = X_train[:-val_size]
    y_train_sub = y_train[:-val_size]

    # 在驗證集上評估
    val_mae = {}
    val_preds = {}
    for name, model_template in base_models.items():
        if name == 'xgboost':
            model = xgb.XGBRegressor(n_estimators=300, max_depth=6, learning_rate=0.1,
                                     objective='reg:squarederror', random_state=42, n_jobs=-1)
        elif name == 'randomforest':
            model = RandomForestRegressor(n_estimators=100, max_depth=10, random_state=42, n_jobs=-1)
        else:
            model = GradientBoostingRegressor(n_estimators=100, max_depth=5, learning_rate=0.1, random_state=42)

        model.fit(X_train_sub, y_train_sub)
        val_preds[name] = model.predict(X_val)
        val_mae[name] = mean_absolute_error(y_val, val_preds[name])

    # 計算權重 (誤差越小權重越大)
    weights = {k: 1/v for k, v in val_mae.items()}
    total_weight = sum(weights.values())
    weights = {k: v/total_weight for k, v in weights.items()}

    print(f"   權重: {weights}")

    weighted_pred = (
        weights['xgboost'] * base_preds['xgboost'] +
        weights['randomforest'] * base_preds['randomforest'] +
        weights['gradientboosting'] * base_preds['gradientboosting']
    )
    mae_weighted = mean_absolute_error(y_test, weighted_pred)

    print(f"   MAE: {mae_weighted:.2f}")
    results['weighted_average'] = {'mae': mae_weighted, 'predictions': weighted_pred, 'weights': weights}

    # ========================================
    # 3. Stacking (Ridge)
    # ========================================
    print("\n3️⃣ Stacking Ensemble (Ridge)")

    stacking_ridge, metrics_ridge = train_and_evaluate_stacking(
        train_data, test_data, feature_cols, use_meta='ridge'
    )
    results['stacking_ridge'] = metrics_ridge

    # ========================================
    # 4. Stacking (ElasticNet)
    # ========================================
    print("\n4️⃣ Stacking Ensemble (ElasticNet)")

    stacking_enet, metrics_enet = train_and_evaluate_stacking(
        train_data, test_data, feature_cols, use_meta='elasticnet'
    )
    results['stacking_elasticnet'] = metrics_enet

    # ========================================
    # 總結
    # ========================================
    print("\n" + "=" * 80)
    print("🏆 Ensemble 方法比較")
    print("=" * 80)

    sorted_results = sorted(results.items(), key=lambda x: x[1]['mae'])

    for name, result in sorted_results:
        print(f"   {name:25} MAE = {result['mae']:.2f}")

    best_name, best_result = sorted_results[0]
    print(f"\n   最佳方法: {best_name}")

    return results, sorted_results[0]


if __name__ == '__main__':
    # 測試代碼
    print("Stacking Ensemble 模組 v1.0")
    print("請使用主腳本調用此模組")
