import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const root=new URL('../_mockups/globe-018-raster/',import.meta.url);await mkdir(root,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:8018/')?r.continue():r.abort());page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.addInitScript(()=>{const original=WebGLRenderingContext.prototype.compileShader;WebGLRenderingContext.prototype.compileShader=function(shader){original.call(this,shader);if(!this.getShaderParameter(shader,this.COMPILE_STATUS))console.error(this.getShaderInfoLog(shader));};});
await page.goto('http://127.0.0.1:8018/');
try{await page.waitForFunction(()=>document.querySelector('.globe-points')?.dataset.surfaceMode==='smooth'&&document.querySelector('.globe-points')?.dataset.domain==='world',null,{timeout:45000});}catch(e){console.log(JSON.stringify({errors,body:await page.locator('.globe-view').innerText()}));await browser.close();throw e;}
for(const mode of ['Smooth','Cells']){await page.getByRole('button',{name:mode,exact:true}).click();await page.waitForTimeout(100);await page.screenshot({path:new URL(`smoke-${mode.toLowerCase()}.png`,root).pathname.replace(/^\/(\w:)/,'$1'),fullPage:true});}
const state=await page.evaluate(()=>({display:{...document.querySelector('.globe-points').dataset},glError:document.querySelector('.globe-data').getContext('webgl').getError(),legend:document.querySelector('.globe-legend').textContent}));await writeFile(new URL('smoke.json',root),JSON.stringify({state,errors},null,2));await browser.close();console.log(JSON.stringify({state,errors}));if(errors.length||state.glError)throw Error('Raster smoke failed');
