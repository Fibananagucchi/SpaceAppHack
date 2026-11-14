import { useEffect, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { finite, seriesSegments } from './analysis';
import type { DisplayMode, SeriesPoint } from './analysis';
import { month, monthIndex, number } from './format';

export interface ChartLine { key: string; label: string; points: { t: string; y: number }[]; dashed?: boolean }
export interface ChartMarker { id: string; date: string; label: string; kind: 'change' | 'boundary' | 'outlier'; tentative?: boolean }
export function TimeSeries({ points, mode, unit, lines = [], markers = [], selectedMarker, onSelectMarker,plotId='observed-series-plot' }: {
  points: SeriesPoint[]; mode: DisplayMode; unit: string; lines?: ChartLine[]; markers?: ChartMarker[];
  selectedMarker?: string; onSelectMarker?: (id: string) => void;
  plotId?:string;
}) {
  const [active, setActive] = useState(points.length-1);
  useEffect(()=>{
    const selected=markers.find(m=>m.id===selectedMarker);
    if (selected) {const i=points.findIndex(p=>p.t===selected.date);if(i>=0)setActive(i);}
  },[selectedMarker,markers,points]);
  const index = Math.min(active, points.length-1);
  const chosen = points[index];
  const field = mode === 'raw' ? 'v' : 'anomaly';
  const segments = seriesSegments(points, mode);
  const values = [...segments.flatMap(s => s.map(p => p.y)), ...lines.flatMap(l => l.points.map(p => p.y))].filter(finite);
  const start = monthIndex(points[0].t), end = monthIndex(points[points.length-1].t);
  let low = Math.min(...values), high = Math.max(...values);
  if (!values.length) { low = -1; high = 1; }
  const pad = (high-low || Math.abs(high)*.1 || 1) * .1;
  low -= pad; high += pad;
  const x = (t: string) => 120 + (monthIndex(t)-start)/Math.max(1,end-start)*652;
  const y = (v: number) => 288 - (v-low)/(high-low)*250;
  const path = (rows: {t: string; y: number}[]) => rows.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(2)},${y(p.y).toFixed(2)}`).join(' ');
  const inspect = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const target = start + Math.max(0, Math.min(1, ((e.clientX-rect.left)/rect.width*800-120)/652))*(end-start);
    let nearest = 0;
    points.forEach((p,i) => { if (Math.abs(monthIndex(p.t)-target) < Math.abs(monthIndex(points[nearest].t)-target)) nearest = i; });
    setActive(nearest);
  };
  const key = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
    e.preventDefault();
    setActive(e.key === 'Home' ? 0 : e.key === 'End' ? points.length-1 : Math.max(0,Math.min(points.length-1,index+(e.key === 'ArrowRight' ? 1 : -1))));
  };
  const visibleMarkers = markers.filter(m => monthIndex(m.date) >= start && monthIndex(m.date) <= end);
  return <figure className="time-series">
    <figcaption><span>{mode === 'raw' ? 'Monthly observations' : 'Monthly anomalies'} <span className="text-muted">/ {unit}</span></span><span className="eyebrow">{month(points[0].t)} — {month(points[points.length-1].t)}</span></figcaption>
    {values.length > 0 && <svg id={plotId} viewBox="0 0 800 340" role="group" tabIndex={0} aria-label="Monthly time series. Left and right arrows inspect months; Home and End select the first and last month." onPointerMove={inspect} onKeyDown={key}>
      <title>{`${mode === 'raw' ? 'Monthly observations' : 'Monthly anomalies'} in ${unit}`}</title>
      <desc>Missing months remain gaps. Dashed lines are fitted trends returned by the API, not observations. The table below provides the numeric values.</desc>
      {[0,.25,.5,.75,1].map(f => <g key={f}><line x1="120" x2="772" y1={y(low+(high-low)*f)} y2={y(low+(high-low)*f)} className="chart-grid" /><text x="110" y={y(low+(high-low)*f)+4} textAnchor="end">{number(low+(high-low)*f,3)}</text></g>)}
      {segments.map((s,i) => s.length === 1 ? <circle key={i} cx={x(s[0].t)} cy={y(s[0].y)} r="2" className="chart-single" /> : <path key={i} d={path(s)} className="observation-line" />)}
      {lines.map((line,i) => <path key={line.key} d={path(line.points)} className={`fit-line fit-${i%2}`} strokeDasharray={line.dashed ? '8 5' : '3 4'}><title>{line.label}</title></path>)}
      {visibleMarkers.map(m => {
        const point=points.find(p=>p.t===m.date), value=point?.[field];
        if(m.kind==='outlier'&&!finite(value))return null;
        return <g key={m.id} role="button" tabIndex={0} aria-label={`${m.label}, ${month(m.date)}`} aria-pressed={selectedMarker===m.id} className={`chart-marker marker-${m.kind} ${m.tentative?'marker-tentative':''} ${selectedMarker === m.id ? 'marker-selected' : ''}`} onClick={()=>onSelectMarker?.(m.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();onSelectMarker?.(m.id);}}}>
          <title>{m.label}: {month(m.date)}</title>
          {m.kind==='outlier'?<><circle cx={x(m.date)} cy={y(value as number)} r="12" className="marker-hit" /><circle cx={x(m.date)} cy={y(value as number)} r="5" className="outlier-dot" /></>:<><line x1={x(m.date)} x2={x(m.date)} y1="30" y2="288" className="marker-hit" /><line x1={x(m.date)} x2={x(m.date)} y1="30" y2="288" className="marker-rule" /></>}
        </g>;
      })}
      <line x1={x(chosen.t)} x2={x(chosen.t)} y1="30" y2="288" className="crosshair" />
      {chosen[field] !== null && <circle cx={x(chosen.t)} cy={y(chosen[field])} r="4" className="active-observation" />}
      {[0, Math.floor((points.length-1)/2), points.length-1].filter((n,i,a)=>a.indexOf(n)===i).map((n,i) => <text key={n} x={x(points[n].t)} y="320" textAnchor={i===0?'start':n===points.length-1?'end':'middle'}>{month(points[n].t)}</text>)}
    </svg>}
    <div className="chart-inspection" aria-live="polite"><strong>{month(chosen.t)}</strong><span>{chosen[field] === null ? 'No value available' : `${number(chosen[field],6)} ${unit}`}</span>{chosen[field] === null && <span className="text-muted">{chosen.v !== null ? 'Monthly anomaly unavailable' : 'Missing observation'}</span>}</div>
    <div className="chart-legend"><span><i className="legend-observed" />Observed {mode === 'raw' ? 'values' : 'anomalies'}</span>{lines.map((l,i)=><span key={l.key}><i className={`legend-fit fit-${i%2}`} />{l.label}</span>)}</div>
    {!values.length && <p className="warning-notice">No values are available in this display. Try monthly observations; anomalies require enough values in each calendar month.</p>}
    {visibleMarkers.some(m=>m.kind!=='outlier') && <div className="marker-rail" aria-label="Markers on the time series">{visibleMarkers.filter(m=>m.kind!=='outlier').map(m => <button key={m.id} className={`marker-chip marker-${m.kind}`} aria-pressed={selectedMarker === m.id} onClick={()=>onSelectMarker?.(m.id)}>{m.kind === 'boundary' ? '│' : '↳'} {month(m.date)} · {m.label}</button>)}</div>}
    <p className="field-help">Move over the plot or focus it and use arrow keys to inspect months. Gaps are not interpolated. Fitted trend lines have no confidence band; slope intervals are reported below.</p>
    <details className="observation-table"><summary>View monthly values as a table</summary><div tabIndex={0} aria-label="Scrollable observations table"><table><thead><tr><th scope="col">Month</th><th scope="col">Observation ({unit})</th><th scope="col">Anomaly ({unit})</th><th scope="col">Availability</th></tr></thead><tbody>{points.map(p=><tr key={p.t}><th scope="row">{month(p.t)}</th><td>{p.v === null ? 'Missing' : number(p.v,6)}</td><td>{p.anomaly === null ? 'Not available' : number(p.anomaly,6)}</td><td>{p.v === null ? 'No observation' : p.anomaly === null ? 'Observation only' : 'Available'}</td></tr>)}</tbody></table></div></details>
  </figure>;
}
