"""
Evaluate the saved direct multi-horizon bundle against DB-only walk-forward slices.
"""

from __future__ import annotations

import json

from horizon_model_pipeline import DEFAULT_RECENT_ROWS, evaluate_saved_bundle


def main() -> int:
    result = evaluate_saved_bundle(recent_rows=DEFAULT_RECENT_ROWS)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
