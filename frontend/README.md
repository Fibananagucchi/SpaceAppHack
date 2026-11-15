# Earth system trends frontend

Steps 1–5 provide real Europe trend maps for seven NASA variables, point and area
analyses, monthly time series, trend evidence, data passports, Change seam, Time
aperture and Counter-directions. A three-question guide helps choose a variable,
place and period. The frontend calculates no scientific tests.

The workspace uses one rotating orthographic globe for global selection and the
Europe data layer. The selected record leads with its direction, rate and evidence;
a completed wider-context check replaces the headline with the backend's category.
Evidence opens a native reading drawer with the monthly chart, tests, Change seam,
documented events and data passport. Place & period supports exact coordinates,
areas and background MODIS products. No second map or selection page is needed.

The bottom Time aperture combines a native annual record, neighbouring 1° cells,
an anomaly ribbon, an API-provided monthly Sen fit and an interactive change marker.
Scrubbing or Play changes real annual frames on the globe, with no interpolation.
The exact analysis-period brackets and Apply action remain available in Evidence.
Blue/copper marks sit on flat navy and muted dark surfaces: no glow, stars or glass.

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
- A pending job can be resumed in the same tab using session storage. Temporary server storage
  may be lost; a 404 offers a new request without promising
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

## Investigate a possible change

After the trend and chart, Check wider context starts a separate investigation.
The trend stays available while the service checks neighbouring cells, other
variables and documented product boundaries. The conclusion displays the service's
category, source documentation, supporting observations, counter-evidence,
alternatives and ordered rules. Unassessed features stay labelled Not assessed.
Missing or unreadable classification data never becomes Cause undetermined.

NASA EONET appears as a separate catalogue observation, with search bounds, dates,
event source links and coverage limits. An event match never selects a cause
category. Natural-event and human-influence categories require independent,
documented context from the backend's curated known-event list. Matched events show
their title, documented dates, publisher and source links. Match rules and the
checked list version are disclosed. When a documented product boundary and event
both match, the UI presents equally weighted explanations without promoting the
compatibility category to a winner. No match creates no event card. None of these
categories proves a cause.

MODIS NDVI and daytime land surface temperature are point products in the same
catalogue. The initial request runs in the background. Progress is shown only for
the server's reported checked/total monthly files. A source time estimate is
labelled as an estimate. Completed source records can be returned from the cache.
These products have no Europe trend map or area average. The current backend can
investigate an eligible MODIS change against documented events; unavailable
spatial checks remain Not assessed. Explicit capability restrictions are honoured.

For opt-in checks against a running local API:

```powershell
node tools/check-mode2-live.mjs http://127.0.0.1:8013
$env:MODE2_LIVE_ORIGIN='http://127.0.0.1:8013'
npm test -- tests/mode2-live.test.tsx
Remove-Item Env:MODE2_LIVE_ORIGIN
```

The helper uses actual source responses and saves them only to ignored
`data/runtime/codex-mode2-qa/`. Integration tests use those real analysis IDs on
the same running instance. Ordinary tests use isolated synthetic protocol cases;
neither set of test inputs is imported by the product build. Use `--skip-modis`
on the helper when checking only context; it avoids a fresh full source download.

## Redesign browser checks

The development-only Playwright scripts launch a fresh headless Microsoft Edge
instance using the installed browser, without the team's browser profile or tabs.
Browser requests are restricted to the supplied localhost origin. The API obtains
real source data; no request interception substitutes observations or findings.

```powershell
node tools/check-redesign-browser.mjs http://127.0.0.1:8014 after
node tools/check-redesign-before.mjs http://127.0.0.1:8014
node tools/check-redesign-interactions.mjs http://127.0.0.1:8014
node tools/check-known-event-live.mjs http://127.0.0.1:8014
```

The before helper serves the preserved earlier build from
`node_modules/.cache/redesign-before/` and forwards API requests unchanged to the
same local backend. The screenshot helper's direct `before` option must also
target the preserved earlier build, not the redesigned build.
PNG screenshots go to `reports/`. The known-event check stores real API responses
in ignored `node_modules/.cache/redesign-live/` and may start a full MODIS download.

## Design references and resources

The team's references informed the interaction hierarchy; no reference site's
code, imagery, data, branding or typography was copied:

- [earth.nullschool.net](https://earth.nullschool.net/): map as the primary image,
  controls revealed on demand.
- [Copernicus Climate Pulse](https://pulse.climate.copernicus.eu/): one clear
  response and its chart.
- [ashMeteo](https://meteo.ashwyn.studio/): the team's reference for a distinctive time interaction; Time aperture
  uses this project's own real-series brackets.
- [Climate TRACE](https://climatetrace.org/): compact, explicit data labels.

Playwright 1.65.1 and playwright-core 1.65.1 are development-only tools under
[Apache-2.0](https://github.com/microsoft/playwright/blob/main/LICENSE), from
[Microsoft's Playwright project](https://github.com/microsoft/playwright).
The dependency inventory is in `THIRD_PARTY_NOTICES.md`. No new application
library, external font, icon package, tile service or generated image was added.

## Globe and annual data contract (tasks 017–018)

`GET /api/v1/globe/europe/{variable_id}` supplies `globe-1` frames for the seven
core variables. Every year uses the same 38×70 grid of 1° cells. Encoded integers
are decoded only by the supplied scale; `null` stays missing. An anomaly is
relative to each native cell's monthly climatology over its full source record.
The backend averages valid native annual anomalies with cosine-latitude weights.
Colours use the backend's symmetric legend in physical units, with clipped
extremes; they do not encode a probability, significance or a forecast.

The main annual line is `series.annual` from the actual point or area analysis.
Thin lines come from `/globe/europe/{variable_id}/strip?lat&lon&ring=1` and describe
neighbouring 1° cells, not additional native point analyses. They appear only if
both baselines explicitly have `kind: full_record` and units match. A restricted
analysis uses its own baseline and hides these neighbours with an explanation.
The UI displays each year's valid-month count and the product's required minimum:
currently 10 months for most products and 6 for OMI NO₂. It does not override the
backend's sufficiency rule or fill missing values. A partial last year may have
no annual value or Europe frame. That year remains explicitly unavailable.

Full-period trend colours use `/globe/europe/{variable_id}/trend`: the same 1° grid
as annual frames, encoded as `map-1.2`, with server FDR flags. The server aggregates
native monthly anomalies before estimating Sen/Mann–Kendall and applying FDR. The
frontend never averages slopes or p/q-values. It does not fetch the detailed
`/maps/europe` layer. A↔B uses these same 1° cells, followed by actual native-point
requests; native values and statistical decisions can differ from spatial averages. Play is disabled for this fixed layer, for products
without frames and under reduced motion. Playback changes only existing annual
frames, stops at the end or when the document is hidden, and never rotates the
globe automatically. Native point/area requests outside Europe retain the ordinary
source and job workflow; neutral geography is not a measured zero.

Drag rotates the globe in Point mode; a click selects a cell or global point.
Arrow keys rotate, Enter selects the visible centre, and plus/minus zoom.
Area mode supports dragging bounds on the same globe; exact coordinate and area
fields are keyboard accessible. The year slider, annual ribbon and step buttons
also work from the keyboard. Evidence and selection use native modal semantics,
Escape and focus return. Narrow screens put the card above the same globe.

Local real-data browser checks (Vite on 8018, API on 8000):

```powershell
node tools/check-globe-browser.mjs
node tools/check-globe-interactions.mjs
node tools/check-globe-presentation.mjs
node tools/check-globe-production.mjs
```

These use isolated headless Edge and the existing Playwright dependency. They
request real analyses and context jobs, with no API fixtures or substituted
observations. Review screenshots and verification JSON stay under the ignored
`_mockups/globe-018/` folder, never in the production bundle. Unit tests use
synthetic protocol cases only under `tests/`. The screenshot checks do not access
the team's browser profiles or tabs.

## Globe resources

The team's current-hackathon prototype in `docs/reference/` supplies the approved
composition and interaction reference. Its synthetic series, classification,
decorative effects and approximate geographic polygons are not used. The globe,
projection, controls and timeline are project-authored Canvas/WebGL/SVG/React code; no
3D library or new runtime dependency is added.

- Geography: [Natural Earth](https://www.naturalearthdata.com/),
  [public-domain terms](https://www.naturalearthdata.com/about/terms-of-use/).
  The existing geographic SVG is sampled only as a land mask, without observations.
  Existing coastline paths are projected above the data dots.
- Annual frames reuse the cited source products:
  [MERRA-2](https://doi.org/10.5067/5ESKGQTZG7FO),
  [IMERG](https://doi.org/10.5067/GPM/IMERG/3B-MONTH/07),
  [GLDAS](https://doi.org/10.5067/SXAVCZFAQLNO),
  [AIRS](https://doi.org/10.5067/UBENJB9D3T2H),
  [OMI](https://doi.org/10.5067/Aura/OMI/DATA3007). NASA open data; cite dataset DOIs.
- Arial and Consolas use local system fonts with generic fallbacks, under their
  installed licences. [Font licensing FAQ](https://learn.microsoft.com/en-us/typography/fonts/font-faq).
  No font files are redistributed. Blue/copper colour stops and interface symbols
  are original project code; there is no external icon or palette library.
- Browser rendering uses the existing development-only
  [Playwright Apache-2.0 dependency](https://github.com/microsoft/playwright/blob/main/LICENSE)
  and installed Microsoft Edge; no browser binary is redistributed.

No new dataset, external imagery, generated observation, webfont, map tile service
or stock asset is introduced by the globe UI. These resource notes belong in the
root submission README when the team prepares the final resource inventory.


## Refinements and performance (15 November, 12:10 team feedback)

A fresh visit starts with Evapotranspiration; a resumed pending request keeps its
own variable. Natural Earth coastlines are drawn over the Europe dots. The globe
supports 0.7–8× zoom via buttons, keyboard and wheel; Europe view and Selected
place help centre a region. Dot radius follows geographic cell spacing and zoom,
with a screen-size bound. Zoom never creates finer observations.

The diverging blue/copper ramp has a neutral grey centre and desaturated ends.
Dot colours use 65 display bins so Canvas can batch paths; source values and legend
limits retain API precision. Evidence uses a muted dark reading surface, without a
bright modal flash or forced transition. Headline rates/annual values use two
significant figures. Full-precision API estimates and annual observations remain
in Evidence. NDVI/LST Area is disabled by the actual point-only API capability;
the reason appears beside the control and in Place & period.

The geographic fill uses a small original WebGL shader with a real Natural Earth
land mask; no lighting, animation loop or new library is added. A software Canvas
fallback supports browsers without WebGL. Grid unit vectors and projected screen
positions are cached. Year changes recolour dots without reprojecting or repainting
geography. Coastlines/graticules cache by camera; canvas buffers resize only when
the viewport changes. Pointer input and drawing coalesce to animation frames with
a 60 Hz upper bound. Hover-only text changes do not repaint the globe; there is no
continuous idle render loop. Full-period trend also stays at 2660 cells when zoomed.

Reproduce the real-data checks and benchmark on localhost:8018 / API8000:

```powershell
node tools/capture-globe-refine.mjs after
node tools/check-globe-refine.mjs
node tools/bench-globe.mjs after
```

Before/after measurements, actual screenshots and browser metadata are saved only
in ignored `_mockups/globe-018-refine/`. Benchmark sessions exercise all seven
variables in both modes, at native CPU speed and DevTools 4× CPU throttling. The
JSON separates actual Canvas repaint FPS, rAF interval and Canvas CPU paint time;
GPU presentation is not included in the CPU paint timer. Test hardware was an
Intel Core i7-1260P with Intel Iris Xe / ANGLE Direct3D11. Results describe that
machine and short repeatable sessions, not a guarantee for every browser/device.
