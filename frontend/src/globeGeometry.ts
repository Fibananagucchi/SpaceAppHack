import cork from './assets/cork.json';
/** Orthographic geometry only. No observations or scientific estimates are generated. */
export interface GeoPoint {
  lat: number;
  lon: number;
}
export interface GlobeView extends GeoPoint {
  radius: number;
  x: number;
  y: number;
}
const rad = Math.PI / 180,
  deg = 180 / Math.PI;
export function project(p: GeoPoint, v: GlobeView): { x: number; y: number; z: number } {
  const lat = p.lat * rad,
    delta = (p.lon - v.lon) * rad,
    phi = v.lat * rad;
  return {
    x: v.x + v.radius * Math.cos(lat) * Math.sin(delta),
    y: v.y - v.radius * (Math.cos(phi) * Math.sin(lat) - Math.sin(phi) * Math.cos(lat) * Math.cos(delta)),
    z: Math.sin(phi) * Math.sin(lat) + Math.cos(phi) * Math.cos(lat) * Math.cos(delta),
  };
}
export function unproject(x: number, y: number, v: GlobeView): GeoPoint | undefined {
  const a = (x - v.x) / v.radius,
    b = -(y - v.y) / v.radius,
    rho = Math.hypot(a, b);
  if (rho > 1) return undefined;
  if (rho < 1e-9) return { lat: v.lat, lon: v.lon };
  const c = Math.asin(rho),
    phi = v.lat * rad,
    lat = Math.asin(Math.cos(c) * Math.sin(phi) + (b * Math.sin(c) * Math.cos(phi)) / rho);
  const lon = v.lon + Math.atan2(a * Math.sin(c), rho * Math.cos(phi) * Math.cos(c) - b * Math.sin(phi) * Math.sin(c)) * deg;
  return { lat: lat * deg, lon: ((lon + 540) % 360) - 180 };
}
export function rotate(v: GeoPoint, dx: number, dy: number): GeoPoint {
  return { lon: ((v.lon + dx + 540) % 360) - 180, lat: Math.max(-85, Math.min(85, v.lat + dy)) };
}
export interface GlobeLayer {
  domain?: 'world' | 'europe';
  landOnly?: boolean;
  rows: number;
  cols: number;
  lat0: number;
  lon0: number;
  dlat: number;
  dlon: number;
  values: (number | null)[];
  limit: number;
  unit: string;
  label: string;
  significant?: (boolean | null)[];
  statusLabels?: string[];
}
export function globeCell(layer: GlobeLayer, p: GeoPoint): number | undefined {
  const west = layer.lon0 - layer.dlon / 2,
    south = layer.lat0 - layer.dlat / 2;
  if (p.lon < west || p.lon > west + layer.cols * layer.dlon || p.lat < south || p.lat > south + layer.rows * layer.dlat) return undefined;
  const row = Math.min(layer.rows - 1, Math.floor((p.lat - south) / layer.dlat)),
    col = Math.min(layer.cols - 1, Math.floor((p.lon - west) / layer.dlon));
  return row * layer.cols + col;
}
export const globeCellLocation = (layer: GlobeLayer, i: number): GeoPoint => ({
  lat: layer.lat0 + Math.floor(i / layer.cols) * layer.dlat,
  lon: layer.lon0 + (i % layer.cols) * layer.dlon,
});
/** Scientific Colour Maps cork, original rows 32–223. Linear, zero centred. */
export function anomalyColour(value: number, limit: number): string {
  const position = 32 + (Math.max(-1, Math.min(1, value / Math.max(limit, Number.MIN_VALUE))) + 1) * 0.5 * 191;
  const i = Math.floor(position),
    j = Math.min(223, i + 1),
    f = position - i;
  return `rgb(${cork[i].map((v, k) => Math.round((v + (cork[j][k] - v) * f) * 255)).join(',')})`;
}
