import type {GlobeLayer,GlobeView} from './globeGeometry';
import {rasterTextureData} from './globeRasterData';
import cork from './assets/cork.json';

export type SurfaceMode='smooth'|'cells';
export interface RasterRenderer {draw:(layer:GlobeLayer|undefined,view:GlobeView,width:number,height:number,dpr:number,mode:SurfaceMode)=>number;invalidate:()=>void;dispose:()=>void}

/** A spatial display filter only. No filtered value leaves this shader. */
export function createRasterRenderer(canvas:HTMLCanvasElement,landMask:ImageData):RasterRenderer|undefined {
  const gl=canvas.getContext('webgl',{alpha:true,antialias:false,depth:false,stencil:false,premultipliedAlpha:true});if(!gl)return;
  if(gl.getParameter(gl.MAX_TEXTURE_SIZE)<Math.max(landMask.width,landMask.height))return;
  const compile=(type:number,source:string)=>{const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error('raster_shader');return shader;};
  const vertex=compile(gl.VERTEX_SHADER,'attribute vec2 position;void main(){gl_Position=vec4(position,0.0,1.0);}');
  const fragment=compile(gl.FRAGMENT_SHADER,`precision highp float;
    uniform sampler2D values;uniform sampler2D cells;uniform sampler2D palette;uniform sampler2D land;
    uniform vec2 resolution;uniform vec2 centre;uniform float radius;uniform float latitude;uniform float longitude;uniform float pixelRatio;
    uniform vec2 shape;uniform vec2 origin;uniform vec2 pitch;uniform float valueMinimum;uniform float valueSpan;uniform float colourLimit;
    uniform float smoothDisplay;uniform float landOnly;uniform float worldWrap;
    float decode(vec4 t){return valueMinimum+dot(t.rgb,vec3(16711680.0,65280.0,255.0))/16777215.0*valueSpan;}
    float cubic(float a,float b,float c,float d,float t){return b+0.5*t*(c-a+t*(2.0*a-5.0*b+4.0*c-d+t*(3.0*(b-c)+d-a)));}
    vec4 source(vec2 index){index.y=clamp(index.y,0.0,shape.y-1.0);index.x=worldWrap>0.5?mod(index.x+shape.x,shape.x):clamp(index.x,0.0,shape.x-1.0);return texture2D(cells,(index+1.5)/(shape+2.0));}
    vec4 row(vec2 start,float t){vec4 a=source(start),b=source(start+vec2(1.0,0.0)),c=source(start+vec2(2.0,0.0)),d=source(start+vec2(3.0,0.0));return vec4(cubic(decode(a),decode(b),decode(c),decode(d),t),min(min(a.a,b.a),min(c.a,d.a)),decode(b),decode(c));}
    void main(){
      vec2 pixel=vec2(gl_FragCoord.x/pixelRatio,resolution.y-gl_FragCoord.y/pixelRatio);
      vec2 p=(pixel-centre)/radius;p.y=-p.y;float rr=dot(p,p);if(rr>1.0)discard;
      float z=sqrt(max(0.0,1.0-rr));float phi=asin(clamp(z*sin(latitude)+p.y*cos(latitude),-1.0,1.0));
      float lambda=longitude+atan(p.x,z*cos(latitude)-p.y*sin(latitude));
      vec2 geo=vec2(mod(lambda*57.2957795131+540.0,360.0)-180.0,phi*57.2957795131);
      if(landOnly>0.5&&texture2D(land,vec2(fract(lambda/6.28318530718+0.5),0.5-phi/3.14159265359)).a<0.5)discard;
      vec2 g=(geo-origin)/pitch;if(g.x<0.0||g.y<0.0||g.x>shape.x||g.y>shape.y)discard;
      vec2 cell=clamp(floor(g),vec2(0.0),shape-1.0),dimensions=shape+2.0;
      vec4 actual=texture2D(cells,(cell+1.5)/dimensions);float flags=floor(actual.a*255.0+0.5);if(flags<128.0)discard;
      float value=decode(actual);
      if(smoothDisplay>0.5){
        vec2 quadrant=step(vec2(0.5),fract(g));float bit=quadrant.y>0.5?(quadrant.x>0.5?8.0:4.0):(quadrant.x>0.5?2.0:1.0);
        if(mod(floor(mod(flags,16.0)/bit),2.0)>0.5){
          value=decode(texture2D(values,(g+1.0)/dimensions));
          vec2 f=fract(g-0.5),start=floor(g-0.5)-1.0;
          vec4 a=row(start,f.x),b=row(start+vec2(0.0,1.0),f.x),c=row(start+vec2(0.0,2.0),f.x),d=row(start+vec2(0.0,3.0),f.x);
          if(min(min(a.y,b.y),min(c.y,d.y))>=0.5){float lo=min(min(b.z,b.w),min(c.z,c.w)),hi=max(max(b.z,b.w),max(c.z,c.w));value=clamp(cubic(a.x,b.x,c.x,d.x,f.y),lo,hi);}
        }
      }
      float fraction=clamp(value/max(colourLimit,0.00000000000000000001),-1.0,1.0);
      vec3 colour=texture2D(palette,vec2((32.0+(fraction+1.0)*95.5+0.5)/256.0,0.5)).rgb;
      if(flags>=192.0){
        float stripe=mod(pixel.x+pixel.y,8.0);float mark=1.0-smoothstep(0.8,1.7,stripe);
        float luminance=dot(pow((colour+vec3(0.055))/1.055,vec3(2.4)),vec3(0.2126,0.7152,0.0722));
        vec3 ink=luminance<0.179?vec3(0.894118,0.913725,0.898039):vec3(0.08235,0.11765,0.13333);
        colour=mix(colour,ink,mark*0.48);
      }
      gl_FragColor=vec4(colour,1.0);
    }`);
  const program=gl.createProgram()!;gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('raster_program');
  const buffer=gl.createBuffer()!;gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const maxAttributes=gl.getParameter(gl.MAX_VERTEX_ATTRIBS),position=gl.getAttribLocation(program,'position'),textures=[0,1,2,3].map(()=>gl.createTexture()!);
  const bind=(unit:number,filter:number)=>{gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,textures[unit]);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);};
  const palette=new Uint8Array(256*4);cork.forEach((rgb,i)=>{palette.set(rgb.map(v=>Math.round(v*255)),i*4);palette[i*4+3]=255;});
  bind(2,gl.LINEAR);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,256,1,0,gl.RGBA,gl.UNSIGNED_BYTE,palette);
  bind(3,gl.NEAREST);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,landMask.width,landMask.height,0,gl.RGBA,gl.UNSIGNED_BYTE,landMask.data);
  const uniforms=Object.fromEntries(['values','cells','palette','land','resolution','centre','radius','latitude','longitude','pixelRatio','shape','origin','pitch','valueMinimum','valueSpan','colourLimit','smoothDisplay','landOnly','worldWrap'].map(k=>[k,gl.getUniformLocation(program,k)]));
  let uploaded:GlobeLayer|undefined,drawn:GlobeLayer|undefined,lastCamera='',validCount=0,minimum=0,span=1;
  return {draw(layer,view,width,height,dpr,mode){
    const camera=[view.lat,view.lon,view.radius,width,height,dpr,mode].join('/'),w=Math.round(width*dpr),h=Math.round(height*dpr),resized=canvas.width!==w||canvas.height!==h;
    if(!resized&&layer===drawn&&camera===lastCamera)return validCount;
    if(resized){canvas.width=w;canvas.height=h;}gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    if(layer){
      if(uploaded!==layer){const data=rasterTextureData(layer);minimum=data.minimum;span=data.span;validCount=data.validCount;for(let i=0;i<2;i++){bind(i,i===0?gl.LINEAR:gl.NEAREST);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,data.width,data.height,0,gl.RGBA,gl.UNSIGNED_BYTE,i===0?data.values:data.cells);}uploaded=layer;canvas.dataset.textureUploads=String(Number(canvas.dataset.textureUploads??0)+1);}
      gl.useProgram(program);for(let i=0;i<maxAttributes;i++)if(i!==position)gl.disableVertexAttribArray(i);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
      for(let i=0;i<4;i++){bind(i,i===0||i===2?gl.LINEAR:gl.NEAREST);gl.uniform1i(uniforms[['values','cells','palette','land'][i]],i);}
      gl.uniform2f(uniforms.resolution,width,height);gl.uniform2f(uniforms.centre,view.x,view.y);gl.uniform1f(uniforms.radius,view.radius);gl.uniform1f(uniforms.latitude,view.lat*Math.PI/180);gl.uniform1f(uniforms.longitude,view.lon*Math.PI/180);gl.uniform1f(uniforms.pixelRatio,dpr);
      gl.uniform2f(uniforms.shape,layer.cols,layer.rows);gl.uniform2f(uniforms.origin,layer.lon0-layer.dlon/2,layer.lat0-layer.dlat/2);gl.uniform2f(uniforms.pitch,layer.dlon,layer.dlat);gl.uniform1f(uniforms.valueMinimum,minimum);gl.uniform1f(uniforms.valueSpan,span);gl.uniform1f(uniforms.colourLimit,layer.limit);gl.uniform1f(uniforms.smoothDisplay,mode==='smooth'?1:0);gl.uniform1f(uniforms.landOnly,layer.landOnly?1:0);gl.uniform1f(uniforms.worldWrap,layer.domain==='world'?1:0);
      gl.disable(gl.BLEND);gl.drawArrays(gl.TRIANGLES,0,6);
    }else{validCount=0;uploaded=undefined;}
    drawn=layer;lastCamera=camera;return validCount;
  },invalidate(){lastCamera='';},dispose(){textures.forEach(t=>gl.deleteTexture(t));gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);}};
}
