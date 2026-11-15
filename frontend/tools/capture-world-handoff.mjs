/** Final published NO2 plus an isolated transport-failure check; real observations only. */
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../_mockups/globe-018-world/',import.meta.url),origin='http://127.0.0.1:8018';await mkdir(root,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());await page.goto(origin);
await page.getByRole('button',{name:'NO₂',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.globe-points')?.dataset.domain==='world');
const metadata=await page.evaluate(async()=>{const index=await fetch('/api/v1/globe').then(r=>r.json()),resources=[];for(const v of index.layers){const row={variable:v.variable_id};for(const [kind,suffix] of [['frames',''],['trend','/trend']]){const d=await fetch('/api/v1/globe/world/'+v.variable_id+suffix).then(r=>r.json());row[kind]={status:d.status,domain:d.domain,computed_at:d.computed_at,grid:d.grid?.shape,aggregation:d.grid?.aggregation,period:d.period??d.baseline?.period,cell_counts:d.cell_counts,legend:d.legend};}resources.push(row);}return{index,resources};});
assert.equal(metadata.resources.find(v=>v.variable==='no2_tropo').frames.aggregation.native_cells_per_box.max,4);
const shot=async(name)=>page.screenshot({path:new URL(name+'.png',root).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
await shot('10-final-no2-annual');await page.getByRole('button',{name:'Full-period trend',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.globe-legend')?.textContent.includes('Sen trend'));await shot('11-final-no2-trend');
await page.getByRole('button',{name:'Evidence & analysis period ↗',exact:true}).click();await page.locator('.globe-data-note > summary').click();await page.locator('.globe-data-note').scrollIntoViewIfNeeded();await shot('12-final-no2-source');
const fallback=await browser.newPage({viewport:{width:1440,height:1000}});await fallback.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.request().url().includes('/api/v1/globe/world/')?r.abort():r.continue():r.abort());await fallback.goto(origin);
await fallback.waitForFunction(()=>document.querySelector('.globe-points')?.dataset.domain==='europe');await fallback.getByText('World layer unavailable · showing Europe only.',{exact:true}).waitFor();assert.equal(await fallback.locator('.globe-points').getAttribute('data-cell-count'),'2660');
await fallback.screenshot({path:new URL('13-europe-only-transport-failure.png',root).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
await browser.close();assert.deepEqual(errors,[]);await writeFile(new URL('publication-snapshot.json',root),JSON.stringify({...metadata,pageErrors:errors,europeFallback:'World transport deliberately aborted only in an isolated QA page; Europe values are actual API data, no mocked observations.'},null,2));console.log('Final 4-cell NO2 and explicit real Europe fallback verified.');
