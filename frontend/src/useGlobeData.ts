import {useEffect,useState} from 'react';
import {apiRequest,isAbort} from './api';
import {parseGlobeFrames,parseNeighborStrip} from './globeData';
import type {GlobeFrames,NeighborStrip} from './globeData';
import {parseTrendMap} from './trendMap';
import type {TrendMap} from './trendMap';
import type {Variable} from './contract';

export interface GlobeResource<T> {kind:'loading'|'ready'|'not_available'|'error';data?:T;key:string}
export function useGlobeData(variable:Variable|undefined,refresh:number) {
  const id=variable?.variable_id??'';
  const [frames,setFrames]=useState<GlobeResource<GlobeFrames>>({kind:'loading',key:''}),[map,setMap]=useState<GlobeResource<TrendMap>>({kind:'loading',key:''});
  useEffect(()=>{if(!id)return;const c=new AbortController();setFrames({kind:'loading',key:id});setMap({kind:'loading',key:id});
    const load=<T,>(path:string,parse:(d:Record<string,unknown>)=>T,set:(s:GlobeResource<T>)=>void)=>{void apiRequest(path,{signal:c.signal}).then(r=>{if(c.signal.aborted)return;if(['not_ready','not_available','not_found'].includes(String(r.data.status))){set({key:id,kind:'not_available'});return;}if(r.httpStatus!==200)throw Error();set({key:id,kind:'ready',data:parse(r.data)});}).catch(e=>{if(!c.signal.aborted&&!isAbort(e))set({key:id,kind:'error'});});};
    if(variable?.capabilities.map_europe!=='precomputed'){setFrames({key:id,kind:'not_available'});setMap({key:id,kind:'not_available'});}else{load(`/globe/europe/${encodeURIComponent(id)}`,d=>parseGlobeFrames(d,id),setFrames);load(`/globe/europe/${encodeURIComponent(id)}/trend`,d=>{const map=parseTrendMap(d,id);if(d.layer!=='globe_trend_1deg'||map.rows!==38||map.cols!==70||map.dlat!==1||map.dlon!==1||map.lat0!==34.5||map.lon0!==-24.5)throw Error('invalid_globe_trend_grid');return map;},setMap);}
    return()=>c.abort();
  },[id,variable?.capabilities.map_europe,refresh]);
  return {frames:frames.key===id?frames:{kind:'loading' as const,key:id},map:map.key===id?map:{kind:'loading' as const,key:id}};
}
export function useNeighborStrip(id:string,point:{lat:number;lon:number}|undefined,refresh:number) {
  const key=point?JSON.stringify([id,point.lat,point.lon]):'';
  const [resource,setResource]=useState<GlobeResource<NeighborStrip>>({kind:'not_available',key:''});
  useEffect(()=>{if(!point||!id){setResource({kind:'not_available',key});return;}const c=new AbortController();setResource({kind:'loading',key});void apiRequest(`/globe/europe/${encodeURIComponent(id)}/strip?lat=${point.lat}&lon=${point.lon}&ring=1`,{signal:c.signal}).then(r=>{if(c.signal.aborted)return;if(['not_available','not_ready'].includes(String(r.data.status))){setResource({kind:'not_available',key});return;}if(r.httpStatus!==200)throw Error();setResource({kind:'ready',key,data:parseNeighborStrip(r.data,id)});}).catch(e=>{if(!c.signal.aborted&&!isAbort(e))setResource({kind:'error',key});});return()=>c.abort();},[key,refresh]);
  return resource.key===key?resource:{kind:'loading' as const,key};
}
