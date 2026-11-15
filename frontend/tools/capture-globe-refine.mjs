import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
const stage=process.argv[2];if(!['before','after'].includes(stage))throw Error('Use before/after');
const root=new URL('../_mockups/globe-018-refine/',import.meta.url);await mkdir(root,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000},locale:'uk-UA'});
await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:8018/')?r.continue():r.abort());
const shot=async name=>{await page.waitForTimeout(250);await page.screenshot({path:new URL(`${stage}-${name}.png`,root).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});};
await page.goto('http://127.0.0.1:8018/');await page.locator('.globe-legend').waitFor();await shot('default');
const et=await page.evaluate(async()=>{const d=await fetch('/api/v1/variables').then(r=>r.json());return d.variables.find(v=>v.variable_id==='evapotranspiration');});
await page.getByTitle(et.label,{exact:true}).click();await page.locator('.globe-legend').waitFor();
await page.getByRole('button',{name:'Place & period ↗'}).click();await page.getByLabel('Latitude',{exact:true}).fill('50.45');await page.getByLabel('Longitude',{exact:true}).fill('30.52');await page.getByRole('button',{name:'Request analysis ↗',exact:true}).click();await page.locator('.card-numbers').waitFor({timeout:60000});await shot('record');
await page.getByRole('button',{name:'Evidence ↗',exact:true}).click();await page.getByRole('dialog',{name:'Evidence'}).waitFor();await shot('evidence');await page.keyboard.press('Escape');
if(stage==='after'){await page.getByRole('button',{name:'Full-period trend',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.globe-legend')?.textContent.includes('Sen trend'));await shot('trend');await page.getByRole('button',{name:'Annual anomaly',exact:true}).click();}
await page.getByRole('button',{name:'Selected place',exact:true}).click();for(let i=0;i<12;i++){const z=page.getByRole('button',{name:'Zoom in',exact:true});if(await z.isDisabled())break;await z.click();}await shot('zoom');
if(stage==='after'){const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setEmulatedVisionDeficiency',{type:'deuteranopia'});await shot('deuteranopia');await cdp.send('Emulation.setEmulatedVisionDeficiency',{type:'none'});await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Evidence ↗',exact:true}).click();await shot('reduced-motion');}
await browser.close();console.log(`Captured ${stage} real API views.`);
