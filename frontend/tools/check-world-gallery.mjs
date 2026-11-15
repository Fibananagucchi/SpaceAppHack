import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const root=new URL('../_mockups/globe-018-world/',import.meta.url),browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1500,height:1100}});
await page.goto(new URL('index.html',root).href);const files=await page.locator('#view option').evaluateAll(options=>options.map(o=>o.value));
for(const file of files){await page.locator('#view').selectOption(file);await page.waitForFunction(()=>document.querySelector('#image').complete&&document.querySelector('#image').naturalWidth>0);}
await page.locator('#view').selectOption(files[0]);await page.waitForFunction(()=>document.querySelector('#image').complete&&document.querySelector('#image').naturalWidth>0);await page.screenshot({path:new URL('gallery.png',root).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
await browser.close();await writeFile(new URL('gallery-checks.json',root),JSON.stringify({screenshots:files,missing:0},null,2));console.log(`${files.length} real screenshot views verified.`);
