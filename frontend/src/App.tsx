import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { apiRequest, isAbort } from './api';
import { isObject, parseVariables, requestFromFields } from './contract';
import type { ObjectValue, Variable } from './contract';
import { StatusNotice } from './StatusNotice';
import { useAnalysis } from './useAnalysis';
import { AnalysisView } from './AnalysisView';
import { PointMap } from './PointMap';
import { coordinate } from './format';
import outline from './assets/europe-outline.svg';

type ResourceStatus = 'loading' | 'connecting' | 'ready' | 'error';

export function App() {
  const [variables, setVariables] = useState<Variable[]>([]);
  const [catalogueStatus, setCatalogueStatus] = useState<ResourceStatus>('loading');
  const [serviceStatus, setServiceStatus] = useState<ResourceStatus>('loading');
  const [selectedId, setSelectedId] = useState('');
  const [mapStatus, setMapStatus] = useState<'loading' | 'not_ready' | 'ready' | 'error'>('loading');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [formError, setFormError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const catalogueController = useRef<AbortController | undefined>(undefined);
  const analysis = useAnalysis();
  const selected = variables.find(v => v.variable_id === selectedId);
  const busy = ['loading', 'connecting', 'queued', 'running'].includes(analysis.state.kind);

  const refresh = useCallback(() => setRefreshKey(v => v + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    catalogueController.current?.abort(); catalogueController.current = controller;
    setCatalogueStatus('loading'); setServiceStatus('loading');
    const timer = setTimeout(() => {
      if (!controller.signal.aborted) {
        setServiceStatus(old => old === 'loading' ? 'connecting' : old);
        setCatalogueStatus(old => old === 'loading' ? 'connecting' : old);
      }
    }, 2000);
    void apiRequest('/variables', { signal: controller.signal }).then(response => {
      if (controller.signal.aborted) return;
      if (response.httpStatus !== 200) throw new Error('catalogue_unavailable');
      const items = parseVariables(response.data);
      setVariables(items); setCatalogueStatus('ready');
      setSelectedId(old => items.some(v => v.variable_id === old) ? old : items[0].variable_id);
      setStart(old => old || items[0].coverage.start); setEnd(old => old || items[0].coverage.end);
    }).catch(error => { if (!controller.signal.aborted && !isAbort(error)) setCatalogueStatus('error'); });
    void apiRequest('/health', { signal: controller.signal }).then(response => {
      if (controller.signal.aborted) return;
      setServiceStatus(response.httpStatus === 200 && response.data.status === 'ok' ? 'ready' : 'error');
    }).catch(error => { if (!controller.signal.aborted && !isAbort(error)) setServiceStatus('error'); });
    return () => { clearTimeout(timer); controller.abort(); };
  }, [refreshKey]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    setMapStatus('loading');
    void apiRequest('/maps/europe', { signal: controller.signal }).then(response => {
      if (controller.signal.aborted) return;
      if (response.httpStatus !== 200 || response.data.status !== 'ok' || !Array.isArray(response.data.maps)) throw new Error('map_unavailable');
      const layer = response.data.maps.find((item: unknown) => isObject(item) && item.variable_id === selectedId) as ObjectValue | undefined;
      if (!layer || (layer.status !== 'ok' && layer.status !== 'not_ready')) throw new Error('map_unavailable');
      setMapStatus(layer.status === 'ok' ? 'ready' : 'not_ready');
    }).catch(error => { if (!controller.signal.aborted && !isAbort(error)) setMapStatus('error'); });
    return () => controller.abort();
  }, [selectedId, refreshKey]);

  useEffect(() => {
    const request = analysis.state.request;
    if (!request || !variables.some(v => v.variable_id === request.variable_id)) return;
    setSelectedId(request.variable_id); setLatitude(String(request.location.lat)); setLongitude(String(request.location.lon));
    setStart(request.period.start); setEnd(request.period.end);
  }, [analysis.state.request, variables]);

  const choose = (variable: Variable) => {
    analysis.reset(); setFormError(''); setSelectedId(variable.variable_id);
    setStart(variable.coverage.start); setEnd(variable.coverage.end);
  };
  const edit = (setter: (v: string) => void, value: string) => {
    analysis.reset(); setFormError(''); setter(value);
  };
  const pickPoint = (lat: number, lon: number) => {
    analysis.reset(); setFormError(''); setLatitude(coordinate(lat)); setLongitude(coordinate(lon));
  };
  const mapLat = latitude.trim() && Number.isFinite(Number(latitude)) && Math.abs(Number(latitude)) <= 90 ? Number(latitude) : undefined;
  const mapLon = longitude.trim() && Number.isFinite(Number(longitude)) && Math.abs(Number(longitude)) <= 180 ? Number(longitude) : undefined;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const checked = requestFromFields(selectedId, latitude, longitude, start, end);
    if ('error' in checked) { setFormError(checked.error); return; }
    setFormError(''); analysis.submit(checked.request);
  };

  const announcement = busy ? 'The request is in progress.' : {
    idle: 'Choose a place and period.', ready: 'The request completed.', no_data: 'No observations for this selection.',
    not_implemented: 'The analysis is not available yet.', source_error: 'The request could not be completed.',
    insufficient_for_test: 'The trend test cannot be run.', not_found: 'The saved request was not found.',
    invalid_request: 'The request needs a correction.', protocol_error: 'An unexpected response was received.',
  }[analysis.state.kind as 'idle'];

  return <div className="app-shell">
    <a className="skip-link" href="#workspace">Skip to workspace</a>
    <header className="app-header">
      <a className="wordmark" href="/" aria-label="Earth system trends home">EARTH SYSTEM <span>/</span> TRENDS</a>
      <nav aria-label="Workspace views"><a href="#point-selection" aria-current="page">Explore</a><a href="#series">Time series</a><a href="#changes">Change points</a></nav>
      <div className="service-indicator" role="status"><span className={`service-dot service-${serviceStatus}`} aria-hidden="true" />{serviceStatus === 'ready' ? 'Service connected' : serviceStatus === 'error' ? 'Connection unavailable' : 'Connecting to service'}<button className="text-button" onClick={refresh} aria-label="Refresh service and variable availability">Refresh <span aria-hidden="true">↻</span></button></div>
    </header>
    <div className="intro"><p className="eyebrow">EARTH OBSERVATIONS / REGIONAL CHANGE</p><h1>Inspect the signal.</h1><p className="intro-note">Choose what to measure.<br />Start with the observations.</p></div>
    <main id="workspace" className="workspace">
      <aside className="variable-panel" aria-label="Variable selection">
        <h2 className="eyebrow">Variable / source</h2>
        {catalogueStatus === 'loading' || catalogueStatus === 'connecting' ? <p className="catalogue-message" role="status">{catalogueStatus === 'connecting' ? 'Connecting to the catalogue…' : 'Loading the variable catalogue…'}</p> : null}
        {catalogueStatus === 'error' && <div className="catalogue-message"><p>The variable catalogue could not be retrieved.</p><button className="text-button" onClick={refresh}>Retry catalogue ↗</button></div>}
        {variables.length > 0 && <div className="variable-list">{variables.map((variable, i) => <button key={variable.variable_id} className="variable-option" aria-pressed={selectedId === variable.variable_id} onClick={() => choose(variable)}>
          <span className="variable-number" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span><span><span className="variable-label">{variable.label}</span><span className="variable-source">{variable.source.mission_or_model}</span></span>
        </button>)}</div>}
        <p className="panel-footnote">Satellite observations and Earth system models. Coverage depends on the product.</p>
      </aside>

      <section id="series" className={`evidence-stage ${analysis.state.kind === 'idle' ? 'stage-idle' : 'stage-active'}`} aria-label="Request and data status">
        <div className="stage-heading"><span className="eyebrow">Point analysis</span><span className="layer-state">Europe trend layer: {mapStatus === 'ready' ? 'Prepared layer available' : mapStatus === 'not_ready' ? 'Not ready' : mapStatus === 'error' ? 'Layer status unavailable' : 'Checking availability'}</span></div>
        <img className="geographic-outline" src={outline} alt="" aria-hidden="true" />
        {analysis.state.kind === 'idle' ? <div className="empty-stage">
          <div className="empty-brackets" aria-hidden="true"><span>[</span><span>]</span></div>
          <p className="eyebrow">{mapStatus === 'not_ready' ? 'No computed trend layer returned' : 'Your next question'}</p>
          <h2>{mapStatus === 'error' ? 'The layer could not be checked.' : mapStatus === 'ready' ? 'Begin with a point.' : 'The record comes first.'}</h2>
          <p>{mapStatus === 'not_ready' ? 'The service has not returned a computed trend map for this variable. You can still send a point request.' : mapStatus === 'error' ? 'The map status is unavailable. This does not mean there are no observations at your location.' : 'Enter coordinates and a period to check the observations available for your selection.'}</p>
          <p className="outline-caption">Geographic outline only. No trend values are displayed.</p>
        </div> : analysis.state.kind === 'ready' && analysis.state.result && selected ? <AnalysisView key={analysis.state.analysisId} state={analysis.state} variable={selected} /> : <StatusNotice state={analysis.state} onRetry={analysis.retry} onRefresh={refresh} />}
        <div className="map-credit">Geographic outline: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a></div>
      </section>

      <aside id="point-selection" className="selection-panel" aria-label="Request selection">
        <p className="eyebrow">Your selection</p><h2>Start with a point.</h2>
        <p className="selection-intro">Coordinates can refer to any location. The service checks the selected product’s coverage.</p>
        <PointMap lat={mapLat} lon={mapLon} onPick={pickPoint} />
        <form onSubmit={submit} noValidate>
          <fieldset disabled={!selected}><legend>Coordinates <span>WGS84</span></legend>
            <div className="coordinate-fields"><label htmlFor="latitude">Latitude<input id="latitude" name="latitude" inputMode="decimal" type="text" lang="en" spellCheck={false} placeholder="e.g. 50.45" value={latitude} onChange={e => edit(setLatitude, e.target.value)} aria-describedby="coordinate-help" /></label>
              <label htmlFor="longitude">Longitude<input id="longitude" name="longitude" inputMode="decimal" type="text" lang="en" spellCheck={false} placeholder="e.g. 30.52" value={longitude} onChange={e => edit(setLongitude, e.target.value)} aria-describedby="coordinate-help" /></label></div>
            <p id="coordinate-help" className="field-help">Latitude −90 to 90. Longitude −180 to 180. Use a dot for decimals.</p>
          </fieldset>
          <fieldset disabled={!selected}><legend>Analysis period</legend>
            <div className="period-fields"><label htmlFor="start-month">From<input id="start-month" type="text" inputMode="numeric" lang="en" maxLength={7} placeholder="YYYY-MM" aria-describedby="period-help" value={start} onChange={e => edit(setStart, e.target.value)} /></label>
              <label htmlFor="end-month">To<input id="end-month" type="text" inputMode="numeric" lang="en" maxLength={7} placeholder="YYYY-MM" aria-describedby="period-help" value={end} onChange={e => edit(setEnd, e.target.value)} /></label></div><p id="period-help" className="field-help">Enter year-month, for example 2000-01.</p>
          </fieldset>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <button className="button button-primary request-button" type="submit" disabled={!selected || busy}>{busy ? 'Request in progress' : 'Request analysis'} <span aria-hidden="true">↗</span></button>
          {busy && <p className="field-help">Changing the selection stops following this request; it does not cancel the server task.</p>}
          {selected?.capabilities.point === 'not_implemented' && <p className="capability-note">The service currently reports this analysis as unavailable. It will confirm the state for your request.</p>}
        </form>
        {selected && <details className="product-details"><summary>Selected product <span aria-hidden="true">+</span></summary><dl>
          <div><dt>Variable</dt><dd>{selected.label}</dd></div>
          <div><dt>Model / mission</dt><dd>{selected.source.mission_or_model}</dd></div>
          <div><dt>Product</dt><dd>{selected.source.product} · {selected.source.version}</dd></div>
          <div><dt>Product coverage</dt><dd>{selected.coverage.start} — {selected.coverage.end}</dd></div>
          <div><dt>Native grid</dt><dd>{selected.native_resolution.lat_deg}° × {selected.native_resolution.lon_deg}°</dd></div>
          <div><dt>Units</dt><dd>{selected.unit}</dd></div>
        </dl><a href={`https://doi.org/${encodeURI(selected.source.doi)}`} target="_blank" rel="noreferrer">Data product reference ↗</a></details>}
      </aside>
    </main>
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
    <footer className="app-footer"><span>No observations are replaced with invented values. Missing values are not zero.</span><span>NASA SPACE APPS 2026 <span className="footer-divider">/</span> EN</span></footer>
  </div>;
}
