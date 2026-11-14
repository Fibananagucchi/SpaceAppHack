"""Point analysis: real series + mode-1 statistics (step 1) + basic mode 2 (step 2), explicit states."""

from __future__ import annotations

import math
from datetime import date
from typing import Any

import numpy as np

from . import catalog, stats
from .breaks import analyze_breaks
from .api.models import AnalysisRequest
from .config import Settings
from .series import SourceError, get_point_series, month_range
from .state import StateStore, new_id

SERIES_ENDED_LAG_MONTHS = 6


def _months_between(a: str, b: str) -> int:
    return (int(b[:4]) - int(a[:4])) * 12 + int(b[5:7]) - int(a[5:7])


def source_error_body(request: dict[str, Any], error: SourceError) -> tuple[int, dict[str, Any]]:
    status_code = {"timeout": 504, "rate_limited": 503}.get(error.kind, 502)
    return status_code, {
        "status": "source_error",
        "request": request,
        "error": {"code": "source_error", "source": error.source, "kind": error.kind,
                  "message_public": "The data source could not complete this request.",
                  "retryable": error.kind != "rejected", "retry_after_s": error.retry_after_s},
    }


async def point_analysis(settings: Settings, store: StateStore, req: AnalysisRequest) -> tuple[int, dict[str, Any]]:
    variable = catalog.get_variable(req.variable_id)
    request = req.model_dump(mode="json")
    lat, lon = req.location.lat, req.location.lon
    try:
        series = await get_point_series(settings, store, req.variable_id, lat, lon)
    except SourceError as err:
        return source_error_body(request, err)

    analysis_id = new_id("a")
    unit = variable["unit"]
    warnings: list[dict[str, Any]] = []
    requested = req.period.model_dump() if req.period else None
    result: dict[str, Any] = {
        "analysis_id": analysis_id,
        "status": "ok",
        "request": request,
        "location_resolved": {"type": "point", "requested": {"lat": lat, "lon": lon}, "grid_cell": series.grid_cell},
        "provenance": {**series.provenance, "processing_version": stats.PROCESSING_VERSION},
        "requested_period": requested,
        "observations_period": None,
        "analysis_period": None,
        "breaks": {"status": "not_applicable", "reason": "no_series_data"},
        "warnings": warnings,
    }

    times, values, reasons = series.times, series.values, series.missing_reasons
    valid_idx = np.where(np.isfinite(values))[0] if len(times) else np.array([], dtype=int)

    def no_data(reason: str) -> tuple[int, dict[str, Any]]:
        result["series"] = {"status": "no_data", "reason": reason, "frequency": "monthly", "unit": unit,
                            "points": [], "aggregation": series.aggregation}
        result["trend"] = {"status": "not_applicable", "reason": "no_series_data"}
        store.put_analysis(analysis_id, request, result)
        return 200, result

    if valid_idx.size == 0:
        land_only = variable["coverage"]["surface"] == "land"
        if "source_reported_no_data_for_location" in series.notes or land_only:
            return no_data("outside_product_coverage")
        return no_data("all_values_missing")

    obs_start, obs_end = times[valid_idx[0]], times[valid_idx[-1]]
    result["observations_period"] = {"start": obs_start, "end": obs_end}

    start = max(requested["start"], obs_start) if requested else obs_start
    end = min(requested["end"], obs_end) if requested else obs_end
    if requested and (requested["start"] < obs_start or requested["end"] > obs_end):
        warnings.append({"code": "partial_period", "requested": requested, "used": {"start": start, "end": end}})
    reference_end = requested["end"] if requested else date.today().strftime("%Y-%m")
    if _months_between(obs_end, reference_end) > SERIES_ENDED_LAG_MONTHS:
        warnings.append({"code": "series_ended", "last_available": obs_end})
    if start > end:
        return no_data("period_outside_product")

    window = month_range(start, end)
    index = {tm: k for k, tm in enumerate(times)}
    w_values = np.array([values[index[tm]] if tm in index else np.nan for tm in window], dtype=float)
    w_reasons = [reasons[index[tm]] if tm in index else "outside_product_period" for tm in window]
    result["analysis_period"] = {"start": start, "end": end}

    n_valid = int(np.isfinite(w_values).sum())
    if n_valid == 0:
        return no_data("all_values_missing")
    if n_valid / len(window) < stats.MANY_MISSING_FRACTION:
        warnings.append({"code": "many_missing", "valid_fraction": round(n_valid / len(window), 3)})

    computed = stats.analyze(window, w_values, unit)
    anomalies = computed["anomalies"]
    if computed["climatology"]["incomplete_calendar_months"]:
        warnings.append({"code": "climatology_incomplete",
                         "calendar_months": computed["climatology"]["incomplete_calendar_months"]})

    points = []
    for k, tm in enumerate(window):
        v = w_values[k]
        point: dict[str, Any] = {"t": tm, "v": stats.sig(v) if math.isfinite(v) else None,
                                 "anomaly": stats.sig(anomalies[k]) if math.isfinite(anomalies[k]) else None}
        if not math.isfinite(v):
            point["missing_reason"] = w_reasons[k] or "fill_value"
        points.append(point)

    result["series"] = {
        "status": "ok",
        "reason": None,
        "frequency": "monthly",
        "unit": unit,
        "points": points,
        "climatology": computed["climatology"],
        "coverage": {"expected": len(window), "valid": n_valid, "first_valid": obs_start, "last_valid": obs_end},
        "aggregation": series.aggregation,
        "unit_conversion": variable["processing"]["unit_conversion"],
    }
    result["trend"] = computed["trend"]

    # ---- basic mode 2: possible change, outliers, documented product boundaries ------------
    boundaries = [b for b in catalog.product_boundaries(req.variable_id) if start < b["date"] <= end]
    for b in boundaries:
        warnings.append({"code": "product_boundary_in_period", "boundary_id": b["boundary_id"], "date": b["date"],
                         "kind": b["kind"], "title": b["title"], "reference": b["reference"]})
    brk = analyze_breaks(window, anomalies, unit, computed["trend"]["monthly_anomalies"], boundaries, w_values)
    result["breaks"] = brk
    if brk.get("trend_affected_by_change") is True:
        warnings.append({"code": "change_may_affect_trend", "change_id": brk["change_point"]["change_id"],
                         "date": brk["change_point"]["date"]})
    for near in brk.get("near_product_boundary", []):
        warnings.append({"code": "change_near_product_boundary", "change_id": brk["change_point"]["change_id"],
                         "boundary_id": near["boundary_id"], "distance_months": near["distance_months"]})

    store.put_analysis(analysis_id, request, result)
    return 200, result
