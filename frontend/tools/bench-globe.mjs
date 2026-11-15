/** Real seven-variable interaction benchmark. No data fixtures or synthetic observations. */
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const stage=process.argv[2];if(!['before','after','renderer','after-annual'].includes(stage))throw Error('Use before or after');
const out=new URL('../_mockups/globe-018-refine/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-US'});
await context.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:8018/')?r.continue():r.abort());
const page=await context.newPage(),cdp=await context.newCDPSession(page),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{
  window.__globeBench={running:false,paints:[],intervals:[],idleDraws:0};
  const start=new WeakMap(),clear=CanvasRenderingContext2D.prototype.clearRect,restore=CanvasRenderingContext2D.prototype.restore;
  CanvasRenderingContext2D.prototype.clearRect=function(...args){if(this.canvas.classList.contains('globe-points')){window.__globeBench.idleDraws++;if(window.__globeBench.running)start.set(this,performance.now());}return clear.apply(this,args);};
  CanvasRenderingContext2D.prototype.restore=function(...args){const result=restore.apply(this,args);if(window.__globeBench.running&&start.has(this)){window.__globeBench.paints.push(performance.now()-start.get(this));start.delete(this);}return result;};
});
await page.goto('http://127.0.0.1:8018/');await page.locator('.globe-legend').waitFor({timeout:30000});
const variables=await page.evaluate(async()=>{const d=await fetch('/api/v1/variables').then(r=>r.json());return d.variables.filter(v=>v.capabilities.map_europe==='precomputed').map(v=>({id:v.variable_id,label:v.label}));});
const results=[];
for(const throttle of [1,4]){
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:throttle});
  for(const v of variables)for(const mode of (stage==='after-annual'?['annual']:['annual','trend'])){
    await page.getByTitle(v.label,{exact:true}).click();await page.getByRole('button',{name:mode==='annual'?'Annual anomaly':'Full-period trend',exact:true}).click();
    await page.waitForFunction(mode=>document.querySelector('.globe-legend')?.textContent.includes(mode==='annual'?'annual anomaly':'Sen trend'),mode,{timeout:60000});
    const canvas=page.locator('.globe-points');await canvas.focus();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const idleBefore=await page.evaluate(()=>window.__globeBench.idleDraws);await page.waitForTimeout(250);const idlePaints=await page.evaluate(n=>window.__globeBench.idleDraws-n,idleBefore);
    const sample=await canvas.evaluate(async(c)=>{
      const s=window.__globeBench;s.paints=[];s.intervals=[];s.running=true;let last=performance.now(),frames=0;
      const duration=1800,started=last;
      await new Promise(resolve=>{function step(now){s.intervals.push(now-last);last=now;frames++;c.dispatchEvent(new KeyboardEvent('keydown',{key:frames%24<12?'ArrowRight':'ArrowLeft',bubbles:true,cancelable:true}));if(now-started<duration)requestAnimationFrame(step);else resolve();}requestAnimationFrame(step);});
      s.running=false;
      const percentile=(a,p)=>a.length?[...a].sort((a,b)=>a-b)[Math.min(a.length-1,Math.floor(a.length*p))]:null,mean=a=>a.length?a.reduce((s,n)=>s+n,0)/a.length:null;
      return {elapsedMs:last-started,rafFps:frames*1000/(last-started),rafFrameMeanMs:mean(s.intervals),rafFrameP95Ms:percentile(s.intervals,.95),drawFps:s.paints.length*1000/(last-started),drawCount:s.paints.length,pointPaintMeanMs:mean(s.paints),pointPaintP95Ms:percentile(s.paints,.95)};
    });
    const renderer=await page.locator('.globe-geography').getAttribute('data-backend');const cells=await canvas.getAttribute('data-cell-count');const r={variable:v.id,mode,cpuThrottle:throttle,idlePaints,renderer,cells:cells?Number(cells):null,...sample};results.push(r);console.log(JSON.stringify(r));
    if(throttle===1&&v.id==='evapotranspiration'&&mode==='annual')await page.screenshot({path:new URL(`${stage}-evap.png`,out).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
  }
}
await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
const graphics=await page.locator('.globe-geography').evaluate(c=>{const gl=c.getContext('webgl');if(!gl)return 'Canvas software fallback';const info=gl.getExtension('WEBGL_debug_renderer_info');return info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);});
await writeFile(new URL(`${stage}-performance.json`,out),JSON.stringify({stage,browser:await browser.version(),graphics,viewport:{width:1440,height:1000},measurement:'1800ms rAF-driven keyboard rotation; same host; 1x and DevTools 4x CPU throttle; Canvas point paint time excludes GPU presentation and most base geography work',results,pageErrors:errors},null,2));
await browser.close();if(errors.length)throw Error(errors.join('\n'));console.log(`Saved ${results.length} benchmark cases.`);
