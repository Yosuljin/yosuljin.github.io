// La constellation du parc : la carte du dossier Aether en WebGL (FULL 3D seulement ; la carte SVG reste le repli).
// Chaque projet est un astre coloré par famille, chaque relation documentée un filament de lumière parcouru
// de particules ; TheHive est une coque alvéolée où brûle Lumina. Les étiquettes vivent dans la page (HTML) :
// ce module leur rend, à chaque image, la projection de chaque astre. Il ne touche jamais au DOM.
import { mat4, vec3, rng } from "./gl.js?v=20261008-r9";

const TAU = Math.PI * 2;
const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
export const FAMILY = { noyau: hex("#ffd36b"), code: hex("#36e2ff"), vision: hex("#8c6bff"), outil: hex("#6dffb0") };
const ACCENT = hex("#ff5fa2");

// Position (x, y, z) et rayon de chaque astre. La vue de face reprend la disposition de la carte SVG
// (reminiscence en haut, Greffe en bas, Linh à droite…), la profondeur sépare les familles.
const LAYOUT = {
  thehive: [0, 0, 0, 1.3], lumina: [0, 0, 0, 0.44],
  reminiscence: [0.15, 2.85, -1.25, 0.24], "la-lumina": [-2.6, 1.6, 1.3, 0.31], furu: [2.65, 1.7, -1.15, 0.27],
  memoria: [-3.7, -0.3, -1.9, 0.28], linh: [3.6, -0.25, 1.55, 0.3], almas: [-2.15, -2.5, 1.75, 0.26],
  greffe: [0.3, -2.95, 0.55, 0.28], lucarne: [-4.2, -3.3, -0.65, 0.22], net: [4.5, -2.65, -1.25, 0.21],
  linhmesh: [5.0, 0.95, 2.6, 0.19], temoin: [2.0, -4.3, -2.3, 0.18], ardupilot: [-0.95, -4.45, 2.7, 0.19],
  constellation: [-4.75, 2.85, -3.6, 0.21], reseau: [-5.0, 1.05, 3.1, 0.18], libera: [4.8, 2.7, -3.3, 0.18],
  "rose-almaf": [-5.85, -2.05, 1.95, 0.17]
};
const SHELL = { noyau: 2.9, code: 4.5, outil: 4.9, vision: 6.1 };
// Taille du quad de chaque genre d'astre, en rayons : de quoi contenir couronne, aigrettes et anneaux.
const QUAD = { star: 5.5, future: 2.6, vision: 2.6, core: 3.4, hive: 1.18 };
const KIND = { star: 0, future: 1, vision: 2, core: 3, hive: 4 };

// Paliers de qualité : résolution relative (sous le plafond DPR 1,5), part des poussières et des particules, passes de halo.
const LEVELS = [
  { scale: 0.5, dust: 0.35, motes: 0.5, bloom: 1, streak: false, neb: 6 },
  { scale: 0.66, dust: 0.55, motes: 0.7, bloom: 1, streak: true, neb: 5 },
  { scale: 0.82, dust: 0.8, motes: 0.9, bloom: 2, streak: true, neb: 4 },
  { scale: 1, dust: 1, motes: 1, bloom: 2, streak: true, neb: 4 }
];
const MAX_PIXELS = 2.6e6;

// ---------- GLSL (ES 1.0) ----------
const FP = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;
const NOISE = `
float hash(vec3 p){p=fract(p*.3183099+.11);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.03+vec3(1.7,9.2,3.1);a*=.5;}return v;}
`;
// The scene target is 8-bit: every scene shader writes half its colour so values up to 2 survive (×2 in COMPOSE).
const SCREEN_VS = `attribute vec2 aCorner;varying vec2 vUv;void main(){vUv=aCorner*.5+.5;gl_Position=vec4(aCorner,0.,1.);}`;

const NEB_FS = FP + NOISE + `
varying vec2 vUv;
uniform vec3 uF,uR,uU;uniform vec2 uTan,uShift;uniform float uTime;
void main(){
  vec2 ndc=vUv*2.-1.;
  vec3 d=normalize(uF+(ndc.x+uShift.x)*uTan.x*uR+(ndc.y+uShift.y)*uTan.y*uU);
  float t=uTime*.004;
  vec3 q=d*1.6+vec3(t,-t*.5,t*.7);
  float n1=fbm(q);
  float n2=fbm(q*2.1+n1*1.7+vec3(4.1,1.7,9.2));
  float n3=noise(q*6.3+n2*2.2);
  float lat=dot(d,vec3(.27,.93,-.25));
  float band=exp(-lat*lat*6.);
  vec3 col=mix(vec3(.010,.012,.042),vec3(.018,.03,.10),band*.6+.4*smoothstep(.2,-.6,d.y));
  float cloud=smoothstep(.3,.8,n1);
  col+=vec3(.19,.065,.44)*cloud*(.45+.75*band);
  float emis=smoothstep(.46,.9,n2);
  col+=vec3(.62,.05,.36)*emis*emis*(.3+.95*band);
  col+=vec3(1.,.37,.64)*pow(smoothstep(.5,1.,n2*(.55+n3*.8)),3.)*.6*(.3+band);
  col+=vec3(.05,.24,.6)*smoothstep(.52,.92,n3)*cloud*.45;
  float lanes=smoothstep(.45,.72,fbm(q*4.7+vec3(2.,7.,1.)));
  col*=1.-lanes*band*.62;
  gl_FragColor=vec4(col,1.);
}`;

const DUST_VS = `
attribute vec3 aPos;attribute vec4 aInfo;
uniform mat4 uVP;uniform float uPx,uTime,uPersp,uAlpha;
varying vec3 vCol;varying float vB;
vec3 tint(float h){
  vec3 c=mix(vec3(.62,.55,1.),vec3(.78,.86,1.),smoothstep(0.,.3,h));
  c=mix(c,vec3(1.,.6,.8),smoothstep(.6,.8,h));
  return mix(c,vec3(.5,.92,1.),smoothstep(.88,1.,h));
}
void main(){
  vec4 c=uVP*vec4(aPos,1.);
  gl_Position=c;
  float w=max(c.w,.3);
  gl_PointSize=clamp(mix(aInfo.x,aInfo.x*22./w,uPersp)*uPx,1.,26.*uPx);
  float tw=.7+.3*sin(uTime*(.5+aInfo.w*2.3)+aInfo.w*41.);
  vB=aInfo.y*tw*uAlpha*smoothstep(.4,1.6,c.w);
  vCol=tint(aInfo.z);
}`;
const DUST_FS = FP + `
varying vec3 vCol;varying float vB;
void main(){vec2 c=gl_PointCoord-.5;float r2=dot(c,c);float a=(exp(-r2*30.)+exp(-r2*9.)*.25)*vB;if(a<.003)discard;gl_FragColor=vec4(vCol*a*.5,0.);}`;

// Relation filaments: a quadratic Bézier swept as a camera-facing ribbon of constant screen width.
const LINK_VS = `
attribute vec2 aTS;
uniform mat4 uVP;uniform vec3 uA,uB,uC;uniform vec2 uRange;uniform float uAspect,uWidth;
varying float vT,vS,vFade;
vec3 bez(float t){float u=1.-t;return u*u*uA+2.*u*t*uC+t*t*uB;}
void main(){
  float t=mix(uRange.x,uRange.y,aTS.x);
  vec3 p=bez(t),dp=2.*(1.-t)*(uC-uA)+2.*t*(uB-uC);
  vec4 c0=uVP*vec4(p,1.),c1=uVP*vec4(p+dp*.02,1.);
  float w0=max(c0.w,.05),w1=max(c1.w,.05);
  vec2 dir=(c1.xy/w1-c0.xy/w0)*vec2(uAspect,1.);
  dir=dir/max(length(dir),1e-5);
  vec2 n=vec2(-dir.y,dir.x)/vec2(uAspect,1.);
  c0.xy+=n*uWidth*aTS.y*w0*mix(1.,clamp(11./w0,.6,1.8),.6);
  gl_Position=c0;
  vT=aTS.x;vS=aTS.y;vFade=smoothstep(.35,1.4,c0.w);
}`;
const LINK_FS = FP + `
varying float vT,vS,vFade;
uniform vec3 uColA,uColB;uniform float uGlow,uTime,uType,uSpeed,uSeed;
void main(){
  float core=exp(-vS*vS*9.),halo=exp(-vS*vS*2.2)*.42;
  float pat=1.;
  if(uType>1.5){float f=fract(vT*30.-uTime*.4);pat=smoothstep(.34,.12,abs(f-.5))*1.6;}
  else if(uType>.5){float f=fract(vT*13.-uTime*.3);pat=smoothstep(0.,.05,f)*smoothstep(.62,.55,f);}
  float ph=fract(vT-uTime*uSpeed+uSeed);
  float pulse=exp(-pow((ph-.5)*8.,2.));
  float ends=smoothstep(0.,.08,vT)*smoothstep(1.,.92,vT);
  vec3 col=mix(uColA,uColB,smoothstep(.1,.9,vT));
  float a=(core*(.5*pat+1.1*pulse)+halo*(.35*pat+.8*pulse))*uGlow*ends*vFade;
  gl_FragColor=vec4(mix(col,vec3(1.),core*pulse*.35)*a*.5,0.);
}`;

// TheHive: the edges of a Goldberg polyhedron (honeycomb shell), expanded in screen space.
const HIVE_VS = `
attribute vec3 aP0,aP1;attribute vec2 aES;
uniform mat4 uVP,uModel;uniform vec3 uEye,uCenter;uniform float uAspect,uWidth;
varying float vS,vFace,vWave;
void main(){
  vec3 w0=(uModel*vec4(aP0,1.)).xyz,w1=(uModel*vec4(aP1,1.)).xyz;
  vec3 p=mix(w0,w1,aES.x),o=mix(w1,w0,aES.x);
  vec4 c=uVP*vec4(p,1.),co=uVP*vec4(o,1.);
  float w=max(c.w,.05),wo=max(co.w,.05);
  vec2 dir=(co.xy/wo-c.xy/w)*vec2(uAspect,1.)*(aES.x>.5?-1.:1.);
  dir=dir/max(length(dir),1e-5);
  vec2 n=vec2(-dir.y,dir.x)/vec2(uAspect,1.);
  c.xy+=n*uWidth*aES.y*w;
  gl_Position=c;
  vS=aES.y;
  vFace=dot(normalize(p-uCenter),normalize(uEye-p));
  vWave=dot(normalize(aP0+aP1),vec3(.36,.85,.38));
}`;
const HIVE_FS = FP + `
varying float vS,vFace,vWave;
uniform vec3 uColor;uniform float uTime,uGlow;
void main(){
  float prof=exp(-vS*vS*4.5);
  float front=smoothstep(-.3,.55,vFace);
  float w=fract(vWave*.9-uTime*.07);
  float wave=exp(-pow((w-.5)*7.,2.));
  vec3 col=mix(uColor*.3,mix(uColor,vec3(1.,.96,.86),.5),front)*(.5+1.5*wave);
  float a=prof*(.3+.7*front)*uGlow;
  gl_FragColor=vec4(col*a*.5,0.);
}`;

// Stars are camera-facing quads; the sphere is ray-traced in the fragment shader (impostor).
const STAR_VS = `
attribute vec2 aCorner;
uniform mat4 uView,uProj;uniform vec3 uCenter;uniform float uSize;
varying vec2 vUv;
void main(){vUv=aCorner;vec4 c=uView*vec4(uCenter,1.);c.xy+=aCorner*uSize;gl_Position=uProj*c;}`;
const STAR_FS = FP + NOISE + `
varying vec2 vUv;
uniform vec3 uColor,uHot;uniform float uS,uKind,uTime,uSeed,uGlow,uSpin;
vec2 rot(vec2 p,float a){float c=cos(a),s=sin(a);return vec2(c*p.x-s*p.y,s*p.x+c*p.y);}
void main(){
  vec2 p=vUv*uS;float r=length(p);
  vec3 col=vec3(0.);
  float o=max(r-1.,0.);
  if(uKind<.5){
    if(r<1.){
      vec3 n=vec3(p,sqrt(1.-r*r));
      vec2 xz=rot(n.xz,uTime*.13+uSeed);
      float g=fbm(vec3(xz.x,n.y,xz.y)*3.3+uSeed*3.1);
      float mu=n.z;
      vec3 surf=mix(uColor,uHot,smoothstep(.38,.78,g)*.8);
      surf*=.42+.8*pow(mu,.6);
      surf+=uColor*pow(1.-mu,2.4)*.9;
      col+=surf*smoothstep(1.,.955,r)*1.5;
    }
    col+=uColor*(exp(-o*5.)*.8+exp(-o*1.15)*.15)*smoothstep(.72,1.,r);
    vec2 sp=rot(p,uSpin);
    float sx=abs(sp.x),sy=abs(sp.y);
    float spikes=exp(-sx*13.)*exp(-sy*.7)+exp(-sy*13.)*exp(-sx*.7);
    vec2 dg=vec2(sp.x+sp.y,sp.x-sp.y)*.7071;
    spikes+=(exp(-abs(dg.x)*13.)*exp(-abs(dg.y)*1.5)+exp(-abs(dg.y)*13.)*exp(-abs(dg.x)*1.5))*.3;
    col+=mix(uColor,vec3(1.),.45)*spikes*.38*smoothstep(.85,1.5,r);
  }else if(uKind<1.5){
    float flick=.82+.18*sin(uTime*2.3+uSeed*7.)*sin(uTime*.7+uSeed);
    float core=exp(-r*r*2.6);
    col+=mix(uColor,uHot,core)*core*1.25*flick;
    col+=uColor*exp(-r*1.1)*.16;
    float ring=exp(-pow((r-1.75)*10.,2.));
    float ang=atan(p.y,p.x);
    float dash=smoothstep(.42,.5,fract(ang/6.2831853*24.-uTime*.04))*smoothstep(.98,.9,fract(ang/6.2831853*24.-uTime*.04));
    col+=uColor*ring*dash*.6;
  }else if(uKind<2.5){
    float n=fbm(vec3(p*1.5,uTime*.08+uSeed));
    col+=uColor*exp(-r*r*.95)*(.5+.7*n)*.8+vec3(.92,.88,1.)*exp(-r*r*16.)*.6;
    float ring=exp(-pow((r-1.95)*11.,2.));
    float ang=atan(p.y,p.x);
    col+=uColor*ring*smoothstep(.32,.0,abs(fract(ang/6.2831853*36.+uTime*.03)-.5))*.55;
  }else if(uKind<3.5){
    float beat=.86+.1*sin(uTime*1.9)+.06*sin(uTime*5.3+1.);
    if(r<1.){
      vec3 n=vec3(p,sqrt(1.-r*r));
      float g=fbm(n*4.6+vec3(uTime*.17,-uTime*.11,uTime*.07));
      float g2=fbm(n*9.5-vec3(uTime*.29));
      vec3 surf=mix(vec3(1.,.6,.24),vec3(1.,.97,.9),smoothstep(.32,.74,g*.72+g2*.38));
      surf=mix(surf,vec3(1.,.42,.62),pow(1.-n.z,2.2)*.55);
      col+=surf*smoothstep(1.,.95,r)*2.3*beat;
    }
    float ang=atan(p.y,p.x);
    float flare=fbm(vec3(cos(ang)*2.2,sin(ang)*2.2,o*1.8-uTime*.35+uSeed));
    col+=mix(uHot,vec3(1.,.4,.62),smoothstep(0.,1.1,o))*(exp(-o*3.)*(.75+flare)+exp(-o*.65)*.2)*smoothstep(.8,1.02,r)*beat;
  }else{
    if(r<1.){
      vec3 n=vec3(p,sqrt(1.-r*r));
      float rim=pow(1.-n.z,3.);
      col+=uColor*(rim*.85+.035)+vec3(1.,.9,.72)*pow(1.-n.z,9.)*.7;
    }
    col+=uColor*exp(-o*8.)*.4*smoothstep(.97,1.,r);
  }
  gl_FragColor=vec4(col*uGlow*.5,0.);
}`;

// Accretion discs: furu and reminiscence are specified, not built yet — light still gathering.
const DISC_VS = `
attribute vec2 aAR;uniform mat4 uVP,uModel;varying vec2 vAR;
void main(){float rr=mix(1.3,3.,aAR.y);gl_Position=uVP*uModel*vec4(cos(aAR.x)*rr,0.,sin(aAR.x)*rr,1.);vAR=vec2(aAR.x,rr);}`;
const DISC_FS = FP + `
varying vec2 vAR;uniform vec3 uColor;uniform float uTime,uGlow;
void main(){
  float rr=vAR.y,a=vAR.x;
  float arms=.5+.5*sin(a*3.-log(rr)*9.+uTime*1.3);
  float fine=.6+.4*sin(a*23.+rr*11.-uTime*2.6);
  float dens=smoothstep(1.3,1.65,rr)*smoothstep(3.,2.,rr);
  vec3 col=mix(vec3(1.,.95,.8),uColor,smoothstep(1.4,2.5,rr))*dens*(.22+.78*arms*fine)*.6*uGlow;
  gl_FragColor=vec4(col*.5,0.);
}`;

// Particles riding the filaments, from the first project of a relation towards the second.
const PART_VS = `
attribute vec3 aA,aB,aC,aColA,aColB;attribute vec4 aInfo;
uniform mat4 uVP;uniform float uTime,uPx;uniform float uLinkGlow[32];
varying vec3 vCol;varying float vA;
void main(){
  float t=fract(aInfo.x+uTime*aInfo.y);
  float u=1.-t;
  vec3 p=u*u*aA+2.*u*t*aC+t*t*aB;
  vec4 c=uVP*vec4(p,1.);
  gl_Position=c;
  float g=uLinkGlow[int(aInfo.w)];
  gl_PointSize=clamp(aInfo.z*uPx*(.8+g*.5)*14./max(c.w,.4),1.,18.*uPx);
  vA=sin(t*3.14159)*(.3+.7*g)*smoothstep(.35,1.2,c.w);
  vCol=mix(aColA,aColB,t);
}`;
const PART_FS = FP + `
varying vec3 vCol;varying float vA;
void main(){vec2 c=gl_PointCoord-.5;float r2=dot(c,c);float a=(exp(-r2*26.)*1.4+exp(-r2*7.)*.3)*vA;if(a<.003)discard;gl_FragColor=vec4(mix(vCol,vec3(1.),exp(-r2*60.)*.6)*a*.5,0.);}`;

// Halo: threshold + 4× downsample, separable gaussian, anamorphic streak, then the final composition.
const DOWN_FS = FP + `
varying vec2 vUv;uniform sampler2D uTex;uniform vec2 uTexel;uniform float uThresh;
void main(){
  vec3 c=texture2D(uTex,vUv+uTexel*vec2(-1.,-1.)).rgb+texture2D(uTex,vUv+uTexel*vec2(1.,-1.)).rgb
        +texture2D(uTex,vUv+uTexel*vec2(-1.,1.)).rgb+texture2D(uTex,vUv+uTexel*vec2(1.,1.)).rgb;
  c*=.25;
  float l=max(c.r,max(c.g,c.b));
  gl_FragColor=vec4(c*smoothstep(uThresh,uThresh+.22,l),1.);
}`;
const BLUR_FS = FP + `
varying vec2 vUv;uniform sampler2D uTex;uniform vec2 uDir;
void main(){
  vec3 c=texture2D(uTex,vUv).rgb*.2270270270;
  c+=(texture2D(uTex,vUv+uDir*1.3846153846).rgb+texture2D(uTex,vUv-uDir*1.3846153846).rgb)*.3162162162;
  c+=(texture2D(uTex,vUv+uDir*3.2307692308).rgb+texture2D(uTex,vUv-uDir*3.2307692308).rgb)*.0702702703;
  gl_FragColor=vec4(c,1.);
}`;
const STREAK_FS = FP + `
varying vec2 vUv;uniform sampler2D uTex;uniform vec2 uTexel;
void main(){
  vec3 c=vec3(0.);float s=0.;
  for(int i=-8;i<=8;i++){float f=float(i);float w=exp(-abs(f)*.22);c+=max(texture2D(uTex,vUv+vec2(f*uTexel.x*2.5,0.)).rgb-.18,0.)*w;s+=w;}
  gl_FragColor=vec4(c/s*2.2,1.);
}`;
const COMPOSE_FS = FP + `
varying vec2 vUv;
uniform sampler2D uScene,uB1,uB2,uStreak,uNeb;
uniform vec2 uRes;uniform float uTime,uAb,uScrim,uBloom,uStreakAmt,uFadeTop,uFadeBot,uIntro,uUseB2,uUseStreak;
float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
void main(){
  vec2 uv=vUv,d=uv-.5;
  vec2 off=d*uAb*(.45+2.4*dot(d,d));
  vec3 sc=vec3(texture2D(uScene,uv+off).r,texture2D(uScene,uv).g,texture2D(uScene,uv-off).b)*2.;
  vec3 bl=vec3(texture2D(uB1,uv+off*2.).r,texture2D(uB1,uv).g,texture2D(uB1,uv-off*2.).b)*1.25;
  if(uUseB2>.5)bl+=texture2D(uB2,uv).rgb*1.7;
  vec3 col=texture2D(uNeb,uv).rgb+sc+bl*uBloom*2.;
  if(uUseStreak>.5)col+=texture2D(uStreak,uv).rgb*vec3(.55,.72,1.)*uStreakAmt*2.;
  col=vec3(1.)-exp(-col*1.2);
  col*=mix(.55,1.,smoothstep(1.3,.4,length(d*vec2(1.15,1.))));
  if(uScrim>0.)col*=mix(.2,1.,smoothstep(uScrim-.24,uScrim+.04,uv.x));
  float a=smoothstep(0.,uFadeTop,1.-uv.y)*smoothstep(0.,uFadeBot,uv.y)*uIntro;
  col+=(h(gl_FragCoord.xy+fract(uTime*7.)*91.)-.5)*(2.5/255.);
  gl_FragColor=vec4(max(col,0.)*a,a);
}`;

const PROGRAMS = {
  neb: [SCREEN_VS, NEB_FS], dust: [DUST_VS, DUST_FS], link: [LINK_VS, LINK_FS], hive: [HIVE_VS, HIVE_FS],
  star: [STAR_VS, STAR_FS], disc: [DISC_VS, DISC_FS], part: [PART_VS, PART_FS],
  down: [SCREEN_VS, DOWN_FS], blur: [SCREEN_VS, BLUR_FS], streak: [SCREEN_VS, STREAK_FS], compose: [SCREEN_VS, COMPOSE_FS]
};

const nextTask = () => new Promise(r => setTimeout(r, 0));
const later = ms => new Promise(r => setTimeout(r, ms));

/** Compiles every program without one long task: in parallel when the driver allows it, else one per task. */
async function compileAll(gl, sources, alive) {
  const par = gl.getExtension("KHR_parallel_shader_compile");
  const make = ([vs, fs]) => {
    const p = gl.createProgram(), s = [];
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); gl.attachShader(p, sh); s.push(sh);
    }
    gl.linkProgram(p);
    return { p, s };
  };
  const finish = prog => {
    if (!gl.getProgramParameter(prog.p, gl.LINK_STATUS)) {
      const log = prog.s.map(sh => gl.getShaderInfoLog(sh)).join(" ") + " " + gl.getProgramInfoLog(prog.p);
      throw new Error("parc: shader " + log.trim().slice(0, 400));
    }
    const u = {}, a = {};
    for (let i = 0, n = gl.getProgramParameter(prog.p, gl.ACTIVE_UNIFORMS); i < n; i++) { const info = gl.getActiveUniform(prog.p, i); u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(prog.p, info.name); }
    for (let i = 0, n = gl.getProgramParameter(prog.p, gl.ACTIVE_ATTRIBUTES); i < n; i++) { const info = gl.getActiveAttrib(prog.p, i); a[info.name] = gl.getAttribLocation(prog.p, info.name); }
    prog.s.forEach(sh => { gl.detachShader(prog.p, sh); gl.deleteShader(sh); });
    return { p: prog.p, u, a };
  };
  const out = {};
  if (par) {
    const pending = Object.entries(sources).map(([k, src]) => [k, make(src)]);
    for (let i = 0; i < 400 && !pending.every(([, pr]) => gl.getProgramParameter(pr.p, par.COMPLETION_STATUS_KHR)); i++) {
      await later(16);
      if (!alive()) throw new Error("parc: arrêté");
    }
    for (const [k, pr] of pending) out[k] = finish(pr);
  } else {
    for (const [k, src] of Object.entries(sources)) {
      out[k] = finish(make(src));
      await nextTask();
      if (!alive()) throw new Error("parc: arrêté");
    }
  }
  return out;
}

/** Goldberg polyhedron edges: dual of a subdivided icosahedron (hexagons and twelve pentagons). */
function honeycomb(subdiv) {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(vec3.norm);
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const key = (a, b) => a < b ? a + "_" + b : b + "_" + a;
  for (let s = 0; s < subdiv; s++) {
    const cache = new Map();
    const mid = (a, b) => {
      const k = key(a, b);
      if (!cache.has(k)) { verts.push(vec3.norm(vec3.lerp(verts[a], verts[b], 0.5))); cache.set(k, verts.length - 1); }
      return cache.get(k);
    };
    faces = faces.flatMap(([a, b, c]) => { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
  }
  const cent = faces.map(f => vec3.norm(vec3.add(vec3.add(verts[f[0]], verts[f[1]]), verts[f[2]])));
  const shared = new Map();
  faces.forEach((f, i) => [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]].forEach(([a, b]) => { const k = key(a, b); if (!shared.has(k)) shared.set(k, []); shared.get(k).push(i); }));
  const edges = [];
  shared.forEach(fs => { if (fs.length === 2) edges.push([cent[fs[0]], cent[fs[1]]]); });
  return edges;
}

/** Critically damped spring towards `goal` (analytic step: stable at any frame time). */
const spring = (x, w) => ({ x, v: 0, goal: x, w });
function stepSpring(s, dt) {
  const d = s.x - s.goal, w = s.w, e = Math.exp(-w * dt);
  const nx = (d + (s.v + w * d) * dt) * e;
  s.v = (s.v - w * (s.v + w * d) * dt) * e;
  s.x = s.goal + nx;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{nodes: {id: string, family: string, kind: string, parent?: string}[], links: {a: string, b: string, type: string}[]}} model
 * @param {{onFrame?: (proj: Float32Array, w: number, h: number) => void, onGiveUp?: () => void, level?: number}} [options]
 */
export async function createParc(canvas, model, options = {}) {
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "high-performance", preserveDrawingBuffer: false });
  if (!gl) throw new Error("parc: WebGL indisponible");
  let alive = true, lost = false;
  canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); lost = true; stop(); options.onLost?.(); });
  const P = await compileAll(gl, PROGRAMS, () => alive && !lost);
  const R = rng(20261008);

  // ---------- Model ----------
  const nodes = model.nodes.map((n, i) => {
    let L = LAYOUT[n.id];
    if (!L) { // A project added later without a hand-placed position: golden-angle spot on its family's shell.
      const r = SHELL[n.family] || 4.5, a = i * 2.39996, y = ((i * 0.618) % 1 - 0.5) * 4;
      const h = Math.sqrt(Math.max(0.5, r * r - y * y));
      L = [Math.cos(a) * h, y, Math.sin(a) * h, n.family === "vision" ? 0.17 : 0.22];
    }
    const color = FAMILY[n.family] || FAMILY.code;
    return { ...n, i, pos: L.slice(0, 3), r: L[3], color, hot: vec3.lerp(color, [1, 1, 1], 0.72), hl: 1, seed: R() * 10, spin: R() * TAU };
  });
  const byId = new Map(nodes.map(n => [n.id, n]));
  const adj = new Map(nodes.map(n => [n.id, new Set()]));
  const links = model.links.filter(l => byId.has(l.a) && byId.has(l.b)).map((l, i) => {
    const A = byId.get(l.a), B = byId.get(l.b);
    adj.get(l.a).add(l.b); adj.get(l.b).add(l.a);
    const d = vec3.sub(B.pos, A.pos), len = vec3.len(d), mid = vec3.lerp(A.pos, B.pos, 0.5);
    // Arc away from the centre of the parc; a relation that leaves TheHive bends sideways.
    let away = vec3.sub(mid, vec3.scale(d, vec3.dot(mid, d) / (len * len)));
    if (vec3.len(away) < 0.4) away = vec3.cross(d, [0, 1, 0]);
    if (vec3.len(away) < 1e-3) away = [1, 0, 0];
    const C = vec3.add(vec3.add(mid, vec3.scale(vec3.norm(away), len * 0.17)), [0, len * 0.05, 0]);
    const type = l.type === "noyau" ? 0 : l.type === "build" ? 1 : 2;
    return { ...l, i, A, B, C, len, type, glow: 1, t0: Math.min(0.4, A.r * 1.08 / len), t1: 1 - Math.min(0.4, B.r * 1.08 / len), seed: R(), speed: [0.16, 0.11, 0.08][type] };
  });
  nodes.forEach(n => { if (n.parent && byId.has(n.parent)) { adj.get(n.id).add(n.parent); adj.get(n.parent).add(n.id); } });
  const hiveNode = nodes.find(n => n.kind === "hive");

  // ---------- Geometry ----------
  const buf = (data, usage) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW); return b; };
  const quad = buf(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));

  // Dust: a far sky shell, a flattened star cloud around the parc, and motes close enough for strong parallax.
  const dust = [];
  const pushDust = (p, size, bright) => dust.push(p[0], p[1], p[2], size, bright, R(), R());
  const randDir = () => { const z = R() * 2 - 1, a = R() * TAU, s = Math.sqrt(1 - z * z); return [Math.cos(a) * s, z, Math.sin(a) * s]; };
  const SKY = 1700, CLOUD = 1100, MOTES = 240;
  for (let i = 0; i < SKY; i++) pushDust(vec3.scale(randDir(), 70 + R() * 50), 0.7 + Math.pow(R(), 3) * 2.4, 0.22 + Math.pow(R(), 4) * 1.5);
  for (let i = 0; i < CLOUD; i++) {
    const r = 8 + Math.pow(R(), 0.8) * 24, a = R() * TAU, y = (R() + R() + R() - 1.5) * 3.4;
    pushDust([Math.cos(a) * r, y - 0.6, Math.sin(a) * r], 0.35 + Math.pow(R(), 2) * 0.9, 0.18 + Math.pow(R(), 3) * 0.9);
  }
  for (let i = 0; i < MOTES; i++) {
    let p; do { p = [(R() - 0.5) * 22, (R() - 0.5) * 12, (R() - 0.5) * 22]; } while (vec3.len(p) < 2.2);
    pushDust(p, 0.5 + R() * 0.9, 0.1 + R() * 0.32);
  }
  const dustBuf = buf(new Float32Array(dust));

  // Filament ribbon: (t, side) pairs for a triangle strip.
  const SEG = 72, ribbon = [];
  for (let i = 0; i <= SEG; i++) ribbon.push(i / SEG, -1, i / SEG, 1);
  const ribbonBuf = buf(new Float32Array(ribbon));

  // Particles: control points baked per particle, the vertex shader moves them along their curve.
  const parts = [];
  links.forEach(l => {
    const count = [26, 18, 13][l.type];
    for (let k = 0; k < count; k++) {
      const jitter = vec3.scale(randDir(), l.len * 0.012);
      const pa = vec3.lerp(l.A.pos, l.B.pos, 0), pb = l.B.pos;
      parts.push(...pa, ...pb, ...vec3.add(l.C, jitter), ...l.A.color, ...l.B.color, k / count + R() * 0.03, (0.05 + R() * 0.05) * (l.type === 0 ? 1.4 : 1) * 6 / Math.max(3, l.len), 0.55 + R() * 0.75, l.i);
    }
  });
  const PART_STRIDE = 19, partCount = parts.length / PART_STRIDE;
  const partBuf = buf(new Float32Array(parts));

  // TheHive's honeycomb: four vertices per edge (two ends × two sides).
  const comb = honeycomb(2);
  const hiveData = [], hiveIdx = [];
  comb.forEach(([p0, p1], e) => {
    for (const end of [0, 1]) for (const side of [-1, 1]) hiveData.push(...p0, ...p1, end, side);
    const b = e * 4; hiveIdx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  });
  const hiveBuf = buf(new Float32Array(hiveData));
  const hiveIdxBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, hiveIdxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(hiveIdx), gl.STATIC_DRAW);

  // Accretion disc: an annulus strip (angle, radial 0..1).
  const DISC_SEG = 96, discData = [];
  for (let i = 0; i <= DISC_SEG; i++) discData.push(i / DISC_SEG * TAU, 0, i / DISC_SEG * TAU, 1);
  const discBuf = buf(new Float32Array(discData));

  // ---------- Attribute state (WebGL1, no VAO) ----------
  let enabled = 0;
  function bindAttribs(buffer, stride, layout) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    let mask = 0;
    for (const [loc, size, offset] of layout) {
      if (loc == null || loc < 0) continue;
      mask |= 1 << loc;
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, offset * 4);
    }
    for (let i = 0; i < 16; i++) {
      const bit = 1 << i;
      if (mask & bit && !(enabled & bit)) gl.enableVertexAttribArray(i);
      else if (!(mask & bit) && enabled & bit) gl.disableVertexAttribArray(i);
    }
    enabled = mask;
  }

  // ---------- Render targets ----------
  function fbo(w, h, old) {
    if (old && old.w === w && old.h === h) return old;
    if (old) { gl.deleteTexture(old.tex); gl.deleteFramebuffer(old.fb); }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  }
  const T = {};

  // ---------- State ----------
  const coarse = matchMedia("(pointer: coarse)").matches;
  let level = options.level ?? ((coarse || (navigator.hardwareConcurrency || 8) <= 4) ? 2 : 3);
  let cssW = 1, cssH = 1, aspect = 1, dpr = 1;
  const view = { scrim: 0, shiftX: 0, shiftY: 0, mobile: false, fit: 14 };
  const st = {
    time: 0, scroll: 0, px: 0, py: 0, spx: 0, spy: 0, hover: null, selected: null, interact: 0, interactGoal: 0,
    orbit: 0, userAz: 0, userEl: 0, azVel: 0, elVel: 0, dragging: false, intro: 0, ab: 0, flight: 0
  };
  const cam = {
    tx: spring(0, 2.6), ty: spring(-0.2, 2.6), tz: spring(0, 2.6), dist: spring(30, 1.5), az: spring(-1.2, 1.6), el: spring(0.75, 1.6),
    sx: spring(0, 3), sy: spring(0, 3)
  };
  let proj = mat4.identity(), viewM = mat4.identity(), vp = mat4.identity(), eye = [0, 0, 10];
  let basis = { f: [0, 0, -1], r: [1, 0, 0], u: [0, 1, 0] };
  const fov = 0.72, tanY = Math.tan(fov / 2);
  const out = new Float32Array(nodes.length * 4);

  // Smallest distance at which the whole parc fits the region beside the copy, whatever the orbit angle.
  let extX = 6, extY = 4.5;
  {
    let mx = 0, my = 0;
    for (let a = 0; a < TAU; a += TAU / 48) for (const n of nodes) {
      const x = n.pos[0] * Math.cos(a) - n.pos[2] * Math.sin(a);
      mx = Math.max(mx, Math.abs(x) + n.r * 1.6);
      my = Math.max(my, Math.abs(n.pos[1] + 0.2) + n.r * 1.6);
    }
    extX = mx * 0.9; extY = my + 0.5;
  }

  function resize() {
    cssW = Math.max(1, canvas.clientWidth); cssH = Math.max(1, canvas.clientHeight);
    aspect = cssW / cssH;
    const L = LEVELS[level];
    dpr = Math.min(window.devicePixelRatio || 1, 1.5) * L.scale;
    dpr = Math.min(dpr, Math.sqrt(MAX_PIXELS / (cssW * cssH)));
    const w = Math.max(2, Math.round(cssW * dpr)), h = Math.max(2, Math.round(cssH * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    T.scene = fbo(w, h, T.scene);
    T.neb = fbo(Math.max(2, Math.ceil(w / L.neb)), Math.max(2, Math.ceil(h / L.neb)), T.neb);
    T.b1 = fbo(Math.max(2, Math.ceil(w / 4)), Math.max(2, Math.ceil(h / 4)), T.b1);
    T.b1t = fbo(T.b1.w, T.b1.h, T.b1t);
    T.b2 = fbo(Math.max(2, Math.ceil(w / 8)), Math.max(2, Math.ceil(h / 8)), T.b2);
    T.b2t = fbo(T.b2.w, T.b2.h, T.b2t);
    T.st = fbo(T.b2.w, T.b2.h, T.st);
    fit();
  }
  function fit() {
    const tanX = tanY * aspect;
    const availX = Math.max(0.35, 1 - Math.abs(view.shiftX)), availY = Math.max(0.4, 1 - Math.abs(view.shiftY));
    view.fit = Math.max(extX / (tanX * availX), extY / (tanY * availY), 8);
  }

  // ---------- Camera ----------
  function updateCamera(dt) {
    const t = st.time;
    const k = 1 - Math.exp(-dt * 4);
    st.spx += (st.px - st.spx) * k; st.spy += (st.py - st.spy) * k;
    st.interact += (st.interactGoal - st.interact) * (1 - Math.exp(-dt * 3));
    // Slow orbit, calmer while the reader points at or tabs through the parc.
    const speed = st.selected ? 0.02 : 0.028 * (1 - 0.82 * st.interact);
    if (!st.dragging) {
      st.userAz += st.azVel * dt; st.userEl += st.elVel * dt;
      const decay = Math.exp(-dt * 2.4); st.azVel *= decay; st.elVel *= decay;
      st.orbit += speed * dt;
    }
    st.userEl = Math.max(-0.5, Math.min(0.75, st.userEl));
    const sel = st.selected && byId.get(st.selected);
    const scroll = st.scroll;
    const az = st.orbit + st.userAz + st.spx * 0.16 + scroll * 0.75;
    let el = 0.2 + 0.07 * Math.sin(t * TAU / 61) + st.userEl - st.spy * 0.09 + scroll * 0.32;
    if (sel) {
      const focusDist = sel.kind === "hive" || sel.kind === "core" ? 6.4 : Math.max(2.5, sel.r * 8 + 1.6);
      cam.tx.goal = sel.pos[0]; cam.ty.goal = sel.pos[1]; cam.tz.goal = sel.pos[2];
      cam.dist.goal = focusDist;
      el = 0.14 + st.userEl - st.spy * 0.06;
      cam.sx.goal = view.mobile ? 0 : view.shiftX;
      cam.sy.goal = view.mobile ? 0.42 : 0;
    } else {
      cam.tx.goal = 0; cam.ty.goal = -0.25; cam.tz.goal = 0;
      cam.dist.goal = view.fit * (1 - scroll * 0.14);
      cam.sx.goal = view.shiftX; cam.sy.goal = view.shiftY;
    }
    cam.az.goal = az; cam.el.goal = Math.max(-0.45, Math.min(0.95, el));
    const before = [cam.tx.x, cam.ty.x, cam.tz.x];
    for (const s of Object.values(cam)) stepSpring(s, dt);
    if (st.dragging) { cam.az.x = cam.az.goal; cam.el.x = cam.el.goal; cam.az.v = 0; cam.el.v = 0; }
    // Flight intensity (target speed) widens the lens a little and splits the colours: the jump is felt.
    const moved = Math.hypot(cam.tx.x - before[0], cam.ty.x - before[1], cam.tz.x - before[2]) / Math.max(dt, 1e-3);
    st.flight += (Math.min(1, moved / 6) - st.flight) * (1 - Math.exp(-dt * 5));
    const target = [cam.tx.x, cam.ty.x, cam.tz.x];
    const ce = Math.cos(cam.el.x);
    eye = vec3.add(target, vec3.scale([ce * Math.sin(cam.az.x), Math.sin(cam.el.x), ce * Math.cos(cam.az.x)], cam.dist.x));
    viewM = mat4.lookAt(eye, target, [0, 1, 0]);
    const f = fov + st.flight * 0.14;
    proj = mat4.perspective(f, aspect, 0.1, 400);
    proj[8] = -cam.sx.x; proj[9] = -cam.sy.x;
    vp = mat4.multiply(proj, viewM);
    const F = vec3.norm(vec3.sub(target, eye)), Rr = vec3.norm(vec3.cross(F, [0, 1, 0]));
    basis = { f: F, r: Rr, u: vec3.cross(Rr, F), tan: [Math.tan(f / 2) * aspect, Math.tan(f / 2)] };
  }

  function project() {
    const m = vp, halfH = cssH / 2;
    for (const n of nodes) {
      const [x, y, z] = n.pos;
      const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      const o = n.i * 4;
      if (cw <= 0.05) { out[o] = -1e4; out[o + 1] = -1e4; out[o + 2] = 0; out[o + 3] = -1; continue; }
      out[o] = (cx / cw * 0.5 + 0.5) * cssW;
      out[o + 1] = (0.5 - cy / cw * 0.5) * cssH;
      out[o + 2] = n.r * proj[5] / cw * halfH;
      out[o + 3] = cw;
    }
  }

  // ---------- Drawing ----------
  const blendAdd = () => { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); };
  function screenPass(prog, target, setup) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : canvas.width, target ? target.h : canvas.height);
    gl.useProgram(prog.p);
    setup(prog.u);
    bindAttribs(quad, 2, [[prog.a.aCorner, 2, 0]]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  const tex = (unit, t, loc) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t.tex); gl.uniform1i(loc, unit); };

  function drawNebula() {
    gl.disable(gl.BLEND);
    screenPass(P.neb, T.neb, u => {
      gl.uniform3fv(u.uF, basis.f); gl.uniform3fv(u.uR, basis.r); gl.uniform3fv(u.uU, basis.u);
      gl.uniform2f(u.uTan, basis.tan[0], basis.tan[1]); gl.uniform2f(u.uShift, proj[8], proj[9]);
      gl.uniform1f(u.uTime, st.time);
    });
  }

  function drawScene() {
    const L = LEVELS[level];
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.scene.fb);
    gl.viewport(0, 0, T.scene.w, T.scene.h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    blendAdd();
    const px = T.scene.h / Math.max(1, cssH);

    // Dust
    let p = P.dust;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uVP, false, vp); gl.uniform1f(p.u.uPx, px); gl.uniform1f(p.u.uTime, st.time);
    bindAttribs(dustBuf, 7, [[p.a.aPos, 3, 0], [p.a.aInfo, 4, 3]]);
    gl.uniform1f(p.u.uPersp, 0); gl.uniform1f(p.u.uAlpha, 0.9);
    gl.drawArrays(gl.POINTS, 0, Math.round(SKY * L.dust));
    gl.uniform1f(p.u.uPersp, 1); gl.uniform1f(p.u.uAlpha, 1);
    gl.drawArrays(gl.POINTS, SKY, Math.round(CLOUD * L.dust));
    gl.drawArrays(gl.POINTS, SKY + CLOUD, Math.round(MOTES * L.motes));

    // Filaments
    p = P.link;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uVP, false, vp); gl.uniform1f(p.u.uAspect, aspect); gl.uniform1f(p.u.uTime, st.time);
    bindAttribs(ribbonBuf, 2, [[p.a.aTS, 2, 0]]);
    for (const l of links) {
      gl.uniform3fv(p.u.uA, l.A.pos); gl.uniform3fv(p.u.uB, l.B.pos); gl.uniform3fv(p.u.uC, l.C);
      gl.uniform2f(p.u.uRange, l.t0, l.t1);
      gl.uniform1f(p.u.uWidth, (l.type === 0 ? 4.2 : 3.4) * (0.8 + 0.35 * Math.min(2, l.glow)) / cssH);
      gl.uniform3fv(p.u.uColA, l.A.color); gl.uniform3fv(p.u.uColB, l.B.color);
      gl.uniform1f(p.u.uGlow, l.glow * (l.type === 0 ? 1.15 : 0.9)); gl.uniform1f(p.u.uType, l.type);
      gl.uniform1f(p.u.uSpeed, l.speed); gl.uniform1f(p.u.uSeed, l.seed);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, (SEG + 1) * 2);
    }

    // TheHive's honeycomb shell, turning slowly on a tilted axis.
    if (hiveNode) {
      p = P.hive;
      gl.useProgram(p.p);
      const model = mat4.model(hiveNode.pos, 0.42, st.time * 0.045, 0.18, hiveNode.r * 1.01);
      gl.uniformMatrix4fv(p.u.uVP, false, vp); gl.uniformMatrix4fv(p.u.uModel, false, model);
      gl.uniform3fv(p.u.uEye, eye); gl.uniform3fv(p.u.uCenter, hiveNode.pos);
      gl.uniform1f(p.u.uAspect, aspect); gl.uniform1f(p.u.uWidth, 2.2 / cssH * Math.min(1.6, 0.9 + hiveNode.hl * 0.25));
      gl.uniform3fv(p.u.uColor, hiveNode.color); gl.uniform1f(p.u.uTime, st.time); gl.uniform1f(p.u.uGlow, 0.85 * hiveNode.hl);
      bindAttribs(hiveBuf, 8, [[p.a.aP0, 3, 0], [p.a.aP1, 3, 3], [p.a.aES, 2, 6]]);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, hiveIdxBuf);
      gl.drawElements(gl.TRIANGLES, comb.length * 6, gl.UNSIGNED_SHORT, 0);
    }

    // Accretion discs of the specified-but-unbuilt projects.
    p = P.disc;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uVP, false, vp); gl.uniform1f(p.u.uTime, st.time);
    bindAttribs(discBuf, 2, [[p.a.aAR, 2, 0]]);
    for (const n of nodes) {
      if (n.kind !== "future") continue;
      gl.uniformMatrix4fv(p.u.uModel, false, mat4.model(n.pos, 0.5 + n.seed * 0.05, -st.time * 0.35 + n.seed, 0.3 - n.seed * 0.04, n.r));
      gl.uniform3fv(p.u.uColor, n.color); gl.uniform1f(p.u.uGlow, n.hl);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, (DISC_SEG + 1) * 2);
    }

    // Stars
    p = P.star;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uView, false, viewM); gl.uniformMatrix4fv(p.u.uProj, false, proj); gl.uniform1f(p.u.uTime, st.time);
    bindAttribs(quad, 2, [[p.a.aCorner, 2, 0]]);
    for (const n of nodes) {
      const s = QUAD[n.kind] || QUAD.star;
      const pulse = n.kind === "core" ? 1 : 1 + 0.05 * Math.sin(st.time * 1.3 + n.seed * 3);
      gl.uniform3fv(p.u.uCenter, n.pos); gl.uniform1f(p.u.uSize, n.r * s * (n.kind === "core" ? 1 : 1 + (n.hl - 1) * 0.15));
      gl.uniform1f(p.u.uS, s); gl.uniform1f(p.u.uKind, KIND[n.kind] ?? 0);
      gl.uniform3fv(p.u.uColor, n.kind === "core" ? [1, 0.78, 0.42] : n.color); gl.uniform3fv(p.u.uHot, n.kind === "core" ? [1, 0.93, 0.78] : n.hot);
      gl.uniform1f(p.u.uSeed, n.seed); gl.uniform1f(p.u.uSpin, n.spin + st.time * 0.02);
      gl.uniform1f(p.u.uGlow, n.hl * pulse * (n.kind === "vision" ? 0.95 : 1));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // Particles
    p = P.part;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uVP, false, vp); gl.uniform1f(p.u.uTime, st.time); gl.uniform1f(p.u.uPx, px);
    gl.uniform1fv(p.u.uLinkGlow, linkGlow);
    bindAttribs(partBuf, PART_STRIDE, [[p.a.aA, 3, 0], [p.a.aB, 3, 3], [p.a.aC, 3, 6], [p.a.aColA, 3, 9], [p.a.aColB, 3, 12], [p.a.aInfo, 4, 15]]);
    gl.drawArrays(gl.POINTS, 0, partCount);
  }
  const linkGlow = new Float32Array(32);

  function drawPost() {
    const L = LEVELS[level];
    gl.disable(gl.BLEND);
    screenPass(P.down, T.b1, u => { tex(0, T.scene, u.uTex); gl.uniform2f(u.uTexel, 1 / T.scene.w, 1 / T.scene.h); gl.uniform1f(u.uThresh, 0.2); });
    screenPass(P.blur, T.b1t, u => { tex(0, T.b1, u.uTex); gl.uniform2f(u.uDir, 1 / T.b1.w, 0); });
    screenPass(P.blur, T.b1, u => { tex(0, T.b1t, u.uTex); gl.uniform2f(u.uDir, 0, 1 / T.b1.h); });
    if (L.bloom > 1) {
      screenPass(P.down, T.b2, u => { tex(0, T.b1, u.uTex); gl.uniform2f(u.uTexel, 0.5 / T.b1.w, 0.5 / T.b1.h); gl.uniform1f(u.uThresh, 0); });
      screenPass(P.blur, T.b2t, u => { tex(0, T.b2, u.uTex); gl.uniform2f(u.uDir, 1.6 / T.b2.w, 0); });
      screenPass(P.blur, T.b2, u => { tex(0, T.b2t, u.uTex); gl.uniform2f(u.uDir, 0, 1.6 / T.b2.h); });
    }
    if (L.streak) screenPass(P.streak, T.st, u => { tex(0, L.bloom > 1 ? T.b2 : T.b1, u.uTex); gl.uniform2f(u.uTexel, 1 / T.st.w, 1 / T.st.h); });
    screenPass(P.compose, null, u => {
      tex(0, T.scene, u.uScene); tex(1, T.b1, u.uB1); tex(2, T.b2, u.uB2); tex(3, T.st, u.uStreak); tex(4, T.neb, u.uNeb);
      gl.uniform2f(u.uRes, canvas.width, canvas.height); gl.uniform1f(u.uTime, st.time);
      gl.uniform1f(u.uAb, 0.0045 + st.flight * 0.012 + st.ab); gl.uniform1f(u.uScrim, view.scrim);
      gl.uniform1f(u.uBloom, 1); gl.uniform1f(u.uStreakAmt, 0.85);
      gl.uniform1f(u.uFadeTop, view.mobile ? 0.12 : 0.1); gl.uniform1f(u.uFadeBot, view.mobile ? 0.14 : 0.16);
      gl.uniform1f(u.uIntro, Math.min(1, st.intro)); gl.uniform1f(u.uUseB2, L.bloom > 1 ? 1 : 0); gl.uniform1f(u.uUseStreak, L.streak ? 1 : 0);
    });
  }

  // ---------- Highlight ----------
  function updateHighlight(dt) {
    const f = st.hover || st.selected;
    const near = f ? adj.get(f) : null;
    const k = 1 - Math.exp(-dt * 6);
    for (const n of nodes) {
      let goal = 1;
      if (f) goal = n.id === f ? 1.6 : near && near.has(n.id) ? 1.12 : 0.42;
      n.hl += (goal - n.hl) * k;
    }
    for (const l of links) {
      const goal = f ? (l.a === f || l.b === f ? 2 : 0.28) : 1;
      l.glow += (goal - l.glow) * k;
      linkGlow[l.i] = l.glow;
    }
  }

  // ---------- Adaptive quality ----------
  const times = new Float32Array(60);
  let nTimes = 0, settle = 0.8, calm = 0, slowWindows = 0;
  function sample(dt) {
    if (settle > 0) { settle -= dt; return; }
    times[nTimes++] = dt * 1000;
    if (nTimes < times.length) return;
    nTimes = 0;
    const sorted = Array.from(times).sort((a, b) => a - b), p95 = sorted[Math.floor(sorted.length * 0.95)];
    if (p95 > 20 && level > 0) { setLevel(level - 1); calm = 0; settle = 1.2; return; }
    if (p95 > 50 && level === 0) { if (++slowWindows >= 3) options.onGiveUp?.(); return; }
    slowWindows = 0;
    if (p95 < 12.5 && level < LEVELS.length - 1) { if (++calm >= 4) { setLevel(level + 1); calm = 0; settle = 1.2; } }
    else calm = 0;
  }
  function setLevel(l) { level = Math.max(0, Math.min(LEVELS.length - 1, l)); resize(); }

  // ---------- Loop ----------
  let raf = 0, last = 0, running = false;
  function frame(now) {
    raf = 0;
    if (!running || lost) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    sample(dt);
    st.time += dt;
    st.intro += dt * 0.7;
    updateHighlight(dt);
    updateCamera(dt);
    drawNebula();
    drawScene();
    drawPost();
    project();
    options.onFrame?.(out, cssW, cssH);
    raf = requestAnimationFrame(frame);
  }
  function start() { if (running || lost || !alive) return; running = true; last = 0; settle = Math.max(settle, 0.4); nTimes = 0; raf = requestAnimationFrame(frame); }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

  resize();
  // First picture at once (also warms every program), so the canvas never fades in empty.
  updateHighlight(0); updateCamera(1 / 60); drawNebula(); drawScene(); drawPost(); project();

  return {
    start, stop, resize,
    destroy() { stop(); alive = false; gl.getExtension("WEBGL_lose_context")?.loseContext(); },
    /** Layout: `scrim` = right edge of the copy column (0..1, 0 = none); `shiftX/Y` = where the parc sits (NDC). */
    setView(v) { Object.assign(view, v); fit(); },
    setPointer(x, y) { st.px = x; st.py = y; },
    setScroll(p) { st.scroll = Math.max(0, Math.min(1, p)); },
    setInteract(on) { st.interactGoal = on ? 1 : 0; },
    hover(id) { st.hover = id && byId.has(id) ? id : null; },
    select(id) { st.selected = id && byId.has(id) ? id : null; },
    drag(dx, dy) {
      st.dragging = true;
      st.userAz -= dx * 0.0062; st.userEl += dy * 0.0042;
      st.azVel = -dx * 0.0062 * 60; st.elVel = dy * 0.0042 * 60;
    },
    release() { st.dragging = false; },
    /** Project under a point of the canvas (CSS px), the nearest one when discs overlap; inner bodies first. */
    pick(x, y) {
      let best = null, bestScore = Infinity;
      for (const n of nodes) {
        const o = n.i * 4;
        if (out[o + 3] <= 0) continue;
        const d = Math.hypot(x - out[o], y - out[o + 1]);
        const reach = Math.max(out[o + 2] * (n.kind === "hive" ? 1.02 : 1.25), n.kind === "hive" ? 30 : 20);
        if (d > reach) continue;
        const score = (n.parent ? -1e3 : 0) + out[o + 3] + d / reach;
        if (score < bestScore) { bestScore = score; best = n.id; }
      }
      return best;
    },
    get level() { return level; },
    get projections() { return out; }
  };
}
