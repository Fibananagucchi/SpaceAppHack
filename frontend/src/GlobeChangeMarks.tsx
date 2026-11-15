import {changeColours,changeGroup,changeLabels,changeSymbols} from './globeChanges';
import type {MapChange,GlobeEvent} from './globeChanges';
import type {GlobeView} from './globeGeometry';
import {project} from './globeGeometry';
import {month} from './format';

export interface ProjectedChange {marker:MapChange;x:number;y:number}
export function visibleChanges(markers:MapChange[]|undefined,view:GlobeView,width:number,height:number):ProjectedChange[] {
  return (markers??[]).flatMap(marker=>{const p=project(marker,view);return p.z>.015&&p.x>=0&&p.y>=0&&p.x<=width&&p.y<=height?[{marker,x:p.x,y:p.y}]:[];});
}
/** Rings identify source cells. They never modify the field or its values. */
export function paintChanges(ctx:CanvasRenderingContext2D,points:ProjectedChange[],radius:number) {
  for(const group of ['product','event','unknown'] as const)for(const tentative of [false,true]){
    const rows=points.filter(p=>(changeGroup(p.marker.category)===group||(group==='event'&&p.marker.coinciding))==true&&(p.marker.status==='inconclusive')===tentative);if(!rows.length)continue;
    const path=new Path2D();for(const p of rows){const r=group==='event'&&p.marker.coinciding?radius*.62:radius;if(group==='product')path.rect(p.x-r,p.y-r,r*2,r*2);else if(group==='event'){path.moveTo(p.x,p.y-r*1.2);path.lineTo(p.x+r*1.2,p.y);path.lineTo(p.x,p.y+r*1.2);path.lineTo(p.x-r*1.2,p.y);path.closePath();}else{path.moveTo(p.x+r,p.y);path.arc(p.x,p.y,r,0,Math.PI*2);}}
    ctx.setLineDash(tentative?[2,2]:[]);ctx.strokeStyle='#151e22';ctx.lineWidth=4;ctx.stroke(path);ctx.strokeStyle=changeColours[group];ctx.lineWidth=1.7;ctx.stroke(path);
  }ctx.setLineDash([]);
}
export function ChangeCallouts({points,hoverId,view,width,height,events,onPick,onEvent,onBrowse}:{points:ProjectedChange[];hoverId?:string;view:GlobeView;width:number;height:number;events:GlobeEvent[];onPick?:(m:MapChange)=>void;onEvent?:(e:GlobeEvent)=>void;onBrowse?:()=>void}) {
  const selected=points.find(p=>p.marker.id===hoverId)??points.reduce<ProjectedChange|undefined>((best,p)=>p.x>Math.min(380,width*.3)&&p.y>100&&p.y<height-130&&(!best||Math.hypot(p.x-view.x,p.y-view.y)<Math.hypot(best.x-view.x,best.y-view.y))?p:best,undefined);
  return <>
    {selected&&<button className="change-map-callout" data-category={changeGroup(selected.marker.category)} style={{left:Math.max(12,Math.min(width-220,selected.x+12)),top:Math.max(90,Math.min(height-100,selected.y-50))}} onClick={()=>onPick?.(selected.marker)} aria-label={`${month(selected.marker.date)} · ${selected.marker.status==='inconclusive'?'Possible':'Sudden'} jump · ${changeLabels[changeGroup(selected.marker.category)]}. Inspect this cell.`}><span aria-hidden="true">{changeSymbols[changeGroup(selected.marker.category)]}{selected.marker.coinciding?' ◇':''}</span><span>{month(selected.marker.date)}<small>{selected.marker.status==='inconclusive'?'Possible jump':'Sudden jump'} ↗</small></span></button>}
    {events.filter(e=>!e.global).map(event=>{const p=project(event,view);return p.z>.02&&p.x>20&&p.x<width-30&&p.y>85&&p.y<height-85?<button key={event.id} className="event-map-callout" style={{left:Math.max(12,Math.min(width-205,p.x)),top:p.y}} title="Documented event · marker is the centre of its approximate region" onClick={()=>onEvent?.(event)}><span aria-hidden="true">◇</span><span>{event.title}</span></button>:null;})}
    {onBrowse&&<button className="change-browse text-button" onClick={onBrowse}>Browse this year’s changes ↗</button>}
  </>;
}
