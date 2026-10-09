// GLSL ES 1.00 sources (they run in WebGL1 and WebGL2 contexts alike).
// Frame: SKY (low resolution) → scene target (sky, stars, worlds, particles) → bloom chain → POST,
// which composes the picture and applies the signal identity (aberration, slices, scanlines, grain).

// Fragment precision: highp where the GPU offers it (noise coordinates and positions need it on phones).
const PREC = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

// Value noise from one texture fetch per octave (texture layout: see noiseTexture in gl.js). OCT comes from the quality tier.
const NOISE = `
uniform sampler2D uNoise;
float noise(vec3 x){
  vec3 p=floor(x),f=fract(x);
  f=f*f*(3.-2.*f);
  vec2 uv=p.xy+vec2(37.,17.)*p.z+f.xy;
  vec2 rg=texture2D(uNoise,(uv+.5)/256.).xy;
  return mix(rg.x,rg.y,f.z);
}
float fbm(vec3 p){
  float v=0.,a=.5;
  for(int i=0;i<OCT;i++){v+=a*noise(p);p=p*2.03+vec3(1.7,9.2,3.1);a*=.5;}
  return v/(1.-a*2.);
}
`;

// Planetary ring density across the ring (x: 0 inner edge → 1 outer edge). Shared by the ring and the
// planet it shades, so the shadow on the globe matches the bands that cast it.
const RING_BANDS = `
float ringBands(float x,float seed){
  float a=texture2D(uNoise,vec2(x*.19+seed,.13)).r;
  float b=texture2D(uNoise,vec2(x*.83+seed,.57)).b;
  float c=texture2D(uNoise,vec2(x*2.9+seed,.81)).r;
  float d=.12+.88*smoothstep(.22,.78,a*.5+b*.33+c*.17);
  d*=smoothstep(0.,.06,x)*(1.-smoothstep(.86,1.,x));
  d*=1.-.88*exp(-pow(abs((x-.64)*34.),2.));
  return d;
}
`;

const QUAD_VS = `
attribute vec2 aCorner;
varying vec2 vUv;
void main(){vUv=aCorner*.5+.5;gl_Position=vec4(aCorner,0.,1.);}`;

// ---------- Sky: a nebula fixed in world space, sampled along each pixel's view ray ----------
export const SKY_VS = QUAD_VS;
// The sky's colour along a direction (shared by the sky pass and the gates' portals).
const SKY_FN = `
uniform vec3 uSun,uSunCol,uNebA,uNebB,uNebC,uDeep,uBand;
uniform float uTime,uGlow;
vec3 skyCol(vec3 d){
  float galaxy=exp(-pow(abs(dot(d,uBand)*2.4),2.));
  vec3 p=d*1.8;
  float n1=fbm(p+vec3(0.,uTime*.0015,0.));
  float n2=fbm(p*2.3+vec3(n1*2.1,n1*1.3,-n1)+3.7);
  float n3=fbm(p*5.2+vec3(n2*1.6)+9.2);
  float cloud=smoothstep(.40,.80,n1*.55+n2*.45+galaxy*.16);
  float fil=smoothstep(.52,.78,n3)*cloud;
  float lane=smoothstep(.54,.70,n3)*smoothstep(.46,.64,n2);
  vec3 neb=mix(uNebA,uNebB,smoothstep(.34,.70,n2));
  neb=mix(neb,uNebC,smoothstep(.56,.82,n1)*.75);
  vec3 col=uDeep*(.7+.6*galaxy);
  col+=neb*cloud*.78;
  col+=mix(uNebB,uNebC,n3)*fil*.55;
  col*=1.-lane*.6;
  col+=mix(uNebA,uNebC,.5)*galaxy*.05;
  float s=max(dot(d,uSun),0.);
  col+=uSunCol*(pow(s,70.)*.55+pow(s,9.)*.16)*uGlow;
  return col;
}`;
export const SKY_FS = PREC + NOISE + SKY_FN + `
varying vec2 vUv;
uniform vec3 uRight,uUp,uFwd;
uniform vec2 uTan;
void main(){
  vec2 q=vUv*2.-1.;
  gl_FragColor=vec4(skyCol(normalize(uFwd+q.x*uTan.x*uRight+q.y*uTan.y*uUp)),1.);
}`;
// A gate's portal: inside the ring, the sky of the world on the other side ("between the worlds", literally).
export const PORTAL_VS = `
attribute vec2 aCorner;
uniform mat4 uProj,uView;
uniform vec3 uP,uS,uU;
uniform float uRad;
varying vec3 vWorld;
varying vec2 vQ;
void main(){
  vQ=aCorner;
  vWorld=uP+(uS*aCorner.x+uU*aCorner.y)*uRad;
  gl_Position=uProj*uView*vec4(vWorld,1.);
}`;
export const PORTAL_FS = PREC + NOISE + SKY_FN + `
varying vec3 vWorld;
varying vec2 vQ;
uniform vec3 uCam;
uniform float uAlpha;
void main(){
  float r=length(vQ);
  if(r>1.)discard;
  float a=(1.-smoothstep(.78,1.,r))*uAlpha;
  gl_FragColor=vec4(skyCol(normalize(vWorld-uCam))*a,a);
}`;

// The low-resolution sky is stretched over the scene target as its first layer.
export const BLIT_VS = QUAD_VS;
export const BLIT_FS = PREC + `
varying vec2 vUv;
uniform sampler2D uSrc;
void main(){gl_FragColor=vec4(texture2D(uSrc,vUv).rgb,1.);}`;

// ---------- Bodies ----------
export const PLANET_VS = `
attribute vec3 aPos;
uniform mat4 uProj,uView,uModel;
varying vec3 vObj,vWorld,vNormal;
void main(){
  vObj=aPos;
  vec4 w=uModel*vec4(aPos,1.);
  vWorld=w.xyz;
  vNormal=mat3(uModel)*aPos;
  gl_Position=uProj*uView*w;
}`;

// uKind: 0 gas giant · 1 ocean world · 2 circuit world (dev) · 3 dunes of light (photo)
//        4 marbled ink (writing) · 5 nebular gas (worlds) · 6 rocky / icy moon
export const PLANET_FS = PREC + NOISE + RING_BANDS + `
varying vec3 vObj,vWorld,vNormal;
uniform vec3 uCam,uLight,uLightCol,uAmb,uDeep,uMid,uHigh,uHot,uAtmo,uFill,uFillCol;
uniform vec3 uRingC,uRingN;
uniform vec2 uRingR;
uniform float uRingK,uRingSeed,uKind,uSeed,uBands,uTime,uEnergy,uGrid,uStorm,uOpacity,uPxR,uIri;
uniform vec3 uIriCol;
void main(){
  vec3 n=normalize(vNormal),v=normalize(uCam-vWorld),l=uLight,o=vObj;
  vec3 p=o*2.+vec3(uSeed,uSeed*.37,uSeed*.71);
  float ndl=dot(n,l);
  vec3 alb;vec3 emit=vec3(0.);float gloss=0.;
  if(uKind<.5){
    float w=fbm(p*1.1+vec3(uTime*.006,0.,0.));
    float w2=noise(p*4.3-vec3(uTime*.02,0.,0.));
    float lat=o.y+(w-.5)*.42+(w2-.5)*.08;
    float b=.5+.5*sin(lat*uBands*3.1416);
    float fine=.5+.5*sin(lat*uBands*8.7+w*7.);
    alb=mix(uDeep,uMid,smoothstep(.15,.85,b));
    alb=mix(alb,uHigh,smoothstep(.5,.95,b*fine)*.7);
    float eye=(1.-smoothstep(.0,.16,length(vec2(atan(o.z,o.x)-1.1,(o.y+.32)*2.4))));
    alb=mix(alb,uHigh,eye*.6);
    float pole=smoothstep(.62,.9,abs(o.y))*(1.-smoothstep(.9,.99,abs(o.y)));
    float curtain=.5+.5*sin(atan(o.z,o.x)*9.+w*6.+uTime*.35);
    emit=uHot*pole*curtain*curtain*.75*uStorm;
  }else if(uKind<1.5){
    float h=fbm(p*2.1)+noise(p*9.)*.06;
    float land=smoothstep(.52,.545,h);
    float hi=smoothstep(.57,.74,h+noise(p*6.)*.08);
    vec3 ground=mix(uMid*(.7+.6*fbm(p*5.3)),mix(uMid,uHigh,.45),hi*.8);
    alb=mix(uDeep,ground,land);
    alb=mix(alb,uDeep*2.6+vec3(.03,.025,.045),(1.-land)*smoothstep(.42,.52,h)*.7);
    alb=mix(alb,vec3(.9,.95,1.),smoothstep(.8,.94,abs(o.y)+(h-.5)*.35));
    gloss=1.-land;
    vec3 cq=vec3(p.x*.55,p.y*2.6,p.z*.55)+vec3(uTime*.012,0.,uTime*.004);
    float c=smoothstep(.55,.8,fbm(cq*1.4+vec3(fbm(p*1.3)*1.5)));
    alb=mix(alb,uHigh,c*.75);
    gloss*=1.-c;
    float urban=land*smoothstep(.5,.68,fbm(p*3.3+7.))*(1.-c*.85);
    float lots=step(.6,noise(p*24.))+(1.-smoothstep(.0,.035,abs(fract(p.x*9.+noise(p*2.)*.6)-.5)))*.25;
    emit=mix(uHot,mix(uHot,vec3(1.),.45),step(.62,noise(p*1.7+3.)))*urban*lots*.7;
  }else if(uKind<2.5){
    // Développement: parallels traced by the beam, no circuit board. Fine latitude lines (one pixel wide,
    // fading where they crowd near the poles), written from the top down by a slow band of light; the lines it
    // has passed keep some of its light, and fade (phosphor).
    float m=fbm(p*1.6);
    alb=mix(uDeep,uMid,smoothstep(.3,.75,m));
    float lat=asin(clamp(o.y,-1.,1.));
    float px=1./max(.1309*uPxR,1.);
    float dl=abs(fract(lat*7.6394+.5)-.5);
    float line=(1.-smoothstep(px*.6,px*1.6,dl))*(1.-smoothstep(.55,.95,abs(o.y)));
    float beamY=1.6-mod(uTime*.11,3.2),above=o.y-beamY;
    float lit=max(step(0.,above)*exp(-above*1.6),exp(-above*above*196.));
    emit=uHot*line*(.2+.8*lit);
    gloss=.3;
  }else if(uKind<3.5){
    // Photographie: dunes in the tint under a fine dark grain, and no light of its own (no orange embers, §3.4).
    float d=fbm(p*1.2);
    float dunes=.5+.5*sin((o.x*3.+o.z*2.+o.y)*7.+d*11.);
    alb=mix(uDeep,uMid,smoothstep(.3,.7,d))*(.78+.42*dunes);
    alb=mix(alb,uHigh,smoothstep(.6,.78,d)*.65);
    alb*=.78+.22*smoothstep(.25,.75,noise(p*14.));
    gloss=.2;
  }else if(uKind<4.5){
    vec3 q=p+vec3(fbm(p*1.3+vec3(uTime*.008)),fbm(p*1.3+5.2),fbm(p*1.3+9.4))*2.2;
    float m=fbm(q*1.5);
    float vein=1.-abs(sin(m*15.));
    alb=mix(uDeep,uMid,smoothstep(.25,.75,m));
    alb=mix(alb,uHigh,pow(vein,7.)*.85);
    emit=uHot*pow(vein,14.)*.4;
    gloss=.55;
  }else if(uKind<5.5){
    vec3 q=p+fbm(p*1.1+vec3(0.,uTime*.01,0.))*1.7;
    float m=fbm(q*1.7);
    alb=mix(uDeep,uMid,smoothstep(.3,.7,m));
    alb=mix(alb,uHigh,smoothstep(.6,.84,m)*.8);
    emit=uHot*smoothstep(.66,.9,m)*.32;
  }else if(uKind>6.5){
    // A living star (Lumina): plasma currents and granulation, all emission.
    vec3 q=p*1.3+vec3(uTime*.05,uTime*.03,0.);
    float g=fbm(q+fbm(q*1.7+vec3(uTime*.08))*1.3);
    float cells=noise(p*9.+vec3(uTime*.25));
    emit=mix(uMid,uHigh,smoothstep(.32,.78,g))*(.75+.5*cells)+uHot*smoothstep(.7,.9,g)*.6;
    alb=vec3(0.);
  }else{
    float h=fbm(p*2.6);
    alb=mix(uDeep,uMid,smoothstep(.25,.75,h));
    float cr=smoothstep(.6,.67,noise(p*6.3))*(1.-smoothstep(.67,.75,noise(p*6.3)));
    alb*=1.-cr*.3;
    alb=mix(alb,uHigh,smoothstep(.62,.8,h)*.55);
    gloss=.1;
  }
  float wrap=clamp((ndl+.22)/1.22,0.,1.);
  float diff=wrap*wrap*(3.-2.*wrap);
  float sh=1.;
  if(uRingK>0.){
    float dn=dot(l,uRingN);
    float t=dot(uRingC-vWorld,uRingN)/(abs(dn)>.0001?dn:.0001);
    vec3 q=vWorld+l*t;
    float x=(length(q-uRingC)-uRingR.x)/(uRingR.y-uRingR.x);
    sh=1.-step(0.,t)*step(0.,x)*step(x,1.)*ringBands(clamp(x,0.,1.),uRingSeed)*uRingK;
  }
  vec3 col=alb*(uLightCol*diff*sh+uAmb);
  col+=uAtmo*exp(-pow(abs(ndl*3.4),2.))*.14*sh;
  vec3 h=normalize(l+v);
  col+=uLightCol*pow(max(dot(n,h),0.),70.)*gloss*diff*sh;
  col+=emit*(1.-smoothstep(-.12,.25,ndl))*(1.+uEnergy*.6);
  float fv=1.-clamp(dot(n,v),0.,1.);
  col+=uAtmo*fv*fv*fv*(.12+1.15*smoothstep(-.35,.6,ndl))*(1.+uEnergy*.8);
  col+=uAtmo*pow(fv,5.)*pow(max(dot(-v,l),0.),3.)*2.4;
  col+=uFillCol*fv*fv*smoothstep(-.1,.8,dot(n,uFill))*.55;
  // The limb, in the page's tint: f²·.35.
  col+=uIriCol*fv*fv*uIri;
  if(uKind>6.5)col=emit*(.5+.5*max(dot(n,v),0.))+uAtmo*pow(1.-clamp(dot(n,v),0.,1.),2.)*.8;
  if(uGrid>0.){
    float lat=asin(clamp(o.y,-1.,1.)),lon=atan(o.z,o.x);
    float grid=max(smoothstep(.97,1.,abs(cos(lat*9.))),smoothstep(.98,1.,abs(cos(lon*6.))));
    col+=uAtmo*grid*.07*(.4+fv)*uGrid;
  }
  gl_FragColor=vec4(col*uOpacity,uOpacity);
}`;

// Atmosphere: a camera-facing disc in front of the body; r = 1 on the limb. Additive.
export const HALO_VS = `
attribute vec2 aCorner;
uniform mat4 uProj,uView;
uniform vec3 uCenter;
uniform float uSize,uPush;
varying vec2 vUv;
void main(){
  vUv=aCorner;
  vec4 c=uView*vec4(uCenter,1.);
  c.xyz+=normalize(-c.xyz)*uPush;
  c.xy+=aCorner*uSize;
  gl_Position=uProj*c;
}`;
export const HALO_FS = PREC + `
varying vec2 vUv;
uniform vec3 uColor,uWarm;
uniform vec2 uLight2;
uniform float uExtent,uAlpha,uFall,uBack;
void main(){
  float r=length(vUv)*uExtent;
  vec2 dir=vUv/max(length(vUv),.0001);
  float lit=smoothstep(-.75,.95,dot(dir,uLight2));
  float out_=max(r-1.,0.);
  float halo=r<1.?smoothstep(.8,1.,r)*.55:exp(-out_*uFall);
  halo*=1.-smoothstep(uExtent*.72,uExtent,r);
  vec3 col=mix(uColor,uWarm,lit*lit)*halo*(.22+.95*lit)*uAlpha;
  col+=uWarm*uBack*halo*exp(-out_*uFall*.6)*.6;
  gl_FragColor=vec4(col,0.);
}`;

// Planetary rings: a flat annulus lit from the sun, glowing when seen against the light, in the planet's shadow.
export const RING_VS = `
attribute vec3 aRing;
uniform mat4 uProj,uView,uModel;
uniform vec2 uR;
varying vec3 vWorld;
varying float vX;
void main(){
  float r=mix(uR.x,uR.y,aRing.z);
  vec4 w=uModel*vec4(aRing.x*r,0.,aRing.y*r,1.);
  vWorld=w.xyz;vX=aRing.z;
  gl_Position=uProj*uView*w;
}`;
export const RING_FS = PREC + `
uniform sampler2D uNoise;
` + RING_BANDS + `
varying vec3 vWorld;
varying float vX;
uniform vec3 uCam,uLight,uLightCol,uRingN,uCenter,uColA,uColB,uColC;
uniform float uRad,uAlpha,uSeed;
void main(){
  float d=ringBands(vX,uSeed);
  vec3 col=mix(uColA,uColB,smoothstep(0.,.55,vX));
  col=mix(col,uColC,smoothstep(.5,1.,vX));
  vec3 v=normalize(uCam-vWorld);
  float ndl=dot(uRingN,uLight),ndv=dot(uRingN,v);
  float through=step(ndl*ndv,0.);
  float fwd=pow(max(dot(-v,uLight),0.),4.);
  float glow=mix(.25+.7*abs(ndl),.4+1.5*fwd,through);
  vec3 q=vWorld-uCenter;
  float bq=dot(q,uLight),disc=bq*bq-dot(q,q)+uRad*uRad;
  float inShadow=bq<0.?smoothstep(-.06,.12,disc/(uRad*uRad)):0.;
  float a=d*uAlpha;
  gl_FragColor=vec4(col*uLightCol*glow*(1.-inShadow*.62)*a,a*.82);
}`;

// Solid rings (gates, armillary spheres): polished metal reflecting the nebula, with running light dashes.
export const TORUS_VS = `
attribute vec3 aPos,aNrm;
attribute vec2 aUV;
uniform mat4 uProj,uView,uModel;
varying vec3 vWorld,vNrm;
varying vec2 vUV;
void main(){
  vec4 w=uModel*vec4(aPos,1.);
  vWorld=w.xyz;vNrm=mat3(uModel)*aNrm;vUV=aUV;
  gl_Position=uProj*uView*w;
}`;
export const TORUS_FS = PREC + `
varying vec3 vWorld,vNrm;
varying vec2 vUV;
uniform vec3 uCam,uLight,uBase,uEmit,uEnvA,uEnvB;
uniform float uTime,uDash,uSpeed,uAlpha,uSpin;
void main(){
  vec3 n=normalize(vNrm),v=normalize(uCam-vWorld);
  vec3 r=reflect(-v,n);
  float fres=.06+.94*pow(1.-clamp(dot(n,v),0.,1.),4.);
  vec3 env=mix(uEnvA,uEnvB,smoothstep(-.5,.7,r.y));
  env+=uEnvB*pow(max(dot(r,uLight),0.),36.)*2.5;
  vec3 col=uBase*(.1+.7*max(dot(n,uLight),0.))+env*(.25+fres);
  float k=fract(vUV.x*uDash-uTime*uSpeed+uSpin);
  float dash=smoothstep(0.,.02,k)*(1.-smoothstep(.16,.24,k));
  float rim=1.-smoothstep(.0,.2,min(vUV.y,1.-vUV.y));
  col+=uEmit*(dash*rim*1.3+rim*.1);
  gl_FragColor=vec4(col*uAlpha,uAlpha);
}`;

// Thick lines drawn as screen-space quads: soft core, travelling pulses. Additive.
export const BEAM_VS = `
attribute vec3 aA,aB;
attribute vec4 aInfo;
uniform mat4 uProj,uView,uModel;
uniform vec2 uRes;
uniform float uWidth;
varying vec2 vS;
varying float vPhase,vMix,vFade;
void main(){
  vec4 a=uProj*uView*uModel*vec4(aA,1.),b=uProj*uView*uModel*vec4(aB,1.);
  a.w=max(a.w,.05);b.w=max(b.w,.05);
  vec2 d=(b.xy/b.w-a.xy/a.w)*uRes;
  float l=length(d);
  d=l>.0001?d/l:vec2(1.,0.);
  vec4 p=aInfo.y<.5?a:b;
  vec2 px=(vec2(-d.y,d.x)*aInfo.x+d*(aInfo.y-.5)*1.2)*uWidth;
  p.xy+=px/uRes*2.*p.w;
  gl_Position=p;
  vS=aInfo.xy;vPhase=aInfo.z;vMix=aInfo.w;
  vFade=clamp(16./p.w,0.,1.);
}`;
export const BEAM_FS = PREC + `
varying vec2 vS;
varying float vPhase,vMix,vFade;
uniform vec3 uColA,uColB;
uniform float uAlpha,uTime,uPulse,uSpeed,uBuild;
void main(){
  float x2=vS.x*vS.x;
  float across=exp(-x2*3.2),core=exp(-x2*26.);
  float t=fract(vS.y-uTime*uSpeed+vPhase);
  float pulse=uPulse*exp(-pow(abs((t-.5)*10.),2.));
  vec3 col=mix(uColA,uColB,vMix);
  float a=(across*.5+core*.65+pulse*(across+core))*uAlpha*vFade;
  // Under construction: the line draws itself, a welding spark at its head, then fades and starts again.
  float prog=fract(uTime*.07+vPhase)*1.25;
  float drawn=1.-smoothstep(prog-.02,prog,vS.y);
  float spark=exp(-pow(abs((vS.y-prog)*30.),2.))*core*2.5*step(prog,1.);
  a*=mix(1.,drawn*(1.-smoothstep(1.,1.25,prog)),uBuild);
  gl_FragColor=vec4(col*a+core*pulse*a*.35+vec3(1.,.9,.7)*spark*uBuild*uAlpha*vFade,0.);
}`;

// Camera-facing sprites. uShape: 0 glow · 1 star with diffraction spikes · 2 bokeh disc · 3 lens ghost · 4 corona.
export const SPRITE_VS = `
attribute vec2 aCorner;
uniform mat4 uProj,uView;
uniform vec3 uCenter;
uniform vec2 uAspect;
uniform float uSize,uScreen;
varying vec2 vUv;
void main(){
  vUv=aCorner;
  vec4 c=uView*vec4(uCenter,1.);
  c.xy+=aCorner*uSize;
  gl_Position=uScreen>.5?vec4(uCenter.xy+aCorner*uSize*uAspect,0.,1.):uProj*c;
}`;
export const SPRITE_FS = PREC + `
varying vec2 vUv;
uniform vec3 uColor;
uniform float uAlpha,uCore,uRing,uShape,uRot,uTime;
void main(){
  vec2 p=vUv;float r=length(p),a;
  if(uShape<.5){
    a=exp(-r*r*3.6)*.55+exp(-r*r*uCore)+uRing*exp(-pow(abs((r-.62)*14.),2.));
    a*=1.-smoothstep(.8,1.,r);
  }else if(uShape<1.5){
    float c=cos(uRot),s=sin(uRot);
    vec2 q=vec2(c*p.x-s*p.y,s*p.x+c*p.y);
    float spikes=exp(-abs(q.x)*70.)*exp(-abs(q.y)*2.6)+exp(-abs(q.y)*70.)*exp(-abs(q.x)*2.6);
    a=exp(-r*r*uCore)+spikes*.65+exp(-r*r*7.)*.22;
    a*=1.-smoothstep(.85,1.,r);
  }else if(uShape<2.5){
    a=(1.-smoothstep(.9,1.,r))*(.5+.5*smoothstep(.5,.95,r));
  }else if(uShape<3.5){
    a=(1.-smoothstep(.84,1.,r))*(.18+.5*smoothstep(.55,.95,r));
  }else{
    float ang=atan(p.y,p.x);
    float rays=pow(.5+.5*sin(ang*7.+uTime*.3),6.)+pow(.5+.5*sin(ang*11.-uTime*.21+1.3),8.);
    a=exp(-r*r*uCore)+exp(-r*r*4.)*.6+rays*exp(-r*3.2)*.45;
    a*=1.-smoothstep(.8,1.,r);
  }
  a*=uAlpha;
  if(a<.002)discard;
  gl_FragColor=vec4(uColor*a,a);
}`;

// Stars and their motion streaks: two vertices per star, points at rest, lines while the camera moves.
export const STAR_VS = `
attribute vec3 aPos;
attribute vec3 aInfo; // x: brightness, y: 0 head / 1 tail, z: temperature
uniform mat4 uProj,uView;
uniform vec3 uStreak;
uniform float uPx,uTime;
varying float vB,vBig;
varying vec3 vCol;
void main(){
  vec4 v=uView*vec4(aPos,1.);
  v.xyz+=uStreak*aInfo.y*(.4+aInfo.x);
  gl_Position=uProj*v;
  float d=max(.6,-v.z);
  float big=step(.965,aInfo.x);
  gl_PointSize=mix(clamp(uPx*(1.1+aInfo.x*2.8)/d*6.,1.,5.*uPx),uPx*26.,big);
  float tw=.72+.28*sin(uTime*(1.3+aInfo.z*2.7)+aPos.x*13.1+aPos.z*7.3);
  vB=aInfo.x*(1.-aInfo.y*.85)*clamp(16./d,0.,1.)*tw;
  vBig=big;
  float t=aInfo.z;
  vCol=t<.2?mix(vec3(.45,.78,1.),vec3(.8,.9,1.),t*5.):t<.55?mix(vec3(.9,.94,1.),vec3(1.,.93,.86),(t-.2)/.35):t<.8?mix(vec3(1.,.85,.6),vec3(1.,.66,.36),(t-.55)/.25):mix(vec3(1.,.5,.75),vec3(.72,.55,1.),(t-.8)*5.);
}`;
export const STAR_FS = PREC + `
varying float vB,vBig;
varying vec3 vCol;
uniform float uAlpha,uPoint;
void main(){
  float a=vB*uAlpha;
  if(uPoint>.5){
    vec2 c=gl_PointCoord-.5;
    float r2=dot(c,c);
    float spikes=(exp(-abs(c.x)*60.)*exp(-abs(c.y)*5.)+exp(-abs(c.y)*60.)*exp(-abs(c.x)*5.))*vBig;
    a*=mix((1.-smoothstep(0.,.25,r2)),exp(-r2*160.)+spikes*.7+exp(-r2*22.)*.25,vBig);
  }
  gl_FragColor=vec4(vCol*a,a);
}`;

// Particles drawn as points. uMode: 0 static in model space (belts, nodes) · 1 flowing along a tangent
// (the stream between worlds) · 2 spiralling into the centre (accretion).
export const DUST_VS = `
attribute vec3 aPos,aDir;
attribute vec4 aInfo; // x: size, y: colour mix, z: phase, w: speed
uniform mat4 uProj,uView,uModel;
uniform vec3 uCam;
uniform float uPx,uTime,uMode,uLen,uNear;
varying float vA,vMix;
void main(){
  vec3 p=aPos;float a=1.;
  if(uMode>.5&&uMode<1.5){
    float s=fract(aInfo.z+uTime*aInfo.w);
    p+=aDir*(s-.5)*uLen;
    a=sin(s*3.1416);
  }else if(uMode>1.5){
    float s=fract(aInfo.z+uTime*aInfo.w*.05);
    float r=mix(aDir.x,aDir.y,1.-s*s);
    float ang=aDir.z+uTime*aInfo.w*.9/max(r,.15)+s*2.;
    p=vec3(cos(ang)*r,aPos.y*(1.-s),sin(ang)*r);
    a=smoothstep(0.,.15,s)*(1.-smoothstep(.75,1.,s));
  }
  vec4 w=uModel*vec4(p,1.);
  vec4 v=uView*w;
  gl_Position=uProj*v;
  float d=max(.25,-v.z);
  gl_PointSize=clamp(aInfo.x*uPx*5./d,1.,40.*uPx);
  a*=smoothstep(uNear,uNear*2.5,length(w.xyz-uCam))*clamp(30./d,0.,1.);
  vA=a;vMix=aInfo.y;
}`;
export const DUST_FS = PREC + `
varying float vA,vMix;
uniform vec3 uColA,uColB,uColC;
uniform float uAlpha;
void main(){
  vec2 c=gl_PointCoord-.5;
  float r2=dot(c,c);
  float a=((1.-smoothstep(0.,.25,r2))*.6+exp(-r2*40.)*.6)*vA*uAlpha;
  if(a<.004)discard;
  vec3 col=vMix<.5?mix(uColA,uColB,vMix*2.):mix(uColB,uColC,vMix*2.-1.);
  gl_FragColor=vec4(col*a,a);
}`;

// Sakura blossoms: small flowers in clusters around the twig tips. Each keeps its direction from its cluster's
// centre (aDir): the flowers on a cluster's outline, as the camera sees it, catch the backlight (a luminous
// rim, stronger on top) while the inside of the clusters stays a deep pink. Drawn over (they hide each other).
export const BLOSSOM_VS = `
attribute vec3 aPos,aDir;
attribute vec4 aInfo; // x: size, y: colour mix
uniform mat4 uProj,uView,uModel;
uniform vec3 uCam;
uniform float uPx,uSize;
uniform float uLitK[5];
uniform vec3 uLitC[5];
varying float vA,vMix,vRim,vGlow;
varying vec3 vGlowC;
void main(){
  int i=int(aInfo.w+.5);vGlow=uLitK[i];vGlowC=uLitC[i];
  vec4 w=uModel*vec4(aPos,1.);
  vec4 v=uView*w;
  gl_Position=uProj*v;
  float d=max(.25,-v.z);
  gl_PointSize=clamp(aInfo.x*uSize*uPx*5./d,1.,48.*uPx);
  vec3 n=normalize((uModel*vec4(aDir,0.)).xyz),toCam=normalize(uCam-w.xyz);
  float edge=1.-abs(dot(n,toCam));
  vRim=edge*edge*edge*(.45+.55*max(n.y,0.));
  vA=smoothstep(.25,.6,length(w.xyz-uCam));
  vMix=aInfo.y;
}`;
export const BLOSSOM_FS = PREC + `
varying float vA,vMix,vRim,vGlow;
varying vec3 vGlowC;
uniform vec3 uColA,uColB,uColC,uRimCol;
uniform float uAlpha;
void main(){
  vec2 c=gl_PointCoord-.5;
  float r2=dot(c,c);
  float a=((1.-smoothstep(0.,.25,r2))*.6+exp(-r2*40.)*.6)*vA*uAlpha;
  if(a<.004)discard;
  vec3 col=vMix<.5?mix(uColA,uColB,vMix*2.):mix(uColB,uColC,vMix*2.-1.);
  col=mix(col,uRimCol,vRim*.7);
  col=mix(col,vGlowC,vGlow*.3)*(1.+vGlow*.25);
  gl_FragColor=vec4(col*a,a);
}`;

// ---------- Identity layer: sakura petals, butterflies, mist ----------
// Petals tumble in the wind inside a box that wraps around the camera: they are wherever the viewer is,
// and rush past when the camera travels. Near petals are out of focus; light comes through them.
export const PETAL_VS = `
attribute vec4 aSeed;   // xyz: home in the box (0..1), w: size
attribute vec4 aRot;    // xyz: tumbling axis, w: spin speed
attribute vec4 aCorner; // xy: corner, z: phase, w: tint
uniform mat4 uProj,uView;
uniform vec3 uCam,uBox,uWind,uLight,uPtrDir,uBeamO,uBeamD;
uniform float uTime,uSize,uGust,uCalm,uPtrK,uBeamR,uFocus,uAperture,uTitleK,uAspect;
uniform vec4 uTitle; // the lit title: centre and half-size, in NDC
varying vec2 vUv;
varying float vA,vLit,vTint,vBlur,vBack,vSpec,vTitle;
vec3 rot(vec3 v,vec3 k,float a){float c=cos(a),s=sin(a);return v*c+cross(k,v)*s+k*dot(k,v)*(1.-c);}
void main(){
  float ph=aCorner.z*6.2832;
  vec3 sway=vec3(sin(uTime*.9+ph),sin(uTime*.63+ph*1.7)*.5,cos(uTime*.77+ph*.6))*(.25+uGust*.35);
  vec3 local=fract(aSeed.xyz+(uWind*uTime+sway-uCam)/uBox+.5)-.5;
  vec3 c=uCam+local*uBox;
  // The pointer is a breath of wind: petals near its ray are pushed aside and turn around it.
  if(uPtrK>0.){
    vec3 off=c-uCam;off-=uPtrDir*dot(off,uPtrDir);
    float dl=length(off),k=uPtrK*exp(-dl*dl*7.);
    c+=(off/max(dl,.001)*.35+cross(uPtrDir,off/max(dl,.001))*.25)*k;
  }
  // Depth of field per petal: its circle of confusion from the distance to the focus.
  float dc=-(uView*vec4(c,1.)).z;
  float coc=clamp(abs(dc-uFocus)*uAperture,0.,1.);
  vec3 ax=normalize(aRot.xyz);
  float ang=uTime*aRot.w*(1.+uGust)+ph;
  vec3 e1=rot(vec3(1.,0.,0.),ax,ang),e2=rot(vec3(0.,1.,0.),ax,ang);
  float s=uSize*(.55+.9*aSeed.w)*(1.+.8*coc);
  vec3 wp=c+(e1*aCorner.x*.75+e2*aCorner.y)*s;
  vec4 v=uView*vec4(wp,1.);
  gl_Position=uProj*v;
  float d=-v.z;
  vec3 e=abs(local)*2.;
  // At rest no petal comes close to the lens (it would cross the titles); in transit they rush past it.
  float nearCut=mix(.3,1.6,uCalm);
  vA=(1.-smoothstep(.72,1.,max(e.x,max(e.y,e.z))))*smoothstep(nearCut,nearCut*1.8,d);
  // The key light: lit where the beam crosses, nearly dark elsewhere.
  vec3 rel=wp-uBeamO,perp=rel-uBeamD*dot(rel,uBeamD);
  float beam=mix(.15,1.3,exp(-dot(perp,perp)/(uBeamR*uBeamR)));
  vec3 n=normalize(cross(e1,e2)),toCam=normalize(uCam-wp);
  vLit=(.62+.3*abs(dot(n,uLight)))*beam;
  vBack=pow(max(dot(-toCam,uLight),0.),2.)*beam;
  vec3 nf=n*sign(dot(n,toCam)+.0001);
  vSpec=pow(max(dot(reflect(-uLight,nf),toCam),0.),28.)*beam;
  vBlur=coc;
  // The lit title as a light: tint·.6/(1 + d²/r²), d in title heights from its box, r = 1.5.
  vec2 dd=max(abs(gl_Position.xy/gl_Position.w-uTitle.xy)-uTitle.zw,0.)*vec2(uAspect,1.)/max(uTitle.w*2.,.01);
  vTitle=uTitleK*.6/(1.+dot(dd,dd)/2.25);
  vUv=aCorner.xy;vTint=aCorner.w;
}`;
export const PETAL_FS = PREC + `
varying vec2 vUv;
varying float vA,vLit,vTint,vBlur,vBack,vSpec,vTitle;
uniform sampler2D uPetal;
uniform vec3 uColA,uColB,uColC,uTitleTint;
uniform float uAlpha;
void main(){
  // The sprite's petal (R membrane, G outline, B veins); the tip and its notch at the top of the texture,
  // 85 of its 128 rows. Out of focus, a coarser level.
  float y=vUv.y;
  vec3 s=texture2D(uPetal,vec2(vUv.x*.5+.5,(1.-y)*.333),vBlur*3.5).rgb;
  float a=s.r*vA*uAlpha*(.6+.25*vBack)/(1.+2.2*vBlur);
  if(a<.004)discard;
  // Sakura, pale (#ffe1ec), a little deeper at the base; lit by the key light, glowing against it.
  vec3 col=mix(uColA,uColB,smoothstep(-1.,.75,y));
  col=mix(col,uColC,vTint*.7);
  // Small on screen, a petal reads as a petal when it is a full silhouette: no outline, no veins.
  col*=vLit;
  col+=uColA*vBack*.35+vec3(1.,.86,.93)*vSpec*1.2+uTitleTint*vTitle;
  gl_FragColor=vec4(col*a,a);
}`;

// Phosphor persistence at tier 1, at half resolution: the history keeps the brighter of the scene and of itself,
// decayed per channel (red the slowest) minus an epsilon that brings an 8-bit history back to black.
export const PHOS_FS = PREC + `
varying vec2 vUv;
uniform sampler2D uSrc,uPrev;
uniform vec3 uDecay;
void main(){
  gl_FragColor=vec4(max(texture2D(uSrc,vUv).rgb,texture2D(uPrev,vUv).rgb*uDecay-3./255.),1.);
}`;

// Butterflies: two wings hinged on the body, flapping in the vertex shader; the sprite's wing as a texture.
export const BFLY_VS = `
attribute vec4 aWing; // x: 0 body → 1 tip, y: -1 tail → 1 head, z: side ±1, w: which butterfly
uniform vec4 uB0[12],uB1[12]; // xyz position, w size · xyz heading, w phase
uniform mat4 uProj,uView;
uniform float uTime;
varying vec2 vUv;
varying float vFlap,vHue;
void main(){
  int i=int(aWing.w+.5);
  vec4 b0=uB0[i],b1=uB1[i];
  vec3 f=normalize(b1.xyz+vec3(.0001,0.,0.));
  vec3 r=normalize(cross(f,vec3(0.,1.,0.))+vec3(0.,0.,.0001)),u=cross(r,f);
  // Each its own rhythm: three beats, then a glide with the wings half open (a 2.6 s cycle, ±10 %);
  // frequency and phase per butterfly, so they never beat together.
  float ph=b1.w,w=13.*(.85+.3*fract(ph*7.13));
  float cyc=fract(uTime/(2.6*(.9+.2*ph))+ph);
  float flap=mix(.35,sin(uTime*w+ph*6.2832)*.85+.2,1.-smoothstep(.5,.62,cyc));
  vec3 wing=(r*aWing.z*cos(flap)+u*sin(flap))*aWing.x+f*aWing.y*.82;
  gl_Position=uProj*uView*vec4(b0.xyz+wing*b0.w,1.);
  vUv=aWing.xy;vFlap=flap;vHue=b1.w;
}`;
export const BFLY_FS = PREC + `
varying vec2 vUv;
varying float vFlap,vHue;
uniform sampler2D uWing;
uniform vec3 uColA;
uniform float uAlpha;
void main(){
  // The sprite's wing (u: hinge to tip; v: head to tail over 213 of the texture's 256 rows), and a fine body.
  float a=texture2D(uWing,vec2(vUv.x,(1.-vUv.y)*.416)).a;
  a=max(a,.8*(1.-smoothstep(.015,.04,vUv.x))*(1.-smoothstep(.42,.55,abs(vUv.y))));
  if(a<.01)discard;
  // Sakura, a touch brighter as the wing opens to the light; premultiplied, drawn over.
  float shade=.62+.16*sin(vFlap);
  gl_FragColor=vec4(uColA*shade*a*uAlpha,a*uAlpha);
}`;

export const MIST_VS = `
attribute vec2 aCorner;
uniform mat4 uProj,uView;
uniform vec3 uCenter;
uniform float uSize;
varying vec2 vUv;
void main(){
  vUv=aCorner;
  vec4 c=uView*vec4(uCenter,1.);
  c.xy+=aCorner*uSize;
  gl_Position=uProj*c;
}`;
export const MIST_FS = PREC + `
uniform sampler2D uNoise;
varying vec2 vUv;
uniform vec3 uColA,uColB;
uniform float uAlpha,uTime,uSeed;
float n2(vec2 p){return texture2D(uNoise,p/256.).r;}
void main(){
  float r=length(vUv);
  vec2 p=vUv*42.+uSeed*37.;
  float n=n2(p+vec2(uTime*.6,uTime*.2))*.6+n2(p*2.1-vec2(uTime*.4,0.))*.4;
  float m=smoothstep(.38,.8,n)*(1.-smoothstep(.25,1.,r));
  float a=m*uAlpha;
  gl_FragColor=vec4(mix(uColA,uColB,n)*a,0.);
}`;

export const TREE_VS = `
attribute vec3 aPos,aNrm;
attribute float aV,aId;
uniform mat4 uProj,uView,uModel;
uniform float uLitK[5];
uniform vec3 uLitC[5];
varying vec3 vWorld,vNrm,vGlowC;
varying float vV,vGlow;
void main(){
  vec4 w=uModel*vec4(aPos,1.);
  vWorld=w.xyz;vNrm=mat3(uModel)*aNrm;vV=aV;
  // The branch of the domain pointed at (index 4: trunk, roots, leader, never lit).
  int i=int(aId+.5);vGlow=uLitK[i];vGlowC=uLitC[i];
  gl_Position=uProj*uView*w;
}`;
export const TREE_FS = PREC + `
varying vec3 vWorld,vNrm,vGlowC;
varying float vV,vGlow;
uniform vec3 uCam,uHeart,uBark,uRim,uFill,uSap;
uniform float uTime;
void main(){
  vec3 n=normalize(vNrm),v=normalize(uCam-vWorld);
  vec3 toH=uHeart-vWorld;float dh=length(toH);toH/=max(dh,.0001);
  float lit=max(dot(n,toH),0.)/(1.+dh*dh*3.);
  // A thin rim of light along the edges of the wood (the backlight), not a glow over it.
  float fres=pow(1.-clamp(dot(n,v),0.,1.),5.);
  float grain=.78+.22*sin(vWorld.y*85.+sin(vWorld.x*37.+vWorld.z*23.)*3.);
  vec3 col=uBark*grain*(.3+lit*1.4)+uRim*fres*(.5+lit*1.2)+uFill*max(-n.y,0.)*.3;
  col+=uSap*smoothstep(.95,1.,fract(vV*3.-uTime*.22))*(1.-vV*.5)*.4;
  // Lit in its domain's tint: a glow on the wood, brightest along its edges.
  col+=vGlowC*vGlow*(.16+fres*1.3);
  gl_FragColor=vec4(col,1.);
}`;

// Black water mirror under the tree's island: the reflection is rendered beforehand from the mirrored
// camera; the slow swell and the rings of the neon rain bend it; grazing angles reflect more.
export const WATER_VS = `
attribute vec2 aCorner;
uniform mat4 uProj,uView;
uniform vec3 uC;
uniform float uR;
varying vec3 vWorld;
varying vec2 vRel;
void main(){
  vRel=aCorner;
  vWorld=vec3(uC.x+aCorner.x*uR,uC.y,uC.z+aCorner.y*uR);
  gl_Position=uProj*uView*vec4(vWorld,1.);
}`;
export const WATER_FS = PREC + `
uniform sampler2D uNoise,uRefl;
varying vec3 vWorld;
varying vec2 vRel;
uniform vec2 uRes;
uniform vec3 uCam,uDeep,uNeonA,uNeonB;
uniform float uTime,uRain,uHasRefl,uAlpha;
float hh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
  float r=length(vRel);
  float edge=1.-smoothstep(.55,1.,r);
  if(edge<.003)discard;
  vec2 p=vWorld.xz;
  vec2 swell=vec2(texture2D(uNoise,p*.11+vec2(uTime*.012,0.)).r,texture2D(uNoise,p*.11+vec2(.5,uTime*.01)).b)-.5;
  vec2 ring=vec2(0.);
  for(int i=0;i<2;i++){
    vec2 q=p*(4.+float(i)*2.3)+float(i)*7.1;
    vec2 cell=floor(q),f=fract(q)-.5;
    vec2 c=vec2(hh(cell),hh(cell+3.7))-.5;
    float ph=fract(uTime*(.6+hh(cell+1.3)*.5)+hh(cell+9.1));
    vec2 d=f-c*.6;float dl=length(d);
    ring+=d/max(dl,.001)*sin((dl-ph*.45)*45.)*(1.-smoothstep(0.,.45,dl))*(1.-ph);
  }
  vec2 nrm=swell*.8+ring*.5*uRain;
  vec3 refl=uHasRefl>.5?texture2D(uRefl,clamp(gl_FragCoord.xy/uRes+nrm*.02,0.,1.)).rgb:vec3(0.);
  vec3 v=normalize(uCam-vWorld);
  float fres=.22+.78*pow(1.-clamp(v.y,0.,1.),2.5);
  vec3 col=uDeep+refl*fres*.92;
  col+=mix(uNeonA,uNeonB,hh(floor(p*3.)))*pow(clamp(length(nrm)*1.3,0.,1.),3.)*.3;
  float a=edge*uAlpha;
  gl_FragColor=vec4(col*a,a);
}`;

// Repères, "une même façon de regarder": the world is the pupil of a cosmic eye; around it an iris of light
// fibres (warm collarette near the pupil, cool towards the limbal ring), turning slowly. Additive annulus.
export const IRIS_VS = `
attribute vec3 aRing;
uniform mat4 uProj,uView,uModel;
uniform vec2 uR;
varying vec2 vP;
varying float vX;
void main(){
  float r=mix(uR.x,uR.y,aRing.z);
  vP=aRing.xy;vX=aRing.z;
  gl_Position=uProj*uView*uModel*vec4(aRing.x*r,0.,aRing.y*r,1.);
}`;
export const IRIS_FS = PREC + `
uniform sampler2D uNoise;
varying vec2 vP;
varying float vX;
uniform vec3 uColA,uColB,uColC;
uniform float uSpin,uAlpha;
void main(){
  // The angle per fragment (an angle per vertex would tear where it wraps); whole turns of the repeat-wrapped
  // noise (7 and 11 per turn) keep the seam invisible, and stay coarse enough not to shimmer without mipmaps.
  float a=atan(vP.y,vP.x)/6.2832+uSpin;
  float fibres=texture2D(uNoise,vec2(a*7.,vX*.08+.31)).r*.65+texture2D(uNoise,vec2(a*11.,vX*.15+.73)).b*.35;
  float crypt=1.-smoothstep(.55,.75,texture2D(uNoise,vec2(a*3.,vX*.6+.17)).r);
  float cd=(vX-.28)*9.,collar=exp(-cd*cd);
  vec3 col=mix(uColA,uColB,smoothstep(.15,.55,vX));
  col=mix(col,uColC,smoothstep(.6,1.,vX));
  float k=(pow(fibres,2.2)*1.4*crypt+collar*.7)*smoothstep(0.,.08,vX)*(1.-smoothstep(.86,1.,vX));
  gl_FragColor=vec4(col*k*uAlpha,0.);
}`;

// Light shafts: the bright pass smeared towards the light's place on screen (sun, central star, Lumina).
export const RAYS_FS = PREC + `
varying vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uSun;
uniform float uDensity,uDecay,uExposure;
void main(){
  vec2 uv=vUv,d=(vUv-uSun)*uDensity/24.;
  vec3 acc=vec3(0.);float w=1.;
  for(int i=0;i<24;i++){uv-=d;acc+=texture2D(uSrc,clamp(uv,0.,1.)).rgb*w;w*=uDecay;}
  gl_FragColor=vec4(acc*uExposure/24.,1.);
}`;

// ---------- Bloom: bright pass, then a dual-filter blur pyramid (down, then up while adding levels) ----------
export const BLOOM_VS = QUAD_VS;
export const PREFILTER_FS = PREC + `
varying vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uTh,uKnee;
void main(){
  vec3 c=texture2D(uSrc,vUv+uTexel*vec2(-1.,-1.)).rgb+texture2D(uSrc,vUv+uTexel*vec2(1.,-1.)).rgb
        +texture2D(uSrc,vUv+uTexel*vec2(-1.,1.)).rgb+texture2D(uSrc,vUv+uTexel*vec2(1.,1.)).rgb;
  c*=.25;
  float br=max(c.r,max(c.g,c.b));
  float soft=clamp(br-uTh+uKnee,0.,2.*uKnee);
  soft=soft*soft/(4.*uKnee+.0001);
  gl_FragColor=vec4(c*max(soft,br-uTh)/max(br,.0001),1.);
}`;
export const DOWN_FS = PREC + `
varying vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
void main(){
  vec3 s=texture2D(uSrc,vUv).rgb*4.;
  s+=texture2D(uSrc,vUv-uTexel).rgb;
  s+=texture2D(uSrc,vUv+uTexel).rgb;
  s+=texture2D(uSrc,vUv+vec2(uTexel.x,-uTexel.y)).rgb;
  s+=texture2D(uSrc,vUv-vec2(uTexel.x,-uTexel.y)).rgb;
  gl_FragColor=vec4(s*.125,1.);
}`;
export const UP_FS = PREC + `
varying vec2 vUv;
uniform sampler2D uSrc,uBase;
uniform vec2 uTexel;
uniform float uMix;
void main(){
  vec2 h=uTexel;
  vec3 s=texture2D(uSrc,vUv+vec2(-h.x*2.,0.)).rgb;
  s+=texture2D(uSrc,vUv+vec2(-h.x,h.y)).rgb*2.;
  s+=texture2D(uSrc,vUv+vec2(0.,h.y*2.)).rgb;
  s+=texture2D(uSrc,vUv+vec2(h.x,h.y)).rgb*2.;
  s+=texture2D(uSrc,vUv+vec2(h.x*2.,0.)).rgb;
  s+=texture2D(uSrc,vUv+vec2(h.x,-h.y)).rgb*2.;
  s+=texture2D(uSrc,vUv+vec2(0.,-h.y*2.)).rgb;
  s+=texture2D(uSrc,vUv+vec2(-h.x,-h.y)).rgb*2.;
  gl_FragColor=vec4(s/12.+texture2D(uBase,vUv).rgb*uMix,1.);
}`;

// ---------- Post: compose scene + bloom, then the signal identity ----------
export const POST_VS = QUAD_VS;
export const POST_FS = PREC + `
varying vec2 vUv;
uniform sampler2D uScene,uBloom,uNoise,uRays,uPrev;
uniform vec2 uRes;
uniform float uTime,uVel,uGlitch,uFade,uScan,uBloomK,uWarp,uSat,uHasBloom,uScrim,uRaysK,uCurve,uMask,uPx,uLine,uFeather;
uniform float uShowZones,uPool;
uniform vec3 uPersist;
uniform vec4 uZone[12];
uniform float uZoneK[12];
uniform vec3 uTint;
float h1(float x){return fract(sin(x*127.1)*43758.5453);}
void main(){
  // Safe zones: boxes of the page's text (titles, paragraphs, the HUD), with a wide soft falloff around them.
  // Behind them a bright background is dimmed and the signal never slips.
  vec2 px=vUv*uRes;
  float zone=0.;
  for(int i=0;i<12;i++){
    vec4 z=uZone[i]*uRes.xyxy;
    vec2 d=abs(px-(z.xy+z.zw)*.5)-abs(z.zw-z.xy)*.5;
    float sdf=length(max(d,0.))+min(max(d.x,d.y),0.);
    // The whole ceiling inside the text's own box; around it a wide gaussian, so no box ever shows.
    zone=max(zone,uZoneK[i]*(sdf<=0.?1.:exp(-sdf*sdf/(uFeather*uFeather))));
  }
  float calm=1.-zone;
  // Tube: the picture bulges a little, like the glass of a cathode-ray tube; beyond its edge, black.
  vec2 q=vUv-.5,qa=q*vec2(uRes.x/uRes.y,1.);
  vec2 tube=.5+q*(1.+uCurve*dot(qa,qa));
  float glass=smoothstep(0.,.006,min(tube.x,1.-tube.x))*smoothstep(0.,.006,min(tube.y,1.-tube.y));
  vec2 uv=tube;
  // Signal slices: quantised in time so the glitch reads as digital, never as a smooth wobble. The pattern
  // changes at most 6 times a second: no more than three flashes a second (WCAG 2.3.1). A light glitch (the
  // ambient one) cuts thin bands, only a strong one (a gate) wide ones; none of them crosses the text.
  float step_=floor(uTime*6.);
  float bands=mix(24.,48.,h1(step_)),band=floor(uv.y*bands);
  // One band only, for a change of page (the world never glitches at rest).
  float one=(1.-step(.5,abs(band-floor(h1(step_+2.)*bands))))*step(.001,uGlitch);
  float slice=one*(h1(band*1.3+step_)-.5)*calm;
  uv.x+=slice*.11*uGlitch;
  // Analogue line jitter: the scanlines wander by a fraction of a pixel, only while the signal glitches.
  float line=floor(vUv.y*uRes.y*.5);
  uv.x+=(h1(line+floor(uTime*30.))-.5)*uGlitch*.004*calm;
  vec2 dir=uv-.5;
  uv+=dir*(uGlitch*.0075*step(.74,h1(step_+4.)));
  float ab=(.001+uVel*.0018+uGlitch*.01)*length(uv-.5)*2.;
  vec3 col;
  if(uWarp>.002){
    // Warp: the picture is smeared towards the vanishing point while the camera rushes between worlds.
    col=vec3(0.);
    for(int i=0;i<6;i++){
      vec2 u2=uv-dir*(float(i)/5.)*uWarp;
      col+=vec3(texture2D(uScene,clamp(u2+dir*ab,0.,1.)).r,texture2D(uScene,clamp(u2,0.,1.)).g,texture2D(uScene,clamp(u2-dir*ab,0.,1.)).b);
    }
    col/=6.;
  }else{
    col=vec3(texture2D(uScene,clamp(uv+dir*ab+vec2(slice*.02,0.),0.,1.)).r,texture2D(uScene,clamp(uv,0.,1.)).g,texture2D(uScene,clamp(uv-dir*ab,0.,1.)).b);
  }
  if(uHasBloom>.5)col+=texture2D(uBloom,clamp(uv,0.,1.)).rgb*uBloomK*vec3(1.05,.98,.9);
  if(uRaysK>0.)col+=texture2D(uRays,clamp(uv,0.,1.)).rgb*uRaysK;
  // Highlights roll off instead of clipping, then a touch more colour.
  vec3 hi=max(col-.78,0.);
  col=min(col,.78)+.22*(1.-exp(-hi*4.5));
  float luma=dot(col,vec3(.2126,.7152,.0722));
  col=max(mix(vec3(luma),col,uSat),0.);
  // The tube: one beam line per 3 CSS pixels, thicker where the picture is bright; a faint aperture-grille
  // phosphor mask; grain (it also dithers the dark gradients); warm phosphor in the blacks; vignette.
  // Nothing in it moves by itself.
  float fy=fract(gl_FragCoord.y/uLine);
  float lum=dot(col,vec3(.299,.587,.114));
  float bd=(fy-.5)*2.,beam=exp(-bd*bd*mix(4.2,1.1,clamp(lum,0.,1.)));
  col*=mix(1.,beam*1.3,uScan);
  float mx=mod(floor(gl_FragCoord.x/max(1.,uPx)),3.);
  vec3 mask=mx<1.?vec3(1.,.72,.78):mx<2.?vec3(.74,1.,.76):vec3(.76,.74,1.);
  col*=mix(vec3(1.),mask*1.14,uMask);
  float g=texture2D(uNoise,gl_FragCoord.xy/256.+vec2(h1(floor(uTime*24.)),h1(floor(uTime*24.)+7.))).b;
  col+=(g-.5)*.03;
  // Phosphor: blacks never reach black, and glow warm.
  col=max(col,vec3(.014,.009,.008));
  float vig=(1.-smoothstep(.32,1.2,length((vUv-.5)*vec2(1.12,1.))));
  col*=mix(.5,1.,vig);
  col*=1.-uScrim*(1.-smoothstep(.2,.72,vUv.y));
  // The Entrée keeps a soft pool of shade in the middle, where the title and its lines stand (a wide gaussian,
  // no edge), so its light gathers towards the edges and the ceiling below seldom has to act.
  col*=1.-uPool*.45*exp(-dot(qa*vec2(1.2,2.2),qa*vec2(1.2,2.2))*2.);
  // Behind the text the world never goes above a luminance of .04 (the ceiling for --muted text).
  col*=mix(1.,min(1.,.04/max(dot(col,vec3(.2126,.7152,.0722)),.0001)),zone);
  // Glitch flashes lift the blacks for a frame or two, like a tube losing sync (not behind the text).
  col+=uTint*uGlitch*.06*step(.7,h1(step_+9.))*calm;
  col*=uFade*glass;
  // Phosphor persistence: what was brighter a frame ago fades out instead of vanishing, per channel (red the
  // slowest: whatever fades turns pink); the epsilon brings an 8-bit history back to black.
  // Weighted by the history's luminance: only bright lights trail, the nebula and the planets' faces never smear.
  if(uPersist.r>0.){vec3 pv=texture2D(uPrev,vUv).rgb;float pk=smoothstep(.30,.60,dot(pv,vec3(.2126,.7152,.0722)));col=max(col,pv*uPersist*pk-3./255.);}
  col=mix(col,vec3(.15,.9,.45),zone*.3*uShowZones);
  gl_FragColor=vec4(col,1.);
}`;
