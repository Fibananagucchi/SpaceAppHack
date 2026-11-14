/** Synthetic contract fixtures for tests only. Never imported by src or included in dist. */
import type { AnalysisRequest, Variable } from '../src/contract';

export const request: AnalysisRequest = {
  variable_id: 'test_variable', location: { type: 'point', lat: 0, lon: 0 },
  period: { start: '2000-01', end: '2020-12' },
};
export const variable: Variable = {
  variable_id: 'test_variable', label: 'Test-only measurement', definition: null,
  unit: 'test unit', trend_unit: 'test unit per decade',
  source: { mission_or_model: 'Test-only source', provider: 'Test provider', product: 'TEST', version: '1', doi: '10.0/test' },
  coverage: { start: '2000-01', end: '2020-12', surface: 'land' },
  native_resolution: { lat_deg: 1, lon_deg: 1, time: 'monthly' },
  capabilities: { point: 'live', area: 'not_implemented', map_europe: 'not_implemented' },
};
export const result = {
  analysis_id: 'a_test_only', status: 'ok', request,
  series: { status: 'ok', points: [{ t: '2000-01', v: 0 }, { t: '2000-02', v: null }] },
  trend: { monthly_anomalies: { mann_kendall: { status: 'ok', p_value: 0.01 } }, raw: { ols_t_test: { status: 'not_applicable' } } },
  warnings: [],
};
export const jsonResponse = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});
