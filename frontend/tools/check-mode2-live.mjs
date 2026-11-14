// Explicit opt-in checks against a running local API, using real source responses only.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const origin=process.argv[2];
if(!origin||!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))throw Error('Supply a local API origin.');
const directory=fileURLToPath(new URL('../../data/runtime/codex-mode2-qa/',import.meta.url));
await mkdir(directory,{recursive:true});
const save=async(name,data)=>writeFile(`${directory}${name}.json`,JSON.stringify(data,null,2));
async function api(path,body){const r=await fetch(`${origin}/api/v1${path}`,{method:body?'POST':'GET',headers:{'Accept':'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(90000)});return {http:r.status,...await r.json()};}
async function finish(name,data){
  const deadline=Date.now()+10*60*1000;let previous='';
  while(['queued','running'].includes(data.status)){
    const state=JSON.stringify([data.status,data.stage,data.progress]);if(previous!==state){console.log(name,state);previous=state;}
    if(Date.now()>deadline)throw Error(`${name}: local verification timeout`);
    await new Promise(resolve=>setTimeout(resolve,Math.min(30,Math.max(1,data.next_poll_s??10))*1000));
    data=await api(`/jobs/${encodeURIComponent(data.job_id)}`);
  }
  if(data.status==='complete'&&data.result){const resource=data.result.type==='analysis'?'analyses':data.result.type==='investigation'?'investigations':null;if(!resource)throw Error('Unknown result type');data=await api(`/${resource}/${encodeURIComponent(data.result.id)}`);}
  await save(name,data);return data;
}
const variables=await api('/variables');await save('catalogue',variables);
await Promise.allSettled([
  ['precip-pair-a','precip',64.25,-18.75],['soil-europe','soil_moisture',46.75,32.75],['t2m-europe','t2m',50.45,30.52],['precip-artifact','precip',44.85,36.15],['et-europe','evapotranspiration',40.42,-3.70],
].map(async([name,variable_id,lat,lon])=>{
  const v=variables.variables.find(v=>v.variable_id===variable_id);
  const data=await finish(`${name}-analysis`,await api('/analyses',{variable_id,location:{type:'point',lat,lon},period:{start:v.coverage.start,end:v.coverage.end}}));
  const cp=data.breaks?.change_point;console.log(name,JSON.stringify({status:data.status,change:cp?.status,date:cp?.date,analysis_id:data.analysis_id}));
  if(cp&&['detected','inconclusive'].includes(cp.status)){
    const result=await finish(`${name}-investigation`,await api('/investigations',{analysis_id:data.analysis_id,change_id:cp.change_id}));
    console.log(name,JSON.stringify({status:result.status,category:result.conclusion?.category,features:Object.fromEntries(Object.entries(result.features??{}).map(([k,v])=>[k,{status:v.status,value:v.value}])),eonet:result.eonet?.status,events:result.eonet?.events?.length}));
  }
})).then(results=>{for(const r of results)if(r.status==='rejected'){console.log('Point check failed:',r.reason?.message??'unknown');process.exitCode=1;}});
const variable_id='ndvi',v=variables.variables.find(v=>v.variable_id===variable_id);
if(v&&!process.argv.includes('--skip-modis')){
  const request={variable_id,location:{type:'point',lat:46.75,lon:32.75},period:{start:v.coverage.start,end:v.coverage.end}};
  const first=await api('/analyses',request);await save('modis-initial',first);
  const result=await finish('modis-result',first);console.log('modis',JSON.stringify({status:result.status,series:result.series?.status,valid:result.series?.coverage?.valid,source:result.provenance?.source_service}));
  if(result.series?.status==='ok'){const cached=await api('/analyses',request);await save('modis-cached',cached);console.log('modis-cache',JSON.stringify({http:cached.http,status:cached.status,from_cache:cached.provenance?.from_cache}));}else process.exitCode=1;
}
