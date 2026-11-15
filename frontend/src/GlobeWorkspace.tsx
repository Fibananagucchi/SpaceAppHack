import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { apiRequest, isAbort } from './api';
import { isMonth, parseVariables, requestFromAreaFields, requestFromFields } from './contract';
import type { AnalysisRequest, Variable, ViewState } from './contract';
import { finite, method, pointsFrom, record, safeLink } from './analysis';
import type { SeriesPoint } from './analysis';
import { coordinate, month, signed, headlineSigned, number } from './format';
import { useAnalysis } from './useAnalysis';
import { useInvestigation } from './useInvestigation';
import { useGlobeData, useNeighborStrip } from './useGlobeData';
import { frameLayer, parseAnnual } from './globeData';
import { Globe } from './Globe';
import { globeCell } from './globeGeometry';
import type { GeoPoint, GlobeLayer } from './globeGeometry';
import { GlobeTimeStrip } from './GlobeTimeStrip';
import { GlobeCounterDirections } from './GlobeCounterDirections';
import { cellLocation } from './trendMap';
import { AnalysisView } from './AnalysisView';
import { ConclusionCard } from './GlobeConclusionCard';
import { useGlobeChanges } from './useGlobeChanges';
import { changesInYear } from './globeChanges';
import type { MapChange, ChangeLayer, GlobeEvent } from './globeChanges';
import { ChangesLegend, ChangeBrowser, SelectedChange, EventEvidence } from './GlobeChangeEvidence';
import { StatusNotice } from './StatusNotice';
import { Drawer } from './Drawer';
import { Onboarding } from './Onboarding';
import recipes from './assets/cases.json';
import { resolveCases, readWorkspaceLink, resolveWorkspaceLink, chooseDisplayYear } from './casePresets';
import type { ExploreCase } from './casePresets';
import { ExploreCases, CaseEvidence } from './ExploreCases';

const scmLicence = new URL('../third_party/ScientificColourMaps-LICENCE.pdf', import.meta.url).href;
const labels: Record<string, string> = {
  t2m: 'Air temperature',
  precip: 'Precipitation',
  soil_moisture: 'Soil moisture',
  evapotranspiration: 'Evapotranspiration',
  surface_runoff: 'Runoff',
  airs_surface_air_temp: 'Satellite air temp',
  no2_tropo: 'NO₂',
  ndvi: 'Vegetation',
  lst_day: 'Land surface temp',
};
const idle: ViewState = { kind: 'idle', warnings: [] };

function SamplingNote({ grid }: { grid: unknown }) {
  const aggregation = record(record(grid).aggregation),
    sampling = record(aggregation.sampling),
    step = record(sampling.sampled_step_deg),
    cells = record(aggregation.native_cells_per_box);
  if (!finite(step.lat) || !finite(step.lon)) return null;
  return (
    <p>
      Source sample spacing: {number(step.lat)}° latitude × {number(step.lon)}° longitude.{' '}
      {finite(cells.min) && finite(cells.max) ? `${number(cells.min)}–${number(cells.max)} sampled native cells per display box. ` : ''}
      {typeof sampling.rule === 'string' ? sampling.rule : ''}
    </p>
  );
}

export function GlobeWorkspace() {
  const [urlLink, setUrlLink] = useState(() => readWorkspaceLink(window.location.search)),
    booted = useRef(false),
    firstBoot = useRef(true),
    [restorePending] = useState(() => !window.location.search);
  const initialRecipe = recipes.find((c) => c.id === urlLink.caseId);
  const [caseDrawer, setCaseDrawer] = useState(false),
    [activeCase, setActiveCase] = useState<ExploreCase>(),
    [requestedYear, setRequestedYear] = useState(urlLink.year ?? initialRecipe?.year ?? 2025),
    [yearIntent, setYearIntent] = useState<'default' | 'explicit'>(urlLink.year !== undefined || initialRecipe ? 'explicit' : 'default'),
    [yearNotice, setYearNotice] = useState('');
  const [variables, setVariables] = useState<Variable[]>([]),
    [catalogue, setCatalogue] = useState<'loading' | 'ready' | 'error'>('loading'),
    [service, setService] = useState<'loading' | 'ready' | 'error'>('loading'),
    [selectedId, setSelectedId] = useState(urlLink.variable ?? initialRecipe?.variable ?? ''),
    [refresh, setRefresh] = useState(0);
  const [kind, setKind] = useState<'point' | 'area'>('point'),
    [latitude, setLatitude] = useState(''),
    [longitude, setLongitude] = useState(''),
    [bounds, setBounds] = useState(['', '', '', '']),
    [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [error, setError] = useState('');
  const [controls, setControls] = useState(false),
    [evidence, setEvidence] = useState(false),
    [guide, setGuide] = useState(false),
    [layerMode, setLayerMode] = useState<'annual' | 'trend' | 'changes'>(
      urlLink.layer ?? (initialRecipe?.layer as 'annual' | 'trend' | 'changes') ?? 'changes',
    ),
    [year, setYear] = useState<number>(urlLink.year ?? initialRecipe?.year ?? 2025),
    [focusKey, setFocusKey] = useState(0),
    [inspection, setInspection] = useState<GeoPoint & { water?: boolean }>();
  const [pointA, setPointA] = useState<GeoPoint>(),
    [pointB, setPointB] = useState<GeoPoint>(),
    [pairGridKey, setPairGridKey] = useState('');
  const [pairA, setPairA] = useState<number>(),
    [pairB, setPairB] = useState<number>(),
    [slot, setSlot] = useState<'A' | 'B'>(),
    [overview, setOverview] = useState<{ key: string; points: SeriesPoint[] }>();
  const selected = variables.find((v) => v.variable_id === selectedId),
    analysis = useAnalysis(restorePending),
    state = analysis.state,
    data = state.kind === 'ready' ? state.result : undefined,
    cp = record(record(data?.breaks).change_point);
  const context = useInvestigation(
    typeof data?.analysis_id === 'string' ? data.analysis_id : '',
    typeof cp.change_id === 'string' ? cp.change_id : '',
  );
  const safeContext = {
    ...context,
    state:
      context.state.kind === 'ready' &&
      (context.state.result?.analysis_id !== data?.analysis_id || context.state.result?.change_id !== cp.change_id)
        ? idle
        : context.state,
  };
  const resources = useGlobeData(selected, refresh),
    frames = resources.frames.data,
    map = resources.map.data;
  const changes = useGlobeChanges(selected, refresh),
    [selectedChange, setSelectedChange] = useState<{ marker: MapChange; layer: ChangeLayer }>(),
    [selectedEvent, setSelectedEvent] = useState<GlobeEvent>(),
    [autoContext, setAutoContext] = useState<AnalysisRequest['location']>(),
    [cellFallback, setCellFallback] = useState('');
  const cases = useMemo(
    () =>
      resolveCases(
        recipes,
        variables,
        changes.allEvents.map((e) => e.raw),
      ),
    [variables, changes.allEvents],
  );
  const yearChanges = useMemo(() => changesInYear(changes.resource.data, year), [changes.resource.data, year]);
  const yearEvents = useMemo(
    () => changes.events.filter((e) => year !== undefined && Number(e.start.slice(0, 4)) <= year && Number(e.end.slice(0, 4)) >= year),
    [changes.events, year],
  );
  const mapGridKey = map ? `${selectedId}/${resources.map.domain}/${map.rows}/${map.cols}/${map.start}/${map.end}` : '',
    validA = pairGridKey === mapGridKey ? pairA : undefined,
    validB = pairGridKey === mapGridKey ? pairB : undefined;
  useEffect(() => setSlot(undefined), [mapGridKey]);
  const point =
    latitude.trim() &&
    longitude.trim() &&
    Number.isFinite(Number(latitude)) &&
    Number.isFinite(Number(longitude)) &&
    Math.abs(Number(latitude)) <= 90 &&
    Math.abs(Number(longitude)) <= 180
      ? { lat: Number(latitude), lon: Number(longitude) }
      : undefined;
  const areaCheck = requestFromAreaFields(selectedId, bounds, start, end),
    bbox = 'request' in areaCheck && areaCheck.request.location.type === 'area' ? areaCheck.request.location.bbox : undefined;
  const annual = useMemo(() => parseAnnual(record(data?.series).annual), [data]),
    nativePoint = data && state.request?.location.type === 'point' ? state.request.location : undefined;
  const neighbors = useNeighborStrip(selectedId, nativePoint, refresh, resources.frames.domain ?? 'europe'),
    busy = ['loading', 'connecting', 'queued', 'running'].includes(state.kind);
  useEffect(() => {
    const c = new AbortController();
    setCatalogue('loading');
    setService('loading');
    void apiRequest('/variables', { signal: c.signal })
      .then((r) => {
        if (c.signal.aborted) return;
        if (r.httpStatus !== 200) throw Error();
        const v = parseVariables(r.data).sort((a, b) =>
          a.variable_id === 'evapotranspiration' ? -1 : b.variable_id === 'evapotranspiration' ? 1 : 0,
        );
        setVariables(v);
        setCatalogue('ready');
        setSelectedId((old) => (v.some((item) => item.variable_id === old) ? old : v[0].variable_id));
        setStart((old) => old || v[0].coverage.start);
        setEnd((old) => old || v[0].coverage.end);
      })
      .catch((e) => {
        if (!c.signal.aborted && !isAbort(e)) setCatalogue('error');
      });
    void apiRequest('/health', { signal: c.signal })
      .then((r) => {
        if (!c.signal.aborted) setService(r.httpStatus === 200 && r.data.status === 'ok' ? 'ready' : 'error');
      })
      .catch((e) => {
        if (!c.signal.aborted && !isAbort(e)) setService('error');
      });
    return () => c.abort();
  }, [refresh]);
  useEffect(() => {
    if (!state.request) return;
    const r = state.request;
    setSelectedId(r.variable_id);
    setStart(r.period.start);
    setEnd(r.period.end);
    setKind(r.location.type);
    if (r.location.type === 'point') {
      setLatitude(String(r.location.lat));
      setLongitude(String(r.location.lon));
    } else setBounds(r.location.bbox.map(String));
    if (state.kind !== 'ready') return;
    const points = pointsFrom(record(state.result?.series).points);
    if (!points) return;
    const key = JSON.stringify([r.variable_id, r.location]);
    setOverview((old) =>
      old?.key === key && old.points[0].t <= points[0].t && old.points.at(-1)!.t >= points.at(-1)!.t ? old : { key, points },
    );
  }, [state]);
  const validFrameYears = useMemo(() => frames?.years.filter((_, i) => frames.frames[i].some((v) => v !== null)), [frames]);
  useEffect(() => {
    const period =
        layerMode === 'changes' && changes.resource.data
          ? { start: changes.resource.data.start, end: changes.resource.data.end }
          : undefined,
      candidateYears =
        layerMode === 'changes' && yearIntent === 'default' && changes.resource.data
          ? [...new Set(changes.resource.data.markers.map((m) => Number(m.date.slice(0, 4))))]
          : undefined,
      choice = chooseDisplayYear(requestedYear, validFrameYears, period, candidateYears);
    if (choice.year !== undefined) setYear(choice.year);
    setYearNotice(choice.notice ?? '');
  }, [validFrameYears, changes.resource.data, layerMode, requestedYear, yearIntent]);
  const displayYear = (value: number) => {
    setRequestedYear(value);
    setYearIntent('explicit');
    setYear(value);
    setYearNotice('');
  };

  const layer = useMemo<GlobeLayer | undefined>(
    () =>
      layerMode !== 'trend'
        ? frames && frames.years.includes(year ?? frames.years.at(-1)!)
          ? { ...frameLayer(frames, frames.years.indexOf(year ?? frames.years.at(-1)!))!, landOnly: selected?.coverage.surface === 'land' }
          : undefined
        : map
          ? {
              rows: map.rows,
              cols: map.cols,
              lat0: map.lat0,
              lon0: map.lon0,
              dlat: map.dlat,
              dlon: map.dlon,
              values: map.slope,
              limit: map.limit,
              unit: map.unit,
              landOnly: selected?.coverage.surface === 'land',
              domain: resources.map.domain,
              label: `Full-period trend · ${map.dlat}° cells · ${month(map.start)} — ${month(map.end)}`,
              significant: map.significant,
              statusLabels: map.status.map((v) => map.codes[String(v)]),
            }
          : undefined,
    [frames, map, year, layerMode, resources.map.domain, selected?.coverage.surface],
  );
  const reset = () => {
    analysis.reset();
    setCellFallback('');
    setSelectedChange(undefined);
    setSelectedEvent(undefined);
    setAutoContext(undefined);
    setError('');
  };
  const choose = (v: Variable) => {
    reset();
    setSelectedChange(undefined);
    setSelectedEvent(undefined);
    setAutoContext(undefined);
    setSelectedId(v.variable_id);
    setStart(v.coverage.start);
    setEnd(v.coverage.end);
    setPairA(undefined);
    setPairB(undefined);
    setPointA(undefined);
    setPointB(undefined);
    setSlot(undefined);
    setRequestedYear(2025);
    setYear(2025);
    setYearIntent('default');
    setActiveCase(undefined);
    if (v.capabilities.area === 'not_available') setKind('point');
  };
  const changeKind = (v: 'point' | 'area') => {
    if (v === 'area' && selected?.capabilities.area === 'not_available') return;
    reset();
    setKind(v);
    setSlot(undefined);
  };
  const edit = (setter: (v: string) => void, value: string) => {
    reset();
    setActiveCase(undefined);
    setter(value);
  };
  const checked = () =>
    kind === 'point'
      ? requestFromFields(selectedId, latitude, longitude, start, end)
      : requestFromAreaFields(selectedId, bounds, start, end);
  const open = (request: AnalysisRequest) => {
    setCellFallback('');
    setSelectedChange(undefined);
    setSelectedEvent(undefined);
    setAutoContext(undefined);
    setGuide(false);
    setControls(false);
    setError('');
    analysis.submit(request);
  };
  const run = () => {
    const value = checked();
    if ('error' in value) {
      setError(value.error);
      return;
    }
    open(value.request);
  };
  const inspectSeam = () => {
    setEvidence(true);
    requestAnimationFrame(() => {
      const detail = document.getElementById('change-disclosure') as HTMLDetailsElement | null;
      if (detail) detail.open = true;
      const target = document.getElementById('changes');
      target?.focus();
      target?.scrollIntoView({ block: 'start' });
    });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run();
  };
  const pick = (p: GeoPoint) => {
    setActiveCase(undefined);
    setSelectedChange(undefined);
    setSelectedEvent(undefined);
    setAutoContext(undefined);
    if (slot && map) {
      setPairGridKey(mapGridKey);
      const i = globeCell({ ...map, values: map.slope, label: 'trend' }, p);
      if (i === undefined) {
        setError('A and B require a cell inside the prepared trend layer.');
        return;
      }
      if (slot === 'A') {
        setPairA(i);
        setPointA(p);
        setSlot('B');
      } else {
        setPairB(i);
        setPointB(p);
        setSlot(undefined);
      }
      setEvidence(true);
      return;
    }
    if (!selected) {
      setError('The variable catalogue is not available yet.');
      return;
    }
    setLatitude(String(p.lat));
    setLongitude(String(p.lon));
    setKind('point');
    open({ variable_id: selectedId, location: { type: 'point', lat: p.lat, lon: p.lon }, period: { start, end } });
  };
  const pickChange = (marker: MapChange) => {
    if (!selected || !changes.resource.data) return;
    setSelectedChange({ marker, layer: changes.resource.data });
    setSelectedEvent(undefined);
    setCellFallback('');
    setSlot(undefined);
    // Pin the marker's own year as an explicit choice, so the automatic year choice cannot move the view
    // to another year while layers or results arrive (rapid clicks used to make the year jump).
    const markerYear = Number(marker.date.slice(0, 4));
    setRequestedYear(markerYear);
    setYearIntent('explicit');
    setYear(markerYear);
    setYearNotice('');
    setLatitude(String(marker.lat));
    setLongitude(String(marker.lon));
    setKind('point');
    setControls(false);
    setEvidence(false);
    setFocusKey((v) => v + 1);
    analysis.submit({ variable_id: selectedId, location: { type: 'point', lat: marker.lat, lon: marker.lon }, period: { start, end } });
    setAutoContext({ type: 'point', lat: marker.lat, lon: marker.lon });
  };
  useEffect(() => {
    if (!autoContext || state.kind !== 'ready' || JSON.stringify(state.request?.location) !== JSON.stringify(autoContext)) return;
    if (context.state.kind !== 'idle') return;
    setAutoContext(undefined);
    if (['detected', 'inconclusive'].includes(String(cp.status)) && selected?.capabilities.investigation !== 'not_available') context.run();
  }, [autoContext, state, cp.status, context.state.kind, context.run, selected]);
  const browseChanges = () => {
    setEvidence(true);
    requestAnimationFrame(() => {
      const detail = document.getElementById('change-map-browser') as HTMLDetailsElement | null;
      if (detail) {
        detail.open = true;
        detail.scrollIntoView({ block: 'start' });
      }
    });
  };
  const pickArea = (b: [number, number, number, number]) => {
    setActiveCase(undefined);
    const checked = requestFromAreaFields(selectedId, b.map(coordinate), start, end);
    if ('error' in checked) {
      setError(checked.error);
      return;
    }
    setBounds(b.map(coordinate));
    setKind('area');
    open(checked.request);
  };
  /** A documented event is a region: its evidence is the area record of that region, never the last clicked point. */
  const pickEvent = (event: GlobeEvent) => {
    setActiveCase(undefined);
    setSlot(undefined);
    const box = record(event.raw.area).bbox;
    const area =
      !event.global && Array.isArray(box) && box.length === 4 && box.every(finite) && selected?.capabilities.area !== 'not_available'
        ? requestFromAreaFields(selectedId, (box as number[]).map(coordinate), start, end)
        : undefined;
    if (area && 'request' in area) {
      setBounds((box as number[]).map(coordinate));
      setKind('area');
      open(area.request);
    } else if (!event.global) reset(); // point-only product: show the event alone, not a stale point record
    setSelectedEvent(event);
    setEvidence(true);
  };
  // A change marker sits at the centre of an aggregated cell, which can be water or masked in the native grid.
  // When the native point there has no observations, analyse the whole cell: the record the change was found in.
  useEffect(() => {
    const location = state.request?.location;
    if (!selectedChange || !['no_data', 'insufficient_for_test'].includes(state.kind) || location?.type !== 'point') return;
    const { marker, layer: changeLayer } = selectedChange;
    if (location.lat !== marker.lat || location.lon !== marker.lon || state.request?.variable_id !== selectedId) return;
    if (selected?.capabilities.area === 'not_available') return;
    const g = changeLayer.grid;
    const b = [
      Math.max(-180, marker.lon - g.dlon / 2),
      Math.max(-90, marker.lat - g.dlat / 2),
      Math.min(180, marker.lon + g.dlon / 2),
      Math.min(90, marker.lat + g.dlat / 2),
    ].map(coordinate);
    const checked = requestFromAreaFields(selectedId, b, start, end);
    if ('error' in checked) return;
    setBounds(b);
    setKind('area');
    setCellFallback(`No observations at the cell centre · analysing the whole ${g.dlat}° cell.`);
    analysis.submit(checked.request);
    setAutoContext(checked.request.location);
  }, [state.kind, state.request, selectedChange]);
  const applySelection = (
    v: Variable,
    mode: 'annual' | 'trend' | 'changes',
    selectedYear: number,
    request: AnalysisRequest | undefined,
    preset?: ExploreCase,
  ) => {
    analysis.reset();
    setSelectedId(v.variable_id);
    setLayerMode(mode);
    setRequestedYear(selectedYear);
    setYear(selectedYear);
    setYearIntent(preset || urlLink.year !== undefined ? 'explicit' : 'default');
    setYearNotice('');
    setStart(request?.period.start ?? v.coverage.start);
    setEnd(request?.period.end ?? v.coverage.end);
    setActiveCase(preset);
    setSelectedChange(undefined);
    setSelectedEvent(undefined);
    setSlot(undefined);
    setPairA(undefined);
    setPairB(undefined);
    setPointA(undefined);
    setPointB(undefined);
    setCaseDrawer(false);
    setControls(false);
    setGuide(false);
    setEvidence(false);
    setError('');
    setAutoContext(undefined);
    if (request) {
      setKind(request.location.type);
      if (request.location.type === 'point') {
        setLatitude(String(request.location.lat));
        setLongitude(String(request.location.lon));
      } else {
        setBounds(request.location.bbox.map(String));
        setLatitude('');
        setLongitude('');
      }
      analysis.submit(request);
      if (mode !== 'trend') setAutoContext(request.location);
      setFocusKey((k) => k + 1);
    } else {
      setLatitude('');
      setLongitude('');
      setKind('point');
    }
  };
  const exploreCase = (preset: ExploreCase) => {
    const v = variables.find((v) => v.variable_id === preset.request.variable_id);
    if (!v) return;
    applySelection(v, preset.layer, preset.year, preset.request, preset);
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('case', preset.id);
    history.pushState({}, '', url);
  };
  useEffect(() => {
    const change = () => {
      booted.current = false;
      setUrlLink(readWorkspaceLink(window.location.search));
    };
    window.addEventListener('popstate', change);
    return () => window.removeEventListener('popstate', change);
  }, []);
  useEffect(() => {
    if (booted.current || catalogue !== 'ready' || (urlLink.caseId && changes.eventsState === 'loading')) return;
    if (urlLink.caseId && changes.eventsState === 'error') {
      setError('Case sources are unavailable. Retry the connection.');
      return;
    }
    booted.current = true;
    const initial = firstBoot.current;
    firstBoot.current = false;
    const resolved = resolveWorkspaceLink(urlLink, cases, variables);
    if (resolved.error) {
      analysis.reset();
      setActiveCase(undefined);
      setSelectedChange(undefined);
      setAutoContext(undefined);
      setError(resolved.error);
      return;
    }
    if (initial && !urlLink.caseId && !Object.keys(urlLink).length && state.request) return;
    if (resolved.variable && resolved.layer && resolved.year !== undefined)
      applySelection(resolved.variable, resolved.layer, resolved.year, resolved.request, resolved.preset);
  }, [urlLink, catalogue, changes.eventsState, cases, variables]);
  useEffect(() => {
    if (
      activeCase?.layer === 'changes' &&
      (activeCase.boundaryId || activeCase.eventId) &&
      changes.resource.data &&
      activeCase.request.variable_id === selectedId
    ) {
      const m = changes.resource.data.markers.find(
        (m) =>
          (activeCase.boundaryId ? m.boundaryId === activeCase.boundaryId : m.eventId === activeCase.eventId) &&
          m.lat === (activeCase.request.location.type === 'point' ? activeCase.request.location.lat : undefined) &&
          m.lon === (activeCase.request.location.type === 'point' ? activeCase.request.location.lon : undefined),
      );
      if (m) setSelectedChange({ marker: m, layer: changes.resource.data });
    }
  }, [activeCase, changes.resource.data, selectedId]);
  const identity = JSON.stringify([selectedId, state.request?.location]),
    resource = layerMode === 'trend' ? resources.map : resources.frames;
  const pair = map
    ? [
        validA !== undefined ? { point: pointA ?? cellLocation(map, validA), label: 'A' } : undefined,
        validB !== undefined ? { point: pointB ?? cellLocation(map, validB), label: 'B' } : undefined,
      ].filter((p): p is { point: GeoPoint; label: string } => p !== undefined)
    : [];
  const outside =
      resource.domain !== 'world' && kind === 'point' && point && (point.lat < 34 || point.lat > 72 || point.lon < -25 || point.lon > 45),
    hoverIndex = inspection && layer ? globeCell(layer, inspection) : undefined,
    hoverValue = hoverIndex !== undefined ? layer?.values[hoverIndex] : undefined;
  return (
    <div className="globe-shell">
      <a className="skip-link" href="#globe-workspace">
        Skip to workspace
      </a>
      <header className="globe-header">
        <a className="globe-wordmark" href="/" aria-label="Terra Anomaly and Trend Observatory (TATO)">
          <span className="wordmark-full">Terra Anomaly and Trend Observatory</span>
          <span className="wordmark-short">TATO</span>
        </a>
        <nav className="globe-variables" aria-label="Earth system variables">
          {variables
            .filter((v) => v.capabilities.map_europe === 'precomputed')
            .map((v) => (
              <button key={v.variable_id} aria-pressed={selectedId === v.variable_id} title={v.label} onClick={() => choose(v)}>
                {labels[v.variable_id] ?? v.label}
              </button>
            ))}
          {catalogue === 'loading' && <span role="status">Loading variables…</span>}
          {catalogue === 'error' && <button onClick={() => setRefresh((v) => v + 1)}>Retry catalogue</button>}
        </nav>
        <div className="globe-header-actions">
          <button
            className="explore-case-button"
            onClick={() => {
              setControls(false);
              setGuide(false);
              setEvidence(false);
              setCaseDrawer(true);
            }}
          >
            Explore a case ↗
          </button>
          <button
            onClick={() => {
              setEvidence(false);
              setGuide(false);
              setControls(true);
            }}
            aria-haspopup="dialog"
          >
            Place & period ↗
          </button>
          <button
            aria-label="Open three-question guide"
            onClick={() => {
              setControls(false);
              setEvidence(false);
              setGuide(true);
            }}
          >
            ?
          </button>
          <button
            className={`connection-state service-${service}`}
            aria-label={service === 'ready' ? 'Service connected. Refresh availability' : 'Retry service connection'}
            onClick={() => setRefresh((v) => v + 1)}
          >
            <i />
            {service === 'ready' ? 'Connected' : service === 'error' ? 'Retry' : 'Connecting'}
          </button>
        </div>
      </header>
      <main id="globe-workspace" tabIndex={-1}>
        <section className="globe-stage" aria-label="Globe and selected record">
          <Globe
            layer={layer}
            point={kind === 'point' ? point : undefined}
            bbox={kind === 'area' ? bbox : undefined}
            pair={pair}
            selectionMode={kind}
            onPick={pick}
            onArea={pickArea}
            onInspect={(p, _, water) => setInspection({ ...p, water })}
            inspection={
              <div className="globe-inspection" aria-live="off">
                {inspection && (
                  <>
                    {coordinate(inspection.lat)}°, {coordinate(inspection.lon)}° ·{' '}
                    {layer?.landOnly && inspection.water === true
                      ? 'No data over water'
                      : layer?.landOnly && inspection.water === undefined
                        ? 'Geographic mask loading'
                        : hoverIndex === undefined
                          ? 'No layer here'
                          : hoverValue === null
                            ? (layer?.statusLabels?.[hoverIndex!]?.replaceAll('_', ' ') ?? 'No valid annual value')
                            : hoverValue !== undefined
                              ? `${signed(hoverValue)} ${layer?.unit}`
                              : 'Layer unavailable'}
                  </>
                )}
              </div>
            }
            toolbar={
              <div className="globe-layer-controls">
                <div role="group" aria-label="Globe colour layer">
                  <button
                    aria-pressed={layerMode === 'annual'}
                    title="Yearly difference from the cell’s usual monthly values"
                    onClick={() => setLayerMode('annual')}
                  >
                    Annual anomaly
                  </button>
                  <button
                    aria-pressed={layerMode === 'trend'}
                    title="Direction and rate across the full record"
                    onClick={() => setLayerMode('trend')}
                  >
                    Full-period trend
                  </button>
                  <button aria-pressed={layerMode === 'changes'} onClick={() => setLayerMode('changes')}>
                    Changes
                  </button>
                </div>
                <div role="group" aria-label="Globe selection type">
                  <button aria-pressed={kind === 'point'} onClick={() => changeKind('point')}>
                    Point
                  </button>
                  <button
                    aria-pressed={kind === 'area'}
                    disabled={selected?.capabilities.area === 'not_available'}
                    title={
                      selected?.capabilities.area === 'not_available'
                        ? 'Area unavailable: this MODIS product supports point records only.'
                        : undefined
                    }
                    onClick={() => changeKind('area')}
                  >
                    Area
                  </button>
                </div>
                {selected?.capabilities.area === 'not_available' && (
                  <p className="area-limit">Area unavailable · this MODIS product supports points only.</p>
                )}
                {point && (
                  <button className="text-button" onClick={() => setFocusKey((v) => v + 1)}>
                    Centre selection ↗
                  </button>
                )}
              </div>
            }
            focusKey={focusKey}
            changesMode={layerMode === 'changes'}
            changes={layerMode === 'changes' ? yearChanges : undefined}
            events={layerMode === 'changes' ? yearEvents : []}
            onChangePick={slot ? undefined : pickChange}
            onEventPick={pickEvent}
            onBrowseChanges={browseChanges}
            nativeChange={
              isMonth(cp.date) && ['detected', 'inconclusive'].includes(String(cp.status))
                ? { date: cp.date, tentative: cp.status === 'inconclusive' }
                : undefined
            }
            onNativeChange={inspectSeam}
          />
          <aside className="globe-sidebar">
            {activeCase && (
              <div className="active-case">
                <button className="text-button" onClick={() => setEvidence(true)}>
                  {activeCase.eventId ? '◇' : activeCase.boundaryId ? '▱' : '↗'} {activeCase.label} ↗
                </button>
                {data && (
                  <small>
                    {(
                      {
                        not_detected: 'No abrupt jump detected',
                        not_distinct_from_trend: 'Gradual change fits better',
                        inconclusive: 'Possible jump',
                        detected: 'Jump candidate',
                      } as Record<string, string>
                    )[String(cp.status)] ?? 'Jump test unavailable'}
                  </small>
                )}
              </div>
            )}
            <ConclusionCard
              state={state}
              variable={selected}
              context={safeContext}
              onContext={context.run}
              onEvidence={() => setEvidence(true)}
              onChoose={() => setControls(true)}
              onRetry={analysis.retry}
            />

            <div className="globe-coverage">
              <p>
                {resource.domain === 'world'
                  ? `World · ${layer?.dlat ?? 2}° cells`
                  : outside
                    ? 'Point analysis available here'
                    : resource.kind === 'not_available'
                      ? 'Point product · no globe layer'
                      : 'Europe · 1° cells'}
              </p>
              {slot && <strong role="status">Picking {slot} for Counter-directions</strong>}
              {cellFallback && selectedChange && <small className="coverage-status">{cellFallback}</small>}
              {resource.notice && <small className="coverage-status">{resource.notice}</small>}
              {selected &&
                resource.kind === 'ready' &&
                layerMode !== 'trend' &&
                frames &&
                year !== undefined &&
                !frames.years.includes(year) && <p>No globe frame for {year}; the point record is separate.</p>}
              {selected && resource.kind === 'loading' && (
                <p role="status">Loading real {layerMode === 'trend' ? 'trend layer' : 'annual frames'}…</p>
              )}
              {selected && resource.kind === 'error' && (
                <p role="alert">
                  Layer unavailable.{' '}
                  <button className="text-button" onClick={() => setRefresh((v) => v + 1)}>
                    Retry ↗
                  </button>
                </p>
              )}
              {selected && resource.kind === 'not_available' && (
                <p>No prepared {layerMode === 'trend' ? 'trend layer' : 'annual frames'}. Point analysis is available.</p>
              )}
              {layerMode === 'changes' && (
                <ChangesLegend
                  resource={changes.resource}
                  year={year}
                  count={yearChanges.length}
                  onBrowse={browseChanges}
                  globalEvents={yearEvents.filter((e) => e.global)}
                  onEvent={(event) => {
                    setSelectedEvent(event);
                    setEvidence(true);
                  }}
                />
              )}
              {layerMode === 'changes' && changes.eventsState === 'error' && <small>Documented events could not be loaded.</small>}
            </div>
            {yearNotice && (
              <p className="year-fallback-note" role="status">
                {yearNotice}
              </p>
            )}
            {layerMode === 'changes' && changes.resource.kind !== 'ready' && (
              <p className="layer-fallback-note" role="status">
                {changes.resource.kind === 'loading'
                  ? 'Annual background · Changes is loading.'
                  : 'Annual background · Changes is unavailable.'}
              </p>
            )}
            {layerMode === 'changes' && changes.resource.notice && <p className="layer-fallback-note">{changes.resource.notice}</p>}
          </aside>
          {error && (
            <div className="globe-error" role="alert">
              {error}
              <button aria-label="Dismiss selection message" onClick={() => setError('')}>
                ×
              </button>
            </div>
          )}
        </section>
        <GlobeTimeStrip
          frames={frames}
          annual={annual}
          neighbors={neighbors.data}
          neighborState={neighbors.kind}
          year={year}
          onYear={displayYear}
          layerMode={layerMode}
          data={data}
          context={safeContext.state.kind === 'ready' ? safeContext.state.result : undefined}
          mappedChanges={layerMode === 'changes' ? changes.resource.data?.markers : undefined}
          mappedBoundaries={changes.resource.data?.boundaries.length ? changes.resource.data.boundaries : selected?.product_boundaries}
          events={layerMode === 'changes' ? changes.events : []}
          onSeam={inspectSeam}
          onEvidence={() => setEvidence(true)}
        />
      </main>
      <Drawer open={evidence} onClose={() => setEvidence(false)} title="Evidence" className="globe-evidence-drawer">
        <div id="series" className="globe-evidence-content">
          {activeCase && <CaseEvidence preset={activeCase} />}
          {selectedEvent && <EventEvidence event={selectedEvent} />}{' '}
          {selectedChange && <SelectedChange marker={selectedChange.marker} layer={selectedChange.layer} events={changes.events} />}{' '}
          {layerMode === 'changes' && (
            <ChangeBrowser key={`${selectedId}/${year}`} layer={changes.resource.data} year={year} onPick={pickChange} />
          )}
          {data && selected ? (
            <AnalysisView
              key={state.analysisId}
              state={state}
              variable={selected}
              overview={overview?.key === identity ? overview.points : undefined}
              onPeriodApply={open}
              investigation={safeContext}
            />
          ) : (
            <StatusNotice state={state} onRetry={analysis.retry} />
          )}
          <GlobeCounterDirections
            key={mapGridKey}
            map={map}
            a={validA}
            b={validB}
            pointA={pointA}
            pointB={pointB}
            slot={slot}
            onChooseSlot={(s) => {
              setSlot(s);
              if (s) {
                setKind('point');
                setLayerMode('trend');
                setEvidence(false);
              }
            }}
            onPair={(a, b) => {
              setPairGridKey(mapGridKey);
              setPairA(a);
              setPairB(b);
              setPointA(undefined);
              setPointB(undefined);
              setSlot(undefined);
              setLayerMode('trend');
            }}
            onOpen={open}
          />
          <details className="globe-data-note">
            <summary>Globe source, grid and baseline</summary>
            <p>
              Change rings are exploratory: dashed rings are unresolved candidates. Jump-test p-values are not corrected for searching many
              cells. Exact months are estimates; a documented match is not a cause.
            </p>
            <p>
              Geography: Natural Earth, public domain. Projection: orthographic, WGS84. Smooth filters colours only; Cells shows the
              original display cells. Missing or insufficient cells stay masked, and land products do not colour the sea. Point fallback
              thins centres at world view. Requests and numeric readouts keep real cell data and exact clicked coordinates.
            </p>
            <p>
              Colours: Scientific Colour Maps / cork. Linear and zero centred; the API colour limits are unchanged.{' '}
              <a href={scmLicence} target="_blank" rel="noreferrer">
                MIT licence ↗
              </a>
            </p>
            {frames ? (
              <>
                <p>
                  {String(record(frames.raw.product).product ?? 'Product unavailable')} · {frames.unit} · {frames.grid.dlat}° aggregated
                  annual anomalies.
                </p>
                <p>
                  Baseline: {month(frames.baseline.start)} — {month(frames.baseline.end)}. Each native cell uses its own monthly
                  climatology. Annual means require at least {frames.minValidMonths} valid months; the last calendar year can be
                  unavailable.
                </p>
                <p>
                  {String(record(record(frames.raw.grid).aggregation).method ?? 'Aggregation not returned')}. Missing and insufficient
                  annual values are not interpolated.
                </p>
                <SamplingNote grid={frames.raw.grid} />
                <p>Globe colour limits: {String(record(frames.raw.legend).rule ?? 'Not returned')}.</p>
                <a href={`https://doi.org/${encodeURI(selected?.source.doi ?? '')}`} target="_blank" rel="noreferrer">
                  NASA source dataset DOI ↗
                </a>
              </>
            ) : (
              <p>Annual frame metadata unavailable. No frame values are substituted.</p>
            )}
            {map && (
              <>
                <h4>
                  Full-period trend / {map.dlat}° aggregates · {resources.map.domain === 'world' ? 'world' : 'Europe'}
                </h4>
                <p>
                  {month(map.start)} — {month(map.end)} · {map.unit}.{' '}
                  {String(record(map.raw.method).multiple_testing ?? 'FDR details unavailable')}
                </p>
                <p>{String(record(record(map.raw.grid).aggregation).method ?? 'Aggregation metadata unavailable')}</p>
                <p>
                  {String(
                    record(record(map.raw.grid).aggregation).note ??
                      'The slope is estimated after spatial aggregation, not averaged from native slopes.',
                  )}
                </p>
                <SamplingNote grid={map.raw.grid} />
                <p>
                  Colour range: {String(record(map.raw.legend).rule ?? 'Not available')}. Native point estimates and FDR decisions on other
                  grids can differ.
                </p>
              </>
            )}
          </details>
        </div>
      </Drawer>
      <Drawer open={controls} onClose={() => setControls(false)} title="Choose your record" className="globe-control-drawer">
        <div className="globe-control-content">
          <p className="eyebrow">Variable / place / period</p>
          <label>
            Variable
            <select
              aria-label="Variable"
              value={selectedId}
              onChange={(e) => {
                const v = variables.find((v) => v.variable_id === e.target.value);
                if (v) choose(v);
              }}
            >
              {variables.map((v) => (
                <option key={v.variable_id} value={v.variable_id}>
                  {v.label}
                  {v.capabilities.point === 'job' ? ' · background request' : ''}
                </option>
              ))}
            </select>
          </label>
          <p className="field-help">{selected?.summary?.definition ?? selected?.definition}</p>
          <div className="location-kinds" role="group" aria-label="Location type">
            <button aria-pressed={kind === 'point'} onClick={() => changeKind('point')}>
              Point
            </button>
            <button
              aria-pressed={kind === 'area'}
              disabled={selected?.capabilities.area === 'not_available'}
              title={
                selected?.capabilities.area === 'not_available'
                  ? 'Area unavailable: this MODIS product supports point records only.'
                  : undefined
              }
              onClick={() => changeKind('area')}
            >
              Area
            </button>
          </div>
          {selected?.capabilities.area === 'not_available' && (
            <p className="field-help">Area unavailable: this MODIS product supports point records only.</p>
          )}
          <button
            className="text-button"
            onClick={() => {
              setControls(false);
              requestAnimationFrame(() => document.querySelector<HTMLCanvasElement>('.globe-points')?.focus());
            }}
          >
            Choose on the same globe ↗
          </button>
          <form onSubmit={submit} noValidate>
            <fieldset disabled={!selected}>
              <legend>{kind === 'point' ? 'Coordinates' : 'Area bounds'}</legend>
              <div className="coordinate-fields">
                {kind === 'point' ? (
                  <>
                    <label>
                      Latitude
                      <input
                        id="latitude"
                        inputMode="decimal"
                        lang="en"
                        value={latitude}
                        placeholder="e.g. 50.45"
                        onChange={(e) => edit(setLatitude, e.target.value)}
                      />
                    </label>
                    <label>
                      Longitude
                      <input
                        id="longitude"
                        inputMode="decimal"
                        lang="en"
                        value={longitude}
                        placeholder="e.g. 30.52"
                        onChange={(e) => edit(setLongitude, e.target.value)}
                      />
                    </label>
                  </>
                ) : (
                  ['West', 'South', 'East', 'North'].map((label, i) => (
                    <label key={label}>
                      {label}
                      <input
                        id={label.toLowerCase()}
                        inputMode="decimal"
                        lang="en"
                        value={bounds[i]}
                        onChange={(e) => {
                          reset();
                          setBounds((old) => old.map((v, j) => (j === i ? e.target.value : v)));
                        }}
                      />
                    </label>
                  ))
                )}
              </div>
            </fieldset>
            <fieldset disabled={!selected}>
              <legend>Analysis period / monthly</legend>
              <div className="period-fields">
                <label>
                  From
                  <input id="start-month" lang="en" placeholder="YYYY-MM" value={start} onChange={(e) => edit(setStart, e.target.value)} />
                </label>
                <label>
                  To
                  <input id="end-month" lang="en" placeholder="YYYY-MM" value={end} onChange={(e) => edit(setEnd, e.target.value)} />
                </label>
              </div>
            </fieldset>
            {error && <p role="alert">{error}</p>}
            <button className="button button-primary request-button" disabled={!selected || busy} type="submit">
              {busy ? 'Request in progress' : 'Request analysis'} ↗
            </button>
            {selected?.capabilities.point === 'job' && (
              <p className="field-help">MODIS loads in the background. Saved source records are reused.</p>
            )}
            {kind === 'area' && <p className="field-help">Europe uses the prepared cube. Other supported areas load in the background.</p>}
          </form>
          <details>
            <summary>Variable limits</summary>
            <ul>{selected?.limitations?.map((v, i) => <li key={i}>{v}</li>)}</ul>
          </details>
          <button
            className="text-button"
            onClick={() => {
              setControls(false);
              setGuide(true);
            }}
          >
            Use the three-question guide ↗
          </button>
        </div>
      </Drawer>
      <Drawer open={caseDrawer} onClose={() => setCaseDrawer(false)} title="Explore a case" className="globe-case-drawer">
        <ExploreCases
          cases={cases}
          variables={variables}
          loading={catalogue === 'loading' || changes.eventsState === 'loading'}
          error={catalogue === 'error' || changes.eventsState === 'error'}
          onPick={exploreCase}
        />
      </Drawer>
      <Drawer open={guide} onClose={() => setGuide(false)} title="Three-question guide" className="globe-guide-drawer">
        <Onboarding
          variables={variables}
          selected={selected}
          choose={choose}
          kind={kind}
          setKind={changeKind}
          validPlace={'request' in checked()}
          start={start}
          end={end}
          setStart={(v) => edit(setStart, v)}
          setEnd={(v) => edit(setEnd, v)}
          onRun={run}
          onClose={() => setGuide(false)}
          onChoosePlace={() => {
            setGuide(false);
            setControls(true);
          }}
        />
      </Drawer>
      <p className="sr-only" role="status" aria-live="polite">
        {busy ? 'The analysis request is in progress.' : state.kind === 'ready' ? 'The analysis completed.' : ''}
      </p>
      <footer className="globe-footer">
        <span>NASA observations · missing stays missing</span>
        <span>NASA SPACE APPS 2026 / EN</span>
      </footer>
    </div>
  );
}
