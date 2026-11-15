import {useEffect,useState} from 'react';
import {apiRequest,isAbort} from './api';
import {parseGlobeFrames,parseNeighborStrip,validateDisplayGrid} from './globeData';
import type {GlobeFrames,NeighborStrip,GlobeDomain} from './globeData';
import {parseTrendMap} from './trendMap';
import type {TrendMap} from './trendMap';
import type {Variable} from './contract';
import {record} from './analysis';

export interface GlobeResource<T> {kind:'loading'|'ready'|'not_available'|'error';data?:T;key:string;domain?:GlobeDomain;notice?:string}
/** Publish each real world resource independently; keep Europe until it is ready. */
export function useGlobeData(variable:Variable|undefined,refresh:number):{frames:GlobeResource<GlobeFrames>;map:GlobeResource<TrendMap>} {
  const id=variable?.variable_id??'';
  const [frames,setFrames]=useState<GlobeResource<GlobeFrames>>({kind:'loading',key:''}),[map,setMap]=useState<GlobeResource<TrendMap>>({kind:'loading',key:''});
  useEffect(()=>{
    if(!id)return;const c=new AbortController();let live=true,checking=false;
    setFrames({kind:'loading',key:id});setMap({kind:'loading',key:id});
    if(variable?.capabilities.map_europe!=='precomputed'){setFrames({kind:'not_available',key:id});setMap({kind:'not_available',key:id});return()=>c.abort();}
    const loaded=new Map<string,string>(),pending=new Set<string>(),worldIssues:Partial<Record<'frames'|'trend',string>>={};
    const load=async<T extends {raw:Record<string,unknown>},>(domain:GlobeDomain,type:'frames'|'trend',parse:(d:Record<string,unknown>)=>T,set:(fn:(old:GlobeResource<T>)=>GlobeResource<T>)=>void,revision='initial')=>{
      const key=domain+'/'+type;if(loaded.get(key)===revision||pending.has(key))return;pending.add(key);
      try{
        const r=await apiRequest(`/globe/${domain}/${encodeURIComponent(id)}${type==='trend'?'/trend':''}`,{signal:c.signal});
        if(c.signal.aborted||!live)return;
        if(['not_ready','not_available','not_found'].includes(String(r.data.status))){if(domain==='europe')set(old=>old.domain==='world'?old:{key:id,kind:'not_available'});return;}
        if(r.httpStatus!==200)throw Error();validateDisplayGrid(r.data,domain);const data=parse(r.data);loaded.set(key,revision);
        set(old=>{
          if(domain==='europe'&&old.domain==='world')return old;
          if(old.key===id&&old.domain===domain&&typeof data.raw.computed_at==='string'&&old.data?.raw.computed_at===data.raw.computed_at)return old.notice&&domain==='world'?{...old,notice:undefined}:old;
          return {key:id,kind:'ready',data,domain,notice:domain==='europe'?(worldIssues[type]??'Europe only · world layer is not ready for this view.'):undefined};
        });
      }catch(e){if(!c.signal.aborted&&!isAbort(e)&&live){if(domain==='world')worldIssues[type]='World layer unavailable · showing Europe only.';set(old=>domain==='world'&&old.data?{...old,notice:old.domain==='world'?'World refresh failed · showing the last loaded world layer.':worldIssues[type]}:domain==='europe'&&old.domain==='world'?old:{key:id,kind:'error'});}}
      finally{pending.delete(key);}
    };
    const loadFrames=(domain:GlobeDomain,revision?:string)=>load(domain,'frames',d=>parseGlobeFrames(d,id),setFrames,revision);
    const loadTrend=(domain:GlobeDomain,revision?:string)=>load(domain,'trend',d=>parseTrendMap(d,id),setMap,revision);
    void loadFrames('europe');void loadTrend('europe');
    const check=async()=>{
      if(checking||document.visibilityState==='hidden')return;checking=true;
      try{
        const response=await apiRequest('/globe',{signal:c.signal,timeout:10000});if(c.signal.aborted||!live)return;
        if(response.httpStatus!==200||!Array.isArray(response.data.layers))throw Error('availability_unavailable');
        const entry=response.data.layers.map(record).find(v=>v.variable_id===id),world=record(entry?.world);
        if(record(world.frames).status==='ok')void loadFrames('world',String(record(world.frames).computed_at??'initial'));
        if(record(world.trend).status==='ok')void loadTrend('world',String(record(world.trend).computed_at??`poll-${Math.floor(Date.now()/60000)}`));
      }catch(e){if(!isAbort(e)&&live&&!c.signal.aborted){const mark=<T,>(old:GlobeResource<T>)=>old.domain==='europe'?{...old,notice:'Europe only · world availability could not be checked.'}:old;setFrames(mark);setMap(mark);}}
      finally{checking=false;}
    };
    void check();const timer=window.setInterval(()=>void check(),20000),focus=()=>void check();window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
    return()=>{live=false;c.abort();clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
  },[id,variable?.capabilities.map_europe,refresh]);
  return {frames:frames.key===id?frames:{kind:'loading' as const,key:id},map:map.key===id?map:{kind:'loading' as const,key:id}};
}
export function useNeighborStrip(id:string,point:{lat:number;lon:number}|undefined,refresh:number,domain:GlobeDomain='europe'):GlobeResource<NeighborStrip> {
  const key=point?JSON.stringify([id,point.lat,point.lon,domain]):'';
  const [resource,setResource]=useState<GlobeResource<NeighborStrip>>({kind:'not_available',key:''});
  useEffect(()=>{if(!point||!id){setResource({kind:'not_available',key});return;}const c=new AbortController();setResource({kind:'loading',key});void apiRequest(`/globe/${domain}/${encodeURIComponent(id)}/strip?lat=${point.lat}&lon=${point.lon}&ring=1`,{signal:c.signal}).then(r=>{if(c.signal.aborted)return;if(['not_available','not_ready'].includes(String(r.data.status))){setResource({kind:'not_available',key,domain});return;}if(r.httpStatus!==200)throw Error();setResource({kind:'ready',key,domain,data:parseNeighborStrip(r.data,id)});}).catch(e=>{if(!c.signal.aborted&&!isAbort(e))setResource({kind:'error',key,domain});});return()=>c.abort();},[key,refresh]);
  return resource.key===key?resource:{kind:'loading' as const,key};
}
