/** Actual GLDAS ET record and matching real frames, identical inputs in every palette. */
import {chromium} from 'playwright';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../_mockups/palette/',import.meta.url),variants=JSON.parse(await readFile(new URL('variants.json',root),'utf8'));
const browser=await chromium.launch({channel:'msedge',headless:true}),results=[];
for(const [i,v] of variants.entries()){
  const origin=`http://127.0.0.1:${8021+i}`,context=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-US'}),page=await context.newPage(),errors=[];
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());page.on('pageerror',e=>errors.push(e.message));
  const shot=async(name,locator)=>{const path=new URL(`${v.id}-${name}.png`,root).pathname.replace(/^\/(\w:)/,'$1');if(locator)await locator.screenshot({path});else await page.screenshot({path,fullPage:true});};
  await page.goto(origin);await page.waitForFunction(()=>document.querySelector('.globe-points')?.dataset.cellCount==='2660');
  await page.getByRole('button',{name:'Place & period ↗'}).click();await page.getByLabel('Latitude',{exact:true}).fill('50.45');await page.getByLabel('Longitude',{exact:true}).fill('30.52');
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/v1/analyses'));
  await page.getByRole('button',{name:'Request analysis ↗',exact:true}).click();const record=await(await response).json();await page.locator('.card-numbers').waitFor({timeout:60000});await page.locator('.annual-neighbour').first().waitFor();
  await page.getByRole('button',{name:/^2015:/}).click();await page.waitForTimeout(200);
  await shot('globe');await shot('card',page.locator('.globe-conclusion'));await shot('timeline',page.locator('.globe-time-strip'));
  const cdp=await context.newCDPSession(page);for(const type of ['deuteranopia','protanopia','tritanopia']){await cdp.send('Emulation.setEmulatedVisionDeficiency',{type});await shot(type);}await cdp.send('Emulation.setEmulatedVisionDeficiency',{type:'none'});
  await page.getByRole('button',{name:'Evidence ↗',exact:true}).click();await page.getByRole('dialog',{name:'Evidence',exact:true}).waitFor();await shot('evidence');
  await page.locator('.data-passport > summary').click();await page.locator('.data-passport').scrollIntoViewIfNeeded();await shot('passport');await page.keyboard.press('Escape');await page.getByRole('button',{name:'Check wider context ↗',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.card-mode')?.textContent.includes('Mode 2'),null,{timeout:120000});await shot('context');await shot('context-card',page.locator('.globe-conclusion'));await page.getByRole('button',{name:'Evidence ↗',exact:true}).click();
  const contrast=await page.evaluate(()=>{const s=getComputedStyle(document.querySelector('.globe-conclusion')),d=getComputedStyle(document.querySelector('.drawer'));return{main:{ink:s.getPropertyValue('--ink'),muted:s.getPropertyValue('--muted'),background:s.backgroundColor},drawer:{ink:d.getPropertyValue('--ink'),muted:d.getPropertyValue('--muted'),background:d.backgroundColor}};});
  results.push({observationsHash:createHash('sha256').update(JSON.stringify({series:record.series,trend:record.trend})).digest('hex'),id:v.id,name:v.name,analysisId:record.analysis_id,location:record.request?.location,period:record.analysis_period,variable:record.variable_id,year:2015,contrast,pageErrors:errors});
  if(errors.length)throw Error(errors.join('\n'));await context.close();console.log(v.id+' captured from live API');
}
await browser.close();if(new Set(results.map(r=>r.observationsHash)).size!==1)throw Error('Preview observations differ');await writeFile(new URL('capture-checks.json',root),JSON.stringify({results},null,2));
