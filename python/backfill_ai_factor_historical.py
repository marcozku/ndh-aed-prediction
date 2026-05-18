"""Offline batch tool to backfill historical AI factors via GPT-5.5.

v5.6.00 — supports full historical offline runs with checkpoint/resume.

Usage:
    DATABASE_URL=postgresql://... python3 python/backfill_ai_factor_historical.py \\
        --start 2014-12-01 --end 2025-12-31 --rate-limit 3

Full offline run (all gaps, no row cap):
    DATABASE_URL=... python3 python/backfill_ai_factor_historical.py --full

Flags:
    --start YYYY-MM-DD       Inclusive start date (default: 2014-12-01 with --full)
    --end   YYYY-MM-DD       Inclusive end date   (default: today minus 30 days)
    --rate-limit N           Max requests/second to the AI service (default 3)
    --dry-run                Print plan, don't write to DB
    --max-rows N             Cap on rows processed this run (default 50; ignored with --full)
    --full                   Process every missing date in range (sets max-rows very high)
    --source archive|none    Historical news source for GPT
    --checkpoint PATH        JSONL progress log (default: python/models/ai_backfill_checkpoint.jsonl)
    --ai-base-url URL        Override prediction service base URL

Resumability:
    Skips any date that already has a non-NULL ``ai_factor`` in ``learning_records``.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import psycopg2
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[1]
HKT = ZoneInfo("Asia/Hong_Kong")
DEFAULT_CHECKPOINT = ROOT / "python" / "models" / "ai_backfill_checkpoint.jsonl"


def _hkt_now() -> str:
    return datetime.now(HKT).strftime("%Y-%m-%d %H:%M:%S HKT")


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


def _count_missing(conn, start_iso: str, end_iso: str) -> int:
    cur = conn.cursor()
    cur.execute(
        """
        SELECT COUNT(*)
        FROM actual_data a
        LEFT JOIN learning_records lr ON lr.date = a.date
        WHERE a.date BETWEEN %s AND %s
          AND (lr.ai_factor IS NULL OR lr.ai_factor = 1.0)
        """,
        (start_iso, end_iso),
    )
    n = int(cur.fetchone()[0])
    cur.close()
    return n


def _append_checkpoint(path: Path, record: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def _call_ai_service(target_date: str, source: str, ai_base_url: str | None, ai_key: str | None) -> dict | None:
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
    parser = argparse.ArgumentParser(description="Backfill AI factors via GPT-5.5 (offline)")
    parser.add_argument("--start", default=None)
    parser.add_argument("--end", default=None)
    parser.add_argument("--max-rows", type=int, default=50)
    parser.add_argument("--full", action="store_true", help="Backfill all missing dates in range (no row cap)")
    parser.add_argument("--rate-limit", type=float, default=3.0)
    parser.add_argument("--source", choices=["archive", "none"], default="archive")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--ai-base-url", default=None)
    parser.add_argument("--checkpoint", default=str(DEFAULT_CHECKPOINT))
    args = parser.parse_args(argv)

    today = date.today()
    end_iso = args.end or (today - timedelta(days=30)).isoformat()
    start_iso = args.start or ("2014-12-01" if args.full else "2020-01-01")
    if start_iso > end_iso:
        print("start must be <= end", file=sys.stderr)
        return 2

    max_rows = 2_000_000 if args.full else args.max_rows
    checkpoint = Path(args.checkpoint)

    conn = _open_conn()
    missing_total = _count_missing(conn, start_iso, end_iso)
    rows = _missing_dates(conn, start_iso, end_iso, max_rows)
    print(f"[{_hkt_now()}] 📅 {len(rows)} dates queued ({missing_total} total gaps in [{start_iso}, {end_iso}])")
    if args.full:
        est_cost = missing_total * 0.02
        est_hours = missing_total / max(0.1, args.rate_limit) / 3600
        print(f"  FULL RUN — est. cost ~USD ${est_cost:.0f}, wall-clock ~{est_hours:.1f}h @ {args.rate_limit} req/s")

    if args.dry_run:
        print("DRY-RUN — would request:", rows[:10], "…" if len(rows) > 10 else "")
        conn.close()
        return 0

    ai_key = os.environ.get("AI_API_KEY")
    interval = 1.0 / max(0.1, args.rate_limit)
    written = 0
    for i, d in enumerate(rows, 1):
        payload = _call_ai_service(d, args.source, args.ai_base_url, ai_key)
        time.sleep(interval)
        if not payload:
            _append_checkpoint(checkpoint, {"ts": _hkt_now(), "date": d, "status": "error"})
            continue
        factor = _extract_factor(payload)
        if factor is None:
            print(f"  ⚠️ {d}: no factor in response, skipping")
            _append_checkpoint(checkpoint, {"ts": _hkt_now(), "date": d, "status": "no_factor"})
            continue
        event_type = None
        if isinstance(payload, dict):
            event_type = payload.get("eventType") or payload.get("type")
        _upsert_learning_record(conn, d, factor, event_type)
        written += 1
        _append_checkpoint(
            checkpoint,
            {"ts": _hkt_now(), "date": d, "status": "ok", "ai_factor": factor, "event_type": event_type},
        )
        if i % 25 == 0 or i == len(rows):
            print(f"  [{_hkt_now()}] progress {i}/{len(rows)} written={written}")
        else:
            print(f"  ✓ {d} → factor {factor:.3f} ({event_type or 'unspecified'})")

    conn.close()
    print(f"[{_hkt_now()}] ✅ done — written {written}/{len(rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
