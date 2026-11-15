// Real-data browser regression for the redesign. No mocked responses or user-browser access.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
const origin=process.argv[2];
if(!origin||!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))throw Error('Supply a localhost origin.');
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'uk-UA',reducedMotion:'reduce'});
  await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  const page=await context.newPage(),errors=[];let posts=0;
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/analyses'))posts++;});
  await page.goto(origin,{waitUntil:'networkidle'});await page.locator('.europe-map canvas').waitFor();
  const controls=page.getByRole('button',{name:'Choose variable and place',exact:true}),dialog=page.getByRole('dialog',{name:'Choose your record'});
  await controls.click();assert(await dialog.isVisible());await page.keyboard.press('Escape');assert(!(await dialog.isVisible()));assert.equal(await controls.evaluate(el=>document.activeElement===el),true);
  console.log('PASS native dialog Escape and focus return');
  const map=page.locator('.europe-map canvas'),box=await map.boundingBox(),prior=posts;
  await map.click({position:{x:box.width*.65,y:box.height*.45}});await page.locator('.analysis-view').waitFor();assert(posts>prior);
  await map.focus();await map.press('ArrowRight');await map.press('Enter');await page.locator('.analysis-view').waitFor();
  console.log('PASS map click and keyboard Enter open real point records');
  await controls.click();await page.locator('.variable-option').filter({hasText:'Precipitation'}).click();await page.locator('#latitude').fill('44.85');await page.locator('#longitude').fill('36.15');await page.getByRole('button',{name:/Request analysis/}).click();await page.locator('.analysis-view').waitFor();
  const original=await page.locator('.analysis-title .eyebrow').innerText(),sent=posts;
  const start=page.getByRole('slider',{name:'Start of time aperture'});await start.focus();await start.press('Home');await start.press('ArrowRight');
  assert.equal(posts,sent);assert.equal(await page.locator('.analysis-title .eyebrow').innerText(),original);
  await page.getByRole('button',{name:'Apply period ↗'}).click();await page.waitForFunction(()=>document.querySelector('.analysis-title .eyebrow')?.textContent.includes('Feb 1998'));
  assert(posts>sent);assert((await page.locator('.map-period').innerText()).includes('Jan 1998'));
  console.log('PASS keyboard Time aperture: draft, real recompute, fixed map period');
  const marker=page.locator('.marker-chip.marker-change').first();assert(await marker.count());await marker.click();assert(await page.locator('#change-disclosure').evaluate(el=>el.open));assert.equal(await page.evaluate(()=>document.activeElement?.id),'changes');
  await page.locator('.fit-options > summary').click();await page.getByRole('button',{name:'Before / after fits',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Before / after fits',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'Monthly observations',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Monthly observations',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'Monthly anomalies',exact:true}).click();
  console.log('PASS Change seam focus link and raw/anomaly/segment-fit switches');
  await page.locator('.time-aperture').evaluate(el=>el.scrollIntoView({block:'center'}));await page.screenshot({path:resolve('../reports/014-after-aperture.png')});
  await page.locator('.counter-disclosure > summary').click();await page.getByRole('button',{name:'Find opposite signs',exact:true}).click();assert((await page.locator('.pair-message').innerText()).includes('pass the map FDR test'));
  await page.getByRole('button',{name:'Compare both point records ↗',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.paired-record .evidence-summary').length===2,{},{timeout:90000});
  await page.locator('.counter-controls').evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:resolve('../reports/014-after-counter-directions.png')});
  console.log('PASS real opposite-sign FDR pair and two native point records');
  await controls.click();await page.locator('.variable-option').filter({hasText:'Air temperature at 2 m'}).click();await page.getByRole('button',{name:'Area',exact:true}).click();
  for(const [id,value] of Object.entries({west:'32.001',south:'46.001',east:'32.002',north:'46.002'}))await page.locator(`#${id}`).fill(value);
  await page.getByRole('button',{name:/Request analysis/}).click();await page.getByRole('heading',{name:'This area contains no grid-cell centres.'}).waitFor();
  assert.equal(await page.locator('.status-notice').getAttribute('data-state'),'no_data');
  await controls.click();for(const [id,value] of Object.entries({west:'32.001',south:'46.001',east:'36.001',north:'48.001'}))await page.locator(`#${id}`).fill(value);
  await page.getByRole('button',{name:/Request analysis/}).click();await page.locator('.analysis-view').waitFor();await page.locator('.data-passport > summary').click();
  assert((await page.locator('.data-passport').innerText()).includes('32.001°'));assert((await page.locator('.data-passport').innerText()).includes('24 / 24'));
  console.log('PASS precise area, too-small no-data, actual cell bounds and passport');
  await page.getByRole('button',{name:'Open three-question guide',exact:true}).click();await page.getByRole('button',{name:'Next: choose a place →',exact:true}).click();await page.getByRole('button',{name:'Go to coordinates ↗',exact:true}).click();assert(await dialog.isVisible());
  await page.getByRole('button',{name:'Use the three-question guide ↗',exact:true}).click();await page.getByRole('button',{name:'Next: choose a period →',exact:true}).click();await page.getByRole('button',{name:'Analyse this selection ↗',exact:true}).click();await page.locator('.analysis-view').waitFor();
  console.log('PASS three-question guide through coordinate drawer to real result');
  for(const width of [320,390,800,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow at ${width}`);}
  assert.equal(await page.evaluate(()=>/[\u0400-\u04FF]/.test(document.body.innerText)),false);
  assert.equal(await page.locator('.skip-link').evaluate(el=>getComputedStyle(el).opacity),'0');
  await page.getByRole('link',{name:'Earth system trends home'}).focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('.skip-link').evaluate(el=>getComputedStyle(el).opacity),'1');
  assert.deepEqual(errors,[]);console.log('PASS 320/390/800/1440, English under uk-UA, skip-link focus, no page errors');
} catch(error) {
  for(const context of browser.contexts())for(const page of context.pages()){
    console.log('LAYOUT',JSON.stringify(await page.evaluate(()=>{const d=document.querySelector('dialog[open]'),b=document.querySelector('.request-button');return {viewport:[innerWidth,innerHeight],dialog:d?{box:d.getBoundingClientRect().toJSON(),scroll:d.scrollTop,client:d.clientHeight,height:d.scrollHeight,position:getComputedStyle(d).position,overflow:getComputedStyle(d).overflowY}:null,button:b?.getBoundingClientRect().toJSON()};})));
    await page.screenshot({path:resolve('../reports/014-dialog-check.png')});
  }throw error;
} finally {await browser.close();}
