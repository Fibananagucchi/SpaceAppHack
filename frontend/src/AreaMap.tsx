import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import world from './assets/world-outline.svg';

export function AreaMap({bbox,onPick}:{bbox?:[number,number,number,number];onPick:(bbox:[number,number,number,number])=>void}) {
  const anchor=useRef<[number,number]|null>(null),[preview,setPreview]=useState<[number,number,number,number]>();
  const location=(e:PointerEvent<SVGSVGElement>):[number,number]=>{const r=e.currentTarget.getBoundingClientRect();return [Math.max(-180,Math.min(180,(e.clientX-r.left)/r.width*360-180)),Math.max(-90,Math.min(90,90-(e.clientY-r.top)/r.height*180))];};
  const box=(a:[number,number],b:[number,number]):[number,number,number,number]=>[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])].map(v=>Number(v.toFixed(4))) as [number,number,number,number];
  const selected=preview??bbox;
  return <section className="point-map-panel" aria-label="Area selector"><p className="eyebrow">Draw an area / WGS84</p><svg className="point-map area-map" role="img" aria-label="Drag a rectangular area on the world map; the four coordinate fields are the keyboard alternative" viewBox="0 0 360 180" onPointerDown={e=>{if(e.button!==0)return;anchor.current=location(e);e.currentTarget.setPointerCapture(e.pointerId);setPreview(undefined);}} onPointerMove={e=>{if(anchor.current)setPreview(box(anchor.current,location(e)));}} onPointerUp={e=>{if(anchor.current){const b=box(anchor.current,location(e));anchor.current=null;setPreview(undefined);if(b[0]<b[2]&&b[1]<b[3])onPick(b);}}} onPointerCancel={()=>{anchor.current=null;setPreview(undefined);}}><image href={world} width="360" height="180" opacity=".5"/>{selected&&<rect x={selected[0]+180} y={90-selected[3]} width={selected[2]-selected[0]} height={selected[3]-selected[1]} fill="#e8af78" fillOpacity=".18" stroke="#e8af78" strokeWidth="1"/>}</svg><p className="field-help">Drag a box, or enter its four bounds below.</p><p className="map-credit">Outline: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a></p></section>;
}
