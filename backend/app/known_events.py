"""Curated list of known events (team decision 14.11 23:45) and the transparent matching rules.

A change matches an event when ALL three rules hold:
  1. variable — the analysed variable is one of the event's listed variables;
  2. time     — the change month (first month after the change) lies in the event's match window
                (the documented dates plus a short tolerance for monthly data);
  3. place    — the grid-cell centre of a point lies inside the event box, or an analysed area overlaps the
                box; events with global scope match any place;
  4. direction — where the source states the direction of the change for this variable (warmer during a heat
                wave, less NO2 during a lockdown), the detected shift must go the same way; otherwise the
                direction is not checked.
A match gives "Consistent with a natural event" / "Consistent with human influence" with the event's
sources. It never states that the event caused the change. EONET does not feed this list.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

EVENTS_FILE = Path(__file__).resolve().parent / "data" / "known_events.json"

MATCH_RULES = [
    "variable: the analysed variable is one of the variables listed for the event",
    "time: the change month (first month after the change) is inside the event's match window",
    "place: the grid-cell centre lies inside the event's box, or the analysed area overlaps it; "
    "global events match any place",
    "direction: where the source states which way this variable changed (for example warmer during a heat wave), "
    "the detected shift must go the same way; otherwise direction is not checked",
]


@lru_cache(maxsize=1)
def load_events() -> dict[str, Any]:
    with open(EVENTS_FILE, encoding="utf-8") as f:
        data = json.load(f)
    for event in data["events"]:
        assert event["type"] in ("natural", "human"), event["event_id"]
        assert event["sources"] and all(s["url"].startswith("https://") for s in event["sources"]), event["event_id"]
        if event["area"]["scope"] == "box":
            west, south, east, north = event["area"]["bbox"]
            assert west < east and south < north, event["event_id"]
        directions = event.get("expected_direction", {})
        assert set(directions) <= set(event["variables"]), event["event_id"]
        assert all(d in ("increase", "decrease") for d in directions.values()), event["event_id"]
    return data


def _point_in_box(lat: float, lon: float, bbox: list[float]) -> bool:
    west, south, east, north = bbox
    return south <= lat <= north and west <= lon <= east


def _boxes_overlap(a: list[float], b: list[float]) -> bool:
    return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]


def match(variable_id: str, change_month: str, location: dict[str, Any],
          shift: float | None = None) -> list[dict[str, Any]]:
    """Events from the curated list that match this change by variable, time, place and (where stated) direction."""
    matches = []
    for event in load_events()["events"]:
        if variable_id not in event["variables"]:
            continue
        window = event["match_window"]
        if not window["start"] <= change_month <= window["end"]:
            continue
        area = event["area"]
        if area["scope"] == "global":
            place = "global event"
        elif location["type"] == "point":
            cell = location["grid_cell"]
            if not _point_in_box(cell["center_lat"], cell["center_lon"], area["bbox"]):
                continue
            place = "grid-cell centre inside the event area"
        else:
            if not _boxes_overlap(location["requested"]["bbox"], area["bbox"]):
                continue
            place = "analysed area overlaps the event area"
        stated = event.get("expected_direction", {}).get(variable_id)
        if stated is None:
            direction = "not stated by the source; not checked"
        else:
            observed = None if not shift else ("increase" if shift > 0 else "decrease")
            if observed != stated:
                continue
            direction = f"{stated}, as stated by the source"
        matches.append({
            "event_id": event["event_id"], "title": event["title"], "type": event["type"], "kind": event["kind"],
            "dates": event["dates"], "match_window": window, "area": area, "sources": event["sources"],
            "expected_direction": event.get("expected_direction", {}),
            "match": {"variable": variable_id, "change_month": change_month, "place": place, "direction": direction},
        })
    return matches


def public_list() -> dict[str, Any]:
    data = load_events()
    events = []
    for event in data["events"]:
        area = event["area"]
        marker = None
        if area["scope"] == "box":
            west, south, east, north = area["bbox"]
            marker = {"lat": round((south + north) / 2, 3), "lon": round((west + east) / 2, 3),
                      "rule": "centre of the event's approximate area box (for a map marker only)"}
        events.append({**event, "marker": marker})
    return {"status": "ok", "list_version": data["list_version"], "compiled_at": data["compiled_at"],
            "reviewed_by_team": data["reviewed_by_team"], "note": data["note"], "match_rules": MATCH_RULES,
            "events": events}
