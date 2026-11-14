import type { ObjectValue } from './contract';
import { record } from './analysis';
import { month } from './format';
import { ChangeFeatures, EonetObservation, Mode2Conclusion } from './Mode2Conclusion';
import { StatusNotice } from './StatusNotice';
import { useInvestigation } from './useInvestigation';

export function InvestigationPanel({data,onRunAgain,available=true}:{data:ObjectValue;onRunAgain?:()=>void;available?:boolean}) {
  const cp=record(record(data.breaks).change_point),analysisId=typeof data.analysis_id==='string'?data.analysis_id:'',changeId=typeof cp.change_id==='string'?cp.change_id:'';
  const investigation=useInvestigation(analysisId,changeId),state=investigation.state;
  const eligible=analysisId&&changeId&&['detected','inconclusive'].includes(String(cp.status));
  const busy=['loading','connecting','queued','running'].includes(state.kind);
  if(!available)return <section id="mode2-context" className="context-request" aria-label="Wider change context"><p className="eyebrow">Mode 2 / wider context</p><h3>Wider-context checks are unavailable for this product.</h3><p>The returned monthly record, trend and change inspection remain available. No cause category has been assigned.</p></section>;
  if(!eligible)return <section id="mode2-context" className="context-request" aria-label="Wider change context"><p className="eyebrow">Mode 2 / wider context</p><h3>No distinct abrupt change to investigate.</h3><details><summary>Why is there no cause category?</summary><p>{record(data.breaks).status==='insufficient_for_test'?'There are too few suitable observations for the change test.':'This test did not distinguish an abrupt change to investigate.'} That does not establish that no event occurred. No cause category has been assigned.</p></details></section>;
  return <section id="mode2-context" className="context-request" aria-label="Wider change context">
    {state.kind==='ready'&&state.result?<><Mode2Conclusion value={state.result.conclusion}/><ChangeFeatures value={state.result.features}/><EonetObservation value={state.result.eonet}/><details><summary>Investigation record</summary><p>Investigation: {String(state.result.investigation_id)} · Processing: {String(state.result.processing_version??'Not available')}</p></details></>:<><p className="eyebrow">Mode 2 / wider context</p><h3>What else changed around {month(cp.date)}?</h3>{state.kind==='idle'?<p>Check neighbouring cells, other variables and documented product changes.</p>:state.reason==='no_abrupt_change'?<p>No distinct abrupt change is available for this investigation. No cause has been assigned.</p>:<StatusNotice purpose="investigation" state={state} onRetry={investigation.run}/>}</>}
    {state.kind==='not_found'?<>{onRunAgain&&<button className="button" onClick={onRunAgain}>Run analysis again ↗</button>}</>:<button className="button" disabled={busy||state.reason==='no_abrupt_change'} onClick={investigation.run}>{busy?'Checking wider context…':state.kind==='ready'?'Refresh context ↗':'Check wider context ↗'}</button>}
  </section>;
}
