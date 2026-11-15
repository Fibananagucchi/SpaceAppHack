// Isolated headless checks of the local project only. Uses real API responses, never fixtures.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const origin=process.argv[2],phase=process.argv[3]??'after';
if(!origin||!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)||!['before','after'].includes(phase))throw Error('Supply a localhost origin and before/after.');
const output=resolve('../reports');await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-US',reducedMotion:'reduce'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin,{waitUntil:'networkidle'});
  if(await page.getByRole('button',{name:'Close guide',exact:true}).isVisible())await page.getByRole('button',{name:'Close guide',exact:true}).click();
  await page.locator('.europe-map canvas').waitFor();
  await page.screenshot({path:resolve(output,`014-${phase}-map.png`)});
  if(phase==='after')await page.getByRole('button',{name:'Choose variable and place',exact:true}).click();
  await page.locator('.variable-option').filter({hasText:'Precipitation'}).click();
  await page.locator('#latitude').fill('44.85');await page.locator('#longitude').fill('36.15');
  if(phase==='after')await page.screenshot({path:resolve(output,'014-after-controls.png')});
  await page.getByRole('button',{name:'Request analysis',exact:false}).click();
  await page.locator('.analysis-view').waitFor();
  await page.locator('#series').evaluate(el=>el.scrollIntoView({block:'start'}));
  await page.screenshot({path:resolve(output,`014-${phase}-analysis.png`)});
  await page.getByRole('button',{name:'Check wider context ↗',exact:true}).click();
  await page.locator('.mode2-conclusion').waitFor({timeout:120000});
  await page.locator('.mode2-conclusion').evaluate(el=>el.scrollIntoView({block:'start'}));
  await page.screenshot({path:resolve(output,`014-${phase}-context.png`)});
  await page.setViewportSize({width:390,height:844});
  await page.locator('#series').evaluate(el=>el.scrollIntoView({block:'start'}));
  await page.screenshot({path:resolve(output,`014-${phase}-mobile.png`)});
  if(phase==='after'){
    await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('button',{name:'Choose variable and place',exact:true}).click();
    await page.locator('.variable-option').filter({hasText:'Vegetation greenness'}).click();
    await page.locator('#latitude').fill('47.45');await page.locator('#longitude').fill('34.20');
    await page.locator('#start-month').fill('2016-11');await page.locator('#end-month').fill('2026-10');
    await page.getByRole('button',{name:'Request analysis',exact:false}).click();
    await page.locator('.analysis-view').waitFor();
    await page.getByRole('button',{name:'Check wider context ↗',exact:true}).click();
    await page.locator('.documented-event').waitFor({timeout:120000});
    await page.locator('.mode2-conclusion').evaluate(el=>el.scrollIntoView({block:'start'}));
    await page.screenshot({path:resolve(output,'014-after-documented-event.png')});
  }
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  if(overflow||errors.length)throw Error(JSON.stringify({overflow,errors}));
  console.log(JSON.stringify({phase,viewport:page.viewportSize().width,overflow,errors,screenshots:phase==='after'?6:4}));
} catch(error) {
  for(const context of browser.contexts())for(const page of context.pages()){
    console.log('LAYOUT',JSON.stringify(await page.evaluate(()=>{const d=document.querySelector('dialog[open]'),b=document.querySelector('.request-button');return {viewport:[innerWidth,innerHeight],dialog:d?{box:d.getBoundingClientRect().toJSON(),scroll:d.scrollTop,client:d.clientHeight,height:d.scrollHeight,position:getComputedStyle(d).position,overflow:getComputedStyle(d).overflowY}:null,button:b?.getBoundingClientRect().toJSON()};})));
    await page.screenshot({path:resolve('../reports/014-dialog-check.png')});
  }throw error;
} finally {await browser.close();}
