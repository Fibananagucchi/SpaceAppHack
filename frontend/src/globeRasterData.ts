import type {GeoPoint,GlobeLayer} from './globeGeometry';

export interface RasterTextureData {width:number;height:number;values:Uint8Array;cells:Uint8Array;minimum:number;span:number;validCount:number}
/** Display-only 24-bit packing. The original arrays remain the only numeric source. */
export function rasterTextureData(layer:GlobeLayer):RasterTextureData {
  const validity=Uint8Array.from(layer.values,(v,i)=>v!==null&&Number.isFinite(v)&&(!layer.statusLabels||layer.statusLabels[i]==='ok')?1:0);
  const valid=(i:number)=>validity[i]===1;
  const at=(row:number,col:number)=>validity[Math.max(0,Math.min(layer.rows-1,row))*layer.cols+(layer.domain==='world'?((col%layer.cols+layer.cols)%layer.cols):Math.max(0,Math.min(layer.cols-1,col)))];
  // Four exact quadrant flags avoid relying on filtered alpha precision near holes.
  const flags=new Uint8Array(layer.values.length);
  for(let i=0;i<flags.length;i++)if(valid(i)){const row=Math.floor(i/layer.cols),col=i%layer.cols;let quadrants=0;for(const [dx,dy,bit] of [[-1,-1,1],[1,-1,2],[-1,1,4],[1,1,8]])if(at(row,col+dx)&&at(row+dy,col)&&at(row+dy,col+dx))quadrants|=bit;flags[i]=128+(layer.significant?.[i]?64:0)+quadrants;}

  let minimum=Infinity,maximum=-Infinity,validCount=0;
  for(let i=0;i<layer.values.length;i++)if(valid(i)){minimum=Math.min(minimum,layer.values[i]!);maximum=Math.max(maximum,layer.values[i]!);validCount++;}
  if(!validCount){minimum=0;maximum=0;}
  const span=maximum>minimum?maximum-minimum:1;if(!Number.isFinite(span))throw Error('invalid_display_range');
  const width=layer.cols+2,height=layer.rows+2,values=new Uint8Array(width*height*4),cells=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const row=Math.max(0,Math.min(layer.rows-1,y-1)),col=layer.domain==='world'?((x-1+layer.cols)%layer.cols):Math.max(0,Math.min(layer.cols-1,x-1)),i=row*layer.cols+col,p=(y*width+x)*4;
    if(!valid(i))continue;
    const q=Math.max(0,Math.min(16777215,Math.round((layer.values[i]!-minimum)/span*16777215)));
    values[p]=cells[p]=q>>>16;values[p+1]=cells[p+1]=(q>>>8)&255;values[p+2]=cells[p+2]=q&255;values[p+3]=255;cells[p+3]=flags[i];
  }
  return {width,height,values,cells,minimum,span,validCount};
}

/** Same nearest geographic mask lookup used by the GPU; never decides an API request. */
export function geographyIsLand(mask:ImageData,p:GeoPoint):boolean {
  const lon=((p.lon+540)%360)-180,x=Math.min(mask.width-1,Math.floor((lon+180)/360*mask.width)),y=Math.max(0,Math.min(mask.height-1,Math.floor((90-p.lat)/180*mask.height)));
  return mask.data[(y*mask.width+x)*4+3]>=128;
}
