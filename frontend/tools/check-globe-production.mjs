/** Production bundle with the actual same-origin API; no fixture injection. */
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const root=new URL('../_mockups/globe-018/',import.meta.url),browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'uk-UA'}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:8000/')?r.continue():r.abort());
await page.goto('http://127.0.0.1:8000/');await page.getByRole('button',{name:'Air temperature',exact:true}).waitFor();
await page.waitForFunction(()=>document.querySelector('.globe-legend')?.textContent.includes('annual anomaly'));
await page.getByRole('button',{name:'Precipitation',exact:true}).click();await page.getByRole('button',{name:'Place & period ↗'}).click();await page.getByLabel('Latitude',{exact:true}).fill('44.85');await page.getByLabel('Longitude',{exact:true}).fill('36.15');await page.getByRole('button',{name:'Request analysis ↗',exact:true}).click();await page.locator('.card-numbers').waitFor({timeout:60000});await page.getByRole('button',{name:'Check wider context ↗',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.globe-conclusion h1')?.textContent==='Possible data artifact',{},{timeout:120000});
await page.waitForTimeout(200);await page.screenshot({path:new URL('17-production.png',root).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
await page.getByLabel('Displayed year',{exact:true}).fill('2025');await page.getByText('No Europe frame for 2025. Native annual values, if available, remain in the strip.',{exact:true}).waitFor();if(await page.locator('.globe-legend').count())throw Error('Missing year inherited a different frame');await page.screenshot({path:new URL('19-missing-year.png',root).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});await page.getByLabel('Displayed year',{exact:true}).fill('2024');
await page.getByRole('button',{name:'Evidence ↗',exact:true}).click();await page.getByRole('dialog',{name:'Evidence',exact:true}).waitFor();await page.screenshot({path:new URL('18-production-evidence.png',root).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
if(errors.length)throw Error(errors.join('\n'));
await writeFile(new URL('production.json',root),JSON.stringify({origin:'http://127.0.0.1:8000',sameOrigin:true,realContext:'possible_data_artifact',missingYearClearsFrame:true,pageErrors:errors},null,2));await browser.close();console.log('Production bundle, real context and same-origin API passed.');
