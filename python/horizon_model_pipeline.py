"""
Direct multi-horizon XGBoost pipeline for NDH AED attendance prediction.

Design goals:
1. Use database-only actual_data as the source of truth.
2. Train direct models by operational horizon buckets instead of recursive rollout.
3. Enforce a baseline gate so new models must beat simple transparent baselines.
4. Reuse one feature pipeline for training, evaluation, single-date inference, and batch inference.
"""

from __future__ import annotations

import json
import math
import os
import warnings
from bisect import bisect_left
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

import numpy as np
import pandas as pd
import psycopg2
import xgboost as xgb
from dotenv import load_dotenv
from sklearn.metrics import mean_absolute_error, mean_squared_error


ROOT_DIR = Path(__file__).resolve().parents[1]
PYTHON_DIR = ROOT_DIR / "python"
MODELS_DIR = PYTHON_DIR / "models"
HOLIDAYS_PATH = PYTHON_DIR / "hk_public_holidays.json"

PIPELINE_VERSION = "5.0.00"
MODEL_FAMILY = "horizon_direct_xgboost"
MAX_HORIZON = 30
MIN_HISTORY_DAYS = 84
DEFAULT_RECENT_ROWS = 1600
DEFAULT_VALIDATION_CUTOFFS = 180
DEFAULT_GATE_MARGIN = 0.01

MODEL_BUNDLE_FILENAME = "horizon_model_bundle.json"
WALK_FORWARD_REPORT_FILENAME = "horizon_walk_forward_report.json"
SUMMARY_METRICS_FILENAME = "xgboost_metrics.json"


@dataclass(frozen=True)
class HorizonBucket:
    name: str
    label: str
    min_horizon: int
    max_horizon: int
    model_file: str

    def contains(self, horizon: int) -> bool:
        return self.min_horizon <= horizon <= self.max_horizon


HORIZON_BUCKETS: Tuple[HorizonBucket, ...] = (
    HorizonBucket("short", "H0/H1", 1, 2, "horizon_short_model.json"),
    HorizonBucket("h7", "H2-H7", 3, 7, "horizon_h7_model.json"),
    HorizonBucket("h14", "H8-H14", 8, 14, "horizon_h14_model.json"),
    HorizonBucket("h30", "H15-H30", 15, 30, "horizon_h30_model.json"),
)


FEATURE_COLUMNS: List[str] = [
    "horizon",
    "origin_dow",
    "origin_month",
    "target_dow",
    "target_month",
    "target_dom",
    "target_is_weekend",
    "target_dow_sin",
    "target_dow_cos",
    "target_month_sin",
    "target_month_cos",
    "target_is_holiday",
    "days_to_next_holiday",
    "days_since_prev_holiday",
    "last_value",
    "lag2",
    "lag7",
    "lag14",
    "lag28",
    "lag56",
    "ewma7",
    "ewma14",
    "ewma28",
    "roll7",
    "roll14",
    "roll28",
    "roll56",
    "std7",
    "std14",
    "std28",
    "trend_7_28",
    "trend_14_56",
    "delta_1_7",
    "delta_7_14",
    "recent_mean_84",
    "dow_recent_mean",
    "seasonal_baseline",
    "seasonal_gap",
    "dow_gap",
]

BASELINE_COLUMNS: Tuple[str, ...] = (
    "baseline_last",
    "baseline_weekday_mean",
    "baseline_seasonal",
)


class TrainingGateError(RuntimeError):
    """Raised when a bucket model fails the baseline gate."""


def load_actual_data_from_db() -> pd.DataFrame:
    """Load NDH AED actual data from PostgreSQL only."""
    load_dotenv(ROOT_DIR / ".env")

    database_url = os.getenv("DATABASE_URL")
    if database_url:
        conn = psycopg2.connect(database_url)
    else:
        conn = psycopg2.connect(
            host=os.getenv("PGHOST"),
            port=os.getenv("PGPORT"),
            user=os.getenv("PGUSER"),
            password=os.getenv("PGPASSWORD"),
            database=os.getenv("PGDATABASE"),
            sslmode="require",
        )

    query = 'SELECT date AS "Date", patient_count AS "Attendance" FROM actual_data ORDER BY date ASC'
    try:
        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore",
                message=".*pandas only supports SQLAlchemy.*",
            )
            df = pd.read_sql_query(query, conn)
    finally:
        conn.close()

    df["Date"] = pd.to_datetime(df["Date"])
    df["Attendance"] = pd.to_numeric(df["Attendance"], errors="coerce")
    df = df.dropna(subset=["Attendance"]).sort_values("Date").reset_index(drop=True)
    return df


def load_holiday_set() -> set:
    with open(HOLIDAYS_PATH, "r", encoding="utf-8") as handle:
        holiday_data = json.load(handle)
    return {
        pd.Timestamp(date_str).date()
        for _, date_list in holiday_data.get("holidays", {}).items()
        for date_str in date_list
    }


def _holiday_ordinals(holiday_set: Iterable) -> List[int]:
    return sorted(pd.Timestamp(day).date().toordinal() for day in holiday_set)


def holiday_distance_features(target_date: pd.Timestamp, holiday_ordinals: List[int]) -> Tuple[int, int]:
    target_ordinal = target_date.date().toordinal()
    idx = bisect_left(holiday_ordinals, target_ordinal)

    if idx < len(holiday_ordinals):
        next_holiday = holiday_ordinals[idx]
    else:
        next_holiday = holiday_ordinals[-1]

    if idx > 0:
        prev_holiday = holiday_ordinals[idx - 1]
    else:
        prev_holiday = holiday_ordinals[0]

    days_to_next = max(0, min(60, next_holiday - target_ordinal))
    days_since_prev = max(0, min(60, target_ordinal - prev_holiday))
    return days_to_next, days_since_prev


def get_bucket_for_horizon(horizon: int) -> HorizonBucket:
    clipped = int(max(1, min(MAX_HORIZON, horizon)))
    for bucket in HORIZON_BUCKETS:
        if bucket.contains(clipped):
            return bucket
    return HORIZON_BUCKETS[-1]


def _metric_summary(actual: np.ndarray, predicted: np.ndarray) -> Dict[str, float]:
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    residual = predicted - actual
    mae = mean_absolute_error(actual, predicted)
    rmse = math.sqrt(mean_squared_error(actual, predicted))
    mape = float(np.mean(np.abs(residual / actual)) * 100)
    bias = float(np.mean(residual))
    return {
        "mae": round(float(mae), 4),
        "rmse": round(float(rmse), 4),
        "mape": round(float(mape), 4),
        "bias": round(float(bias), 4),
    }


def _residual_quantiles(actual: np.ndarray, predicted: np.ndarray) -> Dict[str, Dict[str, float]]:
    residual = np.asarray(actual, dtype=float) - np.asarray(predicted, dtype=float)
    if residual.size == 0:
        return {
            "ci80": {"low_offset": -20.0, "high_offset": 20.0},
            "ci95": {"low_offset": -30.0, "high_offset": 30.0},
        }

    return {
        "ci80": {
            "low_offset": round(float(np.quantile(residual, 0.10)), 4),
            "high_offset": round(float(np.quantile(residual, 0.90)), 4),
        },
        "ci95": {
            "low_offset": round(float(np.quantile(residual, 0.025)), 4),
            "high_offset": round(float(np.quantile(residual, 0.975)), 4),
        },
    }


def _build_time_series_cache(values: np.ndarray) -> Dict[str, np.ndarray]:
    series = pd.Series(values, dtype=float)
    return {
        "ewma7": series.ewm(span=7, adjust=False).mean().to_numpy(),
        "ewma14": series.ewm(span=14, adjust=False).mean().to_numpy(),
        "ewma28": series.ewm(span=28, adjust=False).mean().to_numpy(),
        "roll7": series.rolling(7, min_periods=1).mean().to_numpy(),
        "roll14": series.rolling(14, min_periods=1).mean().to_numpy(),
        "roll28": series.rolling(28, min_periods=1).mean().to_numpy(),
        "roll56": series.rolling(56, min_periods=1).mean().to_numpy(),
        "std7": series.rolling(7, min_periods=2).std().fillna(0).to_numpy(),
        "std14": series.rolling(14, min_periods=2).std().fillna(0).to_numpy(),
        "std28": series.rolling(28, min_periods=2).std().fillna(0).to_numpy(),
    }


def build_training_examples(
    df: pd.DataFrame,
    holiday_set: set,
    recent_rows: int = DEFAULT_RECENT_ROWS,
    min_history_days: int = MIN_HISTORY_DAYS,
) -> Dict[str, pd.DataFrame]:
    if recent_rows and len(df) > recent_rows:
        df = df.tail(recent_rows).reset_index(drop=True)
    else:
        df = df.reset_index(drop=True)

    values = df["Attendance"].astype(float).to_numpy()
    dates = pd.to_datetime(df["Date"])
    dows = dates.dt.dayofweek.to_numpy()
    months = dates.dt.month.to_numpy()
    cache = _build_time_series_cache(values)
    holiday_ordinals = _holiday_ordinals(holiday_set)

    records: Dict[str, List[Dict[str, float]]] = {bucket.name: [] for bucket in HORIZON_BUCKETS}
    recent_by_dow = {dow: deque(maxlen=12) for dow in range(7)}
    recent_all = deque(maxlen=84)

    for cutoff_idx in range(len(values)):
        value = float(values[cutoff_idx])
        current_dow = int(dows[cutoff_idx])
        recent_by_dow[current_dow].append(value)
        recent_all.append(value)

        if cutoff_idx < min_history_days or cutoff_idx + MAX_HORIZON >= len(values):
            continue

        base = {
            "cutoff_date": dates.iloc[cutoff_idx],
            "origin_dow": current_dow,
            "origin_month": int(months[cutoff_idx]),
            "last_value": value,
            "lag2": float(values[cutoff_idx - 1]),
            "lag7": float(values[cutoff_idx - 6]),
            "lag14": float(values[cutoff_idx - 13]),
            "lag28": float(values[cutoff_idx - 27]),
            "lag56": float(values[cutoff_idx - 55]),
            "ewma7": float(cache["ewma7"][cutoff_idx]),
            "ewma14": float(cache["ewma14"][cutoff_idx]),
            "ewma28": float(cache["ewma28"][cutoff_idx]),
            "roll7": float(cache["roll7"][cutoff_idx]),
            "roll14": float(cache["roll14"][cutoff_idx]),
            "roll28": float(cache["roll28"][cutoff_idx]),
            "roll56": float(cache["roll56"][cutoff_idx]),
            "std7": float(cache["std7"][cutoff_idx]),
            "std14": float(cache["std14"][cutoff_idx]),
            "std28": float(cache["std28"][cutoff_idx]),
            "trend_7_28": float(cache["roll7"][cutoff_idx] - cache["roll28"][cutoff_idx]),
            "trend_14_56": float(cache["roll14"][cutoff_idx] - cache["roll56"][cutoff_idx]),
            "delta_1_7": float(value - values[cutoff_idx - 6]),
            "delta_7_14": float(values[cutoff_idx - 6] - values[cutoff_idx - 13]),
            "recent_mean_84": float(np.mean(recent_all)),
        }

        for horizon in range(1, MAX_HORIZON + 1):
            target_idx = cutoff_idx + horizon
            target_date = dates.iloc[target_idx]
            target_dow = int(dows[target_idx])
            target_month = int(months[target_idx])

            target_dow_history = list(recent_by_dow[target_dow])
            seasonal_baseline = float(target_dow_history[-1]) if target_dow_history else base["last_value"]
            dow_recent_mean = float(np.mean(target_dow_history)) if target_dow_history else base["roll28"]
            days_to_next_holiday, days_since_prev_holiday = holiday_distance_features(target_date, holiday_ordinals)

            row = dict(base)
            row.update(
                {
                    "horizon": horizon,
                    "target_dow": target_dow,
                    "target_month": target_month,
                    "target_dom": int(target_date.day),
                    "target_is_weekend": 1 if target_dow >= 5 else 0,
                    "target_dow_sin": float(np.sin(2 * np.pi * target_dow / 7)),
                    "target_dow_cos": float(np.cos(2 * np.pi * target_dow / 7)),
                    "target_month_sin": float(np.sin(2 * np.pi * target_month / 12)),
                    "target_month_cos": float(np.cos(2 * np.pi * target_month / 12)),
                    "target_is_holiday": 1 if target_date.date() in holiday_set else 0,
                    "days_to_next_holiday": days_to_next_holiday,
                    "days_since_prev_holiday": days_since_prev_holiday,
                    "dow_recent_mean": dow_recent_mean,
                    "seasonal_baseline": seasonal_baseline,
                    "seasonal_gap": float(seasonal_baseline - base["recent_mean_84"]),
                    "dow_gap": float(dow_recent_mean - base["recent_mean_84"]),
                    "target": float(values[target_idx]),
                    "baseline_last": base["last_value"],
                    "baseline_weekday_mean": dow_recent_mean,
                    "baseline_seasonal": seasonal_baseline,
                }
            )

            bucket = get_bucket_for_horizon(horizon)
            records[bucket.name].append(row)

    return {bucket_name: pd.DataFrame(rows) for bucket_name, rows in records.items()}


def _bucket_params() -> Dict[str, float]:
    return {
        "objective": "reg:squarederror",
        "eval_metric": "mae",
        "learning_rate": 0.04,
        "max_depth": 5,
        "min_child_weight": 4,
        "subsample": 0.85,
        "colsample_bytree": 0.85,
        "reg_alpha": 0.2,
        "reg_lambda": 1.5,
        "tree_method": "hist",
        "random_state": 42,
    }


def train_horizon_models(
    recent_rows: int = DEFAULT_RECENT_ROWS,
    validation_cutoffs: int = DEFAULT_VALIDATION_CUTOFFS,
    gate_margin: float = DEFAULT_GATE_MARGIN,
    allow_gate_fail: bool = False,
) -> Dict[str, object]:
    df = load_actual_data_from_db()
    holiday_set = load_holiday_set()
    datasets = build_training_examples(
        df=df,
        holiday_set=holiday_set,
        recent_rows=recent_rows,
        min_history_days=MIN_HISTORY_DAYS,
    )

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    training_timestamp = datetime.now().isoformat(timespec="seconds")
    bundle = {
        "version": PIPELINE_VERSION,
        "model_family": MODEL_FAMILY,
        "training_date": training_timestamp,
        "source": "database_only",
        "source_table": "actual_data",
        "recent_rows": recent_rows,
        "min_history_days": MIN_HISTORY_DAYS,
        "validation_cutoffs": validation_cutoffs,
        "gate_margin": gate_margin,
        "feature_columns": FEATURE_COLUMNS,
        "buckets": {},
        "summary": {},
    }

    report = {
        "version": PIPELINE_VERSION,
        "model_family": MODEL_FAMILY,
        "generated_at": training_timestamp,
        "source": {
            "table": "actual_data",
            "rows": int(len(df)),
            "min_date": str(df["Date"].min().date()),
            "max_date": str(df["Date"].max().date()),
        },
        "recent_rows": recent_rows,
        "validation_cutoffs": validation_cutoffs,
        "gate_margin": gate_margin,
        "buckets": {},
    }

    total_weight = 0.0
    weighted_mae = 0.0
    weighted_rmse = 0.0
    weighted_mape = 0.0
    weighted_best_baseline = 0.0
    gating_failures: List[str] = []
    params = _bucket_params()

    for bucket in HORIZON_BUCKETS:
        bucket_df = datasets[bucket.name].copy()
        if bucket_df.empty:
            message = f"{bucket.name} has no training examples"
            gating_failures.append(message)
            report["buckets"][bucket.name] = {"error": message}
            continue

        cutoff_dates = pd.to_datetime(bucket_df["cutoff_date"]).sort_values().unique()
        split_index = max(1, len(cutoff_dates) - validation_cutoffs)
        val_cutoff_start = cutoff_dates[split_index]

        train_df = bucket_df[bucket_df["cutoff_date"] < val_cutoff_start].copy()
        val_df = bucket_df[bucket_df["cutoff_date"] >= val_cutoff_start].copy()

        if train_df.empty or val_df.empty:
            message = f"{bucket.name} split produced empty train/validation"
            gating_failures.append(message)
            report["buckets"][bucket.name] = {"error": message}
            continue

        model = xgb.XGBRegressor(
            n_estimators=600,
            early_stopping_rounds=40,
            **params,
        )
        model.fit(
            train_df[FEATURE_COLUMNS],
            train_df["target"],
            eval_set=[(val_df[FEATURE_COLUMNS], val_df["target"])],
            verbose=False,
        )

        val_pred = model.predict(val_df[FEATURE_COLUMNS])
        metrics = _metric_summary(val_df["target"].to_numpy(), val_pred)

        baseline_metrics: Dict[str, Dict[str, float]] = {}
        best_baseline_name = None
        best_baseline_mae = None
        for baseline_col in BASELINE_COLUMNS:
            baseline_name = baseline_col.replace("baseline_", "")
            baseline_summary = _metric_summary(val_df["target"].to_numpy(), val_df[baseline_col].to_numpy())
            baseline_metrics[baseline_name] = baseline_summary
            if best_baseline_mae is None or baseline_summary["mae"] < best_baseline_mae:
                best_baseline_mae = baseline_summary["mae"]
                best_baseline_name = baseline_name

        gate_passed = metrics["mae"] <= (best_baseline_mae * (1 - gate_margin))
        gate_delta = round(best_baseline_mae - metrics["mae"], 4)
        if not gate_passed:
            gating_failures.append(
                f"{bucket.label} gate failed: model MAE {metrics['mae']:.4f} vs best baseline {best_baseline_name} {best_baseline_mae:.4f}"
            )

        residual_ci = _residual_quantiles(val_df["target"].to_numpy(), val_pred)
        per_horizon = {}
        val_indices = val_df.index.to_list()
        val_lookup = {idx: pos for pos, idx in enumerate(val_indices)}
        for horizon in sorted(val_df["horizon"].unique()):
            horizon_slice = val_df[val_df["horizon"] == horizon]
            positions = [val_lookup[idx] for idx in horizon_slice.index]
            horizon_pred = val_pred[positions]
            horizon_metrics = _metric_summary(horizon_slice["target"].to_numpy(), horizon_pred)
            horizon_ci = _residual_quantiles(horizon_slice["target"].to_numpy(), horizon_pred)
            per_horizon[str(int(horizon))] = {
                "metrics": horizon_metrics,
                "residual_ci": horizon_ci,
            }

        importance_pairs = sorted(
            zip(FEATURE_COLUMNS, model.feature_importances_),
            key=lambda item: item[1],
            reverse=True,
        )
        top_features = [
            {"feature": name, "importance": round(float(score), 6)}
            for name, score in importance_pairs[:12]
        ]

        model_path = MODELS_DIR / bucket.model_file
        booster = model.get_booster()
        booster.save_model(model_path)

        bucket_report = {
            "label": bucket.label,
            "train_rows": int(len(train_df)),
            "validation_rows": int(len(val_df)),
            "validation_cutoff_start": str(pd.Timestamp(val_cutoff_start).date()),
            "metrics": metrics,
            "baseline_metrics": baseline_metrics,
            "best_baseline": {
                "name": best_baseline_name,
                "mae": round(float(best_baseline_mae), 4),
            },
            "gate": {
                "passed": gate_passed,
                "margin_required": gate_margin,
                "improvement_vs_best_baseline": gate_delta,
            },
            "residual_ci": residual_ci,
            "per_horizon": per_horizon,
            "top_features": top_features,
            "best_iteration": int(model.best_iteration if model.best_iteration is not None else model.n_estimators),
            "model_file": bucket.model_file,
        }
        report["buckets"][bucket.name] = bucket_report
        bundle["buckets"][bucket.name] = bucket_report

        weight = float(len(val_df))
        total_weight += weight
        weighted_mae += metrics["mae"] * weight
        weighted_rmse += metrics["rmse"] * weight
        weighted_mape += metrics["mape"] * weight
        weighted_best_baseline += float(best_baseline_mae) * weight

    overall_metrics = {
        "mae": round(weighted_mae / total_weight, 4) if total_weight else None,
        "rmse": round(weighted_rmse / total_weight, 4) if total_weight else None,
        "mape": round(weighted_mape / total_weight, 4) if total_weight else None,
        "best_baseline_mae": round(weighted_best_baseline / total_weight, 4) if total_weight else None,
        "gate_passed": len(gating_failures) == 0,
    }
    report["summary"] = overall_metrics
    bundle["summary"] = overall_metrics

    with open(MODELS_DIR / WALK_FORWARD_REPORT_FILENAME, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, ensure_ascii=False)

    with open(MODELS_DIR / MODEL_BUNDLE_FILENAME, "w", encoding="utf-8") as handle:
        json.dump(bundle, handle, indent=2, ensure_ascii=False)

    summary_metrics = {
        "version": PIPELINE_VERSION,
        "model_name": MODEL_FAMILY,
        "mae": overall_metrics["mae"],
        "rmse": overall_metrics["rmse"],
        "mape": overall_metrics["mape"],
        "r2": None,
        "training_date": training_timestamp,
        "data_count": int(len(df)),
        "train_count": int(sum(bundle["buckets"][b.name]["train_rows"] for b in HORIZON_BUCKETS if b.name in bundle["buckets"])),
        "test_count": int(sum(bundle["buckets"][b.name]["validation_rows"] for b in HORIZON_BUCKETS if b.name in bundle["buckets"])),
        "feature_count": len(FEATURE_COLUMNS),
        "ai_factors_count": 0,
        "baseline_gate_passed": len(gating_failures) == 0,
        "best_baseline_mae": overall_metrics["best_baseline_mae"],
        "buckets": {
            bucket.name: {
                "mae": bundle["buckets"][bucket.name]["metrics"]["mae"],
                "best_baseline": bundle["buckets"][bucket.name]["best_baseline"],
                "gate": bundle["buckets"][bucket.name]["gate"],
            }
            for bucket in HORIZON_BUCKETS
            if bucket.name in bundle["buckets"]
        },
    }
    with open(MODELS_DIR / SUMMARY_METRICS_FILENAME, "w", encoding="utf-8") as handle:
        json.dump(summary_metrics, handle, indent=2, ensure_ascii=False)

    if gating_failures and not allow_gate_fail:
        raise TrainingGateError(" | ".join(gating_failures))

    return {
        "bundle": bundle,
        "report": report,
        "gating_failures": gating_failures,
    }


def load_model_bundle() -> Dict[str, object]:
    bundle_path = MODELS_DIR / MODEL_BUNDLE_FILENAME
    if not bundle_path.exists():
        raise FileNotFoundError(f"Missing model bundle: {bundle_path}")
    with open(bundle_path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def load_bucket_models(bundle: Dict[str, object]) -> Dict[str, xgb.Booster]:
    models = {}
    for bucket in HORIZON_BUCKETS:
        bucket_info = bundle.get("buckets", {}).get(bucket.name)
        if not bucket_info:
            continue
        model_path = MODELS_DIR / bucket_info["model_file"]
        booster = xgb.Booster()
        booster.load_model(model_path)
        models[bucket.name] = booster
    return models


def _build_state_features(history_df: pd.DataFrame) -> Dict[str, float]:
    history_df = history_df.sort_values("Date").reset_index(drop=True)
    values = history_df["Attendance"].astype(float)
    dates = pd.to_datetime(history_df["Date"])
    current = float(values.iloc[-1])
    return {
        "origin_dow": int(dates.iloc[-1].dayofweek),
        "origin_month": int(dates.iloc[-1].month),
        "last_value": current,
        "lag2": float(values.iloc[-2]),
        "lag7": float(values.iloc[-7]),
        "lag14": float(values.iloc[-14]),
        "lag28": float(values.iloc[-28]),
        "lag56": float(values.iloc[-56]),
        "ewma7": float(values.ewm(span=7, adjust=False).mean().iloc[-1]),
        "ewma14": float(values.ewm(span=14, adjust=False).mean().iloc[-1]),
        "ewma28": float(values.ewm(span=28, adjust=False).mean().iloc[-1]),
        "roll7": float(values.tail(7).mean()),
        "roll14": float(values.tail(14).mean()),
        "roll28": float(values.tail(28).mean()),
        "roll56": float(values.tail(56).mean()),
        "std7": float(values.tail(7).std(ddof=0) or 0.0),
        "std14": float(values.tail(14).std(ddof=0) or 0.0),
        "std28": float(values.tail(28).std(ddof=0) or 0.0),
        "trend_7_28": float(values.tail(7).mean() - values.tail(28).mean()),
        "trend_14_56": float(values.tail(14).mean() - values.tail(56).mean()),
        "delta_1_7": float(current - values.iloc[-7]),
        "delta_7_14": float(values.iloc[-7] - values.iloc[-14]),
        "recent_mean_84": float(values.tail(84).mean()),
    }


def build_single_feature_row(
    history_df: pd.DataFrame,
    target_date: pd.Timestamp,
    operational_horizon: int,
    holiday_set: set,
) -> Tuple[pd.DataFrame, Dict[str, float]]:
    if len(history_df) < MIN_HISTORY_DAYS:
        raise ValueError(f"Need at least {MIN_HISTORY_DAYS} history rows, got {len(history_df)}")

    base = _build_state_features(history_df)
    recent_same_dow = history_df[pd.to_datetime(history_df["Date"]).dt.dayofweek == target_date.dayofweek]["Attendance"].tail(12)
    seasonal_baseline = float(recent_same_dow.iloc[-1]) if len(recent_same_dow) else base["last_value"]
    dow_recent_mean = float(recent_same_dow.mean()) if len(recent_same_dow) else base["roll28"]
    holiday_ordinals = _holiday_ordinals(holiday_set)
    days_to_next_holiday, days_since_prev_holiday = holiday_distance_features(target_date, holiday_ordinals)

    row = {
        **base,
        "horizon": int(max(1, min(MAX_HORIZON, operational_horizon))),
        "target_dow": int(target_date.dayofweek),
        "target_month": int(target_date.month),
        "target_dom": int(target_date.day),
        "target_is_weekend": 1 if target_date.dayofweek >= 5 else 0,
        "target_dow_sin": float(np.sin(2 * np.pi * target_date.dayofweek / 7)),
        "target_dow_cos": float(np.cos(2 * np.pi * target_date.dayofweek / 7)),
        "target_month_sin": float(np.sin(2 * np.pi * target_date.month / 12)),
        "target_month_cos": float(np.cos(2 * np.pi * target_date.month / 12)),
        "target_is_holiday": 1 if target_date.date() in holiday_set else 0,
        "days_to_next_holiday": days_to_next_holiday,
        "days_since_prev_holiday": days_since_prev_holiday,
        "dow_recent_mean": dow_recent_mean,
        "seasonal_baseline": seasonal_baseline,
        "seasonal_gap": float(seasonal_baseline - base["recent_mean_84"]),
        "dow_gap": float(dow_recent_mean - base["recent_mean_84"]),
    }

    baseline_info = {
        "last": round(float(base["last_value"]), 4),
        "weekday_mean": round(dow_recent_mean, 4),
        "seasonal": round(seasonal_baseline, 4),
    }

    return pd.DataFrame([{feature: row[feature] for feature in FEATURE_COLUMNS}]), baseline_info


def _ci_from_quantiles(prediction: float, quantiles: Dict[str, Dict[str, float]]) -> Dict[str, Dict[str, float]]:
    ci80 = quantiles.get("ci80", {})
    ci95 = quantiles.get("ci95", {})
    return {
        "ci80": {
            "low": round(prediction + float(ci80.get("low_offset", -20.0)), 2),
            "high": round(prediction + float(ci80.get("high_offset", 20.0)), 2),
        },
        "ci95": {
            "low": round(prediction + float(ci95.get("low_offset", -30.0)), 2),
            "high": round(prediction + float(ci95.get("high_offset", 30.0)), 2),
        },
    }


def predict_target_date(
    target_date_str: str,
    historical_df: pd.DataFrame | None = None,
    bundle: Dict[str, object] | None = None,
    models: Dict[str, xgb.Booster] | None = None,
) -> Dict[str, object]:
    target_date = pd.Timestamp(target_date_str)
    history = historical_df.copy() if historical_df is not None else load_actual_data_from_db()
    history["Date"] = pd.to_datetime(history["Date"])
    history = history.sort_values("Date").reset_index(drop=True)

    if bundle is None:
        bundle = load_model_bundle()
    if models is None:
        models = load_bucket_models(bundle)

    holiday_set = load_holiday_set()
    latest_actual_date = pd.Timestamp(history["Date"].max())

    retrospective_mode = target_date <= latest_actual_date
    if retrospective_mode:
        cutoff_history = history[history["Date"] < target_date].copy()
        operational_horizon = 1
    else:
        cutoff_history = history.copy()
        operational_horizon = int((target_date - latest_actual_date).days)

    if len(cutoff_history) < MIN_HISTORY_DAYS:
        raise ValueError("Insufficient historical data for prediction context")

    bucket = get_bucket_for_horizon(operational_horizon)
    bucket_info = bundle["buckets"][bucket.name]
    feature_row, baseline_info = build_single_feature_row(
        cutoff_history,
        target_date=target_date,
        operational_horizon=operational_horizon,
        holiday_set=holiday_set,
    )

    dmatrix = xgb.DMatrix(feature_row[FEATURE_COLUMNS], feature_names=FEATURE_COLUMNS)
    booster = models[bucket.name]
    best_iteration = int(bucket_info.get("best_iteration") or 0)
    if best_iteration > 0:
        prediction = float(booster.predict(dmatrix, iteration_range=(0, best_iteration + 1))[0])
    else:
        prediction = float(booster.predict(dmatrix)[0])

    horizon_ci = bucket_info.get("per_horizon", {}).get(str(min(MAX_HORIZON, max(1, operational_horizon))))
    quantiles = horizon_ci["residual_ci"] if horizon_ci else bucket_info["residual_ci"]
    interval = _ci_from_quantiles(prediction, quantiles)

    return {
        "prediction": round(prediction, 2),
        "ci80": {
            **interval["ci80"],
            "lower": interval["ci80"]["low"],
            "upper": interval["ci80"]["high"],
        },
        "ci95": {
            **interval["ci95"],
            "lower": interval["ci95"]["low"],
            "upper": interval["ci95"]["high"],
        },
        "individual": {"xgboost": round(prediction, 2)},
        "metadata": {
            "model_family": MODEL_FAMILY,
            "model_version": bundle["version"],
            "bucket": bucket.name,
            "bucket_label": bucket.label,
            "operational_horizon": int(max(1, min(MAX_HORIZON, operational_horizon))),
            "latest_actual_date": str(latest_actual_date.date()),
            "retrospective_mode": retrospective_mode,
            "baseline_reference": baseline_info,
            "baseline_gate": bucket_info["gate"],
            "best_baseline": bucket_info["best_baseline"],
        },
    }


def predict_range(
    start_date_str: str,
    days: int,
    historical_df: pd.DataFrame | None = None,
    bundle: Dict[str, object] | None = None,
    models: Dict[str, xgb.Booster] | None = None,
) -> Dict[str, object]:
    start_date = pd.Timestamp(start_date_str)
    history = historical_df.copy() if historical_df is not None else load_actual_data_from_db()
    if bundle is None:
        bundle = load_model_bundle()
    if models is None:
        models = load_bucket_models(bundle)

    predictions = []
    for offset in range(days):
        target_date = start_date + timedelta(days=offset)
        result = predict_target_date(
            str(target_date.date()),
            historical_df=history,
            bundle=bundle,
            models=models,
        )
        metadata = result["metadata"]
        predictions.append(
            {
                "date": str(target_date.date()),
                "prediction": result["prediction"],
                "day_ahead": offset,
                "horizon_days": offset,
                "operational_horizon": metadata["operational_horizon"],
                "bucket": metadata["bucket"],
                "bucket_label": metadata["bucket_label"],
                "baseline_reference": metadata["baseline_reference"],
                "ci80": result["ci80"],
                "ci95": result["ci95"],
            }
        )

    return {
        "predictions": predictions,
        "model_type": MODEL_FAMILY,
        "version": bundle["version"],
        "source": "database_only",
    }


def evaluate_saved_bundle(
    recent_rows: int = DEFAULT_RECENT_ROWS,
) -> Dict[str, object]:
    df = load_actual_data_from_db()
    holiday_set = load_holiday_set()
    datasets = build_training_examples(
        df=df,
        holiday_set=holiday_set,
        recent_rows=recent_rows,
        min_history_days=MIN_HISTORY_DAYS,
    )
    bundle = load_model_bundle()
    models = load_bucket_models(bundle)

    summary = {"version": bundle["version"], "model_family": MODEL_FAMILY, "buckets": {}}

    for bucket in HORIZON_BUCKETS:
        bucket_df = datasets.get(bucket.name)
        if bucket_df is None or bucket_df.empty or bucket.name not in models:
            continue

        cutoff_dates = pd.to_datetime(bucket_df["cutoff_date"]).sort_values().unique()
        split_index = max(1, len(cutoff_dates) - DEFAULT_VALIDATION_CUTOFFS)
        val_cutoff_start = cutoff_dates[split_index]
        val_df = bucket_df[bucket_df["cutoff_date"] >= val_cutoff_start].copy()
        if val_df.empty:
            continue

        booster = models[bucket.name]
        best_iteration = int(bundle["buckets"][bucket.name].get("best_iteration") or 0)
        dmatrix = xgb.DMatrix(val_df[FEATURE_COLUMNS], feature_names=FEATURE_COLUMNS)
        if best_iteration > 0:
            pred = booster.predict(dmatrix, iteration_range=(0, best_iteration + 1))
        else:
            pred = booster.predict(dmatrix)

        summary["buckets"][bucket.name] = {
            "metrics": _metric_summary(val_df["target"].to_numpy(), pred),
            "baseline_metrics": {
                baseline_col.replace("baseline_", ""): _metric_summary(val_df["target"].to_numpy(), val_df[baseline_col].to_numpy())
                for baseline_col in BASELINE_COLUMNS
            },
        }

    return summary
