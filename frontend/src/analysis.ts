import { isMonth, isObject } from './contract';
import type { ObjectValue } from './contract';
import { monthIndex } from './format';

export type DisplayMode = 'monthly_anomalies' | 'raw';
export interface SeriesPoint { t: string; v: number | null; anomaly: number | null; missing_reason?: string }
export const record = (value: unknown): ObjectValue => isObject(value) ? value : {};
export const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export const text = (value: unknown): string => typeof value === 'string' && value ? value : 'Not available';
export const safeLink = (value: unknown): string | undefined => typeof value === 'string' && /^https?:\/\//.test(value) ? value : undefined;
export const method = (trend: unknown, key: string): ObjectValue => record(record(trend)[key]);
export function pointsFrom(value: unknown): SeriesPoint[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  let previous = -Infinity;
  const points: SeriesPoint[] = [];
  for (const row of value) {
    if (!isObject(row) || !isMonth(row.t) || monthIndex(row.t) <= previous ||
        !(row.v === null || finite(row.v)) || !(row.anomaly === null || finite(row.anomaly))) return undefined;
    previous = monthIndex(row.t);
    points.push({ t: row.t, v: row.v, anomaly: row.anomaly, missing_reason: typeof row.missing_reason === 'string' ? row.missing_reason : undefined });
  }
  return points;
}
export const reasonCopy: Record<string, string> = {
  too_short: 'Fewer than 120 valid monthly observations are available for this test.',
  too_many_gaps: 'The fraction of valid observations is below the method’s requirement.',
  no_variation: 'The series has no variation for this test.',
  too_few_effective_samples: 'Too few effectively independent observations remain after the autocorrelation adjustment.',
  too_few_values_per_calendar_month: 'Too few observations are available in the same calendar months.',
  seasonal_cycle_present: 'Not applied to raw monthly values because of their seasonal cycle.',
  autocorrelation_correction_failed: 'The autocorrelation adjustment could not produce a valid test.',
  not_computed_for_seasonal_sen: 'A confidence interval has not been computed for seasonal Sen’s slope.',
};
export function unavailable(value: ObjectValue): string {
  return reasonCopy[String(value.reason)] ?? (value.status === 'not_implemented' ? 'This method is not implemented yet.' : 'This estimate or test is not available for this series.');
}

/** Each segment ends at a missing value or a nonconsecutive month. */
export function seriesSegments(points: SeriesPoint[], mode: DisplayMode): { t: string; y: number }[][] {
  const result: { t: string; y: number }[][] = [];
  let segment: { t: string; y: number }[] = [];
  for (const point of points) {
    const y = mode === 'raw' ? point.v : point.anomaly;
    if (y === null || (segment.length > 0 && monthIndex(point.t) !== monthIndex(segment[segment.length - 1].t) + 1)) {
      if (segment.length) result.push(segment);
      segment = [];
    }
    if (y !== null) segment.push({ t: point.t, y });
  }
  if (segment.length) result.push(segment);
  return result;
}
