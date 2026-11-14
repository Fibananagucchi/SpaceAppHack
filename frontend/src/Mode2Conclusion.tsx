import { isObject } from './contract';
import { finite, record, safeLink, text } from './analysis';
import { month, number } from './format';

export const categoryLabels: Record<string, string> = {
  consistent_with_natural_event: 'Consistent with a natural event',
  consistent_with_human_influence: 'Consistent with human influence',
  possible_data_artifact: 'Possible data artifact',
  cause_undetermined: 'Cause undetermined',
};

export function References({value}: {value:unknown}) {
  const references=Array.isArray(value)?value.filter(isObject).filter(r=>safeLink(r.url)):[];
  return references.length>0?<ul className="context-references">{references.map((r,i)=><li key={i}><a href={safeLink(r.url)} target="_blank" rel="noreferrer">{typeof r.title==='string'?r.title:typeof r.id==='string'?r.id:'Source documentation'} ↗</a></li>)}</ul>:null;
}

function Reasons({title,value}: {title:string;value:unknown}) {
  const items=Array.isArray(value)?value.filter(v=>typeof v==='string'||isObject(v)):[];
  return <div className="reason-column"><h4>{title}</h4>{items.length?<ul>{items.map((v,i)=><li key={i}>{typeof v==='string'?v:text(v.text)}{isObject(v)&&<References value={v.reference?[v.reference]:v.references}/>}</li>)}</ul>:<p className="field-help">No items returned.</p>}</div>;
}

/** This component displays the service decision; it never assigns a cause. */
export function Mode2Conclusion({value}: {value:unknown}) {
  const c=record(value),label=categoryLabels[String(c.category)];
  const evidence=Array.isArray(c.evidence_for)?c.evidence_for.filter(isObject):[];
  const references=evidence.map(e=>e.reference).filter(isObject);
  const valid=Boolean(label)&&typeof c.statement==='string'&&(c.category!=='possible_data_artifact'||references.some(r=>safeLink(r.url)));
  const alternatives=Array.isArray(c.alternatives)?c.alternatives.filter(isObject):[];
  return <section className="mode2-conclusion" aria-label="Change interpretation">
    <p className="eyebrow">Mode 2 / evidence and alternatives</p>
    <h3>{valid?label:'Interpretation unavailable'}</h3>
    <p>{valid?c.statement as string:'The service has not returned a readable classification. No cause has been assigned.'}</p>
    {valid&&<>
      {c.category==='possible_data_artifact'&&<References value={references}/>}
      <details className="classification-evidence"><summary>Evidence for, against and alternatives</summary><div className="reason-grid"><Reasons title="Supporting observations" value={c.evidence_for}/><Reasons title="Counter-evidence and gaps" value={c.evidence_against}/></div><h4>Other explanations</h4>{alternatives.length?alternatives.map((a,i)=><Reasons key={i} title={categoryLabels[String(a.category)]??'Unrecognised alternative'} value={a.evidence}/>):<p className="field-help">No alternatives returned. This does not rule out other causes.</p>}</details>
      <details className="classification-method"><summary>How was this classified?</summary><p>{text(c.how_classified)}</p><p>Selected rule: {text(c.rule)}</p>{Array.isArray(c.rules_checked)&&<ul>{c.rules_checked.filter(isObject).map((r,i)=><li key={i}><strong>{text(r.rule)} · {r.applies===true?'Applies':r.applies===false?'Does not apply':'Not assessed'}</strong><p>{text(r.text)}</p>{typeof r.note==='string'&&<p>{r.note}</p>}</li>)}</ul>}<p>A category describes consistency with the available evidence. It is not proof of a cause or a probability.</p><details><summary>The four possible categories</summary><ul>{Object.values(categoryLabels).map(label=><li key={label}>{label}</li>)}</ul></details></details>
    </>}
  </section>;
}

const featureLabels:Record<string,string>={abruptness:'Abruptness',persistence:'Persistence',spatial_extent:'Spatial extent',other_variables:'Other variables'};
const featureValues:Record<string,string>={abrupt:'Abrupt change',gradual:'Gradual change remains plausible',unclear:'Step or trend unresolved',persistent:'Shift still present',temporary:'Shift has reduced',regional:'Widespread across neighbours',local:'Limited across neighbours',mixed:'Mixed across neighbours',also_in_other_variables:'Changes in other variables',only_this_variable:'No matching change in assessed variables'};
const detailLabel:Record<string,string>={delta_bic:'Step vs line / ΔBIC',shift:'Median anomaly shift',noise_sd_before:'Noise before the change',shift_to_noise:'Shift / noise',median_before:'Median before',median_after:'Median after',median_last_months:'Median in the last months',retained_fraction:'Fraction of shift retained',last_period:'Last assessed period',neighbours_with_change:'Neighbours with a matching change',neighbours_assessed:'Neighbours assessed',variables_with_change:'Variables with a matching change',variables_assessed:'Variables assessed',shows_change:'Matching change',lat:'Latitude',lon:'Longitude',change_status:'Change test state',variable_id:'Variable',within_months:'Search window / months'};
function DetailValues({value,depth=0}:{value:unknown;depth?:number}) {
  if(depth>4)return <p>Detail nesting exceeds the supported format.</p>;
  if(value===null||value===undefined)return <span>Not available</span>;
  if(finite(value))return <span>{number(value,6)}</span>;
  if(typeof value==='boolean')return <span>{value?'Yes':'No'}</span>;
  if(typeof value==='string')return <span>{/^\d{4}-(0[1-9]|1[0-2])$/.test(value)?month(value):value.replaceAll('_',' ')}</span>;
  if(Array.isArray(value))return value.length?<ul>{value.map((v,i)=><li key={i}><DetailValues value={v} depth={depth+1}/></li>)}</ul>:<span>None returned</span>;
  if(isObject(value))return <dl>{Object.entries(value).map(([key,v])=><div key={key}><dt>{detailLabel[key]??key.replaceAll('_',' ')}</dt><dd><DetailValues value={v} depth={depth+1}/></dd></div>)}</dl>;
  return <span>Not available</span>;
}
export function ChangeFeatures({value}: {value:unknown}) {
  const features=record(value);
  return <section className="change-features" aria-label="Measured change features"><h4>What the record shows</h4><div className="feature-grid">{Object.entries(featureLabels).map(([key,label])=>{
    const f=record(features[key]),assessed=f.status==='ok';
    return <article key={key}><p className="eyebrow">{label}</p><p className="feature-value">{assessed?(featureValues[String(f.value)]??'Value unavailable'):'Not assessed'}</p><details><summary>Measure and limits</summary>{typeof f.summary==='string'&&<p>{f.summary}</p>}{typeof f.reason==='string'&&<p>{f.reason.replaceAll('_',' ')}</p>}{isObject(f.detail)&&<DetailValues value={f.detail}/>}<p>{typeof f.method==='string'?f.method:'No measurement method was returned.'}</p>{key==='other_variables'&&<p>Different products can share inputs; matching changes are not independent proof of a cause.</p>}{key==='spatial_extent'&&<p>This describes the assessed neighbours, not the full extent of an event.</p>}<References value={f.references}/></details></article>;
  })}</div></section>;
}

export function EonetObservation({value}: {value:unknown}) {
  const e=record(value),items=e.status==='ok'&&Array.isArray(e.events)?e.events.filter(isObject):[];
  const label=e.status==='ok'?(items.length?`${number(items.length)} nearby event record${items.length===1?'':'s'}`:'No matching event records returned'):e.status==='no_events'?'No matching event records returned':e.status==='source_error'?'Event catalogue unavailable':'Not assessed';
  return <section className="eonet-observation" aria-label="EONET observation"><p className="eyebrow">NASA EONET / separate observation</p><h4>{label}</h4><p className="field-help">A nearby event does not establish a cause. No match does not rule out a natural event.</p><details><summary>Search and event records</summary><DetailValues value={e.search}/>{typeof e.coverage_note==='string'&&<p>{e.coverage_note}</p>}{typeof e.early_record_note==='string'&&<p>{e.early_record_note}</p>}{items.length>0&&<ul>{items.map((item,i)=><li key={i}><strong>{text(item.title)}</strong>{typeof item.first_date==='string'&&<span> · first record {item.first_date}</span>}{Array.isArray(item.categories)&&<p>{item.categories.filter(isObject).map(c=>text(c.title)).join(' · ')}</p>}<References value={item.sources}/>{safeLink(item.link)&&<a href={safeLink(item.link)} target="_blank" rel="noreferrer">Event record ↗</a>}</li>)}</ul>}<a href="https://eonet.gsfc.nasa.gov/" target="_blank" rel="noreferrer">About NASA EONET ↗</a></details></section>;
}
