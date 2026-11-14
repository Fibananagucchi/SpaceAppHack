import { useState } from 'react';
import type { ObjectValue, Variable, ViewState } from './contract';
import { isMonth } from './contract';
import { finite, method, pointsFrom, record, text, unavailable } from './analysis';
import type { DisplayMode } from './analysis';
import { coordinate, month, number, pValue, signed, timestamp } from './format';
import { TimeSeries } from './TimeSeries';
import type { ChartLine } from './TimeSeries';
import { WarningNotices } from './StatusNotice';
import { ChangePanel, markersFrom } from './ChangePanel';

export function chartLine(value: unknown, key: string, label: string): ChartLine[] {
  const line = record(value);
  if (line.status !== 'ok' || !Array.isArray(line.points)) return [];
  if (!line.points.every(p=>record(p)===p&&isMonth(p.t)&&finite(p.y))) return [];
  const points = line.points as {t:string;y:number}[];
  return points.length >= 2 ? [{key,label,points,dashed:true}] : [];
}

function Confidence({value}: {value: unknown}) {
  const ci = record(value);
  return finite(ci.level) && finite(ci.low) && finite(ci.high) ? <p className="metric-detail">{number(ci.level*100)}% CI: {signed(ci.low)} to {signed(ci.high)}<span>Interval of the slope estimate</span></p> : <p className="metric-detail">Confidence interval not available</p>;
}
function TestResult({name,value}: {name:string;value:ObjectValue}) {
  const available = value.status === 'ok' && finite(value.p_value) && typeof value.significant === 'boolean';
  return <article className="test-result"><h4>{name}</h4>{available ? <><p className="test-verdict">{value.significant ? 'Trend detected' : 'Trend not detected'}</p><p className="test-numbers">p = {pValue(value.p_value)} · α = {number(value.alpha)}</p>{finite(value.estimate) && <p className="metric-detail">Slope: {signed(value.estimate)} {text(value.unit)}</p>}{Boolean(value.ci) && <Confidence value={value.ci} />}{typeof value.variant === 'string' && <p className="field-help">{value.variant}</p>}{finite(value.n_effective) && <p className="field-help">Effective sample size: {number(value.n_effective)} of {number(value.n)}</p>}</> : <><p className="test-verdict">{value.status === 'not_applicable' ? 'Not applicable' : 'Test unavailable'}</p><p className="field-help">{unavailable(value)}</p></>}</article>;
}
export function Evidence({data,mode}: {data:ObjectValue;mode:DisplayMode}) {
  const trend = method(data.trend,mode);
  const sen = method(trend,mode === 'raw' ? 'seasonal_sen_slope' : 'sen_slope');
  const mk = method(trend,mode === 'raw' ? 'seasonal_kendall' : 'mann_kendall');
  const ols = method(trend,'ols_t_test');
  const slopeAvailable = sen.status === 'ok' && finite(sen.estimate);
  const direction = slopeAvailable ? (Number(sen.estimate)>0 ? 'Increasing' : Number(sen.estimate)<0 ? 'Decreasing' : 'No estimated change') : 'Direction unavailable';
  const agreement: Record<string,string> = {both_significant:'Both tests detect a trend',both_not_significant:'Neither test detects a trend',tests_disagree:'The tests disagree',not_available:'Evidence is incomplete'};
  const verdict = mode === 'raw' ? (mk.status === 'ok' && typeof mk.significant === 'boolean' ? (mk.significant ? 'Seasonal test detects a trend' : 'Seasonal test does not detect a trend') : 'Evidence is incomplete') : agreement[String(trend.agreement)] ?? 'Evidence is incomplete';
  return <section className="evidence-summary" aria-label="Trend evidence">
    <div className="rate-summary"><div><p className="eyebrow">Direction / {mode === 'raw' ? 'seasonal Sen' : 'Sen’s slope'}</p><h3>{direction}</h3></div><div className="rate-value">{slopeAvailable ? <><strong>{signed(Number(sen.estimate))}</strong><span>{text(sen.unit)}</span></> : <span>No estimate substituted</span>}</div></div>
    {slopeAvailable ? <Confidence value={sen.ci} /> : <p className="field-help">{unavailable(sen)}</p>}
    <div className="evidence-verdict"><p className="eyebrow">Strength of evidence</p><h3>{verdict}.</h3><p>{slopeAvailable ? `The estimated direction is ${Number(sen.estimate)>0?'upward':Number(sen.estimate)<0?'downward':'flat'} over this analysis period. ` : 'The service could not estimate a direction for this analysis. '}{mode === 'raw' ? 'The seasonal test compares matching calendar months. Switch to monthly anomalies to compare Mann–Kendall and OLS.' : trend.agreement === 'both_significant' ? 'Mann–Kendall and the OLS t-test both meet the service’s significance threshold. This is evidence of a trend under these methods, not proof of a cause.' : trend.agreement === 'both_not_significant' ? 'Neither test meets its significance threshold. This does not establish that nothing is changing.' : trend.agreement === 'tests_disagree' ? 'The tests answer different statistical questions and give different decisions here. Interpret the direction with care.' : 'One or more tests are unavailable. Available observations and estimates remain visible.'}</p></div>
    <div className="test-grid"><TestResult name={mode === 'raw' ? 'Seasonal Kendall' : 'Mann–Kendall'} value={mk} /><TestResult name="OLS + t-test" value={ols} /></div>
    <details className="method-notes"><summary>What do these numbers mean?</summary><p>Sen’s slope is the median of pairwise rates of change. Its interval describes uncertainty in the slope, not a band around observations. A decade is ten years.</p><p>A p-value describes how unusual the test statistic would be under the method’s no-trend model. It is not the probability that the trend is real. The service’s boolean decision is used directly, before display rounding.</p><p>{mode==='raw'?'Seasonal Kendall compares observations within matching calendar months. No Hamed–Rao correction or OLS line is reported for this raw-series test. Dependence can limit its interpretation.':'Mann–Kendall tests monotonic change, with a Hamed–Rao autocorrelation adjustment here. OLS fits a straight line; its t-test uses an effective sample size. Dependence and missing observations limit these methods.'}</p><p><a href="https://doi.org/10.1080/01621459.1968.10480934" target="_blank" rel="noreferrer">Sen’s method</a> · <a href="https://doi.org/10.1016/S0022-1694(97)00125-X" target="_blank" rel="noreferrer">Hamed–Rao correction</a> · <a href="https://doi.org/10.1029/1999JD901105" target="_blank" rel="noreferrer">Effective sample size</a></p></details>
  </section>;
}

export function DataPassport({data,variable}: {data:ObjectValue;variable:Variable}) {
  const series = record(data.series), source = record(data.provenance), location = record(data.location_resolved), cell = record(location.grid_cell), coverage = record(series.coverage), climatology = record(series.climatology);
  const period = (value:unknown) => {const p=record(value);return `${month(p.start)} — ${month(p.end)}`;};
  const serviceNames: Record<string,string> = {europe_cube:'Prepared Europe cube (NASA GES DISC)',giovanni_time_series:'NASA Giovanni time series'};
  return <details className="data-passport"><summary>Data passport <span>Source / coverage / processing</span></summary><dl className="passport-grid">
    <div><dt>Variable</dt><dd>{variable.label}</dd></div><div><dt>Mission / model</dt><dd>{variable.source.mission_or_model}</dd></div>
    <div><dt>Product / version</dt><dd>{text(source.product)} / {text(source.version)}</dd></div><div><dt>Source path</dt><dd>{serviceNames[String(source.source_service)] ?? 'Not available'}</dd></div>
    <div><dt>Requested period</dt><dd>{period(data.requested_period)}</dd></div><div><dt>Analysis period used</dt><dd>{period(data.analysis_period)}</dd></div>
    <div><dt>Available observation record</dt><dd>{period(data.observations_period)}</dd></div><div><dt>Analysis coverage</dt><dd>{number(coverage.valid)} valid / {number(coverage.expected)} expected months</dd></div>
    <div><dt>Requested point</dt><dd>{finite(record(location.requested).lat) && finite(record(location.requested).lon) ? `${coordinate(Number(record(location.requested).lat))}° / ${coordinate(Number(record(location.requested).lon))}°` : 'Not available'}</dd></div>
    <div><dt>Resolved grid cell centre</dt><dd>{finite(cell.center_lat) && finite(cell.center_lon) ? `${coordinate(cell.center_lat)}° / ${coordinate(cell.center_lon)}°` : 'Not available'}</dd></div>
    <div><dt>Native cell size</dt><dd>{number(cell.lat_res)}° latitude × {number(cell.lon_res)}° longitude</dd></div><div><dt>Units / frequency</dt><dd>{text(series.unit)} / {text(series.frequency)}</dd></div>
    <div><dt>Retrieved</dt><dd>{timestamp(source.retrieved_at)}</dd></div><div><dt>Saved source response</dt><dd>{source.from_cache === true ? 'Yes' : source.from_cache === false ? 'No' : 'Not available'}</dd></div>
    <div><dt>Processing version</dt><dd>{text(source.processing_version)}</dd></div><div><dt>Anomaly baseline</dt><dd>{period(climatology.base_period)}</dd></div>
    <div className="passport-wide"><dt>Monthly anomaly rule</dt><dd>{text(climatology.rule)}</dd></div><div className="passport-wide"><dt>Unit conversion</dt><dd>{series.unit_conversion===null?'No unit conversion reported':text(series.unit_conversion)}</dd></div>
    <div className="passport-wide"><dt>Aggregation</dt><dd>{series.aggregation === null ? 'No additional aggregation reported' : typeof series.aggregation === 'string' ? series.aggregation : text(record(series.aggregation).rule)}</dd></div>
  </dl>{typeof source.doi === 'string' && /^10\.\d{4,9}\//.test(source.doi) && <a href={`https://doi.org/${encodeURI(source.doi)}`} target="_blank" rel="noreferrer">Source dataset DOI: {source.doi} ↗</a>}<p className="field-help">A grid cell represents an area, not a measurement at the exact clicked coordinate. Missing values are retained. A fitted trend does not identify its cause.</p></details>;
}

export function AnalysisView({state,variable}: {state:ViewState;variable:Variable}) {
  const [mode,setMode] = useState<DisplayMode>(() => pointsFrom(record(state.result?.series).points)?.some(p=>p.anomaly!==null) ? 'monthly_anomalies' : 'raw');
  const [showFits,setShowFits] = useState(true);
  const [fitScope,setFitScope] = useState<'whole'|'segments'>('whole');
  const [selectedMarker,setSelectedMarker] = useState<string|undefined>(()=>markersFrom(state.result!).find(m=>m.kind==='change')?.id);
  const data = state.result!;
  const series = record(data.series), points = pointsFrom(series.points);
  const trend = method(data.trend,mode), fit = record(trend.trend_line);
  const breaks=record(data.breaks), markers=markersFrom(data);
  const inspectMarker=(id:string,fromChart:boolean)=>{
    setSelectedMarker(id);
    const target=document.getElementById(fromChart?'changes':'observed-series-plot');
    target?.focus();
    target?.scrollIntoView?.({block:'start',behavior:'auto'});
  };
  const segmentFits=Array.isArray(breaks.segments)?breaks.segments.flatMap((s,i)=>{
    const segment=record(s);
    return segment.status==='ok'?chartLine(segment.trend_line,`segment-${i}`,`${i===0?'Before':'After'} / Sen fit`):[];
  }):[];
  const lines = showFits && mode !== 'raw' ? (fitScope==='segments'?segmentFits:[...chartLine(fit.sen,'sen','Sen fit'),...chartLine(fit.ols,'ols','OLS fit')]) : [];
  return <div className="analysis-view">
    <div className="analysis-title"><p className="eyebrow">Observed record / {state.analysisId}</p><h2>{variable.label}</h2><p>{variable.definition}</p></div>
    <WarningNotices warnings={state.warnings} />
    <div className="chart-toolbar"><div role="group" aria-label="Series display"><button aria-pressed={mode==='raw'} onClick={()=>setMode('raw')}>Monthly observations</button><button aria-pressed={mode==='monthly_anomalies'} onClick={()=>setMode('monthly_anomalies')}>Monthly anomalies</button></div><label className="fit-toggle"><input type="checkbox" checked={showFits} onChange={e=>setShowFits(e.target.checked)} disabled={mode==='raw'} />Show fitted trends</label></div>
    {Array.isArray(breaks.segments)&&breaks.segments.length>0&&<div className="fit-scope" role="group" aria-label="Trend fit scope"><button aria-pressed={fitScope==='whole'} onClick={()=>{setFitScope('whole');setShowFits(true);}}>Whole-period fits</button><button aria-pressed={fitScope==='segments'} disabled={segmentFits.length===0||mode==='raw'} onClick={()=>{setFitScope('segments');setShowFits(true);}}>Before / after fits</button><p className="field-help">{mode==='raw'?'Segment fits use monthly anomalies; switch the display to compare them.':segmentFits.length===0?'Segment fits are unavailable; no line has been substituted.':`${number(segmentFits.length)} of ${number(breaks.segments.length)} segment fits available. Same observations and anomaly baseline; context, not a causal explanation.`}</p></div>}
    <p className="field-help">{mode==='raw' ? 'Original monthly values. Seasonal patterns remain.' : `Each value minus the mean for its calendar month over ${month(record(series.climatology).base_period && record(record(series.climatology).base_period).start)} — ${month(record(record(series.climatology).base_period).end)}. The baseline changes with the analysis period.`}</p>
    {points ? <TimeSeries key={state.analysisId} points={points} mode={mode} unit={text(series.unit)} lines={lines} markers={markers} selectedMarker={selectedMarker} onSelectMarker={id=>inspectMarker(id,true)} /> : <p className="warning-notice" role="alert">The series could not be read. No chart values have been substituted.</p>}
    <Evidence data={data} mode={mode} />
    <ChangePanel data={data} selected={selectedMarker} onSelect={id=>inspectMarker(id,false)} />
    <DataPassport data={data} variable={variable} />
  </div>;
}
