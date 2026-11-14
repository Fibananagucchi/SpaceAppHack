"""Request models for contract v1.1 (validation only; no values are produced here)."""

from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ..catalog import VARIABLE_IDS

_MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


class PointLocation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["point"]
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class AreaLocation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["area"]
    bbox: tuple[float, float, float, float] = Field(description="[west, south, east, north], WGS84 degrees")

    @field_validator("bbox")
    @classmethod
    def _check_bbox(cls, bbox: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
        west, south, east, north = bbox
        if not (-180 <= west <= 180 and -180 <= east <= 180 and -90 <= south <= 90 and -90 <= north <= 90):
            raise ValueError("bbox values out of range")
        if not west < east:
            raise ValueError("bbox west must be less than east (areas crossing the antimeridian are not supported)")
        if not south < north:
            raise ValueError("bbox south must be less than north")
        return bbox


Location = Annotated[PointLocation | AreaLocation, Field(discriminator="type")]


class Period(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: str
    end: str

    @field_validator("start", "end")
    @classmethod
    def _check_month(cls, value: str) -> str:
        if not _MONTH.match(value):
            raise ValueError("month must be formatted as YYYY-MM")
        return value

    @model_validator(mode="after")
    def _check_order(self) -> "Period":
        if self.start > self.end:
            raise ValueError("period start must not be after period end")
        return self


class AnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    variable_id: str
    location: Location
    period: Period | None = None

    @field_validator("variable_id")
    @classmethod
    def _known_variable(cls, value: str) -> str:
        if value not in VARIABLE_IDS:
            raise ValueError(f"unknown variable_id; known: {', '.join(VARIABLE_IDS)}")
        return value


class InvestigationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    analysis_id: str = Field(min_length=1, max_length=64)
    change_id: str = Field(min_length=1, max_length=64)
