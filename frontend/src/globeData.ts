import { finite, record } from './analysis';
import { isMonth, isObject } from './contract';
import type { ObjectValue } from './contract';
import type { GlobeLayer } from './globeGeometry';

export type GlobeDomain = 'world' | 'europe';
export interface AnomalyBaseline {
  start: string;
  end: string;
  kind?: string;
}
export interface GlobeFrames {
  raw: ObjectValue;
  variableId: string;
  unit: string;
  grid: Omit<GlobeLayer, 'values' | 'limit' | 'unit' | 'label' | 'significant'>;
  years: number[];
  frames: (number | null)[][];
  scale: number;
  limit: number;
  baseline: AnomalyBaseline;
  months: number[];
  minValidMonths: number;
}
export interface AnnualPoint {
  year: number;
  anomaly: number | null;
  validMonths: number;
}
export interface AnnualSeries {
  unit: string;
  points: AnnualPoint[];
  baseline: AnomalyBaseline;
  rule: string;
  minValidMonths: number;
}
export interface NeighborStrip {
  years: number[];
  unit: string;
  baseline: AnomalyBaseline;
  neighbors: { lat: number; lon: number; values: (number | null)[] }[];
  gridDegrees?: number;
}
const year = (v: unknown): v is number => Number.isInteger(v) && Number(v) >= 1800 && Number(v) <= 2200;
const orderedYears = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length > 0 && v.length <= 300 && v.every((n, i) => year(n) && (i === 0 || n > v[i - 1]));
function baseline(value: unknown): AnomalyBaseline {
  const outer = record(value),
    b = isObject(outer.period) ? outer.period : outer;
  if (!isMonth(b.start) || !isMonth(b.end) || b.start > b.end) throw Error('invalid_baseline');
  return { start: b.start, end: b.end, kind: typeof outer.kind === 'string' ? outer.kind : undefined };
}
export function parseGlobeFrames(data: ObjectValue, id: string): GlobeFrames {
  const g = record(data.grid),
    encoding = record(data.encoding),
    legend = record(data.legend),
    annual = record(data.annual);
  if (
    data.status !== 'ok' ||
    data.format_version !== 'globe-1' ||
    data.variable_id !== id ||
    typeof data.unit !== 'string' ||
    !Array.isArray(g.shape) ||
    g.shape.length !== 2 ||
    !g.shape.every((n) => Number.isInteger(n) && n > 0) ||
    g.shape[0] * g.shape[1] > 100000 ||
    g.cell_reference !== 'center' ||
    !finite(g.lat0) ||
    !finite(g.lon0) ||
    !finite(g.dlat) ||
    g.dlat <= 0 ||
    !finite(g.dlon) ||
    g.dlon <= 0 ||
    !orderedYears(data.years) ||
    !finite(encoding.scale) ||
    encoding.scale <= 0 ||
    !Number.isInteger(annual.min_valid_months) ||
    Number(annual.min_valid_months) < 1 ||
    Number(annual.min_valid_months) > 12
  )
    throw Error('invalid_globe_frames');
  const n = g.shape[0] * g.shape[1];
  if (
    !Array.isArray(data.frames) ||
    data.frames.length !== data.years.length ||
    !data.frames.every((f) => Array.isArray(f) && f.length === n && f.every((v) => v === null || Number.isSafeInteger(v))) ||
    !Array.isArray(data.months_in_record) ||
    data.months_in_record.length !== data.years.length ||
    !data.months_in_record.every((v) => Number.isInteger(v) && v >= 0 && v <= 12) ||
    !Array.isArray(legend.range) ||
    legend.range.length !== 2 ||
    !legend.range.every(finite) ||
    legend.range[0] >= 0 ||
    legend.range[1] <= 0
  )
    throw Error('invalid_globe_frames');
  for (let y = 0; y < data.years.length; y++)
    if (data.months_in_record[y] < Number(annual.min_valid_months) && (data.frames[y] as unknown[]).some((v) => v !== null))
      throw Error('incomplete_year_has_values');
  return {
    raw: data,
    variableId: id,
    unit: data.unit,
    grid: { rows: g.shape[0], cols: g.shape[1], lat0: g.lat0, lon0: g.lon0, dlat: g.dlat, dlon: g.dlon },
    years: data.years,
    frames: data.frames as (number | null)[][],
    scale: encoding.scale,
    limit: Math.max(-legend.range[0], legend.range[1]),
    baseline: baseline(data.baseline),
    months: data.months_in_record as number[],
    minValidMonths: Number(annual.min_valid_months),
  };
}
export function frameLayer(data: GlobeFrames, index: number): GlobeLayer | undefined {
  if (!data.frames[index]) return undefined;
  return {
    ...data.grid,
    values: data.frames[index].map((v) => (v === null ? null : v * data.scale)),
    limit: data.limit,
    unit: data.unit,
    label: `${data.years[index]} annual anomaly · ${data.grid.dlat}° cells`,
    domain: record(data.raw.domain).id === 'world' ? 'world' : 'europe',
  };
}
export function parseAnnual(value: unknown): AnnualSeries | undefined {
  const data = record(value);
  if (data.status !== 'ok') return undefined;
  if (
    typeof data.unit !== 'string' ||
    !Number.isInteger(data.min_valid_months) ||
    Number(data.min_valid_months) < 1 ||
    Number(data.min_valid_months) > 12 ||
    typeof data.rule !== 'string' ||
    !Array.isArray(data.points) ||
    !orderedYears(data.points.map((p) => record(p).year))
  )
    return undefined;
  const points: AnnualPoint[] = [];
  for (const value of data.points) {
    const p = record(value);
    if (
      !year(p.year) ||
      (p.anomaly !== null && !finite(p.anomaly)) ||
      !Number.isInteger(p.valid_months) ||
      Number(p.valid_months) < 0 ||
      Number(p.valid_months) > 12 ||
      (Number(p.valid_months) < Number(data.min_valid_months) && p.anomaly !== null)
    )
      return undefined;
    points.push({ year: p.year, anomaly: p.anomaly as number | null, validMonths: Number(p.valid_months) });
  }
  try {
    return { unit: data.unit, points, baseline: baseline(data.baseline), rule: data.rule, minValidMonths: Number(data.min_valid_months) };
  } catch {
    return undefined;
  }
}
export function parseNeighborStrip(data: ObjectValue, id: string): NeighborStrip {
  if (
    data.status !== 'ok' ||
    data.variable_id !== id ||
    typeof data.unit !== 'string' ||
    !orderedYears(data.years) ||
    !Array.isArray(data.neighbours) ||
    data.neighbours.length > 24
  )
    throw Error('invalid_strip');
  const years = data.years;
  const neighbors = data.neighbours.map((value) => {
    if (
      !isObject(value) ||
      !finite(value.center_lat) ||
      !finite(value.center_lon) ||
      !Array.isArray(value.values) ||
      value.values.length !== years.length ||
      !value.values.every((v) => v === null || finite(v))
    )
      throw Error('invalid_strip');
    return { lat: value.center_lat, lon: value.center_lon, values: value.values as (number | null)[] };
  });
  return { years, unit: data.unit, baseline: baseline(data.baseline), neighbors, gridDegrees: record(data.domain).id === 'world' ? 2 : 1 };
}
export const sameBaseline = (a: AnomalyBaseline, b: AnomalyBaseline) => a.kind === 'full_record' && b.kind === 'full_record';

/** Reject detailed native grids or a domain mismatch in the display-layer path. */
export function validateDisplayGrid(data: ObjectValue, domain: GlobeDomain): void {
  const g = record(data.grid),
    expected = domain === 'world' ? [90, 180, -89, -179, 2] : [38, 70, 34.5, -24.5, 1];
  if (
    !Array.isArray(g.shape) ||
    g.shape[0] !== expected[0] ||
    g.shape[1] !== expected[1] ||
    g.lat0 !== expected[2] ||
    g.lon0 !== expected[3] ||
    g.dlat !== expected[4] ||
    g.dlon !== expected[4] ||
    (domain === 'world' && record(data.domain).id !== 'world') ||
    (record(data.domain).id !== undefined && record(data.domain).id !== domain)
  )
    throw Error('invalid_display_grid');
}
