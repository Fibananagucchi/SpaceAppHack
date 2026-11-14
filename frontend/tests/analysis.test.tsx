import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { pointsFrom, seriesSegments } from '../src/analysis';
import { coordinate, month, number, pValue } from '../src/format';
import { Evidence } from '../src/AnalysisView';
import { TimeSeries } from '../src/TimeSeries';
import { PointMap } from '../src/PointMap';
import { requestFromFields } from '../src/contract';

const points = [
  {t:'2000-01',v:0,anomaly:0}, {t:'2000-02',v:2,anomaly:1},
  {t:'2000-03',v:null,anomaly:null}, {t:'2000-04',v:3,anomaly:2},
  {t:'2000-06',v:4,anomaly:null},
];

describe('Observed series and English presentation',()=>{
  it('uses explicit English dates and decimal dots',()=>{
    expect(month('1980-01')).toBe('Jan 1980');
    expect(coordinate(50.45)).toBe('50.45');
    expect(number(1234.5,6)).toBe('1,234.5');
    expect(requestFromFields('t','50,45','30.52','2000-01','2020-01')).toHaveProperty('error','Use a dot for decimal coordinates, for example 50.45.');
    expect(pValue(0)).toBe('0 (numerical underflow)');
    expect(pValue(1e-12)).toBe('1.00e-12');
  });
  it('keeps real zeros and breaks traces at null and missing calendar months',()=>{
    expect(seriesSegments(points,'raw').map(s=>s.length)).toEqual([2,1,1]);
    expect(seriesSegments(points,'monthly_anomalies').map(s=>s.length)).toEqual([2,1]);
    expect(seriesSegments(points,'raw')[0][0].y).toBe(0);
    expect(pointsFrom([...points].reverse())).toBeUndefined();
    expect(pointsFrom([{t:'2000-01',v:'0',anomaly:null}])).toBeUndefined();
  });
  it('uses the server decision even when the displayed p-value rounds to alpha',()=>{
    const test = {status:'ok',p_value:0.050001,alpha:.05,significant:false};
    render(<Evidence data={{trend:{monthly_anomalies:{sen_slope:{status:'ok',estimate:0.2,unit:'test per decade'},mann_kendall:test,ols_t_test:test,agreement:'both_not_significant'}}}} mode="monthly_anomalies" />);
    expect(screen.getByText('Neither test detects a trend.')).toBeTruthy();
    expect(screen.getAllByText('Trend not detected')).toHaveLength(2);
    expect(screen.queryByText('Trend detected')).toBeNull();
  });
  it('keeps estimates visible when tests disagree or one method is unavailable',()=>{
    render(<Evidence data={{trend:{monthly_anomalies:{sen_slope:{status:'ok',estimate:-.2,unit:'test per decade'},mann_kendall:{status:'ok',p_value:.01,alpha:.05,significant:true},ols_t_test:{status:'insufficient_for_test',reason:'too_few_effective_samples'},agreement:'not_available'}}}} mode="monthly_anomalies" />);
    expect(screen.getByRole('heading',{name:'Decreasing'})).toBeTruthy();
    expect(screen.getByText('Test unavailable')).toBeTruthy();
    expect(screen.getByText('Evidence is incomplete.')).toBeTruthy();
  });
  it('allows keyboard inspection of missing observations without replacing them',()=>{
    render(<TimeSeries points={points} mode="raw" unit="test" />);
    const chart = screen.getByRole('group',{name:/Monthly time series/});
    fireEvent.keyDown(chart,{key:'Home'});
    expect(screen.getByText('0 test')).toBeTruthy();
    fireEvent.keyDown(chart,{key:'ArrowRight'});
    fireEvent.keyDown(chart,{key:'ArrowRight'});
    expect(screen.getByText('No value available')).toBeTruthy();
    expect(screen.getByText('Missing observation')).toBeTruthy();
  });
  it('provides a keyboard alternative to clicking the world point selector',()=>{
    const pick=vi.fn();
    render(<PointMap lat={50.45} lon={30.52} onPick={pick} />);
    fireEvent.keyDown(screen.getByRole('group',{name:'World point selector'}),{key:'ArrowRight',shiftKey:true});
    expect(pick).toHaveBeenCalledWith(50.45,40.52);
    expect(screen.getByText('50.45° latitude / 30.52° longitude')).toBeTruthy();
  });
});
