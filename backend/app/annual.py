"""Annual anomalies from monthly anomalies (globe frames and time strip, task 017).

A calendar year's anomaly is the mean of its monthly anomalies. The year is valid only if at
least MIN_VALID_MONTHS of its 12 months have a valid anomaly (6 for OMI NO2, see below);
otherwise it is null with a reason. Nothing is filled, interpolated or carried over from
neighbouring years.

OMI NO2 exception: in central and northern Europe OMI often has no valid winter month (clouds,
snow, low sun; fewer valid days since the 2009 row anomaly), so a 10-month rule leaves most of the
domain empty after 2009. For NO2 the annual anomaly is the mean of at least 6 valid months; every
year reports how many months it is based on.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from . import stats

MIN_VALID_MONTHS = 10
MIN_VALID_MONTHS_BY_VARIABLE = {"no2_tropo": 6}


def min_valid_months(variable_id: str) -> int:
    return MIN_VALID_MONTHS_BY_VARIABLE.get(variable_id, MIN_VALID_MONTHS)


def rule(variable_id: str) -> str:
    text = (f"mean of the monthly anomalies of a calendar year; the year is valid only if at least "
            f"{min_valid_months(variable_id)} of its 12 months have a valid anomaly")
    if variable_id in MIN_VALID_MONTHS_BY_VARIABLE:
        text += " (lower threshold: OMI often has no valid winter months in central and northern Europe)"
    return text


def year_groups(times: list[str]) -> tuple[list[int], list[np.ndarray]]:
    """Calendar years present in `times` and, for each, the indices of its months."""
    years_of = np.array([int(t[:4]) for t in times])
    years = sorted(set(years_of.tolist()))
    return years, [np.where(years_of == y)[0] for y in years]


def annual_means(times: list[str], anomalies: np.ndarray, min_valid: int = MIN_VALID_MONTHS
                 ) -> tuple[list[int], np.ndarray, np.ndarray, list[int]]:
    """Vectorised over leading axes; the last axis is time.

    Returns (years, values[..., n_years], valid_months[..., n_years], months_in_record per year).
    """
    a = np.asarray(anomalies, dtype="float64")
    years, groups = year_groups(times)
    shape = a.shape[:-1] + (len(years),)
    values = np.full(shape, np.nan)
    counts = np.zeros(shape, dtype=int)
    for k, idx in enumerate(groups):
        block = a[..., idx]
        valid = np.isfinite(block)
        n = valid.sum(axis=-1)
        total = np.where(valid, block, 0.0).sum(axis=-1)
        with np.errstate(invalid="ignore", divide="ignore"):
            mean = total / n
        values[..., k] = np.where(n >= min_valid, mean, np.nan)
        counts[..., k] = n
    return years, values, counts, [int(idx.size) for idx in groups]


def annual_series(variable_id: str, times: list[str], anomalies: np.ndarray, unit: str,
                  base_period: dict[str, str]) -> dict[str, Any]:
    """`series.annual` of an analysis: one entry per calendar year touched by the analysis window."""
    need = min_valid_months(variable_id)
    years, values, counts, in_window = annual_means(times, anomalies, need)
    points = []
    for year, v, n, months in zip(years, values.tolist(), counts.tolist(), in_window):
        point: dict[str, Any] = {"year": year, "anomaly": stats.sig(v) if math.isfinite(v) else None,
                                 "valid_months": int(n)}
        if not math.isfinite(v):
            point["missing_reason"] = ("year_not_fully_in_period" if months < need
                                       else f"fewer_than_{need}_valid_months")
        points.append(point)
    return {"status": "ok", "unit": unit, "rule": rule(variable_id), "min_valid_months": need,
            "baseline": base_period, "points": points}
