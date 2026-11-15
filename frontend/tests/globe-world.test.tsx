/** Synthetic protocol cases are confined to tests, never observation sources. */
import {afterEach,describe,expect,it,vi} from 'vitest';
import {act,renderHook,waitFor} from '@testing-library/react';
import {displaySample,projectVisible} from '../src/globeLod';
import type {GlobeLayer,GeoPoint} from '../src/globeGeometry';
import {project} from '../src/globeGeometry';
import {useGlobeData} from '../src/useGlobeData';
import type {Variable} from '../src/contract';

const world:GlobeLayer={domain:'world',rows:90,cols:180,lat0:-89,lon0:-179,dlat:2,dlon:2,values:[],unit:'test',limit:1,label:'Test grid'};
const variable:Variable={variable_id:'test',label:'Test',definition:null,unit:'test',trend_unit:'test',coverage:{start:'2000-01',end:'2000-12',surface:'test'},source:{mission_or_model:'test',provider:'test',product:'test',version:'test',doi:'test'},native_resolution:{lat_deg:1,lon_deg:1,time:'monthly'},capabilities:{map_europe:'precomputed'}};
const grid=(domain:string)=>domain==='world'?{shape:[90,180],lat0:-89,lon0:-179,dlat:2,dlon:2,cell_reference:'center'}:{shape:[38,70],lat0:34.5,lon0:-24.5,dlat:1,dlon:1,cell_reference:'center'};
function frames(domain:string){const g=grid(domain),n=g.shape[0]*g.shape[1];return{status:'ok',format_version:'globe-1',domain:{id:domain},variable_id:'test',unit:'test',grid:g,encoding:{scale:.001},legend:{range:[-1,1]},baseline:{kind:'full_record',period:{start:'2000-01',end:'2000-12'}},annual:{min_valid_months:10},years:[2000],months_in_record:[12],frames:[Array(n).fill(null)]};}
function trend(domain:string){const g=grid(domain),n=g.shape[0]*g.shape[1];return{status:'ok',format_version:'map-1.2',domain:{id:domain},variable_id:'test',unit:'test',grid:g,period:{start:'2000-01',end:'2000-12'},legend:{range:[-1,1]},status_codes:{1:'no_data'},cells:{slope:Array(n).fill(null),p_value:Array(n).fill(null),q_value:Array(n).fill(null),significant:Array(n).fill(null),status:Array(n).fill(1)}};}
function fakeApi(worldFrames:boolean,worldTrend:()=>boolean,malformed=false,revision:()=>string=()=>"first"){
  return vi.fn(async(input:RequestInfo|URL)=>{const url=String(input),domain=url.includes('/world/')?'world':'europe';let value:unknown;
    if(url==='/api/v1/globe')value={status:'ok',layers:[{variable_id:'test',world:{frames:{status:worldFrames?'ok':'not_ready',computed_at:revision()},trend:{status:worldTrend()?'ok':'not_ready',computed_at:revision()}}}]};
    else value=url.endsWith('/trend')?trend(domain):frames(domain);
    if(malformed&&domain==='world')value={...(value as object),domain:{id:'europe'}};
    return new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
  });
}
afterEach(()=>vi.unstubAllGlobals());
describe('Display detail and visible hemisphere',()=>{
  it('samples original world indices at overview, preserving the full grid at close zoom',()=>{const overview=displaySample(world,1),close=displaySample(world,8);expect(overview.indices.length).toBeLessThan(5000);expect(overview.step).toBe(2);expect(new Set(overview.indices).size).toBe(overview.indices.length);expect([...overview.indices].every(i=>i>=0&&i<16200)).toBe(true);expect(close.indices.length).toBe(16200);expect(close.indices[16199]).toBe(16199);});
  it('keeps the Europe-only 1° layer intact at overview',()=>{const sample=displaySample({...world,domain:'europe',rows:38,cols:70},1);expect(sample.step).toBe(1);expect(sample.indices.length).toBe(2660);});
  it('culls the back hemisphere and offscreen points while preserving date-line projection',()=>{
    const points:GeoPoint[]=[{lat:0,lon:179},{lat:0,lon:-179},{lat:0,lon:0},{lat:80,lon:180}],vectors=new Float64Array(points.length*4);
    points.forEach((p,i)=>{const phi=p.lat*Math.PI/180,lambda=p.lon*Math.PI/180;vectors.set([Math.cos(phi)*Math.sin(lambda),Math.sin(phi),Math.cos(phi)*Math.cos(lambda),.02],i*4);});
    const view={lat:0,lon:180,x:100,y:100,radius:300},visible=projectVisible(vectors,Uint32Array.from([0,1,2,3]),view,200,200,1);
    expect([...visible.indices.slice(0,visible.count)]).toEqual([0,1]);for(let i=0;i<2;i++){const expected=project(points[i],view);expect(visible.xy[i*4]).toBeCloseTo(expected.x,4);expect(visible.xy[i*4+1]).toBeCloseTo(expected.y,4);expect(visible.xy[i*4+2]).toBeGreaterThan(0);}
  });
});
describe('Independent world resource publication',()=>{
  it('uses world frames with Europe trend, then picks up a newly published trend on focus',async()=>{
    let ready=false;vi.stubGlobal('fetch',fakeApi(true,()=>ready));const {result,unmount}=renderHook(()=>useGlobeData(variable,0));
    await waitFor(()=>{expect(result.current.frames.domain).toBe('world');expect(result.current.map.domain).toBe('europe');});
    expect(result.current.map.notice).toContain('Europe only');expect(result.current.frames.data?.frames[0].every(v=>v===null)).toBe(true);
    ready=true;act(()=>window.dispatchEvent(new Event('focus')));await waitFor(()=>expect(result.current.map.domain).toBe('world'));unmount();
  });
  it('reloads a revised published payload while leaving an unchanged resource cached',async()=>{
    let revision='first';const fetch=fakeApi(true,()=>true,false,()=>revision);vi.stubGlobal('fetch',fetch);const {result,unmount}=renderHook(()=>useGlobeData(variable,0));
    await waitFor(()=>expect(result.current.map.domain).toBe('world'));const first=result.current.map.data;
    act(()=>window.dispatchEvent(new Event('focus')));await waitFor(()=>expect(fetch.mock.calls.filter(c=>String(c[0])==='/api/v1/globe').length).toBeGreaterThan(1));expect(result.current.map.data).toBe(first);
    revision='second';act(()=>window.dispatchEvent(new Event('focus')));await waitFor(()=>expect(result.current.map.data).not.toBe(first));expect(result.current.map.domain).toBe('world');unmount();
  });
  it('does not replace identical computed payloads when the fallback revalidation token changes',async()=>{
    let revision='first';const base=fakeApi(true,()=>true,false,()=>revision);vi.stubGlobal('fetch',async(input:RequestInfo|URL)=>{const response=await base(input);if(!String(input).includes('/world/'))return response;const data=await response.json();return new Response(JSON.stringify({...data,computed_at:'2000-01-01T00:00:00Z'}),{headers:{'content-type':'application/json'}});});const {result,unmount}=renderHook(()=>useGlobeData(variable,0));
    await waitFor(()=>expect(result.current.map.domain).toBe('world'));const previous=result.current.map.data;revision='second';act(()=>window.dispatchEvent(new Event('focus')));await waitFor(()=>expect(base.mock.calls.filter(c=>String(c[0]).endsWith('/world/test/trend')).length).toBe(2));expect(result.current.map.data).toBe(previous);unmount();
  });
  it('labels a failed world refresh as cached world data, without claiming Europe coverage',async()=>{
    let revision='first',fail=false;const base=fakeApi(true,()=>true,false,()=>revision);vi.stubGlobal('fetch',async(input:RequestInfo|URL)=>{if(fail&&String(input).includes('/world/'))throw Error('test transport failure');return base(input);});const {result,unmount}=renderHook(()=>useGlobeData(variable,0));
    await waitFor(()=>expect(result.current.map.domain).toBe('world'));const previous=result.current.map.data;revision='second';fail=true;act(()=>window.dispatchEvent(new Event('focus')));
    await waitFor(()=>expect(result.current.map.notice).toContain('last loaded world'));expect(result.current.map.domain).toBe('world');expect(result.current.map.data).toBe(previous);unmount();
  });
  it('retains explicitly labelled Europe data when a published world layer has invalid metadata',async()=>{
    vi.stubGlobal('fetch',fakeApi(true,()=>true,true));const {result,unmount}=renderHook(()=>useGlobeData(variable,0));
    await waitFor(()=>expect(result.current.frames.domain).toBe('europe'));expect(result.current.frames.data?.grid.cols).toBe(70);expect(result.current.frames.notice).toContain('Europe');unmount();
  });
  it('does not fetch an unsupported globe layer for point-only products',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const {result,unmount}=renderHook(()=>useGlobeData({...variable,capabilities:{...variable.capabilities,map_europe:'not_available'}},0));
    await waitFor(()=>expect(result.current.frames.kind).toBe('not_available'));expect(fetch).not.toHaveBeenCalled();unmount();
  });
});
