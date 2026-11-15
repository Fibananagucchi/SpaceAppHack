import {describe,it,expect} from 'vitest';
import {chooseDisplayYear,readWorkspaceLink,resolveCases,resolveWorkspaceLink} from '../src/casePresets';
import type {CaseRecipe} from '../src/casePresets';
import type {Variable} from '../src/contract';

// Selection protocol only, with no observations or display data.
const variable={variable_id:'t2m',coverage:{start:'1980-01',end:'2026-09'},capabilities:{area:'precomputed'}} as unknown as Variable;
const recipe:CaseRecipe={id:'event',label:'Source context',eventId:'documented',variable:'t2m',layer:'annual',year:2003,location:'event_area'};
const event={event_id:'documented',variables:['t2m'],area:{bbox:[0,42,8,52]}};
describe('Case selection and default year',()=>{
  it('uses source geometry and rejects a missing event',()=>{expect(resolveCases([recipe],[variable],[])).toEqual([]);expect(resolveCases([recipe],[variable],[event])[0].request.location).toEqual({type:'area',bbox:[0,42,8,52]});});
  it('lets explicit URL values override a case',()=>{const cases=resolveCases([recipe],[variable],[event]),r=resolveWorkspaceLink(readWorkspaceLink('?case=event&layer=changes&year=2020&lat=50.45&lon=30.52&start=2000-01'),cases,[variable]);expect(r.preset?.locationNote).toContain('URL');expect(r.preset?.request).toEqual(r.request);expect(r).toMatchObject({layer:'changes',year:2020,request:{location:{type:'point',lat:50.45,lon:30.52},period:{start:'2000-01',end:'2026-09'}}});});
  it('does not silently turn a bad URL into another analysis',()=>{expect(resolveWorkspaceLink({caseId:'unknown'},[],[variable]).error).toBeTruthy();expect(readWorkspaceLink('?bbox=,42,8,52').error).toBeTruthy();expect(readWorkspaceLink('?lat=50,45&lon=30.52').error).toBeTruthy();expect(readWorkspaceLink('?year=wrong').error).toBeTruthy();});
  it('keeps 2025 when its frame and candidates are available',()=>{expect(chooseDisplayYear(2025,[2020,2025],{start:'2000-01',end:'2026-07'},[2020,2025])).toEqual({year:2025});});
  it('labels a default-year fallback but preserves an explicit empty year',()=>{expect(chooseDisplayYear(2025,[2020,2024,2025],undefined,[2020,2024])).toMatchObject({year:2024,notice:expect.stringContaining('2025')});expect(chooseDisplayYear(2025,[2020,2025])).toEqual({year:2025});expect(chooseDisplayYear(2025,[2020],undefined,[])).toMatchObject({year:2020,notice:expect.stringContaining('No mapped change')});});
  it('does not choose a year outside the shared source periods',()=>{expect(chooseDisplayYear(2025,[2020,2025],{start:'2000-01',end:'2020-12'})).toMatchObject({year:2020,notice:expect.stringContaining('2025')});expect(chooseDisplayYear(2025,[2025],{start:'2000-01',end:'2020-12'}).year).toBeUndefined();});
});
