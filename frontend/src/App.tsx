import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { apiRequest, isAbort } from './api';
import { isObject, parseVariables, requestFromAreaFields, requestFromFields } from './contract';
import type { AnalysisRequest, Variable } from './contract';
import { StatusNotice } from './StatusNotice';
import { useAnalysis } from './useAnalysis';
import { AnalysisView } from './AnalysisView';
import { PointMap } from './PointMap';
import { AreaMap } from './AreaMap';
import { EuropeMap } from './EuropeMap';
import { Onboarding } from './Onboarding';
import { pointsFrom } from './analysis';
import type { SeriesPoint } from './analysis';
import { coordinate } from './format';

type ResourceStatus='loading'|'ready'|'error';
export function App(){
  const [variables,setVariables]=useState<Variable[]>([]),[catalogueStatus,setCatalogueStatus]=useState<ResourceStatus>('loading'),[serviceStatus,setServiceStatus]=useState<ResourceStatus>('loading');
  const [selectedId,setSelectedId]=useState(''),[refreshKey,setRefreshKey]=useState(0);
  const [kind,setKind]=useState<'point'|'area'>('point'),[latitude,setLatitude]=useState(''),[longitude,setLongitude]=useState(''),[bounds,setBounds]=useState(['','','','']);
  const [start,setStart]=useState(''),[end,setEnd]=useState(''),[formError,setFormError]=useState('');
  const [guide,setGuide]=useState(()=>{try{return sessionStorage.getItem('earth-trends-guide-done')!=='yes';}catch{return true;}});
  const analysis=useAnalysis(),selected=variables.find(v=>v.variable_id===selectedId);
  const [overview,setOverview]=useState<{key:string;points:SeriesPoint[]}>();
  const stage=useRef<HTMLElement>(null);
  const busy=['loading','connecting','queued','running'].includes(analysis.state.kind);
  const closeGuide=()=>{setGuide(false);try{sessionStorage.setItem('earth-trends-guide-done','yes');}catch{/* The guide also works without storage. */}};
  useEffect(()=>{
    const c=new AbortController();setCatalogueStatus('loading');setServiceStatus('loading');
    void apiRequest('/variables',{signal:c.signal}).then(r=>{if(c.signal.aborted)return;if(r.httpStatus!==200)throw Error();const items=parseVariables(r.data);setVariables(items);setCatalogueStatus('ready');setSelectedId(old=>items.some(v=>v.variable_id===old)?old:items[0].variable_id);setStart(old=>old||items[0].coverage.start);setEnd(old=>old||items[0].coverage.end);}).catch(e=>{if(!c.signal.aborted&&!isAbort(e))setCatalogueStatus('error');});
    void apiRequest('/health',{signal:c.signal}).then(r=>{if(!c.signal.aborted)setServiceStatus(r.httpStatus===200&&r.data.status==='ok'?'ready':'error');}).catch(e=>{if(!c.signal.aborted&&!isAbort(e))setServiceStatus('error');});return()=>c.abort();
  },[refreshKey]);
  useEffect(()=>{
    const req=analysis.state.request;if(!req)return;setSelectedId(req.variable_id);setStart(req.period.start);setEnd(req.period.end);setKind(req.location.type);
    if(req.location.type==='point'){setLatitude(String(req.location.lat));setLongitude(String(req.location.lon));}else setBounds(req.location.bbox.map(String));
    if(analysis.state.kind!=='ready')return;
    const points=pointsFrom(isObject(analysis.state.result?.series)?analysis.state.result.series.points:undefined);if(!points)return;
    const key=JSON.stringify([req.variable_id,req.location]);setOverview(old=>old?.key===key&&old.points[0].t<=points[0].t&&old.points[old.points.length-1].t>=points[points.length-1].t?old:{key,points});
  },[analysis.state]);
  const reset=()=>{analysis.reset();setFormError('');};
  const choose=(v:Variable)=>{reset();setSelectedId(v.variable_id);setStart(v.coverage.start);setEnd(v.coverage.end);};
  const edit=(setter:(v:string)=>void,v:string)=>{reset();setter(v);};
  const changeKind=(v:'point'|'area')=>{reset();setKind(v);};
  const checked=()=>kind==='point'?requestFromFields(selectedId,latitude,longitude,start,end):requestFromAreaFields(selectedId,bounds,start,end);
  const run=()=>{const value=checked();if('error'in value){setFormError(value.error);return;}open(value.request);};
  const submit=(e:FormEvent)=>{e.preventDefault();run();};
  const open=(req:AnalysisRequest)=>{closeGuide();setFormError('');analysis.submit(req);stage.current?.focus();stage.current?.scrollIntoView({block:'start'});};
  const point=latitude.trim()&&longitude.trim()&&Number.isFinite(Number(latitude))&&Number.isFinite(Number(longitude))&&Math.abs(Number(latitude))<=90&&Math.abs(Number(longitude))<=180?{lat:Number(latitude),lon:Number(longitude)}:undefined;
  const areaCheck=requestFromAreaFields(selectedId,bounds,start,end),bbox='request'in areaCheck&&areaCheck.request.location.type==='area'?areaCheck.request.location.bbox:undefined;
  const identity=JSON.stringify([selectedId,analysis.state.request?.location]);
  return <div className="app-shell"><a className="skip-link" href="#workspace">Skip to workspace</a>
    <header className="app-header"><a className="wordmark" href="/" aria-label="Earth system trends home">EARTH SYSTEM <span>/</span> TRENDS</a><nav aria-label="Workspace views"><a href="#europe-map">Explore</a><a href="#series">Time series</a><a href="#change-disclosure" onClick={()=>{const el=document.getElementById('change-disclosure') as HTMLDetailsElement|null;if(el)el.open=true;}}>Change points</a></nav><div className="service-indicator" role="status"><span className={`service-dot service-${serviceStatus}`} aria-hidden="true"/>{serviceStatus==='ready'?'Service connected':serviceStatus==='error'?'Connection unavailable':'Connecting to service'}<button className="text-button" onClick={()=>setRefreshKey(v=>v+1)} aria-label="Refresh service and variable availability">Refresh ↻</button></div></header>
    <div className="intro"><p className="eyebrow">EARTH OBSERVATIONS / REGIONAL CHANGE</p><h1>Inspect the signal.</h1><button className="text-button intro-note" onClick={()=>setGuide(v=>!v)}>Three-question guide ↗</button></div>
    {guide&&<Onboarding variables={variables} selected={selected} choose={choose} kind={kind} setKind={changeKind} validPlace={'request'in checked()} start={start} end={end} setStart={v=>edit(setStart,v)} setEnd={v=>edit(setEnd,v)} onRun={run} onClose={closeGuide}/>}
    <main id="workspace" className="workspace" tabIndex={-1}>
      <aside className="variable-panel" aria-label="Variable selection"><h2 className="eyebrow">Variable / source</h2>{catalogueStatus==='loading'&&<p role="status">Loading catalogue…</p>}{catalogueStatus==='error'&&<p role="alert">The catalogue could not be retrieved. <button className="text-button" onClick={()=>setRefreshKey(v=>v+1)}>Retry</button></p>}<div className="variable-list">{variables.map((v,i)=><button key={v.variable_id} className="variable-option" aria-pressed={selectedId===v.variable_id} onClick={()=>choose(v)}><span className="variable-number" aria-hidden="true">{String(i+1).padStart(2,'0')}</span><span><span className="variable-label">{v.label}</span><span className="variable-source">{v.source.mission_or_model}</span></span></button>)}</div><details className="variable-help"><summary>About this variable</summary><p>{selected?.definition??'No definition returned yet.'}</p><p>Units: {selected?.unit}</p><ul>{selected?.limitations?.map((l,i)=><li key={i}>{l}</li>)}</ul></details></aside>
      <div className="central-workspace">{selected&&<EuropeMap key={selectedId} variable={selected} onOpen={open}/>}
        <section ref={stage} id="series" tabIndex={-1} className="evidence-stage" aria-label="Request and data status"><div className="stage-heading"><span className="eyebrow">{(analysis.state.request?.location.type??kind)==='area'?'Area':'Point'} analysis</span><span className="layer-state">Live selection</span></div>{analysis.state.kind==='idle'?<div className="empty-stage"><p className="eyebrow">Your next question</p><h2>Choose a place. Read its record.</h2><p>Select coordinates and a period, or open a cell from the map.</p></div>:analysis.state.kind==='ready'&&analysis.state.result&&selected?<AnalysisView key={analysis.state.analysisId} state={analysis.state} variable={selected} overview={overview?.key===identity?overview.points:undefined} onPeriodApply={open}/>:<StatusNotice state={analysis.state} onRetry={analysis.retry} onRefresh={()=>setRefreshKey(v=>v+1)}/>}</section>
      </div>
      <aside id="point-selection" className="selection-panel" aria-label="Request selection"><p className="eyebrow">Your selection / anywhere</p><h2>Choose a place.</h2><div className="location-kinds" role="group" aria-label="Location type"><button aria-pressed={kind==='point'} onClick={()=>changeKind('point')}>Point</button><button aria-pressed={kind==='area'} onClick={()=>changeKind('area')}>Area</button></div>{kind==='point'?<PointMap lat={point?.lat} lon={point?.lon} onPick={(lat,lon)=>{reset();setLatitude(coordinate(lat));setLongitude(coordinate(lon));}}/>:<AreaMap bbox={bbox} onPick={b=>{reset();setBounds(b.map(coordinate));}}/>}
        <form onSubmit={submit} noValidate><fieldset disabled={!selected}><legend>{kind==='point'?'Coordinates':'Area bounds'} <span>WGS84</span></legend>{kind==='point'?<div className="coordinate-fields"><label>Latitude<input id="latitude" name="latitude" inputMode="decimal" type="text" lang="en" spellCheck={false} placeholder="e.g. 50.45" value={latitude} onChange={e=>edit(setLatitude,e.target.value)}/></label><label>Longitude<input id="longitude" name="longitude" inputMode="decimal" type="text" lang="en" spellCheck={false} placeholder="e.g. 30.52" value={longitude} onChange={e=>edit(setLongitude,e.target.value)}/></label></div>:<div className="coordinate-fields">{['West','South','East','North'].map((label,i)=><label key={label}>{label}<input id={label.toLowerCase()} type="text" lang="en" inputMode="decimal" value={bounds[i]} onChange={e=>{reset();setBounds(old=>old.map((v,j)=>j===i?e.target.value:v));}}/></label>)}</div>}<p className="field-help">Decimal dots. Latitude −90…90; longitude −180…180.</p></fieldset>
          <fieldset disabled={!selected}><legend>Analysis period</legend><div className="period-fields"><label>From<input id="start-month" type="text" lang="en" inputMode="numeric" maxLength={7} placeholder="YYYY-MM" value={start} onChange={e=>edit(setStart,e.target.value)}/></label><label>To<input id="end-month" type="text" lang="en" inputMode="numeric" maxLength={7} placeholder="YYYY-MM" value={end} onChange={e=>edit(setEnd,e.target.value)}/></label></div><p className="field-help">Year-month, for example 2000-01.</p></fieldset>{formError&&<p className="form-error" role="alert">{formError}</p>}<button className="button button-primary request-button" type="submit" disabled={!selected||busy}>{busy?'Request in progress':'Request analysis'} ↗</button>{kind==='area'&&<p className="field-help">Europe: prepared cube. Elsewhere: a background source request may take several minutes.</p>}</form>
      </aside>
    </main><p className="sr-only" role="status" aria-live="polite">{busy?'The request is in progress.':analysis.state.kind==='ready'?'The request completed.':''}</p><footer className="app-footer"><span>NASA data. Missing values are not zero.</span><span>NASA SPACE APPS 2026 / EN</span></footer>
  </div>;
}
