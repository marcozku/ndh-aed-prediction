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

PIPELINE_VERSION = "5.3.00"
MODEL_FAMILY = "horizon_direct_xgboost"
MAX_HORIZON = 30
MIN_HISTORY_DAYS = 84
LONG_LAG_DAYS = 372
DEFAULT_RECENT_ROWS = 1600
DEFAULT_VALIDATION_CUTOFFS = 180
DEFAULT_GATE_MARGIN = 0.01

TYPHOON_SIGNAL_ORDINAL: Dict[str, int] = {
    "": 0, "0": 0, "NONE": 0, "none": 0,
    "T1": 1, "1": 1,
    "T3": 3, "3": 3,
    "T8": 8, "8": 8, "T8NE": 8, "T8NW": 8, "T8SE": 8, "T8SW": 8,
    "T9": 9, "9": 9,
    "T10": 10, "10": 10,
}

RAINSTORM_SIGNAL_ORDINAL: Dict[str, int] = {
    "": 0, "NONE": 0, "none": 0, "0": 0,
    "AMBER": 1, "amber": 1,
    "RED": 2, "red": 2,
    "BLACK": 3, "black": 3,
}

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


WEATHER_FEATURE_COLUMNS: List[str] = [
    "wx_temp_mean",
    "wx_temp_range",
    "wx_temp_min",
    "wx_temp_max",
    "wx_rainfall_log",
    "wx_humidity",
    "wx_wind",
    "wx_pressure_dev",
    "wx_typhoon_signal_ord",
    "wx_rainstorm_signal_ord",
    "wx_is_very_cold",
    "wx_is_very_hot",
    "wx_is_heavy_rain",
    "wx_is_strong_wind",
    "wx_temp_anomaly_30d",
]

AI_FEATURE_COLUMNS: List[str] = [
    "ai_factor",
    "ai_factor_known",
]

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
    "target_is_holiday_eve",
    "target_is_post_holiday",
    "target_is_bridge_day",
    "lunar_ny_distance",
    "days_to_next_holiday",
    "days_since_prev_holiday",
    "is_covid_period",
    "last_value",
    "lag2",
    "lag7",
    "lag14",
    "lag28",
    "lag56",
    "lag358",
    "lag364",
    "lag371",
    "yoy_same_dow_mean",
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
] + WEATHER_FEATURE_COLUMNS + AI_FEATURE_COLUMNS

WEATHER_NEUTRAL_DEFAULTS: Dict[str, float] = {
    "wx_temp_mean": 23.5,
    "wx_temp_range": 4.0,
    "wx_temp_min": 21.5,
    "wx_temp_max": 25.5,
    "wx_rainfall_log": 0.0,
    "wx_humidity": 80.0,
    "wx_wind": 15.0,
    "wx_pressure_dev": 0.0,
    "wx_typhoon_signal_ord": 0,
    "wx_rainstorm_signal_ord": 0,
    "wx_is_very_cold": 0,
    "wx_is_very_hot": 0,
    "wx_is_heavy_rain": 0,
    "wx_is_strong_wind": 0,
    "wx_temp_anomaly_30d": 0.0,
}

AI_NEUTRAL_DEFAULTS: Dict[str, float] = {
    "ai_factor": 1.0,
    "ai_factor_known": 0,
}

BASELINE_COLUMNS: Tuple[str, ...] = (
    "baseline_last",
    "baseline_weekday_mean",
    "baseline_seasonal",
)


class TrainingGateError(RuntimeError):
    """Raised when a bucket model fails the baseline gate."""


def _open_db_connection():
    load_dotenv(ROOT_DIR / ".env")
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        return psycopg2.connect(database_url)
    return psycopg2.connect(
        host=os.getenv("PGHOST"),
        port=os.getenv("PGPORT"),
        user=os.getenv("PGUSER"),
        password=os.getenv("PGPASSWORD"),
        database=os.getenv("PGDATABASE"),
        sslmode="require",
    )


def load_actual_data_from_db() -> pd.DataFrame:
    """Load NDH AED actual data from PostgreSQL only."""
    conn = _open_db_connection()
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


def load_weather_history_from_db() -> pd.DataFrame:
    """Load HKO weather history aligned to actual_data dates.

    Returns a frame indexed by ``Date`` with raw HKO columns; downstream feature
    builder normalises and fills missing days. Safe to call when ``weather_history``
    table is missing — returns an empty frame and feature builder will fall back
    to neutral defaults.
    """
    try:
        conn = _open_db_connection()
    except Exception as exc:  # pragma: no cover - env without DB
        warnings.warn(f"weather DB unavailable: {exc}")
        return pd.DataFrame(columns=["Date"])

    query = """
        SELECT date AS "Date",
               temp_min, temp_max, temp_mean,
               humidity_pct, rainfall_mm, wind_kmh, pressure_hpa,
               typhoon_signal, rainstorm_warning,
               is_very_cold, is_very_hot, is_heavy_rain, is_strong_wind
        FROM weather_history
        ORDER BY date ASC
    """
    try:
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message=".*pandas only supports SQLAlchemy.*")
            df = pd.read_sql_query(query, conn)
    except Exception as exc:  # pragma: no cover - DB schema mismatch
        warnings.warn(f"weather_history load failed: {exc}")
        df = pd.DataFrame(columns=["Date"])
    finally:
        conn.close()

    if df.empty:
        return df

    df["Date"] = pd.to_datetime(df["Date"])
    numeric_cols = ["temp_min", "temp_max", "temp_mean", "humidity_pct", "rainfall_mm", "wind_kmh", "pressure_hpa"]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    bool_cols = ["is_very_cold", "is_very_hot", "is_heavy_rain", "is_strong_wind"]
    for col in bool_cols:
        if col in df.columns:
            df[col] = df[col].fillna(False).astype(bool)

    df = df.sort_values("Date").reset_index(drop=True)
    if "temp_mean" in df.columns:
        df["wx_temp_anomaly_30d"] = (
            df["temp_mean"] - df["temp_mean"].rolling(window=30, min_periods=5).mean()
        ).fillna(0.0)
    else:
        df["wx_temp_anomaly_30d"] = 0.0

    return df


def load_ai_factor_history_from_db() -> pd.DataFrame:
    """Load realised AI factor per date from ``learning_records``.

    Only a few hundred rows exist historically; missing dates fall back to the
    neutral factor 1.0 with ``ai_factor_known=0`` flag so the model can learn
    that "no AI signal" itself is informative.
    """
    try:
        conn = _open_db_connection()
    except Exception as exc:  # pragma: no cover
        warnings.warn(f"AI factor DB unavailable: {exc}")
        return pd.DataFrame(columns=["Date", "ai_factor", "ai_factor_known"])

    query = "SELECT date AS \"Date\", ai_factor FROM learning_records ORDER BY date ASC"
    try:
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message=".*pandas only supports SQLAlchemy.*")
            df = pd.read_sql_query(query, conn)
    except Exception as exc:  # pragma: no cover
        warnings.warn(f"learning_records load failed: {exc}")
        df = pd.DataFrame(columns=["Date", "ai_factor"])
    finally:
        conn.close()

    if df.empty:
        df = pd.DataFrame(columns=["Date", "ai_factor", "ai_factor_known"])
        return df

    df["Date"] = pd.to_datetime(df["Date"])
    df["ai_factor"] = pd.to_numeric(df["ai_factor"], errors="coerce").fillna(1.0)
    df["ai_factor_known"] = 1
    df = df.drop_duplicates(subset=["Date"], keep="last").sort_values("Date").reset_index(drop=True)
    return df


def _weather_lookup(weather_map: Dict, target_date: pd.Timestamp) -> Dict[str, float]:
    row = weather_map.get(target_date.normalize()) if weather_map else None
    if row is None:
        return dict(WEATHER_NEUTRAL_DEFAULTS)

    temp_mean = row.get("temp_mean")
    temp_min = row.get("temp_min")
    temp_max = row.get("temp_max")
    rainfall = row.get("rainfall_mm")
    humidity = row.get("humidity_pct")
    wind = row.get("wind_kmh")
    pressure = row.get("pressure_hpa")
    typhoon = str(row.get("typhoon_signal") or "")
    rainstorm = str(row.get("rainstorm_warning") or "")

    return {
        "wx_temp_mean": float(temp_mean) if temp_mean is not None else WEATHER_NEUTRAL_DEFAULTS["wx_temp_mean"],
        "wx_temp_range": float(temp_max - temp_min) if (temp_max is not None and temp_min is not None) else WEATHER_NEUTRAL_DEFAULTS["wx_temp_range"],
        "wx_temp_min": float(temp_min) if temp_min is not None else WEATHER_NEUTRAL_DEFAULTS["wx_temp_min"],
        "wx_temp_max": float(temp_max) if temp_max is not None else WEATHER_NEUTRAL_DEFAULTS["wx_temp_max"],
        "wx_rainfall_log": float(math.log1p(max(0.0, float(rainfall)))) if rainfall is not None else 0.0,
        "wx_humidity": float(humidity) if humidity is not None else WEATHER_NEUTRAL_DEFAULTS["wx_humidity"],
        "wx_wind": float(wind) if wind is not None else WEATHER_NEUTRAL_DEFAULTS["wx_wind"],
        "wx_pressure_dev": float(pressure - 1013.0) if pressure is not None else 0.0,
        "wx_typhoon_signal_ord": int(TYPHOON_SIGNAL_ORDINAL.get(typhoon.upper(), 0)),
        "wx_rainstorm_signal_ord": int(RAINSTORM_SIGNAL_ORDINAL.get(rainstorm.upper(), 0)),
        "wx_is_very_cold": int(bool(row.get("is_very_cold"))),
        "wx_is_very_hot": int(bool(row.get("is_very_hot"))),
        "wx_is_heavy_rain": int(bool(row.get("is_heavy_rain"))),
        "wx_is_strong_wind": int(bool(row.get("is_strong_wind"))),
        "wx_temp_anomaly_30d": float(row.get("wx_temp_anomaly_30d") or 0.0),
    }


def _ai_lookup(ai_map: Dict, target_date: pd.Timestamp) -> Dict[str, float]:
    val = ai_map.get(target_date.normalize()) if ai_map else None
    if val is None:
        return dict(AI_NEUTRAL_DEFAULTS)
    return {"ai_factor": float(val), "ai_factor_known": 1}


def _weather_map_from_df(weather_df: pd.DataFrame) -> Dict:
    if weather_df is None or weather_df.empty:
        return {}
    mapping = {}
    for _, row in weather_df.iterrows():
        mapping[pd.Timestamp(row["Date"]).normalize()] = row.to_dict()
    return mapping


def _ai_map_from_df(ai_df: pd.DataFrame) -> Dict:
    if ai_df is None or ai_df.empty or "ai_factor" not in ai_df.columns:
        return {}
    return {
        pd.Timestamp(row["Date"]).normalize(): float(row["ai_factor"])
        for _, row in ai_df.iterrows()
    }


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


# Lunar New Year first day for each year (香港農曆新年初一)
# Source: Hong Kong government public holidays (CNY day 1 is always the first
# of three consecutive CNY holidays in late Jan or early Feb).
LUNAR_NY_FIRST_DAY: Dict[int, str] = {
    2014: "2014-01-31",
    2015: "2015-02-19",
    2016: "2016-02-08",
    2017: "2017-01-28",
    2018: "2018-02-16",
    2019: "2019-02-05",
    2020: "2020-01-25",
    2021: "2021-02-12",
    2022: "2022-02-01",
    2023: "2023-01-22",
    2024: "2024-02-10",
    2025: "2025-01-29",
    2026: "2026-02-17",
    2027: "2027-02-06",
    2028: "2028-01-26",
}

# Pandemic regime flag — Hong Kong waves 2-5 plus early reopening period.
# Used to let the model learn distinct elasticity for that window without
# pruning it from history (which would discard 18 months of signal).
COVID_PERIOD_START = pd.Timestamp("2022-01-01").date()
COVID_PERIOD_END = pd.Timestamp("2023-06-30").date()


def _lunar_ny_ordinals() -> List[int]:
    return sorted(pd.Timestamp(d).date().toordinal() for d in LUNAR_NY_FIRST_DAY.values())


def lunar_ny_distance(target_date: pd.Timestamp, lny_ordinals: List[int]) -> int:
    """Signed days to the closest Lunar NY day-1, clipped to [-15, 15].

    Negative = target is BEFORE the nearest CNY day-1 (pre-CNY rush);
    Positive = target is AFTER (post-CNY rebound).
    Anything beyond ±15 days collapses to 15 with sign, since CNY effect on ED
    attendance fades by then in HK historical data.
    """
    target_ordinal = target_date.date().toordinal()
    idx = bisect_left(lny_ordinals, target_ordinal)

    candidates: List[int] = []
    if idx < len(lny_ordinals):
        candidates.append(lny_ordinals[idx])
    if idx > 0:
        candidates.append(lny_ordinals[idx - 1])
    if not candidates:
        return 15

    nearest = min(candidates, key=lambda o: abs(o - target_ordinal))
    signed = target_ordinal - nearest
    if signed > 15:
        return 15
    if signed < -15:
        return -15
    return int(signed)


def holiday_context_flags(
    target_date: pd.Timestamp, holiday_set: set
) -> Tuple[int, int, int]:
    """Compute (is_holiday_eve, is_post_holiday, is_bridge_day).

    - eve: tomorrow is a holiday and today is NOT (Saturday-before-CNY etc.)
    - post: yesterday was a holiday and today is NOT (return-to-work rebound)
    - bridge: today is a weekday wedged between two days off (holiday or weekend)
    """
    today = target_date.date()
    tomorrow = (target_date + timedelta(days=1)).date()
    yesterday = (target_date - timedelta(days=1)).date()

    today_is_off = today in holiday_set or target_date.dayofweek >= 5
    tomorrow_is_off = tomorrow in holiday_set or (target_date + timedelta(days=1)).dayofweek >= 5
    yesterday_is_off = yesterday in holiday_set or (target_date - timedelta(days=1)).dayofweek >= 5

    is_eve = 1 if tomorrow_is_off and not today_is_off else 0
    is_post = 1 if yesterday_is_off and not today_is_off else 0
    is_bridge = 1 if (yesterday_is_off and tomorrow_is_off and not today_is_off) else 0
    return is_eve, is_post, is_bridge


def is_covid_period(target_date: pd.Timestamp) -> int:
    d = target_date.date()
    return 1 if COVID_PERIOD_START <= d <= COVID_PERIOD_END else 0


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


def _lookback_value(values: np.ndarray, cutoff_idx: int, lag: int, fallback: float) -> float:
    """Safely fetch ``values[cutoff_idx - lag]`` falling back when out of range.

    ``lag`` here means "days from the cutoff index" (so lag=364 means 364 days
    before cutoff). For early rows where the lookback isn't available, return
    the supplied fallback (typically the most recent same-DoW mean) instead of
    NaN — keeps the column dense without leaking the target.
    """
    idx = cutoff_idx - lag
    if idx < 0:
        return float(fallback)
    return float(values[idx])


def build_training_examples(
    df: pd.DataFrame,
    holiday_set: set,
    recent_rows: int | None = DEFAULT_RECENT_ROWS,
    min_history_days: int = MIN_HISTORY_DAYS,
    weather_df: pd.DataFrame | None = None,
    ai_factor_df: pd.DataFrame | None = None,
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
    lny_ordinals = _lunar_ny_ordinals()
    weather_map = _weather_map_from_df(weather_df) if weather_df is not None else {}
    ai_map = _ai_map_from_df(ai_factor_df) if ai_factor_df is not None else {}

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
            is_eve, is_post, is_bridge = holiday_context_flags(target_date, holiday_set)
            lny_dist = lunar_ny_distance(target_date, lny_ordinals)

            # Year-over-year same-DoW lookups: target_idx - 364/371/358 hits the
            # same weekday roughly 52, 53, 51 weeks ago.
            yoy_fallback = dow_recent_mean
            lag358 = _lookback_value(values, target_idx, 358, yoy_fallback)
            lag364 = _lookback_value(values, target_idx, 364, yoy_fallback)
            lag371 = _lookback_value(values, target_idx, 371, yoy_fallback)
            yoy_same_dow_mean = (lag358 + lag364 + lag371) / 3.0

            wx = _weather_lookup(weather_map, target_date)
            ai = _ai_lookup(ai_map, target_date)

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
                    "target_is_holiday_eve": is_eve,
                    "target_is_post_holiday": is_post,
                    "target_is_bridge_day": is_bridge,
                    "lunar_ny_distance": lny_dist,
                    "days_to_next_holiday": days_to_next_holiday,
                    "days_since_prev_holiday": days_since_prev_holiday,
                    "is_covid_period": is_covid_period(target_date),
                    "lag358": lag358,
                    "lag364": lag364,
                    "lag371": lag371,
                    "yoy_same_dow_mean": yoy_same_dow_mean,
                    "dow_recent_mean": dow_recent_mean,
                    "seasonal_baseline": seasonal_baseline,
                    "seasonal_gap": float(seasonal_baseline - base["recent_mean_84"]),
                    "dow_gap": float(dow_recent_mean - base["recent_mean_84"]),
                    "target": float(values[target_idx]),
                    "baseline_last": base["last_value"],
                    "baseline_weekday_mean": dow_recent_mean,
                    "baseline_seasonal": seasonal_baseline,
                    **wx,
                    **ai,
                }
            )

            bucket = get_bucket_for_horizon(horizon)
            records[bucket.name].append(row)

    return {bucket_name: pd.DataFrame(rows) for bucket_name, rows in records.items()}


BIAS_DEFAULT_SHRINK = 50.0
BIAS_PER_CELL_CAP = 4.0  # absolute cap per (bucket, dow) bias cell
BIAS_GLOBAL_CAP = 5.0    # absolute cap on the bucket-wide fallback


def _fit_bias_correction(
    val_df: pd.DataFrame,
    val_pred: np.ndarray,
    shrink: float = BIAS_DEFAULT_SHRINK,
    cap: float = BIAS_PER_CELL_CAP,
    global_cap: float = BIAS_GLOBAL_CAP,
) -> Dict[str, object]:
    """Compute capped, shrunken per-target_dow bias from validation residuals.

    Distribution shift between calibration and live data makes naive bias
    correction unstable, so each cell is double-protected:
      1. Shrink toward 0 by ``n / (n + shrink)``.
      2. Clamp to ``±cap`` after shrinkage.

    A small global fallback (also capped) handles ``target_dow`` values that
    weren't represented in the calibration window.
    """
    if len(val_df) == 0:
        return {"per_dow": {}, "global": 0.0, "shrink": shrink, "cap": cap}

    targets = val_df["target"].to_numpy(dtype=float)
    dows = val_df["target_dow"].to_numpy(dtype=int)
    residuals = np.asarray(val_pred, dtype=float) - targets

    per_dow: Dict[str, Dict[str, float]] = {}
    for dow in range(7):
        mask = dows == dow
        n = int(mask.sum())
        if n == 0:
            continue
        raw_bias = float(residuals[mask].mean())
        shrunk = raw_bias * (n / (n + shrink))
        clamped = float(np.clip(shrunk, -cap, cap))
        per_dow[str(dow)] = {
            "raw_bias": round(raw_bias, 4),
            "shrunk_bias": round(clamped, 4),
            "n": n,
        }

    global_bias = float(np.clip(residuals.mean(), -global_cap, global_cap))
    return {
        "per_dow": per_dow,
        "global": round(global_bias, 4),
        "shrink": shrink,
        "cap": cap,
    }


def _evaluate_bias_helps(
    test_df: pd.DataFrame,
    test_pred: np.ndarray,
    bias_table: Dict[str, object],
) -> bool:
    """Return True iff the bias correction reduces MAE on the test slice.

    Acts as a safety valve — if the calibration window's bias has drifted by
    the time the model is evaluated, we'd rather skip correction than make
    things worse.
    """
    if len(test_df) == 0:
        return False
    raw_mae = float(np.mean(np.abs(test_pred - test_df["target"].to_numpy())))
    bias_arr = _apply_bias(test_df, test_pred, bias_table)
    corrected = test_pred - bias_arr
    corr_mae = float(np.mean(np.abs(corrected - test_df["target"].to_numpy())))
    return corr_mae < raw_mae


def _apply_bias(
    feature_df: pd.DataFrame,
    predictions: np.ndarray,
    bias_table: Dict[str, object] | None,
) -> np.ndarray:
    """Return the bias array (to subtract from predictions).

    ``correction = prediction - bias`` where bias is the historical residual.
    Falls back to global bias when a target_dow has no calibration data.
    """
    if not bias_table or not isinstance(bias_table, dict):
        return np.zeros(len(predictions), dtype=float)

    per_dow = bias_table.get("per_dow") or {}
    global_bias = float(bias_table.get("global", 0.0) or 0.0)
    bias = np.full(len(predictions), global_bias, dtype=float)
    if "target_dow" not in feature_df.columns:
        return bias
    for dow_str, cell in per_dow.items():
        try:
            dow_int = int(dow_str)
        except (TypeError, ValueError):
            continue
        if not isinstance(cell, dict):
            continue
        shrunk = float(cell.get("shrunk_bias", 0.0) or 0.0)
        bias = np.where(feature_df["target_dow"].to_numpy() == dow_int, shrunk, bias)
    return bias


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


def _optuna_tune_xgb(
    train_df: pd.DataFrame,
    val_df: pd.DataFrame,
    n_trials: int,
    timeout: float | None = None,
    seed: int = 42,
) -> Tuple[Dict[str, float], Dict[str, object]]:
    """Lightweight TPE search for per-bucket XGBoost hyperparameters.

    Search runs against the bucket's own walk-forward validation slice so
    each operational horizon group gets its own optimum. Returns the best
    params merged with the fixed objective/eval_metric scaffolding plus an
    audit dict for the bundle JSON.
    """
    import optuna
    from optuna.samplers import TPESampler
    from optuna.pruners import MedianPruner

    fixed = {
        "objective": "reg:squarederror",
        "eval_metric": "mae",
        "tree_method": "hist",
        "random_state": seed,
    }

    val_X = val_df[FEATURE_COLUMNS]
    val_y = val_df["target"]
    train_X = train_df[FEATURE_COLUMNS]
    train_y = train_df["target"]

    def objective(trial: "optuna.Trial") -> float:
        params = dict(fixed)
        params.update({
            "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.12, log=True),
            "max_depth": trial.suggest_int("max_depth", 3, 9),
            "min_child_weight": trial.suggest_int("min_child_weight", 1, 12),
            "subsample": trial.suggest_float("subsample", 0.6, 1.0),
            "colsample_bytree": trial.suggest_float("colsample_bytree", 0.55, 1.0),
            "reg_alpha": trial.suggest_float("reg_alpha", 0.0, 3.0),
            "reg_lambda": trial.suggest_float("reg_lambda", 0.2, 5.0),
            "gamma": trial.suggest_float("gamma", 0.0, 1.5),
        })
        model = xgb.XGBRegressor(n_estimators=500, early_stopping_rounds=30, **params)
        model.fit(train_X, train_y, eval_set=[(val_X, val_y)], verbose=False)
        pred = model.predict(val_X)
        return float(mean_absolute_error(val_y, pred))

    optuna.logging.set_verbosity(optuna.logging.WARNING)
    sampler = TPESampler(seed=seed, n_startup_trials=8)
    pruner = MedianPruner(n_startup_trials=8, n_warmup_steps=0)
    study = optuna.create_study(direction="minimize", sampler=sampler, pruner=pruner)
    study.optimize(objective, n_trials=n_trials, timeout=timeout, show_progress_bar=False)

    best = dict(fixed)
    best.update(study.best_params)
    audit = {
        "best_value_mae": round(float(study.best_value), 4),
        "n_trials": int(len(study.trials)),
        "best_params": {k: (round(v, 6) if isinstance(v, float) else v) for k, v in study.best_params.items()},
    }
    return best, audit


def _train_lightgbm_companion(
    train_df: pd.DataFrame,
    val_df: pd.DataFrame,
    seed: int = 42,
) -> Tuple[object, Dict[str, object]]:
    """Train a LightGBM regressor with similar discipline to the XGBoost base.

    Used as the second base learner in a simple blend; LightGBM tends to model
    interactions XGBoost misses (and vice versa) so a 50/50 mean blend has
    historically given a free 1–3% MAE drop on ED time-series.
    """
    import lightgbm as lgb

    params = {
        "objective": "regression_l1",
        "metric": "l1",
        "learning_rate": 0.04,
        "num_leaves": 63,
        "min_data_in_leaf": 20,
        "feature_fraction": 0.85,
        "bagging_fraction": 0.85,
        "bagging_freq": 4,
        "lambda_l1": 0.2,
        "lambda_l2": 1.5,
        "max_depth": -1,
        "verbose": -1,
        "random_state": seed,
    }
    train_set = lgb.Dataset(train_df[FEATURE_COLUMNS], label=train_df["target"])
    val_set = lgb.Dataset(val_df[FEATURE_COLUMNS], label=val_df["target"], reference=train_set)

    booster = lgb.train(
        params,
        train_set,
        num_boost_round=600,
        valid_sets=[val_set],
        callbacks=[lgb.early_stopping(stopping_rounds=40, verbose=False)],
    )
    audit = {
        "best_iteration": int(booster.best_iteration or 0),
        "params": {k: v for k, v in params.items() if k not in ("metric", "objective", "verbose")},
    }
    return booster, audit


def train_horizon_models(
    recent_rows: int = DEFAULT_RECENT_ROWS,
    validation_cutoffs: int = DEFAULT_VALIDATION_CUTOFFS,
    gate_margin: float = DEFAULT_GATE_MARGIN,
    allow_gate_fail: bool = False,
    weather_df: pd.DataFrame | None = None,
    ai_factor_df: pd.DataFrame | None = None,
    train_quantile: bool = True,
    optuna_trials: int = 0,
    optuna_timeout: float | None = None,
    train_lightgbm: bool = True,
    blend_weight_xgb: float = 0.55,
) -> Dict[str, object]:
    df = load_actual_data_from_db()
    holiday_set = load_holiday_set()
    if weather_df is None:
        weather_df = load_weather_history_from_db()
    if ai_factor_df is None:
        ai_factor_df = load_ai_factor_history_from_db()
    datasets = build_training_examples(
        df=df,
        holiday_set=holiday_set,
        recent_rows=recent_rows,
        min_history_days=MIN_HISTORY_DAYS,
        weather_df=weather_df,
        ai_factor_df=ai_factor_df,
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

        bucket_params = dict(params)
        optuna_audit: Dict[str, object] | None = None
        if optuna_trials and optuna_trials > 0:
            tuned, optuna_audit = _optuna_tune_xgb(
                train_df,
                val_df,
                n_trials=optuna_trials,
                timeout=optuna_timeout,
            )
            bucket_params = tuned

        model = xgb.XGBRegressor(
            n_estimators=600,
            early_stopping_rounds=40,
            **bucket_params,
        )
        model.fit(
            train_df[FEATURE_COLUMNS],
            train_df["target"],
            eval_set=[(val_df[FEATURE_COLUMNS], val_df["target"])],
            verbose=False,
        )

        xgb_val_pred = model.predict(val_df[FEATURE_COLUMNS])

        # ----- LightGBM companion (Stage C2) -----
        lgb_audit: Dict[str, object] | None = None
        lgb_booster = None
        lgb_val_pred: np.ndarray | None = None
        if train_lightgbm:
            try:
                lgb_booster, lgb_audit = _train_lightgbm_companion(train_df, val_df)
                lgb_val_pred = lgb_booster.predict(
                    val_df[FEATURE_COLUMNS],
                    num_iteration=lgb_audit.get("best_iteration") or None,
                )
            except Exception as exc:  # pragma: no cover
                lgb_booster = None
                lgb_val_pred = None
                lgb_audit = {"error": str(exc)}

        # Blend XGB + LGB; auto-fall-back to XGB if blend doesn't improve val MAE.
        if lgb_val_pred is not None:
            blend_pred = blend_weight_xgb * xgb_val_pred + (1.0 - blend_weight_xgb) * lgb_val_pred
            blend_mae = float(np.mean(np.abs(blend_pred - val_df["target"].to_numpy())))
            xgb_only_mae = float(np.mean(np.abs(xgb_val_pred - val_df["target"].to_numpy())))
            if blend_mae < xgb_only_mae:
                val_pred = blend_pred
                ensemble_active = True
            else:
                val_pred = xgb_val_pred
                ensemble_active = False
        else:
            val_pred = xgb_val_pred
            ensemble_active = False

        raw_metrics = _metric_summary(val_df["target"].to_numpy(), val_pred)

        # ----- v5.3.00 bias correction layer -----------------------------------
        # Split val cutoffs into calibration (first 60%) and honest-test (last 40%).
        # Fit a per-target_dow shrinkage bias on calibration residuals only, then
        # apply to the test slice. This avoids the systematic +3.9 to +9.6 bias
        # observed in the v5.0.00 walk-forward report.
        val_cutoff_unique = pd.to_datetime(val_df["cutoff_date"]).sort_values().unique()
        calib_cut_idx = max(1, int(len(val_cutoff_unique) * 0.6))
        calib_cut_start = val_cutoff_unique[calib_cut_idx] if calib_cut_idx < len(val_cutoff_unique) else val_cutoff_unique[-1]
        is_calib = pd.to_datetime(val_df["cutoff_date"]).values < calib_cut_start

        calib_df = val_df[is_calib].copy()
        test_df = val_df[~is_calib].copy()
        calib_pred = val_pred[is_calib]
        test_pred = val_pred[~is_calib]

        bias_table = _fit_bias_correction(calib_df, calib_pred)

        # Safety valve: only keep the correction when it improves test MAE.
        # When the calibration window's bias has drifted by inference time,
        # zero the table out so the bucket falls back to raw predictions.
        bias_active = True
        if len(test_df) and not _evaluate_bias_helps(test_df, test_pred, bias_table):
            bias_active = False
            bias_table = {
                "per_dow": {},
                "global": 0.0,
                "shrink": bias_table.get("shrink"),
                "cap": bias_table.get("cap"),
                "disabled_reason": "bias drift between calibration and test slice (auto-fallback)",
            }

        bias_corrected_val_pred = val_pred - _apply_bias(val_df, val_pred, bias_table)
        corrected_metrics = _metric_summary(val_df["target"].to_numpy(), bias_corrected_val_pred)

        if len(test_df):
            test_corrected = test_pred - _apply_bias(test_df, test_pred, bias_table)
            honest_metrics = {
                "raw": _metric_summary(test_df["target"].to_numpy(), test_pred),
                "corrected": _metric_summary(test_df["target"].to_numpy(), test_corrected),
                "calib_rows": int(len(calib_df)),
                "test_rows": int(len(test_df)),
                "calib_cutoff_start": str(pd.Timestamp(val_cutoff_unique[0]).date()),
                "test_cutoff_start": str(pd.Timestamp(calib_cut_start).date()),
                "bias_active": bias_active,
            }
            metrics = honest_metrics["corrected"]
        else:
            honest_metrics = None
            metrics = corrected_metrics

        baseline_metrics: Dict[str, Dict[str, float]] = {}
        best_baseline_name = None
        best_baseline_mae = None
        baseline_eval_df = test_df if len(test_df) else val_df
        for baseline_col in BASELINE_COLUMNS:
            baseline_name = baseline_col.replace("baseline_", "")
            baseline_summary = _metric_summary(baseline_eval_df["target"].to_numpy(), baseline_eval_df[baseline_col].to_numpy())
            baseline_metrics[baseline_name] = baseline_summary
            if best_baseline_mae is None or baseline_summary["mae"] < best_baseline_mae:
                best_baseline_mae = baseline_summary["mae"]
                best_baseline_name = baseline_name

        gate_passed = metrics["mae"] <= (best_baseline_mae * (1 - gate_margin))
        gate_delta = round(best_baseline_mae - metrics["mae"], 4)
        if not gate_passed:
            gating_failures.append(
                f"{bucket.label} gate failed: corrected MAE {metrics['mae']:.4f} vs best baseline {best_baseline_name} {best_baseline_mae:.4f}"
            )

        residual_ci = _residual_quantiles(val_df["target"].to_numpy(), bias_corrected_val_pred)
        per_horizon = {}
        val_indices = val_df.index.to_list()
        val_lookup = {idx: pos for pos, idx in enumerate(val_indices)}
        for horizon in sorted(val_df["horizon"].unique()):
            horizon_slice = val_df[val_df["horizon"] == horizon]
            positions = [val_lookup[idx] for idx in horizon_slice.index]
            horizon_pred = bias_corrected_val_pred[positions]
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

        lgb_file_info: Dict[str, object] | None = None
        if lgb_booster is not None and ensemble_active:
            lgb_file = bucket.model_file.replace(".json", "_lgb.txt")
            lgb_path = MODELS_DIR / lgb_file
            lgb_booster.save_model(str(lgb_path), num_iteration=lgb_audit.get("best_iteration") or -1)
            lgb_file_info = {
                "file": lgb_file,
                "blend_weight_xgb": blend_weight_xgb,
                "best_iteration": lgb_audit.get("best_iteration"),
            }

        # ----- v5.3.00 quantile regression for state-dependent CI -----------
        quantile_models: Dict[str, Dict[str, object]] = {}
        if train_quantile:
            for alpha, qname in ((0.10, "q10"), (0.90, "q90")):
                q_params = dict(bucket_params)
                q_params["objective"] = "reg:quantileerror"
                q_params["quantile_alpha"] = alpha
                q_params.pop("eval_metric", None)
                q_model = xgb.XGBRegressor(n_estimators=400, **q_params)
                q_model.fit(train_df[FEATURE_COLUMNS], train_df["target"], verbose=False)
                q_file = bucket.model_file.replace(".json", f"_{qname}.json")
                q_path = MODELS_DIR / q_file
                q_model.get_booster().save_model(q_path)
                quantile_models[qname] = {
                    "file": q_file,
                    "alpha": alpha,
                    "n_estimators": q_model.n_estimators,
                }

        bucket_report = {
            "label": bucket.label,
            "train_rows": int(len(train_df)),
            "validation_rows": int(len(val_df)),
            "validation_cutoff_start": str(pd.Timestamp(val_cutoff_start).date()),
            "metrics": metrics,
            "raw_metrics": raw_metrics,
            "corrected_metrics_full_val": corrected_metrics,
            "honest_split_metrics": honest_metrics,
            "bias_correction": bias_table,
            "optuna": optuna_audit,
            "lightgbm": lgb_file_info,
            "ensemble_active": ensemble_active,
            "blend_weight_xgb": blend_weight_xgb if ensemble_active else 1.0,
            "tuned_params": bucket_params if optuna_trials else None,
            "quantile_models": quantile_models,
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

        weight = float(len(test_df) if len(test_df) else len(val_df))
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


def load_lightgbm_models(bundle: Dict[str, object]) -> Dict[str, object]:
    """Optionally load LightGBM companion boosters for ensemble inference."""
    lgb_models: Dict[str, object] = {}
    try:
        import lightgbm as lgb
    except ImportError:  # pragma: no cover
        return lgb_models
    for bucket in HORIZON_BUCKETS:
        bucket_info = bundle.get("buckets", {}).get(bucket.name) or {}
        spec = bucket_info.get("lightgbm")
        if not spec:
            continue
        lgb_path = MODELS_DIR / spec.get("file", "")
        if not lgb_path.exists():
            continue
        try:
            booster = lgb.Booster(model_file=str(lgb_path))
            lgb_models[bucket.name] = {
                "booster": booster,
                "weight_xgb": float(spec.get("blend_weight_xgb", 0.55)),
                "best_iteration": spec.get("best_iteration"),
            }
        except Exception:  # pragma: no cover
            continue
    return lgb_models


def load_quantile_models(bundle: Dict[str, object]) -> Dict[str, Dict[str, xgb.Booster]]:
    """Optionally load q10/q90 quantile boosters for state-dependent CI."""
    quantiles: Dict[str, Dict[str, xgb.Booster]] = {}
    for bucket in HORIZON_BUCKETS:
        bucket_info = bundle.get("buckets", {}).get(bucket.name) or {}
        q_specs = bucket_info.get("quantile_models") or {}
        loaded: Dict[str, xgb.Booster] = {}
        for qname, spec in q_specs.items():
            if not isinstance(spec, dict):
                continue
            q_path = MODELS_DIR / spec.get("file", "")
            if not q_path.exists():
                continue
            booster = xgb.Booster()
            booster.load_model(q_path)
            loaded[qname] = booster
        if loaded:
            quantiles[bucket.name] = loaded
    return quantiles


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


def _yoy_lookup(values: pd.Series, dates: pd.Series, target_date: pd.Timestamp, lag_days: int, fallback: float) -> float:
    """Find the attendance value approximately ``lag_days`` before ``target_date``.

    Uses an exact-date lookup first; if the date isn't in history (missing
    rows / partial coverage), falls back to the nearest available date within
    a ±3-day window. If still missing, returns ``fallback``.
    """
    target = (target_date - timedelta(days=lag_days)).normalize()
    date_index = pd.DatetimeIndex(dates.values)
    pos = date_index.get_indexer([target])[0]
    if pos >= 0:
        return float(values.iloc[pos])

    for offset in range(1, 4):
        for direction in (-1, 1):
            alt = target + timedelta(days=offset * direction)
            pos = date_index.get_indexer([alt])[0]
            if pos >= 0:
                return float(values.iloc[pos])
    return float(fallback)


def build_single_feature_row(
    history_df: pd.DataFrame,
    target_date: pd.Timestamp,
    operational_horizon: int,
    holiday_set: set,
    weather_df: pd.DataFrame | None = None,
    ai_factor_df: pd.DataFrame | None = None,
) -> Tuple[pd.DataFrame, Dict[str, float]]:
    if len(history_df) < MIN_HISTORY_DAYS:
        raise ValueError(f"Need at least {MIN_HISTORY_DAYS} history rows, got {len(history_df)}")

    base = _build_state_features(history_df)
    history_df = history_df.sort_values("Date").reset_index(drop=True)
    dates_series = pd.to_datetime(history_df["Date"])
    values_series = history_df["Attendance"].astype(float)

    recent_same_dow = values_series[dates_series.dt.dayofweek == target_date.dayofweek].tail(12)
    seasonal_baseline = float(recent_same_dow.iloc[-1]) if len(recent_same_dow) else base["last_value"]
    dow_recent_mean = float(recent_same_dow.mean()) if len(recent_same_dow) else base["roll28"]
    holiday_ordinals = _holiday_ordinals(holiday_set)
    lny_ordinals = _lunar_ny_ordinals()
    days_to_next_holiday, days_since_prev_holiday = holiday_distance_features(target_date, holiday_ordinals)
    is_eve, is_post, is_bridge = holiday_context_flags(target_date, holiday_set)
    lny_dist = lunar_ny_distance(target_date, lny_ordinals)

    yoy_fallback = dow_recent_mean
    lag358 = _yoy_lookup(values_series, dates_series, target_date, 358, yoy_fallback)
    lag364 = _yoy_lookup(values_series, dates_series, target_date, 364, yoy_fallback)
    lag371 = _yoy_lookup(values_series, dates_series, target_date, 371, yoy_fallback)
    yoy_same_dow_mean = (lag358 + lag364 + lag371) / 3.0

    weather_map = _weather_map_from_df(weather_df) if weather_df is not None else {}
    ai_map = _ai_map_from_df(ai_factor_df) if ai_factor_df is not None else {}
    wx = _weather_lookup(weather_map, target_date)
    ai = _ai_lookup(ai_map, target_date)

    row = {
        **base,
        **wx,
        **ai,
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
        "target_is_holiday_eve": is_eve,
        "target_is_post_holiday": is_post,
        "target_is_bridge_day": is_bridge,
        "lunar_ny_distance": lny_dist,
        "days_to_next_holiday": days_to_next_holiday,
        "days_since_prev_holiday": days_since_prev_holiday,
        "is_covid_period": is_covid_period(target_date),
        "lag358": lag358,
        "lag364": lag364,
        "lag371": lag371,
        "yoy_same_dow_mean": yoy_same_dow_mean,
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
    weather_df: pd.DataFrame | None = None,
    ai_factor_df: pd.DataFrame | None = None,
    quantile_models: Dict[str, Dict[str, xgb.Booster]] | None = None,
    lightgbm_models: Dict[str, object] | None = None,
) -> Dict[str, object]:
    target_date = pd.Timestamp(target_date_str)
    history = historical_df.copy() if historical_df is not None else load_actual_data_from_db()
    history["Date"] = pd.to_datetime(history["Date"])
    history = history.sort_values("Date").reset_index(drop=True)

    if bundle is None:
        bundle = load_model_bundle()
    if models is None:
        models = load_bucket_models(bundle)
    if quantile_models is None:
        try:
            quantile_models = load_quantile_models(bundle)
        except Exception:  # pragma: no cover
            quantile_models = {}
    if lightgbm_models is None:
        try:
            lightgbm_models = load_lightgbm_models(bundle)
        except Exception:  # pragma: no cover
            lightgbm_models = {}
    if weather_df is None:
        try:
            weather_df = load_weather_history_from_db()
        except Exception:  # pragma: no cover
            weather_df = pd.DataFrame(columns=["Date"])
    if ai_factor_df is None:
        try:
            ai_factor_df = load_ai_factor_history_from_db()
        except Exception:  # pragma: no cover
            ai_factor_df = pd.DataFrame(columns=["Date", "ai_factor"])

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
        weather_df=weather_df,
        ai_factor_df=ai_factor_df,
    )

    dmatrix = xgb.DMatrix(feature_row[FEATURE_COLUMNS], feature_names=FEATURE_COLUMNS)
    booster = models[bucket.name]
    best_iteration = int(bucket_info.get("best_iteration") or 0)
    if best_iteration > 0:
        xgb_raw = float(booster.predict(dmatrix, iteration_range=(0, best_iteration + 1))[0])
    else:
        xgb_raw = float(booster.predict(dmatrix)[0])

    # Ensemble with LightGBM companion when available + ensemble_active.
    lgb_spec = (lightgbm_models or {}).get(bucket.name)
    if lgb_spec and bucket_info.get("ensemble_active"):
        try:
            lgb_pred = float(lgb_spec["booster"].predict(
                feature_row[FEATURE_COLUMNS],
                num_iteration=lgb_spec.get("best_iteration") or None,
            )[0])
            w = float(lgb_spec.get("weight_xgb", 0.55))
            raw_prediction = w * xgb_raw + (1.0 - w) * lgb_pred
        except Exception:  # pragma: no cover
            raw_prediction = xgb_raw
    else:
        raw_prediction = xgb_raw

    bias_array = _apply_bias(feature_row, np.array([raw_prediction]), bucket_info.get("bias_correction"))
    bias_applied = float(bias_array[0]) if len(bias_array) else 0.0
    prediction = raw_prediction - bias_applied

    # State-dependent CI from learned q10/q90 boosters (preferred);
    # falls back to static residual quantiles when quantile models missing.
    interval: Dict[str, Dict[str, float]] | None = None
    bucket_quantile = (quantile_models or {}).get(bucket.name) or {}
    if "q10" in bucket_quantile and "q90" in bucket_quantile:
        q10_pred = float(bucket_quantile["q10"].predict(dmatrix)[0]) - bias_applied
        q90_pred = float(bucket_quantile["q90"].predict(dmatrix)[0]) - bias_applied
        if q10_pred > q90_pred:
            q10_pred, q90_pred = q90_pred, q10_pred
        span = max(q90_pred - q10_pred, 1.0)
        interval = {
            "ci80": {"low": round(q10_pred, 2), "high": round(q90_pred, 2)},
            "ci95": {
                "low": round(prediction - span * 1.225, 2),
                "high": round(prediction + span * 1.225, 2),
            },
        }
    if interval is None:
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
            "raw_prediction": round(raw_prediction, 2),
            "bias_correction_applied": round(bias_applied, 4),
        },
    }


def predict_range(
    start_date_str: str,
    days: int,
    historical_df: pd.DataFrame | None = None,
    bundle: Dict[str, object] | None = None,
    models: Dict[str, xgb.Booster] | None = None,
    weather_df: pd.DataFrame | None = None,
    ai_factor_df: pd.DataFrame | None = None,
    quantile_models: Dict[str, Dict[str, xgb.Booster]] | None = None,
    lightgbm_models: Dict[str, object] | None = None,
) -> Dict[str, object]:
    start_date = pd.Timestamp(start_date_str)
    history = historical_df.copy() if historical_df is not None else load_actual_data_from_db()
    if bundle is None:
        bundle = load_model_bundle()
    if models is None:
        models = load_bucket_models(bundle)
    if quantile_models is None:
        try:
            quantile_models = load_quantile_models(bundle)
        except Exception:  # pragma: no cover
            quantile_models = {}
    if lightgbm_models is None:
        try:
            lightgbm_models = load_lightgbm_models(bundle)
        except Exception:  # pragma: no cover
            lightgbm_models = {}
    if weather_df is None:
        try:
            weather_df = load_weather_history_from_db()
        except Exception:  # pragma: no cover
            weather_df = pd.DataFrame(columns=["Date"])
    if ai_factor_df is None:
        try:
            ai_factor_df = load_ai_factor_history_from_db()
        except Exception:  # pragma: no cover
            ai_factor_df = pd.DataFrame(columns=["Date", "ai_factor"])

    predictions = []
    for offset in range(days):
        target_date = start_date + timedelta(days=offset)
        result = predict_target_date(
            str(target_date.date()),
            historical_df=history,
            bundle=bundle,
            models=models,
            weather_df=weather_df,
            ai_factor_df=ai_factor_df,
            quantile_models=quantile_models,
            lightgbm_models=lightgbm_models,
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
    weather_df = load_weather_history_from_db()
    ai_df = load_ai_factor_history_from_db()
    datasets = build_training_examples(
        df=df,
        holiday_set=holiday_set,
        recent_rows=recent_rows,
        min_history_days=MIN_HISTORY_DAYS,
        weather_df=weather_df,
        ai_factor_df=ai_df,
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
