"""
Single-date prediction entrypoint for the direct multi-horizon pipeline.
"""

from __future__ import annotations

import json
import sys

from horizon_model_pipeline import predict_target_date


def main() -> int:
    if len(sys.argv) < 2:
        print("用法: python predict.py <target_date>", file=sys.stderr)
        print("示例: python predict.py 2026-04-15", file=sys.stderr)
        return 1

    target_date = sys.argv[1]
    result = predict_target_date(target_date)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
