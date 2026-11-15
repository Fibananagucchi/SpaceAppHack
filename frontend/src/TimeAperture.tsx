import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { SeriesPoint } from './analysis';
import { isMonth } from './contract';
import { month, monthIndex } from './format';

export function TimeAperture({
  points,
  period,
  onApply,
  onFull,
}: {
  points: SeriesPoint[];
  period: { start: string; end: string };
  onApply: (period: { start: string; end: string }) => void;
  onFull: () => void;
}) {
  const first = monthIndex(points[0].t),
    last = monthIndex(points[points.length - 1].t);
  const [start, setStart] = useState(period.start),
    [end, setEnd] = useState(period.end),
    [error, setError] = useState('');
  const dragging = useRef<'start' | 'end' | null>(null);
  const date = (i: number) =>
    `${Math.floor(i / 12)
      .toString()
      .padStart(4, '0')}-${((i % 12) + 1).toString().padStart(2, '0')}`;
  const clamp = (n: number) => Math.max(first, Math.min(last, n));
  const startIndex = isMonth(start) ? clamp(monthIndex(start)) : first,
    endIndex = isMonth(end) ? clamp(monthIndex(end)) : last;
  const x = (i: number) => 16 + ((i - first) / Math.max(1, last - first)) * 768;
  const valid = points.filter((p) => p.v !== null),
    values = valid.map((p) => p.v as number);
  const low = Math.min(...values),
    span = Math.max(...values) - low || 1;
  let path = '';
  let previous = -Infinity;
  for (const p of points) {
    if (p.v === null) {
      previous = -Infinity;
      continue;
    }
    const i = monthIndex(p.t);
    path += `${i === previous + 1 ? 'L' : 'M'}${x(i).toFixed(2)},${(68 - ((p.v - low) / span) * 48).toFixed(2)} `;
    previous = i;
  }
  const change = (edge: 'start' | 'end', index: number) => {
    setError('');
    const n = clamp(index);
    if (edge === 'start') setStart(date(Math.min(n, endIndex)));
    else setEnd(date(Math.max(n, startIndex)));
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    if (!dragging.current) return;
    const box = e.currentTarget.getBoundingClientRect();
    change(
      dragging.current,
      Math.round(first + Math.max(0, Math.min(1, (((e.clientX - box.left) / box.width) * 800 - 16) / 768)) * (last - first)),
    );
  };
  const down = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const box = e.currentTarget.getBoundingClientRect(),
      px = ((e.clientX - box.left) / box.width) * 800;
    dragging.current = Math.abs(px - x(startIndex)) <= Math.abs(px - x(endIndex)) ? 'start' : 'end';
    e.currentTarget.setPointerCapture(e.pointerId);
    move(e);
  };
  const dirty = start !== period.start || end !== period.end;
  const apply = () => {
    if (!isMonth(start) || !isMonth(end) || start > end) {
      setError('Enter months as YYYY-MM, with the start no later than the end.');
      return;
    }
    if (monthIndex(start) < first || monthIndex(end) > last) {
      setError('Choose within the overview, or load the full product record.');
      return;
    }
    onApply({ start, end });
  };
  return (
    <section className="time-aperture" aria-label="Time aperture">
      <div className="aperture-heading">
        <div>
          <p className="eyebrow">Time aperture / drag the edges</p>
          <h3>
            {month(start)} — {month(end)}
          </h3>
        </div>
        <button className="button" onClick={apply} disabled={!dirty}>
          Apply period ↗
        </button>
      </div>
      <svg
        viewBox="0 0 800 90"
        className="aperture-overview"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => {
          dragging.current = null;
        }}
        onPointerCancel={() => {
          dragging.current = null;
        }}
        aria-label="Drag either time bracket to preview a period"
        role="img"
      >
        <title>Overview of received monthly observations</title>
        <rect x={x(startIndex)} y="4" width={Math.max(0, x(endIndex) - x(startIndex))} height="76" className="aperture-window" />
        <path d={path} className="aperture-trace" />
        <rect x="0" y="0" width={x(startIndex)} height="90" className="aperture-outside" />
        <rect x={x(endIndex)} y="0" width={800 - x(endIndex)} height="90" className="aperture-outside" />
        <path d={`M${x(startIndex) + 7} 6h-7v72h7 M${x(endIndex) - 7} 6h7v72h-7`} className="aperture-brackets" />
      </svg>
      <div className="aperture-sliders">
        <label>
          Start: {month(start)}
          <input
            type="range"
            aria-label="Start of time aperture"
            aria-valuetext={month(start)}
            min={first}
            max={last}
            value={startIndex}
            onChange={(e) => change('start', Number(e.target.value))}
          />
        </label>
        <label>
          End: {month(end)}
          <input
            type="range"
            aria-label="End of time aperture"
            aria-valuetext={month(end)}
            min={first}
            max={last}
            value={endIndex}
            onChange={(e) => change('end', Number(e.target.value))}
          />
        </label>
      </div>
      <details className="aperture-exact">
        <summary>Enter exact months</summary>
        <div className="aperture-fields">
          <label>
            From
            <input
              aria-label="Aperture from"
              type="text"
              lang="en"
              placeholder="YYYY-MM"
              maxLength={7}
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                setError('');
              }}
            />
          </label>
          <label>
            To
            <input
              aria-label="Aperture to"
              type="text"
              lang="en"
              placeholder="YYYY-MM"
              maxLength={7}
              value={end}
              onChange={(e) => {
                setEnd(e.target.value);
                setError('');
              }}
            />
          </label>
        </div>
      </details>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <p className="field-help" role="status">
        {dirty ? 'Preview only. Apply to request fresh statistics.' : 'The results above use the applied period.'}
      </p>
      <button className="text-button" onClick={onFull}>
        Load full product record
      </button>
    </section>
  );
}
