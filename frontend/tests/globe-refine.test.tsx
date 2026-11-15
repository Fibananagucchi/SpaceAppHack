/** Synthetic protocol cases only; no test observations are imported by the UI. */
import {describe,it,expect} from 'vitest';
import {render,screen} from '@testing-library/react';
import {headlineSigned,number} from '../src/format';
import {coastlineRings,COASTLINES} from '../src/globeCoastline';
import {anomalyColour} from '../src/globeGeometry';
import {Evidence} from '../src/AnalysisView';

describe('Readable values without changing scientific precision',()=>{
  it('rounds headline examples but keeps small nonzero values nonzero',()=>{expect(headlineSigned(5.32216)).toBe('+5.3');expect(headlineSigned(.7275)).toBe('+0.73');expect(headlineSigned(-.00000004713)).toBe('-0.000000047');expect(headlineSigned(-0)).toBe('0');expect(number(5.32216)).toBe('5.322');});
  it('retains the full API slope and its original boolean evidence decision',()=>{const value=5.322160123456789;render(<Evidence mode="monthly_anomalies" data={{trend:{monthly_anomalies:{agreement:'both_significant',sen_slope:{status:'ok',estimate:value,unit:'test unit'},mann_kendall:{status:'ok',significant:true,p_value:.04999,alpha:.05},ols_t_test:{status:'ok',significant:true,p_value:.04999,alpha:.05}}}}}/>);expect(screen.getByText(String(value))).toBeTruthy();expect(screen.getByRole('heading',{name:'Both tests detect a trend.'})).toBeTruthy();});
});
describe('Actual geography and a neutral-centred display ramp',()=>{
  it('decodes Natural Earth coordinates without using a synthetic coastline',()=>{const rings=coastlineRings('<svg><path d="M180,90L181,91Z"/></svg>');expect(rings[0]).toEqual([{lat:0,lon:0},{lat:-1,lon:1},{lat:0,lon:0}]);expect(COASTLINES.length).toBeGreaterThan(50);});
  it('maps zero to the same neutral centre and retains distinct negative and positive ends',()=>{expect(anomalyColour(0,1)).toBe('rgb(199,207,203)');expect(anomalyColour(-1,1)).not.toBe(anomalyColour(1,1));expect(anomalyColour(-2,1)).toBe(anomalyColour(-1,1));});
});
