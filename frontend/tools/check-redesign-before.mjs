// Serve the preserved pre-redesign build with the same real local API for a fair comparison.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
const upstream=process.argv[2];
if(!upstream||!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(upstream))throw Error('Supply the real local API origin.');
const directory=resolve('node_modules/.cache/redesign-before');
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.txt':'text/plain'};
const server=http.createServer(async(req,res)=>{
  if(req.url.startsWith('/api/')){
    const proxy=http.request(new URL(req.url,upstream),{method:req.method,headers:{...req.headers,host:new URL(upstream).host}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
    proxy.on('error',()=>{res.writeHead(502);res.end();});req.pipe(proxy);return;
  }
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),path=resolve(directory,pathname==='/'?'index.html':`.${pathname}`);
    if(!path.startsWith(directory+sep))throw Error('Outside preserved build');
    const bytes=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);
  } catch {res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try {
  process.argv[2]=`http://127.0.0.1:${server.address().port}`;process.argv[3]='before';
  await import('./check-redesign-browser.mjs');
} finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
