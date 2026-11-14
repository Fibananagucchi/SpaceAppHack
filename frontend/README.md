# Signal Desk frontend

Step 1 provides the responsive workspace and explicit request states. It reads the
live variable catalogue, service health, Europe map availability and point-analysis
responses. It does not render time series, trend statistics, change points or trend
maps yet. Those belong to later approved steps.

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
trend values. `tools/build_outline.py` documents its projection and input; the
normal build never reads the illustrative sketches. Sources and licences are
listed in `docs/RESOURCES.md` and `THIRD_PARTY_NOTICES.md`.

The interface uses system Arial/Consolas fallbacks, visible keyboard focus, a skip
link, text labels alongside colour, labelled fields and polite state announcements.
There are no animated state transitions, including with reduced motion. Native
month controls follow the browser/operating-system locale; authored copy is English.
