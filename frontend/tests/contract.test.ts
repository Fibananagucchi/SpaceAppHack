import { describe, expect, it } from 'vitest';
import { analysisState, parseVariables, readProgress, requestFromFields } from '../src/contract';
import { request, result, variable } from './fixtures';

describe('Scientific absence and state boundaries', () => {
  it('does not treat blank coordinates as zero, but accepts a real zero', () => {
    expect(requestFromFields('x', '', '', '2000-01', '2001-01')).toHaveProperty('error');
    expect(requestFromFields('x', '0', '0', '2000-01', '2001-01')).toHaveProperty('request.location.lat', 0);
    expect(requestFromFields('x', '91', '0', '2000-01', '2001-01')).toHaveProperty('error');
    expect(requestFromFields('x', '0', 'Infinity', '2000-01', '2001-01')).toHaveProperty('error');
    expect(requestFromFields('x', '0', '0', '2001-01', '2000-01')).toHaveProperty('error');
  });
  it('preserves zero-valued observations as an available series', () => {
    expect(analysisState({ httpStatus: 200, data: result }, request).kind).toBe('ready');
  });
  it('distinguishes an absent series, a source failure and an unavailable test', () => {
    expect(analysisState({ httpStatus: 200, data: { ...result, series: { status: 'no_data', points: [] } } }, request).kind).toBe('no_data');
    expect(analysisState({ httpStatus: 503, data: { status: 'source_error' } }, request).kind).toBe('source_error');
    expect(analysisState({ httpStatus: 200, data: { ...result, trend: { mann_kendall: { status: 'insufficient_for_test' } } } }, request)).toMatchObject({ kind: 'ready', testUnavailable: true });
    expect(analysisState({ httpStatus: 200, data: result }, request).testUnavailable).toBe(false);
  });
  it('keeps a product boundary as a warning over a valid result', () => {
    expect(analysisState({ httpStatus: 200, data: { ...result, warnings: [{ code: 'product_boundary_in_period', date: '2011-01' }] } }, request)).toMatchObject({ kind: 'ready', warnings: [{ code: 'product_boundary_in_period', date: '2011-01' }] });
  });
  it('accepts 501 as a known state and 404 as a lost request, not no_data', () => {
    expect(analysisState({ httpStatus: 501, data: { status: 'not_implemented' } }, request).kind).toBe('not_implemented');
    expect(analysisState({ httpStatus: 404, data: { status: 'not_found' } }, request).kind).toBe('not_found');
  });
  it('rejects a result for another request or an unknown payload', () => {
    expect(analysisState({ httpStatus: 200, data: { ...result, request: { ...request, variable_id: 'another' } } }, request).kind).toBe('protocol_error');
    expect(analysisState({ httpStatus: 200, data: { status: 'unrecognised' } }, request).kind).toBe('protocol_error');
    expect(analysisState({ httpStatus: 202, data: { status: 'queued', job_id: '../invalid' } }, request).kind).toBe('protocol_error');
  });
  it('never invents progress for an unknown or invalid total', () => {
    expect(readProgress({ progress: { known: false, done: 80, total: 100 } })).toBeUndefined();
    expect(readProgress({ progress: { known: true, done: 0, total: 0 } })).toBeUndefined();
    expect(readProgress({ progress: { known: true, done: 3, total: 2 } })).toBeUndefined();
    expect(readProgress({ progress: { known: true, done: 0, total: 2, unit: 'months' } })).toEqual({ done: 0, total: 2, unit: 'months' });
  });
  it('does not create catalogue entries from malformed metadata', () => {
    expect(parseVariables({ status: 'ok', variables: [variable] })).toHaveLength(1);
    expect(() => parseVariables({ status: 'ok', variables: [{ ...variable, unit: null }] })).toThrow();
    expect(() => parseVariables({ status: 'ok', variables: [variable, variable] })).toThrow();
  });
});
