"""Full mode 2 (step 4): investigation of one possible change ("investigation-2").

Input: a stored analysis (point or area) and the change_id of its change point.
Only features that are really computed are reported; everything else is ``not_assessed``.

Features
* abruptness   — from breaks-1: step vs gradual line (BIC) and shift relative to the noise before the change.
* persistence  — median of the last 24 months after the change compared with the levels before / after:
                 "persistent" if at least half of the shift is retained, otherwise "temporary".
* spatial_extent (points) — the same change test in the 8 neighbouring grid cells of the same product
                 (Europe cube, otherwise Giovanni): "local" / "mixed" / "regional".
* other_variables — the same change test for the other core variables at the same place.
EONET is reported as a separate observation (search frame, events found or none, coverage note);
"no event found" is never used as an argument about the cause.

Conclusion — four categories (team decision 14.11 22:57), chosen by transparent ordered rules:
  R1 Possible data artifact            — the change lies within 12 months of a documented product boundary.
  R2 Consistent with a natural event   — the change matches a natural event in the curated list of known events
                                         (variable, time window, place and, where the source states it,
                                         direction; team decision 14.11 23:45).
  R3 Consistent with human influence   — the same for a human-caused event in the curated list.
     EONET is an observation only and never chooses the category.
  If R1 and R2/R3 both apply, both explanations are shown side by side ("coinciding_explanations"); the
  category field keeps R1 by the agreed priority, but neither explanation is presented as the winner.
  R4 Cause undetermined                — none of the above.
The first rule that applies gives the category; every other rule that applies is listed as an alternative.
Evidence for / against is listed explicitly. No probabilities, never "proven".
"""

from __future__ import annotations

import asyncio
import math
from datetime import date, timedelta
from typing import Any

import httpx
import numpy as np

from . import catalog, known_events, stats
from .breaks import analyze_breaks
from .config import Settings
from .http_client import upstream
from .series import SourceError, area_from_cube, bbox_in_europe, cube_ready, from_cube, fetch_giovanni, month_range
from .state import StateStore, new_id

PROCESSING_VERSION = "investigation-2"
NEAR_MONTHS = 12
PERSISTENCE_LAST_MONTHS = 24
MIN_AFTER_FOR_PERSISTENCE = 36
EONET_URL = "https://eonet.gsfc.nasa.gov/api/v3/events"
EONET_PAD_DEG = 1.0
EONET_DAYS_BEFORE = 90
EONET_DAYS_AFTER = 45
NATURAL_EONET = {"drought", "dustHaze", "earthquakes", "floods", "landslides", "seaLakeIce", "severeStorms",
                 "snow", "tempExtremes", "volcanoes", "waterColor", "wildfires"}
CORE_VARIABLES = ("t2m", "precip", "soil_moisture", "evapotranspiration", "surface_runoff",
                  "airs_surface_air_temp", "no2_tropo")

CATEGORY_LABELS = {
    "possible_data_artifact": "Possible data artifact",
    "consistent_with_natural_event": "Consistent with a natural event",
    "consistent_with_human_influence": "Consistent with human influence",
    "cause_undetermined": "Cause undetermined",
}
RULES = [
    {"rule": "R1", "category": "possible_data_artifact",
     "text": "The change lies within 12 months of a documented change of the data product (version, calibration, "
             "input data or instrument)."},
    {"rule": "R2", "category": "consistent_with_natural_event",
     "text": "The change matches a natural event in the curated list of known events: same variable, change month inside the event's window, location inside the event area and, where the source states it, the same direction of change. The event's sources are linked."},
    {"rule": "R3", "category": "consistent_with_human_influence",
     "text": "The change matches a human-caused event in the curated list of known events, by the same conditions. The event's sources are linked."},
    {"rule": "R4", "category": "cause_undetermined", "text": "None of the rules above applies."},
]
HOW_CLASSIFIED = ("Rules are checked in order R1 to R4; the first rule that applies gives the category and every "
                  "other rule that applies is shown as an alternative. If a documented product change (R1) and a "
                  "known event (R2 or R3) both coincide with the change, both are shown side by side and neither is "
                  "treated as the answer. 'Consistent with' means the evidence fits; it is not proof. Known events "
                  "come from a short curated list with sources. NASA EONET events are shown separately as an "
                  "observation and are not used to choose the category.")


def _month_diff(a: str, b: str) -> int:
    return (int(b[:4]) - int(a[:4])) * 12 + int(b[5:7]) - int(a[5:7])


def _robust_sd(x: np.ndarray) -> float:
    x = x[np.isfinite(x)]
    if x.size < 3:
        return float("nan")
    return float(1.4826 * np.median(np.abs(x - np.median(x))))


# ---------------------------------------------------------------------------------------------
# Features from the stored analysis
# ---------------------------------------------------------------------------------------------
def abruptness(analysis: dict[str, Any]) -> dict[str, Any]:
    cp = analysis["breaks"]["change_point"]
    status = cp["status"]
    value = {"detected": "abrupt", "inconclusive": "unclear", "not_distinct_from_trend": "gradual"}.get(status)
    points = analysis["series"]["points"]
    before = np.array([p["anomaly"] if p["anomaly"] is not None else np.nan for p in points if p["t"] < cp["date"]])
    noise = _robust_sd(before)
    shift = (cp.get("shift") or {}).get("estimate")
    ratio = abs(shift) / noise if shift is not None and math.isfinite(noise) and noise > 0 else None
    return {"status": "ok", "value": value,
            "method": "step vs straight line (BIC, breaks-1) and shift compared with the noise before the change",
            "detail": {"delta_bic": (cp.get("model_comparison") or {}).get("delta_bic"), "shift": shift,
                       "unit": analysis["series"]["unit"], "noise_sd_before": stats.sig(noise),
                       "shift_to_noise": stats.sig(ratio, 3) if ratio is not None else None}}


def persistence(analysis: dict[str, Any]) -> dict[str, Any]:
    cp = analysis["breaks"]["change_point"]
    levels = cp.get("levels") or {}
    points = analysis["series"]["points"]
    after = [(p["t"], p["anomaly"]) for p in points if p["t"] >= cp["date"] and p["anomaly"] is not None]
    if len(after) < MIN_AFTER_FOR_PERSISTENCE:
        return {"status": "not_assessed", "reason": "too_little_data_after_change",
                "detail": {"valid_months_after": len(after), "needed": MIN_AFTER_FOR_PERSISTENCE}}
    last = after[-PERSISTENCE_LAST_MONTHS:]
    med_last = float(np.median([a for _, a in last]))
    med_before = levels["before"]["median_anomaly"]
    med_after = levels["after"]["median_anomaly"]
    shift = med_after - med_before
    if shift == 0:
        return {"status": "not_assessed", "reason": "no_shift"}
    retained = (med_last - med_before) / shift
    return {"status": "ok", "value": "persistent" if retained >= 0.5 else "temporary",
            "method": f"median of the last {PERSISTENCE_LAST_MONTHS} valid months after the change versus the levels "
                      f"before and after; persistent if at least half of the shift is retained",
            "detail": {"median_before": med_before, "median_after": med_after, "median_last_months": stats.sig(med_last),
                       "last_period": {"start": last[0][0], "end": last[-1][0]},
                       "retained_fraction": stats.sig(retained, 3), "unit": analysis["series"]["unit"]}}


# ---------------------------------------------------------------------------------------------
# Change test on other series (neighbours, other variables)
# ---------------------------------------------------------------------------------------------
def change_on_series(times: list[str], values: np.ndarray, unit: str, period: dict[str, str], date_ref: str,
                     sign_ref: float) -> dict[str, Any]:
    # Test each series on the overlap of the analysis period with its OWN record, so that a shorter
    # product (e.g. GLDAS from 2000) is not judged on months it never covered.
    valid_times = [t for t, v in zip(times, values) if np.isfinite(v)]
    if not valid_times:
        return {"status": "no_data"}
    start = max(period["start"], valid_times[0])
    end = min(period["end"], valid_times[-1])
    if not start < date_ref <= end:
        return {"status": "not_assessed", "reason": "change_outside_this_record",
                "record": {"start": valid_times[0], "end": valid_times[-1]}}
    window = month_range(start, end)
    index = {t: k for k, t in enumerate(times)}
    w = np.array([values[index[t]] if t in index else np.nan for t in window], dtype=float)
    computed = stats.analyze(window, w, unit)
    brk = analyze_breaks(window, computed["anomalies"], unit, computed["trend"]["monthly_anomalies"], [], w)
    if brk["status"] != "ok":
        return {"status": brk["status"], "reason": brk.get("reason")}
    cp = brk["change_point"]
    if cp["status"] in ("not_detected", "not_distinct_from_trend"):
        return {"status": "ok", "change_status": cp["status"], "shows_change": False}
    near = abs(_month_diff(date_ref, cp["date"])) <= NEAR_MONTHS
    same_sign = sign_ref == 0 or np.sign(cp["shift"]["estimate"]) == np.sign(sign_ref)
    return {"status": "ok", "change_status": cp["status"], "date": cp["date"], "shift": cp["shift"]["estimate"],
            "unit": unit, "delta_bic": (cp.get("model_comparison") or {}).get("delta_bic"),
            "shows_change": bool(near and same_sign), "within_months": NEAR_MONTHS}


async def _point_series(settings: Settings, store: StateStore, variable_id: str, lat: float, lon: float,
                        prefer_cube: bool):
    if prefer_cube and cube_ready(settings.data_dir, variable_id):
        s = from_cube(settings.data_dir, variable_id, lat, lon)
        if s is not None:
            return s
    return await fetch_giovanni(settings, store, variable_id, lat, lon)


async def spatial_extent(settings: Settings, store: StateStore, analysis: dict[str, Any]) -> dict[str, Any]:
    loc = analysis["location_resolved"]
    if loc["type"] != "point":
        return {"status": "not_assessed", "reason": "area_analysis"}
    vid = analysis["request"]["variable_id"]
    if catalog.is_slow(vid):
        return {"status": "not_assessed", "reason": "not_available_for_this_variable"}
    cell = loc["grid_cell"]
    cp = analysis["breaks"]["change_point"]
    in_europe = analysis["provenance"]["source_service"] == "europe_cube"
    offsets = [(di, dj) for di in (-1, 0, 1) for dj in (-1, 0, 1) if (di, dj) != (0, 0)]
    coords = [(cell["center_lat"] + di * cell["lat_res"], cell["center_lon"] + dj * cell["lon_res"]) for di, dj in offsets]

    async def one(lat: float, lon: float) -> dict[str, Any]:
        try:
            s = await _point_series(settings, store, vid, lat, lon, in_europe)
        except SourceError as err:
            return {"lat": lat, "lon": lon, "status": "source_error", "kind": err.kind}
        res = change_on_series(s.times, s.values, analysis["series"]["unit"], analysis["analysis_period"],
                               cp["date"], cp["shift"]["estimate"])
        return {"lat": round(lat, 5), "lon": round(lon, 5), **res}

    neighbours = await asyncio.gather(*(one(lat, lon) for lat, lon in coords))
    assessed = [n for n in neighbours if n["status"] == "ok"]
    if len(assessed) < 4:
        return {"status": "not_assessed", "reason": "too_few_neighbours_with_data", "neighbours": neighbours}
    with_change = sum(1 for n in assessed if n["shows_change"])
    frac = with_change / len(assessed)
    value = "regional" if frac >= 0.75 else "local" if with_change <= 2 else "mixed"
    return {"status": "ok", "value": value,
            "method": (f"same change test in the 8 neighbouring grid cells; a neighbour counts if its change is "
                       f"within {NEAR_MONTHS} months and has the same sign"),
            "detail": {"neighbours_with_change": with_change, "neighbours_assessed": len(assessed),
                       "neighbours": neighbours}}


async def other_variables(settings: Settings, store: StateStore, analysis: dict[str, Any]) -> dict[str, Any]:
    vid = analysis["request"]["variable_id"]
    loc = analysis["location_resolved"]
    cp = analysis["breaks"]["change_point"]
    others = [v for v in CORE_VARIABLES if v != vid]

    async def one(other: str) -> dict[str, Any]:
        unit = catalog.get_variable(other)["unit"]
        try:
            if loc["type"] == "point":
                req = analysis["request"]["location"]
                s = await _point_series(settings, store, other, req["lat"], req["lon"], True)
            else:
                bbox = tuple(loc["requested"]["bbox"])
                if not (bbox_in_europe(bbox) and cube_ready(settings.data_dir, other)):
                    return {"variable_id": other, "status": "not_assessed", "reason": "area_outside_europe_cube"}
                s, _ = area_from_cube(settings.data_dir, other, bbox)
        except SourceError as err:
            return {"variable_id": other, "status": "source_error", "kind": err.kind}
        except Exception:  # e.g. area smaller than this product's grid cell
            return {"variable_id": other, "status": "not_assessed", "reason": "series_not_available"}
        return {"variable_id": other, **change_on_series(s.times, s.values, unit, analysis["analysis_period"],
                                                          cp["date"], 0.0)}

    items = await asyncio.gather(*(one(o) for o in others))
    assessed = [i for i in items if i["status"] == "ok"]
    if not assessed:
        return {"status": "not_assessed", "reason": "no_other_variable_available", "items": items}
    near = [i["variable_id"] for i in assessed if i["shows_change"]]
    return {"status": "ok", "value": "also_in_other_variables" if near else "only_this_variable",
            "method": f"same change test for the other core variables at the same place, within {NEAR_MONTHS} months",
            "detail": {"variables_with_change": near, "variables_assessed": len(assessed), "items": items}}


# ---------------------------------------------------------------------------------------------
# EONET
# ---------------------------------------------------------------------------------------------
async def eonet_search(analysis: dict[str, Any]) -> dict[str, Any]:
    loc = analysis["location_resolved"]
    if loc["type"] == "point":
        lat, lon = loc["grid_cell"]["center_lat"], loc["grid_cell"]["center_lon"]
        west, south, east, north = lon - EONET_PAD_DEG, lat - EONET_PAD_DEG, lon + EONET_PAD_DEG, lat + EONET_PAD_DEG
    else:
        w, s, e, n = loc["requested"]["bbox"]
        west, south, east, north = w - EONET_PAD_DEG, s - EONET_PAD_DEG, e + EONET_PAD_DEG, n + EONET_PAD_DEG
    change = analysis["breaks"]["change_point"]["date"]
    first = date(int(change[:4]), int(change[5:7]), 1)
    start, end = first - timedelta(days=EONET_DAYS_BEFORE), first + timedelta(days=EONET_DAYS_AFTER)
    search = {"bbox": [round(west, 4), round(south, 4), round(east, 4), round(north, 4)],
              "start": start.isoformat(), "end": end.isoformat(), "categories": "all"}
    coverage = ("EONET is a catalogue of selected events; coverage depends on the category and most records start "
                "in 2015. An event that is not listed may still have happened.")
    params = {"bbox": f"{west},{north},{east},{south}", "start": start.isoformat(), "end": end.isoformat(),
              "status": "all", "limit": 100}
    try:
        async with upstream(timeout=30.0) as client:
            r = await client.get(EONET_URL, params=params)
    except httpx.HTTPError:
        return {"status": "source_error", "search": search, "coverage_note": coverage}
    if r.status_code != 200:
        return {"status": "source_error", "search": search, "coverage_note": coverage}
    events = []
    for e in r.json().get("events", []):
        cats = e.get("categories", [])
        geoms = e.get("geometry", [])
        events.append({"id": e.get("id"), "title": e.get("title"),
                       "categories": [{"id": c.get("id"), "title": c.get("title")} for c in cats],
                       "first_date": geoms[0].get("date", "")[:10] if geoms else None,
                       "link": e.get("link"),
                       "sources": [{"id": s.get("id"), "url": s.get("url")} for s in e.get("sources", [])]})
    return {"status": "ok", "search": search, "coverage_note": coverage, "events": events,
            "early_record_note": ("The change is before 2015, when EONET has few records."
                                  if change < "2015-01" else None)}


# ---------------------------------------------------------------------------------------------
# Conclusion
# ---------------------------------------------------------------------------------------------
def classify(analysis: dict[str, Any], features: dict[str, Any], eonet: dict[str, Any]) -> dict[str, Any]:
    """Category by ordered rules. EONET is NOT an argument (tasks 012/013): it is reported separately."""
    brk = analysis["breaks"]
    cp = brk["change_point"]
    near_boundaries = brk.get("near_product_boundary", [])
    context = independent_causal_context(analysis)  # curated known events matching this change

    applies = {"R1": bool(near_boundaries),
               "R2": any(c["kind"] == "natural" for c in context),
               "R3": any(c["kind"] == "human" for c in context)}
    evidence: dict[str, list[dict[str, Any]]] = {"R1": [], "R2": [], "R3": []}
    for b in near_boundaries:
        evidence["R1"].append({"code": "near_product_boundary",
                               "text": f"{b['title']} ({b['date']}), {abs(b['distance_months'])} months from the change.",
                               "reference": b["reference"]})
    for c in context:
        evidence["R2" if c["kind"] == "natural" else "R3"].append(
            {"code": "documented_context", "text": c["text"], "reference": c["reference"]})

    order = ["R1", "R2", "R3"]
    chosen = next((r for r in order if applies[r]), "R4")
    category = next(x["category"] for x in RULES if x["rule"] == chosen)

    evidence_for = list(evidence.get(chosen, []))
    evidence_against: list[dict[str, Any]] = []
    sp = features["spatial_extent"]
    ov = features["other_variables"]
    pe = features["persistence"]
    ab = features["abruptness"]
    if cp["status"] == "inconclusive":
        evidence_against.append({"code": "change_not_distinct",
                                 "text": "A step could not be told apart from a gradual change (BIC)."})
    if chosen == "R1":
        if ov.get("status") == "ok" and ov["value"] == "also_in_other_variables":
            evidence_against.append({"code": "other_products_change",
                                     "text": "Other variables from different products change at about the same time: "
                                             + ", ".join(ov["detail"]["variables_with_change"]) + "."})
        if sp.get("status") == "ok" and sp["value"] == "regional":
            evidence_for.append({"code": "regional_change",
                                 "text": "Most neighbouring cells change at the same time, as expected for a "
                                         "product-wide change."})
    if chosen == "R4":
        for code, feat in (("abruptness", ab), ("persistence", pe), ("spatial_extent", sp), ("other_variables", ov)):
            if feat.get("status") == "ok":
                label = code.replace("_", " ")
                value = str(feat["value"]).replace("_", " ")
                evidence_for.append({"code": f"{code}_{feat['value']}", "text": f"Observed: {label} is {value}."})
        evidence_for.append({"code": "no_independent_context",
                             "text": "No documented, independent source about the cause of this change is available "
                                     "to the tool."})

    # A documented product change and a known event can coincide: show both side by side, no winner.
    tie = applies["R1"] and (applies["R2"] or applies["R3"])
    coinciding = []
    if tie:
        for r in order:
            if applies[r]:
                cat = next(x["category"] for x in RULES if x["rule"] == r)
                coinciding.append({"category": cat, "label": CATEGORY_LABELS[cat], "rule": r, "evidence": evidence[r]})

    alternatives = []
    for r in order:
        if applies[r] and r != chosen and not tie:
            cat = next(x["category"] for x in RULES if x["rule"] == r)
            alternatives.append({"category": cat, "label": CATEGORY_LABELS[cat], "rule": r, "evidence": evidence[r]})
    if chosen != "R4":
        alternatives.append({"category": "cause_undetermined", "label": CATEGORY_LABELS["cause_undetermined"],
                             "rule": "R4", "evidence": [{"code": "consistency_not_proof",
                                                         "text": "The evidence fits this category but does not prove "
                                                                 "it; other causes remain possible."}]})
    if analysis["request"]["variable_id"] == "no2_tropo" and chosen == "R4":
        alternatives.append({"category": "consistent_with_human_influence",
                             "label": CATEGORY_LABELS["consistent_with_human_influence"], "rule": None,
                             "evidence": [{"code": "no2_sources",
                                           "text": "Major sources of tropospheric NO2 include combustion, soil "
                                                   "emissions and lightning, so human activity is one possible "
                                                   "explanation; the data alone cannot separate these sources.",
                                           "reference": {"title": "OMNO2 README Document",
                                                         "url": "https://acdisc.gesdisc.eosdis.nasa.gov/data/"
                                                                "Aura_OMI_Level3/OMNO2d.003/doc/README.OMNO2.pdf"}}]})

    event_titles = ", ".join(c["event"]["title"] for c in context)
    statements = {
        "possible_data_artifact": "This change may be related to a change in the data product, not to an event on the ground.",
        "consistent_with_natural_event": f"This change is consistent with a known natural event: {event_titles}.",
        "consistent_with_human_influence": f"This change is consistent with a known human-caused event: {event_titles}.",
        "cause_undetermined": "These data do not point to a specific cause for this change.",
    }
    statement = statements[category]
    if tie:
        statement = (f"This change coincides both with a documented change in the data product and with a known event "
                     f"({event_titles}); these data cannot tell which one explains it.")
    rules_checked = []
    for x in RULES:
        item = {"rule": x["rule"], "category": x["category"], "text": x["text"],
                "applies": applies.get(x["rule"], chosen == "R4")}
        if x["rule"] in ("R2", "R3") and not context:
            item["note"] = "No event in the curated list of known events matches this change."
        rules_checked.append(item)
    return {
        "category": category,
        "label": CATEGORY_LABELS[category],
        "statement": statement,
        "rule": chosen,
        "coinciding_explanations": coinciding,
        "known_events": [c["event"] for c in context],
        "evidence_for": evidence_for,
        "evidence_against": evidence_against,
        "alternatives": alternatives,
        "rules_checked": rules_checked,
        "how_classified": HOW_CLASSIFIED,
        "never_proof": True,
    }


def independent_causal_context(analysis: dict[str, Any]) -> list[dict[str, Any]]:
    """Documented, referenced context: events from the curated list matching this change (team decision 23:45).

    EONET deliberately does NOT feed this function: an event close in space and time from a general catalogue is
    an observation, not evidence (tasks 012/013).
    """
    cp = analysis["breaks"]["change_point"]
    out = []
    shift = (cp.get("shift") or {}).get("estimate")
    for m in known_events.match(analysis["request"]["variable_id"], cp["date"], analysis["location_resolved"], shift):
        sources = "; ".join(src["publisher"] for src in m["sources"])
        out.append({"kind": m["type"],
                    "text": f"Known event: {m['title']} ({m['dates']['as_described']}) Sources: {sources}.",
                    "reference": {"title": m["sources"][0]["title"], "url": m["sources"][0]["url"]},
                    "event": m})
    return out


# ---------------------------------------------------------------------------------------------
# Entry point (job handler body)
# ---------------------------------------------------------------------------------------------
INVESTIGABLE = ("detected", "inconclusive")


def precheck(analysis: dict[str, Any] | None, change_id: str) -> tuple[int, dict[str, Any]] | None:
    """Return an explicit error response, or None when the investigation can start."""
    if analysis is None:
        return 404, {"status": "not_found", "reason": "unknown_analysis"}
    cp = (analysis.get("breaks") or {}).get("change_point") or {}
    if cp.get("change_id") != change_id:
        return 400, {"status": "invalid_request", "errors": [{"field": "change_id",
                                                              "message": "change_id does not belong to this analysis"}]}
    if cp.get("status") not in INVESTIGABLE:
        return 200, {"status": "not_applicable", "reason": "no_abrupt_change", "change_status": cp.get("status")}
    return None


async def investigate(settings: Settings, store: StateStore, analysis: dict[str, Any], change_id: str,
                      on_stage=None) -> dict[str, Any]:
    if on_stage:
        on_stage("downloading")
    sp, ov, eo = await asyncio.gather(spatial_extent(settings, store, analysis),
                                      other_variables(settings, store, analysis),
                                      eonet_search(analysis))
    if on_stage:
        on_stage("computing")
    features = {"abruptness": abruptness(analysis), "persistence": persistence(analysis),
                "spatial_extent": sp, "other_variables": ov}
    cp = analysis["breaks"]["change_point"]
    investigation_id = new_id("i")
    result = {
        "investigation_id": investigation_id,
        "status": "complete",
        "analysis_id": analysis["analysis_id"],
        "change_id": change_id,
        "change": {"date": cp["date"], "status": cp["status"], "shift": cp["shift"], "p_value": cp["p_value"]},
        "request": analysis["request"],
        "features": features,
        "product_boundaries": {"status": "ok", "near_change": analysis["breaks"].get("near_product_boundary", [])},
        "eonet": eo,
        "conclusion": classify(analysis, features, eo),
        "known_events_checked": {"list_version": known_events.load_events()["list_version"],
                                 "events_in_list": len(known_events.load_events()["events"]),
                                 "match_rules": known_events.MATCH_RULES},
        "processing_version": PROCESSING_VERSION,
    }
    store.put_investigation(investigation_id, analysis["analysis_id"], change_id, result)
    return result
