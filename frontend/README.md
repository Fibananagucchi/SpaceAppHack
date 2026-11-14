# Signal Desk frontend

Steps 1–5 provide real Europe trend maps for seven NASA variables, point and area
analyses, monthly time series, trend evidence, data passports, Change seam, Time
aperture and Counter-directions. A three-question guide helps choose a variable,
place and period. The frontend calculates no scientific tests. No 3D work is included.

## Run

Use Node.js 24.15.0 (the Docker build version) and npm. From this directory:

```powershell
npm ci
npm run dev
```

Start FastAPI on `127.0.0.1:8000` using the repository instructions. Vite forwards
`/api` to that server. Production uses relative `/api/v1` URLs; FastAPI serves
`frontend/dist` from the same origin. No frontend credentials or environment
variables are required.

```powershell
npm test
npm run build
```

The build includes TypeScript checking and emits `dist/`. Only the entry point,
imported source assets and third-party notices are included. `_sketches/` and
`tests/` are not product assets. Sketches are excluded from the cloud build
context; the final runtime image receives only `dist/` from the frontend.

## State behaviour

- Loading and connecting preserve the requested point and period. Connecting
  means a response is pending; it does not assert that a cold start occurred.
- Queued/running jobs are polled at the server's bounded interval. Progress is
  shown only when the API reports a known, valid total. Elapsed time is measured.
- No observations, source failure, unsupported analysis and expired saved
  requests are separate states. Retry is manual; a 501 is never auto-retried.
- Unavailable tests and documented product boundaries can accompany available
  observations. No missing observations are replaced with zero or generated data.
- Editing a selection stops following its previous request. It does not cancel
  server work. Superseded responses cannot overwrite the current selection.
- A pending job can be resumed in the same tab using session storage. Cloud Run
  may lose its temporary database; a 404 offers a new request without promising
  any retention period.

## Assets and accessibility

The geographic backdrop is an actual Natural Earth coastline, without computed
trend values. `tools/build_outline.py` and `tools/build_world.py` document their projections and input; the
normal build never reads the illustrative sketches. Sources and licences are
listed in `docs/RESOURCES.md` and `THIRD_PARTY_NOTICES.md`.

The interface uses system Arial/Consolas fallbacks, visible keyboard focus, a skip
link, text labels alongside colour, labelled fields and polite state announcements.
There are no animated state transitions, including with reduced motion. Coordinates
and periods use text fields (`50.45`, `2000-01`), with validation. Output formatting
uses explicit `en-US` numbers and English month names, with UTC timestamps; native
OS-localized month and number widgets are not used.

## Inspect a real record

Select a variable and a point on the Natural Earth outline, or enter coordinates.
The map supports arrow keys (1°) and Shift + arrows (10°). Enter the requested
months and run the analysis. The data passport separates the requested period,
available record and actual analysis period, including the resolved grid cell.

Switch between observations and monthly anomalies. When anomalies are entirely
unavailable, observations are shown first. Missing months remain gaps; the chart
never interpolates them. Focus the plot and use arrows, Home or End to inspect
months, or open the numeric table. Only API-returned fitted lines are shown.
Statistical decisions use server booleans, not rounded display values.

Change seam distinguishes a possible step, an unresolved step/trend comparison,
gradual change and no detection. Only possible steps receive solid seams;
unresolved candidates use dashed seams. Gradual change gets no abrupt-change
marker. Select chart markers or their keyboard-accessible buttons to link a date
to its explanation. Compare whole-period fits with API-provided before/after
fits on the same anomaly baseline. Unsupported segment fits stay unavailable.

Documented product boundaries use a different dotted marker with source links.
Flagged observations stay in the record and statistics. Changes, outliers,
unavailable tests and unassessed features remain independent. Basic inspection
does not infer natural or human causes, spatial extent or event matches.

## Change the question

Time aperture brackets can be dragged, moved with keyboard sliders, or entered as
exact months. A draft does not change the current result. Apply requests fresh
statistics with a new client request ID. The overview retains only an actually
received wider record; it never fills missing months. Load full product record
requests the catalogue coverage again.

The Europe raster has a fixed period and uses map-wide Benjamini–Hochberg FDR
decisions supplied by the API. It stays fixed when a point/area period changes.
Missing data, insufficient records and uncomputed tests have separate patterns.
Hover or use arrows to inspect cells; Enter selects A or B. Find opposite signs
selects the strongest available positive and negative cells passing FDR, or reports
that no pair exists. Compare both point records fetches two real native-grid
analyses independently. Larger aggregated map cells can differ from these point
records; individual trend tests and map FDR are shown separately.

Choose Area to draw a rectangle or enter west/south/east/north. Europe uses the
prepared cube; elsewhere a supported NASA Harmony request can run in the background.
Progress remains unknown unless the server reports it. Area size, selected cells,
spatial averaging and coverage appear in the passport. A box with no cell centres
has its own no-data explanation. Boxes crossing the antimeridian are unsupported.

Concurrent comparison requests do not restore or erase the main pending job.
Deduplicated area jobs can return the original creator's correlation ID; the
frontend verifies scientific request identity and its active sequence. It does not
reject a matching shared result solely because of a different correlation ID.
