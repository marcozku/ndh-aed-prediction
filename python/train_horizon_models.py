"""
Train direct multi-horizon XGBoost models with DB-only walk-forward evaluation.
"""

from __future__ import annotations

import argparse
import json
import sys

from horizon_model_pipeline import (
    DEFAULT_GATE_MARGIN,
    DEFAULT_RECENT_ROWS,
    DEFAULT_VALIDATION_CUTOFFS,
    TrainingGateError,
    train_horizon_models,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Train direct multi-horizon NDH AED models")
    parser.add_argument("--recent-rows", type=int, default=DEFAULT_RECENT_ROWS)
    parser.add_argument("--validation-cutoffs", type=int, default=DEFAULT_VALIDATION_CUTOFFS)
    parser.add_argument("--gate-margin", type=float, default=DEFAULT_GATE_MARGIN)
    parser.add_argument("--allow-gate-fail", action="store_true")
    args = parser.parse_args()

    print("=" * 80, flush=True)
    print("NDH AED Direct Multi-Horizon Training", flush=True)
    print("=" * 80, flush=True)
    print(f"recent_rows={args.recent_rows}", flush=True)
    print(f"validation_cutoffs={args.validation_cutoffs}", flush=True)
    print(f"gate_margin={args.gate_margin:.3f}", flush=True)

    try:
        result = train_horizon_models(
            recent_rows=args.recent_rows,
            validation_cutoffs=args.validation_cutoffs,
            gate_margin=args.gate_margin,
            allow_gate_fail=args.allow_gate_fail,
        )
    except TrainingGateError as exc:
        print(f"❌ Baseline gate failed: {exc}", file=sys.stderr, flush=True)
        return 1

    summary = result["bundle"]["summary"]
    print("\nTraining summary", flush=True)
    print(json.dumps(summary, indent=2, ensure_ascii=False), flush=True)

    if result["gating_failures"]:
        print("\n⚠️ Gate warnings:", flush=True)
        for item in result["gating_failures"]:
            print(f"- {item}", flush=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
