import type { KeyboardEvent, PointerEvent } from 'react';
import world from './assets/world-outline.svg';
import { coordinate } from './format';

export function PointMap({ lat, lon, onPick }: { lat?: number; lon?: number; onPick: (lat: number, lon: number) => void }) {
  const picked = lat !== undefined && lon !== undefined;
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    const nextLon = (e.clientX - box.left) / box.width * 360 - 180;
    const nextLat = 90 - (e.clientY - box.top) / box.height * 180;
    onPick(Number(Math.max(-90, Math.min(90, nextLat)).toFixed(4)), Number(Math.max(-180, Math.min(180, nextLon)).toFixed(4)));
  };
  const key = (e: KeyboardEvent<SVGSVGElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    onPick(Number(Math.max(-90, Math.min(90, (lat ?? 0) + (e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0))).toFixed(4)),
      Number(Math.max(-180, Math.min(180, (lon ?? 0) + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0))).toFixed(4)));
  };
  return <section className="point-map-panel" aria-label="Point selector">
    <div className="map-label"><h3 className="eyebrow">Select a point / WGS84</h3><span>Geography only</span></div>
    <svg className="point-map" viewBox="0 0 360 180" role="group" tabIndex={0} aria-label="World point selector" aria-describedby="map-help" onPointerDown={pick} onKeyDown={key}>
      <title>Choose coordinates on the world map</title>
      <image href={world} width="360" height="180" opacity=".5" />
      {[-60, -30, 0, 30, 60].map(y => <line key={`y${y}`} x1="0" x2="360" y1={90-y} y2={90-y} className="map-grid" />)}
      {[-120, -60, 0, 60, 120].map(x => <line key={`x${x}`} x1={180+x} x2={180+x} y1="0" y2="180" className="map-grid" />)}
      {picked && <g transform={`translate(${180+lon},${90-lat})`} className="point-marker"><path d="M-6 0H6M0-6V6" /><circle r="3" /></g>}
    </svg>
    <p id="map-help" className="field-help">Click to select. Arrow keys move 1°; Shift + arrows move 10°. You can also enter exact coordinates.</p>
    <p className="map-selection" aria-live="polite">{picked ? `${coordinate(lat)}° latitude / ${coordinate(lon)}° longitude` : 'No point selected.'}</p>
    <p className="map-credit">Outline: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a>. No trend layer is displayed.</p>
  </section>;
}
