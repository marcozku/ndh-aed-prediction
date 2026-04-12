#!/usr/bin/env python3
"""
Weather data loader utilities.

優先使用本地 weather_full_history.csv，若目標日期超出本地快取，
則改用 HKO Daily Extract XML 端點按年/月補抓。
"""

from __future__ import annotations

import json
from datetime import date as date_type, datetime
from pathlib import Path
from typing import Dict, Optional

import pandas as pd
import requests

BASE_DIR = Path(__file__).resolve().parent
WEATHER_FULL_HISTORY_PATH = BASE_DIR / 'weather_full_history.csv'
WEATHER_WARNINGS_PATH = BASE_DIR / 'weather_warnings_history.csv'

HKO_DAILY_EXTRACT_METADATA_URL = 'https://www.hko.gov.hk/cis/hko.xml'
HKO_DAILY_EXTRACT_YEARLY_URL = 'https://www.hko.gov.hk/cis/dailyExtract/dailyExtract_{year}.xml'
HKO_DAILY_EXTRACT_MONTHLY_URL = 'https://www.hko.gov.hk/cis/dailyExtract/dailyExtract_{year}{month:02d}.xml'

REQUEST_TIMEOUT = 30

_local_weather_df: Optional[pd.DataFrame] = None
_warnings_df: Optional[pd.DataFrame] = None
_yearly_extract_cache: Dict[int, pd.DataFrame] = {}
_monthly_extract_cache: Dict[str, pd.DataFrame] = {}
_daily_extract_metadata: Optional[dict] = None


def _parse_numeric(value):
    if value is None:
        return None
    if pd.isna(value):
        return None

    text = str(value).strip()
    if text in {'', '-', '***', 'N.A.', '---'}:
        return None
    if text.lower() == 'trace':
        return 0.05

    try:
        return float(text.replace(',', ''))
    except (TypeError, ValueError):
        return None


def _normalize_date(target_date) -> date_type:
    if isinstance(target_date, pd.Timestamp):
        return target_date.date()
    if isinstance(target_date, datetime):
        return target_date.date()
    if isinstance(target_date, date_type):
        return target_date
    return pd.to_datetime(target_date).date()


def _read_csv_with_date_index(path: Path) -> Optional[pd.DataFrame]:
    if not path.exists():
        return None

    df = pd.read_csv(path)
    if 'Date' not in df.columns:
        return None

    df['Date'] = pd.to_datetime(df['Date'], errors='coerce').dt.date
    df = df.dropna(subset=['Date']).drop_duplicates(subset=['Date'], keep='last')
    df = df.set_index('Date')
    return df


def load_local_weather_history() -> Optional[pd.DataFrame]:
    global _local_weather_df

    if _local_weather_df is None:
        _local_weather_df = _read_csv_with_date_index(WEATHER_FULL_HISTORY_PATH)

    return _local_weather_df


def load_weather_warnings() -> Optional[pd.DataFrame]:
    global _warnings_df

    if _warnings_df is None:
        _warnings_df = _read_csv_with_date_index(WEATHER_WARNINGS_PATH)

    return _warnings_df


def _load_daily_extract_metadata() -> dict:
    global _daily_extract_metadata

    if _daily_extract_metadata is not None:
        return _daily_extract_metadata

    response = requests.get(HKO_DAILY_EXTRACT_METADATA_URL, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    data = json.loads(response.text)

    daily_extract = {}
    for item in data.get('hko', []):
        if item.get('code') == 'dailyExtract':
            daily_extract = item
            break

    _daily_extract_metadata = daily_extract
    return _daily_extract_metadata


def _parse_yearly_daily_extract_payload(payload: dict, year: int) -> pd.DataFrame:
    rows = []

    for month_block in payload.get('stn', {}).get('data', []):
        month = int(month_block.get('month', 0) or 0)
        if month <= 0:
            continue

        for day_row in month_block.get('dayData', []):
            day_text = str(day_row[0]).strip()
            if not day_text.isdigit():
                continue

            day = int(day_text)
            rows.append({
                'Date': date_type(year, month, day),
                'Pressure_hPa': _parse_numeric(day_row[1]) if len(day_row) > 1 else None,
                'Temp_Max': _parse_numeric(day_row[2]) if len(day_row) > 2 else None,
                'Temp_Mean': _parse_numeric(day_row[3]) if len(day_row) > 3 else None,
                'Temp_Min': _parse_numeric(day_row[4]) if len(day_row) > 4 else None,
                'DewPoint': _parse_numeric(day_row[5]) if len(day_row) > 5 else None,
                'Humidity_pct': _parse_numeric(day_row[6]) if len(day_row) > 6 else None,
                'Cloud_pct': _parse_numeric(day_row[7]) if len(day_row) > 7 else None,
                'Rainfall_mm': _parse_numeric(day_row[8]) if len(day_row) > 8 else None,
                'Sunshine_hrs': _parse_numeric(day_row[9]) if len(day_row) > 9 else None,
                'Wind_Direction_deg': _parse_numeric(day_row[10]) if len(day_row) > 10 else None,
                'Wind_kmh': _parse_numeric(day_row[11]) if len(day_row) > 11 else None,
            })

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows).drop_duplicates(subset=['Date'], keep='last').set_index('Date')
    return df.sort_index()


def fetch_yearly_daily_extract(year: int) -> pd.DataFrame:
    if year in _yearly_extract_cache:
        return _yearly_extract_cache[year]

    url = HKO_DAILY_EXTRACT_YEARLY_URL.format(year=year)
    response = requests.get(url, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    payload = json.loads(response.text)
    df = _parse_yearly_daily_extract_payload(payload, year)
    _yearly_extract_cache[year] = df
    return df


def _parse_monthly_daily_extract_payload(payload: dict, year: int, month: int) -> pd.DataFrame:
    rows = []

    for month_block in payload.get('stn', {}).get('data', []):
        block_month = int(month_block.get('month', month) or month)
        for day_row in month_block.get('dayData', []):
            day_text = str(day_row[0]).strip()
            if not day_text.isdigit():
                continue

            day = int(day_text)
            rows.append({
                'Date': date_type(year, block_month, day),
                'Pressure_hPa': _parse_numeric(day_row[1]) if len(day_row) > 1 else None,
                'Temp_Max': _parse_numeric(day_row[2]) if len(day_row) > 2 else None,
                'Temp_Mean': _parse_numeric(day_row[3]) if len(day_row) > 3 else None,
                'Temp_Min': _parse_numeric(day_row[4]) if len(day_row) > 4 else None,
                'DewPoint': _parse_numeric(day_row[5]) if len(day_row) > 5 else None,
                'Humidity_pct': _parse_numeric(day_row[6]) if len(day_row) > 6 else None,
                'Cloud_pct': _parse_numeric(day_row[7]) if len(day_row) > 7 else None,
                'Rainfall_mm': _parse_numeric(day_row[8]) if len(day_row) > 8 else None,
            })

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows).drop_duplicates(subset=['Date'], keep='last').set_index('Date')
    return df.sort_index()


def fetch_monthly_daily_extract(year: int, month: int) -> pd.DataFrame:
    cache_key = f'{year:04d}-{month:02d}'
    if cache_key in _monthly_extract_cache:
        return _monthly_extract_cache[cache_key]

    url = HKO_DAILY_EXTRACT_MONTHLY_URL.format(year=year, month=month)
    response = requests.get(url, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    payload = json.loads(response.text)
    df = _parse_monthly_daily_extract_payload(payload, year, month)
    _monthly_extract_cache[cache_key] = df
    return df


def _lookup_row(df: Optional[pd.DataFrame], target_date: date_type) -> Optional[dict]:
    if df is None or df.empty or target_date not in df.index:
        return None

    row = df.loc[target_date]
    if isinstance(row, pd.DataFrame):
        row = row.iloc[-1]
    return row.to_dict()


def _lookup_weather_source_row(target_date: date_type) -> Optional[dict]:
    local_df = load_local_weather_history()
    local_row = _lookup_row(local_df, target_date)
    if local_row:
        return local_row

    metadata = _load_daily_extract_metadata()
    end_year = int(metadata.get('endYear') or 0)
    end_month = int(metadata.get('endMonth') or 0)

    try:
        yearly_df = fetch_yearly_daily_extract(target_date.year)
        yearly_row = _lookup_row(yearly_df, target_date)
        if yearly_row:
            return yearly_row
    except Exception:
        pass

    if target_date.year > end_year or (target_date.year == end_year and target_date.month > end_month):
        try:
            monthly_df = fetch_monthly_daily_extract(target_date.year, target_date.month)
            monthly_row = _lookup_row(monthly_df, target_date)
            if monthly_row:
                return monthly_row
        except Exception:
            pass

    return None


def _lookup_warning_row(target_date: date_type) -> dict:
    warnings_df = load_weather_warnings()
    warning_row = _lookup_row(warnings_df, target_date)
    return warning_row or {}


def _warning_to_signal_string(value) -> Optional[str]:
    numeric = _parse_numeric(value)
    if numeric is None or numeric <= 0:
        return None
    return str(int(numeric))


def _warning_to_bool(value) -> bool:
    numeric = _parse_numeric(value)
    return bool(numeric and numeric > 0)


def get_weather_data_for_date(target_date) -> Optional[dict]:
    normalized_date = _normalize_date(target_date)
    source_row = _lookup_weather_source_row(normalized_date)
    if not source_row:
        return None

    warnings_row = _lookup_warning_row(normalized_date)

    temp_min = _parse_numeric(source_row.get('Temp_Min', source_row.get('min_temp')))
    temp_max = _parse_numeric(source_row.get('Temp_Max', source_row.get('max_temp')))
    temp_mean = _parse_numeric(source_row.get('Temp_Mean', source_row.get('mean_temp')))
    humidity_pct = _parse_numeric(source_row.get('Humidity_pct'))
    rainfall_mm = _parse_numeric(source_row.get('Rainfall_mm'))
    wind_kmh = _parse_numeric(source_row.get('Wind_kmh'))
    pressure_hpa = _parse_numeric(source_row.get('Pressure_hPa'))
    visibility_km = _parse_numeric(source_row.get('Visibility_km'))
    cloud_pct = _parse_numeric(source_row.get('Cloud_pct'))
    sunshine_hrs = _parse_numeric(source_row.get('Sunshine_hrs'))
    dew_point = _parse_numeric(source_row.get('DewPoint'))

    return {
        'temp_min': temp_min,
        'temp_max': temp_max,
        'temp_mean': temp_mean,
        'humidity_pct': humidity_pct,
        'rainfall_mm': rainfall_mm,
        'wind_kmh': wind_kmh,
        'pressure_hpa': pressure_hpa,
        'visibility_km': visibility_km,
        'cloud_pct': cloud_pct,
        'sunshine_hrs': sunshine_hrs,
        'dew_point': dew_point,
        'typhoon_signal': _warning_to_signal_string(warnings_row.get('typhoon_signal')),
        'rainstorm_warning': _warning_to_signal_string(warnings_row.get('rainstorm_warning')),
        'cold_warning': _warning_to_bool(warnings_row.get('cold_warning')),
        'hot_warning': _warning_to_bool(warnings_row.get('hot_warning')),
        'is_very_cold': bool(temp_min is not None and temp_min <= 12),
        'is_very_hot': bool(temp_max is not None and temp_max >= 33),
        'is_heavy_rain': bool(rainfall_mm is not None and rainfall_mm > 25),
        'is_strong_wind': bool(wind_kmh is not None and wind_kmh > 30),
        'is_low_humidity': bool(humidity_pct is not None and humidity_pct < 50),
        'is_high_pressure': bool(pressure_hpa is not None and pressure_hpa > 1020),
    }


def has_core_weather_fields(weather_data: Optional[dict]) -> bool:
    if not weather_data:
        return False

    required = [
        'temp_min',
        'temp_max',
        'temp_mean',
        'humidity_pct',
        'rainfall_mm',
        'pressure_hpa',
    ]
    return all(weather_data.get(field) is not None for field in required)
