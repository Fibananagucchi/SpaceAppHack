/** Read-only static palette previews; actual API requests pass through unchanged. */
import {createServer,request} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,sep,extname} from 'node:path';
const root=fileURLToPath(new URL('../_mockups/palette/',import.meta.url)),types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
for(const [i,id] of ['a','b','c'].entries()){
  const dir=resolve(root,id);
  createServer(async(req,res)=>{
    if(req.url.startsWith('/api/')){const upstream=request({hostname:'127.0.0.1',port:8000,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1:8000'}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});upstream.on('error',()=>{res.writeHead(502);res.end('API unavailable');});req.pipe(upstream);return;}
    try{const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=resolve(dir,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(dir+sep))throw Error();const content=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream','Cache-Control':'no-store'});res.end(content);}catch{res.writeHead(404);res.end('Not found');}
  }).listen(8021+i,'127.0.0.1',()=>console.log(`${id}: http://127.0.0.1:${8021+i}`));
}
