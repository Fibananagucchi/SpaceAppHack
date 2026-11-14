"""Statistics (stats-1). Synthetic series exist only here, to verify the maths."""

import math

import numpy as np
import pymannkendall as pmk
import pytest
from scipy import stats as sps

from backend.app import stats


def months(start_year: int, n: int) -> list[str]:
    return [f"{start_year + (i // 12):04d}-{i % 12 + 1:02d}" for i in range(n)]


def ar1(n: int, phi: float, rng: np.random.Generator) -> np.ndarray:
    e = rng.normal(size=n)
    out = np.empty(n)
    out[0] = e[0]
    for i in range(1, n):
        out[i] = phi * out[i - 1] + e[i]
    return out


@pytest.mark.parametrize("seed,trend,phi", [(1, 0.004, 0.5), (2, 0.0, 0.3), (3, -0.01, 0.0)])
def test_hamed_rao_matches_pymannkendall_without_gaps(seed, trend, phi):
    rng = np.random.default_rng(seed)
    n = 300
    x = trend * np.arange(n) + ar1(n, phi, rng)
    t = np.arange(n, dtype=float)
    ours = stats.mann_kendall_hamed_rao(t, x)
    ref = pmk.hamed_rao_modification_test(x)
    assert ours.s == pytest.approx(ref.s)
    assert ours.var_s_corrected == pytest.approx(ref.var_s, rel=1e-9)
    assert ours.p == pytest.approx(ref.p, rel=1e-6, abs=1e-12)
    assert ours.slope == pytest.approx(ref.slope, rel=1e-9)
    assert ours.ci_low <= ours.slope <= ours.ci_high


def test_seasonal_kendall_matches_pymannkendall():
    rng = np.random.default_rng(7)
    n = 12 * 30
    season = 10 * np.sin(2 * np.pi * np.arange(n) / 12)
    x = season + 0.002 * np.arange(n) + rng.normal(size=n)
    times = months(1990, n)
    years = np.array([int(s[:4]) for s in times])
    mons = np.array([int(s[5:7]) for s in times])
    ours = stats.seasonal_kendall(years, mons, x)
    ref = pmk.seasonal_test(x, period=12)
    assert ours["s"] == pytest.approx(ref.s)
    assert ours["var_s"] == pytest.approx(ref.var_s)
    assert ours["p"] == pytest.approx(ref.p, rel=1e-6, abs=1e-12)
    assert ours["slope_per_year"] == pytest.approx(ref.slope, rel=1e-9)


def test_ols_matches_linregress_when_residuals_are_independent():
    rng = np.random.default_rng(11)
    n = 400
    t = np.arange(n, dtype=float)
    x = 0.003 * t + rng.normal(size=n)
    ours = stats.ols_effective_n(t, x)
    ref = sps.linregress(t, x)
    assert ours["slope"] == pytest.approx(ref.slope)
    assert ours["n_effective"] <= n
    if ours["lag1_autocorrelation"] <= 0:  # no correction applied
        assert ours["p"] == pytest.approx(ref.pvalue, rel=1e-6)
    assert ours["ci_low"] < ours["slope"] < ours["ci_high"]


def test_autocorrelation_reduces_effective_sample_size():
    rng = np.random.default_rng(5)
    n = 400
    t = np.arange(n, dtype=float)
    x = ar1(n, 0.7, rng)
    ours = stats.ols_effective_n(t, x)
    assert ours["n_effective"] < n / 2


def test_gaps_keep_real_time_spacing():
    rng = np.random.default_rng(3)
    n = 240
    t_full = np.arange(n, dtype=float)
    x_full = 0.01 * t_full + rng.normal(scale=0.1, size=n)
    keep = np.ones(n, dtype=bool)
    keep[50:110] = False  # a 5-year gap
    res = stats.mann_kendall_hamed_rao(t_full[keep], x_full[keep])
    assert res.slope == pytest.approx(0.01, rel=0.05)  # re-indexing would inflate it


def test_analyze_full_output_and_states():
    rng = np.random.default_rng(9)
    n = 12 * 25
    times = months(2000, n)
    season = 8 * np.sin(2 * np.pi * np.arange(n) / 12)
    values = season + 0.005 * np.arange(n) + ar1(n, 0.4, rng)
    values[30:33] = np.nan  # missing months stay missing
    out = stats.analyze(times, values, "°C")
    an = out["trend"]["monthly_anomalies"]
    assert an["sen_slope"]["status"] == "ok" and an["sen_slope"]["unit"] == "°C per decade"
    assert an["mann_kendall"]["variant"].startswith("Hamed-Rao")
    assert an["ols_t_test"]["status"] == "ok"
    assert an["agreement"] in ("both_significant", "both_not_significant", "tests_disagree")
    assert an["trend_line"]["sen"]["band"] is None
    assert len(an["trend_line"]["sen"]["points"]) == 2
    assert an["sen_slope"]["base"] == {"n_used": n - 3, "n_valid": n - 3, "n_expected": n}
    assert np.isnan(out["anomalies"][30:33]).all()
    raw = out["trend"]["raw"]
    assert raw["seasonal_kendall"]["status"] == "ok"
    assert raw["seasonal_sen_slope"]["ci"] is None
    assert raw["ols_t_test"] == {"status": "not_applicable", "reason": "seasonal_cycle_present"}
    assert len(out["climatology"]["monthly_means"]) == 12


@pytest.mark.parametrize("make,reason", [
    (lambda n: np.arange(n, dtype=float)[:100], "too_short"),
    (lambda n: np.where(np.arange(n) % 2 == 0, np.nan, np.arange(n, dtype=float)), "too_many_gaps"),
    (lambda n: np.zeros(n), "no_variation"),
])
def test_insufficient_series_return_explicit_reason(make, reason):
    values = make(240)
    times = months(2000, values.size)
    out = stats.analyze(times, values, "mm")
    an = out["trend"]["monthly_anomalies"]
    for key in ("sen_slope", "mann_kendall", "ols_t_test", "total_change"):
        assert an[key]["status"] == "insufficient_for_test"
        assert "estimate" not in an[key]
    assert an["agreement"] == "not_available"


def test_sig_rounding():
    assert stats.sig(0.123456789) == 0.123457
    assert stats.sig(float("nan")) is None
    assert stats.sig(None) is None
    assert stats.sig(0.0) == 0.0
    assert math.isclose(stats.sig(12345678.0), 12345700.0)
