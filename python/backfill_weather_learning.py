#!/usr/bin/env python3
"""
Backfill weather_history 與 learning_records 的天氣欄位，
並修復因錯誤 HKO API 用法導致的 NULL/0 weather learning。
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta
from typing import Iterable, List

from continuous_learner import get_db_connection, upsert_weather_history
from weather_data_loader import get_weather_data_for_date, has_core_weather_fields


def collect_target_dates(conn, start_date=None, end_date=None, only_missing_core: bool = False) -> List:
    clauses = []
    params = []

    if start_date:
        clauses.append('date >= %s')
        params.append(start_date)
    if end_date:
        clauses.append('date <= %s')
        params.append(end_date)

    where_sql = ''
    if clauses:
        where_sql = 'WHERE ' + ' AND '.join(clauses)

    if only_missing_core:
        query = f"""
            SELECT DISTINCT date
            FROM (
                SELECT lr.date
                FROM learning_records lr
                LEFT JOIN weather_history wh
                    ON wh.date = lr.date
                WHERE
                    lr.temp_min IS NULL OR
                    lr.temp_max IS NULL OR
                    lr.rainfall_mm IS NULL OR
                    lr.humidity_pct IS NULL OR
                    lr.pressure_hpa IS NULL OR
                    wh.date IS NULL OR
                    wh.temp_min IS NULL OR
                    wh.temp_max IS NULL OR
                    wh.temp_mean IS NULL OR
                    wh.rainfall_mm IS NULL OR
                    wh.humidity_pct IS NULL OR
                    wh.pressure_hpa IS NULL

                UNION

                SELECT wh.date
                FROM weather_history wh
                LEFT JOIN learning_records lr
                    ON lr.date = wh.date
                WHERE
                    wh.temp_min IS NULL OR
                    wh.temp_max IS NULL OR
                    wh.temp_mean IS NULL OR
                    wh.rainfall_mm IS NULL OR
                    wh.humidity_pct IS NULL OR
                    wh.pressure_hpa IS NULL OR
                    (
                        lr.date IS NOT NULL AND (
                            lr.temp_min IS NULL OR
                            lr.temp_max IS NULL OR
                            lr.rainfall_mm IS NULL OR
                            lr.humidity_pct IS NULL OR
                            lr.pressure_hpa IS NULL
                        )
                    )
            ) AS candidate_dates
            {where_sql}
            ORDER BY date
        """
    else:
        query = f"""
            SELECT DISTINCT date
            FROM (
                SELECT date FROM learning_records
                UNION
                SELECT date FROM weather_history
            ) AS candidate_dates
            {where_sql}
            ORDER BY date
        """

    cur = conn.cursor()
    cur.execute(query, params)
    rows = [row[0] for row in cur.fetchall()]
    cur.close()
    return rows


def update_learning_record_weather(cur, target_date, weather):
    cur.execute("""
        UPDATE learning_records
        SET
            temp_min = %s,
            temp_max = %s,
            rainfall_mm = %s,
            wind_kmh = %s,
            humidity_pct = %s,
            pressure_hpa = %s,
            is_very_cold = %s,
            is_very_hot = %s,
            is_heavy_rain = %s,
            is_strong_wind = %s,
            typhoon_signal = %s
        WHERE date = %s
    """, (
        weather.get('temp_min'),
        weather.get('temp_max'),
        weather.get('rainfall_mm'),
        weather.get('wind_kmh'),
        weather.get('humidity_pct'),
        weather.get('pressure_hpa'),
        weather.get('is_very_cold'),
        weather.get('is_very_hot'),
        weather.get('is_heavy_rain'),
        weather.get('is_strong_wind'),
        weather.get('typhoon_signal'),
        target_date,
    ))


def backfill_dates(conn, dates: Iterable):
    cur = conn.cursor()

    weather_rows_updated = 0
    learning_rows_updated = 0
    missing_dates = []

    for target_date in dates:
        weather = get_weather_data_for_date(target_date)
        if not has_core_weather_fields(weather):
            missing_dates.append(str(target_date))
            continue

        upsert_weather_history(cur, target_date, weather)
        weather_rows_updated += 1

        update_learning_record_weather(cur, target_date, weather)
        learning_rows_updated += cur.rowcount

    conn.commit()
    cur.close()

    return {
        'weather_rows_updated': weather_rows_updated,
        'learning_rows_updated': learning_rows_updated,
        'missing_dates': missing_dates,
    }


def main():
    parser = argparse.ArgumentParser(description='Backfill weather columns for learning data')
    parser.add_argument('--start-date', dest='start_date')
    parser.add_argument('--end-date', dest='end_date')
    parser.add_argument('--lookback-days', dest='lookback_days', type=int)
    parser.add_argument('--only-missing-core', dest='only_missing_core', action='store_true')
    args = parser.parse_args()

    if args.lookback_days and not args.start_date:
        hkt_today = (datetime.utcnow() + timedelta(hours=8)).date()
        start_date = hkt_today - timedelta(days=max(args.lookback_days - 1, 0))
        args.start_date = start_date.isoformat()

    conn = get_db_connection()

    try:
        dates = collect_target_dates(
            conn,
            args.start_date,
            args.end_date,
            only_missing_core=args.only_missing_core
        )
        print(f'📅 需要檢查的日期數: {len(dates)}')

        result = backfill_dates(conn, dates)
        print(f"✅ weather_history 更新: {result['weather_rows_updated']} 天")
        print(f"✅ learning_records 更新: {result['learning_rows_updated']} 筆")

        if result['missing_dates']:
            print(f"⚠️ 仍缺 HKO 核心天氣欄位的日期: {', '.join(result['missing_dates'])}")
        else:
            print('✅ 所有目標日期均已補齊核心天氣欄位')
    finally:
        conn.close()


if __name__ == '__main__':
    main()
