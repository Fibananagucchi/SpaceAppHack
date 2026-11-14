"""Prepare a geographic outline from Natural Earth 1:110m land GeoJSON.

This is coastline geometry only. No measured values or trend marks are created.
Pass a local Natural Earth ne_110m_land.geojson as the first argument. The SVG is
committed; normal frontend builds never read research or sketch directories.
"""
from pathlib import Path
import json
import math
import sys

source = Path(sys.argv[1])
data = json.loads(source.read_text(encoding='utf-8'))
merc = lambda lat: math.log(math.tan(math.pi / 4 + math.radians(max(-85, min(85, lat))) / 2))
west, east, south, north = -25, 45, 34, 72
width, height = 800, 560
scale = min(width / math.radians(east-west), height / (merc(north)-merc(south)))
def project(lon, lat):
    return width/2 + math.radians(lon-(west+east)/2)*scale, height/2 + ((merc(north)+merc(south))/2-merc(lat))*scale
paths = []
for feature in data['features']:
    geom = feature['geometry']
    polygons = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    for polygon in polygons:
        ring = polygon[0]
        if max(p[0] for p in ring) < west or min(p[0] for p in ring) > east or max(p[1] for p in ring) < south or min(p[1] for p in ring) > north:
            continue
        paths.append('M'+'L'.join(f'{x:.2f},{y:.2f}' for x,y in [project(*p[:2]) for p in ring])+'Z')
svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 560"><title>Geographic outline centred on Europe</title><desc>Natural Earth 1:110m land, public domain. Mercator projection with equal axis scale. Geography only; no observations or trends.</desc><path fill="#afbfc6" d="'+' '.join(paths)+'"/></svg>\n'
target = Path(__file__).resolve().parents[1] / 'src' / 'assets' / 'europe-outline.svg'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(svg, encoding='utf-8')
print('Prepared geographic outline. No observation or trend values included.')
