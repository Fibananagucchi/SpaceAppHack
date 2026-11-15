import { finite, record, safeLink } from './analysis';
import { isMonth } from './contract';
import type { ObjectValue } from './contract';
import { validateDisplayGrid } from './globeData';
import type { GlobeDomain } from './globeData';
import { globeCellLocation } from './globeGeometry';
import type { GeoPoint, GlobeLayer } from './globeGeometry';

export type ChangeCategory =
  | 'possible_data_artifact'
  | 'consistent_with_natural_event'
  | 'consistent_with_human_influence'
  | 'cause_undetermined';
export type ChangeGroup = 'product' | 'event' | 'unknown';
export const changeGroup = (category: ChangeCategory): ChangeGroup =>
  category === 'possible_data_artifact' ? 'product' : category === 'cause_undetermined' ? 'unknown' : 'event';
export const changeLabels: Record<ChangeGroup, string> = {
  product: 'Product change nearby',
  event: 'Documented event matches',
  unknown: 'Cause unclear',
};
export const changeSymbols: Record<ChangeGroup, string> = { product: '▱', event: '◇', unknown: '?' };
export const changeColours: Record<ChangeGroup, string> = { product: '#dbbd8f', event: '#a9ccbb', unknown: '#b9c9df' };
const categories = new Set([
  'possible_data_artifact',
  'consistent_with_natural_event',
  'consistent_with_human_influence',
  'cause_undetermined',
]);
export interface MapChange extends GeoPoint {
  id: string;
  cell: number;
  date: string;
  status: 'detected' | 'inconclusive';
  category: ChangeCategory;
  shift: number | null;
  p: number | null;
  boundaryId?: string;
  eventId?: string;
  coinciding: boolean;
}
export interface ChangeLayer {
  raw: ObjectValue;
  domain: GlobeDomain;
  grid: Pick<GlobeLayer, 'rows' | 'cols' | 'lat0' | 'lon0' | 'dlat' | 'dlon'>;
  unit: string;
  start: string;
  end: string;
  markers: MapChange[];
  statuses: string[];
  boundaries: ObjectValue[];
}
export interface GlobeEvent extends GeoPoint {
  id: string;
  title: string;
  start: string;
  end: string;
  global: boolean;
  variables: string[];
  sources: ObjectValue[];
  raw: ObjectValue;
}

/** Parse source decisions; never calculate a break or assign a category here. */
export function parseChanges(data: ObjectValue, id: string, domain: GlobeDomain): ChangeLayer {
  validateDisplayGrid(data, domain);
  const g = record(data.grid),
    c = record(data.changes),
    period = record(data.period),
    codes = record(data.status_codes),
    categoryCodes = record(data.category_codes),
    n = (g.shape as number[])[0] * (g.shape as number[])[1];
  if (
    data.status !== 'ok' ||
    data.format_version !== 'changes-1' ||
    data.variable_id !== id ||
    typeof data.unit !== 'string' ||
    !isMonth(period.start) ||
    !isMonth(period.end) ||
    period.start > period.end ||
    !Array.isArray(data.cell_status) ||
    data.cell_status.length !== n
  )
    throw Error('invalid_changes');
  const start = String(period.start),
    end = String(period.end);
  const names = ['cell', 'status', 'month', 'shift', 'p_value', 'category', 'boundary_id', 'event_id', 'coinciding'],
    arrays = names.map((k) => c[k]);
  if (!arrays.every(Array.isArray) || !arrays.every((a) => a.length === (c.cell as unknown[]).length))
    throw Error('invalid_changes_columns');
  const statuses = data.cell_status.map((v) => String(codes[String(v)]));
  if (
    !statuses.every((v) =>
      ['not_detected', 'detected', 'inconclusive', 'not_distinct_from_trend', 'insufficient_for_test', 'no_data', 'not_computed'].includes(
        v,
      ),
    )
  )
    throw Error('invalid_change_status');
  const grid = {
      rows: (g.shape as number[])[0],
      cols: (g.shape as number[])[1],
      lat0: Number(g.lat0),
      lon0: Number(g.lon0),
      dlat: Number(g.dlat),
      dlon: Number(g.dlon),
    },
    seen = new Set<number>();
  const markers = (c.cell as unknown[]).map((cell, j) => {
    const status = String(codes[String((c.status as unknown[])[j])]),
      date = (c.month as unknown[])[j],
      category = categoryCodes[String((c.category as unknown[])[j])],
      shift = (c.shift as unknown[])[j],
      p = (c.p_value as unknown[])[j],
      boundary = (c.boundary_id as unknown[])[j],
      event = (c.event_id as unknown[])[j],
      coinciding = (c.coinciding as unknown[])[j];
    if (
      !Number.isInteger(cell) ||
      Number(cell) < 0 ||
      Number(cell) >= n ||
      seen.has(Number(cell)) ||
      !['detected', 'inconclusive'].includes(status) ||
      statuses[Number(cell)] !== status ||
      !isMonth(date) ||
      date < start ||
      date > end ||
      !categories.has(String(category)) ||
      (shift !== null && !finite(shift)) ||
      (p !== null && (!finite(p) || p < 0 || p > 1)) ||
      typeof coinciding !== 'boolean' ||
      (boundary !== null && typeof boundary !== 'string') ||
      (event !== null && typeof event !== 'string')
    )
      throw Error('invalid_change_marker');
    seen.add(Number(cell));
    return {
      ...globeCellLocation({ ...grid, values: [], unit: '', limit: 1, label: '' }, Number(cell)),
      id: `${domain}/${cell}/${date}`,
      cell: Number(cell),
      date,
      status: status as MapChange['status'],
      category: category as ChangeCategory,
      shift: shift as number | null,
      p: p as number | null,
      boundaryId: typeof boundary === 'string' ? boundary : undefined,
      eventId: typeof event === 'string' ? event : undefined,
      coinciding,
    };
  });
  if (statuses.some((v, i) => ['detected', 'inconclusive'].includes(v) && !seen.has(i))) throw Error('missing_change_marker');
  return {
    raw: data,
    domain,
    grid,
    unit: data.unit,
    start: period.start,
    end: period.end,
    markers,
    statuses,
    boundaries: Array.isArray(record(data.rules).boundaries_in_period)
      ? (record(data.rules).boundaries_in_period as unknown[]).map(record)
      : Array.isArray(data.boundaries)
        ? data.boundaries.map(record)
        : [],
  };
}

export function parseGlobeEvents(data: ObjectValue): GlobeEvent[] {
  if (!Array.isArray(data.events)) throw Error('invalid_events');
  return data.events.flatMap((value) => {
    const e = record(value),
      m = record(e.marker),
      dates = record(e.dates),
      global = record(e.area).scope === 'global',
      sources = Array.isArray(e.sources) ? e.sources.map(record).filter((s) => safeLink(s.url)) : [];
    if (
      typeof e.event_id !== 'string' ||
      typeof e.title !== 'string' ||
      typeof dates.start !== 'string' ||
      typeof dates.end !== 'string' ||
      !isMonth(dates.start.slice(0, 7)) ||
      !isMonth(dates.end.slice(0, 7)) ||
      !sources.length ||
      !Array.isArray(e.variables) ||
      (!global && (!finite(m.lat) || !finite(m.lon) || Math.abs(m.lat) > 90 || Math.abs(m.lon) > 180))
    )
      return [];
    return [
      {
        id: e.event_id,
        title: e.title,
        start: dates.start.slice(0, 7),
        end: dates.end.slice(0, 7),
        global,
        lat: global ? 0 : Number(m.lat),
        lon: global ? 0 : Number(m.lon),
        variables: e.variables.filter((v) => typeof v === 'string') as string[],
        sources,
        raw: e,
      },
    ];
  });
}
export const changesInYear = (layer: ChangeLayer | undefined, year: number | undefined) =>
  layer && year !== undefined ? layer.markers.filter((m) => Number(m.date.slice(0, 4)) === year) : [];
