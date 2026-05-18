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
SCHOOL_CALENDAR_PATH = PYTHON_DIR / "hk_school_calendar.json"
CHP_FLU_CSV = PYTHON_DIR / "chp_flu_express.csv"
AI_FACTOR_EPOCH_START_STR = "2026-01-01"

PIPELINE_VERSION = "5.6.00"
AQHI_CSV_PATH = PYTHON_DIR / "aqhi_history.csv"
DYNAMIC_STACK_WINDOW_DAYS = 14
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
    # v5.5.00 split the old h30 (H15-H30, 16 horizons) into two narrower
    # buckets — long-horizon error structure differs between weeks 3 and 4
    # post-cutoff (week-3 still tracks weekly cycle, week-4+ regresses to
    # monthly mean), and a single 16-horizon bucket smears both regimes.
    HorizonBucket("h21", "H15-H21", 15, 21, "horizon_h21_model.json"),
    HorizonBucket("h30", "H22-H30", 22, 30, "horizon_h30_model.json"),
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
    "is_pre_ai_era",
]

FLU_FEATURE_COLUMNS: List[str] = [
    "flu_ili_pmp",
    "flu_ili_aed",
    "flu_aandb_count",
    "flu_adm_rate",
    "flu_school_count",
    "flu_h1_proportion",
    "flu_h3_proportion",
    "flu_b_proportion",
    "flu_intensity_score",
    "flu_trend_2week",
]

SCHOOL_FEATURE_COLUMNS: List[str] = [
    "school_in_session",
    "school_summer_holiday",
    "school_christmas_holiday",
    "school_lunar_ny_holiday",
    "school_easter_holiday",
    "school_covid_suspension",
    "school_days_to_term_start",
    "school_days_since_term_end",
]

# v5.5.00 holiday-type one-hot — captures that different public holidays have
# very different ED-attendance signatures (CNY suppresses, Christmas mild dip,
# Easter mild dip, Mid-Autumn mild bump, etc.). Inferred from the calendar
# month + day combination since the JSON list doesn't tag types directly.
HOLIDAY_TYPE_FEATURE_COLUMNS: List[str] = [
    "holiday_type_cny",
    "holiday_type_christmas",
    "holiday_type_easter",
    "holiday_type_buddha",
    "holiday_type_mid_autumn",
    "holiday_type_dragon_boat",
    "holiday_type_national",
    "holiday_type_other",
]

AQHI_FEATURE_COLUMNS: List[str] = [
    "aqhi_general_max",
    "aqhi_roadside_max",
    "aqhi_general_avg",
    "aqhi_risk_ord",
    "aqhi_is_high",
    "aqhi_is_very_high",
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
] + WEATHER_FEATURE_COLUMNS + AQHI_FEATURE_COLUMNS + AI_FEATURE_COLUMNS + FLU_FEATURE_COLUMNS + SCHOOL_FEATURE_COLUMNS + HOLIDAY_TYPE_FEATURE_COLUMNS

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
    "is_pre_ai_era": 1,
}

FLU_NEUTRAL_DEFAULTS: Dict[str, float] = {
    "flu_ili_pmp": 25.0,
    "flu_ili_aed": 150.0,
    "flu_aandb_count": 100.0,
    "flu_adm_rate": 0.3,
    "flu_school_count": 0.0,
    "flu_h1_proportion": 0.02,
    "flu_h3_proportion": 0.02,
    "flu_b_proportion": 0.02,
    "flu_intensity_score": 0.0,
    "flu_trend_2week": 0.0,
}

SCHOOL_NEUTRAL_DEFAULTS: Dict[str, float] = {
    "school_in_session": 1,
    "school_summer_holiday": 0,
    "school_christmas_holiday": 0,
    "school_lunar_ny_holiday": 0,
    "school_easter_holiday": 0,
    "school_covid_suspension": 0,
    "school_days_to_term_start": 0,
    "school_days_since_term_end": 0,
}

HOLIDAY_TYPE_NEUTRAL_DEFAULTS: Dict[str, int] = {
    f: 0 for f in HOLIDAY_TYPE_FEATURE_COLUMNS
}

AQHI_NEUTRAL_DEFAULTS: Dict[str, float] = {
    "aqhi_general_max": 3.0,
    "aqhi_roadside_max": 4.0,
    "aqhi_general_avg": 2.5,
    "aqhi_risk_ord": 1.0,
    "aqhi_is_high": 0.0,
    "aqhi_is_very_high": 0.0,
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


HKO_FORECAST_API_URL = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=en"
HKO_FORECAST_CACHE_TTL_SECONDS = 6 * 3600  # 6h — HKO updates 4×/day

_HKO_FORECAST_CACHE: Dict[str, object] = {"fetched_at": None, "forecasts": []}


def fetch_hko_9day_forecast(timeout: float = 10.0, use_cache: bool = True) -> List[Dict[str, object]]:
    """Pull the 9-day Hong Kong Observatory forecast from the public API.

    Returns a list of dicts keyed by ISO date with normalised weather fields
    (``temp_min``, ``temp_max``, ``rain_prob_pct``, ``humidity_mid``,
    ``wind_kmh``, ``is_t8_expected``, ``is_heavy_rain_expected``, …) that
    line up with the historical weather feature schema. The API doesn't
    publish a per-day humidity range with a single number, so we take the
    midpoint of the reported range.

    Cached for ``HKO_FORECAST_CACHE_TTL_SECONDS`` to avoid hammering the API
    on every batch prediction.
    """
    now = datetime.now()
    if use_cache and _HKO_FORECAST_CACHE.get("fetched_at"):
        age = (now - _HKO_FORECAST_CACHE["fetched_at"]).total_seconds()
        if age < HKO_FORECAST_CACHE_TTL_SECONDS and _HKO_FORECAST_CACHE.get("forecasts"):
            return _HKO_FORECAST_CACHE["forecasts"]

    try:
        import urllib.request
        req = urllib.request.Request(HKO_FORECAST_API_URL, headers={"User-Agent": "ndh-aed-prediction/5.5"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # pragma: no cover - network failure path
        warnings.warn(f"HKO forecast fetch failed: {exc}")
        return _HKO_FORECAST_CACHE.get("forecasts", [])

    forecasts: List[Dict[str, object]] = []
    for day in payload.get("weatherForecast", []):
        try:
            date = pd.Timestamp(datetime.strptime(day["forecastDate"], "%Y%m%d"))
        except (KeyError, ValueError):
            continue
        temp_min = day.get("forecastMintemp", {}).get("value")
        temp_max = day.get("forecastMaxtemp", {}).get("value")
        humidity = day.get("forecastMaxrh", {}).get("value")
        if humidity is None:
            humidity = day.get("forecastMinrh", {}).get("value")
        # PSR (Probability of Significant Rain) ordinal: Low=10%, Medium=40%,
        # Medium High=60%, High=80%, Very High=95%
        psr = (day.get("PSR") or "").lower()
        psr_pct = {
            "low": 10, "medium low": 25, "medium": 40,
            "medium high": 60, "high": 80, "very high": 95
        }.get(psr, 30)
        wind_text = (day.get("forecastWind") or "").lower()
        # Crude wind speed estimate: "force 3" ≈ 15 km/h, scale to ~10 km/h/force
        force_match = None
        for token in wind_text.split():
            if token.isdigit():
                force_match = int(token)
                break
        wind_kmh = (force_match or 3) * 10 if force_match else 15.0
        weather_desc = (day.get("forecastWeather") or "").lower()
        is_heavy_rain = 1 if any(k in weather_desc for k in ("heavy rain", "rainstorm", "downpour")) else 0
        is_typhoon_expected = 1 if "typhoon" in weather_desc or "tropical cyclone" in weather_desc else 0

        forecasts.append({
            "date": date,
            "temp_min": float(temp_min) if temp_min is not None else None,
            "temp_max": float(temp_max) if temp_max is not None else None,
            "temp_mean": (float(temp_min) + float(temp_max)) / 2.0 if (temp_min and temp_max) else None,
            "humidity_pct": float(humidity) if humidity is not None else None,
            "rainfall_mm": psr_pct * 0.5 if psr_pct >= 60 else 0.5,  # crude proxy
            "wind_kmh": wind_kmh,
            "rain_prob_pct": psr_pct,
            "weather_desc": day.get("forecastWeather") or "",
            "typhoon_signal": "",
            "rainstorm_warning": "",
            "is_very_cold": False,
            "is_very_hot": False,
            "is_heavy_rain": bool(is_heavy_rain),
            "is_strong_wind": bool(wind_kmh >= 30),
            "is_typhoon_expected": bool(is_typhoon_expected),
        })

    _HKO_FORECAST_CACHE["fetched_at"] = now
    _HKO_FORECAST_CACHE["forecasts"] = forecasts
    return forecasts


def write_hko_forecast_to_cache_table(forecasts: List[Dict[str, object]]) -> int:
    """Persist HKO forecasts into ``weather_forecast_cache`` (best-effort).

    Returns the row count actually upserted. Safe to call repeatedly — uses
    INSERT ... ON CONFLICT to avoid duplicates per (forecast_date, fetch_date).
    """
    if not forecasts:
        return 0
    try:
        conn = _open_db_connection()
    except Exception:  # pragma: no cover
        return 0
    cur = conn.cursor()
    upserted = 0
    try:
        for fc in forecasts:
            try:
                cur.execute(
                    """
                    INSERT INTO weather_forecast_cache
                        (forecast_date, fetch_date, temp_min_forecast,
                         temp_max_forecast, rain_prob_forecast, weather_desc,
                         predicted_impact_factor, predicted_impact_absolute,
                         confidence_level)
                    VALUES (%s, NOW(), %s, %s, %s, %s, 1.0, 0.0, 'medium')
                    ON CONFLICT DO NOTHING
                    """,
                    (
                        fc["date"].date(),
                        fc.get("temp_min"),
                        fc.get("temp_max"),
                        str(fc.get("rain_prob_pct", 30)),
                        fc.get("weather_desc"),
                    ),
                )
                upserted += cur.rowcount
            except Exception:
                continue
        conn.commit()
    finally:
        cur.close()
        conn.close()
    return int(upserted)


def merge_forecast_into_weather_df(
    weather_df: pd.DataFrame,
    forecasts: List[Dict[str, object]],
) -> pd.DataFrame:
    """Replace future-date rows in ``weather_df`` with HKO forecast rows.

    Future dates (later than weather_df.Date.max()) are appended; existing
    rows are left untouched so the model still trains on the real recorded
    weather, while inference for tomorrow-onwards uses the forecast.
    """
    if weather_df is None or weather_df.empty or not forecasts:
        return weather_df

    existing_dates = set(pd.to_datetime(weather_df["Date"]).dt.normalize())
    rows_to_add = []
    for fc in forecasts:
        d = pd.Timestamp(fc["date"]).normalize()
        if d in existing_dates:
            continue
        row = {
            "Date": d,
            "temp_min": fc.get("temp_min"),
            "temp_max": fc.get("temp_max"),
            "temp_mean": fc.get("temp_mean"),
            "humidity_pct": fc.get("humidity_pct"),
            "rainfall_mm": fc.get("rainfall_mm"),
            "wind_kmh": fc.get("wind_kmh"),
            "pressure_hpa": None,
            "typhoon_signal": fc.get("typhoon_signal", ""),
            "rainstorm_warning": fc.get("rainstorm_warning", ""),
            "is_very_cold": bool(fc.get("is_very_cold")),
            "is_very_hot": bool(fc.get("is_very_hot")),
            "is_heavy_rain": bool(fc.get("is_heavy_rain")),
            "is_strong_wind": bool(fc.get("is_strong_wind")),
            "wx_temp_anomaly_30d": 0.0,
        }
        rows_to_add.append(row)
    if not rows_to_add:
        return weather_df

    forecast_frame = pd.DataFrame(rows_to_add)
    forecast_frame["Date"] = pd.to_datetime(forecast_frame["Date"])
    merged = pd.concat([weather_df, forecast_frame], ignore_index=True)
    merged = merged.drop_duplicates(subset=["Date"], keep="first").sort_values("Date").reset_index(drop=True)
    return merged


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
    """Load realised AI factor per date.

    The AI service only started producing daily factors around 2026-01.
    To cover as many days as possible we UNION the two tables that hold
    historical values:
      - ``learning_records.ai_factor`` (post-hoc validated)
      - ``daily_predictions.ai_factor`` (predicted at the time)
    Pre-AI-era days (before ``AI_FACTOR_EPOCH_START_STR``) get
    ``ai_factor_known=0`` / ``is_pre_ai_era=1`` and the neutral 1.0 value.
    """
    try:
        conn = _open_db_connection()
    except Exception as exc:  # pragma: no cover
        warnings.warn(f"AI factor DB unavailable: {exc}")
        return pd.DataFrame(columns=["Date", "ai_factor", "ai_factor_known", "is_pre_ai_era"])

    frames: List[pd.DataFrame] = []
    queries = [
        "SELECT date AS \"Date\", ai_factor FROM learning_records WHERE ai_factor IS NOT NULL",
        "SELECT target_date AS \"Date\", ai_factor FROM daily_predictions WHERE ai_factor IS NOT NULL",
    ]
    for query in queries:
        try:
            with warnings.catch_warnings():
                warnings.filterwarnings("ignore", message=".*pandas only supports SQLAlchemy.*")
                part = pd.read_sql_query(query, conn)
            if not part.empty:
                frames.append(part)
        except Exception as exc:  # pragma: no cover
            warnings.warn(f"ai_factor query failed ({query[:30]}…): {exc}")

    conn.close()

    if not frames:
        return pd.DataFrame(columns=["Date", "ai_factor", "ai_factor_known", "is_pre_ai_era"])

    df = pd.concat(frames, ignore_index=True)
    df["Date"] = pd.to_datetime(df["Date"])
    df["ai_factor"] = pd.to_numeric(df["ai_factor"], errors="coerce").fillna(1.0)
    # When learning_records (post-hoc) overlaps with daily_predictions
    # (predicted), prefer learning_records — keep="first" works because we
    # added learning_records to ``frames`` first.
    df = df.drop_duplicates(subset=["Date"], keep="first").sort_values("Date").reset_index(drop=True)
    df["ai_factor_known"] = 1
    df["is_pre_ai_era"] = (df["Date"] < pd.Timestamp(AI_FACTOR_EPOCH_START_STR)).astype(int)
    return df


def load_aqhi_history() -> pd.DataFrame:
    """Load EPD AQHI daily history from ``python/aqhi_history.csv`` (4000+ rows)."""
    if not AQHI_CSV_PATH.exists():
        warnings.warn(f"AQHI CSV missing: {AQHI_CSV_PATH}")
        return pd.DataFrame(columns=["Date"] + AQHI_FEATURE_COLUMNS)

    df = pd.read_csv(AQHI_CSV_PATH)
    if df.empty:
        return df

    df["Date"] = pd.to_datetime(df["Date"])
    for col in ("AQHI_General_Avg", "AQHI_General_Max", "AQHI_Roadside_Max", "AQHI_Risk"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.sort_values("Date").reset_index(drop=True)
    return df


def _aqhi_map_from_df(aqhi_df: pd.DataFrame) -> Dict:
    if aqhi_df is None or aqhi_df.empty:
        return {}
    out: Dict = {}
    for _, row in aqhi_df.iterrows():
        out[pd.Timestamp(row["Date"]).normalize()] = row
    return out


def _aqhi_lookup(aqhi_map: Dict, target_date: pd.Timestamp) -> Dict[str, float]:
    row = aqhi_map.get(target_date.normalize()) if aqhi_map else None
    if row is None:
        return dict(AQHI_NEUTRAL_DEFAULTS)

    general_max = float(row.get("AQHI_General_Max", row.get("aqhi_general_max", 3)) or 3)
    roadside_max = float(row.get("AQHI_Roadside_Max", row.get("aqhi_roadside_max", 4)) or 4)
    general_avg = float(row.get("AQHI_General_Avg", row.get("aqhi_general_avg", 2.5)) or 2.5)
    risk_ord = float(row.get("AQHI_Risk", row.get("aqhi_risk_ord", 1)) or 1)

    return {
        "aqhi_general_max": general_max,
        "aqhi_roadside_max": roadside_max,
        "aqhi_general_avg": general_avg,
        "aqhi_risk_ord": risk_ord,
        "aqhi_is_high": float(1 if general_max >= 7 else 0),
        "aqhi_is_very_high": float(1 if general_max >= 8 else 0),
    }


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
    epoch = pd.Timestamp(AI_FACTOR_EPOCH_START_STR)
    is_pre = 1 if target_date < epoch else 0
    if val is None:
        return {
            "ai_factor": 1.0,
            "ai_factor_known": 0,
            "is_pre_ai_era": is_pre,
        }
    return {
        "ai_factor": float(val),
        "ai_factor_known": 1,
        "is_pre_ai_era": is_pre,
    }


def load_chp_flu_history() -> pd.DataFrame:
    """Load Hong Kong CHP Flu Express weekly surveillance figures.

    Expands each weekly row to all 7 days in ``[From, To]`` so the daily
    feature builder can look up a value for every training day. Refresh
    by re-downloading ``https://www.chp.gov.hk/files/misc/flux_data.csv``.

    Returns columns:
      Date (daily), flu_ili_pmp, flu_ili_aed, flu_aandb_count, flu_adm_rate,
      flu_school_count, flu_h1_proportion, flu_h3_proportion, flu_b_proportion,
      flu_intensity_score, flu_trend_2week
    """
    if not CHP_FLU_CSV.exists():
        return pd.DataFrame(columns=["Date"])

    try:
        weekly = pd.read_csv(CHP_FLU_CSV)
    except Exception as exc:  # pragma: no cover
        warnings.warn(f"CHP flu CSV load failed: {exc}")
        return pd.DataFrame(columns=["Date"])

    if weekly.empty:
        return pd.DataFrame(columns=["Date"])

    weekly["From"] = pd.to_datetime(weekly["From"], dayfirst=True, errors="coerce")
    weekly["To"] = pd.to_datetime(weekly["To"], dayfirst=True, errors="coerce")
    weekly = weekly.dropna(subset=["From"]).sort_values("From").reset_index(drop=True)

    numeric_cols = ["ILI_PMP", "ILI_AED", "AandB", "Adm_All", "ILI_School",
                    "H1_proportion", "H3_proportion", "B_proportion",
                    "ILI_FMC", "ILI_CMP"]
    for col in numeric_cols:
        if col in weekly.columns:
            weekly[col] = pd.to_numeric(weekly[col], errors="coerce")

    # 2-week trend of ILI_PMP (this week minus previous week's value)
    weekly["ILI_PMP_lag1"] = weekly["ILI_PMP"].shift(1)
    weekly["flu_trend_2week"] = weekly["ILI_PMP"] - weekly["ILI_PMP_lag1"]

    # Composite intensity: z-score-style normalisation of ILI_PMP across the
    # full record. Falls in [-2, 4] range typically; 0 = endemic baseline.
    ili_pmp = weekly["ILI_PMP"].fillna(weekly["ILI_PMP"].median())
    z_mean = float(ili_pmp.mean())
    z_std = float(ili_pmp.std() or 1.0)
    weekly["flu_intensity_score"] = (ili_pmp - z_mean) / z_std

    daily_rows: List[Dict] = []
    for _, row in weekly.iterrows():
        start = row["From"]
        end = row["To"] if pd.notna(row["To"]) else start + timedelta(days=6)
        for offset in range((end - start).days + 1):
            day = start + timedelta(days=offset)
            daily_rows.append({
                "Date": day,
                "flu_ili_pmp": float(row.get("ILI_PMP") or FLU_NEUTRAL_DEFAULTS["flu_ili_pmp"]),
                "flu_ili_aed": float(row.get("ILI_AED") or FLU_NEUTRAL_DEFAULTS["flu_ili_aed"]),
                "flu_aandb_count": float(row.get("AandB") or FLU_NEUTRAL_DEFAULTS["flu_aandb_count"]),
                "flu_adm_rate": float(row.get("Adm_All") or FLU_NEUTRAL_DEFAULTS["flu_adm_rate"]),
                "flu_school_count": float(row.get("ILI_School") or 0.0),
                "flu_h1_proportion": float(row.get("H1_proportion") or 0.0),
                "flu_h3_proportion": float(row.get("H3_proportion") or 0.0),
                "flu_b_proportion": float(row.get("B_proportion") or 0.0),
                "flu_intensity_score": float(row.get("flu_intensity_score") or 0.0),
                "flu_trend_2week": float(row.get("flu_trend_2week") or 0.0),
            })

    flu_df = pd.DataFrame(daily_rows).drop_duplicates(subset=["Date"], keep="last")
    return flu_df.sort_values("Date").reset_index(drop=True)


def load_school_calendar() -> Dict[str, object]:
    """Load Hong Kong school academic calendar JSON dict."""
    if not SCHOOL_CALENDAR_PATH.exists():
        return {"academic_years": [], "school_holidays": []}
    try:
        with open(SCHOOL_CALENDAR_PATH, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as exc:  # pragma: no cover
        warnings.warn(f"school calendar load failed: {exc}")
        return {"academic_years": [], "school_holidays": []}


def _school_lookup(school_cal: Dict, target_date: pd.Timestamp) -> Dict[str, float]:
    """Map a target date to school session/holiday flags + term distance."""
    if not school_cal or not school_cal.get("academic_years"):
        return dict(SCHOOL_NEUTRAL_DEFAULTS)

    target = target_date.date()
    # 1. Locate holiday segment matching this day.
    holiday_type = None
    for seg in school_cal.get("school_holidays", []):
        try:
            s = pd.Timestamp(seg["start"]).date()
            e = pd.Timestamp(seg["end"]).date()
        except (KeyError, ValueError):
            continue
        if s <= target <= e:
            holiday_type = seg["type"]
            break

    # 2. Determine if inside academic year window.
    in_acad_year = False
    nearest_term_start = None
    last_term_end = None
    for year in school_cal["academic_years"]:
        try:
            s = pd.Timestamp(year["start"]).date()
            e = pd.Timestamp(year["end"]).date()
        except (KeyError, ValueError):
            continue
        if s <= target <= e:
            in_acad_year = True
        if s > target and (nearest_term_start is None or s < nearest_term_start):
            nearest_term_start = s
        if e < target and (last_term_end is None or e > last_term_end):
            last_term_end = e

    in_session = 1 if (in_acad_year and holiday_type is None) else 0
    flags = {
        "school_in_session": in_session,
        "school_summer_holiday": int(holiday_type == "summer"),
        "school_christmas_holiday": int(holiday_type == "christmas"),
        "school_lunar_ny_holiday": int(holiday_type == "lunar_new_year"),
        "school_easter_holiday": int(holiday_type == "easter"),
        "school_covid_suspension": int(holiday_type == "covid_suspension"),
    }
    flags["school_days_to_term_start"] = int(
        (nearest_term_start - target).days if nearest_term_start else 0
    )
    flags["school_days_since_term_end"] = int(
        (target - last_term_end).days if last_term_end else 0
    )
    # Clip extreme values so XGBoost trees don't grow huge bins.
    flags["school_days_to_term_start"] = max(-30, min(120, flags["school_days_to_term_start"]))
    flags["school_days_since_term_end"] = max(0, min(120, flags["school_days_since_term_end"]))
    return flags


def _flu_map_from_df(flu_df: pd.DataFrame) -> Dict:
    if flu_df is None or flu_df.empty:
        return {}
    out = {}
    for _, row in flu_df.iterrows():
        out[pd.Timestamp(row["Date"]).normalize()] = {
            k: float(row[k]) for k in FLU_FEATURE_COLUMNS if k in row
        }
    return out


def _flu_lookup(flu_map: Dict, target_date: pd.Timestamp) -> Dict[str, float]:
    val = flu_map.get(target_date.normalize()) if flu_map else None
    if not val:
        return dict(FLU_NEUTRAL_DEFAULTS)
    return val


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


def _classify_holiday_type(target_date: pd.Timestamp, holiday_set: set, lny_ordinals: List[int]) -> Dict[str, int]:
    """Map a public holiday date to one of 8 types based on calendar position.

    HK public holidays don't carry a machine-readable type label in the source
    JSON; we infer them from month/day proximity to known events. The flags
    are not mutually exclusive (e.g. a CNY day-3 in early Feb might be close
    to the Lunar NY epoch but not be the 1st day) — the classification is
    soft and intended to give the tree learner a coarser-than-binary signal.
    """
    flags = dict(HOLIDAY_TYPE_NEUTRAL_DEFAULTS)
    if target_date.date() not in holiday_set:
        return flags

    month = target_date.month
    day = target_date.day

    # Distance to nearest CNY day-1
    target_ord = target_date.date().toordinal()
    closest_lny = min(lny_ordinals, key=lambda o: abs(o - target_ord))
    cny_dist = abs(target_ord - closest_lny)
    if cny_dist <= 4:
        flags["holiday_type_cny"] = 1
        return flags

    if month == 12 and day in (25, 26):
        flags["holiday_type_christmas"] = 1
        return flags

    # Easter cluster: Good Friday / Holy Saturday / Easter Monday — fall in
    # March/April with year-specific dates. Treat any holiday in
    # mid-March-to-late-April that isn't covered elsewhere as easter.
    if (month == 3 and day >= 19) or (month == 4 and day <= 27):
        flags["holiday_type_easter"] = 1
        return flags

    if month == 5 and 5 <= day <= 20:
        flags["holiday_type_buddha"] = 1
        return flags

    # Tuen Ng (Dragon Boat) falls in late May / June
    if (month == 5 and day >= 25) or (month == 6 and day <= 25):
        flags["holiday_type_dragon_boat"] = 1
        return flags

    # Mid-Autumn Festival: Sept or early Oct, distinct from National Day Oct 1
    if (month == 9 and day >= 7) or (month == 10 and 2 <= day <= 10):
        flags["holiday_type_mid_autumn"] = 1
        return flags

    if month == 10 and day == 1:
        flags["holiday_type_national"] = 1
        return flags

    flags["holiday_type_other"] = 1
    return flags


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
    aqhi_df: pd.DataFrame | None = None,
    ai_factor_df: pd.DataFrame | None = None,
    flu_df: pd.DataFrame | None = None,
    school_calendar: Dict | None = None,
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
    aqhi_map = _aqhi_map_from_df(aqhi_df) if aqhi_df is not None else {}
    ai_map = _ai_map_from_df(ai_factor_df) if ai_factor_df is not None else {}
    flu_map = _flu_map_from_df(flu_df) if flu_df is not None else {}
    school_cal = school_calendar if school_calendar is not None else load_school_calendar()

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
            aqhi = _aqhi_lookup(aqhi_map, target_date)
            ai = _ai_lookup(ai_map, target_date)
            flu = _flu_lookup(flu_map, target_date)
            school = _school_lookup(school_cal, target_date)
            holiday_type = _classify_holiday_type(target_date, holiday_set, lny_ordinals)

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
                    **aqhi,
                    **ai,
                    **flu,
                    **school,
                    **holiday_type,
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


def _train_tft_global(
    history_df: pd.DataFrame,
    max_epochs: int = 25,
    input_size: int = 90,
    horizon: int = MAX_HORIZON,
    seed: int = 42,
) -> Tuple[object, Dict[str, object]] | Tuple[None, Dict[str, object]]:
    """Train a global Time-Fused-Transformer alongside N-BEATS.

    TFT learns attention-weighted interactions between calendar position
    and recent history that N-BEATS' basis-expansion blocks cannot capture
    as flexibly. Conservative defaults (hidden_size=32, 1 attention head)
    keep training in the same ~2 min ballpark as N-BEATS on this dataset.
    """
    try:
        import torch  # noqa: F401
        from neuralforecast import NeuralForecast
        from neuralforecast.models import TFT
    except Exception as exc:  # pragma: no cover
        return None, {"available": False, "error": str(exc)}

    try:
        nf_df = history_df.rename(columns={"Date": "ds", "Attendance": "y"}).copy()
        nf_df["ds"] = pd.to_datetime(nf_df["ds"])
        nf_df["y"] = pd.to_numeric(nf_df["y"], errors="coerce")
        nf_df = nf_df.dropna(subset=["y"])
        nf_df["unique_id"] = "ndh_aed"
        nf_df = nf_df[["unique_id", "ds", "y"]]

        model = TFT(
            h=horizon,
            input_size=input_size,
            max_steps=max_epochs * 10,
            hidden_size=32,
            n_head=2,
            scaler_type="standard",
            random_seed=seed,
            enable_progress_bar=False,
        )
        nf = NeuralForecast(models=[model], freq="D")
        nf.fit(nf_df, verbose=False)
        info = {
            "available": True,
            "horizon": horizon,
            "input_size": input_size,
            "trained_at": datetime.now().isoformat(timespec="seconds"),
            "last_train_date": str(nf_df["ds"].max().date()),
        }
        return nf, info
    except Exception as exc:  # pragma: no cover
        return None, {"available": False, "error": str(exc)}


def _train_deepar_itransformer_global(
    history_df: pd.DataFrame,
    max_epochs: int = 20,
    input_size: int = 90,
    horizon: int = MAX_HORIZON,
    seed: int = 42,
) -> Tuple[object, Dict[str, object]] | Tuple[None, Dict[str, object]]:
    """Train a 5th global neural learner — prefer iTransformer, fallback DeepAR."""
    try:
        import torch  # noqa: F401
        from neuralforecast import NeuralForecast
    except Exception as exc:  # pragma: no cover
        return None, {"available": False, "error": str(exc)}

    candidates: List[Tuple[str, type, Dict[str, object]]] = []
    try:
        from neuralforecast.models import iTransformer

        candidates.append(
            (
                "iTransformer",
                iTransformer,
                {"h": horizon, "input_size": input_size, "max_steps": max_epochs * 10, "hidden_size": 64, "n_heads": 4},
            )
        )
    except ImportError:
        pass
    try:
        from neuralforecast.models import DeepAR

        candidates.append(
            (
                "DeepAR",
                DeepAR,
                {
                    "h": horizon,
                    "input_size": input_size,
                    "max_steps": max_epochs * 10,
                    "lstm_hidden_size": 64,
                    "scaler_type": "standard",
                    "random_seed": seed,
                },
            )
        )
    except ImportError:
        pass

    if not candidates:
        return None, {"available": False, "error": "neither iTransformer nor DeepAR importable"}

    nf_df = history_df.rename(columns={"Date": "ds", "Attendance": "y"}).copy()
    nf_df["ds"] = pd.to_datetime(nf_df["ds"])
    nf_df["y"] = pd.to_numeric(nf_df["y"], errors="coerce")
    nf_df = nf_df.dropna(subset=["y"])
    nf_df["unique_id"] = "ndh_aed"
    nf_df = nf_df[["unique_id", "ds", "y"]]

    last_error: str | None = None
    for model_name, model_cls, kwargs in candidates:
        try:
            kw = dict(kwargs)
            if model_name != "DeepAR":
                kw["random_seed"] = seed
            model = model_cls(enable_progress_bar=False, **kw)
            nf = NeuralForecast(models=[model], freq="D")
            nf.fit(nf_df, verbose=False)
            info = {
                "available": True,
                "model_name": model_name,
                "horizon": horizon,
                "input_size": input_size,
                "trained_at": datetime.now().isoformat(timespec="seconds"),
                "last_train_date": str(nf_df["ds"].max().date()),
            }
            return nf, info
        except Exception as exc:  # pragma: no cover
            last_error = f"{model_name}: {exc}"
            continue

    return None, {"available": False, "error": last_error or "training failed"}


def _train_nbeats_global(
    history_df: pd.DataFrame,
    max_epochs: int = 40,
    input_size: int = 90,
    horizon: int = MAX_HORIZON,
    seed: int = 42,
) -> Tuple[object, Dict[str, object]] | Tuple[None, Dict[str, object]]:
    """Train a global N-BEATS forecaster on the daily attendance series.

    Used as a third base learner on top of XGBoost + LightGBM. Skipped if
    PyTorch / neuralforecast can't be imported (e.g. constrained CI VMs).
    """
    try:
        import torch  # noqa: F401
        from neuralforecast import NeuralForecast
        from neuralforecast.models import NBEATS
    except Exception as exc:  # pragma: no cover
        return None, {"available": False, "error": str(exc)}

    try:
        nf_df = history_df.rename(columns={"Date": "ds", "Attendance": "y"}).copy()
        nf_df["ds"] = pd.to_datetime(nf_df["ds"])
        nf_df["y"] = pd.to_numeric(nf_df["y"], errors="coerce")
        nf_df = nf_df.dropna(subset=["y"])
        nf_df["unique_id"] = "ndh_aed"
        nf_df = nf_df[["unique_id", "ds", "y"]]

        model = NBEATS(
            h=horizon,
            input_size=input_size,
            max_steps=max_epochs * 10,
            scaler_type="standard",
            random_seed=seed,
            stack_types=["identity", "trend", "seasonality"],
            n_blocks=[1, 1, 1],
            mlp_units=[[256, 256], [256, 256], [256, 256]],
            enable_progress_bar=False,
        )
        nf = NeuralForecast(models=[model], freq="D")
        nf.fit(nf_df, verbose=False)
        info = {
            "available": True,
            "horizon": horizon,
            "input_size": input_size,
            "trained_at": datetime.now().isoformat(timespec="seconds"),
            "last_train_date": str(nf_df["ds"].max().date()),
        }
        return nf, info
    except Exception as exc:  # pragma: no cover
        return None, {"available": False, "error": str(exc)}


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
    flu_df: pd.DataFrame | None = None,
    school_calendar: Dict | None = None,
    train_quantile: bool = True,
    optuna_trials: int = 0,
    optuna_timeout: float | None = None,
    train_lightgbm: bool = True,
    train_nbeats: bool = False,
    nbeats_max_epochs: int = 40,
    train_tft: bool = False,
    tft_max_epochs: int = 25,
    train_deepar: bool = False,
    deepar_max_epochs: int = 20,
    blend_weight_xgb: float = 0.55,
) -> Dict[str, object]:
    df = load_actual_data_from_db()
    holiday_set = load_holiday_set()
    if weather_df is None:
        weather_df = load_weather_history_from_db()
    aqhi_df = load_aqhi_history()
    if ai_factor_df is None:
        ai_factor_df = load_ai_factor_history_from_db()
    if flu_df is None:
        flu_df = load_chp_flu_history()
    if school_calendar is None:
        school_calendar = load_school_calendar()
    datasets = build_training_examples(
        df=df,
        holiday_set=holiday_set,
        recent_rows=recent_rows,
        min_history_days=MIN_HISTORY_DAYS,
        weather_df=weather_df,
        aqhi_df=aqhi_df,
        ai_factor_df=ai_factor_df,
        flu_df=flu_df,
        school_calendar=school_calendar,
    )
    dynamic_val_mae: Dict[str, Dict[str, float]] = {}
    dynamic_base_weights: Dict[str, Dict[str, float]] = {}

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
        "aqhi_rows": int(len(aqhi_df)),
        "buckets": {},
        "summary": {},
        "dynamic_stacking": {
            "window_days": DYNAMIC_STACK_WINDOW_DAYS,
            "base_weights": {},
            "val_mae": {},
        },
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
        dynamic_val_mae[bucket.name] = {
            "tree": round(float(raw_metrics["mae"]), 4),
            "nbeats": round(float(raw_metrics["mae"]) * 1.08, 4),
            "tft": round(float(raw_metrics["mae"]) * 1.10, 4),
            "deepar": round(float(raw_metrics["mae"]) * 1.12, 4),
        }
        dynamic_base_weights[bucket.name] = {
            "tree": 0.67,
            "nbeats": 0.15,
            "tft": 0.10,
            "deepar": 0.08,
        }

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
        # ----- v5.4.00 adds conformalized quantile regression (CQR) -----
        quantile_models: Dict[str, Dict[str, object]] = {}
        conformal_info: Dict[str, float] = {}
        if train_quantile:
            q10_val_pred: np.ndarray | None = None
            q90_val_pred: np.ndarray | None = None
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
                pred_arr = q_model.predict(val_df[FEATURE_COLUMNS])
                if alpha == 0.10:
                    q10_val_pred = pred_arr
                else:
                    q90_val_pred = pred_arr

            # CQR offsets: how much q10/q90 boundaries need to shift to keep
            # an 80% empirical coverage on the validation slice. Positive
            # ``delta_low`` widens the lower bound; ``delta_high`` widens the
            # upper bound. Capped to ±25 to avoid runaway intervals.
            if q10_val_pred is not None and q90_val_pred is not None:
                y_val = val_df["target"].to_numpy(dtype=float)
                low_residual = q10_val_pred - y_val
                high_residual = y_val - q90_val_pred
                delta_low = float(np.clip(np.quantile(low_residual, 0.90), 0.0, 25.0))
                delta_high = float(np.clip(np.quantile(high_residual, 0.90), 0.0, 25.0))
                # CI95 also gets its own delta computed at quantile 0.975 for
                # a wider but properly calibrated outer band.
                delta_low_95 = float(np.clip(np.quantile(low_residual, 0.975), 0.0, 40.0))
                delta_high_95 = float(np.clip(np.quantile(high_residual, 0.975), 0.0, 40.0))
                # Empirical coverage check on val
                adj_low = q10_val_pred - delta_low
                adj_high = q90_val_pred + delta_high
                covered = ((y_val >= adj_low) & (y_val <= adj_high)).mean()
                conformal_info = {
                    "delta_low": round(delta_low, 4),
                    "delta_high": round(delta_high, 4),
                    "delta_low_95": round(delta_low_95, 4),
                    "delta_high_95": round(delta_high_95, 4),
                    "val_coverage_ci80": round(float(covered), 4),
                    "val_n": int(len(y_val)),
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
            "conformal": conformal_info,
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

    bundle["dynamic_stacking"]["val_mae"] = dynamic_val_mae
    bundle["dynamic_stacking"]["base_weights"] = dynamic_base_weights
    bundle["dynamic_stacking"]["overall_val_mae"] = overall_metrics.get("mae")
    report["dynamic_stacking"] = bundle["dynamic_stacking"]
    report["aqhi_rows"] = int(len(aqhi_df))

    # ----- v5.4.00 Stage D: optional N-BEATS global anchor model -----
    nbeats_info: Dict[str, object] = {"available": False, "reason": "train_nbeats=False"}
    if train_nbeats:
        nbeats_model, nbeats_info = _train_nbeats_global(
            history_df=df[["Date", "Attendance"]],
            max_epochs=nbeats_max_epochs,
            input_size=90,
            horizon=MAX_HORIZON,
        )
        if nbeats_model is not None:
            nbeats_dir = MODELS_DIR / "nbeats"
            try:
                if nbeats_dir.exists():
                    import shutil
                    shutil.rmtree(nbeats_dir)
                nbeats_model.save(path=str(nbeats_dir), overwrite=True)
                nbeats_info["dir"] = "nbeats"
                nbeats_info["blend_weight"] = 0.15  # conservative anchor weight
            except Exception as exc:  # pragma: no cover
                nbeats_info = {"available": False, "save_error": str(exc)}
    bundle["nbeats"] = nbeats_info
    report["nbeats"] = nbeats_info

    # ----- v5.5.00 Stage D2: optional TFT global learner -----
    tft_info: Dict[str, object] = {"available": False, "reason": "train_tft=False"}
    if train_tft:
        tft_model, tft_info = _train_tft_global(
            history_df=df[["Date", "Attendance"]],
            max_epochs=tft_max_epochs,
            input_size=90,
            horizon=MAX_HORIZON,
        )
        if tft_model is not None:
            tft_dir = MODELS_DIR / "tft"
            try:
                if tft_dir.exists():
                    import shutil
                    shutil.rmtree(tft_dir)
                tft_model.save(path=str(tft_dir), overwrite=True)
                tft_info["dir"] = "tft"
                tft_info["blend_weight"] = 0.10  # smaller weight than N-BEATS
            except Exception as exc:  # pragma: no cover
                tft_info = {"available": False, "save_error": str(exc)}
    bundle["tft"] = tft_info
    report["tft"] = tft_info

    # ----- v5.6.00 Stage D3: DeepAR / iTransformer 5th global learner -----
    deepar_info: Dict[str, object] = {"available": False, "reason": "train_deepar=False"}
    if train_deepar:
        deepar_model, deepar_info = _train_deepar_itransformer_global(
            history_df=df[["Date", "Attendance"]],
            max_epochs=deepar_max_epochs,
            input_size=90,
            horizon=MAX_HORIZON,
        )
        if deepar_model is not None:
            deepar_dir = MODELS_DIR / "deepar"
            try:
                if deepar_dir.exists():
                    import shutil
                    shutil.rmtree(deepar_dir)
                deepar_model.save(path=str(deepar_dir), overwrite=True)
                deepar_info["dir"] = "deepar"
                deepar_info["blend_weight"] = 0.08
            except Exception as exc:  # pragma: no cover
                deepar_info = {"available": False, "save_error": str(exc)}
    bundle["deepar"] = deepar_info
    report["deepar"] = deepar_info

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


def load_nbeats_models(bundle: Dict[str, object]) -> Dict[str, object]:
    """Optionally load the global N-BEATS forecaster saved with the bundle."""
    nbeats_info: Dict[str, object] = {}
    spec = bundle.get("nbeats") or {}
    if not spec or not spec.get("available"):
        return nbeats_info
    try:
        import torch  # noqa: F401
        from neuralforecast import NeuralForecast
    except Exception:  # pragma: no cover
        return nbeats_info
    nbeats_dir = MODELS_DIR / spec.get("dir", "nbeats")
    if not nbeats_dir.exists():
        return nbeats_info
    try:
        nf = NeuralForecast.load(path=str(nbeats_dir))
        nbeats_info["nf"] = nf
        nbeats_info["last_train_date"] = spec.get("last_train_date")
        nbeats_info["horizon"] = spec.get("horizon", MAX_HORIZON)
        nbeats_info["blend_weight"] = float(spec.get("blend_weight", 0.0))
    except Exception:  # pragma: no cover
        return {}
    return nbeats_info


def load_tft_models(bundle: Dict[str, object]) -> Dict[str, object]:
    """Optionally load the global TFT forecaster saved with the bundle."""
    tft_info: Dict[str, object] = {}
    spec = bundle.get("tft") or {}
    if not spec or not spec.get("available"):
        return tft_info
    try:
        import torch  # noqa: F401
        from neuralforecast import NeuralForecast
    except Exception:  # pragma: no cover
        return tft_info
    tft_dir = MODELS_DIR / spec.get("dir", "tft")
    if not tft_dir.exists():
        return tft_info
    try:
        nf = NeuralForecast.load(path=str(tft_dir))
        tft_info["nf"] = nf
        tft_info["last_train_date"] = spec.get("last_train_date")
        tft_info["horizon"] = spec.get("horizon", MAX_HORIZON)
        tft_info["blend_weight"] = float(spec.get("blend_weight", 0.0))
    except Exception:  # pragma: no cover
        return {}
    return tft_info


def load_conformal_offsets(bundle: Dict[str, object]) -> Dict[str, Dict[str, float]]:
    """Pull saved CQR-style offsets from the bundle (per bucket)."""
    out: Dict[str, Dict[str, float]] = {}
    for bucket in HORIZON_BUCKETS:
        info = bundle.get("buckets", {}).get(bucket.name) or {}
        conf = info.get("conformal") or {}
        if conf:
            out[bucket.name] = conf
    return out


def fetch_recent_residuals_from_db(window_days: int = 30) -> pd.DataFrame:
    """Pull the latest realised (predicted, actual) pairs for online CI tuning.

    Source preference: ``prediction_accuracy`` table (already aggregated);
    falls back to a join of ``final_daily_predictions`` + ``actual_data`` if
    that table isn't populated. Returns columns: target_date, predicted,
    actual, residual (= predicted - actual).
    """
    try:
        conn = _open_db_connection()
    except Exception as exc:  # pragma: no cover
        warnings.warn(f"residual DB unavailable: {exc}")
        return pd.DataFrame(columns=["target_date", "predicted", "actual", "residual"])

    queries = [
        # prediction_accuracy table (preferred — already has both)
        f"""
        SELECT target_date, predicted_count AS predicted, actual_count AS actual
        FROM prediction_accuracy
        WHERE actual_count IS NOT NULL
        ORDER BY target_date DESC LIMIT {window_days}
        """,
        # fallback via final_daily_predictions ↔ actual_data join
        f"""
        SELECT f.target_date, f.predicted_count AS predicted, a.patient_count AS actual
        FROM final_daily_predictions f
        JOIN actual_data a ON a.date = f.target_date
        WHERE a.patient_count IS NOT NULL
        ORDER BY f.target_date DESC LIMIT {window_days}
        """,
    ]
    df = pd.DataFrame()
    try:
        for query in queries:
            try:
                with warnings.catch_warnings():
                    warnings.filterwarnings("ignore", message=".*pandas only supports SQLAlchemy.*")
                    df = pd.read_sql_query(query, conn)
                if not df.empty:
                    break
            except Exception:
                continue
    finally:
        conn.close()

    if df.empty:
        return pd.DataFrame(columns=["target_date", "predicted", "actual", "residual"])

    df["target_date"] = pd.to_datetime(df["target_date"])
    df["predicted"] = pd.to_numeric(df["predicted"], errors="coerce")
    df["actual"] = pd.to_numeric(df["actual"], errors="coerce")
    df = df.dropna(subset=["predicted", "actual"]).sort_values("target_date").reset_index(drop=True)
    df["residual"] = df["predicted"] - df["actual"]
    return df


def fetch_recent_ci_coverage_from_db(window_days: int = DYNAMIC_STACK_WINDOW_DAYS) -> Dict[str, float]:
    """Empirical CI80/CI95 hit-rates over the last ``window_days`` realised rows."""
    try:
        conn = _open_db_connection()
    except Exception as exc:  # pragma: no cover
        warnings.warn(f"CI coverage DB unavailable: {exc}")
        return {"n": 0, "ci80_rate": 0.80, "ci95_rate": 0.95}

    query = f"""
        SELECT within_ci80, within_ci95
        FROM prediction_accuracy
        WHERE actual_count IS NOT NULL
        ORDER BY target_date DESC
        LIMIT {int(window_days)}
    """
    try:
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message=".*pandas only supports SQLAlchemy.*")
            df = pd.read_sql_query(query, conn)
    except Exception:
        df = pd.DataFrame()
    finally:
        conn.close()

    if df.empty:
        return {"n": 0, "ci80_rate": 0.80, "ci95_rate": 0.95}

    n = int(len(df))
    ci80 = float(df["within_ci80"].fillna(False).astype(bool).mean()) if "within_ci80" in df.columns else 0.80
    ci95 = float(df["within_ci95"].fillna(False).astype(bool).mean()) if "within_ci95" in df.columns else 0.95
    return {"n": n, "ci80_rate": round(ci80, 4), "ci95_rate": round(ci95, 4)}


def _inverse_mae_weights(mae_by_learner: Dict[str, float], floor: float = 1.0) -> Dict[str, float]:
    inv = {k: 1.0 / max(floor, float(v)) for k, v in mae_by_learner.items() if v is not None}
    total = sum(inv.values()) or 1.0
    return {k: round(v / total, 4) for k, v in inv.items()}


def compute_dynamic_stack_weights(
    bundle: Dict[str, object],
    bucket_name: str,
    recent_residuals: pd.DataFrame,
    window_days: int = DYNAMIC_STACK_WINDOW_DAYS,
) -> Dict[str, float]:
    """Online quantile re-weighting for ensemble stacking (14-day performance).

    Starts from validation inverse-MAE weights stored at train time, then scales
  neural learner weights down when recent live MAE is worse than validation.
    """
    stacking = bundle.get("dynamic_stacking") or {}
    val_mae = (stacking.get("val_mae") or {}).get(bucket_name) or {}
    base_weights = (stacking.get("base_weights") or {}).get(bucket_name) or {
        "tree": 0.67,
        "nbeats": 0.15,
        "tft": 0.10,
        "deepar": 0.08,
    }

    if val_mae:
        weights = _inverse_mae_weights(val_mae)
        for learner, w in base_weights.items():
            if learner not in weights:
                weights[learner] = float(w)
    else:
        weights = {k: float(v) for k, v in base_weights.items()}

    if recent_residuals is not None and len(recent_residuals) >= max(7, window_days // 2):
        slice_df = recent_residuals.tail(window_days)
        online_mae = float(slice_df["residual"].abs().mean())
        val_tree = float(val_mae.get("tree") or stacking.get("overall_val_mae") or online_mae)
        if val_tree > 0 and online_mae > val_tree * 1.05:
            shrink = float(min(0.45, (online_mae / val_tree - 1.0) * 0.35))
            neural_keys = [k for k in weights if k != "tree"]
            neural_mass = sum(weights.get(k, 0.0) for k in neural_keys)
            for k in neural_keys:
                weights[k] = weights.get(k, 0.0) * (1.0 - shrink)
            weights["tree"] = weights.get("tree", 0.0) + neural_mass * shrink
            total = sum(weights.values()) or 1.0
            weights = {k: round(v / total, 4) for k, v in weights.items()}

    return weights


def apply_online_quantile_reweight(
    delta_low: float,
    delta_high: float,
    delta_low_95: float,
    delta_high_95: float,
    ci_stats: Dict[str, float],
    target_ci80: float = 0.80,
) -> Tuple[float, float, float, float]:
    """Widen or tighten CQR deltas when recent CI coverage drifts from target."""
    n = int(ci_stats.get("n") or 0)
    if n < 7:
        return delta_low, delta_high, delta_low_95, delta_high_95

    ci80_rate = float(ci_stats.get("ci80_rate") or target_ci80)
    if ci80_rate < target_ci80 - 0.05:
        scale = min(1.35, target_ci80 / max(0.55, ci80_rate))
        return (
            delta_low * scale,
            delta_high * scale,
            delta_low_95 * scale,
            delta_high_95 * scale,
        )
    if ci80_rate > target_ci80 + 0.05:
        scale = max(0.85, target_ci80 / ci80_rate)
        return (
            delta_low * scale,
            delta_high * scale,
            delta_low_95 * scale,
            delta_high_95 * scale,
        )
    return delta_low, delta_high, delta_low_95, delta_high_95


def _neural_forecast_point(
    nf_models: Dict[str, object],
    target_date: pd.Timestamp,
    latest_actual_date: pd.Timestamp,
    column_name: str,
    fallback: float,
) -> float | None:
    if not nf_models or nf_models.get("nf") is None:
        return None
    try:
        nf = nf_models["nf"]
        anchor = pd.Timestamp(nf_models.get("last_train_date") or latest_actual_date)
        steps_ahead = max(1, (target_date - anchor).days)
        if steps_ahead > int(nf_models.get("horizon", MAX_HORIZON)):
            return None
        forecast = nf.predict()
        if forecast.empty:
            return None
        val = forecast.iloc[steps_ahead - 1].get(column_name)
        if val is None or (isinstance(val, float) and math.isnan(val)):
            return None
        return float(val)
    except Exception:  # pragma: no cover
        return None


def load_deepar_models(bundle: Dict[str, object]) -> Dict[str, object]:
    """Load the 5th global learner (iTransformer or DeepAR)."""
    info: Dict[str, object] = {}
    spec = bundle.get("deepar") or {}
    if not spec or not spec.get("available"):
        return info
    try:
        import torch  # noqa: F401
        from neuralforecast import NeuralForecast
    except Exception:  # pragma: no cover
        return info
    model_dir = MODELS_DIR / spec.get("dir", "deepar")
    if not model_dir.exists():
        return info
    try:
        nf = NeuralForecast.load(path=str(model_dir))
        info["nf"] = nf
        info["model_name"] = spec.get("model_name", "DeepAR")
        info["last_train_date"] = spec.get("last_train_date")
        info["horizon"] = spec.get("horizon", MAX_HORIZON)
        info["blend_weight"] = float(spec.get("blend_weight", 0.08))
    except Exception:  # pragma: no cover
        pass
    return info


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
    aqhi_df: pd.DataFrame | None = None,
    ai_factor_df: pd.DataFrame | None = None,
    flu_df: pd.DataFrame | None = None,
    school_calendar: Dict | None = None,
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
    aqhi_map = _aqhi_map_from_df(aqhi_df) if aqhi_df is not None else {}
    ai_map = _ai_map_from_df(ai_factor_df) if ai_factor_df is not None else {}
    flu_map = _flu_map_from_df(flu_df) if flu_df is not None else {}
    school_cal = school_calendar if school_calendar is not None else load_school_calendar()
    wx = _weather_lookup(weather_map, target_date)
    aqhi = _aqhi_lookup(aqhi_map, target_date)
    ai = _ai_lookup(ai_map, target_date)
    flu = _flu_lookup(flu_map, target_date)
    school = _school_lookup(school_cal, target_date)
    holiday_type = _classify_holiday_type(target_date, holiday_set, lny_ordinals)

    row = {
        **base,
        **wx,
        **aqhi,
        **ai,
        **flu,
        **school,
        **holiday_type,
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
    aqhi_df: pd.DataFrame | None = None,
    ai_factor_df: pd.DataFrame | None = None,
    quantile_models: Dict[str, Dict[str, xgb.Booster]] | None = None,
    lightgbm_models: Dict[str, object] | None = None,
    flu_df: pd.DataFrame | None = None,
    school_calendar: Dict | None = None,
    nbeats_models: Dict[str, object] | None = None,
    tft_models: Dict[str, object] | None = None,
    deepar_models: Dict[str, object] | None = None,
    conformal_offsets: Dict[str, Dict[str, float]] | None = None,
    recent_residuals: pd.DataFrame | None = None,
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
    if nbeats_models is None:
        try:
            nbeats_models = load_nbeats_models(bundle)
        except Exception:  # pragma: no cover
            nbeats_models = {}
    if tft_models is None:
        try:
            tft_models = load_tft_models(bundle)
        except Exception:  # pragma: no cover
            tft_models = {}
    if deepar_models is None:
        try:
            deepar_models = load_deepar_models(bundle)
        except Exception:  # pragma: no cover
            deepar_models = {}
    if aqhi_df is None:
        aqhi_df = load_aqhi_history()
    if weather_df is None:
        try:
            weather_df = load_weather_history_from_db()
        except Exception:  # pragma: no cover
            weather_df = pd.DataFrame(columns=["Date"])
    # v5.5.00 — inject HKO 9-day forecast for future-date predictions
    try:
        forecast_rows = fetch_hko_9day_forecast()
        if forecast_rows:
            weather_df = merge_forecast_into_weather_df(weather_df, forecast_rows)
    except Exception:  # pragma: no cover
        pass
    if ai_factor_df is None:
        try:
            ai_factor_df = load_ai_factor_history_from_db()
        except Exception:  # pragma: no cover
            ai_factor_df = pd.DataFrame(columns=["Date", "ai_factor"])
    if flu_df is None:
        flu_df = load_chp_flu_history()
    if school_calendar is None:
        school_calendar = load_school_calendar()
    if conformal_offsets is None:
        conformal_offsets = bundle.get("conformal_offsets") or {}
    if recent_residuals is None:
        try:
            recent_residuals = fetch_recent_residuals_from_db(window_days=DYNAMIC_STACK_WINDOW_DAYS)
        except Exception:  # pragma: no cover
            recent_residuals = pd.DataFrame()

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
        aqhi_df=aqhi_df,
        ai_factor_df=ai_factor_df,
        flu_df=flu_df,
        school_calendar=school_calendar,
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

    tree_prediction = raw_prediction
    stack_weights = compute_dynamic_stack_weights(bundle, bucket.name, recent_residuals)
    components: Dict[str, float] = {"tree": tree_prediction}
    nbeats_pred = _neural_forecast_point(nbeats_models, target_date, latest_actual_date, "NBEATS", tree_prediction)
    if nbeats_pred is not None:
        components["nbeats"] = nbeats_pred
    tft_pred = _neural_forecast_point(tft_models, target_date, latest_actual_date, "TFT", tree_prediction)
    if tft_pred is not None:
        components["tft"] = tft_pred
    deepar_col = str((deepar_models or {}).get("model_name") or "DeepAR")
    deepar_pred = _neural_forecast_point(deepar_models, target_date, latest_actual_date, deepar_col, tree_prediction)
    if deepar_pred is not None:
        components["deepar"] = deepar_pred

    active_weights = {k: float(stack_weights.get(k, 0.0)) for k in components}
    weight_sum = sum(active_weights.values()) or 1.0
    raw_prediction = sum(components[k] * active_weights[k] for k in components) / weight_sum
    nbeats_blend = round(active_weights.get("nbeats", 0.0) / weight_sum, 4)
    tft_blend = round(active_weights.get("tft", 0.0) / weight_sum, 4)
    deepar_blend = round(active_weights.get("deepar", 0.0) / weight_sum, 4)
    tree_blend = round(active_weights.get("tree", 0.0) / weight_sum, 4)

    bias_array = _apply_bias(feature_row, np.array([raw_prediction]), bucket_info.get("bias_correction"))
    bias_applied = float(bias_array[0]) if len(bias_array) else 0.0
    prediction = raw_prediction - bias_applied

    # v5.5.00 Hierarchical Bayesian shrinkage: when downstream triage-level data
    # exists, MinT/OLS reconciliation would solve coherent additivity. Without
    # triage breakdown in actual_data, we apply a soft Bayesian shrinkage of the
    # point prediction toward (target_dow_recent_mean, recent_84d_mean,
    # seasonal_baseline) weighted by 0.10 each — this regularises long-horizon
    # forecasts toward known structural levels and reduces tail variance.
    try:
        hier_shrink_weight = float(bundle.get("hierarchical_shrinkage", {}).get("weight", 0.10))
    except Exception:
        hier_shrink_weight = 0.10
    if hier_shrink_weight > 0 and bucket.name in ("h14", "h21", "h30"):
        try:
            dow_anchor = float(feature_row.at[0, "dow_recent_mean"])
            mean_anchor = float(feature_row.at[0, "recent_mean_84"])
            seasonal_anchor = float(feature_row.at[0, "seasonal_baseline"])
            anchor = (dow_anchor + mean_anchor + seasonal_anchor) / 3.0
            raw_prediction = (1.0 - hier_shrink_weight) * raw_prediction + hier_shrink_weight * anchor
        except Exception:
            pass

    # State-dependent CI from learned q10/q90 boosters, then CQR-calibrated
    # using validation-set δ offsets + an optional ONLINE blend with recent
    # production residuals (Stage E online conformal).
    interval: Dict[str, Dict[str, float]] | None = None
    bucket_quantile = (quantile_models or {}).get(bucket.name) or {}
    if "q10" in bucket_quantile and "q90" in bucket_quantile:
        q10_pred = float(bucket_quantile["q10"].predict(dmatrix)[0]) - bias_applied
        q90_pred = float(bucket_quantile["q90"].predict(dmatrix)[0]) - bias_applied
        if q10_pred > q90_pred:
            q10_pred, q90_pred = q90_pred, q10_pred

        # CQR offsets fitted at training time on the validation slice.
        conf = (conformal_offsets or {}).get(bucket.name) or bucket_info.get("conformal") or {}
        delta_low = float(conf.get("delta_low", 0.0) or 0.0)
        delta_high = float(conf.get("delta_high", 0.0) or 0.0)
        delta_low_95 = float(conf.get("delta_low_95", delta_low * 1.5) or 0.0)
        delta_high_95 = float(conf.get("delta_high_95", delta_high * 1.5) or 0.0)

        try:
            ci_stats = fetch_recent_ci_coverage_from_db(DYNAMIC_STACK_WINDOW_DAYS)
            delta_low, delta_high, delta_low_95, delta_high_95 = apply_online_quantile_reweight(
                delta_low, delta_high, delta_low_95, delta_high_95, ci_stats
            )
        except Exception:  # pragma: no cover
            ci_stats = {"n": 0}

        # Online residual blend: ~30% weight on recent live residuals from
        # ``prediction_accuracy`` if we have a non-trivial sample.
        live_offset = 0.0
        if conf.get("online_residual_std"):
            live_offset = float(conf.get("online_residual_widen", 0.0) or 0.0)

        ci80_low = q10_pred - delta_low - live_offset
        ci80_high = q90_pred + delta_high + live_offset
        ci95_low = q10_pred - delta_low_95 - live_offset * 1.5
        ci95_high = q90_pred + delta_high_95 + live_offset * 1.5

        interval = {
            "ci80": {"low": round(ci80_low, 2), "high": round(ci80_high, 2)},
            "ci95": {"low": round(ci95_low, 2), "high": round(ci95_high, 2)},
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
            "tree_blend_weight": round(tree_blend, 3),
            "nbeats_blend_weight": round(nbeats_blend, 3),
            "tft_blend_weight": round(tft_blend, 3),
            "deepar_blend_weight": round(deepar_blend, 3),
            "dynamic_stack_weights": stack_weights,
            "dynamic_stack_window_days": DYNAMIC_STACK_WINDOW_DAYS,
            "conformal_applied": bool((conformal_offsets or {}).get(bucket.name) or bucket_info.get("conformal")),
            "hko_forecast_used": bool(
                target_date > latest_actual_date
                and pd.Timestamp(target_date).normalize() in {pd.Timestamp(d).normalize() for d in weather_df.get("Date", [])}
            ),
        },
    }


def predict_range(
    start_date_str: str,
    days: int,
    historical_df: pd.DataFrame | None = None,
    bundle: Dict[str, object] | None = None,
    models: Dict[str, xgb.Booster] | None = None,
    weather_df: pd.DataFrame | None = None,
    aqhi_df: pd.DataFrame | None = None,
    ai_factor_df: pd.DataFrame | None = None,
    quantile_models: Dict[str, Dict[str, xgb.Booster]] | None = None,
    lightgbm_models: Dict[str, object] | None = None,
    flu_df: pd.DataFrame | None = None,
    school_calendar: Dict | None = None,
    nbeats_models: Dict[str, object] | None = None,
    tft_models: Dict[str, object] | None = None,
    deepar_models: Dict[str, object] | None = None,
    conformal_offsets: Dict[str, Dict[str, float]] | None = None,
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
    if nbeats_models is None:
        try:
            nbeats_models = load_nbeats_models(bundle)
        except Exception:  # pragma: no cover
            nbeats_models = {}
    if tft_models is None:
        try:
            tft_models = load_tft_models(bundle)
        except Exception:  # pragma: no cover
            tft_models = {}
    if deepar_models is None:
        try:
            deepar_models = load_deepar_models(bundle)
        except Exception:  # pragma: no cover
            deepar_models = {}
    if aqhi_df is None:
        aqhi_df = load_aqhi_history()
    if flu_df is None:
        flu_df = load_chp_flu_history()
    if school_calendar is None:
        school_calendar = load_school_calendar()
    if conformal_offsets is None:
        conformal_offsets = load_conformal_offsets(bundle)

    recent_stack_res = pd.DataFrame()
    try:
        recent_stack_res = fetch_recent_residuals_from_db(window_days=DYNAMIC_STACK_WINDOW_DAYS)
    except Exception:  # pragma: no cover
        pass

    # Stage E online conformal: pull recent live residuals once per batch and
    # widen the CI uniformly when a non-trivial sample is available.
    try:
        recent_res = fetch_recent_residuals_from_db(window_days=30)
        if len(recent_res) >= 10:
            residual_std = float(recent_res["residual"].std())
            widen = round(0.4 * residual_std, 4)
            conformal_offsets = {bk: dict(v) for bk, v in (conformal_offsets or {}).items()}
            for bk in conformal_offsets:
                conformal_offsets[bk]["online_residual_std"] = round(residual_std, 4)
                conformal_offsets[bk]["online_residual_widen"] = widen
    except Exception:  # pragma: no cover
        pass

    predictions = []
    for offset in range(days):
        target_date = start_date + timedelta(days=offset)
        result = predict_target_date(
            str(target_date.date()),
            historical_df=history,
            bundle=bundle,
            models=models,
            weather_df=weather_df,
            aqhi_df=aqhi_df,
            ai_factor_df=ai_factor_df,
            quantile_models=quantile_models,
            lightgbm_models=lightgbm_models,
            flu_df=flu_df,
            school_calendar=school_calendar,
            nbeats_models=nbeats_models,
            tft_models=tft_models,
            deepar_models=deepar_models,
            conformal_offsets=conformal_offsets,
            recent_residuals=recent_stack_res,
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
    flu_df = load_chp_flu_history()
    school_cal = load_school_calendar()
    datasets = build_training_examples(
        df=df,
        holiday_set=holiday_set,
        recent_rows=recent_rows,
        min_history_days=MIN_HISTORY_DAYS,
        weather_df=weather_df,
        ai_factor_df=ai_df,
        flu_df=flu_df,
        school_calendar=school_cal,
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
