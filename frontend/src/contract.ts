/** Public, non-secret fields used by the shell. Scientific results stay in the API. */
export type ObjectValue = Record<string, unknown>;
export const isObject = (value: unknown): value is ObjectValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export interface Variable {
  variable_id: string;
  label: string;
  definition: string | null;
  unit: string;
  trend_unit: string;
  source: { mission_or_model: string; provider: string; product: string; version: string; doi: string };
  coverage: { start: string; end: string; surface: string; checked_at?: string };
  native_resolution: { lat_deg: number; lon_deg: number; time: string };
  capabilities: Record<string, string>;
  limitations?: string[];
  summary?:{definition:string;limitation:string};
}

export interface PointLocation {type:'point';lat:number;lon:number}
export interface AreaLocation {type:'area';bbox:[number,number,number,number]}
export interface AnalysisRequest {
  request_id?: string;
  variable_id: string;
  location: PointLocation | AreaLocation;
  period: { start: string; end: string };
}
export type PointAnalysisRequest = AnalysisRequest & {location:PointLocation};

export type StateKind = 'idle' | 'loading' | 'connecting' | 'queued' | 'running' | 'ready' |
  'no_data' | 'source_error' | 'insufficient_for_test' | 'not_implemented' | 'not_found' |
  'invalid_request' | 'protocol_error';

export interface PublicWarning {
  code: string;
  date?: string;
  reference?: string;
}

export interface ViewState {
  kind: StateKind;
  request?: AnalysisRequest;
  reason?: string;
  jobId?: string;
  analysisId?: string;
  stage?: string;
  jobKind?: string;
  estimateSeconds?: number;
  startedAt?: number;
  progress?: { done: number; total: number; unit: string };
  warnings: PublicWarning[];
  testUnavailable?: boolean;
  result?: ObjectValue;
}

export interface ApiResponse { httpStatus: number; data: ObjectValue }

export function parseVariables(data: ObjectValue): Variable[] {
  if (data.status !== 'ok' || !Array.isArray(data.variables) || data.variables.length === 0) {
    throw new Error('invalid_catalogue');
  }
  const ids = new Set<string>();
  return data.variables.map((item: unknown) => {
    if (!isObject(item) || !isObject(item.source) || !isObject(item.coverage) ||
        !isObject(item.native_resolution) || !isObject(item.capabilities)) throw new Error('invalid_catalogue');
    for (const field of ['variable_id', 'label', 'unit', 'trend_unit']) {
      if (typeof item[field] !== 'string' || !item[field]) throw new Error('invalid_catalogue');
    }
    for (const field of ['mission_or_model', 'provider', 'product', 'version', 'doi']) {
      if (typeof item.source[field] !== 'string') throw new Error('invalid_catalogue');
    }
    if (!isMonth(item.coverage.start) || !isMonth(item.coverage.end) ||
        typeof item.coverage.surface !== 'string' ||
        !finitePositive(item.native_resolution.lat_deg) || !finitePositive(item.native_resolution.lon_deg) ||
        typeof item.native_resolution.time !== 'string' ||
        (item.definition !== null && typeof item.definition !== 'string') ||
        !Object.values(item.capabilities).every(v => typeof v === 'string')) throw new Error('invalid_catalogue');
    const id = item.variable_id as string;
    if(item.limitations!==undefined&&(!Array.isArray(item.limitations)||!item.limitations.every(v=>typeof v==='string')))throw new Error('invalid_catalogue');
    if(item.summary!==undefined&&(!isObject(item.summary)||typeof item.summary.definition!=='string'||typeof item.summary.limitation!=='string'))throw new Error('invalid_catalogue');
    if (ids.has(id)) throw new Error('invalid_catalogue');
    ids.add(id);
    return item as unknown as Variable;
  });
}

const finitePositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
export const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export function requestFromFields(variableId: string, lat: string, lon: string, start: string, end: string):
  { request: PointAnalysisRequest } | { error: string } {
  if (!lat.trim() || !lon.trim()) return { error: 'Enter both latitude and longitude.' };
  if (lat.includes(',') || lon.includes(',')) return { error: 'Use a dot for decimal coordinates, for example 50.45.' };
  const latitude = Number(lat), longitude = Number(lon);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return { error: 'Latitude must be between −90 and 90.' };
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return { error: 'Longitude must be between −180 and 180.' };
  if (!isMonth(start) || !isMonth(end)) return { error: 'Enter a start and end month.' };
  if (start > end) return { error: 'The start month must not be later than the end month.' };
  if (!variableId) return { error: 'Choose a variable first.' };
  return { request: { variable_id: variableId, location: { type: 'point', lat: latitude, lon: longitude }, period: { start, end } } };
}

export function requestFromAreaFields(variableId:string,fields:string[],start:string,end:string):{request:AnalysisRequest}|{error:string} {
  if(fields.length!==4||fields.some(v=>!v.trim()))return {error:'Enter all four area bounds.'};
  if(fields.some(v=>v.includes(',')))return {error:'Use a dot for decimal coordinates.'};
  const [west,south,east,north]=fields.map(Number);
  if(![west,south,east,north].every(Number.isFinite)||Math.abs(west)>180||Math.abs(east)>180||Math.abs(south)>90||Math.abs(north)>90)return {error:'Area coordinates are outside WGS84 limits.'};
  if(west>=east||south>=north)return {error:'West must be less than east, and south less than north. Boxes cannot cross 180°.'};
  if(!isMonth(start)||!isMonth(end)||start>end)return {error:'Enter an ordered period as YYYY-MM.'};
  if(!variableId)return {error:'Choose a variable first.'};
  return {request:{variable_id:variableId,location:{type:'area',bbox:[west,south,east,north]},period:{start,end}}};
}

export function sameLocation(a:unknown,b:AnalysisRequest['location']):boolean {
  if(!isObject(a)||a.type!==b.type)return false;
  return b.type==='point'?a.lat===b.lat&&a.lon===b.lon:Array.isArray(a.bbox)&&a.bbox.length===4&&a.bbox.every((v,i)=>v===b.bbox[i]);
}

export function getWarnings(data: ObjectValue): PublicWarning[] {
  if (!Array.isArray(data.warnings)) return [];
  return data.warnings.filter(isObject).filter(w => typeof w.code === 'string').map(w => ({
    code: w.code as string, ...(typeof w.date === 'string' ? { date: w.date } : {}),
    ...((typeof w.reference === 'string' && /^https?:\/\//.test(w.reference)) ? { reference: w.reference } :
      isObject(w.reference) && typeof w.reference.url === 'string' && /^https?:\/\//.test(w.reference.url) ? { reference: w.reference.url } : {}),
  }));
}

export function readProgress(data: ObjectValue): ViewState['progress'] {
  const p = data.progress;
  if (!isObject(p) || p.known !== true || typeof p.done !== 'number' || typeof p.total !== 'number' ||
      !Number.isFinite(p.done) || !Number.isFinite(p.total) || p.total <= 0 || p.done < 0 || p.done > p.total) return undefined;
  return { done: p.done, total: p.total, unit: typeof p.unit === 'string' ? p.unit : '' };
}

export function readEstimate(data:ObjectValue):number|undefined {
  const e=data.estimate_s;
  return isObject(e)&&e.kind==='estimate'&&typeof e.value==='number'&&Number.isFinite(e.value)&&e.value>=0?e.value:undefined;
}

function containsUnavailableTest(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.status === 'insufficient_for_test') return true;
  return Object.values(value).some(v => isObject(v) && containsUnavailableTest(v));
}

export function analysisState(response: ApiResponse, request: AnalysisRequest): ViewState {
  const data = response.data;
  const base = { request, warnings: getWarnings(data) };
  if (isObject(data.request)) {
    const echoed = data.request;
    if (echoed.variable_id !== request.variable_id || !sameLocation(echoed.location,request.location) ||
        !isObject(echoed.period) || echoed.period.start !== request.period.start || echoed.period.end !== request.period.end) {
      return { ...base, kind: 'protocol_error' };
    }
  }
  const known: StateKind[] = ['no_data', 'source_error', 'insufficient_for_test', 'not_implemented', 'not_found', 'invalid_request'];
  if (known.includes(data.status as StateKind)) {
    return { ...base, kind: data.status as StateKind, reason: typeof data.reason === 'string' ? data.reason : undefined };
  }
  if (isObject(data.error)) {
    const code = data.error.code;
    if (code === 'source_error' || code === 'invalid_request') return { ...base, kind: code };
  }
  if (response.httpStatus >= 400) return { ...base, kind: 'source_error', reason: 'service_unavailable' };
  if ((data.status === 'queued' || data.status === 'running') && typeof data.job_id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(data.job_id)) {
    return { ...base, kind: data.status, jobId: data.job_id, stage: typeof data.stage === 'string' ? data.stage : undefined,
      jobKind:typeof data.kind==='string'?data.kind:undefined,estimateSeconds:readEstimate(data),progress: readProgress(data), startedAt: Date.now() };
  }
  if (typeof data.analysis_id === 'string' && isObject(data.series)) {
    if (data.series.status === 'no_data') return { ...base, kind: 'no_data',reason:typeof data.series.reason==='string'?data.series.reason:undefined };
    if (data.series.status === 'insufficient_for_test') return { ...base, kind: 'insufficient_for_test' };
    if (data.series.status === 'source_error') return { ...base, kind: 'source_error' };
    if (data.series.status === 'ok') return { ...base, kind: 'ready', analysisId: data.analysis_id, result: data,
      testUnavailable: containsUnavailableTest(data.trend) };
  }
  return { ...base, kind: 'protocol_error' };
}
