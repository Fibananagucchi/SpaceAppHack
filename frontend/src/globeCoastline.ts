import source from './assets/world-coastline.svg?raw';
import type {GeoPoint,GlobeView} from './globeGeometry';
import {project} from './globeGeometry';

/** Decode only the existing Natural Earth M/L/Z geography; no data are generated. */
export function coastlineRings(svg:string):GeoPoint[][] {
  const rings:GeoPoint[][]=[];
  for(const path of svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)){
    let ring:GeoPoint[]=[];
    for(const part of path[1].matchAll(/([ML])(-?[\d.]+),(-?[\d.]+)|(Z)/g)){
      if(part[1]==='M'){if(ring.length)rings.push(ring);ring=[];}
      if(part[1])ring.push({lat:90-Number(part[3]),lon:Number(part[2])-180});
      else if(part[4]&&ring.length)ring.push(ring[0]);
    }
    if(ring.length)rings.push(ring);
  }
  return rings;
}
export const COASTLINES=coastlineRings(source);
export function coastlinePath(view:GlobeView):Path2D {
  const path=new Path2D();
  for(const ring of COASTLINES){let previous:GeoPoint|undefined,pen=false;for(const p of ring){const q=project(p,view),cut=previous&&(Math.abs(p.lon-previous.lon)>180||(Math.abs(p.lon)>=179.99&&Math.abs(previous.lon)>=179.99)||(p.lat<=-89.99&&previous.lat<=-89.99));if(q.z<=0||cut){pen=false;previous=p;continue;}if(pen)path.lineTo(q.x,q.y);else path.moveTo(q.x,q.y);pen=true;previous=p;}}
  return path;
}
