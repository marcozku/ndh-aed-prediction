"""End-to-end retrain on Railway DB with the v5.3.00 feature set.

Loads attendance + weather + AI factor from Railway PostgreSQL, runs walk-forward
training with bias correction and quantile CI, and writes the new bundle into
``python/models/``. Prints honest before/after metrics.

Run:
    cd /workspace
    DATABASE_URL=... python3 python/run_railway_train.py
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))

import horizon_model_pipeline as hmp  # noqa: E402


def main() -> int:
    t0 = time.time()
    print(f"[{time.strftime('%H:%M:%S')}] starting v{hmp.PIPELINE_VERSION} walk-forward retrain on Railway DB")

    df = hmp.load_actual_data_from_db()
    print(f"  attendance: {len(df)} rows {df['Date'].min().date()} → {df['Date'].max().date()}")

    weather_df = hmp.load_weather_history_from_db()
    print(f"  weather:    {len(weather_df)} rows")

    ai_df = hmp.load_ai_factor_history_from_db()
    print(f"  ai_factor:  {len(ai_df)} rows")

    flu_df = hmp.load_chp_flu_history()
    print(f"  chp_flu:    {len(flu_df)} daily rows (expanded from weekly CSV)")

    school_cal = hmp.load_school_calendar()
    print(f"  school_cal: {len(school_cal.get('academic_years', []))} years, {len(school_cal.get('school_holidays', []))} holiday segments")

    import os
    optuna_trials = int(os.getenv("OPTUNA_TRIALS", "40"))
    optuna_timeout = float(os.getenv("OPTUNA_TIMEOUT", "120"))
    train_lgb = os.getenv("TRAIN_LIGHTGBM", "1") not in ("0", "false", "False")
    train_nb = os.getenv("TRAIN_NBEATS", "1") not in ("0", "false", "False")
    nbeats_epochs = int(os.getenv("NBEATS_EPOCHS", "30"))
    print(f"  optuna_trials={optuna_trials} optuna_timeout={optuna_timeout}s")
    print(f"  train_lightgbm={train_lgb} train_nbeats={train_nb} nbeats_epochs={nbeats_epochs}")

    result = hmp.train_horizon_models(
        recent_rows=hmp.DEFAULT_RECENT_ROWS,
        validation_cutoffs=hmp.DEFAULT_VALIDATION_CUTOFFS,
        gate_margin=0.005,
        allow_gate_fail=True,
        weather_df=weather_df,
        ai_factor_df=ai_df,
        flu_df=flu_df,
        school_calendar=school_cal,
        train_quantile=True,
        optuna_trials=optuna_trials,
        optuna_timeout=optuna_timeout,
        train_lightgbm=train_lgb,
        train_nbeats=train_nb,
        nbeats_max_epochs=nbeats_epochs,
    )
    elapsed = time.time() - t0
    print(f"[{time.strftime('%H:%M:%S')}] training finished in {elapsed:.1f}s")

    bundle = result["bundle"]
    summary = bundle["summary"]
    print("\n=== Overall walk-forward summary (honest test slice, bias-corrected) ===")
    print(json.dumps(summary, indent=2, ensure_ascii=False))

    print("\n=== Per-bucket: raw → bias-corrected (honest test slice) ===")
    for bucket_name, info in bundle["buckets"].items():
        honest = info.get("honest_split_metrics") or {}
        raw = honest.get("raw") or info.get("raw_metrics", {})
        corrected = honest.get("corrected") or info.get("metrics", {})
        bt = info.get("bias_correction") or {}
        print(
            f"  {bucket_name:<7} raw MAE={raw.get('mae'):>6} bias={raw.get('bias'):>+7}  "
            f"→ corrected MAE={corrected.get('mae'):>6} bias={corrected.get('bias'):>+7}  "
            f"(test_rows={honest.get('test_rows')}, baseline={info.get('best_baseline', {}).get('mae'):>6})"
        )
        per_dow = bt.get("per_dow") or {}
        dow_summary = ", ".join(
            f"dow{k}={v['shrunk_bias']:+.2f}"
            for k, v in sorted(per_dow.items(), key=lambda x: int(x[0]))
        )
        print(f"           bias_table[global={bt.get('global', 0.0):+.2f}]: {dow_summary}")

    print("\n=== Top features post v5.3.00 (per bucket) ===")
    for bucket_name, info in bundle["buckets"].items():
        feats = info.get("top_features", [])[:10]
        print(f"  {bucket_name}: " + ", ".join(f"{f['feature']}={f['importance']:.3f}" for f in feats))

    print("\n=== Optuna / LightGBM / Conformal audit ===")
    for bucket_name, info in bundle["buckets"].items():
        opt = info.get("optuna") or {}
        lgb = info.get("lightgbm")
        ens = info.get("ensemble_active")
        conf = info.get("conformal") or {}
        print(
            f"  {bucket_name}: optuna_best_mae={opt.get('best_value_mae')} trials={opt.get('n_trials')}  "
            f"ensemble_active={ens} lgb={'yes' if lgb else 'no'}  "
            f"conf_δlow={conf.get('delta_low')} δhigh={conf.get('delta_high')} coverage80={conf.get('val_coverage_ci80')}"
        )

    nb = bundle.get("nbeats") or {}
    print(f"\n=== N-BEATS global anchor ===")
    if nb.get("available"):
        print(f"  trained_at={nb.get('trained_at')} last_train_date={nb.get('last_train_date')} blend_weight={nb.get('blend_weight')}")
    else:
        print(f"  unavailable: {nb.get('error') or nb.get('reason') or nb.get('save_error')}")

    if result.get("gating_failures"):
        print("\nWARN gating failures:")
        for failure in result["gating_failures"]:
            print(f"  {failure}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
