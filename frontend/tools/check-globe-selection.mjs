/** Regression: real between-dot clicks must reach native analysis without snapping. */
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const out=new URL(process.argv.includes('--raster')?'../_mockups/globe-018-raster/selection/':process.argv.includes('--world')?'../_mockups/globe-018-world/selection/':'../_mockups/globe-018-selection/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:8018/')?r.continue():r.abort());
await page.addInitScript(()=>{const text=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(label,x,y,...rest){if(label==='P'&&this.canvas.classList.contains('globe-points'))window.__marker={x,y:y-.5};return text.call(this,label,x,y,...rest);};});
await page.goto('http://127.0.0.1:8018/');const domain=await page.evaluate(async()=>{const index=await fetch('/api/v1/globe').then(r=>r.json());return index.layers?.find(v=>v.variable_id==='evapotranspiration')?.world?.trend?.status==='ok'?'world':'europe';});await page.waitForFunction(domain=>document.querySelector('.globe-points')?.dataset.domain===domain,domain);
for(const [mode,target] of [['Annual anomaly',{lat:50.2173,lon:21.0837}],['Full-period trend',{lat:50.8371,lon:21.8327}]]){
  await page.getByRole('button',{name:mode,exact:true}).click();await page.waitForFunction(t=>document.querySelector('.globe-legend')?.textContent.includes(t),mode==='Annual anomaly'?'annual anomaly':'Full-period trend');
  const canvas=page.locator('.globe-points');
  const pixel=await canvas.evaluate(async(c,target)=>{const {project}=await import('/src/globeGeometry.ts');const d=c.dataset,p=project(target,{lat:+d.centreLat,lon:+d.centreLon,radius:+d.radius,x:+d.centreX,y:+d.centreY}),r=c.getBoundingClientRect();return {x:r.x+p.x,y:r.y+p.y};},target);
  await canvas.evaluate(c=>c.addEventListener('pointerup',e=>{window.__click={x:e.clientX-c.getBoundingClientRect().x,y:e.clientY-c.getBoundingClientRect().y};},{once:true}));
  const request=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/api/v1/analyses'));
  await page.mouse.click(pixel.x,pixel.y);const sent=(await request).postDataJSON();
  const expected=await canvas.evaluate(async c=>{const {unproject}=await import('/src/globeGeometry.ts'),d=c.dataset;return unproject(window.__click.x,window.__click.y,{lat:+d.centreLat,lon:+d.centreLon,radius:+d.radius,x:+d.centreX,y:+d.centreY});});
  assert.ok(Math.abs(sent.location.lat-expected.lat)<1e-10);assert.ok(Math.abs(sent.location.lon-expected.lon)<1e-10);
  assert.ok(Math.abs(sent.location.lat-(Math.floor(sent.location.lat)+.5))>.05,'Latitude snapped to 1° centre');
  await page.locator('.card-numbers').waitFor({timeout:60000});await page.waitForTimeout(200);
  const selected=await canvas.evaluate(c=>({lat:+c.dataset.selectedLat,lon:+c.dataset.selectedLon,marker:window.__marker,click:window.__click}));
  assert.equal(selected.lat,sent.location.lat);assert.equal(selected.lon,sent.location.lon);assert.ok(Math.hypot(selected.marker.x-selected.click.x,selected.marker.y-selected.click.y)<.05,'P marker moved away from click');
  if(await page.locator('.card-record-details').count())await page.locator('.card-record-details').evaluate(d=>d.open=true);await page.locator('.card-grid summary').click();const centre=await page.locator('.card-grid p').innerText();assert.ok(!centre.includes('Unavailable'));
  checks.push({mode,requested:sent.location,resolvedGridCentre:centre,markerErrorPixels:Math.hypot(selected.marker.x-selected.click.x,selected.marker.y-selected.click.y)});
  await page.screenshot({path:new URL(mode==='Annual anomaly'?'annual-exact-click.png':'trend-exact-click.png',out).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
}
// Manual A/B preserves two distinct clicks even inside the same display cell.
await page.getByRole('button',{name:'Evidence ↗',exact:true}).click();await page.locator('.globe-counter > summary').click();await page.getByRole('button',{name:'Pick A on globe',exact:true}).click();
const manual=[];
for(const [label,target] of [['A',{lat:50.2173,lon:21.0837}],['B',{lat:50.8371,lon:21.8327}]]){
  if(label==='B')await page.keyboard.press('Escape');
  const canvas=page.locator('.globe-points');const pixel=await canvas.evaluate(async(c,target)=>{const {project}=await import('/src/globeGeometry.ts'),d=c.dataset,r=c.getBoundingClientRect(),p=project(target,{lat:+d.centreLat,lon:+d.centreLon,radius:+d.radius,x:+d.centreX,y:+d.centreY});return{x:r.x+p.x,y:r.y+p.y};},target);
  await canvas.evaluate(c=>c.addEventListener('pointerup',e=>{window.__click={x:e.clientX-c.getBoundingClientRect().x,y:e.clientY-c.getBoundingClientRect().y};},{once:true}));await page.mouse.click(pixel.x,pixel.y);
  const expected=await canvas.evaluate(async c=>{const {unproject}=await import('/src/globeGeometry.ts'),d=c.dataset;return unproject(window.__click.x,window.__click.y,{lat:+d.centreLat,lon:+d.centreLon,radius:+d.radius,x:+d.centreX,y:+d.centreY});});manual.push({label,expected});await page.getByRole('dialog',{name:'Evidence',exact:true}).waitFor();
}
for(const {label,expected} of manual){
  if(!await page.getByRole('dialog',{name:'Evidence',exact:true}).isVisible())await page.getByRole('button',{name:'Evidence ↗',exact:true}).click();
  const request=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/api/v1/analyses'));await page.getByRole('button',{name:`Open native point ${label} ↗`,exact:true}).click();const sent=(await request).postDataJSON();assert.ok(Math.abs(sent.location.lat-expected.lat)<1e-10);assert.ok(Math.abs(sent.location.lon-expected.lon)<1e-10);await page.locator('.card-numbers').waitFor({timeout:60000});checks.push({mode:'Manual '+label,requested:sent.location});
}
await browser.close();assert.deepEqual(errors,[]);await writeFile(new URL('selection-checks.json',out),JSON.stringify({checks,pageErrors:errors},null,2));console.log(JSON.stringify(checks));
