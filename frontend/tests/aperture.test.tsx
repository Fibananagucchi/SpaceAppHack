/** Synthetic observations are confined to this test. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimeAperture } from '../src/TimeAperture';
import { AnalysisView } from '../src/AnalysisView';
import { variable, request } from './fixtures';
import { monthIndex } from '../src/format';

const points=Array.from({length:24},(_,i)=>({t:`${2000+Math.floor(i/12)}-${(i%12+1).toString().padStart(2,'0')}`,v:i===5?null:i,anomaly:i===5?null:i-10}));
describe('Time aperture',()=>{
  it('keeps a draft separate from requested statistics until Apply',()=>{
    const apply=vi.fn();render(<TimeAperture points={points} period={{start:'2000-01',end:'2001-12'}} onApply={apply} onFull={()=>{}} />);
    fireEvent.change(screen.getByRole('slider',{name:'Start of time aperture'}),{target:{value:monthIndex('2000-07')}});
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByText('Preview only. Apply to request fresh statistics.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Apply period ↗'}));
    expect(apply).toHaveBeenCalledWith({start:'2000-07',end:'2001-12'});
  });
  it('rejects reversed months and offers the actual full-record request',()=>{
    const apply=vi.fn(),full=vi.fn();render(<TimeAperture points={points} period={{start:'2000-01',end:'2001-12'}} onApply={apply} onFull={full} />);
    fireEvent.change(screen.getByLabelText('Aperture from'),{target:{value:'2002-01'}});
    fireEvent.click(screen.getByRole('button',{name:'Apply period ↗'}));
    expect(apply).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Load full product record'}));expect(full).toHaveBeenCalledOnce();
  });
  it('presents direction and evidence before the chart and data notes',()=>{
    const {container}=render(<AnalysisView state={{kind:'ready',request,warnings:[{code:'product_boundary_in_period',date:'2000-06'}],result:{series:{points,unit:'test'},trend:{monthly_anomalies:{}},breaks:{status:'not_implemented'}}}} variable={variable} />);
    const evidence=screen.getByLabelText('Trend evidence'),chart=container.querySelector('.time-series')!;
    expect(evidence.compareDocumentPosition(chart)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('.data-notes')?.getAttribute('open')).toBeNull();
    expect(container.querySelector('.test-details')?.getAttribute('open')).toBeNull();
  });
});
