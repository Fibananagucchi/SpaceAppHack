import { useEffect, useId, useState } from 'react';
import { number } from './format';
import type { PublicWarning, StateKind, ViewState } from './contract';

const copy: Record<StateKind, { label: string; title: string; description: string }> = {
  idle: { label: 'Your question', title: 'Start with a place.', description: 'Choose a variable, enter coordinates and set the period you want to examine.' },
  loading: { label: 'Request sent', title: 'Retrieving observations…', description: 'Your place and period stay attached to this request. No values are shown while it is running.' },
  connecting: { label: 'Connecting', title: 'Connecting to the analysis service…', description: 'Waiting for a response. A slow connection does not tell us whether observations are available.' },
  queued: { label: 'Queued', title: 'Your request is queued.', description: 'The service has accepted the request. Observations are not available yet.' },
  running: { label: 'In progress', title: 'Retrieving observations…', description: 'The service is working on this selection. Missing observations will not be replaced with invented values.' },
  ready: { label: 'Request complete', title: 'Observations received.', description: 'The service returned observations for this selection.' },
  no_data: { label: 'No observations', title: 'No observations for this selection.', description: 'Try another place, period or variable. No observations is different from a measured value of zero.' },
  source_error: { label: 'Request unavailable', title: 'The source could not complete this request.', description: 'Your selection is preserved. This failure does not mean that observations are absent.' },
  insufficient_for_test: { label: 'Test unavailable', title: 'Not enough evidence for this test.', description: 'Observations may exist, but this test cannot be run on the returned series. No statistic is substituted.' },
  not_implemented: { label: 'Analysis unavailable', title: 'This analysis is not available yet.', description: 'The service recognised the request but cannot perform this analysis yet. Your selection is preserved.' },
  not_found: { label: 'Request not found', title: 'This request is no longer available.', description: 'Your selection is preserved. Run the request again; an unavailable saved request is not a finding of no data.' },
  invalid_request: { label: 'Check your selection', title: 'The request needs a correction.', description: 'Check the variable, coordinates and start and end months before trying again.' },
  protocol_error: { label: 'Response unavailable', title: 'This response could not be read.', description: 'The service returned an unexpected response. No result has been substituted.' },
};

const stageCopy: Record<string, string> = {
  queued: 'Waiting in the queue', waiting_for_source: 'Waiting for the data source',
  downloading: 'Retrieving observations', computing: 'Analysing the observations',
};

export function WarningNotices({ warnings }: { warnings: PublicWarning[] }) {
  const boundary = warnings.filter(w => w.code === 'product_boundary_in_period');
  const nearBoundary = warnings.some(w=>w.code==='change_near_product_boundary');
  const other: Record<string, string> = {
    series_ended: 'The service reports that this product’s available record has ended or is not current.',
    partial_period: 'Only part of the requested period is covered by this product.',
    many_missing: 'The returned series contains many missing observations.',
    climatology_incomplete: 'Some calendar months lack enough observations to define monthly anomalies.',
    change_may_affect_trend: 'A possible abrupt change may affect the whole-period trend estimate. Inspect the change and both segments.',
    source_unreachable_cached_copy: 'The source is currently unreachable. The service returned saved observations.',
  };
  return <>
    {boundary.length > 0 && <aside className="warning-notice" aria-label="Product boundary">
      <span className="warning-symbol" aria-hidden="true">│</span>
      <div><strong>Documented product boundaries — check the record.</strong>
        <p>Documented changes in processing or instruments occur in this period. They can affect the record; their presence does not establish the cause of an observed change.</p>
        <ul>{boundary.map((b,i)=><li key={i}>{b.date ?? 'Date not returned'}{b.reference && <> · <a href={b.reference} target="_blank" rel="noreferrer">Product documentation ↗</a></>}</li>)}</ul>
      </div>
    </aside>}
    {nearBoundary&&<aside className="warning-notice"><p>The service reports that the candidate date is near a documented product boundary. Temporal proximity does not establish an artifact or a cause.</p></aside>}
    {warnings.filter(w => other[w.code]).map((w, i) => <aside className="warning-notice" key={`${w.code}-${i}`}><p>{other[w.code]}</p></aside>)}
  </>;
}

export function StatusNotice({ state, onRetry, onRefresh, purpose='analysis' }: { state: ViewState; onRetry?: () => void; onRefresh?: () => void;purpose?:'analysis'|'investigation' }) {
  const progressId=useId();
  const [elapsed, setElapsed] = useState(0);
  const busy = ['loading', 'connecting', 'queued', 'running'].includes(state.kind);
  useEffect(() => {
    if (!busy || !state.startedAt) { setElapsed(0); return; }
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - state.startedAt!) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [busy, state.startedAt]);
  const info = copy[state.kind];
  const unavailableService = state.kind === 'source_error' && state.reason === 'service_unavailable';
  const tooSmall=state.kind==='no_data'&&state.reason==='area_smaller_than_grid_cell';
  const title = purpose==='investigation'&&busy?'Checking the wider context…':tooSmall?'This area contains no grid-cell centres.':unavailableService ? 'Could not reach the analysis service.' : info.title;
  const retryable = ['source_error', 'not_found', 'protocol_error'].includes(state.kind);
  return <div className={`status-notice status-${state.kind}`} data-state={state.kind}>
    <div className="state-brackets" aria-hidden="true"><span>[</span><span>]</span></div>
    <p className="eyebrow">{info.label}</p>
    <h2>{title}</h2>
    <p className="state-description">{purpose==='investigation'&&busy?'The trend result stays available while context is checked. No cause has been assigned.':tooSmall?'Enlarge the area or choose a point. No value has been substituted.':info.description}</p>
    {state.stage && stageCopy[state.stage] && busy && <p className="stage-label">{stageCopy[state.stage]}</p>}
    {busy && <div className="request-progress">
      {state.progress && state.kind !== 'connecting' ? <>
        <label htmlFor={progressId}>{number(state.progress.done)} of {number(state.progress.total)}{state.jobKind==='modis_point'&&state.progress.unit==='months'?' monthly files checked':`${state.progress.unit ? ` ${state.progress.unit}` : ''} completed`}</label>
        <progress id={progressId} max={state.progress.total} value={state.progress.done} />
      </> : <p className="text-muted">Progress has not been reported.</p>}
      <span className="elapsed">Elapsed {Math.floor(elapsed / 60).toString().padStart(2, '0')}:{(elapsed % 60).toString().padStart(2, '0')}</span>
      {state.estimateSeconds!==undefined&&<p className="field-help">Source estimate: about {number(state.estimateSeconds/60,1)} minutes. This is an estimate, not a countdown.</p>}
    </div>}
    {state.testUnavailable && state.kind !== 'insufficient_for_test' && <aside className="warning-notice"><p>Observations are available. One or more trend tests cannot be run on this series.</p></aside>}
    <WarningNotices warnings={state.warnings} />
    {state.request && <dl className="request-receipt">
      <div><dt>Requested {state.request.location.type}</dt><dd>{state.request.location.type==='point'?`${state.request.location.lat}° latitude / ${state.request.location.lon}° longitude`:`W/S/E/N: ${state.request.location.bbox.join(' / ')}°`}</dd></div>
      <div><dt>Requested period</dt><dd>{state.request.period.start} — {state.request.period.end}</dd></div>
    </dl>}
    {retryable && onRetry && <button className="button button-secondary" onClick={onRetry}>{state.kind === 'not_found' ? 'Run request again' : 'Retry request'} <span aria-hidden="true">↗</span></button>}
    {state.kind === 'not_implemented' && onRefresh && <button className="button button-secondary" onClick={onRefresh}>Refresh availability <span aria-hidden="true">↗</span></button>}
  </div>;
}
