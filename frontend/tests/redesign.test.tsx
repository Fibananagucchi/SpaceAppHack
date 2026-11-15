/** Synthetic contract cases only; never imported by the product. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DocumentedEvents, Mode2Conclusion } from '../src/Mode2Conclusion';
import { AnalysisView } from '../src/AnalysisView';
import { variable } from './fixtures';

const event={event_id:'event_test',title:'Test documented event',type:'human',dates:{start:'2023-06-06',end:'2023-06-06',as_described:'Test documented date.'},match_window:{start:'2023-06',end:'2023-09'},sources:[{publisher:'Test source',title:'Documented context',url:'https://example.org/event'}],match:{variable:'ndvi',change_month:'2023-06',place:'test area',direction:'not stated by the source; not checked'}};
const base={category:'possible_data_artifact',statement:'Two documented explanations coincide.',evidence_for:[{text:'Test boundary',reference:{title:'Boundary documentation',url:'https://example.org/boundary'}}],rules_checked:[],known_events:[event]};

describe('Documented context without an invented cause',()=>{
  it('shows the actual event title, English date and source before opening match details',()=>{
    const {container}=render(<DocumentedEvents value={[event]}/>);
    expect(screen.getByRole('heading',{name:'Test documented event'})).toBeTruthy();
    expect(screen.getByText('Jun 6, 2023')).toBeTruthy();
    expect(screen.getByRole('link',{name:'Test source · Documented context ↗'}).getAttribute('href')).toBe('https://example.org/event');
    expect(container.querySelector('details')?.open).toBe(false);
    expect(screen.getByText('not stated by the source; not checked')).toBeTruthy();
  });
  it('does not invent a card for no events or an event without a safe source',()=>{
    const {container,rerender}=render(<DocumentedEvents value={[]}/>);expect(container.children).toHaveLength(0);
    rerender(<DocumentedEvents value={[{...event,sources:[{url:'javascript:alert(1)'}]}]}/>);expect(container.children).toHaveLength(0);
  });
  it('gives coinciding product and event explanations equal structural weight',()=>{
    const {container}=render(<Mode2Conclusion value={{...base,coinciding_explanations:[{category:'possible_data_artifact',evidence:base.evidence_for},{category:'consistent_with_human_influence',evidence:[{text:'Test documented event context',reference:event.sources[0]}]}]}}/>);
    expect(screen.getByRole('heading',{name:'Coinciding explanations',level:3})).toBeTruthy();
    expect(screen.queryByRole('heading',{name:'Possible data artifact',level:3})).toBeNull();
    const cards=container.querySelectorAll('.coinciding-grid > article');expect(cards).toHaveLength(2);
    expect(cards[0].querySelector('h4')?.textContent).toBe('Possible data artifact');
    expect(cards[1].querySelector('h4')?.textContent).toBe('Consistent with human influence');
    expect(cards[0].className).toBe(cards[1].className);
  });
  it('uses returned rules and count, without implying a catalogue-wide causal search',()=>{
    render(<Mode2Conclusion value={base} checks={{list_version:'known-events-test',events_in_list:0,match_rules:['Direction is not checked unless documented.']}}/>);
    expect(screen.getByText('Checked against 0 documented events · known-events-test')).toBeTruthy();
    expect(screen.getByText('Direction is not checked unless documented.')).toBeTruthy();
  });
  it('allows supported MODIS investigations instead of inferring unavailability from a slow source',()=>{
    render(<AnalysisView variable={{...variable,capabilities:{point:'job',area:'not_available',map_europe:'not_available'}}} state={{kind:'ready',warnings:[],result:{analysis_id:'a_modis_test',series:{points:[{t:'2020-01',v:0,anomaly:0},{t:'2020-02',v:1,anomaly:1}]},breaks:{status:'ok',change_point:{status:'detected',date:'2020-02',change_id:'c_test'}}}}}/>);
    expect(screen.getByRole('button',{name:'Check wider context ↗'})).toBeTruthy();
  });
});
