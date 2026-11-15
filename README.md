# Earth System Trend Detective

_Working name. Built for the NASA Space Apps Challenge 2026 challenge
"Be An Earth System Trend Detective!"._

Pick a place on Earth and one of nine NASA variables. The tool tells you, from real NASA data only:

1. **Is it changing, and how fast?** The rate of change with a confidence interval and three significance tests.
2. **Did something change abruptly?** A possible step change, how sure the data are about it, and what
   it is consistent with: a documented change of the data product, a documented natural event, documented
   human influence, or nothing the data can point to. It never claims to have proven a cause.

A globe of grid cells shows yearly anomalies for the whole world (2° cells; Europe in more detail on 1° cells), and a
time strip lets you scrub or play through the years. A click anywhere runs the full analysis live for that exact point.

---

## What it does

### Variables
| Variable | NASA product | Native grid | Record used | How the app reads it |
|---|---|---|---|---|
| Air temperature at 2 m | MERRA-2 M2IMNXASM v5.12.4 (reanalysis) | 0.5° × 0.625° | 1980-01 – 2026-09 | Europe cube; Giovanni time series elsewhere |
| Precipitation | GPM IMERG Final monthly V07 (GPM_3IMERGM) | 0.1° | 1998-01 – 2025-09 | Europe cube; Giovanni elsewhere |
| Soil moisture (top 10 cm) | GLDAS-2.1 Noah monthly 0.25° | 0.25° | 2000-01 – 2026-07 | Europe cube; Giovanni elsewhere |
| Evapotranspiration | GLDAS-2.1 Noah monthly 0.25° | 0.25° | 2000-01 – 2026-07 | Europe cube; Giovanni elsewhere |
| Surface runoff | GLDAS-2.1 Noah monthly 0.25° | 0.25° | 2000-01 – 2026-07 | Europe cube; Giovanni elsewhere |
| Surface air temperature (satellite, daytime overpass) | AIRS v7 L3 monthly (AIRS3STM, Aqua) | 1° | 2002-09 – 2026-10 | Europe cube; Giovanni elsewhere |
| Tropospheric NO₂ column | OMI OMNO2d v003 (Aura), daily → monthly | 0.25° | 2004-10 – 2026-03 | Europe cube; Giovanni elsewhere |
| Vegetation greenness (NDVI) | MODIS Terra MOD13C2 v061 | 0.05° | 2000-02 – 2026-10 | One-pixel series from NASA LP DAAC cloud OPeNDAP (background job, cached 7 days) |
| Daytime land surface temperature | MODIS Terra MOD11C3 v061 | 0.05° | 2000-02 – 2026-10 | As NDVI |

"Europe cube" means real monthly grids for Europe (25° W – 45° E, 34° N – 72° N), downloaded from NASA GES DISC
cloud OPeNDAP and stored by the service. Without the cube, points and areas in Europe use the same live NASA services as
everywhere else (Giovanni, Harmony); the prepared maps and globe frames still work.

### The interface
- **One rotating globe.** Colour shows the selected variable's yearly anomaly or full-period trend: the world on 2° cells,
  Europe in more detail on 1° cells. Diverging "cork" colour scale (Scientific Colour Maps), zero at the neutral midpoint,
  numeric limits taken from the data. Cells without data stay uncoloured.
- **Click anywhere.** The exact coordinates of the click are analysed live on the product's native grid. The card leads
  with the answer (direction and rate, or the mode 2 category); **Evidence** opens the monthly chart, the tests, the change
  marker, documented events and the data passport.
- **Time strip.** Yearly values of the selected place and of its neighbouring cells; scrub or press Play to step through
  the real yearly frames on the globe (no in-between frames are generated).
- **Compare two places (A ↔ B)** with two native analyses, and **Place & period** for exact coordinates, rectangular
  areas, a chosen period and the MODIS variables (point only, background job).
<!-- Sync after 018-shader: if the WebGL "Smooth / Cells" raster view ships, describe it here in one line
     (display-only colour blending between real cells; numbers and clicks use the real cells). -->

### Mode 1 — trends
- **Any point or rectangular area:**
  - **Points:** a live monthly series. Each month is converted to an anomaly against the same calendar month,
    and a yearly series is computed from the monthly anomalies.
  - **Areas inside Europe:** answered instantly from the cube.
  - **Areas elsewhere:** a background job using NASA Harmony's Giovanni averaging service.
- **Rate of change:** Sen's slope per decade with a 95 % confidence interval (Gilbert).
- **Significance:** three tests, each shown with its own result:
  - Mann-Kendall with the Hamed-Rao autocorrelation correction;
  - OLS t-test with an effective sample size;
  - Seasonal Kendall on the raw monthly values.
- **Sufficiency:** a series is tested only with at least 120 valid months and at least 66 % valid; otherwise the app
  says why it did not test.
- **Any period:** the analysis can be re-run for any period the user picks (time aperture).
- **Europe trend maps at native resolution** for all seven gridded variables (API, `GET /api/v1/maps/europe`; the globe
  itself uses the 1° and 2° layers below):
  - Sen's slope and Mann-Kendall per native grid cell;
  - significance controlled across the map with the Benjamini-Hochberg false discovery rate (q < 0.05);
  - IMERG is mapped on 0.5° aggregates.
- **Europe globe frames:**
  - yearly anomalies for all seven gridded variables on one shared 1° grid, so the dots stay in place when the variable changes;
  - a year counts only with at least 10 valid months (6 for OMI NO₂, which often lacks valid winter months in
    central and northern Europe); each year reports how many months it is based on;
  - the time strip shows the selected place and its neighbouring 1° cells;
  - a full-period trend layer on the same 1° grid: the monthly anomalies of the native cells are averaged into each 1° cell
    first, and the trend and the false discovery rate are computed on that series (not an average of finished trends).
- **World globe layer** (2° cells, 90 × 180): the same yearly frames and full-period trend for the whole globe, by the same
  method, with the false discovery rate controlled over all cells of the world. To avoid downloading the full native
  resolution of the planet, the native cells are sampled with a stride (for example every second MERRA-2 and GLDAS
  cell, every fifth IMERG cell): these are real native values, not interpolated. The sampling of each layer is in its metadata.
  `GET /api/v1/globe` says for each variable whether its world and Europe layers are ready; where the world layer is not
  ready, Europe still works and points anywhere use a live analysis.

### Mode 2 — abrupt changes
- **Possible change point:** Pettitt test (at least 24 months on each side).
  - A significant result is compared with a gradual trend (BIC, step vs straight line), so a smooth trend is not
    reported as a jump.
  - The result is a step, not distinguishable from the trend, inconclusive, or no change.
  - Outliers are flagged (robust z-score), never removed.
- **Investigation of a change:** these features are measured, never assumed:
  - abruptness;
  - persistence;
  - spatial extent (the same test in the 8 neighbouring cells);
  - behaviour of the other variables at the same place.
- **Four transparent categories**, chosen by ordered rules that the user can open
  ("How was this classified?"):
  1. **Possible data artifact.** The change lies within 12 months of a documented product change (MERRA-2 production
     streams, IMERG TRMM → GPM calibration, GLDAS-2.1 forcing changes, OMI row anomaly). Each boundary links to its documentation.
  2. **Consistent with a natural event.** The change matches an event in a short curated list by variable,
     time window, place and, where the source states it, direction.
  3. **Consistent with human influence.** The same for human-caused events.
  4. **Cause undetermined.** The data do not point to a cause.

  If a product boundary and a known event both fit, both are shown side by side and neither is treated as the answer.
- **Curated known events:** 10 events (for example the Kakhovka dam breach in 2023, Mount Pinatubo in 1991, the
  COVID-19 lockdowns in 2020, and the European heat waves and droughts of 2003, 2010, 2018 and 2022). Each event links to
  NASA, USGS, ESA, Copernicus or JRC pages (`GET /api/v1/known-events`).
- **NASA EONET:** events near the change are shown as a separate observation. They never choose the category.
- **Changes layer on the globe:** the same change-point rule runs in every globe cell (Europe 1°, world 2°) on the same
  aggregated series as the trend layer. Detected and inconclusive changes carry their month, shift and category by the
  same ordered rules (documented product boundary, known event, or undetermined; both shown when they coincide). A mark
  is a candidate to inspect, not a finding: Pettitt p-values are not corrected for testing many cells, and the change
  month is an estimate that can be off by a few months.
- **Wording:** always "consistent with", never "proven" (`never_proof: true` in every conclusion).

---

## Data honesty

- **Only real data reach the user.** No synthetic, interpolated or placeholder values in the API or in any number the
  interface shows. Synthetic data exist only in the test suites.
<!-- Sync after 018-shader: if the Smooth raster view ships, add: "The optional Smooth view blends colours between
     neighbouring cells for display only; every number, every click and the significance marks use the real cells." -->
- **A missing value is `null` with a reason** (for example `fill_value`, `outside_product_period`,
  `fewer_than_10_valid_months`). Gaps are never filled. "No data", "zero" and "the request failed" are different states.
- **Explicit states everywhere:** `no_data`, `not_ready`, `not_available`, `source_error` (with whether a retry makes
  sense), and job progress that counts real work (for example MODIS files checked).
- **Methods are documented with the result:** every analysis returns its climatology base period, unit
  conversion, aggregation rules and the version of the statistics code.
- **Coarser grids say so:** aggregated cells (IMERG 0.5° on the native maps, the 1° Europe and 2° world globe grids) say
  how they were built, which native cells were sampled and when an aggregate is valid.

## How it works

One container serves everything:
- **Backend:** FastAPI, under `/api/v1`. It talks to the NASA services with an Earthdata token kept on the server.
- **Web interface:** a built React app, under `/`.
- **Short-lived state:** jobs and the hot cache live in SQLite. Long requests (areas outside Europe, MODIS points,
  investigations) run as background jobs, and the interface follows their real progress.
- **Prepared real data:** native trend maps (`data/prepared/maps/europe/`), the Europe 1° globe frames and trend
  (`data/prepared/globe/europe/`) and the world 2° frames and trend (`data/prepared/globe/world/`) are computed from the
  Europe cube and the strided world cube and shipped with the image, so the globe works right after deployment.

## API overview

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/health?deep=true` | Service state; with `deep=true`, live checks of Giovanni, OPeNDAP and EONET |
| `GET /api/v1/variables` | The nine variables with sources, units, coverage and capabilities |
| `POST /api/v1/analyses` | Trend and change-point analysis for a point or area (immediate result or a job) |
| `GET /api/v1/analyses/{id}`, `GET /api/v1/jobs/{id}` | Stored analysis; job status and progress |
| `POST /api/v1/investigations`, `GET /api/v1/investigations/{id}` | Mode 2 investigation of a change and its conclusion |
| `GET /api/v1/maps/europe`, `GET /api/v1/maps/europe/{variable}` | Europe trend maps (format `map-1.2`) |
| `GET /api/v1/globe/europe`, `GET /api/v1/globe/europe/{variable}` | Yearly anomaly frames on the 1° globe grid (format `globe-1`) |
| `GET /api/v1/globe/europe/{variable}/trend` | Full-period trend on the same 1° grid (format `map-1.2`) |
| `GET /api/v1/globe` | Which globe domain (Europe 1°, World 2°) is ready for which variable |
| `GET /api/v1/globe/world/{variable}`, `.../trend`, `.../strip?lat=&lon=` | The same three layers on the 2° world grid |
| `GET /api/v1/globe/{europe,world}/{variable}/changes` | Possible abrupt change per globe cell with its category (format `changes-1`) |
| `GET /api/v1/globe/europe/{variable}/strip?lat=&lon=` | The selected 1° cell and its neighbours for the time strip |
| `GET /api/v1/known-events` | The curated list of known events, its sources and matching rules |

The interactive schema is at `/api/docs`.

## Run locally (Python 3.12)

1. Copy `.env.example` to `.env` and put your NASA Earthdata token in it (`EARTHDATA_TOKEN=...`).
   `.env` is ignored by git; never commit a token.
2. Install and start:
   ```bash
   python -m venv .venv
   .venv/Scripts/python -m pip install -r backend/requirements-dev.txt     # Windows
   # .venv/bin/python -m pip install -r backend/requirements-dev.txt       # macOS / Linux
   .venv/Scripts/python -m uvicorn backend.app.main:app --reload
   ```
3. Open <http://127.0.0.1:8000/api/v1/health?deep=true> and <http://127.0.0.1:8000/api/docs>.
   For the interface, build it once (`cd frontend && npm ci && npm run build`); the service then serves it at
   <http://127.0.0.1:8000/>. See [`frontend/README.md`](frontend/README.md) for the development server.
4. Tests: `.venv/Scripts/python -m pytest backend/tests -q`, and `npm test` in `frontend/`.

## Run locally with Docker

```bash
docker build -t trend-detective .
docker run --rm -p 8080:8080 --env-file .env trend-detective
```
Then open <http://127.0.0.1:8080/>.

## Build the data cubes, maps and globe layers

```bash
.venv/Scripts/python -m backend.pipelines.europe_cube                    # MERRA-2 T2M, GPM IMERG, GLDAS, AIRS
.venv/Scripts/python -m backend.pipelines.europe_cube --products omi_no2 # OMI NO2 (daily granules, slower)
.venv/Scripts/python -m backend.pipelines.europe_maps                    # trend maps from the cube
.venv/Scripts/python -m backend.pipelines.europe_globe --prepared        # yearly globe frames (+ copies shipped with the image)
.venv/Scripts/python -m backend.pipelines.europe_globe_trend --prepared  # full-period trend on the 1° globe grid
.venv/Scripts/python -m backend.pipelines.world_cube --with-layers       # world: strided download + 2° frames and trend
.venv/Scripts/python -m backend.pipelines.globe_changes --domain europe --prepared   # Changes layer (also --domain world)
```
Raw subsets go to `data/raw/` and the assembled cubes to `data/runtime/cube/europe/` and `data/runtime/cube/world/`;
both are ignored by git.
Downloads resume where they stopped. `europe_cube --with-maps` builds the maps, globe frames and globe trend after the cube.

## Repository layout

| Path | Contents |
|---|---|
| `backend/app/` | FastAPI service: API, statistics (`stats.py`, `breaks.py`, `annual.py`), mode 2 (`investigation.py`, `known_events.py`), NASA data access (`series.py`, `sources.py`) |
| `backend/app/data/known_events.json` | The curated list of known events with sources |
| `backend/pipelines/` | Europe and world data cubes, trend maps, globe frames and globe trend from real NASA data |
| `backend/tests/` | Backend tests (pytest); synthetic data only here |
| `data/prepared/` | Prepared real-data files shipped with the image (native trend maps; Europe 1° and world 2° globe frames and trend) |
| `frontend/` | Web interface (React + TypeScript, built with Vite) |
| `Dockerfile` | One container: frontend build stage + Python runtime |
| `deploy/` | Deployment guides: [Azure](deploy/azure.md) (current), [Google Cloud Run](deploy/README.md) (alternative) |
| `render.yaml` | Optional free backup of the same container on Render |

## Deploy

The public instance runs on Microsoft Azure. To update it after new commits, follow
[`deploy/azure.md`](deploy/azure.md). [`deploy/README.md`](deploy/README.md) describes the same container on Google Cloud Run.
[`render.yaml`](render.yaml) is a ready blueprint for an optional free backup on Render. Free services there sleep after
15 minutes without traffic.

## Known limitations

- The detailed 1° globe layer, the native-resolution trend maps and instant area answers cover Europe only. The world
  layer is coarser (2° cells from sampled native cells). Outside Europe every point or area analysis is live and takes longer.
- Mode 2 looks for one change in level per series. Short events (a lockdown, a heat wave, a flood) are peaks or dips
  and often do not show up as a step over the whole record. Narrowing the period around an event helps.
- The list of known events is short and hand-curated. A match means "consistent with", not "caused by".
- Each product has its own limits: reanalysis and land-model output are model data; AIRS is one daytime overpass;
  OMI NO₂ has the row anomaly and few valid winter months at high latitudes; MODIS points are a single 0.05° pixel.

---

## Resources

Space Apps asks that every resource be cited. Everything the product uses is listed here: data, services,
documentation, methods, event sources, libraries, geography and hosting.

### NASA data
| Dataset | Used for | Citation / link | Terms |
|---|---|---|---|
| MERRA-2 M2IMNXASM v5.12.4 (2 m air temperature) | Europe cube, maps, globe; points via Giovanni | [doi:10.5067/5ESKGQTZG7FO](https://doi.org/10.5067/5ESKGQTZG7FO) | NASA open data policy |
| GPM IMERG Final Run monthly V07 (GPM_3IMERGM) | Precipitation | [doi:10.5067/GPM/IMERG/3B-MONTH/07](https://doi.org/10.5067/GPM/IMERG/3B-MONTH/07) | NASA open data policy |
| GLDAS Noah monthly 0.25° v2.1 (GLDAS_NOAH025_M) | Soil moisture, evapotranspiration, surface runoff | [doi:10.5067/SXAVCZFAQLNO](https://doi.org/10.5067/SXAVCZFAQLNO) | NASA open data policy |
| AIRS v7 L3 monthly (AIRS3STM) | Surface air temperature (satellite) | [doi:10.5067/UBENJB9D3T2H](https://doi.org/10.5067/UBENJB9D3T2H) | NASA open data policy |
| OMI OMNO2d v003 | Tropospheric NO₂ (daily → monthly) | [doi:10.5067/Aura/OMI/DATA3007](https://doi.org/10.5067/Aura/OMI/DATA3007) | NASA open data policy |
| MODIS Terra MOD13C2 v061 | NDVI for any point | [doi:10.5067/MODIS/MOD13C2.061](https://doi.org/10.5067/MODIS/MOD13C2.061) | NASA open data policy |
| MODIS Terra MOD11C3 v061 | Daytime land surface temperature for any point | [doi:10.5067/MODIS/MOD11C3.061](https://doi.org/10.5067/MODIS/MOD11C3.061) | NASA open data policy |

### NASA services and APIs
| Service | Used for | Link | Access |
|---|---|---|---|
| NASA Giovanni in the Cloud — Time Series API | Point series (outside Europe, or when the cube is absent) | [api.giovanni.earthdata.nasa.gov](https://api.giovanni.earthdata.nasa.gov/) | Earthdata Login |
| NASA Harmony — Giovanni averaging service | Area-averaged series outside Europe | [harmony.earthdata.nasa.gov](https://harmony.earthdata.nasa.gov/) | Earthdata Login |
| NASA GES DISC cloud OPeNDAP | Spatial subsets for the Europe cube | [opendap.earthdata.nasa.gov](https://opendap.earthdata.nasa.gov/) | Earthdata Login |
| NASA LP DAAC cloud OPeNDAP | One-pixel MODIS series | [opendap.earthdata.nasa.gov](https://opendap.earthdata.nasa.gov/) | Earthdata Login |
| NASA CMR search API | Granule listing for the cube pipeline | [cmr.earthdata.nasa.gov](https://cmr.earthdata.nasa.gov/search/) | Public metadata |
| NASA EONET API v3 | Events near a change, shown as an observation | [eonet.gsfc.nasa.gov](https://eonet.gsfc.nasa.gov/) | Public; event sources linked by EONET |
| NASA Earthdata Login | Token for the services above (server-side only) | [urs.earthdata.nasa.gov](https://urs.earthdata.nasa.gov/) | Free account |

### Product documentation (product boundaries, unit conversions)
| Document | Used for | Link |
|---|---|---|
| GMAO Office Note No. 9: MERRA-2 File Specification | MERRA-2 production streams (boundaries 1992-01, 2001-01, 2011-01) | [GMAO](https://gmao.gsfc.nasa.gov/media/publications/zbly36ziNFDFbmYmvhQeVqPhUo/Bosilovich785.pdf) |
| IMERG Technical Documentation (13 July 2023) | TRMM-era to GPM-era calibration (boundary 2014-06) | [NASA PPS](https://arthurhou.pps.eosdis.nasa.gov/Documents/IMERG_TechnicalDocumentation_final.pdf) |
| GPM IMERG V07 monthly granule attributes (`Units = mm/hr`) | Monthly precipitation as a mean rate | [doi:10.5067/GPM/IMERG/3B-MONTH/07](https://doi.org/10.5067/GPM/IMERG/3B-MONTH/07) |
| README for NASA GLDAS Version 2 Data Products | Unit conversions; GLDAS-2.1 forcing changes (boundaries 2001-03, 2025-06) | [GES DISC](https://hydro1.gesdisc.eosdis.nasa.gov/data/GLDAS/GLDAS_NOAH025_M.2.1/doc/README_GLDAS2.pdf) |
| OMNO2 README Document | OMI row anomaly (boundaries 2007-06, 2008-05); NO₂ sources | [GES DISC](https://acdisc.gesdisc.eosdis.nasa.gov/data/Aura_OMI_Level3/OMNO2d.003/doc/README.OMNO2.pdf) |
| AIRS Version 7 Level 3 Product User Guide | AIRS-only variant continuity (no boundary recorded) | [GES DISC](https://docserver.gesdisc.eosdis.nasa.gov/public/project/AIRS/V7_L3_User_Guide.pdf) |

### Statistical methods
| Reference | Used for | Link |
|---|---|---|
| Sen, P. K. (1968). Estimates of the regression coefficient based on Kendall's tau. *JASA* 63, 1379–1389 | Sen's slope | [doi:10.1080/01621459.1968.10480934](https://doi.org/10.1080/01621459.1968.10480934) |
| Mann, H. B. (1945). Nonparametric tests against trend. *Econometrica* 13, 245–259; Kendall, M. G. (1975). *Rank Correlation Methods* | Mann-Kendall test | [doi:10.2307/1907187](https://doi.org/10.2307/1907187) |
| Hamed, K. H. & Rao, A. R. (1998). A modified Mann-Kendall trend test for autocorrelated data. *J. Hydrology* 204, 182–196 | Autocorrelation correction | [doi:10.1016/S0022-1694(97)00125-X](https://doi.org/10.1016/S0022-1694%2897%2900125-X) |
| Gilbert, R. O. (1987). *Statistical Methods for Environmental Pollution Monitoring*. Van Nostrand Reinhold | Confidence interval of Sen's slope | — |
| Santer, B. D. et al. (2000). Statistical significance of trends and trend differences in layer-average atmospheric temperature time series. *JGR* 105, 7337–7356 | Effective sample size for the OLS t-test | [doi:10.1029/1999JD901105](https://doi.org/10.1029/1999JD901105) |
| Hirsch, R. M., Slack, J. R. & Smith, R. A. (1982). Techniques of trend analysis for monthly water quality data. *Water Resources Research* 18, 107–121 | Seasonal Kendall test | [doi:10.1029/WR018i001p00107](https://doi.org/10.1029/WR018i001p00107) |
| Benjamini, Y. & Hochberg, Y. (1995). Controlling the false discovery rate. *J. R. Stat. Soc. B* 57, 289–300 | Multiple testing on the trend maps | [doi:10.1111/j.2517-6161.1995.tb02031.x](https://doi.org/10.1111/j.2517-6161.1995.tb02031.x) |
| Pettitt, A. N. (1979). A non-parametric approach to the change-point problem. *Applied Statistics* 28, 126–135 | Change-point test | [doi:10.2307/2346729](https://doi.org/10.2307/2346729) |
| Kass, R. E. & Raftery, A. E. (1995). Bayes factors. *JASA* 90, 773–795 | BIC evidence scale (step vs gradual line) | [doi:10.1080/01621459.1995.10476572](https://doi.org/10.1080/01621459.1995.10476572) |
| Iglewicz, B. & Hoaglin, D. C. (1993). *How to Detect and Handle Outliers*. ASQC Quality Press | Robust (MAD) z-score for outliers | — |

### Sources of the curated known events
The product links to these pages and restates dates and places in its own words; no text, images or data are copied.

| Event | Publisher | Source |
|---|---|---|
| Breach of the Kakhovka dam, Ukraine (6 June 2023) | NASA Earth Observatory | [Canals in Ukraine are Drying Up](https://science.nasa.gov/earth/earth-observatory/canals-in-ukraine-are-drying-up-151622/) |
| Eruption of Mount Pinatubo (1991), global cooling 1991–1993 | U.S. Geological Survey | [Fact Sheet 113-97](https://pubs.usgs.gov/fs/1997/fs113-97/) |
| NO₂ drop during the COVID-19 lockdown, northern Italy (2020) | European Space Agency | [Coronavirus: nitrogen dioxide emissions drop over Italy](https://www.esa.int/ESA_Multimedia/Videos/2020/03/Coronavirus_nitrogen_dioxide_emissions_drop_over_Italy) |
| NO₂ drop during the COVID-19 shutdown, China (2020) | NASA Earth Observatory | [Airborne Nitrogen Dioxide Plummets Over China](https://science.nasa.gov/earth/earth-observatory/airborne-nitrogen-dioxide-plummets-over-china-146362/) · [Nitrogen Dioxide Levels Rebound in China](https://science.nasa.gov/earth/earth-observatory/nitrogen-dioxide-levels-rebound-in-china-146741/) |
| NO₂ drop during the COVID-19 lockdown, northeastern U.S. (March 2020) | NASA Goddard Space Flight Center | [30 Percent Drop in Air Pollution Over Northeast U.S.](https://www.nasa.gov/centers-and-facilities/goddard/nasa-satellite-data-show-30-percent-drop-in-air-pollution-over-northeast-u-s/) |
| European heat wave, summer 2003 | NASA Earth Observatory | [European Heat Wave](https://science.nasa.gov/earth/earth-observatory/european-heat-wave-3714/) |
| Russian heat wave, summer 2010 | NASA Earth Observatory | [Heatwave in Russia](https://science.nasa.gov/earth/earth-observatory/heatwave-in-russia-45069/) |
| Heat and drought in northern and central Europe, 2018 | Copernicus Climate Change Service | [European State of the Climate 2018](https://climate.copernicus.eu/european-state-climate-2018-launched) |
| Drought in Europe, summer 2022 | European Commission Joint Research Centre | [GDO Analytical Report JRC130493](https://publications.jrc.ec.europa.eu/repository/handle/JRC130493) · [Summer drought keeps its grip on Europe](https://joint-research-centre.ec.europa.eu/jrc-news-and-updates/summer-drought-keeps-its-grip-europe-2022-08-22_en) |
| Floods in western Germany and Belgium, July 2021 | Copernicus EMS; Copernicus Climate Change Service | [EMSR517](https://mapping.emergency.copernicus.eu/activations/EMSR517/) · [ESOTC 2021: Flooding in July](https://climate.copernicus.eu/esotc/2021/flooding-july) |

### Software libraries
Backend (Python, pinned in `backend/requirements.txt`):

| Library | Purpose | Link | License |
|---|---|---|---|
| FastAPI 0.162.0 | Web framework, OpenAPI schema | [fastapi.tiangolo.com](https://fastapi.tiangolo.com/) | MIT |
| Starlette 1.10.0 | ASGI toolkit used by FastAPI | [starlette.dev](https://starlette.dev/) | BSD-3-Clause |
| Pydantic 2.14.1 | Request validation | [docs.pydantic.dev](https://docs.pydantic.dev/) | MIT |
| Uvicorn 0.54.0 | ASGI server | [uvicorn.dev](https://uvicorn.dev/) | BSD-3-Clause |
| HTTPX 0.28.1 | HTTP client for the NASA services | [python-httpx.org](https://www.python-httpx.org/) | BSD-3-Clause |
| NumPy 2.5.4 | Arrays, the Europe cube | [numpy.org](https://numpy.org/) | BSD-3-Clause |
| SciPy 1.18.1 | Distributions and ranks for the tests | [scipy.org](https://scipy.org/) | BSD-3-Clause |
| h5py 3.16.0 | Reading NetCDF-4/HDF5 subsets from OPeNDAP | [h5py.org](https://www.h5py.org/) | BSD-3-Clause |
| pytest 9.1.1 (development) | Tests | [pytest.org](https://pytest.org/) | MIT |
| pymannkendall 1.4.3 (development) | Cross-check of our Mann-Kendall / Seasonal Kendall code in tests | [GitHub](https://github.com/mmhs013/pyMannKendall) | MIT |

Frontend (pinned in `frontend/package-lock.json`; every package with its licence in
[`frontend/THIRD_PARTY_NOTICES.md`](frontend/THIRD_PARTY_NOTICES.md)):

| Library | Purpose | Link | License |
|---|---|---|---|
| React 19.3.1, React DOM 19.3.1 | User interface | [react.dev](https://react.dev/) | MIT |
| TypeScript 7.0.2 (development) | Type checking | [typescriptlang.org](https://www.typescriptlang.org/) | Apache-2.0 |
| Vite 8.3.8, @vitejs/plugin-react 6.3.0 (development) | Build | [vite.dev](https://vite.dev/) | MIT |
| Vitest 5.1.0, Testing Library 16.3.3, jsdom 31.0.1 (test only) | Interface tests | [vitest.dev](https://vitest.dev/) · [testing-library.com](https://testing-library.com/) · [jsdom](https://github.com/jsdom/jsdom) | MIT |
| Playwright 1.65.1 (test only) | Headless browser checks on localhost | [playwright.dev](https://playwright.dev/) | Apache-2.0 |

Runtime images: Python 3.12 ([`python:3.12.8-slim`](https://hub.docker.com/_/python), PSF License) and Node.js 24.15.0
([`node:24.15.0-alpine`](https://hub.docker.com/_/node), MIT; build stage only). Both images include OS packages under their own licences.

### Geography, fonts, icons, images
| Resource | Used for | Link | License |
|---|---|---|---|
| Scientific Colour Maps 8.0.1 — "cork" (Crameri) | Diverging colour scale of the data layers (original table rows 32–223, linear lookup) | Version 8.0.1: [doi:10.5281/zenodo.8409685](https://doi.org/10.5281/zenodo.8409685) · [fabiocrameri.ch/colourmaps](https://www.fabiocrameri.ch/colourmaps/) · Crameri, F., Shephard, G. E. & Heron, P. J. (2020), *Nat. Commun.* 11, 5444, [doi:10.1038/s41467-020-19160-7](https://doi.org/10.1038/s41467-020-19160-7) | MIT; licence file [`frontend/third_party/ScientificColourMaps-LICENCE.pdf`](frontend/third_party/ScientificColourMaps-LICENCE.pdf) |
| Natural Earth 1:110m land | Coastlines and land outline behind the data layers | [natural-earth-vector](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson) · [Terms](https://www.naturalearthdata.com/about/terms-of-use/) | Public domain ("Made with Natural Earth") |
| System fonts (Arial, Consolas and generic fallbacks) | Interface text | [Microsoft font FAQ](https://learn.microsoft.com/en-us/typography/fonts/font-faq) | Installed system fonts; no font files redistributed |
| Icons, charts, globe and map drawing (including the WebGL renderer) | Interface | `frontend/src/` | Written for this project; no icon library, 3D library, photos, map tiles or generated images |
<!-- Sync after 018-shader: re-check frontend/THIRD_PARTY_NOTICES.md and docs/RESOURCES.md for anything added for the shader. -->

### Hosting and tools
| Resource | Used for | Link |
|---|---|---|
| Microsoft Azure | Public hosting of the container | [azure.microsoft.com](https://azure.microsoft.com/) |
| Google Cloud Run (documented alternative) | Deployment guide in `deploy/README.md` | [cloud.google.com/run](https://cloud.google.com/run) |

### Consulted during development (not used in the product)
These pages and services were read or probed while choosing data and design. No data, code, text or images from
them are in the product:
- **Data services:** [KNMI Climate Explorer](https://climexp.knmi.nl/), [NOAA Climate Data Online](https://www.ncei.noaa.gov/cdo-web/),
  [NASA POWER](https://power.larc.nasa.gov/), [ORNL DAAC MODIS web service](https://modis.ornl.gov/data/modis_webservice.html),
  [NASA AppEEARS](https://appeears.earthdatacloud.nasa.gov/), [NASA PO.DAAC SWOT](https://podaac.jpl.nasa.gov/SWOT) and
  [Hydrocron](https://podaac.github.io/hydrocron/), [NOAA NCEI Access Data Service](https://www.ncei.noaa.gov/access/services/data/v1),
  [GES DISC tutorials](https://github.com/nasa/gesdisc-tutorials), MERRA-2 M2IMNPASM ([doi:10.5067/2E096JV59PK7](https://doi.org/10.5067/2E096JV59PK7), side check only).
- **Design references:** [earth.nullschool.net](https://earth.nullschool.net/), [Copernicus Climate Pulse](https://pulse.climate.copernicus.eu/),
  [ashMeteo](https://meteo.ashwyn.studio/), [Climate TRACE](https://climatetrace.org/). They shaped layout ideas only.
