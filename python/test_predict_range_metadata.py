"""Regression test for rolling predictions metadata passthrough."""

from __future__ import annotations

from unittest.mock import patch

import pandas as pd

import horizon_model_pipeline as hmp


def main() -> int:
    historical_df = pd.DataFrame(
        {
            "Date": pd.to_datetime(["2026-05-15", "2026-05-16", "2026-05-17"]),
            "Attendance": [210, 220, 230],
        }
    )

    fake_metadata = {
        "deepar_blend_weight": 0.08,
        "dynamic_stack_weights": {"tree": 0.67, "nbeats": 0.15, "tft": 0.1, "deepar": 0.08},
        "conformal_applied": True,
        "hko_forecast_used": True,
        "operational_horizon": 1,
        "bucket": "short",
        "bucket_label": "H0/H1",
        "baseline_reference": {"last": 205.0, "weekday_mean": 220.0, "seasonal": 230.0},
    }

    fake_result = {
        "prediction": 234.35,
        "ci80": {"low": 200.0, "high": 260.0, "lower": 200.0, "upper": 260.0},
        "ci95": {"low": 180.0, "high": 280.0, "lower": 180.0, "upper": 280.0},
        "metadata": fake_metadata,
    }

    with patch.object(hmp, "predict_target_date", return_value=fake_result), patch.object(
        hmp, "fetch_recent_residuals_from_db", return_value=pd.DataFrame()
    ):
        result = hmp.predict_range(
            "2026-05-18",
            2,
            historical_df=historical_df,
            bundle={"version": "5.6.00", "buckets": {}, "conformal_offsets": {}},
            models={},
            weather_df=pd.DataFrame(columns=["Date"]),
            aqhi_df=pd.DataFrame(columns=["Date"]),
            ai_factor_df=pd.DataFrame(columns=["Date", "ai_factor"]),
            quantile_models={},
            lightgbm_models={},
            flu_df=pd.DataFrame(columns=["Date"]),
            school_calendar={},
            nbeats_models={},
            tft_models={},
            deepar_models={},
            conformal_offsets={},
        )

    first_row = result["predictions"][0]
    assert "metadata" in first_row, "rolling prediction rows must carry metadata"
    for key, value in fake_metadata.items():
        assert first_row["metadata"][key] == value, f"missing metadata field: {key}"

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
