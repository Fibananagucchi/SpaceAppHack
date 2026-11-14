import { isMonth, isObject } from './contract';
import type { ObjectValue } from './contract';
import { finite, record } from './analysis';

export interface TrendMap {
  raw:ObjectValue;variableId:string;rows:number;cols:number;lat0:number;lon0:number;dlat:number;dlon:number;
  start:string;end:string;unit:string;limit:number;
  slope:(number|null)[];p:(number|null)[];q:(number|null)[];significant:(boolean|null)[];status:number[];codes:Record<string,string>;
}
export function parseTrendMap(data:ObjectValue,variableId:string):TrendMap {
  const grid=record(data.grid),cells=record(data.cells),period=record(data.period),legend=record(data.legend),codes=record(data.status_codes);
  if(data.status!=='ok'||data.format_version!=='map-1.2'||data.variable_id!==variableId||!Array.isArray(grid.shape)||grid.shape.length!==2||!grid.shape.every(n=>Number.isInteger(n)&&n>0)||grid.shape[0]*grid.shape[1]>500000||grid.cell_reference!=='center'||!finite(grid.lat0)||!finite(grid.lon0)||!finite(grid.dlat)||grid.dlat<=0||!finite(grid.dlon)||grid.dlon<=0||!isMonth(period.start)||!isMonth(period.end)||typeof data.unit!=='string'||!isObject(data.status_codes))throw Error('invalid_map');
  const n=grid.shape[0]*grid.shape[1];
  const numeric=(value:unknown):value is (number|null)[]=>Array.isArray(value)&&value.length===n&&value.every(v=>v===null||finite(v));
  if(!numeric(cells.slope)||!numeric(cells.p_value)||!numeric(cells.q_value)||!Array.isArray(cells.significant)||cells.significant.length!==n||!cells.significant.every(v=>v===null||typeof v==='boolean')||!Array.isArray(cells.status)||cells.status.length!==n||!cells.status.every(s=>Number.isInteger(s)&&typeof codes[String(s)]==='string'))throw Error('invalid_map');
  if(!Object.values(data.status_codes).every(s=>['ok','no_data','insufficient_for_test','not_computed'].includes(String(s)))||!Array.isArray(legend.range)||legend.range.length!==2||!legend.range.every(finite)||legend.range[0]>=0||legend.range[1]<=0)throw Error('invalid_map');
  for(let i=0;i<n;i++){
    const state=codes[String(cells.status[i])];
    if(state==='ok'&&(!finite(cells.slope[i])||!finite(cells.p_value[i])||!finite(cells.q_value[i])||typeof cells.significant[i]!=='boolean'))throw Error('invalid_map');
    if(state!=='ok'&&(cells.slope[i]!==null||cells.significant[i]!==null))throw Error('invalid_map');
  }
  return {raw:data,variableId,rows:grid.shape[0],cols:grid.shape[1],lat0:grid.lat0,lon0:grid.lon0,dlat:grid.dlat,dlon:grid.dlon,start:period.start,end:period.end,unit:data.unit,limit:Math.max(Math.abs(legend.range[0]),legend.range[1]),slope:cells.slope,p:cells.p_value,q:cells.q_value,significant:cells.significant,status:cells.status,codes:data.status_codes as Record<string,string>};
}
export const cellState=(map:TrendMap,i:number)=>map.codes[String(map.status[i])];
export const cellLocation=(map:TrendMap,i:number)=>({lat:Number((map.lat0+Math.floor(i/map.cols)*map.dlat).toFixed(6)),lon:Number((map.lon0+(i%map.cols)*map.dlon).toFixed(6))});
export function oppositePair(map:TrendMap):[number,number]|undefined {
  let neg=-1,pos=-1;
  for(let i=0;i<map.slope.length;i++){const s=map.slope[i];if(cellState(map,i)!=='ok'||map.significant[i]!==true||s===null)continue;if(s<0&&(neg<0||s<map.slope[neg]!))neg=i;if(s>0&&(pos<0||s>map.slope[pos]!))pos=i;}
  return neg>=0&&pos>=0?[neg,pos]:undefined;
}
export function mapColour(value:number,limit:number):string {
  const fraction=Math.min(1,Math.abs(value)/limit),base=[175,191,198],end=value<0?[126,187,224]:[232,175,120];
  return `rgb(${base.map((v,i)=>Math.round(v+(end[i]-v)*fraction)).join(',')})`;
}
