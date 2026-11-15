"""Basic mode 2 (step 2): possible abrupt change, outliers and the effect on the trend.

processing_version "breaks-1". Works on the monthly anomalies of any series that meets the
same conditions as the trend tests (>= 120 valid months, >= 66 % valid). Nothing is filled.

* Possible change point: Pettitt (1979) test for a single shift in the median, searched only
  where at least MIN_SEGMENT valid months lie on each side. The approximate p-value assumes
  independent observations; positive autocorrelation makes it optimistic, which the method
  note states.
* Step or gradual change? Pettitt also reacts to any gradual trend, so a significant Pettitt
  result alone is not called a step. Two models are compared by BIC on the anomalies: a straight
  line (2 parameters) and a step in the mean at the Pettitt date (3 parameters incl. location).
  dBIC = BIC(line) - BIC(step); |dBIC| >= 6 is "strong" evidence (Kass & Raftery 1995):
  dBIC >= 6 -> "detected" (a step describes the series better), dBIC <= -6 ->
  "not_distinct_from_trend", otherwise "inconclusive".
* Effect on the trend: only for a "detected" step with a significant whole-series trend, the trend
  may be driven by the abrupt change. Sen + Mann-Kendall on each side are reported as context.
* Outliers: robust z-score 0.6745 (x - median) / MAD > 3.5 (Iglewicz & Hoaglin 1993). Flagged
  only, never removed.
* Documented product boundaries within 12 months of the change are reported separately: a
  coincidence in time, not a proven artifact.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from . import stats

PROCESSING_VERSION = "breaks-1"
MIN_SEGMENT = 24                 # valid months on each side of a change point
MIN_SEGMENT_FOR_TREND = 36       # valid months to test the trend of one side
OUTLIER_Z = 3.5
BOUNDARY_WINDOW_MONTHS = 12
BIC_STRONG = 6.0                 # Kass & Raftery (1995): 6-10 strong, >10 very strong

FEATURES_NOT_ASSESSED = {
    name: {"status": "not_assessed", "reason": "available_from_step_4"}
    for name in ("abruptness", "persistence", "spatial_extent", "other_variables")
}


def _month_diff(a: str, b: str) -> int:
    return (int(b[:4]) - int(a[:4])) * 12 + int(b[5:7]) - int(a[5:7])


def pettitt(x: np.ndarray, min_segment: int = MIN_SEGMENT) -> dict[str, Any] | None:
    """Pettitt test on values in time order. Returns the last index of the 'before' segment."""
    n = x.size
    if n < 2 * min_segment:
        return None
    v = np.sign(x[:, None] - x[None, :]).sum(axis=1)  # V_t = sum_j sgn(x_t - x_j)
    u = np.cumsum(v)                                   # U_t (split after position t)
    allowed = np.arange(min_segment - 1, n - min_segment)
    k_idx = int(allowed[np.argmax(np.abs(u[allowed]))])
    k_stat = float(abs(u[k_idx]))
    p = min(1.0, 2.0 * math.exp(-6.0 * k_stat ** 2 / (n ** 3 + n ** 2)))
    return {"index": k_idx, "K": k_stat, "p": p}


def robust_outliers(times: list[str], anomalies: np.ndarray, values: np.ndarray | None = None) -> dict[str, Any]:
    valid = np.isfinite(anomalies)
    vals = anomalies[valid]
    median = float(np.median(vals))
    mad = float(np.median(np.abs(vals - median)))
    method = f"robust z-score 0.6745 x (anomaly - median) / MAD, |z| > {OUTLIER_Z}"
    if mad == 0:
        return {"status": "not_applicable", "reason": "no_variation", "method": method}
    items = []
    for k, (t, a) in enumerate(zip(times, anomalies)):
        if math.isfinite(a):
            z = 0.6745 * (a - median) / mad
            if abs(z) > OUTLIER_Z:
                v = float(values[k]) if values is not None and math.isfinite(values[k]) else None
                items.append({"t": t, "v": stats.sig(v), "anomaly": stats.sig(float(a)), "robust_z": stats.sig(z, 4)})
    return {"status": "ok", "method": method, "threshold": OUTLIER_Z, "items": items}


def compare_step_vs_line(t: np.ndarray, x: np.ndarray, k: int) -> dict[str, Any]:
    n = x.size
    slope, intercept = np.polyfit(t, x, 1)
    rss_line = float(np.sum((x - (intercept + slope * t)) ** 2))
    rss_step = float(np.sum((x[: k + 1] - x[: k + 1].mean()) ** 2) + np.sum((x[k + 1:] - x[k + 1:].mean()) ** 2))
    if rss_line <= 0 or rss_step <= 0:
        return {"status": "not_applicable", "reason": "perfect_fit"}
    bic_line = n * math.log(rss_line / n) + 2 * math.log(n)
    bic_step = n * math.log(rss_step / n) + 3 * math.log(n)
    delta = bic_line - bic_step
    preferred = "step" if delta >= BIC_STRONG else "line" if delta <= -BIC_STRONG else "neither"
    return {"status": "ok", "method": "BIC: straight line (2 parameters) vs step in mean at the change date (3)",
            "bic_line": stats.sig(bic_line), "bic_step": stats.sig(bic_step), "delta_bic": stats.sig(delta, 4),
            "threshold": BIC_STRONG, "preferred": preferred,
            "rule": "delta_bic = BIC(line) - BIC(step); >= 6 favours a step, <= -6 favours a gradual line"}


def _segment(times: list[str], t: np.ndarray, x: np.ndarray, unit: str) -> dict[str, Any]:
    period = {"start": times[int(t[0])], "end": times[int(t[-1])]}
    base = {"n_valid": int(x.size)}
    if x.size < MIN_SEGMENT_FOR_TREND or np.max(x) == np.min(x):
        reason = "too_short" if x.size < MIN_SEGMENT_FOR_TREND else "no_variation"
        return {"period": period, **base, "status": "insufficient_for_test", "reason": reason}
    mk = stats.mann_kendall_hamed_rao(t, x)
    ok = math.isfinite(mk.p)
    return {
        "period": period, **base, "status": "ok" if ok else "insufficient_for_test",
        "sen_slope": {"estimate": stats.sig(mk.slope * stats.MONTHS_PER_DECADE), "unit": f"{unit} per decade",
                      "ci": ({"level": 1 - stats.ALPHA, "low": stats.sig(mk.ci_low * stats.MONTHS_PER_DECADE),
                              "high": stats.sig(mk.ci_high * stats.MONTHS_PER_DECADE), "of": "Sen's slope"}
                             if mk.ci_low is not None else None)},
        "mann_kendall": ({"p_value": mk.p, "alpha": stats.ALPHA, "significant": bool(mk.p < stats.ALPHA),
                          "variant": "Hamed-Rao modified (autocorrelation)"} if ok
                         else {"status": "insufficient_for_test", "reason": "autocorrelation_correction_failed"}),
        "trend_line": {"status": "ok", "method": "Sen's slope with Conover intercept (anomaly units)",
                       "points": [{"t": period["start"], "y": stats.sig(mk.intercept + mk.slope * t[0])},
                                  {"t": period["end"], "y": stats.sig(mk.intercept + mk.slope * t[-1])}],
                       "band": None},
        "_slope": mk.slope, "_significant": ok and mk.p < stats.ALPHA,
    }


def decide_change(t: np.ndarray, x: np.ndarray) -> dict[str, Any] | None:
    """The change-point decision of breaks-1 for the valid months of one series.

    Shared by point analyses (analyze_breaks) and the globe Changes layer, so that a cell and a point decide
    by exactly the same rule: Pettitt, then BIC step vs straight line for a significant result.
    t: month offsets of the valid months; x: their anomalies. None if the series is too short for Pettitt.
    """
    pt = pettitt(x)
    if pt is None:
        return None
    significant = pt["p"] < stats.ALPHA
    comparison = (compare_step_vs_line(t, x, pt["index"]) if significant
                  else {"status": "not_applicable", "reason": "pettitt_not_significant"})
    if not significant:
        status = "not_detected"
    elif comparison.get("preferred") == "step":
        status = "detected"
    elif comparison.get("preferred") == "line":
        status = "not_distinct_from_trend"
    else:
        status = "inconclusive"
    return {"pettitt": pt, "significant": significant, "comparison": comparison, "status": status}


def analyze_breaks(times: list[str], anomalies: np.ndarray, unit: str, full_trend: dict[str, Any],
                   boundaries: list[dict[str, Any]], values: np.ndarray | None = None) -> dict[str, Any]:
    """Breaks block of contract v1.1 for one series (anomalies already computed)."""
    method = ("Pettitt (1979) single change point on monthly anomalies; approximate p-value assumes "
              "independent observations (autocorrelation makes it optimistic)")
    conditions = {"min_valid_months": stats.MIN_VALID_MONTHS, "min_valid_fraction": stats.MIN_VALID_FRACTION,
                  "min_months_each_side": MIN_SEGMENT, "min_months_for_segment_trend": MIN_SEGMENT_FOR_TREND}
    result: dict[str, Any] = {"status": "ok", "reason": None, "method": method, "conditions": conditions,
                              "processing_version": PROCESSING_VERSION, "change_point": None, "segments": None,
                              "trend_affected_by_change": None, "trend_effect_basis": None, "outliers": None,
                              "near_product_boundary": [], "features": FEATURES_NOT_ASSESSED}
    reason = stats.sufficiency(anomalies) if np.isfinite(anomalies).any() else "too_short"
    if reason:
        result.update(status="insufficient_for_test", reason=reason)
        result["outliers"] = {"status": "insufficient_for_test", "reason": reason}
        return result

    result["outliers"] = robust_outliers(times, anomalies, values)
    t_all = stats.month_offsets(times)
    valid = np.isfinite(anomalies)
    t, x = t_all[valid], anomalies[valid]
    decision = decide_change(t, x)
    if decision is None:
        result.update(status="insufficient_for_test", reason="too_short")
        return result

    pt, significant, comparison, status = (decision["pettitt"], decision["significant"], decision["comparison"],
                                           decision["status"])
    k = pt["index"]
    date = times[int(t[k + 1])]          # first month after the candidate change
    last_before = times[int(t[k])]
    before, after = x[: k + 1], x[k + 1:]
    result["change_point"] = {
        "status": status,
        "pettitt_significant": bool(significant),
        "change_id": f"c_{date}" if significant else None,
        "date": date if significant else None,
        "last_before": last_before if significant else None,
        "candidate_date": date,  # where the Pettitt statistic peaks, reported even when not significant
        "p_value": pt["p"], "alpha": stats.ALPHA, "statistic_K": pt["K"],
        "shift": ({"estimate": stats.sig(float(np.median(after) - np.median(before))), "unit": unit,
                   "of": "median of anomalies after minus before"} if significant else None),
        "levels": ({"before": {"median_anomaly": stats.sig(float(np.median(before))), "unit": unit,
                               "period": {"start": times[int(t[0])], "end": last_before}, "n_valid": int(before.size)},
                    "after": {"median_anomaly": stats.sig(float(np.median(after))), "unit": unit,
                              "period": {"start": date, "end": times[int(t[-1])]}, "n_valid": int(after.size)}}
                   if significant else None),
        "model_comparison": comparison,
    }
    if not significant:
        result["trend_effect_basis"] = {"status": "not_applicable", "reason": "no_change_detected"}
        return result

    segs = [_segment(times, t[: k + 1], before, unit), _segment(times, t[k + 1:], after, unit)]
    full_sig = full_trend.get("mann_kendall", {}).get("significant")
    if status == "detected" and full_sig is not None:
        result["trend_affected_by_change"] = bool(full_sig)
        result["trend_effect_basis"] = {
            "status": "ok",
            "rule": ("a step describes the series better than a straight line (BIC); if the whole-series trend is "
                     "significant, that trend may be driven by the step"),
            "full_series_significant": bool(full_sig)}
    elif status == "not_distinct_from_trend":
        result["trend_affected_by_change"] = False
        result["trend_effect_basis"] = {"status": "ok", "rule": "a straight line describes the series better than a step (BIC)",
                                        "full_series_significant": full_sig}
    else:
        result["trend_affected_by_change"] = None
        result["trend_effect_basis"] = {"status": "not_applicable",
                                        "reason": "inconclusive_step_or_gradual" if status == "inconclusive"
                                        else "no_full_trend_test"}
    for seg in segs:
        seg.pop("_slope", None)
        seg.pop("_significant", None)
    result["segments"] = segs
    result["near_product_boundary"] = [
        {"boundary_id": b["boundary_id"], "date": b["date"], "kind": b["kind"], "title": b["title"],
         "distance_months": _month_diff(b["date"], date), "reference": b["reference"]}
        for b in boundaries if abs(_month_diff(b["date"], date)) <= BOUNDARY_WINDOW_MONTHS
    ]
    return result
