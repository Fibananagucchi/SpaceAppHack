"""Basic mode 2 (breaks-1). Synthetic series exist only here, to verify the methods."""

import numpy as np
import pytest

from backend.app import breaks, stats


def months(start_year: int, n: int) -> list[str]:
    return [f"{start_year + (i // 12):04d}-{i % 12 + 1:02d}" for i in range(n)]


def analyse(values, boundaries=()):
    times = months(1990, len(values))
    out = stats.analyze(times, np.asarray(values, dtype=float), "°C")
    return times, out, breaks.analyze_breaks(times, out["anomalies"], "°C", out["trend"]["monthly_anomalies"],
                                             list(boundaries))


def step_series(n=300, at=150, size=2.0, seed=1):
    rng = np.random.default_rng(seed)
    x = rng.normal(scale=0.5, size=n)
    x[at:] += size
    return x


def test_pettitt_finds_the_step_and_its_size():
    times, out, b = analyse(step_series())
    cp = b["change_point"]
    assert b["status"] == "ok" and cp["status"] == "detected"
    assert abs(times.index(cp["date"]) - 150) <= 2
    assert cp["shift"]["estimate"] == pytest.approx(2.0, abs=0.3) and cp["shift"]["unit"] == "°C"
    assert cp["change_id"] == f"c_{cp['date']}"
    assert cp["levels"]["after"]["median_anomaly"] > cp["levels"]["before"]["median_anomaly"]
    assert set(b["features"]) == {"abruptness", "persistence", "spatial_extent", "other_variables"}
    assert all(f["status"] == "not_assessed" for f in b["features"].values())


def test_step_makes_trend_look_significant_and_is_flagged():
    _, out, b = analyse(step_series())
    assert out["trend"]["monthly_anomalies"]["mann_kendall"]["significant"] is True
    cp = b["change_point"]
    assert cp["status"] == "detected" and cp["model_comparison"]["preferred"] == "step"
    assert cp["model_comparison"]["delta_bic"] >= 6
    assert b["trend_affected_by_change"] is True
    assert len(b["segments"]) == 2 and all(s["status"] == "ok" for s in b["segments"])
    for seg in b["segments"]:
        assert seg["trend_line"]["band"] is None and len(seg["trend_line"]["points"]) == 2
        assert seg["trend_line"]["points"][0]["t"] == seg["period"]["start"]


def test_gradual_trend_is_not_called_a_step():
    rng = np.random.default_rng(2)
    n = 360
    x = 0.02 * np.arange(n) + rng.normal(scale=0.5, size=n)
    _, out, b = analyse(x)
    cp = b["change_point"]
    # Pettitt reacts to any monotonic change ...
    assert cp["pettitt_significant"] is True
    # ... but a straight line describes this series far better than a step
    assert cp["status"] == "not_distinct_from_trend" and cp["model_comparison"]["preferred"] == "line"
    assert b["trend_affected_by_change"] is False


def test_noise_has_no_model_comparison():
    rng = np.random.default_rng(4)
    _, _, b = analyse(rng.normal(size=300))
    assert b["change_point"]["model_comparison"] == {"status": "not_applicable", "reason": "pettitt_not_significant"}


def test_noise_without_change_is_not_detected():
    rng = np.random.default_rng(4)
    _, _, b = analyse(rng.normal(size=300))
    assert b["change_point"]["status"] == "not_detected"
    assert b["change_point"]["date"] is None and b["change_point"]["shift"] is None
    assert b["change_point"]["candidate_date"] is not None and b["change_point"]["p_value"] >= 0.05
    assert b["trend_affected_by_change"] is None
    assert b["trend_effect_basis"] == {"status": "not_applicable", "reason": "no_change_detected"}


def test_outlier_is_flagged_not_removed():
    rng = np.random.default_rng(5)
    x = rng.normal(scale=0.5, size=300)
    x[100] += 8.0
    times, out, b = analyse(x)
    flagged = {o["t"]: o for o in b["outliers"]["items"]}
    assert times[100] in flagged
    assert np.isfinite(out["anomalies"][100])  # value itself is kept


def test_short_series_is_an_explicit_insufficient_state():
    _, _, b = analyse(step_series(n=100, at=50))
    assert b["status"] == "insufficient_for_test" and b["reason"] == "too_short"
    assert b["change_point"] is None


def test_too_many_gaps_is_an_explicit_state():
    x = step_series()
    x[::2] = np.nan
    _, _, b = analyse(x)
    assert b["status"] == "insufficient_for_test" and b["reason"] == "too_many_gaps"


def test_change_near_documented_boundary_is_reported_as_coincidence():
    times = months(1990, 300)
    boundary = {"boundary_id": "test_boundary", "date": times[151], "kind": "processing_stream",
                "title": "test", "reference": {"title": "doc", "url": "https://example.org"}}
    _, _, b = analyse(step_series(), boundaries=[boundary])
    near = b["near_product_boundary"]
    assert len(near) == 1 and near[0]["boundary_id"] == "test_boundary"
    assert abs(near[0]["distance_months"]) <= 12
