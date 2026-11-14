import { isMonth } from './contract';

/** All authored values use an explicit English locale, independent of the OS. */
export const number = (value: unknown, digits = 4): string => typeof value === 'number' && Number.isFinite(value)
  ? new Intl.NumberFormat('en-US', { maximumSignificantDigits: digits, useGrouping: true }).format(value) : 'Not available';
export const signed = (value: number): string => `${value > 0 ? '+' : ''}${number(value)}`;
export const coordinate = (value: number): string => new Intl.NumberFormat('en-US', { maximumFractionDigits: 4, useGrouping: false }).format(value);
export function month(value: unknown): string {
  if (!isMonth(value)) return 'Not available';
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}-01T00:00:00Z`));
}
export const monthIndex = (value: string): number => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
export const pValue = (value: unknown): string => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1
  ? 'Not available' : value === 0 ? '0 (numerical underflow)' : value < 0.000001 ? value.toExponential(2) : number(value, 3);
export function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return 'Not available';
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(new Date(value)) + ' UTC';
}
