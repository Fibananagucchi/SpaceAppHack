/** Opt-in component/API integration. Reads real responses in ignored runtime storage. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalysisView } from '../src/AnalysisView';
import { InvestigationPanel } from '../src/InvestigationPanel';
import { Mode2Conclusion } from '../src/Mode2Conclusion';
import { analysisState, parseVariables } from '../src/contract';
import type { AnalysisRequest } from '../src/contract';

const origin=process.env.MODE2_LIVE_ORIGIN;
const load=async(name:string)=>JSON.parse(await readFile(resolve(process.cwd(),'../data/runtime/codex-mode2-qa',`${name}.json`),'utf8'));
afterEach(()=>vi.unstubAllGlobals());

describe.runIf(Boolean(origin&&/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)))('Real source response integration',()=>{
  it.each(['soil-europe','t2m-europe','precip-artifact'])('follows a real context request and renders its evidence: %s',async(name)=>{
    const actualFetch=globalThis.fetch;
    vi.stubGlobal('fetch',(path:string,options:RequestInit)=>actualFetch(`${origin}${path}`,options));
    const analysis=await load(`${name}-analysis`);
    render(<InvestigationPanel data={analysis}/>);
    fireEvent.click(screen.getByRole('button',{name:'Check wider context ↗'}));
    await waitFor(()=>expect(screen.getByRole('heading',{level:3,name:/Cause undetermined|Possible data artifact/})).toBeTruthy(),{timeout:90000});
    expect(screen.getByRole('region',{name:'Measured change features'})).toBeTruthy();
    expect(screen.getByRole('region',{name:'EONET observation'})).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('How was this classified?')).toBeTruthy();
    expect(screen.getByText(/Checked against [0-9]+ documented events/)).toBeTruthy();
  },100000);
  it('keeps the trend first and renders a real cached MODIS series and passport',async()=>{
    const data=await load('modis-cached'),variables=parseVariables(await load('catalogue')),variable=variables.find(v=>v.variable_id==='ndvi')!;
    const state=analysisState({httpStatus:200,data},data.request as AnalysisRequest);
    expect(state.kind).toBe('ready');expect(data.provenance.from_cache).toBe(true);
    const {container}=render(<AnalysisView state={state} variable={variable}/>);
    expect(container.querySelector('.analysis-view')?.children[1].getAttribute('aria-label')).toBe('Trend evidence');
    expect(screen.getByRole('group',{name:/Monthly time series/})).toBeTruthy();
    expect(screen.getByText('NASA LP DAAC cloud OPeNDAP (MODIS)')).toBeTruthy();
    expect(container.querySelector('svg path.observation-line')).not.toBeNull();
  });
  it('renders a real artifact with a visible product documentation link',async()=>{
    const data=await load('precip-artifact-investigation');
    const {container}=render(<Mode2Conclusion value={data.conclusion}/>);
    expect(screen.getByRole('heading',{name:'Possible data artifact'})).toBeTruthy();
    expect(container.querySelector('.mode2-conclusion > .context-references a')?.getAttribute('href')).toMatch(/^https:\/\//);
  });
});
