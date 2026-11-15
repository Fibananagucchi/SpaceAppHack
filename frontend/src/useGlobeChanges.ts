import {useEffect,useState} from 'react';
import {apiRequest,isAbort} from './api';
import {record} from './analysis';
import {parseChanges,parseGlobeEvents} from './globeChanges';
import type {ChangeLayer,GlobeEvent} from './globeChanges';
import type {GlobeResource} from './useGlobeData';
import type {Variable} from './contract';

export function useGlobeChanges(variable:Variable|undefined,refresh:number) {
  const id=variable?.variable_id??'',[resource,setResource]=useState<GlobeResource<ChangeLayer>>({kind:'loading',key:''}),[events,setEvents]=useState<GlobeEvent[]>([]),[eventsState,setEventsState]=useState('loading');
  useEffect(()=>{const c=new AbortController();setEventsState('loading');void apiRequest('/known-events',{signal:c.signal}).then(r=>{if(c.signal.aborted)return;if(r.httpStatus!==200)throw Error();setEvents(parseGlobeEvents(r.data));setEventsState('ready');}).catch(e=>{if(!c.signal.aborted&&!isAbort(e)){setEvents([]);setEventsState('error');}});return()=>c.abort();},[refresh]);
  useEffect(()=>{
    if(!id)return;const c=new AbortController();let checking=false,revision='',worldReady=false;setResource({kind:'loading',key:id});
    if(variable?.capabilities.map_europe!=='precomputed'){setResource({kind:'not_available',key:id});return()=>c.abort();}
    const check=async()=>{if(checking||document.hidden)return;checking=true;try{
      const index=await apiRequest('/globe',{signal:c.signal,timeout:10000});if(c.signal.aborted)return;if(index.httpStatus!==200||!Array.isArray(index.data.layers))throw Error();
      const entry=index.data.layers.map(record).find(v=>v.variable_id===id),world=record(record(entry?.world).changes),europe=record(record(entry?.europe).changes),domain=world.status==='ok'?'world':europe.status==='ok'?'europe':undefined;
      if(!domain){setResource(old=>old.data?{...old,notice:'Showing the last loaded changes.'}:{kind:'not_available',key:id,notice:'Changes are not ready for this variable.'});return;}
      const metadata=domain==='world'?world:europe,next=domain+'/'+String(metadata.computed_at??Math.floor(Date.now()/60000));if(next===revision)return;
      const response=await apiRequest(`/globe/${domain}/${encodeURIComponent(id)}/changes`,{signal:c.signal});if(c.signal.aborted)return;if(response.httpStatus!==200||response.data.status!=='ok')throw Error();const data=parseChanges(response.data,id,domain);if(!data.boundaries.length&&Array.isArray(variable?.product_boundaries))data.boundaries=variable.product_boundaries;revision=next;worldReady=domain==='world';
      setResource({kind:'ready',key:id,domain,data,notice:domain==='europe'?'Europe changes only · world is still being prepared.':undefined});
    }catch(e){if(!c.signal.aborted&&!isAbort(e))setResource(old=>old.data?{...old,notice:'Refresh failed · showing the last loaded changes.'}:{kind:'error',key:id,notice:worldReady?'World changes unavailable.':'Changes could not be loaded.'});}finally{checking=false;}};
    void check();const timer=setInterval(()=>void check(),20000),focus=()=>void check();window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);return()=>{c.abort();clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
  },[id,refresh,variable?.capabilities.map_europe]);
  return {allEvents:events,resource:resource.key===id?resource:{kind:'loading' as const,key:id},events:events.filter(e=>e.variables.includes(id)),eventsState};
}
