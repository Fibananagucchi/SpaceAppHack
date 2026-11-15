import type {ExploreCase} from './casePresets';
import type {Variable,ObjectValue} from './contract';
import {record} from './analysis';
import {References} from './Mode2Conclusion';

export const modeLabels={annual:'Annual anomaly',trend:'Full-period trend',changes:'Changes'};
export function ExploreCases({cases,variables,loading,error,onPick}:{cases:ExploreCase[];variables:Variable[];loading:boolean;error:boolean;onPick:(c:ExploreCase)=>void}) {
  return <section className="explore-cases" aria-label="Source-backed cases"><p className="field-help">Open a real record; its result may differ from the event you explore.</p>{loading?<p role="status">Loading source-backed cases…</p>:error?<p role="status">Case sources are unavailable. You can still choose a place.</p>:<div>{cases.map(c=><a key={c.id} href={`?case=${encodeURIComponent(c.id)}`} data-case={c.id} onClick={e=>{if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();onPick(c);}}><span className="case-symbol" role="img" aria-label={c.eventId?'Documented event context':c.boundaryId?'Documented product context':'Trend record'}>{c.eventId?'◇':c.boundaryId?'▱':'↗'}</span><span><strong>{c.label}</strong><small>{variables.find(v=>v.variable_id===c.request.variable_id)?.label} · {modeLabels[c.layer]} · {c.request.location.type==='area'?'Area':'Point'}{c.note&&<> · {c.note}</>}</small></span><span aria-hidden="true">↗</span></a>)}</div>}</section>;
}
export function CaseEvidence({preset}:{preset:ExploreCase}) {
  const source=record(preset.source),references:Array<ObjectValue>=Array.isArray(source.sources)?source.sources.map(record):Object.keys(record(source.reference)).length?[record(source.reference)]:[];
  return <section className="case-evidence"><p className="eyebrow">Explore a case / source context</p><h3>{preset.label}</h3><p>{preset.locationNote}</p><details><summary>What this case means</summary><p>The event or product documentation provides context; the analysis uses the full selected record and can find a different date or no abrupt jump.</p><p>The point or area result is not replaced with the category of a map cell.</p>{typeof source.title==='string'&&<p>{source.title}</p>}<References value={references}/></details></section>;
}
