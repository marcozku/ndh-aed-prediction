"""
Batch prediction entrypoint for the direct multi-horizon pipeline.

This script keeps the historical filename for Node compatibility, but it no longer
performs recursive rollout, random noise injection, or heuristic blending.
"""

from __future__ import annotations

import json
import sys

from horizon_model_pipeline import predict_range


def main() -> int:
    if len(sys.argv) < 3:
        print("用法: python rolling_predict.py <start_date> <days>", file=sys.stderr)
        print("示例: python rolling_predict.py 2026-04-14 31", file=sys.stderr)
        return 1

    start_date = sys.argv[1]
    days = int(sys.argv[2])
    result = predict_range(start_date, days)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
