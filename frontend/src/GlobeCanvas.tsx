import {useLayoutEffect,useEffect,useMemo,useRef,useState} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';
import worldOutline from './assets/world-outline.svg';
import {anomalyColour,globeCell,globeCellLocation,project,rotate,unproject} from './globeGeometry';
import type {GeoPoint,GlobeLayer,GlobeView} from './globeGeometry';
import {createLandRenderer} from './globeLandRenderer';
import type {LandRenderer} from './globeLandRenderer';
import {COASTLINES,coastlinePath} from './globeCoastline';
import {coordinate,number} from './format';

let maskPromise:Promise<ImageData>|undefined;
function worldMask():Promise<ImageData> {
  if(!maskPromise)maskPromise=new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{const c=document.createElement('canvas');c.width=2880;c.height=1440;const ctx=c.getContext('2d');if(!ctx){reject(Error('canvas_unavailable'));return;}ctx.drawImage(image,0,0,c.width,c.height);resolve(ctx.getImageData(0,0,c.width,c.height));};image.onerror=()=>reject(Error('geography_unavailable'));image.src=worldOutline;});
  return maskPromise;
}
const PALETTE=Array.from({length:65},(_,i)=>anomalyColour((i-32)/32,1));
const zoomLimit=(z:number)=>Math.max(.7,Math.min(8,z));
function gridVectors(layer:GlobeLayer):Float64Array {
  const out=new Float64Array(layer.rows*layer.cols*4);
  for(let i=0;i<layer.rows*layer.cols;i++){const p=globeCellLocation(layer,i),lat=p.lat*Math.PI/180,lon=p.lon*Math.PI/180,cos=Math.cos(lat);out[i*4]=cos*Math.sin(lon);out[i*4+1]=Math.sin(lat);out[i*4+2]=cos*Math.cos(lon);out[i*4+3]=Math.min(layer.dlat,layer.dlon*cos)*Math.PI/180;}
  return out;
}
function gridProjection(vectors:Float64Array,view:GlobeView):Float32Array {
  const out=new Float32Array(vectors.length),phi=view.lat*Math.PI/180,lambda=view.lon*Math.PI/180,sinPhi=Math.sin(phi),cosPhi=Math.cos(phi),sinLon=Math.sin(lambda),cosLon=Math.cos(lambda);
  for(let i=0;i<vectors.length;i+=4){const z=vectors[i]*sinLon+vectors[i+2]*cosLon,depth=vectors[i+1]*sinPhi+z*cosPhi;out[i]=view.x+view.radius*(vectors[i]*cosLon-vectors[i+2]*sinLon);out[i+1]=view.y-view.radius*(vectors[i+1]*cosPhi-z*sinPhi);out[i+2]=depth;out[i+3]=Math.max(.45,Math.min(18,view.radius*vectors[i+3]*.31))*Math.sqrt(Math.max(.1,depth));}
  return out;
}
function graticule(view:GlobeView):Path2D {
  const path=new Path2D();const line=(points:GeoPoint[])=>{let pen=false;for(const p of points){const q=project(p,view);if(q.z<0){pen=false;continue;}if(pen)path.lineTo(q.x,q.y);else path.moveTo(q.x,q.y);pen=true;}};
  for(let lon=-180;lon<180;lon+=30)line(Array.from({length:91},(_,i)=>({lon,lat:-90+i*2})));
  for(let lat=-60;lat<=60;lat+=30)line(Array.from({length:181},(_,i)=>({lat,lon:-180+i*2})));
  return path;
}

export function Globe({layer,point,bbox,pair,selectionMode,onPick,onArea,onInspect,focusKey=0}:{layer?:GlobeLayer;point?:GeoPoint;bbox?:[number,number,number,number];pair?:{point:GeoPoint;label:string}[];selectionMode:'point'|'area';onPick:(p:GeoPoint,index?:number)=>void;onArea:(bbox:[number,number,number,number])=>void;onInspect?:(p:GeoPoint,index?:number)=>void;focusKey?:number}) {
  const host=useRef<HTMLDivElement>(null),base=useRef<HTMLCanvasElement>(null),marks=useRef<HTMLCanvasElement>(null),renderer=useRef<LandRenderer|undefined>(undefined);
  const drag=useRef<{x:number;y:number;view:GeoPoint;start?:GeoPoint;distance:number}|undefined>(undefined),cameraTick=useRef<number|undefined>(undefined),pendingCamera=useRef<GeoPoint|undefined>(undefined),drawTick=useRef<number|undefined>(undefined);
  const [size,setSize]=useState({width:900,height:650}),[centre,setCentre]=useState<GeoPoint>({lon:15,lat:28}),[zoom,setZoom]=useState(1),[mask,setMask]=useState<ImageData>(),[geoError,setGeoError]=useState(false),[software,setSoftware]=useState(false),[preview,setPreview]=useState<[number,number,number,number]>();
  const view:GlobeView={...centre,x:size.width*(size.width<900?.5:.59),y:size.height*.5,radius:Math.min(size.height*.46,size.width*(size.width<900?.45:.34))*zoom};
  const pointKey=point?`${point.lat}/${point.lon}`:'',bboxKey=(preview??bbox)?.join('/')??'',pairKey=pair?.map(p=>`${p.label}/${p.point.lat}/${p.point.lon}`).join('|')??'';
  const gridKey=layer?`${layer.rows}/${layer.cols}/${layer.lat0}/${layer.lon0}/${layer.dlat}/${layer.dlon}`:'';
  const vectors=useMemo(()=>layer?gridVectors(layer):undefined,[gridKey]);
  const colours=useMemo(()=>layer?.values.map(v=>v===null?-1:Math.max(0,Math.min(64,Math.round(v/layer.limit*32)+32))),[layer]);
  const cache=useRef<{camera?:string;coast?:Path2D;grid?:Path2D;landCamera?:string;projectedKey?:string;projected?:Float32Array;projectionBuilds:number}>({projectionBuilds:0});
  const scene=useRef({view,size,layer,point,bbox:preview??bbox,pair,vectors,colours,gridKey});scene.current={view,size,layer,point,bbox:preview??bbox,pair,vectors,colours,gridKey};
  const paint=()=>{
    const s=scene.current,c=marks.current;if(!c)return;const dpr=Math.min(2,devicePixelRatio||1),camera=`${s.view.lat}/${s.view.lon}/${s.view.radius}/${s.size.width}/${s.size.height}`,state=cache.current;
    if(renderer.current&&state.landCamera!==camera){renderer.current.draw(s.view,s.size.width,s.size.height,dpr);state.landCamera=camera;}
    const w=Math.round(s.size.width*dpr),h=Math.round(s.size.height*dpr);if(c.width!==w||c.height!==h){c.width=w;c.height=h;}
    const ctx=c.getContext('2d');if(!ctx)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,s.size.width,s.size.height);
    if(state.camera!==camera){state.camera=camera;state.coast=coastlinePath(s.view);state.grid=graticule(s.view);}
    const projectedKey=`${camera}/${s.gridKey}`;
    if(s.vectors&&state.projectedKey!==projectedKey){state.projected=gridProjection(s.vectors,s.view);state.projectedKey=projectedKey;state.projectionBuilds++;}
    c.dataset.projectionBuilds=String(state.projectionBuilds);c.dataset.cellCount=String(s.layer?.values.length??0);c.dataset.coastlineRings=String(COASTLINES.length);
    ctx.save();ctx.beginPath();ctx.arc(s.view.x,s.view.y,s.view.radius,0,Math.PI*2);ctx.clip();
    ctx.strokeStyle='#718b9638';ctx.lineWidth=.65;if(state.grid)ctx.stroke(state.grid);
    const xy=state.projected,batches=new Map<number,Path2D>(),outlines=new Path2D();let hasOutlines=false;
    if(s.layer&&xy&&s.colours)for(let i=0;i<s.layer.values.length;i++){
      if(s.layer.values[i]===null||xy[i*4+2]<.02)continue;const x=xy[i*4],y=xy[i*4+1],r=xy[i*4+3];if(x+r<0||x-r>s.size.width||y+r<0||y-r>s.size.height)continue;
      const colour=s.colours[i];let path=batches.get(colour);if(!path){path=new Path2D();batches.set(colour,path);}path.moveTo(x+r,y);path.arc(x,y,r,0,Math.PI*2);if(s.layer.significant?.[i]){outlines.moveTo(x+r,y);outlines.arc(x,y,r,0,Math.PI*2);hasOutlines=true;}
    }
    for(const [colour,path] of batches){ctx.fillStyle=PALETTE[colour];ctx.fill(path);}if(hasOutlines){ctx.strokeStyle='#0e202b9c';ctx.lineWidth=.5;ctx.stroke(outlines);}
    // Geographic outlines intentionally cover data dots, with a quiet dark casing.
    if(state.coast){ctx.strokeStyle='#0b202be6';ctx.lineWidth=2.1;ctx.stroke(state.coast);ctx.strokeStyle='#a7bbc0';ctx.lineWidth=.85;ctx.stroke(state.coast);}
    if(s.bbox){const [west,south,east,north]=s.bbox;ctx.strokeStyle='#d1b69a';ctx.lineWidth=1.5;ctx.setLineDash([4,3]);ctx.beginPath();let pen=false;for(const p of [...Array.from({length:31},(_,i)=>({lon:west+(east-west)*i/30,lat:south})),...Array.from({length:31},(_,i)=>({lon:east,lat:south+(north-south)*i/30})),...Array.from({length:31},(_,i)=>({lon:east-(east-west)*i/30,lat:north})),...Array.from({length:31},(_,i)=>({lon:west,lat:north-(north-south)*i/30}))]){const q=project(p,s.view);if(q.z<0){pen=false;continue;}if(pen)ctx.lineTo(q.x,q.y);else ctx.moveTo(q.x,q.y);pen=true;}ctx.stroke();ctx.setLineDash([]);}
    for(const item of [...(s.point?[{point:s.point,label:'P'}]:[]),...(s.pair??[])]){const p=project(item.point,s.view);if(p.z<.02)continue;ctx.fillStyle='#e2e7df';ctx.strokeStyle='#10232d';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,9,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#10232d';ctx.font='bold 10px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(item.label,p.x,p.y+.5);}
    ctx.restore();ctx.strokeStyle='#83979e';ctx.lineWidth=.75;ctx.beginPath();ctx.arc(s.view.x,s.view.y,s.view.radius,0,Math.PI*2);ctx.stroke();ctx.strokeStyle='#c0cacc88';ctx.beginPath();ctx.moveTo(s.view.x-4,s.view.y);ctx.lineTo(s.view.x+4,s.view.y);ctx.moveTo(s.view.x,s.view.y-4);ctx.lineTo(s.view.x,s.view.y+4);ctx.stroke();
  };
  const lastPaint=useRef(-Infinity);
  const schedule=()=>{const now=performance.now();if(drawTick.current===undefined&&now-lastPaint.current>=16){lastPaint.current=now;paint();return;}if(drawTick.current!==undefined)return;const commit=()=>{const time=performance.now();if(time-lastPaint.current<16){drawTick.current=requestAnimationFrame(commit);return;}drawTick.current=undefined;lastPaint.current=time;paint();};drawTick.current=requestAnimationFrame(commit);};
  useEffect(()=>{let live=true;void worldMask().then(m=>{if(live)setMask(m);}).catch(()=>{if(live)setGeoError(true);});return()=>{live=false;};},[]);
  useEffect(()=>{const node=host.current;if(!node)return;const update=()=>{const next={width:node.clientWidth||900,height:node.clientHeight||650};setSize(old=>old.width===next.width&&old.height===next.height?old:next);};update();const observer=new ResizeObserver(update);observer.observe(node);return()=>observer.disconnect();},[]);
  useLayoutEffect(()=>{if(!mask||!base.current)return;const canvas=base.current,lost=(e:Event)=>{e.preventDefault();setSoftware(true);};canvas.addEventListener('webglcontextlost',lost);try{renderer.current=createLandRenderer(base.current,mask,software);base.current.dataset.backend=renderer.current.kind;cache.current.landCamera=undefined;schedule();}catch{if(!software)setSoftware(true);else setGeoError(true);}return()=>{canvas.removeEventListener('webglcontextlost',lost);renderer.current?.dispose();renderer.current=undefined;};},[mask,software]);
  useLayoutEffect(schedule,[gridKey,layer,centre,zoom,size,pointKey,bboxKey,pairKey,mask,software]);
  useEffect(()=>()=>{if(drawTick.current!==undefined)cancelAnimationFrame(drawTick.current);if(cameraTick.current!==undefined)cancelAnimationFrame(cameraTick.current);drawTick.current=undefined;cameraTick.current=undefined;},[]);
  useEffect(()=>{if(focusKey&&point)setCentre({lon:point.lon,lat:Math.max(-85,Math.min(85,point.lat))});},[focusKey]);
  useEffect(()=>{const c=marks.current;if(!c)return;const wheel=(e:WheelEvent)=>{e.preventDefault();setZoom(z=>zoomLimit(z*Math.exp(-e.deltaY*.0015)));};c.addEventListener('wheel',wheel,{passive:false});return()=>c.removeEventListener('wheel',wheel);},[]);
  const position=(e:{clientX:number;clientY:number})=>{const r=marks.current!.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
  const pick=(p:GeoPoint)=>{const index=layer?globeCell(layer,p):undefined;onPick(index!==undefined&&layer?globeCellLocation(layer,index):{lat:Number(p.lat.toFixed(4)),lon:Number(p.lon.toFixed(4))},index);};
  const box=(a:GeoPoint,b:GeoPoint):[number,number,number,number]=>[Math.min(a.lon,b.lon),Math.min(a.lat,b.lat),Math.max(a.lon,b.lon),Math.max(a.lat,b.lat)];
  const pointerMove=(e:ReactPointerEvent<HTMLCanvasElement>)=>{const p=position(e),d=drag.current;if(d){d.distance=Math.max(d.distance,Math.hypot(p.x-d.x,p.y-d.y));if(selectionMode==='area'){const q=unproject(p.x,p.y,view);if(d.start&&q)setPreview(box(d.start,q));}else{const degrees=180/Math.PI/view.radius;pendingCamera.current=rotate(d.view,-(p.x-d.x)*degrees/Math.max(.15,Math.cos(d.view.lat*Math.PI/180)),(p.y-d.y)*degrees);if(cameraTick.current===undefined)cameraTick.current=requestAnimationFrame(()=>{cameraTick.current=undefined;if(pendingCamera.current)setCentre(pendingCamera.current);});}}else{const q=unproject(p.x,p.y,view);if(q)onInspect?.(q,layer?globeCell(layer,q):undefined);}};
  return <div ref={host} className="globe-view" data-zoomed={zoom>2}><canvas key={String(software)} ref={base} className="globe-geography" aria-hidden="true"/><canvas ref={marks} className="globe-points" data-centre-lat={view.lat} data-centre-lon={view.lon} data-radius={view.radius} data-centre-x={view.x} data-centre-y={view.y} data-zoom={zoom} tabIndex={0} role="group" aria-label="World globe. Drag to rotate. Arrow keys rotate; Enter selects the centre. Plus, minus or wheel zoom. Use area bounds for keyboard area selection." onPointerDown={e=>{if(e.button!==0)return;const p=position(e);drag.current={...p,view:centre,start:unproject(p.x,p.y,view),distance:0};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={pointerMove} onPointerUp={e=>{const d=drag.current;if(!d)return;const p=position(e),q=unproject(p.x,p.y,view);drag.current=undefined;setPreview(undefined);if(selectionMode==='area'&&d.start&&q&&d.distance>5)onArea(box(d.start,q));else if(selectionMode==='point'&&d.distance<5&&q)pick(q);}} onPointerCancel={()=>{drag.current=undefined;setPreview(undefined);}} onKeyDown={e=>{const step=Math.max(.25,5/zoom);if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();setCentre(v=>rotate(v,e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0,e.key==='ArrowUp'?step:e.key==='ArrowDown'?-step:0));}else if(e.key==='Enter'||e.key===' '){e.preventDefault();if(selectionMode==='point')pick(centre);}else if(e.key==='+'||e.key==='='){e.preventDefault();setZoom(z=>zoomLimit(z*1.3));}else if(e.key==='-'){e.preventDefault();setZoom(z=>zoomLimit(z/1.3));}}}/>
    {(!mask||geoError)&&<p className="geography-state" role="status">{geoError?'Geographic fill unavailable. Coastlines and coordinate selection remain available.':'Loading world geography…'}</p>}
    <div className="globe-navigation" aria-label="Globe view"><button aria-label="Zoom in" disabled={zoom>=8} onClick={()=>setZoom(z=>zoomLimit(z*1.3))}>+</button><button aria-label="Zoom out" disabled={zoom<=.7} onClick={()=>setZoom(z=>zoomLimit(z/1.3))}>−</button><output aria-label="Zoom level">{zoom.toFixed(1)}×</output><button onClick={()=>{setCentre({lat:28,lon:15});setZoom(1);}}>World view</button><button onClick={()=>{setCentre({lat:52,lon:12});setZoom(2.5);}}>Europe view</button>{point&&<button onClick={()=>setCentre({lon:point.lon,lat:Math.max(-85,Math.min(85,point.lat))})}>Selected place</button>}</div>
    <div className="globe-centre tiny">Centre {coordinate(centre.lat)}°, {coordinate(centre.lon)}° <span>Arrows rotate · Enter selects centre</span></div>
    {layer&&<div className="globe-legend"><p>{layer.label}</p><div><span>−{number(layer.limit)}</span><i/><span>+{number(layer.limit)}</span></div><small>{layer.unit} · zero-centred · extremes clipped</small></div>}
  </div>;
}
