"""Trend statistics for monthly series — processing_version "stats-1".

Input: values on a regular month grid; NaN means missing and is never filled.
Time inside this module is "months since the first month of the analysis period", so
gaps keep their real spacing (libraries that drop NaN and re-index would distort it).

Methods (minimal and documented):
* anomalies: value minus the mean of the same calendar month over the analysis period
  (at least MIN_PER_CALENDAR_MONTH values per calendar month, otherwise null);
* Sen's slope with a 95 % confidence interval (Gilbert 1987), using the variance of S
  corrected for autocorrelation (Hamed & Rao 1998);
* Mann-Kendall test with the Hamed & Rao (1998) variance correction;
* OLS slope and t-test with an effective sample size n_eff = n (1 - r1) / (1 + r1)
  from the lag-1 autocorrelation of residuals (Santer et al. 2000);
* on raw (seasonal) data: Seasonal Kendall test (Hirsch, Slack & Smith 1982) and the
  seasonal Sen slope; OLS is not applicable there because of the seasonal cycle.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy import stats as sps

PROCESSING_VERSION = "stats-1"
ALPHA = 0.05
MIN_VALID_MONTHS = 120          # 10 years of valid monthly values
MIN_VALID_FRACTION = 0.66
MIN_PER_CALENDAR_MONTH = 5      # for the monthly climatology
MIN_EFFECTIVE_N = 10            # for the OLS t-test
MANY_MISSING_FRACTION = 0.80    # warning threshold
MONTHS_PER_DECADE = 120


def sig(x: float | None, digits: int = 6) -> float | None:
    """Round to significant digits for JSON output (None and non-finite stay None)."""
    if x is None or not math.isfinite(x):
        return None
    if x == 0:
        return 0.0
    return float(f"{x:.{digits}g}")


def _not_ok(status: str, reason: str, **extra: Any) -> dict[str, Any]:
    return {"status": status, "reason": reason, **extra}


# ---------------------------------------------------------------------------------------------
# Building blocks
# ---------------------------------------------------------------------------------------------
@dataclass
class MKResult:
    n: int
    s: float
    var_s: float          # without autocorrelation correction
    var_s_corrected: float
    z: float
    p: float
    tau: float
    slope: float          # Sen's slope per time unit
    intercept: float      # Conover: median(x - slope * t)
    ci_low: float | None
    ci_high: float | None


def _variance_s(x: np.ndarray) -> float:
    n = x.size
    _, counts = np.unique(x, return_counts=True)
    ties = counts[counts > 1]
    return (n * (n - 1) * (2 * n + 5) - np.sum(ties * (ties - 1) * (2 * ties + 5))) / 18.0


def _z_score(s: float, var_s: float) -> float:
    if var_s <= 0:
        return float("nan")
    if s > 0:
        return (s - 1) / math.sqrt(var_s)
    if s < 0:
        return (s + 1) / math.sqrt(var_s)
    return 0.0


def _pairwise(t: np.ndarray, x: np.ndarray) -> tuple[float, np.ndarray]:
    """Mann-Kendall S and all pairwise slopes for i < j (t strictly increasing)."""
    i, j = np.triu_indices(x.size, k=1)
    dx = x[j] - x[i]
    s = float(np.sum(np.sign(dx)))
    slopes = dx / (t[j] - t[i])
    return s, slopes


def _acf_with_gaps(t: np.ndarray, y: np.ndarray, max_lag: int) -> np.ndarray:
    """Biased autocorrelation (as in pymannkendall) on a month grid with gaps.

    c_k = sum over valid pairs (t, t+k) of (y_t - mean)(y_{t+k} - mean) / n,  rho_k = c_k / c_0.
    For a series without gaps this equals the usual biased estimator.
    """
    n = y.size
    span = int(t[-1] - t[0]) + 1
    grid = np.full(span, np.nan)
    grid[(t - t[0]).astype(int)] = y - y.mean()
    c0 = np.nansum(grid * grid) / n
    rho = np.zeros(max_lag + 1)
    rho[0] = 1.0
    if c0 <= 0:
        return rho
    for k in range(1, min(max_lag, span - 1) + 1):
        prod = grid[:-k] * grid[k:]
        rho[k] = (np.nansum(prod) / n) / c0
    return rho


def mann_kendall_hamed_rao(t: np.ndarray, x: np.ndarray, alpha: float = ALPHA) -> MKResult:
    n = x.size
    s, slopes = _pairwise(t, x)
    var_s = _variance_s(x)
    slope = float(np.median(slopes))
    detrended = x - slope * t
    ranks = sps.rankdata(detrended)
    max_lag = max(1, n - 3)
    rho = _acf_with_gaps(t, ranks, max_lag)
    bound = sps.norm.ppf(1 - alpha / 2) / math.sqrt(n)
    sni = 0.0
    for k in range(1, max_lag + 1):
        if abs(rho[k]) > bound:
            sni += (n - k) * (n - k - 1) * (n - k - 2) * rho[k]
    n_ns = 1 + (2 / (n * (n - 1) * (n - 2))) * sni
    var_corr = var_s * n_ns
    z = _z_score(s, var_corr)
    p = float(2 * sps.norm.sf(abs(z))) if math.isfinite(z) else float("nan")
    tau = s / (0.5 * n * (n - 1))
    intercept = float(np.median(x - slope * t))
    ci_low = ci_high = None
    if var_corr > 0:
        ordered = np.sort(slopes)
        n_pairs = ordered.size
        c = sps.norm.ppf(1 - alpha / 2) * math.sqrt(var_corr)
        m1 = (n_pairs - c) / 2.0
        m2 = (n_pairs + c) / 2.0
        lo_idx = int(np.clip(round(m1) - 1, 0, n_pairs - 1))
        hi_idx = int(np.clip(round(m2), 0, n_pairs - 1))
        ci_low, ci_high = float(ordered[lo_idx]), float(ordered[hi_idx])
    return MKResult(n, s, var_s, var_corr, z, p, tau, slope, intercept, ci_low, ci_high)


def ols_effective_n(t: np.ndarray, x: np.ndarray, alpha: float = ALPHA) -> dict[str, Any]:
    n = x.size
    t_mean = t.mean()
    sxx = float(np.sum((t - t_mean) ** 2))
    slope = float(np.sum((t - t_mean) * (x - x.mean())) / sxx)
    intercept = float(x.mean() - slope * t_mean)
    resid = x - (intercept + slope * t)
    # lag-1 autocorrelation of residuals using only consecutive months that are both valid
    consecutive = np.where(np.diff(t) == 1)[0]
    denom = float(np.sum(resid ** 2))
    r1 = float(np.sum(resid[consecutive] * resid[consecutive + 1]) / denom) if denom > 0 and consecutive.size else 0.0
    n_eff = n * (1 - r1) / (1 + r1) if r1 > 0 else float(n)
    n_eff = min(float(n), n_eff)
    base = {"n": n, "n_effective": sig(n_eff, 4), "lag1_autocorrelation": sig(r1, 4),
            "slope": slope, "intercept": intercept}
    if n_eff < MIN_EFFECTIVE_N:
        return {"status": "insufficient_for_test", "reason": "too_few_effective_samples", **base}
    s_e2 = denom / (n_eff - 2)
    se = math.sqrt(s_e2 / sxx)
    df = n_eff - 2
    t_stat = slope / se if se > 0 else float("nan")
    p = float(2 * sps.t.sf(abs(t_stat), df)) if math.isfinite(t_stat) else float("nan")
    t_crit = float(sps.t.ppf(1 - alpha / 2, df))
    return {"status": "ok", **base, "se": se, "t": t_stat, "df": df, "p": p,
            "ci_low": slope - t_crit * se, "ci_high": slope + t_crit * se}


def seasonal_kendall(years: np.ndarray, months: np.ndarray, x: np.ndarray) -> dict[str, Any]:
    """Seasonal Kendall test and seasonal Sen slope (per year) on raw monthly values."""
    s_total = 0.0
    var_total = 0.0
    denom = 0.0
    slopes: list[np.ndarray] = []
    seasons_used = 0
    for m in range(1, 13):
        sel = months == m
        if np.count_nonzero(sel) < 3:
            continue
        ty, xm = years[sel].astype(float), x[sel]
        order = np.argsort(ty)
        ty, xm = ty[order], xm[order]
        s_m, sl = _pairwise(ty, xm)
        s_total += s_m
        var_total += _variance_s(xm)
        denom += 0.5 * xm.size * (xm.size - 1)
        slopes.append(sl)
        seasons_used += 1
    if seasons_used < 6:
        return {"status": "insufficient_for_test", "reason": "too_few_values_per_calendar_month"}
    z = _z_score(s_total, var_total)
    p = float(2 * sps.norm.sf(abs(z))) if math.isfinite(z) else float("nan")
    return {"status": "ok", "s": s_total, "var_s": var_total, "z": z, "p": p,
            "tau": s_total / denom if denom else float("nan"),
            "slope_per_year": float(np.median(np.concatenate(slopes))), "seasons_used": seasons_used}


# ---------------------------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------------------------
def month_offsets(times: list[str]) -> np.ndarray:
    first = int(times[0][:4]) * 12 + int(times[0][5:7]) - 1
    return np.array([int(s[:4]) * 12 + int(s[5:7]) - 1 - first for s in times], dtype=float)


def anomalies(times: list[str], values: np.ndarray) -> tuple[np.ndarray, list[float | None], list[int]]:
    months = np.array([int(s[5:7]) for s in times])
    clim: list[float | None] = []
    anom = np.full(values.shape, np.nan)
    incomplete: list[int] = []
    for m in range(1, 13):
        sel = months == m
        vals = values[sel]
        valid = vals[np.isfinite(vals)]
        if valid.size >= MIN_PER_CALENDAR_MONTH:
            mean = float(valid.mean())
            clim.append(mean)
            anom[sel] = vals - mean
        else:
            clim.append(float(valid.mean()) if valid.size else None)
            if sel.any():
                incomplete.append(m)
    return anom, clim, incomplete


def sufficiency(values: np.ndarray) -> str | None:
    valid = values[np.isfinite(values)]
    if valid.size < MIN_VALID_MONTHS:
        return "too_short"
    if valid.size / values.size < MIN_VALID_FRACTION:
        return "too_many_gaps"
    if np.nanmax(valid) == np.nanmin(valid):
        return "no_variation"
    return None


def _per_decade(value: float | None) -> float | None:
    return None if value is None else value * MONTHS_PER_DECADE


def _line(times: list[str], t0: float, t1: float, intercept: float, slope: float, method: str) -> dict[str, Any]:
    return {"status": "ok", "method": method, "time_origin": times[0],
            "intercept": sig(intercept), "slope_per_month": sig(slope),
            "points": [{"t": times[int(t0)], "y": sig(intercept + slope * t0)},
                       {"t": times[int(t1)], "y": sig(intercept + slope * t1)}],
            "band": None}


def analyze(times: list[str], values: np.ndarray, unit: str, alpha: float = ALPHA) -> dict[str, Any]:
    """Full mode-1 statistics for one monthly series already in display units."""
    values = np.asarray(values, dtype=float)
    t_all = month_offsets(times)
    anom, clim, incomplete = anomalies(times, values)
    trend_unit = f"{unit} per decade"
    expected = values.size

    # ---- monthly anomalies ------------------------------------------------------------------
    an: dict[str, Any] = {}
    reason = sufficiency(anom) if np.isfinite(anom).any() else "too_short"
    valid = np.isfinite(anom)
    base = {"n_used": int(valid.sum()), "n_valid": int(np.isfinite(values).sum()), "n_expected": expected}
    if reason:
        for key in ("sen_slope", "mann_kendall", "ols_t_test", "total_change"):
            an[key] = _not_ok("insufficient_for_test", reason, base=base)
        an["agreement"] = "not_available"
        an["trend_line"] = {"sen": _not_ok("insufficient_for_test", reason),
                            "ols": _not_ok("insufficient_for_test", reason)}
    else:
        t, x = t_all[valid], anom[valid]
        mk = mann_kendall_hamed_rao(t, x, alpha)
        an["sen_slope"] = {
            "status": "ok", "estimate": sig(_per_decade(mk.slope)), "unit": trend_unit,
            "ci": ({"level": 1 - alpha, "low": sig(_per_decade(mk.ci_low)), "high": sig(_per_decade(mk.ci_high)),
                    "of": "Sen's slope", "method": "Gilbert (1987) with Hamed-Rao corrected variance"}
                   if mk.ci_low is not None else None),
            "base": base}
        mk_ok = math.isfinite(mk.p)
        an["mann_kendall"] = ({
            "status": "ok", "variant": "Hamed-Rao modified (autocorrelation)",
            "tau": sig(mk.tau, 4), "z": sig(mk.z, 4), "p_value": mk.p, "alpha": alpha,
            "significant": bool(mk.p < alpha), "base": base}
            if mk_ok else _not_ok("insufficient_for_test", "autocorrelation_correction_failed", base=base))
        ols = ols_effective_n(t, x, alpha)
        if ols["status"] == "ok":
            an["ols_t_test"] = {
                "status": "ok", "estimate": sig(_per_decade(ols["slope"])), "unit": trend_unit,
                "ci": {"level": 1 - alpha, "low": sig(_per_decade(ols["ci_low"])),
                       "high": sig(_per_decade(ols["ci_high"])), "of": "OLS slope"},
                "t": sig(ols["t"], 4), "df_effective": sig(ols["df"], 4), "p_value": ols["p"], "alpha": alpha,
                "significant": bool(ols["p"] < alpha), "n": ols["n"], "n_effective": ols["n_effective"],
                "lag1_autocorrelation": ols["lag1_autocorrelation"], "base": base}
        else:
            an["ols_t_test"] = _not_ok(ols["status"], ols["reason"], n=ols["n"], n_effective=ols["n_effective"],
                                       lag1_autocorrelation=ols["lag1_autocorrelation"], base=base)
        first_valid, last_valid = int(t[0]), int(t[-1])
        span_months = last_valid - first_valid
        an["total_change"] = {"status": "ok", "estimate": sig(mk.slope * span_months), "unit": unit,
                              "from": "sen_slope", "over": {"start": times[first_valid], "end": times[last_valid]}}
        sig_mk = an["mann_kendall"].get("significant")
        sig_ols = an["ols_t_test"].get("significant")
        if sig_mk is None or sig_ols is None:
            an["agreement"] = "not_available"
        elif sig_mk and sig_ols:
            an["agreement"] = "both_significant"
        elif not sig_mk and not sig_ols:
            an["agreement"] = "both_not_significant"
        else:
            an["agreement"] = "tests_disagree"
        an["trend_line"] = {
            "sen": _line(times, first_valid, last_valid, mk.intercept, mk.slope, "Sen's slope with Conover intercept"),
            "ols": (_line(times, first_valid, last_valid, ols["intercept"], ols["slope"], "ordinary least squares")
                    if ols["status"] == "ok" else _not_ok(ols["status"], ols["reason"])),
        }

    # ---- raw values ------------------------------------------------------------------------
    raw: dict[str, Any] = {}
    raw_valid = np.isfinite(values)
    raw_base = {"n_used": int(raw_valid.sum()), "n_valid": int(raw_valid.sum()), "n_expected": expected}
    raw_reason = sufficiency(values) if raw_valid.any() else "too_short"
    if raw_reason:
        raw["seasonal_kendall"] = _not_ok("insufficient_for_test", raw_reason, base=raw_base)
        raw["seasonal_sen_slope"] = _not_ok("insufficient_for_test", raw_reason, base=raw_base)
    else:
        years = np.array([int(s[:4]) for s in times])[raw_valid]
        months = np.array([int(s[5:7]) for s in times])[raw_valid]
        sk = seasonal_kendall(years, months, values[raw_valid])
        if sk["status"] == "ok":
            raw["seasonal_kendall"] = {"status": "ok", "variant": "Seasonal Kendall (Hirsch et al. 1982)",
                                       "tau": sig(sk["tau"], 4), "z": sig(sk["z"], 4), "p_value": sk["p"],
                                       "alpha": alpha, "significant": bool(sk["p"] < alpha),
                                       "seasons_used": sk["seasons_used"], "base": raw_base}
            raw["seasonal_sen_slope"] = {"status": "ok", "estimate": sig(sk["slope_per_year"] * 10), "unit": trend_unit,
                                         "ci": None, "ci_status": {"status": "not_available",
                                                                   "reason": "not_computed_for_seasonal_sen"},
                                         "base": raw_base}
        else:
            raw["seasonal_kendall"] = _not_ok(sk["status"], sk["reason"], base=raw_base)
            raw["seasonal_sen_slope"] = _not_ok(sk["status"], sk["reason"], base=raw_base)
    raw["ols_t_test"] = {"status": "not_applicable", "reason": "seasonal_cycle_present"}
    raw["trend_line"] = {"status": "not_applicable", "reason": "seasonal_cycle_present"}

    return {
        "anomalies": anom,
        "climatology": {"base_period": {"start": times[0], "end": times[-1]},
                        "rule": f"mean of each calendar month over the analysis period; "
                                f"at least {MIN_PER_CALENDAR_MONTH} values per calendar month",
                        "monthly_means": [sig(c) for c in clim],
                        "incomplete_calendar_months": incomplete},
        "trend": {"monthly_anomalies": an, "raw": raw},
    }
