/** Synthetic protocol cases only; never imported by the product. */
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { categoryLabels, ChangeFeatures, EonetObservation, Mode2Conclusion } from '../src/Mode2Conclusion';
import { useInvestigation } from '../src/useInvestigation';
import { InvestigationPanel } from '../src/InvestigationPanel';
import { StatusNotice } from '../src/StatusNotice';
import { readEstimate } from '../src/contract';
import { jsonResponse } from './fixtures';

const conclusion=(category:string)=>({category,statement:'Synthetic statement for a protocol test.',evidence_for:[{text:'Synthetic boundary evidence',reference:{title:'Test document',url:'https://example.org/method'}}],evidence_against:[],alternatives:[],rule:'R1',rules_checked:[],how_classified:'Synthetic rule text.',never_proof:true});
const complete={investigation_id:'i_test_context',analysis_id:'a_test_context',change_id:'c_test_context',status:'complete',conclusion:conclusion('cause_undetermined'),features:{},eonet:{status:'ok',events:[]}};
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});

describe('Service-supplied interpretation',()=>{
  it.each(Object.entries(categoryLabels))('displays %s without assigning its own category',(key,label)=>{
    render(<Mode2Conclusion value={conclusion(key)}/>);
    expect(screen.getByRole('heading',{name:label})).toBeTruthy();
    expect(screen.getByText('How was this classified?')).toBeTruthy();
  });
  it('requires source documentation for an artifact and never substitutes undetermined for a broken response',()=>{
    render(<Mode2Conclusion value={{...conclusion('possible_data_artifact'),evidence_for:[]}}/>);
    expect(screen.getByRole('heading',{name:'Interpretation unavailable'})).toBeTruthy();
    expect(screen.queryByRole('heading',{name:'Possible data artifact'})).toBeNull();
    expect(screen.queryByRole('heading',{name:'Cause undetermined'})).toBeNull();
  });
  it('exposes boundary documentation on the artifact card before opening details',()=>{
    const {container}=render(<Mode2Conclusion value={conclusion('possible_data_artifact')}/>);
    expect(container.querySelector('.mode2-conclusion > .context-references a')?.getAttribute('href')).toBe('https://example.org/method');
  });
  it('keeps a numeric zero, missing values and unassessed features distinct',()=>{
    render(<ChangeFeatures value={{abruptness:{status:'ok',value:'abrupt',detail:{shift:0,noise_sd_before:null,unit:'test units'}},persistence:{status:'not_assessed',reason:'too_little_data_after_change'}}}/>);
    expect(screen.getByText('Abrupt change')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByText('Not available')).toBeTruthy();
    expect(screen.getAllByText('Not assessed')).toHaveLength(3);
  });
  it('presents EONET no-match and failure as separate observations',()=>{
    const {rerender}=render(<EonetObservation value={{status:'ok',events:[],search:{start:'2020-01-01',end:'2020-04-01',bbox:[0,0,1,1]}}}/>);
    expect(screen.getByRole('heading',{name:'No matching event records returned'})).toBeTruthy();
    expect(screen.getByText(/No match does not rule out a natural event/)).toBeTruthy();
    rerender(<EonetObservation value={{status:'source_error',events:[{title:'Stale event'}]}}/>);
    expect(screen.getByRole('heading',{name:'Event catalogue unavailable'})).toBeTruthy();
    expect(screen.queryByText('Stale event')).toBeNull();
  });
});

describe('Context request lifecycle',()=>{
  it('does not offer an unsupported MODIS investigation or assign a cause',()=>{
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
    render(<InvestigationPanel available={false} data={{analysis_id:'a_modis',breaks:{change_point:{change_id:'c_modis',status:'detected'}}}}/>);
    expect(screen.getByRole('heading',{name:'Wider-context checks are unavailable for this product.'})).toBeTruthy();
    expect(screen.queryByRole('button',{name:'Check wider context ↗'})).toBeNull();expect(fetcher).not.toHaveBeenCalled();
  });
  it('follows only local investigation endpoints and preserves the main pending job',async()=>{
    vi.useFakeTimers();sessionStorage.setItem('earth-trends-pending-request-v1','main job');
    const fetcher=vi.fn().mockResolvedValueOnce(jsonResponse({status:'queued',job_id:'j_context',kind:'investigation',next_poll_s:1,request:{analysis_id:'a_test_context',change_id:'c_test_context'}},202)).mockResolvedValueOnce(jsonResponse({status:'complete',result:{type:'investigation',id:'i_test_context',url:'https://example.invalid/ignore'}})).mockResolvedValueOnce(jsonResponse(complete));
    vi.stubGlobal('fetch',fetcher);const {result}=renderHook(()=>useInvestigation('a_test_context','c_test_context'));
    await act(async()=>{result.current.run();});expect(result.current.state.kind).toBe('queued');
    await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});expect(result.current.state.kind).toBe('ready');
    expect(fetcher.mock.calls.map(c=>c[0])).toEqual(['/api/v1/investigations','/api/v1/jobs/j_context','/api/v1/investigations/i_test_context']);
    expect(sessionStorage.getItem('earth-trends-pending-request-v1')).toBe('main job');
  });
  it('rejects a result for a different analysis instead of showing an old cause',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(jsonResponse({...complete,analysis_id:'a_other'})));
    const {result}=renderHook(()=>useInvestigation('a_test_context','c_test_context'));
    await act(async()=>{result.current.run();});expect(result.current.state.kind).toBe('protocol_error');expect(result.current.state.result).toBeUndefined();
  });
  it('does not accept a late result after moving to another analysis',async()=>{
    let release!:(r:Response)=>void;const pending=new Promise<Response>(resolve=>{release=resolve;});
    vi.stubGlobal('fetch',vi.fn().mockReturnValue(pending));const {result,rerender}=renderHook(({id})=>useInvestigation(id,'c_test_context'),{initialProps:{id:'a_test_context'}});
    act(()=>result.current.run());rerender({id:'a_next'});await act(async()=>{release(jsonResponse(complete));await pending;});expect(result.current.state.kind).toBe('idle');
  });
  it('shows elapsed time without inventing percent and labels an estimate',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-14T21:00:00Z'));
    render(<StatusNotice purpose="investigation" state={{kind:'running',warnings:[],startedAt:Date.now(),estimateSeconds:20}}/>);
    await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});
    expect(screen.getByText('Elapsed 00:03')).toBeTruthy();expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText(/not a countdown/)).toBeTruthy();
    expect(readEstimate({estimate_s:{value:20,kind:'estimate'}})).toBe(20);expect(readEstimate({estimate_s:{value:NaN,kind:'estimate'}})).toBeUndefined();
  });
  it('renders only a server-reported MODIS counter',()=>{
    render(<StatusNotice state={{kind:'running',warnings:[],jobKind:'modis_point',progress:{done:0,total:321,unit:'months'}}}/>);
    expect(screen.getByRole('progressbar').getAttribute('value')).toBe('0');expect(screen.getByText('0 of 321 monthly files checked')).toBeTruthy();
  });
});
