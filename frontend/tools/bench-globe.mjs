/** Real seven-variable interaction benchmark. No data fixtures or synthetic observations. */
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const stage=process.argv[2];if(!['before','after','renderer','after-annual','selection','world','raster'].includes(stage))throw Error('Use before or after');
const filter=process.argv[3];if(filter&&!/^[a-z0-9_]+(?:,[a-z0-9_]+)*$/.test(filter))throw Error('Invalid variable filter');const pixelRatio=Number(process.argv[4]??1);if(![1,2].includes(pixelRatio))throw Error('Use DPR 1 or 2');const outputTag=stage+(filter?'-'+filter.replaceAll(',','-'):'')+(pixelRatio!==1?'-dpr'+pixelRatio:'');
const out=new URL(stage==='raster'?'../_mockups/globe-018-raster/':stage==='world'?'../_mockups/globe-018-world/':stage==='selection'?'../_mockups/globe-018-selection/':'../_mockups/globe-018-refine/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-US',deviceScaleFactor:pixelRatio});
await context.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:8018/')?r.continue():r.abort());
const page=await context.newPage(),cdp=await context.newCDPSession(page),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
  window.__globeBench={running:false,paints:[],intervals:[],idleDraws:0};
  const gpuContexts=[];window.__globeBench.gpu={data:[],geography:[]};
  window.__globeBench.collectGpu=()=>{for(const entry of gpuContexts){const remaining=[];for(const q of entry.pending){if(entry.ext.getQueryObjectEXT(q,entry.ext.QUERY_RESULT_AVAILABLE_EXT)){if(!entry.gl.getParameter(entry.ext.GPU_DISJOINT_EXT))window.__globeBench.gpu[entry.kind].push(entry.ext.getQueryObjectEXT(q,entry.ext.QUERY_RESULT_EXT)/1e6);entry.ext.deleteQueryEXT(q);}else remaining.push(q);}entry.pending=remaining;}};
  window.__globeBench.resetGpu=()=>{for(const entry of gpuContexts){entry.pending.forEach(q=>entry.ext.deleteQueryEXT(q));entry.pending=[];}window.__globeBench.gpu={data:[],geography:[]};};
  const contexts=new WeakMap(),draw=WebGLRenderingContext.prototype.drawArrays;
  WebGLRenderingContext.prototype.drawArrays=function(...args){
    if(!window.__globeBench.running)return draw.apply(this,args);
    let entry=contexts.get(this);if(!entry){const ext=this.getExtension('EXT_disjoint_timer_query');entry={gl:this,ext,kind:this.canvas.classList.contains('globe-data')?'data':'geography',pending:[]};contexts.set(this,entry);if(ext)gpuContexts.push(entry);}
    if(!entry.ext)return draw.apply(this,args);
    const q=entry.ext.createQueryEXT();entry.ext.beginQueryEXT(entry.ext.TIME_ELAPSED_EXT,q);const result=draw.apply(this,args);entry.ext.endQueryEXT(entry.ext.TIME_ELAPSED_EXT);entry.pending.push(q);return result;
  };
  const start=new WeakMap(),clear=CanvasRenderingContext2D.prototype.clearRect,restore=CanvasRenderingContext2D.prototype.restore;
  CanvasRenderingContext2D.prototype.clearRect=function(...args){if(this.canvas.classList.contains('globe-points')){window.__globeBench.idleDraws++;if(window.__globeBench.running)start.set(this,performance.now());}return clear.apply(this,args);};
  CanvasRenderingContext2D.prototype.restore=function(...args){const result=restore.apply(this,args);if(window.__globeBench.running&&start.has(this)){window.__globeBench.paints.push(performance.now()-start.get(this));start.delete(this);}return result;};
});
await page.goto('http://127.0.0.1:8018/');await page.locator('.globe-legend').waitFor({timeout:30000});
const variables=await page.evaluate(async()=>{const d=await fetch('/api/v1/variables').then(r=>r.json());return d.variables.filter(v=>v.capabilities.map_europe==='precomputed').map(v=>({id:v.variable_id,label:v.label}));});
const activeVariables=variables.filter(v=>!filter||filter.split(',').includes(v.id));
const results=[];
for(const surfaceChoice of (stage==='raster'?['Smooth','Cells']:['current']))for(const zoom of (['world','raster'].includes(stage)?[1,2.5,8,'polar']:stage==='selection'?[1,8]:[1]))for(const throttle of (['raster','world','selection'].includes(stage)?[1]:[1,4])){
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:throttle});
  if(surfaceChoice!=='current'){await page.getByRole('button',{name:surfaceChoice,exact:true}).click();await page.waitForFunction(mode=>document.querySelector('.globe-points')?.dataset.surfaceMode===mode,surfaceChoice.toLowerCase());}
  await page.getByRole('button',{name:'World view',exact:true}).click();if(zoom!==1){await page.getByRole('button',{name:'Europe view',exact:true}).click();if(zoom!==2.5)for(let i=0;i<12;i++){const z=page.getByRole('button',{name:'Zoom in',exact:true});if(await z.isDisabled())break;await z.click();}}
  for(const v of activeVariables.filter(v=>zoom!=='polar'||v.id==='t2m'))for(const mode of (stage==='after-annual'?['annual']:['annual','trend'])){
    console.log(`Starting ${v.id} ${mode} ${zoom}`);
    await page.getByTitle(v.label,{exact:true}).click();await page.getByRole('button',{name:mode==='annual'?'Annual anomaly':'Full-period trend',exact:true}).click();
    try{await page.waitForFunction(mode=>document.querySelector('.globe-legend')?.textContent.includes(mode==='annual'?'annual anomaly':'Full-period trend'),mode,{timeout:60000});}catch(error){console.log(JSON.stringify({failedCase:{variable:v.id,mode,zoom},state:await page.evaluate(()=>({legend:document.querySelector('.globe-legend')?.textContent,coverage:document.querySelector('.globe-coverage')?.textContent,canvas:{...document.querySelector('.globe-points')?.dataset},selected:document.querySelector('.globe-variables [aria-pressed=true]')?.textContent})),pageErrors:errors}));await browser.close();throw error;}
    const canvas=page.locator('.globe-points');
    if(['raster','world'].includes(stage)){
      const ready=await page.evaluate(async({id,mode})=>{const index=await fetch('/api/v1/globe').then(r=>r.json());return index.layers.find(v=>v.variable_id===id).world[mode==='annual'?'frames':'trend'].status==='ok';},{id:v.id,mode});
      if(ready)await page.waitForFunction(()=>document.querySelector('.globe-points')?.dataset.domain==='world',null,{timeout:60000});
    }
    await canvas.focus();if(zoom==='polar'){await canvas.evaluate(c=>{for(let i=0;i<100;i++)c.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));});}

    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const idleBefore=await page.evaluate(()=>window.__globeBench.idleDraws);await page.waitForTimeout(250);const idlePaints=await page.evaluate(n=>window.__globeBench.idleDraws-n,idleBefore);
    const sample=await canvas.evaluate(async(c)=>{
      const s=window.__globeBench;s.paints=[];s.intervals=[];s.resetGpu();s.running=true;let last=performance.now(),frames=0;
      const duration=1800,started=last;
      await new Promise(resolve=>{function step(now){s.collectGpu();s.intervals.push(now-last);last=now;frames++;c.dispatchEvent(new KeyboardEvent('keydown',{key:frames%24<12?'ArrowRight':'ArrowLeft',bubbles:true,cancelable:true}));if(now-started<duration)requestAnimationFrame(step);else resolve();}requestAnimationFrame(step);});
      s.running=false;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));s.collectGpu();
      const percentile=(a,p)=>a.length?[...a].sort((a,b)=>a-b)[Math.min(a.length-1,Math.floor(a.length*p))]:null,mean=a=>a.length?a.reduce((s,n)=>s+n,0)/a.length:null;
      return {gpuDataSamples:s.gpu.data.length,gpuDataMeanMs:mean(s.gpu.data),gpuDataP95Ms:percentile(s.gpu.data,.95),gpuGeographyMeanMs:mean(s.gpu.geography),gpuGeographyP95Ms:percentile(s.gpu.geography,.95),elapsedMs:last-started,rafFps:frames*1000/(last-started),rafFrameMeanMs:mean(s.intervals),rafFrameP95Ms:percentile(s.intervals,.95),drawFps:s.paints.length*1000/(last-started),drawCount:s.paints.length,pointPaintMeanMs:mean(s.paints),pointPaintP95Ms:percentile(s.paints,.95)};
    });
    const renderer=await page.locator('.globe-geography').getAttribute('data-backend');const cells=await canvas.getAttribute('data-cell-count');const view=await canvas.evaluate(c=>({...c.dataset}));const r={variable:v.id,mode,zoom,surfaceMode:view.surfaceMode,displayBackend:view.displayBackend,textureUploads:Number(await page.locator('.globe-data').getAttribute('data-texture-uploads')??0),devicePixelRatio:pixelRatio,actualZoom:Number(view.zoom),centreLat:Number(view.centreLat),centreLon:Number(view.centreLon),domain:view.domain,dotBackend:view.dotBackend,drawnCells:Number(view.drawnCount),projectedCells:Number(view.projectedCount),lodStep:Number(view.lodStep),cpuThrottle:throttle,idlePaints,renderer,cells:cells?Number(cells):null,...sample};results.push(r);console.log(JSON.stringify(r));
    if(throttle===1&&v.id==='evapotranspiration'&&mode==='annual')await page.screenshot({path:new URL(`${stage}-evap.png`,out).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
  }
}
await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
const graphics=await page.locator('.globe-geography').evaluate(c=>{const gl=c.getContext('webgl');if(!gl)return 'Canvas software fallback';const info=gl.getExtension('WEBGL_debug_renderer_info');return info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);});
await writeFile(new URL(`${outputTag}-performance.json`,out),JSON.stringify({stage:outputTag,browser:await browser.version(),graphics,viewport:{width:1440,height:1000},devicePixelRatio:pixelRatio,measurement:'1800ms rAF-driven keyboard rotation; CPU throttle is recorded per case; overlay CPU paint includes data renderer submission and excludes GPU presentation and most base geography work',results,pageErrors:errors},null,2));
await browser.close();if(errors.length)throw Error(errors.join('\n'));console.log(`Saved ${results.length} benchmark cases.`);
