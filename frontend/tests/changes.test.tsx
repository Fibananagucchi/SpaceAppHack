/** Synthetic change-response fixtures; this module is never imported by the product. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChangePanel, markersFrom } from '../src/ChangePanel';
import { AnalysisView } from '../src/AnalysisView';
import { TimeSeries } from '../src/TimeSeries';
import { analysisState } from '../src/contract';
import { request, variable } from './fixtures';

const points=[{t:'2000-01',v:0,anomaly:-1},{t:'2000-02',v:1,anomaly:0},{t:'2000-03',v:null,anomaly:null},{t:'2000-04',v:3,anomaly:2},{t:'2000-05',v:4,anomaly:3}];
const change={status:'detected',change_id:'c_test',date:'2000-04',p_value:.001,alpha:.05,shift:{estimate:2,unit:'test'},model_comparison:{status:'ok',preferred:'step',delta_bic:7}};
const segment=(start:string,end:string)=>({status:'ok',period:{start,end},n_valid:40,sen_slope:{estimate:.1,unit:'test per decade'},mann_kendall:{p_value:.1,significant:false},trend_line:{status:'ok',points:[{t:start,y:.2},{t:end,y:.4}],band:null}});
const payload={analysis_id:'a_change_test',status:'ok',request,series:{status:'ok',unit:'test',points},trend:{monthly_anomalies:{}},breaks:{status:'ok',change_point:change,segments:[segment('2000-01','2000-02'),segment('2000-04','2000-05')],outliers:{status:'ok',items:[{t:'2000-05',v:4,anomaly:3,robust_z:4.2}]},features:{persistence:{status:'not_assessed'}}},warnings:[{code:'product_boundary_in_period',boundary_id:'b_test',date:'2000-02',title:'Test-only boundary',reference:{title:'Test documentation',url:'https://example.org/product'}}]};

describe('Change seam and independent evidence',()=>{
  it.each(['not_detected','not_distinct_from_trend'])('does not turn %s into an abrupt seam',status=>{
    const data={...payload,breaks:{...payload.breaks,change_point:{...change,status}}};
    expect(markersFrom(data).some(m=>m.kind==='change')).toBe(false);
    render(<ChangePanel data={data} onSelect={()=>{}} />);
    expect(screen.queryByRole('button',{name:/Inspect Apr 2000/})).toBeNull();
    expect(screen.getByText(status==='not_detected'?'No change detected by this test.':'A gradual trend remains plausible.')).toBeTruthy();
  });
  it('marks inconclusive results as tentative, separate from documented boundaries',()=>{
    const markers=markersFrom({...payload,breaks:{...payload.breaks,change_point:{...change,status:'inconclusive'}}});
    expect(markers.find(m=>m.kind==='change')).toMatchObject({tentative:true,label:'Unresolved candidate'});
    expect(markers.find(m=>m.kind==='boundary')?.date).toBe('2000-02');
    expect(analysisState({httpStatus:200,data:payload},request).warnings[0].reference).toBe('https://example.org/product');
  });
  it('links chart and list selection and switches to supplied segment fits',()=>{
    render(<AnalysisView variable={variable} state={{kind:'ready',warnings:[],result:payload,analysisId:payload.analysis_id}} />);
    fireEvent.click(screen.getByRole('button',{name:'Before / after fits'}));
    expect(screen.getByText('Before / Sen fit',{selector:'span'})).toBeTruthy();
    expect(screen.getByText('After / Sen fit',{selector:'span'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Documented product boundary, Feb 2000'}));
    expect(screen.getByRole('heading',{name:'Documented product boundary / Feb 2000'})).toBeTruthy();
    expect(screen.getByRole('link',{name:'Product documentation ↗'}).getAttribute('href')).toBe('https://example.org/product');
    fireEvent.click(screen.getByRole('button',{name:'Flagged observation, May 2000'}));
    expect(screen.getByText('This observation remains in the series and its statistics. A flag is not a determination that it is erroneous.')).toBeTruthy();
    expect(screen.getByRole('button',{name:'Flagged observation, May 2000'}).getAttribute('aria-pressed')).toBe('true');
  });
  it('does not plot a segment whose test is unavailable',()=>{
    const data={...payload,breaks:{...payload.breaks,segments:[{status:'insufficient_for_test',reason:'too_short',period:{start:'2000-01',end:'2000-05'},n_valid:4}]}};
    render(<AnalysisView variable={variable} state={{kind:'ready',warnings:[],result:data}} />);
    expect((screen.getByRole('button',{name:'Before / after fits'}) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Too few valid months for this segment’s trend test.')).toBeTruthy();
    expect(screen.queryByText('Before / Sen fit')).toBeNull();
  });
  it('retains the series when change detection is insufficient and does not infer features',()=>{
    render(<AnalysisView variable={variable} state={{kind:'ready',warnings:[],result:{...payload,breaks:{status:'insufficient_for_test',reason:'too_short'}}}} />);
    expect(screen.getByRole('group',{name:/Monthly time series/})).toBeTruthy();
    expect(screen.getByText('Change analysis unavailable for this series.')).toBeTruthy();
    expect(screen.getByRole('heading',{name:'No distinct abrupt change to investigate.'})).toBeTruthy();
    expect(screen.queryByRole('button',{name:'Check wider context ↗'})).toBeNull();
  });
  it('shows no numeric axes for an entirely unavailable display',()=>{
    const {container}=render(<TimeSeries points={points.map(p=>({...p,anomaly:null}))} mode="monthly_anomalies" unit="test" />);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText(/No values are available in this display/)).toBeTruthy();
  });
});

