// Snapshot of the shared HDR card renderer; input textures are materialized RGBA layers.
// Lightweight, view-dependent layered card. No 3D engine or video textures.
const vertex = `attribute vec2 position; varying vec2 uv; void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`;
const fragment = `precision highp float;
varying vec2 uv; uniform sampler2D art,bg,uiTex,bloomNear,bloomWide,structureTex; uniform float extracted, cardAspect; uniform vec2 view; uniform float depth, contourBrightness, power, glowPass, pixelWidth;
vec4 encodeHDR(vec3 c){float m=clamp(ceil(max(max(c.r,c.g),c.b)/64.*255.)/255.,1./255.,1.);return vec4(c/(64.*m),m);}
vec3 decodeHDR(vec4 c){return c.rgb*c.a*64.;}
vec3 hsv(vec3 c){vec4 K=vec4(0.,-1./3.,2./3.,-1.);vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));float d=q.x-min(q.w,q.y);return vec3(abs(q.z+(q.w-q.y)/(6.*d+.00001)),d/(q.x+.00001),q.x);}
float ink(vec2 p){vec4 c=texture2D(art,p);vec3 h=hsv(pow(c.rgb,vec3(2.2)));return smoothstep(.035,.065,h.x)*(1.-smoothstep(.17,.21,h.x))*smoothstep(.4,.67,h.y)*smoothstep(.065,.25,h.z)*c.a;}
float structure(vec2 p){if(extracted>.5)return texture2D(structureTex,p).a;float a=ink(p);float b=min(min(ink(p+vec2(.0025,0.)),ink(p-vec2(.0025,0.))),min(ink(p+vec2(0.,.0018)),ink(p-vec2(0.,.0018))));return smoothstep(.025,.22,max(0.,a-b));}
vec3 rainbow(float t){return .52+.48*cos(6.28318*(t+vec3(0.,.33,.67)));}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float band(vec2 p){float f=p.x*.65+p.y*.4+view.x*1.9+view.y*.85;return pow(max(0.,1.-abs(fract(f+.16)-.5)*2.),3.);}
void main(){
 vec2 p=uv;vec2 a=(p-.5)*1.25+.5+view*.40;vec2 b=(p-.5)*.5+.5-view*.25;
 if(extracted>.5){a=p-view*.06*depth;b=(p-.5)*.5+.5-view*.25;}
 vec4 ch=texture2D(art,a);ch.a*=step(0.,a.x)*step(a.x,1.)*step(0.,a.y)*step(a.y,1.);
 vec4 background=texture2D(bg,b);background.a*=step(0.,b.x)*step(b.x,1.)*step(0.,b.y)*step(b.y,1.);
 vec3 base=mix(mix(vec3(.055,.065,.085),background.rgb,background.a),ch.rgb,ch.a);
 vec3 ui=texture2D(uiTex,p).rgb;vec3 uh=hsv(ui);float um=max(smoothstep(.105,.23,uh.y),1.-smoothstep(.35,.62,uh.z));
 if(extracted>.5)um=texture2D(uiTex,p).a;
 float phase=p.x*.62+p.y*.36+view.x*1.9+view.y*.8;
 vec3 spectrum=rainbow(phase*2.2);float light=band(p);
 float micro=pow(hash(floor(p*vec2(620.,868.))),28.);
 base=mix(base,base*(.64+spectrum*.7)+spectrum*.07,light*.48*power);
 float line=structure(a)*ch.a;
 float envelope=smoothstep(.025,.42,light);
 vec3 emission=(spectrum*.85+vec3(.15))*line*envelope*power*40.*contourBrightness;
 vec2 cell=fract(p*vec2(24.,34.))-.5;float seed=hash(floor(p*vec2(24.,34.)));float star=pow(max(0.,1.-abs(cell.x)*18.),14.)*pow(max(0.,1.-abs(cell.y)*2.),6.)+pow(max(0.,1.-abs(cell.y)*18.),14.)*pow(max(0.,1.-abs(cell.x)*2.),6.);
 base+=spectrum*(star*step(.965,seed)*light*.65+micro*light*.12)*power*(1.-ch.a);
 base=mix(base,ui,um);
 float glare=pow(max(0.,1.-length((p-vec2(.5+view.x,.6+view.y))*vec2(1.,.75))),5.);
 base+=vec3(glare*.12*power);
 // Concentric rounded border in card-width units, matching the CSS outer radius.
 // Outer radius .045, uniform inset .015, inner radius .030.
 vec2 corner=abs((p-.5)*vec2(1.,cardAspect))-(vec2(.485,cardAspect*.5-.015)-vec2(.030));
 float distanceToInner=length(max(corner,0.))+min(max(corner.x,corner.y),0.)-.030;
 float inside=1.-smoothstep(-pixelWidth,pixelWidth,distanceToInner);
 float rim=(1.-inside)*(1.-extracted);
 base=mix(base,mix(vec3(.76,.67,.32),spectrum*.5+.5,.35*power)+glare*.15,rim);
 emission*=(1.-um)*inside;
 if(glowPass>.5){gl_FragColor=encodeHDR(max(emission-vec3(1.),vec3(0.)));return;}
 vec3 bloom=decodeHDR(texture2D(bloomNear,p))*.55+decodeHDR(texture2D(bloomWide,p))*.8;
 bloom*=inside*(1.-um)*line;
 // Display mapping is applied AFTER the HDR light and two-scale bloom are composed.
 vec3 linear=pow(clamp(base,0.,1.),vec3(2.2));
 vec3 combined=1.-(1.-linear)*exp(-(emission*.38+bloom*.85));
 gl_FragColor=vec4(pow(clamp(combined,0.,1.),vec3(1./2.2)),1.);
}`;
const blurFragment = `precision highp float; varying vec2 uv;uniform sampler2D source;uniform vec2 stepSize;
vec3 decodeHDR(vec4 c){return c.rgb*c.a*64.;}
vec4 encodeHDR(vec3 c){float m=clamp(ceil(max(max(c.r,c.g),c.b)/64.*255.)/255.,1./255.,1.);return vec4(c/(64.*m),m);}
void main(){vec3 c=vec3(0.);float total=0.;for(int i=-4;i<=4;i++){float f=float(i);float w=exp(-f*f/8.);c+=decodeHDR(texture2D(source,uv+stepSize*f))*w;total+=w;}gl_FragColor=encodeHDR(c/total);}`;
export async function createCardRenderer(canvas, assets) {
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error('WebGL unavailable');
  const shaders = [],
    programs = [],
    textures = [],
    frames = [];
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader) || 'Shader error');
    shaders.push(shader);
    return shader;
  }
  function program(source) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, source));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error('Shader link error');
    programs.push(p);
    return p;
  }
  const scene = program(fragment),
    blur = program(blurFragment);
  function use(p) {
    gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const a = gl.getAttribLocation(p, 'position');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  }
  function texture(filter) {
    const t = gl.createTexture();
    textures.push(t);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  const images = await Promise.all(
    ['character', 'background', 'ui', 'structure'].map(
      (name) =>
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error('Asset unavailable'));
          image.src = assets[name];
        }),
    ),
  );
  const artTextures = images.map((image) => {
    const t = texture(gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    return t;
  });
  // Full-resolution artwork and line core; bloom only is computed at half/quarter resolution.
  canvas.width = window.innerWidth < 640 ? 648 : 880;
  canvas.height = Math.round(
    canvas.width * (assets ? images[0].height / images[0].width : 1.4),
  );
  function target(scale) {
    const w = Math.round(canvas.width * scale),
      h = Math.round(canvas.height * scale);
    const t = texture(gl.NEAREST);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      w,
      h,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    const f = gl.createFramebuffer();
    frames.push(f);
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      t,
      0,
    );
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      throw new Error('Bloom framebuffer unavailable');
    return { t, f, w, h };
  }
  const emission = target(0.5),
    temp = target(0.5),
    near = target(0.5),
    wideTemp = target(0.25),
    wide = target(0.25);
  const sceneU = {
    view: gl.getUniformLocation(scene, 'view'),
    power: gl.getUniformLocation(scene, 'power'),
    depth: gl.getUniformLocation(scene, 'depth'),
    contourBrightness: gl.getUniformLocation(scene, 'contourBrightness'),
    pass: gl.getUniformLocation(scene, 'glowPass'),
  };
  use(scene);
  gl.uniform1f(
    gl.getUniformLocation(scene, 'cardAspect'),
    canvas.height / canvas.width,
  );
  gl.uniform1f(gl.getUniformLocation(scene, 'extracted'), assets ? 1 : 0);
  gl.uniform1i(gl.getUniformLocation(scene, 'structureTex'), 5);
  gl.uniform1f(gl.getUniformLocation(scene, 'pixelWidth'), 1 / canvas.width);
  ['art', 'bg', 'uiTex', 'bloomNear', 'bloomWide'].forEach((name, i) =>
    gl.uniform1i(gl.getUniformLocation(scene, name), i),
  );
  use(blur);
  gl.uniform1i(gl.getUniformLocation(blur, 'source'), 0);
  const step = gl.getUniformLocation(blur, 'stepSize');
  function bind(t, unit = 0) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
  }
  function blurPass(src, dst, x, y) {
    use(blur);
    bind(src.t);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.f);
    gl.viewport(0, 0, dst.w, dst.h);
    gl.uniform2f(step, x / src.w, y / src.h);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  return {
    draw(x, y, strength, depth = 0, contourBrightness = 0.15) {
      use(scene);
      artTextures.forEach((t, i) => bind(t, i === 3 ? 5 : i));
      bind(near.t, 3);
      bind(wide.t, 4);
      gl.uniform2f(
        sceneU.view,
        Math.sin((y * Math.PI) / 180) * 0.65,
        Math.sin((x * Math.PI) / 180) * 0.65,
      );
      gl.uniform1f(sceneU.power, strength);
      gl.uniform1f(sceneU.depth, depth);
      gl.uniform1f(sceneU.contourBrightness, contourBrightness);
      gl.uniform1f(sceneU.pass, 1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, emission.f);
      gl.viewport(0, 0, emission.w, emission.h);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      blurPass(emission, temp, 1.2, 0);
      blurPass(temp, near, 0, 1.2);
      blurPass(near, wideTemp, 5, 0);
      blurPass(wideTemp, wide, 0, 2.5);
      use(scene);
      artTextures.forEach((t, i) => bind(t, i === 3 ? 5 : i));
      bind(near.t, 3);
      bind(wide.t, 4);
      gl.uniform1f(sceneU.pass, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    dispose() {
      frames.forEach((f) => gl.deleteFramebuffer(f));
      textures.forEach((t) => gl.deleteTexture(t));
      shaders.forEach((s) => gl.deleteShader(s));
      programs.forEach((p) => gl.deleteProgram(p));
      gl.deleteBuffer(buffer);
    },
  };
}
