"""Catalog of the seven starting variables (team decision 14.11 13:13).

This module holds product *metadata* only (names, versions, DOIs, grids, coverage).
Coverage dates were checked against NASA services on 2026-11-14 (task 002) and can
move forward as providers publish new granules. No data values live here.

Product boundaries are added only together with a reference to the product documentation
(contract v1.1, section 5.5 item 6); see PRODUCT_BOUNDARIES below.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

COVERAGE_CHECKED_AT = "2026-11-14"

# Capabilities in step 1: live point analyses; areas (step 3) and maps (step 3) are explicit.
CAPABILITIES = {"point": "live", "area": "not_implemented", "map_europe": "not_implemented"}

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
        "processing": {"unit_conversion": "monthly mean rate in mm/hr (file attribute) x 24 x days in month", "aggregation": None},
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
        "processing": {"unit_conversion": "monthly mean rate in kg m-2 s-1 x 86400 x days in month (GLDAS-2 README)", "aggregation": None},
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
        # GLDAS-2 README: monthly "_acc" values are the average 3-hour accumulation over the month.
        "processing": {"unit_conversion": "monthly mean 3-hour accumulation in kg m-2 x 8 x days in month (GLDAS-2 README)",
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

# ---------------------------------------------------------------------------------------------
# Product boundaries — ONLY changes stated in product documentation (task 009).
# Each entry names the document; descriptions are short paraphrases, not quotations.
# ---------------------------------------------------------------------------------------------
_MERRA2_FILESPEC = {"title": "GMAO Office Note No. 9: MERRA-2 File Specification (section on file names and streams)",
                    "url": "https://gmao.gsfc.nasa.gov/media/publications/zbly36ziNFDFbmYmvhQeVqPhUo/Bosilovich785.pdf"}
_IMERG_TECHDOC = {"title": "IMERG Technical Documentation (13 July 2023)",
                  "url": "https://arthurhou.pps.eosdis.nasa.gov/Documents/IMERG_TechnicalDocumentation_final.pdf"}
_GLDAS_README = {"title": "README for NASA GLDAS Version 2 Data Products (GES DISC)",
                 "url": "https://docserver.gesdisc.eosdis.nasa.gov/public/project/hydrology/README_GLDAS2.pdf"}
_OMNO2_README = {"title": "OMNO2 README Document (OMI NO2 algorithm team), section 2.4 Row anomaly",
                 "url": "https://acdisc.gesdisc.eosdis.nasa.gov/data/Aura_OMI_Level3/OMNO2d.003/doc/README.OMNO2.pdf"}
_AIRS_L3_GUIDE = {"title": "AIRS Version 7 Level 3 Product User Guide (section 1.1)",
                  "url": "https://docserver.gesdisc.eosdis.nasa.gov/public/project/AIRS/V7_L3_User_Guide.pdf"}

_MERRA2_BOUNDARIES = [
    {"boundary_id": f"merra2_stream_{stream}", "date": date, "kind": "processing_stream",
     "title": f"MERRA-2 production stream {stream} begins",
     "description": (f"MERRA-2 was produced in four separate production streams, each started from its own "
                     f"initial conditions after a one-year spin-up; files from {date} onward belong to stream "
                     f"{stream} (prefix MERRA2_{stream}00)."),
     "reference": _MERRA2_FILESPEC}
    for stream, date in ((2, "1992-01"), (3, "2001-01"), (4, "2011-01"))
]
_IMERG_BOUNDARIES = [
    {"boundary_id": "imerg_v07_gpm_era", "date": "2014-06", "kind": "calibration_era",
     "title": "IMERG switches from TRMM-era to GPM-era calibration",
     "description": ("IMERG V07 uses TRMM calibrations and TRMM-era satellite constellation data through May 2014, "
                     "and GPM calibrations and GPM-era constellation data from 1 June 2014."),
     "reference": _IMERG_TECHDOC},
]
_GLDAS21_BOUNDARIES = [
    {"boundary_id": "gldas21_agrmet_radiation", "date": "2001-03", "kind": "forcing_change",
     "title": "GLDAS-2.1 adds AGRMET radiation forcing",
     "description": ("GLDAS-2.1 was forced with GDAS and GPCP data only from January 2000 to February 2001; "
                     "AGRMET radiation fields were added from 1 March 2001."),
     "reference": _GLDAS_README},
    {"boundary_id": "gldas21_galwem_radiation", "date": "2025-06", "kind": "forcing_change",
     "title": "GLDAS-2.1 switches radiation forcing to GALWEM",
     "description": ("After the WWMCA cloud analysis behind the AGRMET radiation became unavailable, GLDAS-2.1 "
                     "switched to GALWEM radiation fields from 9 June 2025."),
     "reference": _GLDAS_README},
]
_OMI_BOUNDARIES = [
    {"boundary_id": "omi_row_anomaly_start", "date": "2007-06", "kind": "instrument_event",
     "title": "OMI row anomaly begins",
     "description": ("From 25 June 2007 an anomaly began to affect some OMI detector rows; affected measurements "
                     "are excluded (set to fill values), which reduces daily coverage."),
     "reference": _OMNO2_README},
    {"boundary_id": "omi_row_anomaly_expansion", "date": "2008-05", "kind": "instrument_event",
     "title": "OMI row anomaly expands",
     "description": "From 11 May 2008 further cross-track positions of OMI were affected by the row anomaly.",
     "reference": _OMNO2_README},
]

PRODUCT_BOUNDARIES: dict[str, list[dict[str, Any]]] = {
    "t2m": _MERRA2_BOUNDARIES,
    "precip": _IMERG_BOUNDARIES,
    "soil_moisture": _GLDAS21_BOUNDARIES,
    "evapotranspiration": _GLDAS21_BOUNDARIES,
    "surface_runoff": _GLDAS21_BOUNDARIES,
    "airs_surface_air_temp": [],
    "no2_tropo": _OMI_BOUNDARIES,
}
BOUNDARY_REVIEW: dict[str, dict[str, Any]] = {
    "t2m": {"checked_at": "2026-11-14", "references": [_MERRA2_FILESPEC],
            "note": "Single granules reprocessed later (file prefix MERRA2_401) are corrections, not boundaries."},
    "precip": {"checked_at": "2026-11-14", "references": [_IMERG_TECHDOC], "note": None},
    "soil_moisture": {"checked_at": "2026-11-14", "references": [_GLDAS_README], "note": None},
    "evapotranspiration": {"checked_at": "2026-11-14", "references": [_GLDAS_README], "note": None},
    "surface_runoff": {"checked_at": "2026-11-14", "references": [_GLDAS_README], "note": None},
    "airs_surface_air_temp": {"checked_at": "2026-11-14", "references": [_AIRS_L3_GUIDE],
                              "note": ("This is the AIRS-only product, which the guide describes as covering the full "
                                       "mission with greater continuity; the 2016 AMSU-A2 failure affects only the "
                                       "AIRS+AMSU products. No boundary is recorded.")},
    "no2_tropo": {"checked_at": "2026-11-14", "references": [_OMNO2_README], "note": None},
}


def product_boundaries(variable_id: str) -> list[dict[str, Any]]:
    return deepcopy(PRODUCT_BOUNDARIES.get(variable_id, []))


def public_variable(variable: dict[str, Any], capabilities: dict[str, str]) -> dict[str, Any]:
    """Catalog entry as returned by the API (no internal fields)."""
    entry = {k: deepcopy(v) for k, v in variable.items() if not k.startswith("_")}
    entry["definition"] = None  # texts come from design/team; null until provided
    entry["coverage"]["checked_at"] = COVERAGE_CHECKED_AT
    entry["capabilities"] = dict(capabilities)
    entry["product_boundaries"] = product_boundaries(variable["variable_id"])  # documented only
    entry["boundary_review"] = deepcopy(BOUNDARY_REVIEW.get(variable["variable_id"]))
    return entry


def list_public_variables() -> list[dict[str, Any]]:
    return [public_variable(v, CAPABILITIES) for v in _VARIABLES]


def get_variable(variable_id: str) -> dict[str, Any] | None:
    for v in _VARIABLES:
        if v["variable_id"] == variable_id:
            return v
    return None
