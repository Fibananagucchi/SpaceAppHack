# Design studies — task 004

**Presentation only. Not a working frontend.** All analytical marks, trend colours,
traces, numbers and change dates are illustrative. Every exported image carries
this notice. Never load these files, curves or numbers into the product or API.
The approved product may show real observations and calculated results only.

Open `index.html` to compare three directions. Each directory contains:

- `main.svg` / `main.png`: main map and selection screen.
- `analysis.svg` / `analysis.png`: time series and evidence screen.
- `interaction.svg` / `interaction.png`: three-frame signature storyboard.

`_shared/states.svg` / `.png` covers queued, retrieving, no data, source failure,
test unavailability, product boundaries and cached observations. `comparison.png`
is a small overview; use the full-size views to review text.

The names Field Atlas, Signal Desk and Evidence Journal identify design studies,
not proposed product names. The three designs present the same agreed scope.
The team chooses a direction before implementation.

## Scope of the pictures

The screen studies are fixed desktop canvases (1440 × 1040). The gallery reflows
to one column on narrow windows. These are not mobile product designs; the
responsive behaviour of the eventual interface is described in the design report.
Map data and time-series periods are separate. The example map metadata uses the
product's available period, while the selected series uses an illustrative query.
The trend guide is schematic artwork; it is not a fitted line from observations.
Uncertainty is represented by a slope interval, not a prediction ribbon.

## Sources and rights

- Coastline: Natural Earth, 1:110m land, public domain.
  [Source](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson)
  · [Terms](https://www.naturalearthdata.com/about/terms-of-use/).
  Downloaded 14 November 2026. Snapshot SHA-256:
  `9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9`.
  Geometry is in `_sources/ne_110m_land.geojson`. The renderer uses one scale in
  both directions for its Mercator projection; the view is clipped to its frame.
  This low-resolution land outline does not encode political boundaries or analysis coverage.
- Type: locally installed Georgia, Arial and Consolas with generic fallbacks.
  No font files are bundled or redistributed. System-font terms apply on the
  viewing computer. Typography can vary if these fonts are unavailable.
- No external photographs, human images, icons, tiles, or logos are used.
- SVG artwork and copy were authored during the hackathon for these studies.

## Rebuilding presentation files

Python 3 (standard library) generates the SVG files. Node.js and `sharp` render
their PNG previews. `sharp` must be resolvable from the local environment; it is
a rendering dependency, not a chosen dependency for the eventual frontend.

```text
python frontend/_sketches/render_sketches.py
node frontend/_sketches/render_previews.cjs
```

No data API, token, statistics, package installation, or server is involved.
All references and rendering-tool terms are recorded in `docs/RESOURCES.md`.
