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

## Globe and annual data contract (tasks 017–018 / 020)

The interface uses real `globe-1` annual frames and `map-1.2` full-period trends.
`GET /api/v1/globe` announces each variable's frames and trend independently in
`world` (2° / 90×180 cells) and `europe` (1° / 38×70 cells). A ready world layer is
preferred; a not-yet-ready or failed world request leaves the real Europe-only
layer explicitly labelled. Unsupported MODIS layers stay unavailable. Each
resource validates the exact agreed display grid and domain. No detailed native
map is loaded, no absent values are filled, and missing cells are never zero.

Paths are `/globe/{domain}/{variable_id}`, `/trend`, and
`/strip?lat&lon&ring=1`. Units, numeric colour limits, baseline, valid-month rules,
spatial sampling and provenance come from the API. Values encoded as integer ×
scale are decoded exactly. Full-period Sen/Mann–Kendall and FDR decisions are
computed by the backend after spatial aggregation; the UI never averages slopes
or p/q-values. World FDR is over world cells, Europe FDR over Europe cells; these
are not combined in a single layer.

Readiness is checked every 20 seconds while visible and on window focus. A changed
`computed_at` reloads the relevant world payload independently; unchanged
resources stay in memory. If an older index omits trend revision metadata, that
smaller payload is revalidated at most once per minute. A failed refresh keeps
the last real loaded layer with an explicit notice. Changing the variable aborts
old requests, and stale responses cannot replace the new selection.

The main line is the native point/area analysis's `series.annual`, not the display
cell. Thin neighbours use the current display domain (world 2° or Europe 1°) and
appear only when units match and both baselines explicitly have `kind: full_record`.
A restricted-period baseline hides incompatible neighbours with an explanation.
Annual gaps, each year's valid-month count, and the API minimum (usually 10,
OMI NO₂ 6) remain visible. Partial years can be unavailable. Play changes only
existing real frames, is disabled for fixed trend / no frames / reduced motion,
and stops when the page is hidden. There is no automatic globe rotation.

Click coordinates are the exact inverse projection, independent of display
sampling. P and manually chosen A/B retain those coordinates for native analysis.
The backend's resolved native grid centre is separately disclosed on the result
card and passport. Automatic opposite-sign search uses actual display-cell centres;
it is not a representative sample. A/B indices are guarded when a domain changes.

Drag, keyboard arrows, Enter, +/- and wheel provide rotation / exact selection /
zoom. The same globe supports area bounds. Evidence and controls retain modal
keyboard behaviour, Escape and focus return; mobile screens stack card and globe.

Current real-data checks (isolated Edge, no observation mocks or team profiles):

```powershell
node tools/check-globe-world.mjs
node tools/check-globe-world.mjs --production
node tools/check-globe-selection.mjs --world
node tools/bench-globe.mjs world
```

Vite runs on 8018 and API on 8000. The production check uses API8000's actual
built frontend at the same origin. Screenshots, raw timings and checks are in
ignored `_mockups/globe-018-world/`; protocol/geometry fixtures stay in tests only.
Historical Europe-only browser scripts predate the world contract and contain
assumptions that no longer apply (for example, no neighbours outside Europe).

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
  No font files are redistributed. Interface symbols are original project code.
- Data colours: [Scientific Colour Maps 8.0.1 / cork](https://doi.org/10.5281/zenodo.8409685),
  MIT. The original RGB table is in `src/assets/cork.json`; the display uses
  unmodified rows 32–223, linearly, zero centred, with API numeric limits unchanged.
  This wider segment increases colour contrast over the pale preview (64–191).
  The original MIT notice is distributed as `ScientificColourMaps-LICENCE.pdf`
  and included in `THIRD_PARTY_NOTICES.md`. No palette runtime library is added.
- Browser rendering uses the existing development-only
  [Playwright Apache-2.0 dependency](https://github.com/microsoft/playwright/blob/main/LICENSE)
  and installed Microsoft Edge; no browser binary is redistributed.

No new dataset, external imagery, generated observation, webfont, map tile service
or stock asset is introduced by the globe UI. These resource notes belong in the
root submission README when the team prepares the final resource inventory.


## Refinements and performance (15 November, 12:10 team feedback)

A fresh visit starts with Evapotranspiration; a resumed pending request keeps its
own variable. Natural Earth coastlines are drawn above all data dots. The globe
supports 0.7–8× zoom via buttons, keyboard and wheel; Europe view and Selected
place help centre a region. Dot radius follows geographic cell spacing and zoom,
with a screen-size bound. Zoom never creates finer observations.

Graphite / Sage is the chosen dark UI palette (team, 13:56). The diverging cork
ramp retains a light neutral centre and stronger blue/green data colours.
Dot colours use 65 display bins; source values and legend
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
continuous idle render loop. Europe-only layers retain 2660 source cells; world
layers retain 16200 source cells. Overview samples original world centres without
aggregating data; at close zoom the full visible display grid is drawn. Longitude
centres are thinned at low zoom near the poles. Only front-facing viewport-visible
centres enter the drawing list. A separate original WebGL scatter renderer submits
all visible dots in one call under the coastline/marker canvas. Low-contrast
colours receive a thin flat keyline; centre marks indicate server FDR flags, with
light/dark ink chosen for contrast. These overlays do not change data values. Its Canvas fallback
keeps real data visible when WebGL is unavailable; the GPU FPS target does not
guarantee identical software-fallback speed.

Historical Europe-only refinement measurements (before the world renderer):

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
