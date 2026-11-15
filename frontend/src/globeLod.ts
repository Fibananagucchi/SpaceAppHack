import type {GlobeLayer,GlobeView} from './globeGeometry';

/** A display sample of original centres. Never averages observations or test results. */
export function displaySample(layer:GlobeLayer,zoom:number):{indices:Uint32Array;step:number} {
  const step=layer.domain==='world'&&zoom<1.8?2:1,indices:number[]=[];
  for(let row=0;row<layer.rows;row+=step){
    const latitude=layer.lat0+row*layer.dlat;
    // At world view avoid dense stacks of longitude centres near the poles.
    const longitudeStep=layer.domain==='world'&&zoom<3?Math.max(step,Math.round(step/Math.max(.08,Math.cos(latitude*Math.PI/180)))):1;
    for(let col=0;col<layer.cols;col+=longitudeStep)indices.push(row*layer.cols+col);
  }
  return {indices:Uint32Array.from(indices),step};
}

export interface VisibleProjection {indices:Uint32Array;xy:Float32Array;count:number}
/** Only front-facing, viewport-visible centres enter the cached drawing list. */
export function projectVisible(vectors:Float64Array,indices:Uint32Array,view:GlobeView,width:number,height:number,step:number):VisibleProjection {
  const xy=new Float32Array(indices.length*4),visible=new Uint32Array(indices.length);
  const phi=view.lat*Math.PI/180,lambda=view.lon*Math.PI/180,sinPhi=Math.sin(phi),cosPhi=Math.cos(phi),sinLon=Math.sin(lambda),cosLon=Math.cos(lambda);
  let count=0;
  for(const index of indices){
    const i=index*4,z=vectors[i]*sinLon+vectors[i+2]*cosLon,depth=vectors[i+1]*sinPhi+z*cosPhi;
    if(depth<.02)continue;
    const x=view.x+view.radius*(vectors[i]*cosLon-vectors[i+2]*sinLon),y=view.y-view.radius*(vectors[i+1]*cosPhi-z*sinPhi);
    const radius=Math.max(.65,Math.min(18,view.radius*vectors[i+3]*.38*step))*Math.sqrt(Math.max(.1,depth));
    if(x+radius<0||x-radius>width||y+radius<0||y-radius>height)continue;
    visible[count]=index;xy[count*4]=x;xy[count*4+1]=y;xy[count*4+2]=depth;xy[count*4+3]=radius;count++;
  }
  return {indices:visible,xy,count};
}
