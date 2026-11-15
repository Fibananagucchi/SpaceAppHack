// Real documented-event integration. No fixture responses or manual cache population.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const origin=process.argv[2];
if(!origin||!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))throw Error('Supply a local API origin.');
const directory=resolve('node_modules/.cache/redesign-live');await mkdir(directory,{recursive:true});
const save=(name,data)=>writeFile(resolve(directory,`${name}.json`),JSON.stringify(data,null,2));
async function api(path,body){const r=await fetch(`${origin}/api/v1${path}`,{method:body?'POST':'GET',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(90000)});return {http:r.status,...await r.json()};}
async function finish(name,data){const deadline=Date.now()+600000;while(['queued','running'].includes(data.status)){console.log(JSON.stringify({name,status:data.status,stage:data.stage,progress:data.progress}));if(Date.now()>deadline)throw Error('Verification timeout');await new Promise(r=>setTimeout(r,10000));data=await api(`/jobs/${data.job_id}`);}if(data.status==='complete'&&data.result)data=await api(`/${data.result.type==='analysis'?'analyses':'investigations'}/${data.result.id}`);await save(name,data);return data;}
const request={variable_id:'ndvi',location:{type:'point',lat:47.45,lon:34.2},period:{start:'2016-11',end:'2026-10'}};
const analysis=await finish('documented-analysis',await api('/analyses',request));
if(analysis.status!=='ok'||!analysis.breaks?.change_point?.change_id)throw Error('Analysis unavailable');
const result=await finish('documented-investigation',await api('/investigations',{analysis_id:analysis.analysis_id,change_id:analysis.breaks.change_point.change_id}));
console.log(JSON.stringify({status:result.status,category:result.conclusion?.category,events:result.conclusion?.known_events?.map(e=>e.event_id),processing:result.processing_version}));
if(result.status!=='complete'||!result.conclusion?.known_events?.length)throw Error('No real documented event returned for verification');
