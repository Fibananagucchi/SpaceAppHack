# NASA Space Apps Challenge 2026 — Be An Earth System Trend Detective!

_Project description will be added once the team approves the concept._

## Status

Development steps 1–4. Step 1: trend analysis for a point. `POST /api/v1/analyses` returns a real NASA monthly series for one of seven variables, its rate of change (Sen's slope with a 95 % confidence interval) and three significance tests (Mann-Kendall with autocorrelation correction, OLS t-test with effective sample size, Seasonal Kendall on raw data). Step 2 adds a first look at abrupt changes: a Pettitt change-point test whose result is classified as a step, a gradual change or inconclusive (BIC comparison of a step and a straight line), robust outlier flags, and documented product boundaries (version, calibration, forcing or instrument changes) so that a change of data product is not mistaken for an event. Step 3 adds trend maps of Europe for all seven variables (Sen's slope and Mann-Kendall per grid cell, significance controlled with the Benjamini-Hochberg false discovery rate), area analyses (instant inside Europe from the prepared data cube, a background job via NASA Harmony elsewhere) and re-analysis for any chosen period. Step 4 adds the investigation of a possible abrupt change: abruptness, persistence, spatial extent (neighbouring grid cells) and other variables, NASA EONET events as a separate observation, and a transparent conclusion in four categories (possible data artifact, consistent with a natural event, consistent with human influence, cause undetermined; never 'proven'). A natural or human category needs a match with a short curated list of known events, each linked to its NASA, USGS, ESA, Copernicus or JRC source (`GET /api/v1/known-events`); when a documented product boundary and a known event coincide, both are shown side by side. MODIS vegetation greenness and land surface temperature are available for any point as a background job with cache. The backend never shows invented, interpolated or placeholder data values: a missing month is `null` with a reason.

## Repository layout

| Path | Contents |
|---|---|
| `backend/app/` | FastAPI service: API contract v1.1 under `/api/v1`, built frontend under `/` |
| `backend/pipelines/europe_cube.py` | Downloads real monthly grids for Europe from NASA GES DISC (cloud OPeNDAP) and assembles the data cube |
| `backend/pipelines/europe_maps.py` | Computes the Europe trend maps (format map-1.2) from the cube |
| `data/prepared/maps/europe/` | Prepared trend maps (gzip JSON) computed from real data, shipped with the image |
| `backend/tests/` | Tests (pytest) |
| `frontend/` | Web interface (built into `frontend/dist/`) |
| `Dockerfile` | One container: frontend build stage + Python runtime |
| `deploy/` | Google Cloud Run deployment guide and scripts |

## Run locally (Python 3.12)

1. Create `.env` from `.env.example` and put your NASA Earthdata token in it (`EARTHDATA_TOKEN=...`). `.env` is ignored by git.
2. Install dependencies and start the service:
   ```bash
   python -m venv .venv
   .venv/Scripts/python -m pip install -r backend/requirements-dev.txt     # Windows
   # .venv/bin/python -m pip install -r backend/requirements-dev.txt       # macOS / Linux
   .venv/Scripts/python -m uvicorn backend.app.main:app --reload
   ```
3. Open <http://127.0.0.1:8000/api/v1/health> (add `?deep=true` for live checks of NASA services) and <http://127.0.0.1:8000/api/docs> for the API schema.
4. Run the tests: `.venv/Scripts/python -m pytest backend/tests -q`.

## Run locally with Docker

```bash
docker build -t trend-detective .
docker run --rm -p 8080:8080 --env-file .env trend-detective
```
Then open <http://127.0.0.1:8080/api/v1/health>.

## Build the Europe data cube locally

```bash
.venv/Scripts/python -m backend.pipelines.europe_cube                    # MERRA-2 T2M, GPM IMERG, GLDAS, AIRS
.venv/Scripts/python -m backend.pipelines.europe_cube --products omi_no2 # OMI NO2 (daily granules, slower)
.venv/Scripts/python -m backend.pipelines.europe_maps                    # trend maps from the cube
```
Raw subsets go to `data/raw/` and assembled cubes to `data/runtime/cube/europe/`. Both are ignored by git. Downloads resume where they stopped.

## Deploy

See [`deploy/README.md`](deploy/README.md) (Google Cloud Run, Secret Manager, Cloud Storage).

## Resources

The full list of data sets, services and libraries will be added here before submission.
