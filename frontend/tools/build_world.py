"""Convert public-domain Natural Earth land to an equirectangular point selector.

Geography only; no observations, trends or illustrative marks are generated.
Usage: python tools/build_world.py path/to/ne_110m_land.geojson
"""
import json
import sys
from pathlib import Path

source = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
paths = []
for feature in source['features']:
    geom = feature['geometry']
    polygons = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    for polygon in polygons:
        ring = polygon[0]
        paths.append('M' + 'L'.join(f'{lon+180:.3f},{90-lat:.3f}' for lon, lat, *_ in ring) + 'Z')
svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 180"><title>World land outline</title><desc>Natural Earth 1:110m land, public domain. Equirectangular projection, WGS84. Geography only; no trend values.</desc><path fill="#afbfc6" d="' + ' '.join(paths) + '"/></svg>\n'
target = Path(__file__).resolve().parents[1] / 'src/assets/world-outline.svg'
target.write_text(svg, encoding='utf-8')
coast = svg.replace('<title>World land outline</title>', '<title>Natural Earth coastline</title>').replace('fill="#afbfc6"', 'fill="none" stroke="#f3f1e7" stroke-width="0.12"')
(target.parent / 'world-coastline.svg').write_text(coast, encoding='utf-8')
