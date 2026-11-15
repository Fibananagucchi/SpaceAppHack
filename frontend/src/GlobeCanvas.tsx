import {useLayoutEffect,useEffect,useMemo,useRef,useState} from 'react';
import type {ReactNode,PointerEvent as ReactPointerEvent} from 'react';
import worldOutline from './assets/world-outline.svg';
import {anomalyColour,globeCell,globeCellLocation,project,rotate,unproject} from './globeGeometry';
import type {GeoPoint,GlobeLayer,GlobeView} from './globeGeometry';
import {createLandRenderer} from './globeLandRenderer';
import type {LandRenderer} from './globeLandRenderer';
import {COASTLINES,coastlinePath} from './globeCoastline';
import {coordinate,number,month} from './format';
import {displaySample,projectVisible} from './globeLod';
import type {VisibleProjection} from './globeLod';
import {createPointRenderer} from './globePointRenderer';
import type {PointRenderer} from './globePointRenderer';
import {createRasterRenderer} from './globeRasterRenderer';
import type {RasterRenderer,SurfaceMode} from './globeRasterRenderer';
import {geographyIsLand} from './globeRasterData';
import {visibleChanges,paintChanges,ChangeCallouts} from './GlobeChangeMarks';
import type {MapChange,GlobeEvent} from './globeChanges';

let maskPromise:Promise<ImageData>|undefined;
function worldMask():Promise<ImageData> {
  if(!maskPromise)maskPromise=new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{const c=document.createElement('canvas');c.width=2880;c.height=1440;const ctx=c.getContext('2d');if(!ctx){reject(Error('canvas_unavailable'));return;}ctx.drawImage(image,0,0,c.width,c.height);resolve(ctx.getImageData(0,0,c.width,c.height));};image.onerror=()=>reject(Error('geography_unavailable'));image.src=worldOutline;});
  return maskPromise;
}
const PALETTE=Array.from({length:65},(_,i)=>anomalyColour((i-32)/32,1));
const RGB_PALETTE=PALETTE.map(c=>c.match(/\d+/g)!.map(Number));
const PALETTE_LUMINANCE=RGB_PALETTE.map(rgb=>{const v=rgb.map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722;});
const CONTRAST_BORDER=PALETTE_LUMINANCE.map(v=>v<.281);
const zoomLimit=(z:number)=>Math.max(.7,Math.min(8,z));
function gridVectors(layer:GlobeLayer):Float64Array {
  const out=new Float64Array(layer.rows*layer.cols*4);
  for(let i=0;i<layer.rows*layer.cols;i++){const p=globeCellLocation(layer,i),lat=p.lat*Math.PI/180,lon=p.lon*Math.PI/180,cos=Math.cos(lat);out[i*4]=cos*Math.sin(lon);out[i*4+1]=Math.sin(lat);out[i*4+2]=cos*Math.cos(lon);out[i*4+3]=Math.min(layer.dlat,layer.dlon*cos)*Math.PI/180;}
  return out;
}
function graticule(view:GlobeView):Path2D {
  const path=new Path2D();const line=(points:GeoPoint[])=>{let pen=false;for(const p of points){const q=project(p,view);if(q.z<0){pen=false;continue;}if(pen)path.lineTo(q.x,q.y);else path.moveTo(q.x,q.y);pen=true;}};
  for(let lon=-180;lon<180;lon+=30)line(Array.from({length:91},(_,i)=>({lon,lat:-90+i*2})));
  for(let lat=-60;lat<=60;lat+=30)line(Array.from({length:181},(_,i)=>({lat,lon:-180+i*2})));
  return path;
}

export function Globe({layer,point,bbox,pair,selectionMode,onPick,onArea,onInspect,focusKey=0,changes,events=[],changesMode=false,onChangePick,onEventPick,onBrowseChanges,nativeChange,onNativeChange,toolbar,inspection}:{inspection?:ReactNode;toolbar?:ReactNode;nativeChange?:{date:string;tentative:boolean};onNativeChange?:()=>void;changes?:MapChange[];events?:GlobeEvent[];changesMode?:boolean;onChangePick?:(m:MapChange)=>void;onEventPick?:(e:GlobeEvent)=>void;onBrowseChanges?:()=>void;layer?:GlobeLayer;point?:GeoPoint;bbox?:[number,number,number,number];pair?:{point:GeoPoint;label:string}[];selectionMode:'point'|'area';onPick:(p:GeoPoint,index?:number)=>void;onArea:(bbox:[number,number,number,number])=>void;onInspect?:(p:GeoPoint,index?:number,water?:boolean)=>void;focusKey?:number}) {
  const host=useRef<HTMLDivElement>(null),base=useRef<HTMLCanvasElement>(null),marks=useRef<HTMLCanvasElement>(null),renderer=useRef<LandRenderer|undefined>(undefined),dots=useRef<HTMLCanvasElement>(null),scatter=useRef<PointRenderer|undefined>(undefined),raster=useRef<RasterRenderer|undefined>(undefined);
  const drag=useRef<{x:number;y:number;view:GeoPoint;start?:GeoPoint;distance:number}|undefined>(undefined),cameraTick=useRef<number|undefined>(undefined),pendingCamera=useRef<GeoPoint|undefined>(undefined),drawTick=useRef<number|undefined>(undefined);
  const [size,setSize]=useState({width:900,height:650}),[centre,setCentre]=useState<GeoPoint>({lon:15,lat:28}),[zoom,setZoom]=useState(1),[mask,setMask]=useState<ImageData>(),[geoError,setGeoError]=useState(false),[software,setSoftware]=useState(false),[scatterSoftware,setScatterSoftware]=useState(false),[preview,setPreview]=useState<[number,number,number,number]>();
  const [surfaceMode,setSurfaceMode]=useState<SurfaceMode>('smooth'),[rasterReady,setRasterReady]=useState(false),[rasterFailed,setRasterFailed]=useState(false);
  const rasterActive=rasterReady&&!rasterFailed&&!scatterSoftware;
  const [hoverChange,setHoverChange]=useState<string>();
  const view:GlobeView={...centre,x:size.width*(size.width<900?.5:.59),y:size.height*.5,radius:Math.min(size.height*.46,size.width*(size.width<900?.45:.34))*zoom};
  const projectedChanges=useMemo(()=>visibleChanges(changes,view,size.width,size.height),[changes,centre,zoom,size]);
  const changeRadius=Math.min(7,3.5+zoom*.6);
  const markerAt=(x:number,y:number)=>projectedChanges.reduce<{distance:number;marker?:MapChange}>((best,p)=>{const d=Math.hypot(p.x-x,p.y-y);return d<Math.max(8,changeRadius+3)&&d<best.distance?{distance:d,marker:p.marker}:best;},{distance:Infinity}).marker;
  const pointKey=point?`${point.lat}/${point.lon}`:'',bboxKey=(preview??bbox)?.join('/')??'',pairKey=pair?.map(p=>`${p.label}/${p.point.lat}/${p.point.lon}`).join('|')??'';
  const gridKey=layer?`${layer.domain}/${layer.rows}/${layer.cols}/${layer.lat0}/${layer.lon0}/${layer.dlat}/${layer.dlon}`:'';
  const lod=useMemo(()=>layer?displaySample(layer,zoom):undefined,[gridKey,zoom<1.8,zoom<3]);
  const vectors=useMemo(()=>layer?gridVectors(layer):undefined,[gridKey]);
  const colours=useMemo(()=>layer?.values.map(v=>v===null?-1:Math.max(0,Math.min(64,Math.round(v/layer.limit*32)+32))),[layer]);
  const cache=useRef<{camera?:string;coast?:Path2D;grid?:Path2D;landCamera?:string;projectedKey?:string;projected?:VisibleProjection;projectionBuilds:number}>({projectionBuilds:0});
  const scene=useRef({view,size,layer,point,bbox:preview??bbox,pair,vectors,colours,gridKey,lod,rasterActive,surfaceMode,projectedChanges,changeRadius});scene.current={view,size,layer,point,bbox:preview??bbox,pair,vectors,colours,gridKey,lod,rasterActive,surfaceMode,projectedChanges,changeRadius};
  const paint=()=>{
    const s=scene.current,c=marks.current;if(!c)return;const dpr=Math.min(2,devicePixelRatio||1),camera=`${s.view.lat}/${s.view.lon}/${s.view.radius}/${s.size.width}/${s.size.height}`,state=cache.current;
    if(renderer.current&&state.landCamera!==camera){renderer.current.draw(s.view,s.size.width,s.size.height,Math.min(1,dpr));state.landCamera=camera;}
    const w=Math.round(s.size.width*dpr),h=Math.round(s.size.height*dpr);if(c.width!==w||c.height!==h){c.width=w;c.height=h;}
    const ctx=c.getContext('2d');if(!ctx)return;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,s.size.width,s.size.height);
    if(state.camera!==camera){state.camera=camera;state.coast=coastlinePath(s.view);state.grid=graticule(s.view);}
    const projectedKey=`${camera}/${s.gridKey}/${s.lod?.step}/${s.lod?.indices.length}`;
    if(!s.rasterActive&&s.vectors&&s.lod&&state.projectedKey!==projectedKey){state.projected=projectVisible(s.vectors,s.lod.indices,s.view,s.size.width,s.size.height,s.lod.step);state.projectedKey=projectedKey;state.projectionBuilds++;}
    c.dataset.changeMarkers=String(s.projectedChanges.length);c.dataset.projectionBuilds=String(state.projectionBuilds);c.dataset.cellCount=String(s.layer?.values.length??0);c.dataset.coastlineRings=String(COASTLINES.length);
    ctx.save();ctx.beginPath();ctx.arc(s.view.x,s.view.y,s.view.radius,0,Math.PI*2);ctx.clip();
    ctx.strokeStyle='#718b9638';ctx.lineWidth=.65;if(state.grid)ctx.stroke(state.grid);
    const visible=state.projected,xy=visible?.xy,batches=new Map<number,Path2D>(),outlines=new Path2D(),brightCentres=new Path2D();let hasOutlines=false,drawn=0;
    if(!s.rasterActive&&!scatter.current&&s.layer&&visible&&xy&&s.colours)for(let j=0;j<visible.count;j++){
      const i=visible.indices[j];
      if(s.layer.values[i]===null)continue;const x=xy[j*4],y=xy[j*4+1],r=xy[j*4+3];drawn++;
      const colour=s.colours[i];let path=batches.get(colour);if(!path){path=new Path2D();batches.set(colour,path);}path.moveTo(x+r,y);path.arc(x,y,r,0,Math.PI*2);if(s.layer.significant?.[i]&&r>=1.5){const mark=Math.max(.65,Math.min(1.4,r*.2));const centrePath=PALETTE_LUMINANCE[colour]<.179?brightCentres:outlines;centrePath.moveTo(x+mark,y);centrePath.arc(x,y,mark,0,Math.PI*2);hasOutlines=true;}
    }
    if(s.rasterActive&&raster.current){try{drawn=raster.current.draw(s.layer,s.view,s.size.width,s.size.height,Math.min(1,dpr),s.surfaceMode);}catch{setRasterFailed(true);scatter.current?.invalidate();}c.dataset.surfaceMode=s.surfaceMode;c.dataset.rasterValidCells=String(drawn);}else if(scatter.current)drawn=scatter.current.draw(visible,s.layer,s.colours,s.view,s.size.width,s.size.height,dpr);if(!s.rasterActive)c.dataset.surfaceMode='points';c.dataset.dotBackend=scatter.current?'webgl':'canvas';c.dataset.displayBackend=s.rasterActive?'raster-webgl':scatter.current?'points-webgl':'points-canvas';
    c.dataset.drawnCount=String(drawn);c.dataset.projectedCount=String(visible?.count??0);c.dataset.lodStep=String(s.lod?.step??1);c.dataset.domain=s.layer?.domain??'none';
    for(const [colour,path] of batches){ctx.fillStyle=PALETTE[colour];ctx.fill(path);if(CONTRAST_BORDER[colour]){ctx.strokeStyle='#b0c3b2';ctx.lineWidth=.65;ctx.stroke(path);}}if(hasOutlines){ctx.fillStyle='#151e22';ctx.fill(outlines);ctx.fillStyle='#e4e9e5';ctx.fill(brightCentres);}
    // Geographic outlines intentionally cover data dots, with a quiet dark casing.
    if(state.coast){ctx.strokeStyle='#151e22e6';ctx.lineWidth=2.1;ctx.stroke(state.coast);ctx.strokeStyle='#afc2bd';ctx.lineWidth=.85;ctx.stroke(state.coast);}
    if(s.bbox){const [west,south,east,north]=s.bbox;ctx.strokeStyle='#c3d7bf';ctx.lineWidth=1.5;ctx.setLineDash([4,3]);ctx.beginPath();let pen=false;for(const p of [...Array.from({length:31},(_,i)=>({lon:west+(east-west)*i/30,lat:south})),...Array.from({length:31},(_,i)=>({lon:east,lat:south+(north-south)*i/30})),...Array.from({length:31},(_,i)=>({lon:east-(east-west)*i/30,lat:north})),...Array.from({length:31},(_,i)=>({lon:west,lat:north-(north-south)*i/30}))]){const q=project(p,s.view);if(q.z<0){pen=false;continue;}if(pen)ctx.lineTo(q.x,q.y);else ctx.moveTo(q.x,q.y);pen=true;}ctx.stroke();ctx.setLineDash([]);}
    paintChanges(ctx,s.projectedChanges,s.changeRadius);
    for(const item of [...(s.point?[{point:s.point,label:'P'}]:[]),...(s.pair??[])]){const p=project(item.point,s.view);if(p.z<.02)continue;ctx.fillStyle='#e2e7df';ctx.strokeStyle='#151e22';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,9,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#151e22';ctx.font='bold 10px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(item.label,p.x,p.y+.5);}
    ctx.restore();ctx.strokeStyle='#83979e';ctx.lineWidth=.75;ctx.beginPath();ctx.arc(s.view.x,s.view.y,s.view.radius,0,Math.PI*2);ctx.stroke();ctx.strokeStyle='#c0cacc88';ctx.beginPath();ctx.moveTo(s.view.x-4,s.view.y);ctx.lineTo(s.view.x+4,s.view.y);ctx.moveTo(s.view.x,s.view.y-4);ctx.lineTo(s.view.x,s.view.y+4);ctx.stroke();
  };
  const lastPaint=useRef(-Infinity);
  const schedule=()=>{const now=performance.now();if(drawTick.current===undefined&&now-lastPaint.current>=16){lastPaint.current=now;paint();return;}if(drawTick.current!==undefined)return;const commit=()=>{const time=performance.now();if(time-lastPaint.current<16){drawTick.current=requestAnimationFrame(commit);return;}drawTick.current=undefined;lastPaint.current=time;paint();};drawTick.current=requestAnimationFrame(commit);};
  useEffect(()=>{let live=true;void worldMask().then(m=>{if(live)setMask(m);}).catch(()=>{if(live)setGeoError(true);});return()=>{live=false;};},[]);
  useEffect(()=>{const node=host.current;if(!node)return;const update=()=>{const next={width:node.clientWidth||900,height:node.clientHeight||650};setSize(old=>old.width===next.width&&old.height===next.height?old:next);};update();const observer=new ResizeObserver(update);observer.observe(node);return()=>observer.disconnect();},[]);
  useLayoutEffect(()=>{if(!mask||!base.current)return;const canvas=base.current,lost=(e:Event)=>{e.preventDefault();setSoftware(true);};canvas.addEventListener('webglcontextlost',lost);try{renderer.current=createLandRenderer(base.current,mask,software);base.current.dataset.backend=renderer.current.kind;cache.current.landCamera=undefined;schedule();}catch{if(!software)setSoftware(true);else setGeoError(true);}return()=>{canvas.removeEventListener('webglcontextlost',lost);renderer.current?.dispose();renderer.current=undefined;};},[mask,software]);
  useLayoutEffect(()=>{if(!dots.current||scatterSoftware)return;const canvas=dots.current,lost=(e:Event)=>{e.preventDefault();setScatterSoftware(true);};canvas.addEventListener('webglcontextlost',lost);try{scatter.current=createPointRenderer(canvas,RGB_PALETTE);if(!scatter.current)setScatterSoftware(true);else schedule();}catch{setScatterSoftware(true);}return()=>{canvas.removeEventListener('webglcontextlost',lost);scatter.current?.dispose();scatter.current=undefined;};},[scatterSoftware]);
  useLayoutEffect(()=>{if(!mask||!dots.current||scatterSoftware)return;try{raster.current=createRasterRenderer(dots.current,mask);if(raster.current)setRasterReady(true);else setRasterFailed(true);}catch{setRasterFailed(true);}scatter.current?.invalidate();schedule();return()=>{raster.current?.dispose();raster.current=undefined;};},[mask,scatterSoftware]);
  useLayoutEffect(()=>{raster.current?.invalidate();scatter.current?.invalidate();schedule();},[rasterActive,surfaceMode]);
  useLayoutEffect(schedule,[gridKey,layer,centre,zoom,size,lod,pointKey,bboxKey,pairKey,mask,software,scatterSoftware,rasterActive,surfaceMode,projectedChanges]);
  useEffect(()=>()=>{if(drawTick.current!==undefined)cancelAnimationFrame(drawTick.current);if(cameraTick.current!==undefined)cancelAnimationFrame(cameraTick.current);drawTick.current=undefined;cameraTick.current=undefined;},[]);
  useEffect(()=>{if(!focusKey)return;if(point)setCentre({lon:point.lon,lat:Math.max(-85,Math.min(85,point.lat))});else if(bbox)setCentre({lon:(bbox[0]+bbox[2])/2,lat:Math.max(-85,Math.min(85,(bbox[1]+bbox[3])/2))});},[focusKey]);
  useEffect(()=>{const c=marks.current;if(!c)return;const wheel=(e:WheelEvent)=>{e.preventDefault();setZoom(z=>zoomLimit(z*Math.exp(-e.deltaY*.0015)));};c.addEventListener('wheel',wheel,{passive:false});return()=>c.removeEventListener('wheel',wheel);},[]);
  const position=(e:{clientX:number;clientY:number})=>{const r=marks.current!.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
  const pick=(p:GeoPoint)=>{const index=layer?globeCell(layer,p):undefined;onPick(p,index);};
  const box=(a:GeoPoint,b:GeoPoint):[number,number,number,number]=>[Math.min(a.lon,b.lon),Math.min(a.lat,b.lat),Math.max(a.lon,b.lon),Math.max(a.lat,b.lat)];
  const pointerMove=(e:ReactPointerEvent<HTMLCanvasElement>)=>{const p=position(e),d=drag.current;if(d){d.distance=Math.max(d.distance,Math.hypot(p.x-d.x,p.y-d.y));if(selectionMode==='area'){const q=unproject(p.x,p.y,view);if(d.start&&q)setPreview(box(d.start,q));}else{const degrees=180/Math.PI/view.radius;pendingCamera.current=rotate(d.view,-(p.x-d.x)*degrees/Math.max(.15,Math.cos(d.view.lat*Math.PI/180)),(p.y-d.y)*degrees);if(cameraTick.current===undefined)cameraTick.current=requestAnimationFrame(()=>{cameraTick.current=undefined;if(pendingCamera.current)setCentre(pendingCamera.current);});}}else{const hit=markerAt(p.x,p.y);setHoverChange(old=>old===hit?.id?old:hit?.id);const q=unproject(p.x,p.y,view);if(q)onInspect?.(q,layer?globeCell(layer,q):undefined,mask?!geographyIsLand(mask,q):undefined);}};
  return <div ref={host} className="globe-view" data-zoomed={zoom>2} data-changes={changesMode}><canvas key={String(software)} ref={base} className="globe-geography" aria-hidden="true"/><canvas ref={dots} className="globe-data" aria-hidden="true" hidden={scatterSoftware}/><canvas ref={marks} className="globe-points" data-centre-lat={view.lat} data-centre-lon={view.lon} data-radius={view.radius} data-centre-x={view.x} data-centre-y={view.y} data-zoom={zoom} data-selected-lat={point?.lat} data-selected-lon={point?.lon} tabIndex={0} role="group" aria-label="World globe. Drag to rotate. Arrow keys rotate; Enter selects the centre. Plus, minus or wheel zoom. Use area bounds for keyboard area selection." onPointerDown={e=>{if(e.button!==0)return;const p=position(e);drag.current={...p,view:centre,start:unproject(p.x,p.y,view),distance:0};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={pointerMove} onPointerUp={e=>{const d=drag.current;if(!d)return;const p=position(e),q=unproject(p.x,p.y,view);drag.current=undefined;setPreview(undefined);if(selectionMode==='area'&&d.start&&q&&d.distance>5)onArea(box(d.start,q));else if(selectionMode==='point'&&d.distance<5&&q){const hit=markerAt(p.x,p.y);if(hit&&onChangePick)onChangePick(hit);else pick(q);}}} onPointerCancel={()=>{drag.current=undefined;setPreview(undefined);}} onKeyDown={e=>{const step=Math.max(.25,5/zoom);if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();setCentre(v=>rotate(v,e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0,e.key==='ArrowUp'?step:e.key==='ArrowDown'?-step:0));}else if(e.key==='Enter'||e.key===' '){e.preventDefault();if(selectionMode==='point')pick(centre);}else if(e.key==='+'||e.key==='='){e.preventDefault();setZoom(z=>zoomLimit(z*1.3));}else if(e.key==='-'){e.preventDefault();setZoom(z=>zoomLimit(z/1.3));}}}/>
    {changesMode&&<ChangeCallouts points={projectedChanges} hoverId={hoverChange} view={view} width={size.width} height={size.height} events={events} onPick={onChangePick} onEvent={onEventPick}/>}
    {point&&nativeChange&&!changesMode&&(()=>{const p=project(point,view);return p.z>.02&&p.x>0&&p.x<size.width&&p.y>80&&p.y<size.height-100?<button className="change-map-callout native-change-callout" style={{left:Math.max(12,Math.min(size.width-220,p.x+12)),top:p.y-42}} onClick={onNativeChange}><span aria-hidden="true">↳</span><span>{month(nativeChange.date)}<small>{nativeChange.tentative?'Possible jump':'Jump in this record'} ↗</small></span></button>:null;})()}
    {(!mask||geoError)&&<p className="geography-state" role="status">{geoError?'Geographic fill unavailable. Coastlines and coordinate selection remain available.':'Loading world geography…'}</p>}
    <div className="globe-tools">{toolbar}<div className="globe-navigation" aria-label="Globe view"><div role="group" aria-label="Surface display" className="globe-surface-choice"><button aria-pressed={rasterActive&&surfaceMode==='smooth'} disabled={!rasterActive} title={!rasterActive?'Smooth unavailable: current points are shown.':undefined} onClick={()=>setSurfaceMode('smooth')}>Smooth</button><button aria-pressed={!rasterActive||surfaceMode==='cells'} onClick={()=>setSurfaceMode('cells')}>Cells</button></div><button aria-label="Zoom in" disabled={zoom>=8} onClick={()=>setZoom(z=>zoomLimit(z*1.3))}>+</button><button aria-label="Zoom out" disabled={zoom<=.7} onClick={()=>setZoom(z=>zoomLimit(z/1.3))}>−</button><output aria-label="Zoom level">{zoom.toFixed(1)}×</output><button onClick={()=>{setCentre({lat:28,lon:15});setZoom(1);}}>World view</button><button onClick={()=>{setCentre({lat:52,lon:12});setZoom(2.5);}}>Europe view</button>{point&&<button onClick={()=>setCentre({lon:point.lon,lat:Math.max(-85,Math.min(85,point.lat))})}>Selected place</button>}</div>
    </div><div className="globe-hud">{inspection}<div className="globe-centre tiny">Centre {coordinate(centre.lat)}°, {coordinate(centre.lon)}°</div>
    {layer&&<div className="globe-legend"><p>{layer.label}</p><div><span>−{number(layer.limit)}</span><i title="Zero is neutral; values beyond the scale use its end colours."/><b className="legend-zero">0</b><span>+{number(layer.limit)}</span></div><small>{layer.unit}</small><small>{rasterActive?(surfaceMode==='smooth'?'smoothed display · values from grid cells':'cell display · values from grid cells'):'point display · values from grid cells'}</small>{layer.significant&&<small>{rasterActive?'Hatching: stronger evidence':'Centre marks: stronger evidence'}</small>}{!rasterActive&&<small role="status">{!mask?'Loading surface mask…':'Surface unavailable · current points shown'}</small>}{!rasterActive&&layer.domain==='world'&&<small>{(lod?.step??1)>1?'World view · sampled real grid centres':zoom<3?'World view · thinned polar centres':'Full display grid · visible region only'}</small>}</div>}
    </div>
  </div>;
}
