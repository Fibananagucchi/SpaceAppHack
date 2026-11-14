# Signal Desk refinements — task 006

Five presentation-only alternatives within the selected design B. The team has
not selected these additions yet. `recommended-01-03` illustrates a proposed
combination, not an implementation or a new approved screen.

Open `index.html` for all studies. Every SVG has a PNG preview; `overview.png`
is a small comparison sheet. Read the SVG at full size for labels.

**All analytical marks, chart traces, numbers, timers and change dates are
illustrative artwork.** Every image carries a visible notice. No observation
series, statistics, API logic, map interaction, persistence, queue or deployment
is implemented. Never copy this artwork or its values into the product or API.

The studies use the same dark blue/orange palette, locally installed Arial and
Consolas, public-domain Natural Earth coastline, and local Python/Node/sharp
rendering tools documented in `../README.md` and `docs/RESOURCES.md`. No new
external library, font file, icon, stock image or dataset is introduced.

The screen canvases are fixed desktop sketches. The gallery reflows at narrow
widths; this is not a mobile implementation or keyboard-accessibility test.
The report specifies the required date-field, labelled-cell and reduced-motion
alternatives for any later implementation.

## Rebuild

Python imports the presentation drawing helper in the parent directory; `sharp`
must be resolvable in the Node environment.

```text
python frontend/_sketches/signal-desk-v2/build_studies.py
node frontend/_sketches/signal-desk-v2/render_previews.cjs
```

## Production boundary

This directory and all of `frontend/_sketches/` must be excluded from the
production image and build output. The future frontend builds into `frontend/dist/`
and uses the relative `/api/v1` base. Prepared maps and live observations come
from real validated source data through the agreed API, never these studies.
