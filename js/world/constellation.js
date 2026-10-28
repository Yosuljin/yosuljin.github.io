// Aether constellation: the project map as a field of light, in WebGL 1 without any dependency.
// aether.js loads it only in FULL 3D with motion allowed; LITE, reduced motion and browsers without
// WebGL keep the SVG map. The SVG also stays the accessible layer in FULL: its nodes keep focus,
// keyboard, pointer, the detail panel and the links to the sheets. Each frame they are moved onto
// the projected stars, so what is drawn is what is clicked.
import { every, wake } from "../core/loop.js?v=20261014-r1";

const TAU = Math.PI * 2;
// Map units are the SVG viewBox (1000 × 660); TheHive sits at (500, 300). The camera looks at
// TheHive from CAM units away, and the scene sways around it.
const VW = 1000, VH = 660, CX = 500, CY = 300, CAM = 1400;

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
// Palette (styles.css 02, read from the body as world.js does; the hex values are its fallbacks): dev cyan,
// photo sunset orange, writing orchid, worlds periwinkle, Aether gold, accent; sakura for the butterfly,
// --dim for work from other hands.
const token = (name, fallback) => {
  let v = "";
  try { v = getComputedStyle(document.body || document.documentElement).getPropertyValue(name).trim(); } catch {}
  return hex(/^#[0-9a-f]{6}$/i.test(v) ? v : fallback);
};
const CYAN = token("--acc-dev", "#2ee8ff"), AMBER = token("--acc-photo", "#ff9d3a"), MAGENTA = token("--acc-writing", "#e86bff"), VIOLET = token("--acc-worlds", "#7a6cff"), GOLD = token("--acc-aether", "#ffd25a"), PINK = token("--accent", "#ff5fa2");
const SAKURA = token("--sakura", "#ffd1e3"), DIM = token("--dim", "#a48d9e");
const WHITE = [1, 1, 1];

// Everything is read from the SVG map (RÉMANENCE §8.2): a node's role is its class, work from other
// hands carries data-owner="inscrit". Hue and depth derive from the role, never from a name.
// Kind 7 is the decor stars.
const KIND = { core: 0, inner: 1, noyau: 2, future: 3, code: 4, vision: 5, inscrit: 6 };
// Warm core, Lumina's accent, magenta language, violet specification and vision, cyan code; work from
// other hands a hollow ring in --dim at .45, without a role's colour.
const KIND_HUE = [GOLD, PINK, MAGENTA, VIOLET, CYAN, VIOLET, DIM.map(v => v * 0.45)];
// Depth in front of (+) or behind (-) TheHive, in map units: code comes forward, the language a little
// less, what is only specified or envisioned sits behind, work from other hands further back. Near the
// frame a forward node is drawn back to TheHive's plane: its label has little room for the parallax.
const KIND_DEPTH = [0, 0, 90, -110, 170, -50, -120];
const depthOf = (kind, at) => {
  const base = KIND_DEPTH[kind];
  if (base <= 0) return base;
  const ex = Math.abs(at[0] - CX) / CX, ey = at[1] < CY ? (CY - at[1]) / CY : (at[1] - CY) / (VH - CY);
  const t = Math.min(1, Math.max(0, (Math.max(ex, ey) - 0.45) / 0.4));
  return Math.round(base * (1 - t * t * (3 - 2 * t)));
};
// Relation types, as in the legend: core architecture (solid), build dependency (dashed), role (dotted);
// type 3 is a documented relation of work from other hands (dotted, at 30 %, in --dim).
const LINK = { noyau: [0, GOLD], build: [1, CYAN], role: [2, MAGENTA] };

const rng = seed => {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

// Loopback QA only (as world.js): ?qa=nozoom,noorbit,noignite isolates a camera movement, ?qa=noimpulse,
// nodive,noheart a lot G effect; ?qa=prof times the frames.
const QA = (() => {
  const flags = new Set();
  let local = false;
  try {
    local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    if (local) new URLSearchParams(location.search).get("qa")?.split(",").forEach(f => flags.add(f.trim()));
  } catch {}
  return { local, off: name => flags.has("no" + name), on: name => flags.has(name) };
})();

// ---------- Shaders ----------
// Every vertex shader places points with the same projection as project() below: a slight sway,
// then a camera that slides parallel to the map (uEye) while keeping the plane of TheHive still,
// so near and far things glide past each other.
const PLACE = `
uniform mat3 uRot;
uniform vec4 uMap;
uniform vec2 uEye;
uniform float uDpr;
uniform float uMaxPt;
vec4 place(vec3 p, out float k) {
  vec3 q = uRot * p;
  k = ${CAM.toFixed(1)} / max(${CAM.toFixed(1)} - q.z, 60.0);
  vec2 v = (q.xy - uEye) * k + uEye;
  return vec4(uMap.z + uMap.x * v.x, uMap.w + uMap.y * v.y, 0.0, 1.0);
}`;
const HIGH = "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n";

const BG_VS = `attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;
// Nebula behind the map: palette clouds anchored to the map, drifting slowly, dimmed while a node is read.
const BG_FS = `${HIGH}
uniform vec2 uRes;
uniform vec3 uView;
uniform vec2 uPar;
uniform vec4 uPh;
uniform vec2 uRoll;
uniform float uDim;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float blob(vec2 p, vec2 c, float r) { vec2 d = (p - c) / r; return exp(-dot(d, d)); }
void main() {
  vec2 m = vec2(gl_FragCoord.x - uView.y, uRes.y - gl_FragCoord.y - uView.z) / uView.x + uPar;
  float n = noise(m * 0.0065 + 1.5 * vec2(sin(uPh.x), cos(uPh.y))) * 0.62 + noise(m * 0.019 - 1.5 * vec2(cos(uPh.z), sin(uPh.w))) * 0.38;
  vec3 col = vec3(0.016, 0.010, 0.042);
  // Palette clouds (styles.css 02, as vec3 = hex / 255): worlds periwinkle #7a6cff, writing orchid #e86bff,
  // dev cyan #2ee8ff, photo orange #ff9d3a; TheHive's gold #ffd25a in the middle.
  col += vec3(0.478, 0.424, 1.0) * 0.36 * blob(m, vec2(150.0 + 40.0 * sin(uPh.x), 110.0), 440.0) * (0.4 + n);
  col += vec3(0.910, 0.420, 1.0) * 0.30 * blob(m, vec2(880.0, 570.0 + 30.0 * cos(uPh.y)), 410.0) * (0.35 + n);
  col += vec3(0.180, 0.910, 1.0) * 0.20 * blob(m, vec2(860.0 + 40.0 * sin(uPh.z), 60.0), 350.0) * (0.25 + 1.2 * n);
  col += vec3(1.0, 0.616, 0.227) * 0.18 * blob(m, vec2(120.0, 630.0), 330.0) * (0.35 + n);
  col += vec3(1.0, 0.824, 0.353) * 0.16 * blob(m, vec2(500.0, 300.0), 220.0);
  // Faint light shafts fanning out of TheHive through the nebula, turning very slowly.
  vec2 hc = m - vec2(500.0, 300.0);
  float ha = atan(hc.y, hc.x + 0.0001), hd = length(hc);
  float fan = 0.5 + 0.5 * sin(ha * 9.0 + 1.6 * sin(ha * 4.0 + uPh.x) + uPh.y);
  col += vec3(1.0, 0.86, 0.55) * 0.055 * pow(fan, 6.0) * exp(-hd / 300.0) * smoothstep(40.0, 120.0, hd) * (0.6 + 0.4 * n);
  // A faint galactic band across the map (turning with the stars), its dust lanes darker.
  vec2 w = vec2(m.x - 500.0, 300.0 - m.y);
  w = vec2(w.x * uRoll.x + w.y * uRoll.y, w.y * uRoll.x - w.x * uRoll.y);
  float along = dot(w, vec2(0.814, 0.581)), across = dot(w, vec2(-0.581, 0.814));
  float lane = 1.0 - 0.55 * smoothstep(0.5, 0.78, noise(w * 0.028 + 1.5 * vec2(sin(uPh.y), cos(uPh.x))));
  vec3 tone = mix(vec3(0.478, 0.424, 1.0), vec3(0.910, 0.420, 1.0), smoothstep(-500.0, 150.0, along));
  tone = mix(tone, vec3(1.0, 0.616, 0.227), smoothstep(150.0, 700.0, along));
  col += tone * 0.1 * exp(-across * across / 26000.0) * (0.35 + 0.9 * n) * lane;
  col *= 1.0 - 0.3 * uDim;
  vec2 v = gl_FragCoord.xy / uRes - 0.5;
  col *= 1.0 - 0.9 * dot(v, v);
  col += (hash(gl_FragCoord.xy * 0.731 + uPh.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;

// Distant stars: the field turns slowly on itself and twinkles.
const STAR_VS = `${PLACE}
attribute vec4 aA;
attribute vec4 aB;
uniform vec2 uRoll;
uniform float uTime;
varying vec3 vC;
void main() {
  vec3 p = vec3(aA.x * uRoll.x - aA.y * uRoll.y, aA.x * uRoll.y + aA.y * uRoll.x, aA.z);
  float k;
  gl_Position = place(p, k);
  // A faint, slow shimmer, never a twinkle.
  float tw = 0.62 + 0.1 * sin(uTime * (0.3 + fract(aB.w * 7.31) * 0.7) + aB.w * 6.2831);
  gl_PointSize = clamp(aA.w * uDpr * k, 1.0, uMaxPt);
  vC = aB.rgb * tw * min(1.0, aA.w * uDpr * k);
}`;
const DOT_FS = `precision mediump float;
varying vec3 vC;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vC * (exp(-r2 * 3.2) * 0.75 + (1.0 - smoothstep(0.0, 0.3, r2)) * 0.25), 1.0);
}`;

// Things that turn: TheHive's lattice and rings, sparks around the projects, dust in the volume.
// aO = radius, height, phase, speed; aT = tilt around x, tilt around z, size (CSS px), kind.
const ORBIT_VS = (slots) => `${PLACE}
attribute vec4 aC;
attribute vec4 aO;
attribute vec4 aT;
attribute vec3 aCol;
uniform vec4 uNode[${slots}];
varying vec3 vC;
void main() {
  vec4 st = uNode[int(aC.w + 0.5)];
  float a = aO.z + aO.w * st.w;
  vec3 p = vec3(cos(a) * aO.x, aO.y, sin(a) * aO.x);
  float cx = cos(aT.x), sx = sin(aT.x), cz = cos(aT.y), sz = sin(aT.y);
  p = vec3(p.x, p.y * cx - p.z * sx, p.y * sx + p.z * cx);
  p = vec3(p.x * cz - p.y * sz, p.x * sz + p.y * cz, p.z);
  float k;
  gl_Position = place(aC.xyz + p, k);
  float front = 0.5 + 0.5 * clamp((uRot * p).z / max(length(p), 1.0), -1.0, 1.0);
  float b = st.z * (0.3 + 0.7 * front) * (1.0 + 1.3 * st.x + 0.5 * st.y);
  if (aT.w < 0.5) {
    // The core's band of light runs on its own clock (quicker when read). Read (G3), waves of light cross
    // its cells from pole to pole, the lumens at work: at rest (st.x = 0) nothing of them.
    float lat = aO.y / max(length(aO.xy), 1.0), e = lat - sin(st.w * 0.3), e2 = lat - sin(st.w * 0.9 + 2.0);
    b *= (0.55 + 0.9 * exp(-e * e * 10.0)) * (1.0 + st.x * 1.1 * exp(-e2 * e2 * 12.0));
  }
  gl_PointSize = clamp(aT.z * uDpr * k * (1.0 + 0.3 * st.x), 1.0, uMaxPt);
  vC = aCol * b;
}`;

// Transient light: one shooting star a minute at most, far behind the map (desktop only: uGlow.x is
// zero elsewhere), and slow impulses running from Lumina to the walls of TheHive.
// aF = slot, point index along the streak (0 = head), kind, points per streak.
const FLASH_VS = `${PLACE}
attribute vec4 aF;
uniform float uTime;
uniform vec4 uHive;
uniform vec2 uGlow;
varying vec3 vC;
float h1(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }
void main() {
  float slot = aF.x, i = aF.y, n = aF.w;
  vec3 p, col;
  float b, size;
  if (aF.z < 0.5) {
    // One slot on a 64 s cycle, the first about 24 s in.
    float period = 64.0, shift = 40.0;
    float cyc = floor((uTime + shift) / period), local = uTime + shift - cyc * period, seed = cyc * 7.13 + slot * 1.37;
    float side = h1(seed + 3.0) < 0.5 ? -1.0 : 1.0, ang = 0.35 + h1(seed + 2.0) * 0.6;
    vec2 dir = vec2(side * cos(ang), -sin(ang));
    vec2 start = vec2(h1(seed) * 1300.0 - 650.0 - dir.x * 380.0, h1(seed + 1.0) * 500.0 + 120.0);
    p = vec3(start + dir * (local * 1100.0 - i * 10.0), -900.0);
    b = (1.0 - i / n) * step(local, 1.0) * smoothstep(0.0, 0.12, local) * (1.0 - smoothstep(0.6, 1.0, local)) * uGlow.x;
    col = mix(vec3(0.62, 0.86, 1.0), vec3(1.0), 0.55 * (1.0 - i / n));
    size = 2.6 - 1.4 * i / n;
  } else {
    // An impulse every three seconds or so: it runs out along a gentle bow in a third of a second and
    // fades within the second.
    float period = 9.1 + slot * 3.3, shift = slot * 2.3;
    float cyc = floor((uTime + shift) / period), local = uTime + shift - cyc * period, seed = cyc * 3.71 + slot * 11.3;
    float u = h1(seed) * 2.0 - 1.0, phi = h1(seed + 1.0) * 6.2831853, t = i / (n - 1.0);
    vec3 dir = vec3(sqrt(1.0 - u * u) * cos(phi), u, sqrt(1.0 - u * u) * sin(phi));
    vec3 a = normalize(cross(dir, vec3(0.31, 0.95, 0.12))), c = cross(dir, a);
    vec2 bow = vec2(h1(seed + 4.0), h1(seed + 5.0)) - 0.5;
    p = uHive.xyz + (dir * (0.16 + 0.82 * t) + (a * bow.x + c * bow.y) * 0.35 * sin(t * 3.14159)) * uHive.w;
    float reach = step(t, smoothstep(0.0, 0.3, local) * 1.05);
    b = reach * step(local, 0.9) * (1.0 - smoothstep(0.3, 0.9, local)) * (0.75 + 0.25 * h1(seed + i)) * 0.8 * uGlow.y;
    col = mix(vec3(1.0, 0.373, 0.635), vec3(1.0), 0.5);
    size = 2.2;
  }
  float k;
  gl_Position = place(p, k);
  gl_PointSize = clamp(size * uDpr * k, 1.0, uMaxPt);
  vC = col * b;
}`;

// Sakura petals drifting through the depth of the scene: the sprite's petal in the quad, spinning
// and flipping as it falls; near petals are larger and out of focus.
// aP = x, y, z (map units, y up), seed. uFall = half fall height, half drift width, light.
// uAvoid = a place no petal goes near (work from other hands), its radius in w (0: none).
const PETAL_VS = `${PLACE}
attribute vec2 aCorner;
attribute vec4 aP;
uniform float uTime;
uniform vec3 uFall;
uniform vec4 uAvoid;
varying vec2 vUv;
varying vec2 vLook;
float h1(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }
void main() {
  float f = (1400.0 - aP.z) / 1400.0, sd = aP.w, H = uFall.x * f, Wd = uFall.y * f;
  float y = mod(aP.y - uTime * (14.0 + 20.0 * h1(sd)) + H, 2.0 * H) - H;
  float x = mod(aP.x + uTime * (6.0 + 8.0 * h1(sd + 1.0)) + sin(uTime * (0.25 + 0.35 * h1(sd + 2.0)) + sd * 6.28) * (30.0 + 40.0 * h1(sd + 3.0)) + Wd, 2.0 * Wd) - Wd;
  float k;
  vec4 c = place(vec3(x, y, aP.z), k);
  float ka;
  vec4 av = place(uAvoid.xyz, ka);
  float away = uAvoid.w > 0.0 ? smoothstep(uAvoid.w, uAvoid.w * 1.8, length((c.xy - av.xy) / uMap.xy)) : 1.0;
  float spin = uTime * (0.3 + 0.7 * h1(sd + 4.0)) * (h1(sd + 5.0) < 0.5 ? -1.0 : 1.0) + sd * 6.28;
  float flip = 0.22 + 0.78 * abs(cos(uTime * (0.8 + 0.9 * h1(sd + 6.0)) + sd * 3.1));
  vec2 q = vec2(aCorner.x * flip * 0.75, aCorner.y);
  q = vec2(q.x * cos(spin) - q.y * sin(spin), q.x * sin(spin) + q.y * cos(spin));
  c.xy += q * (12.0 + 7.0 * h1(sd + 7.0)) * k * uMap.xy;
  gl_Position = c;
  vUv = aCorner;
  // Turning edge-on, a petal fades out instead of thinning into a bar; near the seam of its wrap (which a
  // turned map brings into the frame) it goes out and comes back faded in, never in a jump.
  float seam = (1.0 - smoothstep(0.9, 1.0, abs(x) / Wd)) * (1.0 - smoothstep(0.9, 1.0, abs(y) / H));
  vLook = vec2(uFall.z * away * seam * smoothstep(0.3, 0.65, flip) * clamp(0.3 + 0.7 * k, 0.25, 1.3) * (0.55 + 0.45 * flip), clamp((k - 1.04) * 2.6, 0.07, 0.6));
}`;
// The sprite's petal (motifs.svg #sakura-petal-fill, 60 x 80, notch up): a plain silhouette in pale
// sakura, no outline; a near, out-of-focus petal reads at most one mip level coarser (more would
// average the silhouette into its square).
const PETAL_FS = `precision mediump float;
varying vec2 vUv;
varying vec2 vLook;
uniform sampler2D uPetal;
void main() {
  float a = texture2D(uPetal, vec2(0.5 + vUv.x * 0.5, (0.5 - vUv.y * 0.5) * 0.6641), vLook.y * 1.6).a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(1.0, 0.820, 0.890) * 0.9 * a * vLook.x, 1.0);
}`;

// The butterfly: the sprite's (motifs.svg, both wings and the body in one 120 x 100 frame), each half a
// quad hinged on the body, beating; placed and turned by the frame. aW = distance from the body (0..1),
// position along it (-1 tail .. 1 head), side. A wing spans 0.6 of the frame's height across.
const FLY_VS = `${PLACE}
attribute vec3 aW;
uniform vec4 uB;
uniform vec2 uHead;
uniform float uOpen;
varying vec2 vUv;
void main() {
  float k;
  vec4 c = place(uB.xyz, k);
  vec2 l = vec2(aW.z * aW.x * 0.6 * uOpen, aW.y * 0.5);
  c.xy += vec2(l.x * uHead.x - l.y * uHead.y, l.x * uHead.y + l.y * uHead.x) * uB.w * k * uMap.xy;
  gl_Position = c;
  vUv = vec2(0.5 + aW.z * aW.x * 0.5, (0.5 - aW.y * 0.5) * 0.8281);
}`;
const FLY_FS = `precision mediump float;
varying vec2 vUv;
uniform sampler2D uSprite;
uniform vec3 uFlyA;
uniform float uFlyGlow;
void main() {
  float a = texture2D(uSprite, vUv).a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uFlyA * a * uFlyGlow, 1.0);
}`;

// Filaments: dense soft dots along each relation, a still pattern by type; one slow impulse per
// relation at most every ten seconds (none on work from other hands).
// aP = t (0..1), arc length (map units), relation index, type.
const FIL_VS = (links) => `${PLACE}
attribute vec3 aPos;
attribute vec3 aCol;
attribute vec4 aP;
attribute float aEdge;
uniform vec4 uLink[${links}];
uniform float uTime;
varying vec3 vC;
void main() {
  vec4 L = uLink[int(aP.z + 0.5)];
  float lit = L.x;
  float pattern, gain = 1.0;
  if (aP.w < 0.5) pattern = 0.72 + 0.28 * sin(aP.y * 0.05);
  else if (aP.w < 1.5) { float ph = fract(aP.y / 30.0); pattern = 0.14 + 0.86 * smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(0.5, 0.58, ph)); }
  else if (aP.w < 2.5) { float ph = fract(aP.y / 15.0); pattern = 0.08 + 0.92 * (1.0 - smoothstep(0.1, 0.24, abs(ph - 0.5))); }
  else { float ph = fract(aP.y / 12.0); pattern = 1.0 - smoothstep(0.08, 0.2, abs(ph - 0.5)); gain = 0.3; }
  // The impulse: a soft glow crossing the relation in about three seconds, from its first node to the
  // second, then 13 to 25 seconds of rest.
  float per = 16.0 + 12.0 * fract(aP.z * 0.618 + 0.29), run = mod(uTime + aP.z * 5.3, per) / 3.2;
  float d = aP.x - run;
  float pulse = run < 1.2 && aP.w < 2.5 ? exp(-d * d * 160.0) * 0.8 : 0.0;
  // The reading impulse (G1): light leaves the node read along each of its relations at a constant speed
  // (L.y = departure, L.w = ±duration, its sign the direction): a white head, and behind it a trail in the
  // relation's hue ending rose, dying in the phosphor's time (RÉMANENCE §6.1). None on work from other hands.
  float dur = max(abs(L.w), 0.05), u = (uTime - L.y) / dur;
  float dd = mix(1.0 - aP.x, aP.x, step(0.0, L.w)) - u;
  float head = 0.0, trail = 0.0;
  if (u > 0.0 && u * dur < dur + 1.0 && aP.w < 2.5) { head = exp(-dd * dd * 220.0); trail = dd < 0.0 ? exp(dd * dur * 3.3) : 0.0; }
  pulse = max(pulse, max(head, 0.55 * trail) * 0.9);
  float k;
  gl_Position = place(aPos, k);
  gl_PointSize = clamp(uDpr * k * (5.0 + 2.5 * lit + 2.0 * pulse), 1.0, uMaxPt);
  float haze = clamp((1.0 - k) * 2.2, 0.0, 0.45);
  vec3 col = mix(mix(aCol, vec3(0.50, 0.44, 1.0), haze), vec3(1.0, 0.373, 0.635), 0.5 * step(0.001, trail) * (1.0 - trail) * (1.0 - head));
  vC = mix(col, vec3(1.0), 0.3 * pulse + 0.5 * head) * (pattern * 0.4 + pulse * 0.5) * gain * L.z * aEdge * (1.0 + 0.9 * lit);
}`;

// Nodes: one quad each, drawn by kind. vK.y = radius of the SVG circle within the quad (the hit area).
const NODE_VS = (slots) => `${PLACE}
attribute vec2 aCorner;
attribute vec4 aC;
attribute vec4 aK;
attribute vec3 aCol;
uniform vec4 uNode[${slots}];
uniform float uPing[${slots}];
varying vec2 vUv;
varying vec3 vC;
varying vec4 vK;
varying vec3 vS;
void main() {
  int slot = int(aC.w + 0.5);
  vec4 st = uNode[slot];
  float grow = 1.0 + 0.2 * st.x + 0.06 * st.y;
  float k;
  vec4 c = place(aC.xyz, k);
  c.xy += aCorner * aK.y * aK.z * grow * k * uMap.xy;
  gl_Position = c;
  vUv = aCorner;
  // Far nodes lean towards the nebula's violet (atmospheric perspective); near ones stay pure.
  float haze = clamp((1.0 - k) * 2.2, 0.0, 0.45);
  vC = mix(aCol, vec3(0.50, 0.44, 1.0), haze) * (1.0 - 0.25 * haze);
  vK = vec4(aK.x, 1.0 / aK.z, st.z, aK.w);
  vS = vec3(st.xy, uPing[slot]);
}`;
const NODE_FS = `precision mediump float;
varying vec2 vUv;
varying vec3 vC;
varying vec4 vK;
varying vec3 vS;
uniform vec2 uBeat;
uniform float uIgnite;
uniform float uHeart;
void main() {
  float r = length(vUv);
  if (r >= 1.0) discard;
  float kind = vK.x, R = vK.y, lit = vS.x, near = vS.y, age = vS.z;
  float x = r / R;
  float halo = exp(-x * x * 0.8) * 0.4 + exp(-r * r * 6.0) * 0.14;
  float core = exp(-x * x * 9.0);
  float dr = r - R, wr = 0.014 + 0.012 * lit;
  float ring = exp(-dr * dr / (wr * wr));
  float sleeve = exp(-dr * dr * 204.08);
  vec3 col;
  float warm = 0.0;
  if (kind < 0.5) {
    // TheHive: a body of glass (its lattice is drawn as points), a bright limb, light spilling out.
    float limb = smoothstep(0.72, 1.0, x) * (1.0 - smoothstep(1.0, 1.07, x));
    float spill = x > 1.0 ? exp(-(x - 1.0) * (x - 1.0) * 5.0) : 0.0;
    col = vC * (0.03 + 0.05 * exp(-x * x * 2.0) + 0.3 * limb + 0.8 * ring + 0.24 * spill);
    // Read (G3), a warm heart comes on inside and breathes slowly (one beat in 3.9 s, ±10 %); at rest, glass.
    float beat = 0.9 + 0.1 * sin(uBeat.x) + 0.12 * pow(max(0.0, sin(uBeat.x)), 8.0);
    warm = exp(-x * x * 14.0) * lit * uHeart * beat;
  } else if (kind < 1.5) {
    // Lumina: a white-hot heart that breathes, six thin rays turning very slowly.
    float beat = 0.9 + 0.1 * sin(uBeat.x) + 0.12 * pow(max(0.0, sin(uBeat.x)), 8.0);
    float heart = exp(-x * x * 16.0);
    float rays = pow(abs(cos(atan(vUv.y, vUv.x) * 3.0 + uBeat.y)), 70.0) * exp(-r * 3.2) * 0.9;
    col = mix(vC, vec3(1.0), heart * 0.9) * (heart * 2.0 + exp(-x * x * 1.1) * 0.55 + exp(-r * r * 9.0) * 0.12 + rays) * beat;
  } else if (kind > 6.5) {
    col = mix(vC, vec3(1.0), core * 0.6) * (core * 0.8 + halo * 0.25);
  } else if (kind > 5.5) {
    // Work from other hands: a hollow, still ring of dots in --dim; no core, no halo.
    float dots = exp(-dr * dr / 0.000576) * (1.0 - smoothstep(0.1, 0.2, abs(fract(atan(vUv.y, vUv.x) / 6.2831853 * 22.0) - 0.5)));
    col = vC * dots;
  } else if (kind > 2.5 && kind < 3.5) {
    float dash = smoothstep(0.35, 0.5, abs(fract(atan(vUv.y, vUv.x) / 6.2831853 * 14.0 + uBeat.y * 0.3183099) - 0.5) * 2.0);
    col = vC * ((ring * 1.15 + sleeve * 0.3) * (0.25 + 0.75 * dash) + core * 0.4 + halo * 0.5);
  } else if (kind > 4.5) {
    col = mix(vC, vec3(1.0), core * 0.5) * (core * 0.95 + halo * 0.5);
  } else {
    col = mix(vC, vec3(1.0), core * 0.6) * (core * 1.3 + halo * 1.05 + ring * 0.4 + sleeve * 0.16);
  }
  col *= vK.z * (1.0 + 0.85 * lit + 0.35 * near);
  // The heart, gold to warm white, added last: 1.4 at most, since the additive blend lightens the rings before it.
  col += mix(vC, vec3(1.0, 0.96, 0.9), 0.85) * warm * 1.4;
  // Selection: a ring of light runs out from the node (and, a beat later, from its relations); not
  // from work from other hands, which takes no light; at half strength while the map lights up (uIgnite).
  float dp = (r - mix(R * 1.05, 0.96, age)) / 0.022;
  if (age < 1.0 && kind < 5.5) col += vC * exp(-dp * dp) * (1.0 - age) * 0.9 * mix(1.0, 0.5, uIgnite);
  gl_FragColor = vec4(col * (1.0 - smoothstep(0.6, 1.0, r)), 1.0);
}`;

// ---------- Small WebGL helpers ----------
// Programs are compiled and linked without reading any status, so the work can run in parallel in
// the GPU process (KHR_parallel_shader_compile) instead of blocking the page; each is checked once,
// when the first frame needs it, and only then are its locations read.
function compile(gl, vs, fs) {
  const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const p = gl.createProgram(), v = shader(gl.VERTEX_SHADER, vs), f = shader(gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  return { p, v, f, u: null, a: null };
}
function finish(gl, prog) {
  if (!gl.getProgramParameter(prog.p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(prog.v) || gl.getShaderInfoLog(prog.f) || gl.getProgramInfoLog(prog.p) || "link");
  const u = {}, a = {};
  for (let i = 0, n = gl.getProgramParameter(prog.p, gl.ACTIVE_UNIFORMS); i < n; i++) { const info = gl.getActiveUniform(prog.p, i); u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(prog.p, info.name); }
  for (let i = 0, n = gl.getProgramParameter(prog.p, gl.ACTIVE_ATTRIBUTES); i < n; i++) { const info = gl.getActiveAttrib(prog.p, i); a[info.name] = gl.getAttribLocation(prog.p, info.name); }
  gl.deleteShader(prog.v);
  gl.deleteShader(prog.f);
  prog.u = u; prog.a = a;
}

const translate = el => {
  const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(el.getAttribute("transform") || "");
  return m ? [+m[1], +m[2]] : null;
};

/**
 * Builds the constellation over the map's stage. Returns null when WebGL is unavailable.
 * stage: .aether-orbit-stage; graph: its SVG; adj: Map id → Set of related ids (from aether.js).
 * The returned object starts, stops (back to the plain SVG) and follows the focused node.
 */
export function createConstellation(stage, graph, adj) {
  const els = [...graph.querySelectorAll(".a-node[data-node]")];
  const homes = els.map(el => el.getAttribute("transform"));
  const nodes = els.map((el, i) => {
    const id = el.dataset.node, at = translate(el) || [CX, CY];
    // Work from other hands (data-owner="inscrit") is drawn as such whatever its role.
    const kindName = el.dataset.owner === "inscrit" ? "inscrit" : Object.keys(KIND).find(k => el.classList.contains("a-node-" + k)) || "code";
    const kind = KIND[kindName], z = depthOf(kind, at), f = (CAM - z) / CAM;
    // Placed so that, before any sway, the projection lands exactly on the SVG layout.
    return { id, i, kind, r: +(el.querySelector("circle:not(.node-hit)")?.getAttribute("r") || 14), pos: [(at[0] - CX) * f, -(at[1] - CY) * f, z], color: KIND_HUE[kind] };
  });
  if (!nodes.length) return null;
  const index = new Map(nodes.map(n => [n.id, n.i]));
  // The core is read by its role, like everything else: the ringed body at the centre (Lumina), and an
  // optional inner node drawn inside it (none today).
  const coreIndex = Math.max(0, nodes.findIndex(n => n.kind === KIND.core)), innerIndex = nodes.findIndex(n => n.kind === KIND.inner);
  const links = [...graph.querySelectorAll(".aether-links [data-link]")].map(el => {
    const [a, b] = el.dataset.link.split(" ");
    const type = Object.keys(LINK).find(t => el.classList.contains("link-" + t)) || "build";
    return { a: index.get(a), b: index.get(b), type: LINK[type][0], color: LINK[type][1] };
  }).filter(l => l.a !== undefined && l.b !== undefined);
  const inscribed = n => n.kind === KIND.inscrit;
  links.forEach(l => { if (inscribed(nodes[l.a]) || inscribed(nodes[l.b])) { l.type = 3; l.color = DIM; } });
  // Petals keep away from work from other hands (the first one on the map).
  const avoid = nodes.find(inscribed);
  const SLOTS = nodes.length + 1, AMBIENT = nodes.length, NL = Math.max(1, links.length), DECOR = 12;
  // Each relation is a quadratic arc bulging away from TheHive and lifted in depth; the filaments
  // are drawn along it and the butterfly flies along it.
  links.forEach((l, j) => {
    const A = nodes[l.a].pos, B = nodes[l.b].pos;
    const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
    const M = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
    let nx = -dy, ny = dx; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    if (nx * M[0] + ny * M[1] < 0) { nx = -nx; ny = -ny; }
    l.len = Math.hypot(dx, dy, dz);
    const bend = 0.12 * l.len, lift = (j % 2 ? 1 : -1) * 0.16 * l.len;
    l.C = [M[0] + nx * bend, M[1] + ny * bend, M[2] + lift];
  });
  const curve = (A, C, B, t, out) => {
    const u = 1 - t;
    for (let i = 0; i < 3; i++) out[i] = u * u * A[i] + 2 * u * t * C[i] + t * t * B[i];
    return out;
  };
  const arc = (l, t, out) => curve(nodes[l.a].pos, l.C, nodes[l.b].pos, t, out);

  const canvas = document.createElement("canvas");
  canvas.className = "aether-constellation";
  canvas.setAttribute("aria-hidden", "true");
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: "default" });
  if (!gl) return null;
  stage.prepend(canvas);

  const coarse = matchMedia("(pointer: coarse)");
  // Phones enlarge the labels (css/aether.css, max-width 700px): half the sway keeps them in the frame.
  const narrow = matchMedia("(max-width: 700px)");
  // The desktop tier (T2): more stars, and the one shooting star a minute.
  const tier2 = () => !coarse.matches && !narrow.matches;
  let R = null, P = null, buf = null, enabledMask = 0, maxPt = 64, starCount = 0, dustCount = 0, orbitCount = 0, filCount = 0, flashCount = 0, petalCount = 0;

  // ---------- Geometry ----------
  // TheHive as a honeycomb: the dual of a once-subdivided icosahedron (12 pentagons, 30 hexagons),
  // returned as unit points along its 120 edges, its 80 corners flagged.
  function honeycomb() {
    const g = (1 + Math.sqrt(5)) / 2, unit = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
    const V = [[-1, g, 0], [1, g, 0], [-1, -g, 0], [1, -g, 0], [0, -1, g], [0, 1, g], [0, -1, -g], [0, 1, -g], [g, 0, -1], [g, 0, 1], [-g, 0, -1], [-g, 0, 1]].map(unit);
    const halves = new Map(), half = (a, b) => {
      const key = Math.min(a, b) * 64 + Math.max(a, b);
      if (!halves.has(key)) { V.push(unit([0, 1, 2].map(i => V[a][i] + V[b][i]))); halves.set(key, V.length - 1); }
      return halves.get(key);
    };
    const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
      .flatMap(([a, b, c]) => { const ab = half(a, b), bc = half(b, c), ca = half(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
    const corner = F.map(f => unit([0, 1, 2].map(i => V[f[0]][i] + V[f[1]][i] + V[f[2]][i])));
    const shared = new Map();
    F.forEach((f, n) => [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]].forEach(([a, b]) => {
      const key = Math.min(a, b) * 64 + Math.max(a, b);
      (shared.get(key) || shared.set(key, []).get(key)).push(n);
    }));
    const out = corner.map(c => [c, true]);
    for (const [i, j] of shared.values()) for (let k = 1; k < 7; k++) out.push([unit([0, 1, 2].map(n => corner[i][n] * (7 - k) + corner[j][n] * k)), false]);
    return out;
  }

  function orbitData() {
    const d = [];
    const push = (c, slot, radius, height, phase, speed, tx, tz, size, kind, col) => d.push(c[0], c[1], c[2], slot, radius, height, phase, speed, tx, tz, size, kind, col[0], col[1], col[2]);
    const hive = nodes[coreIndex];
    // The core, Lumina: a sphere of cells on its circle — a cognition made of many specialised systems —,
    // turning on a tilted axis at most half a degree a second (read, a little faster), a soft band of
    // light moving slowly over it.
    const hr = hive.r;
    for (const [q, isCorner] of honeycomb()) {
      push(hive.pos, hive.i, Math.hypot(q[0], q[2]) * hr, q[1] * hr, Math.atan2(q[2], q[0]), 0.0035, 0.38, -0.2, isCorner ? 2.6 : 1.5, 0, mix(GOLD, WHITE, isCorner ? 0.4 : 0.1).map(v => v * (isCorner ? 1 : 0.75)));
    }
    // Armillary rings around the core (they replace the CSS rings of the SVG map).
    [[hr * 1.38, 1.22, 0.32, 0.006, GOLD, 120], [hr * 1.72, 1.05, -0.95, -0.0045, PINK, 140], [hr * 2.05, 1.34, 1.95, 0.003, mix(VIOLET, CYAN, 0.4), 160]].forEach(([rad, tx, tz, sp, col, n]) => {
      for (let i = 0; i < n; i++) push(hive.pos, AMBIENT, rad, 0, i / n * TAU, sp, tx, tz, 1.8, 1, col.map(v => v * 0.9));
    });
    // Sparks orbiting each project; an inner node's are quick and close, inside the core. What is only
    // inscribed has none.
    nodes.forEach(n => {
      if (n.kind === 0) return;
      const count = n.kind === 1 ? 12 : n.kind === 5 ? 2 : n.kind === 6 ? 0 : 5;
      for (let j = 0; j < count; j++) {
        const rad = n.kind === 1 ? n.r * (1.15 + R() * 0.8) : n.r * (1.5 + R() * 1.3);
        push(n.pos, n.i, rad, 0, R() * TAU, (n.kind === 1 ? 0.3 : 0.12) * (0.6 + R() * 0.8) * (R() < 0.5 ? -1 : 1), R() * TAU, R() * TAU, 1.4 + R() * 1.1, 2, mix(n.color, WHITE, 0.3));
      }
    });
    orbitCount = d.length / 15;
    // Dust in the volume, turning slowly around the vertical axis.
    const hues = [CYAN, AMBER, MAGENTA, VIOLET, GOLD, PINK];
    dustCount = 0;
    for (let i = 0; i < 220; i++) {
      const x = (R() - 0.5) * 1150, z = (R() - 0.5) * 640, y = (R() - 0.5) * 760;
      const col = mix(hues[i % hues.length], WHITE, 0.3).map(v => v * (0.12 + R() * 0.25));
      push([0, 0, 0], AMBIENT, Math.hypot(x, z), y, Math.atan2(z, x), 0.004 + R() * 0.006, 0, 0, 1.1 + R() * 1.4, 3, col);
      dustCount++;
    }
    return new Float32Array(d);
  }

  function starData() {
    const area = Math.max(1, stage.clientWidth * stage.clientHeight);
    starCount = tier2() ? Math.round(Math.min(500, Math.max(240, area / 950))) : 240;
    const d = [], hues = [WHITE, WHITE, CYAN, MAGENTA, VIOLET, AMBER, GOLD];
    for (let i = 0; i < starCount; i++) {
      // Spread evenly on screen whatever the depth, so the frame is always covered; one star in
      // three gathers along the galactic band of the nebula.
      const z = -300 - Math.pow(R(), 0.7) * 1700, k = CAM / (CAM - z), b = Math.pow(R(), 2.2);
      let x, y;
      if (i % 3) { const rho = Math.sqrt(R()) * 900, ang = R() * TAU; x = Math.cos(ang) * rho; y = Math.sin(ang) * rho; }
      else { const along = (R() - 0.5) * 1800, across = (R() + R() + R() - 1.5) * 150; x = along * 0.814 - across * 0.581; y = along * 0.581 + across * 0.814; }
      const col = mix(hues[i % hues.length], WHITE, 0.35).map(v => v * (0.25 + b * 0.9));
      d.push(x / k, y / k, z, 0.9 + b * 2.1, col[0], col[1], col[2], R());
    }
    return new Float32Array(d);
  }

  // Quadratic arcs bulging away from TheHive and lifted in depth, sampled every ~2.4 CSS px.
  function filamentData(pxPerUnit) {
    const d = [], step = 2.4 / Math.max(0.2, pxPerUnit);
    links.forEach((l, j) => {
      const A = nodes[l.a].pos, B = nodes[l.b].pos, ra = nodes[l.a].r, rb = nodes[l.b].r;
      const at = t => arc(l, t, [0, 0, 0]);
      // Arc-length table, then even spacing along the curve.
      const T = 64, acc = [0];
      let prev = at(0);
      for (let i = 1; i <= T; i++) { const p = at(i / T); acc.push(acc[i - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2])); prev = p; }
      const total = acc[T], count = Math.max(8, Math.ceil(total / step));
      let seg = 0;
      for (let k = 0; k <= count; k++) {
        const s = total * k / count;
        while (seg < T - 1 && acc[seg + 1] < s) seg++;
        const t = (seg + (s - acc[seg]) / Math.max(1e-6, acc[seg + 1] - acc[seg])) / T;
        const p = at(t);
        const da = Math.hypot(p[0] - A[0], p[1] - A[1], p[2] - A[2]), db = Math.hypot(p[0] - B[0], p[1] - B[1], p[2] - B[2]);
        const edge = smooth(ra * 0.85, ra * 1.7, da) * smooth(rb * 0.85, rb * 1.7, db);
        const col = l.type === 3 ? l.color : mix(mix(l.color, nodes[l.a].color, 0.35 * (1 - t)), nodes[l.b].color, 0.35 * t);
        d.push(p[0], p[1], p[2], col[0], col[1], col[2], t, s, j, l.type, edge);
      }
    });
    filCount = d.length / 11;
    return new Float32Array(d);
  }
  const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

  // Petals: one quad each, spread through the volume, one in five in front of the map: a few petals,
  // never a pattern (18 on a desktop, 10 on a phone).
  function petalData() {
    const d = [], corners = [[-1, -1], [1, -1], [-1, 1], [-1, 1], [1, -1], [1, 1]];
    petalCount = coarse.matches || narrow.matches ? 10 : 18;
    for (let i = 0; i < petalCount; i++) {
      const front = i % 5 === 0, x = (R() - 0.5) * 1600, y = (R() - 0.5) * 1040;
      const z = front ? 120 + R() * 140 : -700 + R() * 600, seed = R() * 100;
      corners.forEach(([cx, cy]) => d.push(cx, cy, x, y, z, seed));
    }
    return new Float32Array(d);
  }
  // Two wings: [distance from the body, position along it, side].
  function flyData() {
    const d = [];
    for (const side of [-1, 1]) for (const [x, y] of [[0, -1], [1, -1], [0, 1], [0, 1], [1, -1], [1, 1]]) d.push(x, y, side);
    return new Float32Array(d);
  }

  // One shooting-star slot of 26 points, four impulse slots of 18.
  function flashData() {
    const d = [];
    for (let slot = 0; slot < 1; slot++) for (let i = 0; i < 26; i++) d.push(slot, i, 0, 26);
    for (let slot = 0; slot < 4; slot++) for (let i = 0; i < 18; i++) d.push(slot, i, 1, 18);
    flashCount = d.length / 4;
    return new Float32Array(d);
  }

  function nodeData() {
    const d = [], corners = [[-1, -1], [1, -1], [-1, 1], [-1, 1], [1, -1], [1, 1]];
    const glow = [1.8, 3.4, 3.1, 2.5, 2.9, 3.2, 2.4];
    const quad = (pos, slot, kind, r, g, seed, c) => corners.forEach(([x, y]) => d.push(x, y, pos[0], pos[1], pos[2], slot, kind, r, g, seed, c[0], c[1], c[2]));
    nodes.forEach(n => quad(n.pos, n.i, n.kind, n.r, glow[n.kind], n.i, n.color));
    // A dozen bright stars far behind the map (kind 7), with their diffraction cross.
    const hues = [WHITE, CYAN, AMBER, MAGENTA, VIOLET, GOLD];
    for (let i = 0; i < DECOR; i++) {
      const z = -500 - R() * 900, k = CAM / (CAM - z), ang = R() * TAU, rho = (0.45 + R() * 0.55) * 720;
      quad([Math.cos(ang) * rho / k, Math.sin(ang) * rho * 0.75 / k, z], AMBIENT, 7, 5 + R() * 4, 4.2, i, mix(hues[i % hues.length], WHITE, 0.4).map(v => v * 0.8));
    }
    return new Float32Array(d);
  }

  // The butterfly and the petal are the sprite's (motifs.svg): one tracing for the page and the
  // constellation (RÉMANENCE §5). The browser draws each once as a data: image (the page's img-src
  // allows it) into a small mipmapped texture; until they are ready neither is drawn. Strokes are
  // thickened by half: drawn at 64 px and shown at 20 to 45, they stay about one pixel wide.
  const sprite = { fly: null, petal: null }, tex = { fly: null, petal: null };
  const symbolImage = (doc, ids, viewBox, w, h) => {
    const body = ids.map(id => doc.getElementById(id)?.innerHTML || "").join("").replace(/stroke-width="([\d.]+)"/g, (_, v) => `stroke-width="${+v * 1.5}"`);
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${w}" height="${h}" color="#fff">${body}</svg>`);
    return img.decode().then(() => img);
  };
  fetch(new URL("motifs.svg", document.baseURI)).then(r => r.ok ? r.text() : Promise.reject(new Error("motifs.svg " + r.status))).then(text => {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    return Promise.all([
      symbolImage(doc, ["butterfly-wing-l", "butterfly-wing-r", "butterfly-body"], "0 0 120 100", 64, 53),
      symbolImage(doc, ["sakura-petal-fill"], "0 0 60 80", 64, 85)
    ]);
  }).then(([fly, petal]) => { sprite.fly = fly; sprite.petal = petal; upload(); if (running) wake(); }, () => {});
  function upload() {
    if (!sprite.fly) return;
    const one = (img, w, h) => {
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, img.width, img.height);
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    tex.fly = one(sprite.fly, 64, 64);
    tex.petal = one(sprite.petal, 64, 128);
  }

  let parallel = null, pending = null, broken = false;
  function init() {
    // Extension objects die with a lost context: ask again on every (re)initialisation, before compiling.
    parallel = gl.getExtension("KHR_parallel_shader_compile");
    R = rng(20261009); // same sky on every visit, and again after a lost context
    P = {
      bg: compile(gl, BG_VS, BG_FS), star: compile(gl, STAR_VS, DOT_FS), orbit: compile(gl, ORBIT_VS(SLOTS), DOT_FS),
      fil: compile(gl, FIL_VS(NL), DOT_FS), node: compile(gl, NODE_VS(SLOTS), NODE_FS), flash: compile(gl, FLASH_VS, DOT_FS),
      petal: compile(gl, PETAL_VS, PETAL_FS), fly: compile(gl, FLY_VS, FLY_FS)
    };
    const make = data => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; };
    buf = { bg: make(new Float32Array([-1, -1, 3, -1, -1, 3])), star: make(starData()), orbit: make(orbitData()), node: make(nodeData()), flash: make(flashData()), petal: make(petalData()), fly: make(flyData()), fil: gl.createBuffer() };
    pending = Object.values(P);
    filScale = 0;
    dirty = true;
    enabledMask = 0;
    maxPt = Math.max(1, gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)?.[1] || 64);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    // Textures die with a lost context: draw the sprite again (no-op before it has loaded).
    tex.fly = tex.petal = null;
    upload();
    quiet();
  }

  // Interleaved float attributes per program: [name, size].
  const LAYOUT = {
    bg: [["aPos", 2]], star: [["aA", 4], ["aB", 4]], orbit: [["aC", 4], ["aO", 4], ["aT", 4], ["aCol", 3]],
    fil: [["aPos", 3], ["aCol", 3], ["aP", 4], ["aEdge", 1]], node: [["aCorner", 2], ["aC", 4], ["aK", 4], ["aCol", 3]],
    flash: [["aF", 4]], petal: [["aCorner", 2], ["aP", 4]], fly: [["aW", 3]]
  };
  function use(key) {
    const prog = P[key], layout = LAYOUT[key];
    gl.useProgram(prog.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf[key]);
    let stride = 0, off = 0, mask = 0;
    for (const [, n] of layout) stride += n * 4;
    for (const [name, n] of layout) {
      const loc = prog.a[name];
      if (loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride, off); mask |= 1 << loc; }
      off += n * 4;
    }
    for (let loc = 0; loc < 16; loc++) if (enabledMask & ~mask & (1 << loc)) gl.disableVertexAttribArray(loc);
    enabledMask = mask;
    return prog;
  }

  // ---------- Layout ----------
  // s = CSS px per map unit; the SVG's default preserveAspectRatio (xMidYMid meet) does the same.
  // zoomBase: on phones the map steps back a little around TheHive, so that the edge labels keep the
  // few pixels of margin the SVG layout gives them even at the far end of the sway.
  let W = 0, H = 0, dpr = 1, quality = 1, s = 1, ox = 0, oy = 0, filScale = 0, zoomBase = 1, screenDpr = 0, fallH = 520, fallW = 800, dirty = true;
  /** Measures the stage and sizes the canvas; returns true when the drawing buffer was resized. */
  function layout() {
    W = stage.clientWidth; H = stage.clientHeight;
    screenDpr = window.devicePixelRatio || 1;
    if (!W || !H) return false;
    const cap = Math.min(screenDpr, coarse.matches ? 1.5 : 2);
    dpr = Math.max(0.75, Math.min(cap * quality, Math.sqrt(2.6e6 / (W * H))));
    const bw = Math.round(W * dpr), bh = Math.round(H * dpr), resized = canvas.width !== bw || canvas.height !== bh;
    if (resized) { canvas.width = bw; canvas.height = bh; }
    s = Math.min(W / VW, H / VH); ox = (W - VW * s) / 2; oy = (H - VH * s) / 2;
    zoomBase = narrow.matches ? 0.965 : 1;
    // Half extents of the frame around TheHive (map units, depth 0) at the widest zoom (.94, lighting up),
    // plus room for the camera's drift and the petal's size: petals wrap out of sight.
    const room = narrow.matches ? 0.5 : 1, wide = zoomBase * 0.92;
    fallH = Math.max(CY + oy / s, (H - oy) / s - CY) / wide + 110 * room;
    fallW = (CX + ox / s) / wide + 190 * room;
    // Each label's box around its node (map units, text only): what fit() keeps inside the frame.
    try {
      els.forEach((el, i) => {
        let l = 1e9, t = 1e9, r = -1e9, b = -1e9;
        for (const tx of el.querySelectorAll("text")) { const bb = tx.getBBox(); l = Math.min(l, bb.x); t = Math.min(t, bb.y); r = Math.max(r, bb.x + bb.width); b = Math.max(b, bb.y + bb.height); }
        const o = i * 4; box[o] = l; box[o + 1] = t; box[o + 2] = r; box[o + 3] = b;
      });
    } catch {}
    if (P && Math.abs(s - filScale) > filScale * 0.08) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.fil);
      gl.bufferData(gl.ARRAY_BUFFER, filamentData(s), gl.STATIC_DRAW);
      filScale = s;
    }
    return resized;
  }

  // ---------- State ----------
  const nodeState = new Float32Array(SLOTS * 4), linkState = new Float32Array(NL * 4);
  const focusA = new Float32Array(nodes.length), nearA = new Float32Array(nodes.length), clock = new Float32Array(SLOTS);
  const litA = new Float32Array(NL);
  const ping = new Float32Array(SLOTS).fill(2), pingAt = new Float32Array(SLOTS).fill(-99);
  // No impulse on any relation (uLink.y = departure, .w = ±duration): at the start and after a lost context.
  const quiet = () => { for (let j = 0; j < NL; j++) { linkState[j * 4 + 1] = -99; linkState[j * 4 + 3] = 0; } };
  quiet();
  let lastF = -1;
  // Lot G: the reading impulse (G1), the dive to a sheet and the return by the map (G2), Lumina's heart (G3).
  const noImpulse = QA.off("impulse"), noDive = QA.off("dive"), noHeart = QA.off("heart");
  let diveAt = -9, diveFor = -1, diveZoom = 1, diveSx = CX, diveSy = CY, arriveFor = -1, arriveAt = -1e9, seen = 1;
  // The light leaves the node read along each of its relations (G1) at 1 100 units a second: the
  // neighbour's ring leaves when it arrives (0.2 to 0.45 s). A relation of work from other hands carries
  // nothing; its neighbour keeps the old fixed beat.
  const launch = f => {
    links.forEach((l, j) => {
      if (l.a !== f && l.b !== f) return;
      const o = l.a === f ? l.b : l.a, at = time % 86400 - linkState[j * 4 + 1];
      // None on work from other hands, nor over a light still running (the old beat instead).
      if (l.type === 3 || noImpulse || (at >= 0 && at < Math.abs(linkState[j * 4 + 3]) + 1)) { pingAt[o] = time + 0.22; return; }
      const dur = Math.max(0.05, l.len / 1100);
      linkState[j * 4 + 1] = time % 86400; linkState[j * 4 + 3] = (l.a === f ? 1 : -1) * dur;
      pingAt[o] = time + dur;
    });
  };
  let focusId = null, dim = 0, time = 0, swayClock = 0, yaw = 0, pitch = 0, ex = 0, ey = 0, py = 0, px = 0, tpx = 0, tpy = 0;
  // Drag to look around: gx/gy is where the hand puts the camera (map units), sx/sy follows it.
  let held = null, gx = 0, gy = 0, sx = 0, sy = 0;
  // The camera (D3-1/2/6): zoom and pan around zoomBase; the node read is pinned to its screen place
  // (pinSx/pinSy), the pan solved from the zoom each frame; jx/jy eases a keyboard focus into the frame.
  let zoom = 1, zoomT = 1, panX = 0, panY = 0, jx = 0, jy = 0, pinFor = -1, pinSx = CX, pinSy = CY, focusAt = -9, keyed = -1, readYaw = 0;
  let hover = 0, liftUntil = -9, ignitedAt = -99, lastIgnite = -1e9, drew = false, writes = 0, frames = 0;
  const noZoom = QA.off("zoom"), noOrbit = QA.off("orbit"), noIgnite = QA.off("ignite");
  let running = false, visible = true, lost = false, shown = false, paused = true, stopTask = null, slow = 0, rect = null;
  let base = 0, warm = 0, calm = 0, patience = 6, gaveBackAt = -1e9, shrink = 0;
  // Pacing: at most 60 images a second (a 120 Hz screen draws every other refresh), 30 when the
  // device struggles. A skipped refresh leaves the canvas untouched, so nothing is committed for it.
  let pace = 1 / 60, owed = 0;
  // Idle (from the page): level 1 keeps the scene alive at 30 images a second; level 2 slows
  // everything down to a stop, then the loop sleeps; waking eases the pace back and fades in.
  let idleLevel = 0, timeScale = 1, asleep = false;
  const rot = new Float32Array(9), map = new Float32Array(4), m = new Float64Array(9), pt = [0, 0], pv = [0, 0];
  const last = nodes.map(() => [NaN, NaN]), box = new Float32Array(nodes.length * 4).fill(NaN);

  const ease = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt));
  // The phosphor law (RÉMANENCE §6.1): light comes on in about 120 ms and goes back in about 900 ms.
  const fade = (v, target, dt) => ease(v, target, target > v ? 8.3 : 3.3, dt);
  // Sway rotation (yaw, then pitch), row-major, written into m.
  const rows = () => {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    m[0] = cy; m[1] = 0; m[2] = sy; m[3] = sp * sy; m[4] = cp; m[5] = -sp * cy; m[6] = -cp * sy; m[7] = sp; m[8] = cp * cy;
  };
  // Same projection as PLACE in the shaders: view() is the sway and the camera's slide, in map units
  // around TheHive (y up, into pv); project() adds the zoom and pan that uMap folds in (SVG units, into pt).
  const view = p => {
    const qx = m[0] * p[0] + m[1] * p[1] + m[2] * p[2], qy = m[3] * p[0] + m[4] * p[1] + m[5] * p[2], qz = m[6] * p[0] + m[7] * p[1] + m[8] * p[2];
    const k = CAM / Math.max(CAM - qz, 60);
    pv[0] = (qx - ex) * k + ex; pv[1] = (qy - ey) * k + ey;
  };
  const project = p => {
    view(p);
    pt[0] = CX + (pv[0] - panX) * zoom; pt[1] = CY - (pv[1] - panY) * zoom;
  };
  // The frame's bound on the zoom around the pinned node (pv holds its view): every other label, where
  // the sway has it now, keeps FIT units from the stage's edge.
  const FIT = 10;
  const fit = f => {
    const fx = pv[0], fy = pv[1], fl = FIT - ox / s, fr = VW + ox / s - FIT, ft = FIT - oy / s, fb = VH + oy / s - FIT;
    let z = 9;
    for (let i = 0; i < nodes.length; i++) {
      const o = i * 4;
      if (i === f || box[o] !== box[o]) continue;
      view(nodes[i].pos);
      const dx = pv[0] - fx + jx, dy = fy - pv[1] - jy;
      if (dx > 0) z = Math.min(z, (fr - box[o + 2] - pinSx) / dx); else if (dx < 0) z = Math.min(z, (pinSx + box[o] - fl) / -dx);
      if (dy > 0) z = Math.min(z, (fb - box[o + 3] - pinSy) / dy); else if (dy < 0) z = Math.min(z, (pinSy + box[o + 1] - ft) / -dy);
    }
    pv[0] = fx; pv[1] = fy;
    return z;
  };

  // ---------- Butterfly ----------
  // It rests on TheHive's rim; when a node is read it flies there (along the relation's arc when it
  // comes from a related node) and settles by it, never by work from other hands. Perched, it breathes
  // as on the page (two beats in 6.4 s, then stillness); in flight, a stroke every 0.26 s.
  const fly = { p: [0, 60, 40], v: [0, 0, 0], head: [0, 1], flap: 0, open: 1, from: -1, trip: null }, aim = [0, 0, 0];
  // A flight along a bow from A to B (a relation's arc, or one lifted like it), 0.9 to 2.2 s by its length.
  const trip = (A, C, B, len) => ({ A, C, B, s: 0, dur: clamp(len / 220, 0.9, 2.2) });
  const rim = () => { const c = nodes[coreIndex]; return [c.pos[0] + c.r * 0.95, c.pos[1] + c.r * 0.8, c.pos[2] + 16]; };
  // Out of view (the page scrolled on) it goes home to the rim, unseen.
  const perch = () => { const A = rim(); for (let i = 0; i < 3; i++) { fly.p[i] = A[i]; fly.v[i] = 0; } fly.from = coreIndex; fly.trip = null; };
  // Back by the map (G2): from the rim to the node read, or from where it is (the stage never left the screen).
  const flight = n => {
    const A = rim(), B = n.pos;
    if (Math.hypot(fly.p[0] - A[0], fly.p[1] - A[1], fly.p[2] - A[2]) > 40) for (let i = 0; i < 3; i++) A[i] = fly.p[i];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
    for (let i = 0; i < 3; i++) { fly.p[i] = A[i]; fly.v[i] = 0; }
    fly.from = n.i;
    fly.trip = n.i === coreIndex || len < 60 ? null : trip(A, [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2 + 0.16 * len], B, len);
  };
  function steer(dt, f) {
    if (f >= 0 && inscribed(nodes[f])) f = -1;
    if (f !== fly.from) {
      const prev = fly.from;
      fly.from = f;
      fly.trip = null;
      const l = prev >= 0 && f >= 0 ? links.find(l => (l.a === prev && l.b === f) || (l.b === prev && l.a === f)) : null;
      if (l) fly.trip = trip(nodes[prev].pos, l.C, nodes[f].pos, l.len);
    }
    if (fly.trip) {
      const tr = fly.trip;
      tr.s = Math.min(1, tr.s + dt / tr.dur);
      curve(tr.A, tr.C, tr.B, tr.s * tr.s * (3 - 2 * tr.s), aim);
      if (tr.s >= 1) fly.trip = null;
    } else {
      // Perched at the upper right of the node read, or of the core's rim.
      const n = nodes[f >= 0 ? f : coreIndex];
      aim[0] = n.pos[0] + n.r * 0.95; aim[1] = n.pos[1] + n.r * 0.8; aim[2] = n.pos[2] + 16;
    }
    // While the hand turns the map (D3-2) it takes off and hovers, nearer and higher; it settles a second after.
    if (held?.moved && !noOrbit) liftUntil = time + 1;
    hover = fade(hover, time < liftUntil ? 1 : 0, dt);
    aim[1] += 14 * hover; aim[2] += 60 * hover;
    // A spring toward the aim; on a trip it holds the arc closely.
    const stiff = fly.trip ? 60 : 7, damp = fly.trip ? 14 : 5.2, v = fly.v, q = fly.p;
    for (let i = 0; i < 3; i++) { v[i] += ((aim[i] - q[i]) * stiff - v[i] * damp) * dt; q[i] += v[i] * dt; }
    // The body turns toward its flight on screen, and back upright once perched.
    const sp = Math.hypot(v[0], v[1]), flying = Math.max(hover, Math.min(1, Math.max(0, (sp - 6) / 30)));
    const hx = sp > 4 ? v[0] / sp : 0.28, hy = sp > 4 ? v[1] / sp : 0.96, e = 1 - Math.exp(-dt * (sp > 4 ? 8 : 2));
    fly.head[0] += (hx - fly.head[0]) * e; fly.head[1] += (hy - fly.head[1]) * e;
    const hl = Math.hypot(fly.head[0], fly.head[1]) || 1; fly.head[0] /= hl; fly.head[1] /= hl;
    // Wings: in flight a full beat every 0.52 s; perched, two beats at the start of each 6.4 s, then open.
    fly.flap = (fly.flap + dt * 12) % TAU;
    const c = (time % 6.4) / 6.4, bask = c < 0.34 ? 1 - 0.55 * Math.sin(Math.PI * c / 0.17) ** 2 : 1;
    fly.open = flying * (0.38 + 0.62 * (0.5 + 0.5 * Math.cos(fly.flap))) + (1 - flying) * bask;
  }

  function restore() {
    els.forEach((el, i) => { if (homes[i] != null) el.setAttribute("transform", homes[i]); last[i][0] = last[i][1] = NaN; });
  }

  // Programs still compiling? Once they are all done, check them and read their locations.
  function ready() {
    if (!pending) return true;
    if (parallel && pending.some(pr => !gl.getProgramParameter(pr.p, parallel.COMPLETION_STATUS_KHR))) return false;
    pending.forEach(pr => finish(gl, pr));
    pending = null;
    return true;
  }
  // An open menu or the immersive frame covers the whole page: nothing to draw under them.
  const covered = () => { const c = document.documentElement.classList; return c.contains("menu-open") || c.contains("immersive-nav"); };

  function frame(now, dt) {
    if (!running || !visible || lost || broken || document.hidden || covered()) { owed = 0; paused = true; return false; }
    if (paused) { paused = false; warm = 0; diveFor = -1; liftUntil = -9; }
    try { if (!ready()) return true; } catch (error) { console.warn("Constellation disabled:", error); broken = true; return false; }
    // Resizes (observer, density change on another screen, adaptive quality) are applied here, right
    // before drawing, so the cleared canvas is never shown.
    let resized = false;
    if (dirty || !W || !H || (window.devicePixelRatio || 1) !== screenDpr) { dirty = false; resized = layout(); if (!W || !H) return false; }
    adapt(dt, now);
    owed += dt;
    if (!resized && owed < (idleLevel ? Math.max(pace, 1 / 30) : pace) - 0.004) return true;
    const real = Math.min(owed, 0.1);
    owed = 0;
    timeScale += ((idleLevel >= 2 ? 0 : 1) - timeScale) * (1 - Math.exp(-real * (idleLevel >= 2 ? 0.9 : 2.2)));
    dt = real * timeScale;
    time += dt;

    // Lighting up (D3-6): the map comes from a little further and higher and settles in 1.6 s while, from
    // Lumina, each project's ring leaves by its distance, at half strength; at most once in 10 s.
    if (!shown) {
      ignitedAt = time; zoom = zoomBase * (noIgnite ? 1 : 0.94); panX = panY = readYaw = jx = jy = 0; pinFor = -1;
      if (!noIgnite && now - lastIgnite > 10000) {
        lastIgnite = now;
        const hive = nodes[coreIndex];
        for (const n of nodes) if (!inscribed(n)) pingAt[n.i] = time + Math.hypot(n.pos[0] - hive.pos[0], n.pos[1] - hive.pos[1]) / 900;
      }
    }
    const ig = noIgnite ? 0 : 1 - smooth(0, 1.6, time - ignitedAt);

    // Focus: the read node and its relations light up, the rest dims; the sway nearly stops
    // so the node stays under the pointer. While the map dives (G2) the node whose sheet opens stays the
    // one read, whatever the focus (the jump to the sheet blurs it).
    if (arriveFor >= 0) diveFor = -1;
    const diving = diveFor >= 0 && time - diveAt < 0.48;
    if (!diving) diveFor = -1;
    const f = diving ? diveFor : focusId == null ? -1 : index.get(focusId) ?? -1;
    const near = f >= 0 ? adj?.get(nodes[f].id) : null;
    dim = fade(dim, f >= 0 ? 1 : 0, dt);
    // Back by the map (G2): once the map is in place (most of the stage in view, 1.2 s at most) the ring,
    // the impulses and the flight leave together; the focus moving elsewhere drops the arrival.
    if (arriveFor >= 0 && arriveFor !== f) arriveFor = -1;
    const waiting = arriveFor >= 0 && seen < 0.55 && now - arriveAt < 1200, arriving = arriveFor >= 0 && !waiting;
    if (arriving) { arriveFor = -1; if (!noDive && !inscribed(nodes[f])) flight(nodes[f]); }
    if (f !== lastF || arriving) {
      lastF = f; focusAt = time;
      if (f >= 0 && !waiting) { pingAt[f] = time; launch(f); }
    }
    for (let i = 0; i < nodes.length; i++) { const age = (time - pingAt[i]) / 0.9; ping[i] = age < 0 || age > 1 ? 2 : age; }
    for (let i = 0; i < nodes.length; i++) {
      focusA[i] = fade(focusA[i], i === f ? 1 : 0, dt);
      nearA[i] = fade(nearA[i], near?.has(nodes[i].id) ? 1 : 0, dt);
      clock[i] += dt * (1 + 1.6 * focusA[i] + 0.6 * nearA[i]);
      const o = i * 4;
      nodeState[o] = focusA[i]; nodeState[o + 1] = nearA[i];
      nodeState[o + 2] = 1 - 0.62 * dim * (1 - Math.max(focusA[i], nearA[i]));
      nodeState[o + 3] = clock[i];
    }
    clock[AMBIENT] += dt;
    nodeState[AMBIENT * 4 + 2] = 1 - 0.3 * dim;
    nodeState[AMBIENT * 4 + 3] = clock[AMBIENT];
    links.forEach((l, j) => {
      litA[j] = fade(litA[j], l.a === f || l.b === f ? 1 : 0, dt);
      linkState[j * 4] = litA[j];
      linkState[j * 4 + 2] = 1 - 0.85 * dim * (1 - litA[j]);
    });

    steer(dt, waiting ? -1 : f);
    swayClock += dt * (1 - 0.85 * dim);
    px = ease(px, tpx, 2.5, dt); py = ease(py, tpy, 2.5, dt);
    // The camera drifts slowly across the map and follows a mouse over it; the sway only adds a
    // slight turn. Depth does the rest: near projects glide one way, far stars the other.
    const amp = narrow.matches ? 0.5 : 1;
    if (!held) { gx = ease(gx, 0, 1.6, dt); gy = ease(gy, 0, 1.6, dt); }
    sx = ease(sx, gx, 9, dt); sy = ease(sy, gy, 9, dt);
    // Orbit at the hand (D3-2): the drag turns the map (24° of yaw, 9° of pitch at full reach; half on a
    // phone) more than it slides the camera; released, it comes back frontal, never spinning on.
    const slide = noOrbit ? 1 : 0.45, turnX = noOrbit ? 0.00045 : 0.001 * amp, turnY = noOrbit ? 0.0004 : 0.00073 * amp;
    ex = amp * (150 * Math.sin(swayClock * TAU / 47) + 50 * Math.sin(swayClock * TAU / 19 + 1.3)) + px * 180 - sx * slide + 110 * ig * amp;
    ey = amp * 70 * Math.sin(swayClock * TAU / 31 + 0.4) - py * 110 - sy * slide;
    yaw = amp * 0.05 * Math.sin(swayClock * TAU / 54) + px * 0.03 + sx * turnX + readYaw;
    pitch = amp * 0.022 * Math.sin(swayClock * TAU / 38 + 0.7) - py * 0.018 - sy * turnY + 0.07 * ig * amp;
    rows();

    // Reading (D3-1): a node held under the pointer a quarter of a second, or reached by the keyboard or
    // a tap, is pinned to its pixel and the map comes closer around it (15 %; 8 % at the frame's edge),
    // no further than the frame lets every label stay whole (fit); the SVG keeps its units.
    const key = f >= 0 && keyed === f;
    const reading = f >= 0 && !noZoom && (key || time - focusAt >= 0.25);
    if (diving) {
      // The dive (G2): ×1.35 in 480 ms and the node drawn to the centre, strong from the first frames (the
      // page's own scroll carries the stage out of view within half a second); the eases take over after.
      const dk = 1 - (time - diveAt) / 0.48, e = 1 - dk * dk * dk;
      view(nodes[f].pos);
      pinFor = -1; jx = jy = 0; pinSx = diveSx + (CX - diveSx) * e; pinSy = diveSy + (CY - diveSy) * e;
      zoom = zoomT = Math.min(diveZoom * (1 + 0.35 * e), fit(f));
      panX = pv[0] - (pinSx - CX) / zoom; panY = pv[1] + (pinSy - CY) / zoom;
    } else if (reading) {
      view(nodes[f].pos);
      if (pinFor !== f) {
        pinFor = f;
        // Pinned where it is on screen now; with the keyboard, a node out of the frame is first brought back in.
        pinSx = CX + (pv[0] - panX) * zoom; pinSy = CY - (pv[1] - panY) * zoom;
        if (key) { pinSx = clamp(pinSx, 60, VW - 60); pinSy = clamp(pinSy, 50, VH - 50); }
        jx = pv[0] - (pinSx - CX) / zoom - panX; jy = pv[1] + (pinSy - CY) / zoom - panY;
      }
      jx = ease(jx, 0, 6, dt); jy = ease(jy, 0, 6, dt);
      const rest = zoomBase * (1 - 0.06 * ig);
      zoomT = Math.abs(jx) + Math.abs(jy) < 3 ? Math.max(rest, Math.min(rest * (1.15 - 0.07 * Math.min(1, Math.max(Math.abs(pv[0]) / 400, Math.abs(pv[1]) / 240))), fit(f))) : zoom;
      zoom = ease(zoom, zoomT, zoomT > zoom ? 4.5 : 3.3, dt);
      // The pan is solved from this frame's zoom: the node read never drifts under the pointer.
      panX = pv[0] - (pinSx - CX) / zoom - jx; panY = pv[1] + (pinSy - CY) / zoom - jy;
    } else {
      pinFor = -1; jx = jy = 0;
      zoomT = zoomBase * (1 - 0.06 * ig);
      zoom = ease(zoom, zoomT, zoomT > zoom ? 4.5 : 3.3, dt);
      panX = ease(panX, 0, 3.3, dt); panY = ease(panY, 0, 3.3, dt);
    }
    // Reading already turns the map a touch (3.5° at most) toward the node's side; applied next frame, the node pinned.
    readYaw = fade(readYaw, reading && !noOrbit ? 0.06 * amp * nodes[f].pos[0] / CX : 0, dt);
    drew = true;
    draw();

    // Keep the accessible SVG nodes on their stars (only when one moved by a third of a pixel).
    writes = 0;
    for (let i = 0; i < nodes.length; i++) {
      project(nodes[i].pos);
      const l = last[i];
      if (!(Math.abs(pt[0] - l[0]) * s < 0.33 && Math.abs(pt[1] - l[1]) * s < 0.33)) {
        els[i].setAttribute("transform", `translate(${pt[0].toFixed(1)} ${pt[1].toFixed(1)})`);
        l[0] = pt[0]; l[1] = pt[1];
        writes++;
      }
    }
    frames++;
    if (!shown) { shown = true; stage.classList.add("is-gl"); }
    if (idleLevel >= 2 && timeScale < 0.015) { asleep = true; stage.classList.add("is-asleep"); return false; }
    return true;
  }

  // Frame timing. base estimates the screen's refresh interval (the shortest interval seen lately,
  // learnt during a short warm-up and drifting up slowly), so a 30 Hz screen is not taken for a slow
  // device; a frame is slow when it is late by more than half the pace we aim at. When frames run long, lower the
  // resolution, then the pace; give them back one step at a time after a calm period, which doubles
  // whenever a give-back is soon followed by a fallback, so a device on the edge does not oscillate.
  // dt is the page's refresh interval, drawn or skipped.
  function adapt(dt, now) {
    if (warm < 0.75) { warm += dt; if (warm > dt) base = base ? Math.min(base, dt) : dt; return; }
    base = Math.min(dt, base * (1 + 0.2 * dt));
    // Slow means late for the pace we aim at, not for the screen: on a 120 Hz screen, drawing at
    // 60 images a second, a 16.7 ms interval is fine.
    if (dt > Math.max(base, pace) * 1.6) { slow += dt; calm = 0; } else { calm += dt; slow = Math.max(0, slow - dt * 0.5); }
    if (slow > 1.5) {
      slow = 0;
      if (now - gaveBackAt < 10000) patience = Math.min(120, patience * 2);
      if (quality > 0.6) { quality = Math.max(0.6, quality * 0.8); dirty = true; }
      else pace = 1 / 30;
    } else if (calm > patience) {
      calm = 0;
      if (pace > 1 / 60) { pace = 1 / 60; gaveBackAt = now; }
      else if (quality < 1) { quality = Math.min(1, quality * 1.12); dirty = true; gaveBackAt = now; }
    }
  }

  function draw() {
    const bw = canvas.width, bh = canvas.height;
    gl.viewport(0, 0, bw, bh);
    // Column-major for GLSL.
    rot[0] = m[0]; rot[1] = m[3]; rot[2] = m[6]; rot[3] = m[1]; rot[4] = m[4]; rot[5] = m[7]; rot[6] = m[2]; rot[7] = m[5]; rot[8] = m[8];
    // clip = (A + B·x·k, C + E·y·k), the map-to-canvas "meet" transform folded in, with the camera's
    // zoom and pan (project() is its twin).
    map[0] = 2 * s * zoom / W; map[1] = 2 * s * zoom / H; map[2] = (ox + (CX - panX * zoom) * s) * 2 / W - 1; map[3] = 1 - (oy + (CY + panY * zoom) * s) * 2 / H;

    gl.disable(gl.BLEND);
    const bg = use("bg");
    gl.uniform2f(bg.u.uRes, bw, bh);
    // The nebula zooms and pans with the map (zn: the zoom around its rest scale).
    const zn = zoom / zoomBase;
    gl.uniform3f(bg.u.uView, s * dpr * zn, (ox + s * CX * (1 - zn)) * dpr, (oy + s * CY * (1 - zn)) * dpr);
    // The nebula moves like a layer far behind (k about 0.54): opposite to the near projects.
    gl.uniform2f(bg.u.uPar, yaw * 560 - ex * 0.46 + panX * zoomBase, pitch * 560 + ey * 0.46 - panY * zoomBase);
    gl.uniform4f(bg.u.uPh, (time * 0.021) % TAU, (time * 0.017) % TAU, (time * 0.013) % TAU, (time * 0.009) % TAU);
    gl.uniform1f(bg.u.uDim, dim);
    const roll = time * 0.006;
    gl.uniform2f(bg.u.uRoll, Math.cos(roll), Math.sin(roll));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    const star = place("star");
    gl.uniform2f(star.u.uRoll, Math.cos(roll), Math.sin(roll));
    gl.uniform1f(star.u.uTime, time % 86400);
    gl.drawArrays(gl.POINTS, 0, starCount);

    const orbit = place("orbit");
    gl.uniform4fv(orbit.u.uNode, nodeState);
    gl.drawArrays(gl.POINTS, 0, orbitCount + dustCount);

    if (filCount) {
      const fil = place("fil");
      gl.uniform4fv(fil.u.uLink, linkState);
      gl.uniform1f(fil.u.uTime, time % 86400);
      gl.drawArrays(gl.POINTS, 0, filCount);
    }

    const flash = place("flash"), hive = nodes[coreIndex];
    gl.uniform1f(flash.u.uTime, time % 86400);
    gl.uniform4f(flash.u.uHive, hive.pos[0], hive.pos[1], hive.pos[2], hive.r);
    // Shooting stars dim with the nebula; impulses follow the core and its inner node (and brighten when read).
    const hs = nodeState[coreIndex * 4 + 2] + 1.2 * Math.max(focusA[coreIndex], innerIndex >= 0 ? focusA[innerIndex] : 0);
    gl.uniform2f(flash.u.uGlow, tier2() ? 1 - 0.5 * dim : 0, hs);
    gl.drawArrays(gl.POINTS, 0, flashCount);

    if (tex.petal) {
      const petal = place("petal");
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex.petal);
      gl.uniform1i(petal.u.uPetal, 0);
      gl.uniform1f(petal.u.uTime, time % 86400);
      gl.uniform3f(petal.u.uFall, fallH, fallW, 0.85 * (1 - 0.4 * dim));
      if (avoid) gl.uniform4f(petal.u.uAvoid, avoid.pos[0], avoid.pos[1], avoid.pos[2], avoid.r * 4 + 40); else gl.uniform4f(petal.u.uAvoid, 0, 0, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, petalCount * 6);
    }

    const node = place("node");
    gl.uniform4fv(node.u.uNode, nodeState);
    gl.uniform1fv(node.u.uPing, ping);
    gl.uniform2f(node.u.uBeat, (time * 1.6) % TAU, (time * 0.02) % TAU);
    // The lighting-up wave's rings leave at half strength (all gone by 1.4 s); eased off, not switched.
    gl.uniform1f(node.u.uIgnite, noIgnite ? 0 : 1 - smooth(1.2, 1.6, time - ignitedAt));
    gl.uniform1f(node.u.uHeart, noHeart ? 0 : 1);
    gl.drawArrays(gl.TRIANGLES, 0, (nodes.length + DECOR) * 6);

    // Local y is the body: (cos, sin) of the turn that brings it onto the heading. Small: about 3 % of
    // the map's width on a desktop, a little more on a phone.
    if (tex.fly) {
      const bf = place("fly");
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex.fly);
      gl.uniform1i(bf.u.uSprite, 0);
      gl.uniform4f(bf.u.uB, fly.p[0], fly.p[1], fly.p[2], narrow.matches ? 34 : 25);
      gl.uniform2f(bf.u.uHead, fly.head[1], -fly.head[0]);
      gl.uniform1f(bf.u.uOpen, fly.open);
      gl.uniform3f(bf.u.uFlyA, SAKURA[0], SAKURA[1], SAKURA[2]);
      gl.uniform1f(bf.u.uFlyGlow, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 12);
    }
  }
  // Binds a program that places things with PLACE, and gives it the frame's projection.
  function place(key) {
    const prog = use(key);
    gl.uniformMatrix3fv(prog.u.uRot, false, rot);
    gl.uniform4fv(prog.u.uMap, map);
    gl.uniform2f(prog.u.uEye, ex, ey);
    gl.uniform1f(prog.u.uDpr, dpr);
    gl.uniform1f(prog.u.uMaxPt, maxPt);
    return prog;
  }

  // ---------- Wiring ----------
  try { init(); } catch (error) { console.warn("Constellation disabled:", error); canvas.remove(); return null; }

  // An engine without ResizeObserver listens to the window instead, as js/scenes/scene.js does.
  const remeasure = () => { dirty = true; if (running) wake(); };
  if ("ResizeObserver" in window) new ResizeObserver(remeasure).observe(stage); else addEventListener("resize", remeasure);
  document.fonts?.ready.then(() => { dirty = true; if (running) wake(); });
  if ("IntersectionObserver" in window) new IntersectionObserver(entries => {
    const e = entries[entries.length - 1];
    visible = e.isIntersecting;
    // The share of the stage in view, of what the viewport can hold (G2).
    seen = e.intersectionRatio / Math.min(1, (e.rootBounds?.height ?? 1e9) / e.boundingClientRect.height);
    if (visible) wake(); else perch();
  }, { threshold: [0, 0.3, 0.6, 0.9] }).observe(stage);
  // Parallax follows a mouse or a pen over the map; touch keeps the slow sway only.
  // The stage's box is read on the first move after a scroll or a resize, never inside a frame.
  addEventListener("scroll", () => { rect = null; }, { passive: true });
  addEventListener("resize", () => { rect = null; }, { passive: true });
  stage.addEventListener("pointermove", e => {
    if (e.pointerType === "touch") return;
    rect ??= stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    tpx = Math.max(-1, Math.min(1, (e.clientX - rect.left) / rect.width * 2 - 1));
    tpy = Math.max(-1, Math.min(1, (e.clientY - rect.top) / rect.height * 2 - 1));
  }, { passive: true });
  stage.addEventListener("pointerleave", () => { tpx = tpy = 0; }, { passive: true });
  // The node the keyboard (or a tap) focused; on the stage, not the <svg> (a focus listener makes it a Tab stop).
  stage.addEventListener("focusin", e => { const g = e.target.closest?.(".a-node[data-node]"); keyed = g ? index.get(g.dataset.node) ?? -1 : -1; });
  stage.addEventListener("focusout", () => { keyed = -1; });
  // Drag to turn the map, from the background (a node keeps its click); one pointer at a time. A finger
  // turns it by a horizontal stroke: touch-action (css/aether.css) keeps the vertical one for the page.
  stage.addEventListener("pointerdown", e => {
    if (held || !running || e.button !== 0 || e.target.closest?.(".a-node")) return;
    held = { id: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType === "touch", moved: false };
    stage.setPointerCapture?.(e.pointerId);
    stage.classList.add("is-dragging");
    if (e.pointerType !== "touch") e.preventDefault();
  });
  stage.addEventListener("pointermove", e => {
    if (!held || e.pointerId !== held.id) return;
    rect ??= stage.getBoundingClientRect();
    const unit = VW / Math.max(1, rect.width);
    // A stroke (not a tap, nor the start of a scroll the page is about to take): the butterfly lifts.
    if (!held.moved) held.moved = Math.abs(e.clientX - held.x) > 6 || (!held.touch && Math.abs(e.clientY - held.y) > 6);
    gx = Math.max(-420, Math.min(420, (e.clientX - held.x) * unit * 0.9));
    gy = Math.max(-220, Math.min(220, -(e.clientY - held.y) * unit * 0.6));
    wake();
  }, { passive: true });
  const release = e => {
    if (!held || e.pointerId !== held.id) return;
    held = null;
    stage.classList.remove("is-dragging");
  };
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);
  canvas.addEventListener("webglcontextlost", e => {
    e.preventDefault();
    lost = true; shown = false;
    stage.classList.remove("is-gl");
    restore();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    try { init(); } catch { return; }
    lost = false;
    if (running) wake();
  });

  // ?qa=prof: each drawn frame (SVG moves included) is a "sky-frame" performance measure.
  const task = QA.on("prof") ? (now, dt) => {
    drew = false;
    const t0 = performance.now(), more = frame(now, dt);
    if (drew) performance.measure("sky-frame", { start: t0, end: performance.now() });
    return more;
  } : frame;
  // Loopback getter: the camera's state and a node's projected place (map units, CSS px).
  if (QA.local) window.__YOSULJIN_SKY_QA = () => ({
    zoom, zoomT, panX, panY, pinFor, yaw, pitch, ex, ey, time, frames, writes, hover, dragging: !!held, ignite: time - ignitedAt, pace, quality,
    dive: diveFor >= 0 ? time - diveAt : -1, arrive: arriveFor, seen, trip: fly.trip ? fly.trip.s : -1, fly: [fly.p[0], fly.p[1], fly.p[2]], dim, ping: Array.from(ping),
    // Each relation's impulse: departure (uTime space, -99 = none), signed duration, and its progress now.
    impulses: links.map((l, j) => ({ link: nodes[l.a].id + " " + nodes[l.b].id, at: linkState[j * 4 + 1], dur: linkState[j * 4 + 3], u: linkState[j * 4 + 3] ? (time % 86400 - linkState[j * 4 + 1]) / Math.abs(linkState[j * 4 + 3]) : null })),
    node: id => { const n = nodes[index.get(id)]; if (!n) return null; project(n.pos); return { x: pt[0], y: pt[1], left: ox + pt[0] * s, top: oy + pt[1] * s }; }
  });

  return {
    // Called again whenever the page's classes change (aether.js): it also resumes the frames once a
    // menu or the immersive frame no longer covers the page.
    start() {
      if (broken) return;
      if (!running) {
        running = true;
        clearTimeout(shrink);
        if (!stopTask) stopTask = every(task);
      }
      wake();
    },
    /** Back to the plain SVG map (LITE, reduced motion): nodes return to their drawn places. */
    stop() {
      if (!running) return;
      const wasShown = shown;
      running = false; shown = false; held = null; arriveFor = diveFor = -1;
      stopTask?.(); stopTask = null;
      stage.classList.remove("is-gl", "is-asleep", "is-dragging");
      restore();
      // Once the canvas has faded out, give its drawing buffer back (the context stays, so coming
      // back to FULL is instant); the next frame lays it out again.
      clearTimeout(shrink);
      shrink = setTimeout(() => { if (!running) { canvas.width = canvas.height = 1; W = 0; dirty = true; } }, wasShown ? 1000 : 0);
    },
    /** Page idle level: 0 active, 1 idle (30 images/s), 2 deep idle (slows to a stop and sleeps). */
    idle(level) {
      idleLevel = level;
      if (level < 2 && asleep) { asleep = false; stage.classList.remove("is-asleep"); }
      if (running) wake();
    },
    focus(id) {
      focusId = id ?? null;
      if (running) wake();
    },
    /** The sheet of this node opens (aether.js): the map dives toward it as the page scrolls away, and the
     *  butterfly takes off toward the camera. */
    dive(id) {
      const i = index.get(id) ?? -1;
      if (i < 0 || noDive || !running || !shown || (diveFor === i && time - diveAt < 0.48)) return;
      view(nodes[i].pos);
      diveFor = i; diveAt = time; diveZoom = zoom; diveSx = CX + (pv[0] - panX) * zoom; diveSy = CY - (pv[1] - panY) * zoom;
      const n = nodes[i];
      // Up, and ahead to the node (never toward work from other hands).
      if (!inscribed(n)) { fly.v[0] += (n.pos[0] - fly.p[0]) * 1.5; fly.v[1] += (n.pos[1] - fly.p[1]) * 1.5; }
      fly.v[2] += 700;
      liftUntil = time + 0.6;
      wake();
    },
    /** Back from a sheet by its « Sur la carte » link (aether.js), the node focused: once the map is in place
     *  its ring leaves, the light runs along its relations and the butterfly flies to it. */
    arrive(id) {
      if (!running || lost) return;
      arriveFor = index.get(id) ?? -1; arriveAt = performance.now();
      wake();
    }
  };
}
