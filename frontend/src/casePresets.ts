import type {AnalysisRequest,Variable,ObjectValue} from './contract';

export type GlobeMode='annual'|'trend'|'changes';
/** note: short neutral line for a Changes case, e.g. "cell where a candidate matches the event" (a real changes-1 match). */
export interface CaseRecipe {id:string;label:string;eventId?:string;boundaryId?:string;variable:string;layer:string;year:number;location:string;point?:{lat:number;lon:number};note?:string}
export interface ExploreCase {id:string;label:string;eventId?:string;boundaryId?:string;layer:GlobeMode;year:number;request:AnalysisRequest;source?:ObjectValue;locationNote:string;note?:string}

/** Selection recipes only. No observation, trend or cause is stored in a preset. */
export function resolveCases(recipes:CaseRecipe[],variables:Variable[],events:ObjectValue[]):ExploreCase[] {
  return recipes.flatMap(r=>{
    const v=variables.find(v=>v.variable_id===r.variable),event=r.eventId?events.find(e=>e.event_id===r.eventId):undefined;
    if(!v||(r.eventId&&!event)||!['annual','trend','changes'].includes(r.layer)||r.year<Number(v.coverage.start.slice(0,4))||r.year>Number(v.coverage.end.slice(0,4)))return [];
    if(event&&(!Array.isArray(event.variables)||!event.variables.includes(v.variable_id)))return [];
    const area=event?.area as {bbox?:number[];scope?:string}|undefined,b=area?.bbox;
    let location:AnalysisRequest['location']|undefined;
    if(r.location==='event_area'&&b?.length===4&&b.every(Number.isFinite)&&v.capabilities.area!=='not_available')location={type:'area',bbox:[b[0],b[1],b[2],b[3]]};
    else if(r.location==='event_centre'&&b?.length===4&&b.every(Number.isFinite))location={type:'point',lat:(b[1]+b[3])/2,lon:(b[0]+b[2])/2};
    else if(r.location==='point'&&r.point&&Number.isFinite(r.point.lat)&&Math.abs(r.point.lat)<=90&&Number.isFinite(r.point.lon)&&Math.abs(r.point.lon)<=180)location={type:'point',...r.point};
    if(!location)return [];
    const boundary=r.boundaryId?v.product_boundaries?.find(b=>b.boundary_id===r.boundaryId):undefined;
    if(r.boundaryId&&!boundary)return [];
    const note=typeof r.note==='string'&&r.note.trim()?r.note.trim():undefined;
    return [{id:r.id,label:r.label,eventId:r.eventId,boundaryId:r.boundaryId,layer:r.layer as GlobeMode,year:r.year,note,request:{variable_id:v.variable_id,location,period:{start:v.coverage.start,end:v.coverage.end}},source:event??boundary,locationNote:note?`Map ${note}; the point analysis uses the native record and can differ.`:r.location==='event_area'?'Area from the source’s approximate region.':r.location==='event_centre'?'Point at the centre of the source’s approximate region.':area?.scope==='global'?'A European record within the documented global context.':'A source-checked point record.'}];
  });
}
export interface WorkspaceLink {caseId?:string;variable?:string;layer?:GlobeMode;year?:number;lat?:number;lon?:number;bbox?:[number,number,number,number];start?:string;end?:string;error?:string}
export function resolveWorkspaceLink(link:WorkspaceLink,cases:ExploreCase[],variables:Variable[]) {
  const preset=link.caseId?cases.find(c=>c.id===link.caseId):undefined,v=variables.find(v=>v.variable_id===(link.variable??preset?.request.variable_id??'evapotranspiration'));
  if(link.error||link.caseId&&!preset||!v)return {error:link.error??(link.caseId&&!preset?'This case is unavailable.':'Unknown URL variable.')};
  const location=link.bbox?{type:'area' as const,bbox:link.bbox}:link.lat!==undefined&&link.lon!==undefined?{type:'point' as const,lat:link.lat,lon:link.lon}:preset?.request.location;
  const period={start:link.start??preset?.request.period.start??v.coverage.start,end:link.end??preset?.request.period.end??v.coverage.end};
  if(period.start>period.end)return {error:'The start month must come before the end month.'};
  if(location?.type==='area'&&v.capabilities.area==='not_available')return {error:'This product supports points only.'};
  const layer=link.layer??preset?.layer??'changes',year=link.year??preset?.year??2025,request=location?{variable_id:v.variable_id,location,period}:undefined;
  const context=preset&&request&&v.variable_id===preset.request.variable_id?{...preset,request,layer,year,locationNote:link.bbox||link.lat!==undefined?'Location supplied in the URL; event context is separate.':preset.locationNote}:undefined;
  return {preset:context,variable:v,layer,year,request};
}
export function readWorkspaceLink(search:string):WorkspaceLink {
  const p=new URLSearchParams(search),r:WorkspaceLink={};
  if(p.has('case'))r.caseId=p.get('case')??'';
  if(p.has('variable'))r.variable=p.get('variable')??'';
  const modes:Record<string,GlobeMode>={annual:'annual',trend:'trend',changes:'changes','annual-anomaly':'annual','full-period-trend':'trend'};
  if(p.has('layer')){r.layer=modes[p.get('layer')??''];if(!r.layer)r.error='Unknown URL layer.';}
  if(p.has('year')){const y=Number(p.get('year'));if(Number.isInteger(y)&&y>=1800&&y<=2200)r.year=y;else r.error='Invalid URL year.';}
  if(p.has('lat')||p.has('lon')){const lat=Number(p.get('lat')),lon=Number(p.get('lon'));if(p.get('lat')?.trim()&&p.get('lon')?.trim()&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180){r.lat=lat;r.lon=lon;}else r.error='Invalid URL coordinates.';}
  if(p.has('bbox')){const parts=p.get('bbox')!.split(','),b=parts.map(Number);if(parts.every(v=>v.trim())&&b.length===4&&b.every(Number.isFinite)&&b[0]<b[2]&&b[1]<b[3]&&Math.abs(b[0])<=180&&Math.abs(b[2])<=180&&Math.abs(b[1])<=90&&Math.abs(b[3])<=90)r.bbox=b as WorkspaceLink['bbox'];else r.error='Invalid URL area.';}
  for(const key of ['start','end'] as const)if(p.has(key)){const value=p.get(key)!;if(/^\d{4}-(0[1-9]|1[0-2])$/.test(value))r[key]=value;else r.error='Use YYYY-MM in URL periods.';}
  return r;
}

/** Explicit empty years stay valid; startup can prefer years with candidates. */
export function chooseDisplayYear(requested:number,frameYears:number[]|undefined,changePeriod?:{start:string;end:string},candidateYears?:number[]):{year?:number;notice?:string} {
  if(!frameYears?.length)return {};
  const available=frameYears.filter(y=>!changePeriod||(y>=Number(changePeriod.start.slice(0,4))&&y<=Number(changePeriod.end.slice(0,4))));
  if(!available.length)return {notice:'No shared year for the annual and Changes layers.'};
  if(candidateYears){const withChanges=available.filter(y=>candidateYears.includes(y));if(withChanges.length){if(withChanges.includes(requested))return {year:requested};const year=withChanges.at(-1)!;return {year,notice:available.includes(requested)?`${requested}: no mapped candidates · showing ${year}.`:`${requested} frame unavailable · showing ${year}.`};}return {year:available.at(-1),notice:'No mapped change candidates · annual background shown.'};}
  if(available.includes(requested))return {year:requested};
  const year=available.at(-1)!;return {year,notice:`${requested} is unavailable here · showing ${year}.`};
}
