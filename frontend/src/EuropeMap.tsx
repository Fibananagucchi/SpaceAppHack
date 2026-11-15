import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { apiRequest, isAbort } from './api';
import type { AnalysisRequest, Variable } from './contract';
import { finite, pointsFrom, record, text } from './analysis';
import { coordinate, month, number, pValue, signed, timestamp } from './format';
import { cellLocation, cellState, mapColour, oppositePair, parseTrendMap } from './trendMap';
import type { TrendMap } from './trendMap';
import coastline from './assets/world-coastline.svg';
import { useAnalysis } from './useAnalysis';
import { Evidence } from './AnalysisView';
import { TimeSeries } from './TimeSeries';
import { StatusNotice } from './StatusNotice';

export function PairRecord({
  request,
  label,
  onOpen,
}: {
  request: AnalysisRequest;
  label: string;
  onOpen: (request: AnalysisRequest) => void;
}) {
  const analysis = useAnalysis(false);
  useEffect(() => {
    analysis.submit(request);
  }, []);
  const data = analysis.state.result,
    series = record(data?.series),
    points = pointsFrom(series.points);
  return (
    <article className="paired-record">
      <h4>{label} / native point record</h4>
      {analysis.state.kind === 'ready' && data ? (
        <>
          <Evidence data={data} mode="monthly_anomalies" />
          {points && <TimeSeries plotId={`pair-${label}-plot`} points={points} mode="monthly_anomalies" unit={text(series.unit)} />}
          <button className="button" onClick={() => onOpen(request)}>
            Open full analysis {label} ↗
          </button>
        </>
      ) : (
        <StatusNotice state={analysis.state} onRetry={analysis.retry} />
      )}
    </article>
  );
}

function Raster({
  map,
  active,
  a,
  b,
  onHover,
  onPick,
  showActive,
}: {
  map: TrendMap;
  active: number;
  a?: number;
  b?: number;
  onHover: (i: number) => void;
  onPick: (i: number) => void;
  showActive: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null),
    width = 900,
    height = Math.round((900 * map.rows * map.dlat) / (map.cols * map.dlon));
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const w = width / map.cols,
      h = height / map.rows;
    for (let row = 0; row < map.rows; row++)
      for (let col = 0; col < map.cols; col++) {
        const i = row * map.cols + col,
          x = col * w,
          y = height - (row + 1) * h,
          state = cellState(map, i);
        ctx.fillStyle =
          state === 'ok'
            ? mapColour(map.slope[i]!, map.limit)
            : state === 'no_data'
              ? '#263b46'
              : state === 'insufficient_for_test'
                ? '#47535b'
                : '#101e28';
        ctx.fillRect(x, y, w + 0.2, h + 0.2);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        if (state === 'ok' && map.significant[i] === true) {
          ctx.strokeStyle = 'rgba(16,30,40,.35)';
          ctx.lineWidth = 0.55;
          ctx.beginPath();
          ctx.moveTo(x, y + h);
          ctx.lineTo(x + w, y);
          ctx.stroke();
        }
        if (state === 'no_data') {
          ctx.strokeStyle = '#52636b';
          ctx.lineWidth = 0.45;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + w, y + h);
          ctx.moveTo(x, y + h);
          ctx.lineTo(x + w, y);
          ctx.stroke();
        }
        if (state === 'insufficient_for_test') {
          ctx.fillStyle = '#aeb4b7';
          ctx.fillRect(x + w * 0.4, y + h * 0.4, 1, 1);
        }
        if (state === 'not_computed') {
          ctx.strokeStyle = '#aeb4b7';
          ctx.lineWidth = 0.6;
          ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
        }
        ctx.restore();
      }
  }, [map, width, height]);
  const index = (e: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    return (
      (map.rows - 1 - Math.min(map.rows - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * map.rows)))) * map.cols +
      Math.min(map.cols - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * map.cols)))
    );
  };
  const key = (e: KeyboardEvent<HTMLCanvasElement>) => {
    let row = Math.floor(active / map.cols),
      col = active % map.cols;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPick(active);
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    row = Math.max(0, Math.min(map.rows - 1, row + (e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0)));
    col = Math.max(0, Math.min(map.cols - 1, col + (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0)));
    onHover(row * map.cols + col);
  };
  const west = map.lon0 - map.dlon / 2,
    north = map.lat0 + (map.rows - 0.5) * map.dlat;
  return (
    <div className="raster-wrap" style={{ aspectRatio: `${width}/${height}` }}>
      <canvas
        ref={ref}
        width={width}
        height={height}
        tabIndex={0}
        role="group"
        aria-label="Europe trend grid. Arrow keys inspect cells; Enter selects the active cell."
        onPointerMove={(e) => onHover(index(e))}
        onClick={(e) => onPick(index(e))}
        onKeyDown={key}
      />
      <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="raster-overlay">
        <svg
          width={width}
          height={height}
          viewBox={`${west + 180} ${90 - north} ${map.cols * map.dlon} ${map.rows * map.dlat}`}
          preserveAspectRatio="none"
        >
          <image href={coastline} width="360" height="180" opacity=".9" />
        </svg>
        {[showActive ? active : undefined, a, b].map((i, k) =>
          i === undefined ? null : (
            <g
              key={k}
              transform={`translate(${(((i % map.cols) + 0.5) * width) / map.cols},${height - ((Math.floor(i / map.cols) + 0.5) * height) / map.rows})`}
            >
              {k === 0 ? (
                <rect
                  x={-width / map.cols / 2}
                  y={-height / map.rows / 2}
                  width={width / map.cols}
                  height={height / map.rows}
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2"
                />
              ) : (
                <>
                  <circle r="13" fill="#101e28" stroke={k === 1 ? '#e8af78' : '#7ebbe0'} strokeWidth="3" />
                  <text textAnchor="middle" dy="5" fill="#fff" fontSize="14">
                    {k === 1 ? 'A' : 'B'}
                  </text>
                </>
              )}
            </g>
          ),
        )}
      </svg>
    </div>
  );
}

export function EuropeMap({ variable, onOpen }: { variable: Variable; onOpen: (request: AnalysisRequest) => void }) {
  const [map, setMap] = useState<TrendMap>(),
    [status, setStatus] = useState<'loading' | 'ready' | 'not_ready' | 'error'>('loading'),
    [refresh, setRefresh] = useState(0);
  const [compareMode, setCompareMode] = useState(false),
    [inspected, setInspected] = useState(false);
  const [active, setActive] = useState(0),
    [slot, setSlot] = useState<'A' | 'B'>('A'),
    [a, setA] = useState<number>(),
    [b, setB] = useState<number>(),
    [pairMessage, setPairMessage] = useState(''),
    [compare, setCompare] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    setStatus('loading');
    setMap(undefined);
    setCompare(false);
    setA(undefined);
    setB(undefined);
    if (variable.capabilities.map_europe !== 'precomputed') {
      setStatus('not_ready');
      return () => c.abort();
    }
    void apiRequest(`/maps/europe/${encodeURIComponent(variable.variable_id)}`, { signal: c.signal })
      .then((r) => {
        if (c.signal.aborted) return;
        if (r.data.status === 'not_ready') {
          setStatus('not_ready');
          return;
        }
        if (r.httpStatus !== 200) throw Error();
        setMap(parseTrendMap(r.data, variable.variable_id));
        setStatus('ready');
        setActive(0);
      })
      .catch((e) => {
        if (!c.signal.aborted && !isAbort(e)) setStatus('error');
      });
    return () => c.abort();
  }, [variable.variable_id, variable.capabilities.map_europe, refresh]);
  const pair = useMemo(() => (map ? oppositePair(map) : undefined), [map]);
  const choose = (i: number) => {
    setActive(i);
    setInspected(true);
    if (!compareMode) {
      onOpen(request(i));
      return;
    }
    setCompare(false);
    setPairMessage('');
    if (slot === 'A') {
      setA(i);
      setSlot('B');
    } else {
      setB(i);
      setSlot('A');
    }
  };
  const request = (i: number): AnalysisRequest => ({
    variable_id: variable.variable_id,
    location: { type: 'point', ...cellLocation(map!, i) },
    period: { start: map!.start, end: map!.end },
  });
  const card = (i: number | undefined, label: string) => {
    if (i === undefined || !map)
      return (
        <article className="counter-card">
          <h4>{label}</h4>
          <p>Choose a map cell.</p>
        </article>
      );
    const state = cellState(map, i),
      p = cellLocation(map, i);
    return (
      <article className="counter-card">
        <h4>
          {label} / {coordinate(p.lat)}°, {coordinate(p.lon)}°
        </h4>
        <p className="map-rate">{state === 'ok' ? `${signed(map.slope[i]!)} ${map.unit}` : state.replaceAll('_', ' ')}</p>
        {state === 'ok' && (
          <p className="field-help">
            {map.significant[i] ? 'Passes map FDR test' : 'Does not pass map FDR test'} · q = {pValue(map.q[i])}
          </p>
        )}
        <button className="text-button" onClick={() => onOpen(request(i))}>
          Open native point {label} ↗
        </button>
      </article>
    );
  };
  return (
    <section id="europe-map" className="europe-map" aria-label="Europe trend map">
      <div className="map-title">
        <div>
          <p className="eyebrow">Europe / regional trends</p>
          <h1>{variable.label}</h1>
        </div>
        <button className="text-button map-refresh" onClick={() => setRefresh((v) => v + 1)}>
          Refresh map ↻
        </button>
      </div>
      {status !== 'ready' || !map ? (
        <p role="status" className="map-message">
          {status === 'loading'
            ? 'Loading the real trend map…'
            : status === 'not_ready'
              ? variable.capabilities.map_europe === 'not_available'
                ? 'No Europe trend map is available for this product. Request a point record instead.'
                : 'This map is not ready yet. You can still analyse a point or area.'
              : 'The map could not be read. No trend colours have been substituted.'}
        </p>
      ) : (
        <>
          <p className="map-period">
            Data: {month(map.start)} — {month(map.end)} · {variable.source.mission_or_model}
          </p>
          <Raster
            map={map}
            active={active}
            a={compareMode ? a : undefined}
            b={compareMode ? b : undefined}
            onHover={(i) => {
              setActive(i);
              setInspected(true);
            }}
            onPick={choose}
            showActive={inspected}
          />
          <div className="map-scale">
            <span>−{number(map.limit)}</span>
            <i />
            <span>+{number(map.limit)}</span>
            <strong>{map.unit}</strong>
            <span className="scale-note">Sen’s slope · colour limits clipped</span>
          </div>
          <details className="map-key">
            <summary>Map key / hatching and gaps</summary>
            <div className="map-mask-legend">
              <span>╱ Passes map FDR test</span>
              <span>× No data</span>
              <span>· Insufficient for test</span>
              <span>□ Not computed</span>
            </div>
          </details>
          <div className="cell-inspection" aria-live="polite">
            {inspected ? (
              <>
                {coordinate(cellLocation(map, active).lat)}°, {coordinate(cellLocation(map, active).lon)}° ·{' '}
                {cellState(map, active) === 'ok'
                  ? `${signed(map.slope[active]!)} ${map.unit} · q = ${pValue(map.q[active])}`
                  : cellState(map, active).replaceAll('_', ' ')}
              </>
            ) : (
              'Select a cell to read its record.'
            )}
          </div>
          <details
            className="counter-disclosure"
            onToggle={(e) => {
              setCompareMode(e.currentTarget.open);
              if (!e.currentTarget.open) setCompare(false);
            }}
          >
            <summary>Compare two places ↗</summary>
            <div className="counter-controls">
              <h3>Counter-directions</h3>
              <div role="group" aria-label="Map selection slot">
                <button aria-pressed={slot === 'A'} onClick={() => setSlot('A')}>
                  Pick A
                </button>
                <button aria-pressed={slot === 'B'} onClick={() => setSlot('B')}>
                  Pick B
                </button>
              </div>
              <button
                className="button"
                onClick={() => {
                  setCompare(false);
                  if (pair) {
                    setA(pair[0]);
                    setB(pair[1]);
                    setPairMessage('Two opposite signs selected from cells that pass the map FDR test.');
                  } else setPairMessage('No pair with opposite signs passes the map test for this variable.');
                }}
              >
                Find opposite signs
              </button>
            </div>
            <p className="field-help">
              Click the map to pick {slot}; arrows and Enter work too. The map period stays fixed when you change a live analysis period.
            </p>
            {pairMessage && (
              <p role="status" className="pair-message">
                {pairMessage}
              </p>
            )}
            <div className="counter-grid">
              {card(a, 'A')}
              {card(b, 'B')}
            </div>
            {a !== undefined && b !== undefined && cellState(map, a) === 'ok' && cellState(map, b) === 'ok' && (
              <>
                <p className="field-help">
                  {map.slope[a]! * map.slope[b]! < 0
                    ? 'These map rates have opposite signs.'
                    : 'These map rates do not have opposite signs.'}{' '}
                  Different directions do not identify a shared cause.
                </p>
                <button className="button" onClick={() => setCompare(true)}>
                  Compare both point records ↗
                </button>
              </>
            )}
            {compare && a !== undefined && b !== undefined && (
              <>
                <p className="field-help">
                  Live records use the native grid. Aggregated map cells can differ; map FDR and individual trend tests answer different
                  questions.
                </p>
                <button className="text-button" onClick={() => setCompare(false)}>
                  Close point comparison
                </button>
                <div className="paired-grid">
                  <PairRecord key={`A-${a}`} label="A" request={request(a)} onOpen={onOpen} />
                  <PairRecord key={`B-${b}`} label="B" request={request(b)} onOpen={onOpen} />
                </div>
              </>
            )}
          </details>
          <details className="map-methods">
            <summary>Map data, methods and limits</summary>
            <dl>
              <div>
                <dt>Multiple tests</dt>
                <dd>{text(record(map.raw.method).multiple_testing)}</dd>
              </div>
              <div>
                <dt>Valid record required</dt>
                <dd>{text(record(map.raw.method).sufficiency)}</dd>
              </div>
              <div>
                <dt>Map grid / aggregation</dt>
                <dd>
                  {number(map.dlat)}° × {number(map.dlon)}° ·{' '}
                  {map.raw.grid && record(map.raw.grid).aggregation
                    ? text(record(record(map.raw.grid).aggregation).method)
                    : 'Native grid; no additional aggregation'}
                </dd>
              </div>
              <div>
                <dt>Computed / source record assembled</dt>
                <dd>
                  {timestamp(map.raw.computed_at)} / {timestamp(record(map.raw.provenance).cube_assembled_at)}
                </dd>
              </div>
              <div>
                <dt>Colour limits</dt>
                <dd>{text(record(map.raw.legend).rule)}. Values outside the legend range use the end colour.</dd>
              </div>
            </dl>
            <p>
              Missing or uncomputed cells are never shown as zero. Hatched decisions come directly from the server before rounding. Finding
              a pair selects the strongest available negative and positive map rates that pass FDR; it is not a representative sample.
            </p>
            <a href={`https://doi.org/${encodeURI(variable.source.doi)}`} target="_blank" rel="noreferrer">
              Source dataset DOI ↗
            </a>
            <p>
              Outline:{' '}
              <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">
                Natural Earth
              </a>
              . Projection: equirectangular, WGS84.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
