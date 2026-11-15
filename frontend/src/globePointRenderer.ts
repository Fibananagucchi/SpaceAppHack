import type { GlobeLayer, GlobeView } from './globeGeometry';
import type { VisibleProjection } from './globeLod';

export interface PointRenderer {
  draw: (
    projection: VisibleProjection | undefined,
    layer: GlobeLayer | undefined,
    colours: number[] | undefined,
    view: GlobeView,
    width: number,
    height: number,
    dpr: number,
  ) => number;
  invalidate: () => void;
  dispose: () => void;
}

/** One GPU submission of the same visible real centres, below the coastline canvas. */
export function createPointRenderer(canvas: HTMLCanvasElement, palette: number[][]): PointRenderer | undefined {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true });
  if (!gl) return;
  if ((gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array)[1] < 72) return;
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error('point_shader');
    return shader;
  };
  const vertex = compile(
    gl.VERTEX_SHADER,
    `precision highp float;
    attribute vec3 position;attribute vec3 colour;attribute float significant;
    uniform vec2 resolution;uniform float pixelRatio;
    varying vec3 dataColour;varying float fdr;varying float pointRadius;varying float dataLuminance;
    void main(){gl_Position=vec4(position.x/resolution.x*2.0-1.0,1.0-position.y/resolution.y*2.0,0.0,1.0);gl_PointSize=position.z*2.0*pixelRatio;dataColour=colour;fdr=significant;pointRadius=position.z*pixelRatio;dataLuminance=dot(pow((colour+vec3(0.055))/1.055,vec3(2.4)),vec3(0.2126,0.7152,0.0722));}`,
  );
  const fragment = compile(
    gl.FRAGMENT_SHADER,
    `precision highp float;
    uniform vec2 resolution;uniform vec2 centre;uniform float radius;uniform float pixelRatio;
    varying vec3 dataColour;varying float fdr;varying float pointRadius;varying float dataLuminance;
    void main(){
      vec2 pixel=vec2(gl_FragCoord.x/pixelRatio,resolution.y-gl_FragCoord.y/pixelRatio);
      if(distance(pixel,centre)>radius)discard;
      float d=length(gl_PointCoord*2.0-1.0);if(d>1.0)discard;
      float edge=1.0/max(pointRadius,1.0);float alpha=1.0-smoothstep(1.0-edge,1.0,d);
      vec3 colour=dataColour;
      if(dataLuminance<0.281&&d>1.0-edge*pixelRatio*0.65)colour=vec3(0.690196,0.764706,0.698039);
      if(fdr>0.5&&pointRadius>=1.5*pixelRatio&&d<clamp(pointRadius*0.2,0.65*pixelRatio,1.4*pixelRatio)/max(pointRadius,1.0))colour=dataLuminance<0.179?vec3(0.894118,0.913725,0.898039):vec3(0.08235,0.11765,0.13333);
      gl_FragColor=vec4(colour*alpha,alpha);
    }`,
  );
  const program = gl.createProgram()!;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error('point_program');
  const buffer = gl.createBuffer()!,
    attributes = ['position', 'colour', 'significant'].map((k) => gl.getAttribLocation(program, k));
  const uniforms = Object.fromEntries(['resolution', 'centre', 'radius', 'pixelRatio'].map((k) => [k, gl.getUniformLocation(program, k)]));
  let lastProjection: VisibleProjection | undefined,
    lastLayer: GlobeLayer | undefined,
    count = 0,
    payload = new Float32Array(0),
    initialized = false;
  return {
    draw(projection, layer, colours, view, width, height, dpr) {
      const w = Math.round(width * dpr),
        h = Math.round(height * dpr),
        resized = canvas.width !== w || canvas.height !== h;
      if (initialized && !resized && lastProjection === projection && lastLayer === layer) return count;
      if (resized) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      count = 0;
      if (layer && projection && colours) {
        const capacity = projection.count * 7;
        if (payload.length < capacity) payload = new Float32Array(capacity);
        for (let j = 0; j < projection.count; j++) {
          const i = projection.indices[j];
          if (layer.values[i] === null) continue;
          const offset = count * 7,
            rgb = palette[colours[i]];
          payload[offset] = projection.xy[j * 4];
          payload[offset + 1] = projection.xy[j * 4 + 1];
          payload[offset + 2] = projection.xy[j * 4 + 3];
          payload[offset + 3] = rgb[0] / 255;
          payload[offset + 4] = rgb[1] / 255;
          payload[offset + 5] = rgb[2] / 255;
          payload[offset + 6] = layer.significant?.[i] ? 1 : 0;
          count++;
        }
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, payload.subarray(0, count * 7), gl.DYNAMIC_DRAW);
        for (let i = 0; i < 3; i++) {
          gl.enableVertexAttribArray(attributes[i]);
          gl.vertexAttribPointer(attributes[i], i === 2 ? 1 : 3, gl.FLOAT, false, 28, i === 0 ? 0 : i === 1 ? 12 : 24);
        }
        gl.uniform2f(uniforms.resolution, width, height);
        gl.uniform2f(uniforms.centre, view.x, view.y);
        gl.uniform1f(uniforms.radius, view.radius);
        gl.uniform1f(uniforms.pixelRatio, dpr);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.POINTS, 0, count);
      }
      lastProjection = projection;
      lastLayer = layer;
      initialized = true;
      return count;
    },
    invalidate() {
      initialized = false;
    },
    dispose() {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    },
  };
}
