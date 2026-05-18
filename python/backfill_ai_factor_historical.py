"""Offline batch tool to backfill historical AI factors via GPT-5.5.

This is a v5.5.00 scaffold — it lets an operator generate AI factors for
historical dates by replaying news archives through the existing AI service.
Running it across all 4000+ historical days would cost real money and time
(estimated at ~USD $80–$150 per full backfill at current GPT-5.5 pricing,
roughly 6-8 hours wall-clock at 4 req/s), so the script defaults to a
small sample window and writes results into ``learning_records.ai_factor``
incrementally so a partial run is always useful.

Usage:
    DATABASE_URL=postgresql://... python3 python/backfill_ai_factor_historical.py \\
        --start 2020-01-01 --end 2020-12-31 --rate-limit 3 --dry-run

Flags:
    --start YYYY-MM-DD       Inclusive start date (default: oldest gap)
    --end   YYYY-MM-DD       Inclusive end date   (default: today minus 30 days)
    --rate-limit N           Max requests/second to the AI service (default 3)
    --dry-run                Print plan, don't write to DB
    --max-rows N             Cap on rows actually processed in this run
    --source archive|none    Which historical news source to feed GPT
                             (default ``archive`` — wires into ai-service web
                              search; ``none`` = ask GPT to reason from date
                              alone, lower-quality but free of search API)

Resumability:
    Skips any date that already has a non-NULL ``ai_factor`` in
    ``learning_records`` so re-running the command continues from the gap.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, date, timedelta
from pathlib import Path

import psycopg2
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]


def _open_conn():
    load_dotenv(ROOT / ".env")
    return psycopg2.connect(os.environ["DATABASE_URL"])


def _missing_dates(conn, start_iso: str, end_iso: str, limit: int) -> list:
    cur = conn.cursor()
    cur.execute(
        """
        SELECT a.date::text
        FROM actual_data a
        LEFT JOIN learning_records lr ON lr.date = a.date
        WHERE a.date BETWEEN %s AND %s
          AND (lr.ai_factor IS NULL OR lr.ai_factor = 1.0)
        ORDER BY a.date ASC
        LIMIT %s
        """,
        (start_iso, end_iso, limit),
    )
    rows = [r[0] for r in cur.fetchall()]
    cur.close()
    return rows


def _call_ai_service(target_date: str, source: str, ai_base_url: str | None, ai_key: str | None) -> dict | None:
    """Best-effort call into the running ai-service endpoint.

    Hits ``POST /api/ai-analyze`` on the production server which already
    knows how to talk to GPT-5.5 with web search. Returns the parsed
    response or None on failure (network / 5xx / no service).
    """
    if not ai_base_url:
        ai_base_url = os.environ.get("PREDICTION_SERVICE_URL", "http://127.0.0.1:3001")
    url = f"{ai_base_url.rstrip('/')}/api/ai-analyze"
    body = json.dumps({"targetDate": target_date, "useHistoricalSearch": source == "archive"}).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if ai_key:
        headers["Authorization"] = f"Bearer {ai_key}"
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        return payload
    except Exception as exc:
        print(f"  ❌ {target_date}: AI service call failed: {exc}", file=sys.stderr)
        return None


def _extract_factor(payload: dict) -> float | None:
    if not isinstance(payload, dict):
        return None
    for path in (
        ("factor", "value"),
        ("aiFactor",),
        ("impactFactor",),
        ("data", "aiFactor"),
        ("result", "aiFactor"),
    ):
        cur = payload
        ok = True
        for k in path:
            if isinstance(cur, dict) and k in cur:
                cur = cur[k]
            else:
                ok = False
                break
        if ok and isinstance(cur, (int, float)):
            return float(cur)
    return None


def _upsert_learning_record(conn, target_date: str, ai_factor: float, event_type: str | None):
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO learning_records (date, ai_factor, ai_event_type, created_at)
        VALUES (%s, %s, %s, NOW())
        ON CONFLICT (date) DO UPDATE
        SET ai_factor = EXCLUDED.ai_factor,
            ai_event_type = COALESCE(EXCLUDED.ai_event_type, learning_records.ai_event_type)
        """,
        (target_date, ai_factor, event_type),
    )
    conn.commit()
    cur.close()


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Backfill AI factors via GPT-5.5")
    parser.add_argument("--start", default=None)
    parser.add_argument("--end", default=None)
    parser.add_argument("--max-rows", type=int, default=50)
    parser.add_argument("--rate-limit", type=float, default=3.0)
    parser.add_argument("--source", choices=["archive", "none"], default="archive")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--ai-base-url", default=None)
    args = parser.parse_args(argv)

    today = date.today()
    end_iso = args.end or (today - timedelta(days=30)).isoformat()
    start_iso = args.start or "2020-01-01"
    if start_iso > end_iso:
        print("start must be <= end", file=sys.stderr)
        return 2

    conn = _open_conn()
    rows = _missing_dates(conn, start_iso, end_iso, args.max_rows)
    print(f"📅 {len(rows)} missing dates in [{start_iso}, {end_iso}] (limit {args.max_rows})")
    if args.dry_run:
        print("DRY-RUN — would request:", rows[:10], "…" if len(rows) > 10 else "")
        conn.close()
        return 0

    ai_key = os.environ.get("AI_API_KEY")
    interval = 1.0 / max(0.1, args.rate_limit)
    processed = 0
    written = 0
    for d in rows:
        payload = _call_ai_service(d, args.source, args.ai_base_url, ai_key)
        time.sleep(interval)
        if not payload:
            continue
        factor = _extract_factor(payload)
        if factor is None:
            print(f"  ⚠️ {d}: no factor in response, skipping")
            continue
        event_type = None
        if isinstance(payload, dict):
            event_type = payload.get("eventType") or payload.get("type")
        _upsert_learning_record(conn, d, factor, event_type)
        written += 1
        processed += 1
        print(f"  ✓ {d} → factor {factor:.3f} ({event_type or 'unspecified'})")

    conn.close()
    print(f"✅ done — processed {processed}, written {written}/{len(rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
