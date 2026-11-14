"""Catalog of the seven starting variables (team decision 14.11 13:13).

This module holds product *metadata* only (names, versions, DOIs, grids, coverage).
Coverage dates were checked against NASA services on 2026-11-14 (task 002) and can
move forward as providers publish new granules. No data values live here.

Product boundaries are left empty on purpose: a boundary is added only together with
a reference to the product documentation (contract v1.1, section 5.5 item 6).
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

COVERAGE_CHECKED_AT = "2026-11-14"

# Capabilities in step 0: nothing is computed yet, every capability is explicit.
STEP0_CAPABILITIES = {"point": "not_implemented", "area": "not_implemented", "map_europe": "not_implemented"}

_VARIABLES: list[dict[str, Any]] = [
    {
        "variable_id": "t2m",
        "label": "Air temperature at 2 m",
        "unit": "°C",
        "trend_unit": "°C per decade",
        "source": {
            "mission_or_model": "MERRA-2 reanalysis",
            "provider": "NASA GES DISC",
            "product": "M2IMNXASM",
            "version": "5.12.4",
            "doi": "10.5067/5ESKGQTZG7FO",
        },
        "native_resolution": {"lat_deg": 0.5, "lon_deg": 0.625, "time": "monthly"},
        "coverage": {"start": "1980-01", "end": "2026-09", "spatial": "global", "surface": "land_and_ocean"},
        "processing": {"unit_conversion": "K - 273.15", "aggregation": None},
        "_internal": {
            "collection_concept_id": "C1276812823-GES_DISC",
            "giovanni_id": "M2IMNXASM_5_12_4_T2M",
            "dataset_path": "/T2M",
            "source_unit": "K",
        },
    },
    {
        "variable_id": "precip",
        "label": "Precipitation",
        "unit": "mm/month",
        "trend_unit": "mm/month per decade",
        "source": {
            "mission_or_model": "GPM IMERG (multi-satellite, gauge-calibrated)",
            "provider": "NASA GES DISC",
            "product": "GPM_3IMERGM",
            "version": "07",
            "doi": "10.5067/GPM/IMERG/3B-MONTH/07",
        },
        "native_resolution": {"lat_deg": 0.1, "lon_deg": 0.1, "time": "monthly"},
        "coverage": {"start": "1998-01", "end": "2025-09", "spatial": "global", "surface": "land_and_ocean"},
        "processing": {"unit_conversion": "mm/hr x 24 x days in month", "aggregation": None},
        "_internal": {
            "collection_concept_id": "C2723754851-GES_DISC",
            "giovanni_id": "GPM_3IMERGM_07_precipitation",
            "dataset_path": "/Grid/precipitation",
            "source_unit": "mm/hr",
        },
    },
    {
        "variable_id": "soil_moisture",
        "label": "Soil moisture, top 10 cm",
        "unit": "kg m-2",
        "trend_unit": "kg m-2 per decade",
        "source": {
            "mission_or_model": "GLDAS-2.1 Noah land surface model",
            "provider": "NASA GES DISC",
            "product": "GLDAS_NOAH025_M",
            "version": "2.1",
            "doi": "10.5067/SXAVCZFAQLNO",
        },
        "native_resolution": {"lat_deg": 0.25, "lon_deg": 0.25, "time": "monthly"},
        "coverage": {"start": "2000-01", "end": "2026-07", "spatial": "global land (60S-90N)", "surface": "land"},
        "processing": {"unit_conversion": None, "aggregation": None},
        "_internal": {
            "collection_concept_id": "C1342986036-GES_DISC",
            "giovanni_id": "GLDAS_NOAH025_M_2_1_SoilMoi0_10cm_inst",
            "dataset_path": "/SoilMoi0_10cm_inst",
            "source_unit": "kg m-2",
        },
    },
    {
        "variable_id": "evapotranspiration",
        "label": "Evapotranspiration",
        "unit": "mm/month",
        "trend_unit": "mm/month per decade",
        "source": {
            "mission_or_model": "GLDAS-2.1 Noah land surface model",
            "provider": "NASA GES DISC",
            "product": "GLDAS_NOAH025_M",
            "version": "2.1",
            "doi": "10.5067/SXAVCZFAQLNO",
        },
        "native_resolution": {"lat_deg": 0.25, "lon_deg": 0.25, "time": "monthly"},
        "coverage": {"start": "2000-01", "end": "2026-07", "spatial": "global land (60S-90N)", "surface": "land"},
        "processing": {"unit_conversion": "kg m-2 s-1 x 86400 x days in month", "aggregation": None},
        "_internal": {
            "collection_concept_id": "C1342986036-GES_DISC",
            "giovanni_id": "GLDAS_NOAH025_M_2_1_Evap_tavg",
            "dataset_path": "/Evap_tavg",
            "source_unit": "kg m-2 s-1",
        },
    },
    {
        "variable_id": "surface_runoff",
        "label": "Surface runoff",
        "unit": "mm/month",
        "trend_unit": "mm/month per decade",
        "source": {
            "mission_or_model": "GLDAS-2.1 Noah land surface model",
            "provider": "NASA GES DISC",
            "product": "GLDAS_NOAH025_M",
            "version": "2.1",
            "doi": "10.5067/SXAVCZFAQLNO",
        },
        "native_resolution": {"lat_deg": 0.25, "lon_deg": 0.25, "time": "monthly"},
        "coverage": {"start": "2000-01", "end": "2026-07", "spatial": "global land (60S-90N)", "surface": "land"},
        # The monthly meaning of the "_acc" field must be confirmed in the GLDAS README
        # before any value is shown (step 1). Until then the conversion is marked unverified.
        "processing": {"unit_conversion": "unverified: monthly mean of 3-hourly accumulations (to confirm in README)",
                       "aggregation": None},
        "_internal": {
            "collection_concept_id": "C1342986036-GES_DISC",
            "giovanni_id": "GLDAS_NOAH025_M_2_1_Qs_acc",
            "dataset_path": "/Qs_acc",
            "source_unit": "kg m-2",
        },
    },
    {
        "variable_id": "airs_surface_air_temp",
        "label": "Surface air temperature (satellite, daytime overpass)",
        "unit": "°C",
        "trend_unit": "°C per decade",
        "source": {
            "mission_or_model": "AIRS on Aqua (satellite retrieval)",
            "provider": "NASA GES DISC",
            "product": "AIRS3STM",
            "version": "7.0",
            "doi": "10.5067/UBENJB9D3T2H",
        },
        "native_resolution": {"lat_deg": 1.0, "lon_deg": 1.0, "time": "monthly"},
        "coverage": {"start": "2002-09", "end": "2026-10", "spatial": "global", "surface": "land_and_ocean"},
        "processing": {"unit_conversion": "K - 273.15", "aggregation": None},
        "_internal": {
            "collection_concept_id": "C1701805662-GES_DISC",
            "giovanni_id": "AIRS3STM_7_0_SurfAirTemp_A",
            "dataset_path": "/ascending/Data_Fields/SurfAirTemp_A",
            "source_unit": "K",
        },
    },
    {
        "variable_id": "no2_tropo",
        "label": "Tropospheric NO2 column",
        "unit": "1e15 molecules/cm2",
        "trend_unit": "1e15 molecules/cm2 per decade",
        "source": {
            "mission_or_model": "OMI on Aura (satellite retrieval)",
            "provider": "NASA GES DISC",
            "product": "OMNO2d",
            "version": "003",
            "doi": "10.5067/Aura/OMI/DATA3007",
        },
        "native_resolution": {"lat_deg": 0.25, "lon_deg": 0.25, "time": "daily"},
        "coverage": {"start": "2004-10", "end": "2026-03", "spatial": "global", "surface": "land_and_ocean"},
        "processing": {
            "unit_conversion": "molecules/cm2 / 1e15",
            "aggregation": "daily to monthly mean; a month is missing if fewer than 10 valid days",
        },
        "_internal": {
            "collection_concept_id": "C1266136111-GES_DISC",
            "giovanni_id": "OMNO2d_003_ColumnAmountNO2TropCloudScreened",
            "dataset_path": "/HDFEOS/GRIDS/ColumnAmountNO2/Data_Fields/ColumnAmountNO2TropCloudScreened",
            "source_unit": "molecules/cm2",
        },
    },
]

VARIABLE_IDS: tuple[str, ...] = tuple(v["variable_id"] for v in _VARIABLES)


def public_variable(variable: dict[str, Any], capabilities: dict[str, str]) -> dict[str, Any]:
    """Catalog entry as returned by the API (no internal fields)."""
    entry = {k: deepcopy(v) for k, v in variable.items() if not k.startswith("_")}
    entry["definition"] = None  # texts come from design/team; null until provided
    entry["coverage"]["checked_at"] = COVERAGE_CHECKED_AT
    entry["capabilities"] = dict(capabilities)
    entry["product_boundaries"] = []  # only documented boundaries with a reference are added
    return entry


def list_public_variables() -> list[dict[str, Any]]:
    return [public_variable(v, STEP0_CAPABILITIES) for v in _VARIABLES]


def get_variable(variable_id: str) -> dict[str, Any] | None:
    for v in _VARIABLES:
        if v["variable_id"] == variable_id:
            return v
    return None
