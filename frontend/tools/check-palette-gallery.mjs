import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const root=new URL('../_mockups/palette/',import.meta.url),browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1800,height:1100}}),checks=[];
await page.goto(new URL('index.html',root).href);
for(const view of ['globe','card','timeline','evidence','passport','context','context-card','deuteranopia','protanopia','tritanopia']){
  await page.locator('#view').selectOption(view);await page.waitForFunction(()=>[...document.querySelectorAll('.shot img')].every(i=>i.complete&&i.naturalWidth>0));checks.push(view);
}
await page.locator('#view').selectOption('globe');await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));
await page.screenshot({path:new URL('gallery.png',root).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});
await browser.close();await writeFile(new URL('gallery-checks.json',root),JSON.stringify({views:checks,images:30},null,2));console.log('All 30 gallery screenshots load.');
