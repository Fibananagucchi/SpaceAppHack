/** Small synthetic grids and locations for tests only. */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { cellLocation, cellState, oppositePair, parseTrendMap } from '../src/trendMap';
import { analysisState, requestFromAreaFields } from '../src/contract';
import { useAnalysis } from '../src/useAnalysis';
import { jsonResponse, request } from './fixtures';
const grid={status:'ok',format_version:'map-1.2',variable_id:'test',period:{start:'2000-01',end:'2020-12'},unit:'test per decade',grid:{shape:[2,2],lat0:40,lon0:0,dlat:1,dlon:1,cell_reference:'center'},legend:{center:0,range:[-2,2]},status_codes:{'0':'ok','1':'no_data'},cells:{slope:[0,-1,2,null],p_value:[.5,.001,.001,null],q_value:[.5,.004,.004,null],significant:[false,true,true,null],status:[0,0,0,1]}};
afterEach(()=>vi.unstubAllGlobals());
describe('Real map contract and areas',()=>{
  it('uses southern row zero and keeps a valid zero distinct from no data',()=>{
    const m=parseTrendMap(grid,'test');expect(cellLocation(m,0)).toEqual({lat:40,lon:0});expect(cellLocation(m,2)).toEqual({lat:41,lon:0});expect(cellState(m,0)).toBe('ok');expect(m.slope[0]).toBe(0);expect(cellState(m,3)).toBe('no_data');
  });
  it('finds opposite signs only among cells passing the server FDR decision',()=>{
    expect(oppositePair(parseTrendMap(grid,'test'))).toEqual([1,2]);
    expect(oppositePair(parseTrendMap({...grid,cells:{...grid.cells,significant:[false,false,true,null]}},'test'))).toBeUndefined();
  });
  it('rejects truncated grids, unknown statuses and fabricated zeros for missing cells',()=>{
    expect(()=>parseTrendMap({...grid,cells:{...grid.cells,q_value:[0]}},'test')).toThrow();
    expect(()=>parseTrendMap({...grid,cells:{...grid.cells,status:[0,0,0,9]}},'test')).toThrow();
    expect(()=>parseTrendMap({...grid,cells:{...grid.cells,slope:[0,-1,2,0]}},'test')).toThrow();
  });
  it('validates all four bounds, decimal dots and boxes crossing 180 degrees',()=>{
    expect(requestFromAreaFields('test',['','','',''],'2000-01','2020-12')).toHaveProperty('error');
    expect(requestFromAreaFields('test',['170','40','-170','50'],'2000-01','2020-12')).toHaveProperty('error');
    expect(requestFromAreaFields('test',['30','45','34','48'],'2000-01','2020-12')).toMatchObject({request:{location:{type:'area',bbox:[30,45,34,48]}}});
  });
  it('rejects an area response for a different box even with the same period',()=>{
    const r={...request,location:{type:'area' as const,bbox:[30,45,34,48] as [number,number,number,number]}};
    expect(analysisState({httpStatus:200,data:{request:{...r,location:{type:'area',bbox:[31,45,34,48]}},status:'no_data'}},r).kind).toBe('protocol_error');
    expect(analysisState({httpStatus:200,data:{request:{...r,request_id:'original_creator'},request_id:'original_creator',analysis_id:'a_shared_test',series:{status:'ok'}}},{...r,request_id:'second_client'}).kind).toBe('ready');
  });
  it('allows comparison requests without resuming or erasing the main pending job',async()=>{
    sessionStorage.setItem('earth-trends-pending-request-v1',JSON.stringify({jobId:'j_main',request}));
    const fetcher=vi.fn().mockResolvedValue(jsonResponse({status:'not_found'},404));vi.stubGlobal('fetch',fetcher);
    const {result}=renderHook(()=>useAnalysis(false));
    expect(result.current.state.kind).toBe('idle');
    await waitFor(()=>expect(fetcher).not.toHaveBeenCalled());
    expect(sessionStorage.getItem('earth-trends-pending-request-v1')).toContain('j_main');
  });
});
