import type { GlobeView } from './globeGeometry';

export interface LandRenderer {
  kind: 'webgl' | 'canvas';
  draw: (view: GlobeView, width: number, height: number, dpr: number) => void;
  dispose: () => void;
}

/** A flat geographic mask, not an observation texture. No lighting or generated data. */
export function createLandRenderer(canvas: HTMLCanvasElement, mask: ImageData, software = false): LandRenderer {
  const gl = software
    ? null
    : canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
  if (gl) {
    const compile = (type: number, source: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error('geography_shader');
      return s;
    };
    const vertex = compile(gl.VERTEX_SHADER, 'attribute vec2 position; void main(){gl_Position=vec4(position,0.0,1.0);}');
    const fragment = compile(
      gl.FRAGMENT_SHADER,
      `precision highp float;
      uniform sampler2D land; uniform vec2 resolution; uniform vec2 centre; uniform float radius; uniform float latitude; uniform float longitude; uniform float pixelRatio;
      void main(){
        vec2 pixel=vec2(gl_FragCoord.x/pixelRatio,resolution.y-gl_FragCoord.y/pixelRatio);
        vec2 p=(pixel-centre)/radius;p.y=-p.y;float rr=dot(p,p);if(rr>1.0)discard;
        float z=sqrt(max(0.0,1.0-rr));float phi=asin(clamp(z*sin(latitude)+p.y*cos(latitude),-1.0,1.0));
        float lambda=longitude+atan(p.x,z*cos(latitude)-p.y*sin(latitude));
        vec2 uv=vec2(fract(lambda/6.28318530718+0.5),0.5-phi/3.14159265359);
        float isLand=smoothstep(0.35,0.65,texture2D(land,uv).a);
        gl_FragColor=vec4(mix(vec3(0.098039,0.156863,0.176471),vec3(0.203922,0.286275,0.294118),isLand),1.0);
      }`,
    );
    const program = gl.createProgram()!;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error('geography_program');
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, mask.width, mask.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, mask.data);
    const uniforms = Object.fromEntries(
      ['resolution', 'centre', 'radius', 'latitude', 'longitude', 'pixelRatio', 'land'].map((n) => [n, gl.getUniformLocation(program, n)]),
    );
    return {
      kind: 'webgl',
      draw(v, width, height, dpr) {
        const w = Math.round(width * dpr),
          h = Math.round(height * dpr);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        gl.viewport(0, 0, w, h);
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        const attr = gl.getAttribLocation(program, 'position');
        gl.enableVertexAttribArray(attr);
        gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(uniforms.land, 0);
        gl.uniform2f(uniforms.resolution, width, height);
        gl.uniform2f(uniforms.centre, v.x, v.y);
        gl.uniform1f(uniforms.radius, v.radius);
        gl.uniform1f(uniforms.latitude, (v.lat * Math.PI) / 180);
        gl.uniform1f(uniforms.longitude, (v.lon * Math.PI) / 180);
        gl.uniform1f(uniforms.pixelRatio, dpr);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      },
      dispose() {
        gl.deleteTexture(texture);
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);
      },
    };
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Error('geography_context');
  // Software fallback samples the visible viewport, not an enlarged whole sphere.
  const scratch = document.createElement('canvas'),
    sctx = scratch.getContext('2d')!;
  return {
    kind: 'canvas',
    draw(v, width, height, dpr) {
      const scale = Math.min(1, 640 / width, 480 / height);
      scratch.width = Math.max(1, Math.round(width * scale));
      scratch.height = Math.max(1, Math.round(height * scale));
      const pixels = sctx.createImageData(scratch.width, scratch.height),
        phi = (v.lat * Math.PI) / 180,
        sin = Math.sin(phi),
        cos = Math.cos(phi);
      for (let y = 0; y < scratch.height; y++)
        for (let x = 0; x < scratch.width; x++) {
          const nx = ((x + 0.5) / scale - v.x) / v.radius,
            ny = (v.y - (y + 0.5) / scale) / v.radius,
            r = nx * nx + ny * ny;
          if (r > 1) continue;
          const z = Math.sqrt(1 - r),
            lat = Math.asin(z * sin + ny * cos),
            lon = (v.lon * Math.PI) / 180 + Math.atan2(nx, z * cos - ny * sin),
            mx = ((Math.floor((((lon * 180) / Math.PI + 180) * mask.width) / 360) % mask.width) + mask.width) % mask.width,
            my = Math.max(0, Math.min(mask.height - 1, Math.floor(((90 - (lat * 180) / Math.PI) * mask.height) / 180))),
            land = mask.data[(my * mask.width + mx) * 4 + 3] > 96,
            i = (y * scratch.width + x) * 4;
          pixels.data[i] = land ? 52 : 25;
          pixels.data[i + 1] = land ? 73 : 40;
          pixels.data[i + 2] = land ? 75 : 45;
          pixels.data[i + 3] = 255;
        }
      sctx.putImageData(pixels, 0, 0);
      const w = Math.round(width * dpr),
        h = Math.round(height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(scratch, 0, 0, width, height);
    },
    dispose() {},
  };
}
