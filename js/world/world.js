// The Yosuljin world: one WebGL space the camera travels through.
// route 0..3 = Entrée → Repères → Domaines → Aether. Detail pages render a single world.
// Frame: nebula sky (low resolution) → scene (bodies, rings, gates, particles) → bloom → signal post.
import { mat4, vec3, program, buffer, indexBuffer, attribs, sphereMesh, torusMesh, ringMesh, tubeMesh, noiseTexture, floatFormat, colorTarget, sceneTarget, rng, cacheUniforms } from "./gl.js?v=20261009-r2";
import * as S from "./shaders.js?v=20261009-r2";

const TAU = Math.PI * 2;
const WHITE = [1, 1, 1];
const clamp01 = v => Math.max(0, Math.min(1, v));
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function parseColor(v) {
  if (!v) return null;
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (m) { const h = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1]; return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255); }
  m = /^(?:rgba?\()?\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)/i.exec(v);
  return m ? [m[1], m[2], m[3]].map(x => Math.min(255, +x) / 255) : null;
}
/** The palette lives in CSS (styles.css 02, and body on the domain pages); these are its fallbacks. */
function palette() {
  let st = null;
  try { st = getComputedStyle(document.body || document.documentElement); } catch {}
  const get = (name, fallback) => (st && parseColor(st.getPropertyValue(name).trim())) || parseColor(fallback);
  return {
    accent: get("--accent", "#ff5fa2"), dev: get("--acc-dev", "#36e2ff"), photo: get("--acc-photo", "#ffb23e"),
    writing: get("--acc-writing", "#ff5fd1"), worlds: get("--acc-worlds", "#8c6bff"), aether: get("--acc-aether", "#ffd36b")
  };
}

// Domain colours are shared with the domain pages (CSS accents); createWorld reads the live values.
export const DOMAINS = [["dev", "#36e2ff"], ["photo", "#ffb23e"], ["writing", "#ff5fd1"], ["worlds", "#8c6bff"]].map(([key, hex]) => ({ key, color: parseColor(hex) }));

// Quality tiers: pixel ratio cap and pixel budget, multisampling (WebGL2 only), bloom depth, sky divider.
const TIERS = [
  { dpr: 1, budget: 0.55e6, msaa: 0, bloom: 3, sky: 4 },
  { dpr: 1.6, budget: 1.15e6, msaa: 0, bloom: 4, sky: 3 },
  { dpr: 2, budget: 2.9e6, msaa: 4, bloom: 5, sky: 2 }
];
// What the starting tier also fixes for the page's lifetime: noise octaves, sphere tessellation, particle density.
const BUILD = [
  { oct: 3, sphere: [28, 56], amount: 0.45 },
  { oct: 4, sphere: [36, 72], amount: 0.72 },
  { oct: 5, sphere: [48, 96], amount: 1 }
];

const WORLDS = [
  { c: [0, 0, 0], eye: [0, 0.06, 3.45], look: [0, 0.02, 0] },
  { c: [7, 1.4, -11], eye: [-2.25, 0.3, 4.4], look: [-1.9, 0.06, 0] },
  { c: [-6, -1.2, -23], eye: [-0.3, 1.9, 6.4], look: [-2.75, -1.78, 0] },
  { c: [3, 0.6, -36], eye: [-1.25, 0.18, 3.7], look: [-1.1, 0.05, 0] }
].map(w => ({ ...w, eye: vec3.add(w.c, w.eye), look: vec3.add(w.c, w.look) }));

// Between two worlds the camera swings through a waypoint (over the rings, under the beams…), where a gate stands.
const SWING = [[0.35, 1.3, 0.4], [0.7, -0.95, 0], [0.4, 1.15, 0]];
const PATH = [], LOOKS = [];
for (let i = 0; i < 4; i++) {
  PATH.push(WORLDS[i].eye); LOOKS.push(WORLDS[i].look);
  if (i < 3) { PATH.push(vec3.add(vec3.lerp(WORLDS[i].eye, WORLDS[i + 1].eye, 0.5), SWING[i])); LOOKS.push(null); }
}
// World centres on the same parameter as PATH (portrait screens frame them).
const CENTERS = WORLDS.flatMap((w, i) => i < 3 ? [w.c, vec3.lerp(w.c, WORLDS[i + 1].c, 0.5)] : [w.c]);
// Mid-transit the camera faces where it is going.
for (let i = 1; i < PATH.length; i += 2) LOOKS[i] = vec3.add(PATH[i], vec3.scale(vec3.norm(vec3.sub(PATH[i + 1], PATH[i - 1])), 6));

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1, 2].map(i => 0.5 * ((2 * p1[i]) + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3));
}
/** Point on the spline through `points` at parameter u ∈ [0, n-1]. */
function curve(points, u) {
  const n = points.length - 1;
  u = Math.max(0, Math.min(n, u));
  const i = Math.min(n - 1, Math.floor(u)), t = u - i;
  const P = k => points[Math.max(0, Math.min(n, k))];
  const p0 = i === 0 ? vec3.sub(vec3.scale(P(0), 2), P(1)) : P(i - 1);
  const p3 = i + 2 > n ? vec3.sub(vec3.scale(P(n), 2), P(n - 1)) : P(i + 2);
  return catmull(p0, P(i), P(i + 1), p3, t);
}
/** Route (0..3) → spline parameter: dwell near each world, accelerate between them. */
function routeU(route) {
  const r = Math.max(0, Math.min(3, route)), i = Math.min(2, Math.floor(r));
  const t = r - i;
  return 2 * (i + t - Math.sin(t * TAU) / TAU * 0.72);
}

let failed = false; // a GPU that cannot build the shaders is not asked again on this page

// Local QA only (loopback): ?qa=nopetals,nobfly,nomist,norays,notube,nowater,nopersist,tier=0|1|2 isolates
// each layer's cost; ?qa=zones tints the reading zones (the dimmed boxes behind the text).
const QA = (() => {
  const flags = new Set();
  try {
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) (new URLSearchParams(location.search).get("qa") || "").split(",").forEach(f => f && flags.add(f.trim()));
  } catch {}
  const tier = [...flags].map(f => /^tier=([012])$/.exec(f)).find(Boolean);
  return { off: name => flags.has("no" + name), on: name => flags.has(name), tier: tier ? +tier[1] : null };
})();

export function createWorld(canvas, options = {}) {
  if (failed) return null;
  const kind = options.kind || "index";
  const attrs = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: "high-performance", preserveDrawingBuffer: false };
  let gl = null;
  try { gl = canvas.getContext("webgl2", attrs); } catch {}
  if (!gl) { try { gl = canvas.getContext("webgl", attrs); } catch {} }
  if (!gl || gl.isContextLost?.()) return null;
  cacheUniforms(gl);
  const reduced = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  const coarse = window.matchMedia ? matchMedia("(pointer: coarse)").matches : false;

  // ---------- Quality ----------
  const cores = navigator.hardwareConcurrency || 4, memory = navigator.deviceMemory || 4;
  const minSide = Math.min(screen.width || innerWidth, screen.height || innerHeight);
  let startTier = coarse || minSide < 600 ? 1 : 2;
  if (cores <= 4 || memory <= 2) startTier = Math.max(0, startTier - 1);
  if (options.quality === "low") startTier = 0;
  if (QA.tier !== null) startTier = QA.tier;
  const B = BUILD[startTier], amount = B.amount;
  const q = { tier: startTier, scale: 1, ratio: 1 };

  // ---------- Programs (built in parallel when the driver can, checked before the first frame) ----------
  const defines = `#define OCT ${B.oct}\n`;
  const P = {
    sky: program(gl, S.SKY_VS, S.SKY_FS, defines), blit: program(gl, S.BLIT_VS, S.BLIT_FS),
    planet: program(gl, S.PLANET_VS, S.PLANET_FS, defines), halo: program(gl, S.HALO_VS, S.HALO_FS),
    ring: program(gl, S.RING_VS, S.RING_FS), torus: program(gl, S.TORUS_VS, S.TORUS_FS),
    beam: program(gl, S.BEAM_VS, S.BEAM_FS), sprite: program(gl, S.SPRITE_VS, S.SPRITE_FS),
    star: program(gl, S.STAR_VS, S.STAR_FS), dust: program(gl, S.DUST_VS, S.DUST_FS),
    prefilter: program(gl, S.BLOOM_VS, S.PREFILTER_FS), down: program(gl, S.BLOOM_VS, S.DOWN_FS),
    up: program(gl, S.BLOOM_VS, S.UP_FS), post: program(gl, S.POST_VS, S.POST_FS),
    petal: program(gl, S.PETAL_VS, S.PETAL_FS), bfly: program(gl, S.BFLY_VS, S.BFLY_FS),
    mist: program(gl, S.MIST_VS, S.MIST_FS), rays: program(gl, S.BLOOM_VS, S.RAYS_FS),
    tree: program(gl, S.TREE_VS, S.TREE_FS), water: program(gl, S.WATER_VS, S.WATER_FS),
    iris: program(gl, S.IRIS_VS, S.IRIS_FS), blossom: program(gl, S.BLOSSOM_VS, S.BLOSSOM_FS),
    portal: program(gl, S.PORTAL_VS, S.PORTAL_FS, defines), phos: program(gl, S.BLOOM_VS, S.PHOS_FS)
  };
  const parallel = gl.getExtension("KHR_parallel_shader_compile");
  let ready = false;
  function checkReady() {
    if (ready) return true;
    if (failed) return false;
    const list = Object.values(P);
    if (parallel && list.some(x => !gl.getProgramParameter(x.p, parallel.COMPLETION_STATUS_KHR))) return false;
    try { list.forEach(x => x.finish()); }
    catch (error) {
      if (gl.isContextLost()) return false;
      failed = true;
      console.warn("World disabled:", error);
      canvas.dispatchEvent(new CustomEvent("world-lost", { bubbles: true }));
      return false;
    }
    // Texture units: 0 noise (always bound, the samplers' default), 1 main source, 2 second source.
    const UNIT = { uSrc: 1, uScene: 1, uBase: 2, uBloom: 2, uRays: 3, uRefl: 2, uPrev: 4, uWing: 1, uPetal: 1 };
    for (const [x, names] of [[P.blit, ["uSrc"]], [P.prefilter, ["uSrc"]], [P.down, ["uSrc"]], [P.up, ["uSrc", "uBase"]], [P.rays, ["uSrc"]], [P.water, ["uRefl"]], [P.bfly, ["uWing"]], [P.petal, ["uPetal"]], [P.phos, ["uSrc", "uPrev"]], [P.post, ["uScene", "uBloom", "uRays", "uPrev"]]]) {
      gl.useProgram(x.p);
      names.forEach(name => gl.uniform1i(x.u[name], UNIT[name]));
    }
    ready = true;
    return true;
  }
  if (!parallel) { checkReady(); if (failed) return null; }

  // ---------- Palette and materials ----------
  const C = palette();
  const DOM = [C.dev, C.photo, C.writing, C.worlds];
  const MAT = {
    hero: { kind: 0, deep: [0.028, 0.012, 0.07], mid: mix(mul(C.worlds, 0.42), mul(C.writing, 0.34), 0.45), high: mul(mix(C.accent, WHITE, 0.3), 0.45), hot: C.dev, atmo: mix(C.accent, WHITE, 0.1), bands: 6.5, seed: 1.3, storm: 1 },
    // Repères' world in the scene's pale palette (warm white, pale rose, lavender): no orange, no teal.
    ocean: { kind: 1, deep: [0.02, 0.018, 0.055], mid: mul(mix(C.worlds, WHITE, 0.5), 0.36), high: [0.95, 0.93, 0.96], hot: mix(C.photo, WHITE, 0.55), atmo: mix(C.worlds, WHITE, 0.62), seed: 4.2, grid: 0.3 },
    moon: { kind: 6, deep: [0.05, 0.03, 0.09], mid: mul(C.worlds, 0.6), high: mix(C.worlds, WHITE, 0.55), hot: C.writing, atmo: mix(C.worlds, C.dev, 0.3), seed: 7.7 },
    ice: { kind: 6, deep: [0.06, 0.1, 0.14], mid: mix(C.dev, WHITE, 0.45), high: [0.95, 0.98, 1], hot: C.dev, atmo: C.dev, seed: 3.3 },
    ember: { kind: 6, deep: [0.08, 0.03, 0.01], mid: mul(C.photo, 0.7), high: mix(C.photo, WHITE, 0.5), hot: C.photo, atmo: C.photo, seed: 5.5 },
    lumina: { kind: 7, deep: [0, 0, 0], mid: mul(C.aether, 0.85), high: mix(C.aether, WHITE, 0.65), hot: C.accent, atmo: mix(C.aether, C.accent, 0.35), seed: 13 },
    rock: { kind: 6, deep: [0.015, 0.01, 0.02], mid: [0.06, 0.045, 0.065], high: [0.16, 0.11, 0.15], hot: C.accent, atmo: mul(C.accent, 0.28), seed: 6.1 },
    giant: { kind: 0, deep: [0.016, 0.008, 0.03], mid: mul(C.worlds, 0.2), high: mul(mix(C.aether, C.worlds, 0.4), 0.3), hot: C.aether, atmo: C.aether, bands: 4, seed: 9.1, storm: 0 },
    // The domain pages' worlds (detailWorld only): the page's one tint, and a low rim (it passes behind the colophon).
    domains: [
      { kind: 2, deep: [0.008, 0.025, 0.045], mid: mul(C.dev, 0.2), high: mix(C.dev, WHITE, 0.4), hot: C.dev, atmo: mul(C.dev, 0.35), seed: 2 },
      { kind: 3, deep: mul(C.photo, 0.12), mid: mul(C.photo, 0.68), high: mix(C.photo, WHITE, 0.45), hot: C.photo, atmo: mul(mix(C.photo, C.accent, 0.2), 0.35), seed: 5 },
      { kind: 4, deep: mul(C.writing, 0.07), mid: mul(C.writing, 0.48), high: mix(C.writing, WHITE, 0.5), hot: C.writing, atmo: mul(C.writing, 0.35), seed: 8 },
      { kind: 5, deep: mul(C.worlds, 0.09), mid: mul(C.worlds, 0.55), high: mix(C.worlds, WHITE, 0.35), hot: mix(C.worlds, WHITE, 0.3), atmo: mul(C.worlds, 0.35), seed: 11 }
    ]
  };
  // Each world's sky (nebula colours, sun) and light.
  const SKY_INDEX = [
    { a: mul(C.writing, 0.2), b: mul(C.worlds, 0.24), c: mul(C.dev, 0.18), deep: [0.008, 0.006, 0.03], sun: vec3.norm([-0.85, 0.5, 0.1]), sunCol: mix(C.accent, WHITE, 0.55), glow: 0.5 },
    { a: mul(C.worlds, 0.34), b: mul(C.dev, 0.26), c: mul(C.accent, 0.24), deep: [0.005, 0.007, 0.03], sun: vec3.norm([-0.85, 0.42, 0.18]), sunCol: mix(C.photo, WHITE, 0.6), glow: 0.6 },
    { a: mul(C.dev, 0.22), b: mul(C.writing, 0.3), c: mul(C.worlds, 0.3), deep: [0.007, 0.006, 0.03], sun: vec3.norm([-0.2, 0.5, -0.84]), sunCol: mix(C.accent, WHITE, 0.6), glow: 0.4 },
    { a: [0.07, 0.04, 0.2], b: mul(C.aether, 0.26), c: mul(C.accent, 0.24), deep: [0.008, 0.006, 0.02], sun: vec3.norm([0.4, 0.1, -0.9]), sunCol: mix(C.aether, WHITE, 0.4), glow: 0.5 }
  ];
  const detailIndex = typeof options.detail === "number" ? options.detail : 0;
  const detailCol = DOM[detailIndex] || C.accent;
  // The page's one tint: the space itself (accent) on the index, the domain's channel on its page.
  const pageTint = kind === "index" ? C.accent : detailCol;
  const SKY = kind === "index" ? SKY_INDEX : [{ a: mul(detailCol, 0.3), b: mul(C.worlds, 0.26), c: mul(mix(detailCol, C.accent, 0.45), 0.3), deep: [0.01, 0.007, 0.022], sun: vec3.norm([0.8, 0.38, -0.46]), sunCol: mix(detailCol, WHITE, 0.6), glow: 0.5 }];
  const BAND = vec3.norm([0.25, 1, 0.18]);
  // Identity layer per world: how many sakura petals, the mist colours, where the butterflies rest.
  const MOOD = kind === "index" ? [
    { petals: 0.8, mist: [C.accent, C.worlds], swarm: [1.75, 0.8, 0.9] },
    { petals: 0.45, mist: [C.dev, C.worlds], swarm: [0.15, 1.15, 1.3] },
    { petals: 0.35, mist: [C.writing, C.dev], swarm: [0, 0.2, 0.15] },
    { petals: 0.3, mist: [C.aether, C.accent], swarm: [-0.75, 0.95, 1.2] }
  ] : [[
    { petals: 0.2, mist: [C.dev, C.worlds] },       // développement: clear air over the circuits
    { petals: 0.3, mist: [C.photo, C.accent] },     // photographie: clear air, light
    { petals: 0.55, mist: [C.writing, C.worlds] },  // écriture: petals in the air
    { petals: 0.4, mist: [C.worlds, C.dev] }        // mondes: haze between worlds
  ][detailIndex] || { petals: 0.45, mist: [detailCol, C.worlds] }].map(m => ({ ...m, mist: [detailCol, mix(detailCol, C.accent, 0.5)], swarm: [0.9, 1.05, 1.3] }));
  const mood = { petals: 0 };
  // Safe zones (CSS px boxes of the text the world must keep readable): per scene, and the fixed HUD.
  const zones = [[], [], [], []], ZONE = new Float32Array(48), ZONEK = new Float32Array(12);
  let hudZones = [];
  // Mist banks: [offset from the world centre, size, seed].
  const MIST = [[[-1.3, -0.75, 1.1], 2.8, 1], [[1.7, 0.5, -1.4], 3.6, 2]];

  // ---------- Geometry ----------
  const R = rng(20261009);
  const noise = noiseTexture(gl, 20261007);
  const quad = buffer(gl, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
  const sph = sphereMesh(...B.sphere);
  const sphBuf = buffer(gl, sph.pos), sphIdx = indexBuffer(gl, sph.idx), sphCount = sph.idx.length;
  const ring = ringMesh(200), ringBuf = buffer(gl, ring.data);
  const tor = torusMesh(144, 10, 0.016), torBuf = buffer(gl, tor.data), torIdx = indexBuffer(gl, tor.idx), torCount = tor.idx.length;

  // Stars around the whole journey (two vertices per star: point at rest, streak in motion).
  const STARS = Math.round((kind === "index" ? 2600 : 1100) * (0.55 + amount * 0.45));
  const starData = new Float32Array(STARS * 12);
  for (let i = 0; i < STARS; i++) {
    let p;
    if (kind === "index") p = [(R() - 0.5) * 60, (R() - 0.5) * 34, 12 - R() * 64];
    else { const d = vec3.norm([R() - 0.5, R() - 0.5, R() - 0.5]); p = vec3.scale(d, 9 + R() * 22); }
    const b = Math.pow(R(), 3), temp = R();
    starData.set([...p, b, 0, temp, ...p, b, 1, temp], i * 12);
  }
  const stars = buffer(gl, starData);

  /** Point particles: positions, a direction (or orbit parameters) and size/colour/phase/speed. */
  const dust = list => {
    const d = new Float32Array(list.length * 10);
    list.forEach((x, i) => d.set([...x.p, ...(x.d || [0, 0, 0]), x.size, x.mix, x.phase ?? R(), x.speed ?? 0], i * 10));
    return { buf: buffer(gl, d), count: list.length };
  };
  /** Thick line segments: {a, b, phase, m0, m1} → quads expanded in screen space by BEAM_VS. */
  const beams = segs => {
    const v = new Float32Array(segs.length * 40), idx = new Uint16Array(segs.length * 6);
    segs.forEach((s, i) => {
      const corners = [[-1, 0, s.m0], [1, 0, s.m0], [-1, 1, s.m1], [1, 1, s.m1]];
      corners.forEach(([side, end, m], k) => v.set([...s.a, ...s.b, side, end, s.phase || 0, m], (i * 4 + k) * 10));
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    });
    return { buf: buffer(gl, v), idx: indexBuffer(gl, idx), count: segs.length * 6 };
  };
  const arc = (center, radius, tilt, a0, a1, n, m0, m1) => {
    const segs = [];
    for (let k = 0; k < n; k++) {
      const p = j => { const a = a0 + (a1 - a0) * j / n; return vec3.add(center, [Math.cos(a) * radius, Math.sin(a) * radius * Math.sin(tilt), Math.sin(a) * radius * Math.cos(tilt)]); };
      segs.push({ a: p(k), b: p(k + 1), phase: k / n, m0: m0 + (m1 - m0) * k / n, m1: m0 + (m1 - m0) * (k + 1) / n });
    }
    return segs;
  };

  // Entrée: ring grains in the ring plane (model space of the rings, planet radius 1).
  const belt0 = kind === "index" ? null : dust(Array.from({ length: Math.round(1400 * amount) }, () => {
    const a = R() * TAU, u = (R() + R()) / 2, r = 1.4 + 0.95 * u;
    return { p: [Math.cos(a) * r, (R() - 0.5) * 0.04, Math.sin(a) * r], size: 0.35 + R() * 1.1, mix: u, phase: 0 };
  }));

  // Entrée: the ring is one thin line (1.5 px), desaturated towards the rose.
  const ring0 = beams(arc(WORLDS[0].c, 1.75, 0.36, 0, TAU, 120, 0, 1));

  // Repères: four beams (the four domains) converge on one lens, a white beam leaves towards the next world.
  const c1 = WORLDS[1].c, c2 = WORLDS[2].c;
  const beamDirs = [[-0.75, 0.62, -0.5], [0.9, 0.55, -0.35], [-0.6, -0.7, -0.45], [0.85, -0.6, -0.55]].map(vec3.norm);
  const beams1 = beamDirs.map(d => beams(Array.from({ length: 6 }, (_, k) => ({ a: vec3.add(c1, vec3.scale(d, 9 - k * 1.5)), b: vec3.add(c1, vec3.scale(d, 9 - (k + 1) * 1.5 + 0.02)), phase: -k / 6, m0: k / 6, m1: (k + 1) / 6 }))));
  const outDir = vec3.norm(vec3.sub(c2, c1));
  const beamOut = beams(Array.from({ length: 6 }, (_, k) => ({ a: vec3.add(c1, vec3.scale(outDir, 0.3 + k * 1.1)), b: vec3.add(c1, vec3.scale(outDir, 0.3 + (k + 1) * 1.1)), phase: k / 6, m0: 1 - k / 6, m1: 1 - (k + 1) / 6 })));

  // Domaines: the sakura world-tree, the hero of its scene, read by its voids: a thin trunk that leans in a slow
  // S and thins as it rises; four limbs (the four domains, each reaching for its moon, a little off) leaving it
  // at different heights, each with its own rise, length and fork; a leader; flowers in separate clusters
  // towards the ends, so the sky shows between the limbs. It stands on a rock half in the black water and turns
  // with the moons' orbit. Local frame: y up, foot of the trunk at y -0.56, limb i towards angle i·90° in the
  // xz plane. TREE_S scales it about its foot.
  const TREE_S = 1.15;
  const TREE = (() => {
    const T = rng(4242), lines = [], clusters = [], tips = [];
    const trunk = [];
    for (let k = 0; k <= 8; k++) { const v = k / 8; trunk.push([0.075 * Math.sin(v * 2.5) - 0.035 * v, -0.56 + v * 0.52, 0.04 * Math.sin(v * 1.8 + 0.5) - 0.02]); }
    lines.push({ pts: trunk, r0: 0.05, r1: 0.028, id: 4 });
    // Roots gripping the rock, uneven.
    for (let i = 0; i < 5; i++) {
      const a = i * TAU / 5 + 0.3 + (T() - 0.5) * 0.6, len = 0.13 + T() * 0.1, pts = [];
      for (let k = 0; k <= 3; k++) { const v = k / 3; pts.push([trunk[0][0] + Math.cos(a) * v * len, -0.53 - v * 0.07 + Math.sin(v * 3) * 0.012, trunk[0][2] + Math.sin(a) * v * len]); }
      lines.push({ pts, r0: 0.032, r1: 0.008, id: 4 });
    }
    // A limb: steps along a heading whose elevation eases from e0 to e1, with a little sideways wander.
    const limb = (from, az, e0, e1, len, r0, r1, n = 8, wander = 0.25, id = 4) => {
      const pts = [from.slice()];
      let p = from.slice();
      for (let k = 1; k <= n; k++) {
        const v = k / n, el = e0 + (e1 - e0) * Math.pow(v, 0.8), a = az + Math.sin(v * 5 + az * 3) * wander * 0.3;
        p = vec3.add(p, vec3.scale([Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)], len / n));
        pts.push(p);
      }
      lines.push({ pts, r0, r1, id });
      return pts;
    };
    [
      { k: 6, jit: 0.16, e0: 1.1, e1: 0.2, len: 0.7 },     // long, opening wide
      { k: 7, jit: -0.22, e0: 1.25, e1: 0.5, len: 0.58 },  // steep
      { k: 5, jit: 0.1, e0: 0.95, e1: 0.08, len: 0.72 },   // low and sweeping
      { k: 8, jit: -0.14, e0: 1.3, e1: 0.6, len: 0.5 }     // short, rising
    ].forEach((L, i) => {
      const az = i * TAU / 4 + L.jit;
      const pts = limb(trunk[L.k], az, L.e0, L.e1, L.len, 0.03, 0.008, 9, 0.25, i);
      tips.push(pts[9]);
      clusters.push([pts[9], 0.17 + T() * 0.03, i]);
      // Flowers along the upper side of the limb's outer half: the umbrella of the crown, with gaps.
      clusters.push([vec3.add(pts[7], [0, 0.07, 0]), 0.1 + T() * 0.03, i]);
      // The fork: a branch leaves the limb at about 55 %, rising, to one side.
      const side = (i % 2 ? 1 : -1) * (0.55 + T() * 0.3);
      const fork = limb(pts[5], az + side, L.e0 * 0.9 + 0.25, L.e1 + 0.35, L.len * 0.45, 0.016, 0.006, 5, 0.25, i);
      clusters.push([fork[5], 0.13 + T() * 0.03, i]);
      // Two twigs near the tip, with small clusters.
      for (let s = 0; s < 2; s++) {
        const tw = limb(pts[6 + s * 2], az - side * (0.6 + s * 0.5), 0.9, 0.5, 0.12 + T() * 0.06, 0.008, 0.004, 3, 0.25, i);
        clusters.push([tw[3], 0.08 + T() * 0.03, i]);
      }
    });
    // The leader: the trunk goes on up, leaning, and forks at the top.
    const lead = limb(trunk[8], 2.6, 1.4, 1.05, 0.4, 0.028, 0.01, 7, 0.4);
    clusters.push([lead[7], 0.17, 4]);
    const lf = limb(lead[4], 5.2, 1.0, 0.6, 0.22, 0.014, 0.006, 4);
    clusters.push([lf[4], 0.12, 4]);
    return { lines, clusters, crown: trunk[8], tips };
  })();
  const treeMesh = tubeMesh(TREE.lines, 6);
  const tree = { buf: buffer(gl, treeMesh.data), idx: indexBuffer(gl, treeMesh.idx), count: treeMesh.idx.length };
  const HEART = [TREE.crown[0], TREE.crown[1] + 0.1, TREE.crown[2]];
  // Blossoms: clouds of small flowers at the twig tips and over the crown, as many as a cluster's size calls
  // for. Each keeps its direction from its cluster's centre, for the rim of light the backlight draws.
  const perArea = [14, 24, 40][startTier];
  const blossoms = dust(TREE.clusters.flatMap(([c, r, id]) => Array.from({ length: Math.max(3, Math.round(perArea * (r / 0.1) ** 2)) }, () => {
    const u = R() * TAU, w = Math.acos(2 * R() - 1), rr = r * Math.cbrt(R());
    const d = [Math.sin(w) * Math.cos(u), Math.abs(Math.cos(w)) * 0.75 - 0.15, Math.sin(w) * Math.sin(u)];
    return { p: vec3.add(c, vec3.scale(d, rr)), d: vec3.norm(d), size: 7 + R() * 8, mix: R(), phase: 0, speed: id };
  })));
  // Petals leaving the crown: they drift down past the moons to the water (DUST flow mode, tree frame).
  const shed = dust(Array.from({ length: [16, 28, 40][startTier] }, () => {
    const [c, r] = TREE.clusters[Math.floor(R() * TREE.clusters.length)];
    const p = [c[0] + (R() - 0.5) * r * 2, c[1] - 0.45, c[2] + (R() - 0.5) * r * 2];
    return { p, d: vec3.norm([0.25 + R() * 0.2, -1, 0.1 + R() * 0.2]), size: 1.4 + R() * 1.6, mix: R() * 0.6, speed: 0.06 + R() * 0.06 };
  }));
  // The black water: at the roots (the tree stands in it).
  const WATER_Y = c2[1] - 0.56 - 0.04 * TREE_S;
  const treeM = mat4.create();
  // One light per domain on its branch (the card pointed at): amount and tint, index 4 for trunk and leader.
  const LITK = new Float32Array(5), LITC = new Float32Array(15);
  DOM.forEach((col, i) => LITC.set(col, i * 3));
  const branchLight = u => { for (let i = 0; i < 4; i++) LITK[i] = state.focusAmt[i]; gl.uniform1fv(u.uLitK, LITK); gl.uniform3fv(u.uLitC, LITC); };
  const heartNow = [0, 0, 0];
  const REFLECT = (() => { const m = mat4.create(); m[5] = -1; m[13] = 2 * WATER_Y; return m; })();

  // Aether: nodes on two shells + interior relays, linked to their nearest neighbours.
  const meshNodes = [];
  for (let i = 0; i < 34; i++) {
    const y = 1 - (i / 33) * 2, r = Math.sqrt(1 - y * y), a = i * 2.39996;
    const s = i % 3 === 0 ? 0.62 : 1;
    meshNodes.push([Math.cos(a) * r * s, y * s, Math.sin(a) * r * s]);
  }
  const meshEdges = [];
  meshNodes.forEach((a, i) => {
    const near = meshNodes.map((b, j) => [j, vec3.len(vec3.sub(a, b))]).filter(([j]) => j !== i).sort((x, y) => x[1] - y[1]).slice(0, 3);
    near.forEach(([j]) => { if (i < j) meshEdges.push([i, j]); });
  });
  // Node index -> project, chosen to spread the labels around the mesh.
  const PARC = [[2, "THEHIVE", "squelette"], [7, "LA LUMINA", "langage .lum"], [12, "REMINISCENCE", "mémoire · à venir"], [16, "GREFFE", "contrat de modules"], [20, "LINH", "agent de terrain"], [25, "ALMAS", "banc d’essai"], [29, "NET", "accès"], [31, "LUCARNE", "interface"], [9, "LINHMESH", "réseau maillé · ouvert"]];
  const parcNodes = new Set(PARC.map(([n]) => n));
  const meshBeams = beams(meshEdges.map(([i, j], k) => ({ a: meshNodes[i], b: meshNodes[j], phase: (k * 0.37) % 1, m0: (k % 3) / 2, m1: ((k + 1) % 3) / 2 })));
  const prominences = beams((() => {
    const segs = [];
    for (let k = 0; k < 7; k++) {
      const a = vec3.norm([R() - 0.5, R() - 0.5, R() - 0.5]), axis = vec3.norm(vec3.cross(a, [R() - 0.5, R() - 0.5, R() - 0.5]));
      const span = 0.45 + R() * 0.35, h = 0.35 + R() * 0.5, n = 12;
      const at = j => {
        const th = span * j / n, c = Math.cos(th), s = Math.sin(th);
        const d = vec3.add(vec3.add(vec3.scale(a, c), vec3.scale(vec3.cross(axis, a), s)), vec3.scale(axis, vec3.dot(axis, a) * (1 - c)));
        return vec3.scale(vec3.norm(d), 1 + h * Math.sin(Math.PI * j / n));
      };
      for (let j = 0; j < n; j++) segs.push({ a: at(j), b: at(j + 1), phase: k / 7 + j / n, m0: Math.sin(Math.PI * j / n), m1: Math.sin(Math.PI * (j + 1) / n) });
    }
    return segs;
  })());
  const starM = mat4.create();
  const scaffold = beams(Array.from({ length: 14 }, (_, k) => {
    const i = (k * 7 + 3) % 34, j = (k * 11 + 17) % 34;
    return { a: meshNodes[i], b: meshNodes[j === i ? (j + 5) % 34 : j], phase: k / 14, m0: k % 2, m1: k % 2 };
  }));
  const meshDots = dust(meshNodes.map((p, i) => ({ p, size: parcNodes.has(i) ? 7 : 4, mix: parcNodes.has(i) ? 0 : 0.6, phase: 0 })));
  const accretion = dust(Array.from({ length: [220, 360, 500][startTier] }, () => {
    const r0 = 0.25 + R() * 0.2, r1 = 0.9 + R() * 1.1;
    return { p: [0, (R() - 0.5) * 0.3, 0], d: [r0, r1, R() * TAU], size: 0.4 + R() * 1.3, mix: R(), speed: 0.4 + R() * 0.8 };
  }));

  // The stream: luminous dust flowing along the route from world to world ("entre les mondes").
  const RIVER = [0.15, -1.1, 0];
  const stream = kind === "index" ? dust(Array.from({ length: [600, 900, 1200][startTier] }, () => {
    const u = R() * 6, w = Math.abs(((u / 2) % 1) - 0.5) * 2;
    const p = vec3.add(curve(PATH, u), vec3.scale(RIVER, 0.3 + 0.7 * w));
    const tan = vec3.norm(vec3.sub(curve(PATH, Math.min(6, u + 0.02)), curve(PATH, Math.max(0, u - 0.02))));
    const side = vec3.norm(vec3.cross(tan, [0, 1, 0])), up = vec3.cross(side, tan);
    const a = R() * TAU, rr = 0.06 + Math.pow(R(), 1.6) * 0.6;
    return { p: vec3.add(p, vec3.add(vec3.scale(side, Math.cos(a) * rr), vec3.scale(up, Math.sin(a) * rr * 0.6))), d: tan, size: 0.5 + R() * 1.3, mix: u / 6, speed: 0.05 + R() * 0.09 };
  })) : null;


  // Sakura petals: four corners per petal, home in a box that wraps around the camera (PETAL_VS). Composed by
  // light, not by number: 40 / 90 / 220 by tier on the index, 24 / 50 / 120 on a domain page.
  const PETALS = (kind === "index" ? [40, 90, 220] : [24, 50, 120])[startTier];
  const petalData = new Float32Array(PETALS * 48), petalIdx = new Uint16Array(PETALS * 6);
  for (let i = 0; i < PETALS; i++) {
    const seed = [R(), R(), R(), R()], axis = vec3.norm([R() - 0.5, R() - 0.5, R() - 0.5]), spin = 0.6 + R() * 2.2, ph = R(), tint = R() < 0.14 ? R() : 0;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([x, y], k) => petalData.set([...seed, ...axis, spin, x, y, ph, tint], (i * 4 + k) * 12));
    petalIdx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
  }
  const petals = { buf: buffer(gl, petalData), idx: indexBuffer(gl, petalIdx), count: PETALS * 6 };
  // Their shape, from the sprite (motifs.svg #sakura-petal-fill: obovate, a narrow V notch, a short claw; never a heart),
  // one tracing for the DOM and the world, rasterised once: R the membrane, G the outline, B the veins
  // (direction §5.3, §8.1). Mipmapped: an out-of-focus petal reads a coarser level.
  const petalTex = (() => {
    const cv = document.createElement("canvas");
    cv.width = 64; cv.height = 128;
    const g = cv.getContext("2d");
    if (!g || typeof Path2D === "undefined") return null;
    const k = 64 / 60; // symbol units (60 × 80) to texels: 64 × 85
    g.fillStyle = "#000"; g.fillRect(0, 0, 64, 128);
    g.setTransform(k, 0, 0, k, 0, 0);
    g.globalCompositeOperation = "lighter"; g.lineJoin = "round"; g.lineCap = "round";
    const petal = new Path2D("M27.86 76.05C21.45 65.6 8.62 50.4 7.9 31.4C7.48 18.1 15.74 6.32 26.58 5.56L30 11.26L33.42 5.56C44.26 6.32 52.52 18.1 52.1 31.4C51.38 50.4 38.55 65.6 32.14 76.05C30.86 77.57 29.14 77.57 27.86 76.05Z");
    g.fillStyle = "#f00"; g.fill(petal);
    g.strokeStyle = "#0f0"; g.lineWidth = 1.5 / k; g.stroke(petal);
    g.strokeStyle = "#00f"; g.lineWidth = 1.1 / k; g.stroke(new Path2D("M30 73C29.7 56 29.7 35 30 16M30 66C26.4 55 20.6 40.5 15.8 24.5M30 66C33.6 55 39.4 40.5 44.2 24.5"));
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  })();

  // Butterflies: two wings (quads) each, flapping in BFLY_VS; positions follow on the CPU.
  // The guide, plus two or four by tier on the index (direction §8.1); the guide alone on a domain page.
  const BFLY = kind === "index" ? [1, 3, 5][startTier] : 1;
  const bflyData = new Float32Array(BFLY * 32), bflyIdx = new Uint16Array(BFLY * 12);
  for (let i = 0; i < BFLY; i++) for (let w = 0; w < 2; w++) {
    const b = i * 8 + w * 4;
    [[0, -1], [1, -1], [0, 1], [1, 1]].forEach(([x, y], k) => bflyData.set([x, y, w ? 1 : -1, i], (b + k) * 4));
    bflyIdx.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], i * 12 + w * 6);
  }
  const bfly = { buf: buffer(gl, bflyData), idx: indexBuffer(gl, bflyIdx), count: BFLY * 12 };
  // Their wing, from the sprite (motifs.svg #butterfly-wing-r: membrane at .05, outline, veins, ocellus; not the
  // forewing's three dots, read as sparks), drawn once into a mipmapped texture: one species, a fine line, never
  // a bright blot (direction §5.3, §8.1, arbitrations §5).
  const wingTex = (() => {
    const cv = document.createElement("canvas");
    cv.width = 128; cv.height = 256;
    const g = cv.getContext("2d");
    if (!g || typeof Path2D === "undefined") return null;
    const k = 128 / 60; // symbol units (x 60..120, y 0..100) to texels: 128 × 213
    g.setTransform(k, 0, 0, k, -60 * k, 0);
    g.fillStyle = g.strokeStyle = "#fff"; g.lineJoin = "round"; g.lineCap = "round";
    const wing = new Path2D("M61.5 41C68 31.5 82 20.5 99 14.5C107.5 11.5 114.5 13.5 113.5 19.5C112.5 26.5 104 38 92.5 46.5C84.5 52 72.5 53 62 49.5ZM62 51.5C72 50.5 85.5 53.5 92 60C97.5 65.5 96.5 74.5 89.5 79C87.5 84 86.5 90 84 95.5C81.5 90.5 80.2 85.5 79.6 81.5C72 80.5 65 69.5 62 57.5Z");
    g.globalAlpha = 0.05; g.fill(wing);
    g.globalAlpha = 1; g.lineWidth = 1.6 / k; g.stroke(wing);
    g.globalAlpha = 0.42; g.lineWidth = 1 / k;
    g.stroke(new Path2D("M63 44.5C76 35 91 24.5 108 18M63.5 46.5C76 43 90 40 103.5 33.5M64 48.5C74 48 85 47.5 94 45M64 54C73 56 83 60 90.5 64.5M64 56.5C70 63.5 76 71.5 83.5 79"));
    g.globalAlpha = 0.8; g.lineWidth = 1.2 / k; g.beginPath(); g.arc(86.5, 69.5, 2.9, 0, TAU); g.stroke();
    g.globalAlpha = 1; g.beginPath(); g.arc(86.5, 69.5, 1.05, 0, TAU); g.fill();
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  })();
  const BF0 = new Float32Array(48), BF1 = new Float32Array(48);
  const flock = Array.from({ length: BFLY }, () => ({ pos: null, vel: [0, 0, 0], head: [1, 0, 0], phase: R(), lead: 0.3 + R() * 0.6, a0: R() * TAU, a1: R() * TAU, r: 0.3 + R() * 0.45, size: 0.035 + R() * 0.015 }));



  // ---------- Targets ----------
  const fmt = floatFormat(gl);
  let sceneRT = null, skyRT = null, raysRT = null, reflRT = null, target = null, down = [], up = [], cssW = 1, cssH = 1;
  // Phosphor persistence: at the top tier the post pass writes into one of two full-resolution history targets,
  // read back next frame; at tier 1 a half-resolution history of the scene is kept by a small pass (PHOS_FS).
  const hist = [null, null];
  let histCur = 0, histLive = false;
  function bloomTargets(w, h, levels) {
    let bw = w, bh = h;
    for (let i = 0; i < 6; i++) {
      bw = Math.max(1, Math.ceil(bw / 2)); bh = Math.max(1, Math.ceil(bh / 2));
      if (i < levels) {
        down[i] = colorTarget(gl, bw, bh, fmt, down[i]) || colorTarget(gl, bw, bh, null, down[i]);
        up[i] = i < levels - 1 ? colorTarget(gl, bw, bh, fmt, up[i]) || colorTarget(gl, bw, bh, null, up[i]) : null;
      }
    }
  }
  function resize(readLayout = true) {
    if (readLayout) { cssW = Math.max(1, canvas.clientWidth); cssH = Math.max(1, canvas.clientHeight); }
    const T = TIERS[q.tier];
    q.ratio = Math.max(0.35, Math.min(window.devicePixelRatio || 1, T.dpr, Math.sqrt(T.budget / (cssW * cssH))) * q.scale);
    const w = Math.max(1, Math.round(cssW * q.ratio)), h = Math.max(1, Math.round(cssH * q.ratio));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    sceneRT = sceneTarget(gl, w, h, T.msaa, sceneRT);
    skyRT = colorTarget(gl, Math.max(1, Math.ceil(w / T.sky)), Math.max(1, Math.ceil(h / T.sky)), null, skyRT);
    bloomTargets(w, h, T.bloom);
    histLive = false;
    const hd = q.tier === 2 ? 1 : 2, hw = Math.max(1, Math.ceil(w / hd)), hh = Math.max(1, Math.ceil(h / hd));
    if (q.tier > 0 && !QA.off("persist")) { hist[0] = colorTarget(gl, hw, hh, null, hist[0]); hist[1] = colorTarget(gl, hw, hh, null, hist[1]); }
    else for (let i = 0; i < 2; i++) if (hist[i]) { gl.deleteTexture(hist[i].tex); gl.deleteFramebuffer(hist[i].fb); hist[i] = null; } // a lower tier gives the memory back
    if (kind === "index" && q.tier > 0) { const d = q.tier === 2 ? 2 : 3; reflRT = sceneTarget(gl, Math.max(1, Math.ceil(w / d)), Math.max(1, Math.ceil(h / d)), 0, reflRT); }
    raysRT = q.tier > 0 ? colorTarget(gl, Math.max(1, Math.ceil(w / 4)), Math.max(1, Math.ceil(h / 4)), fmt, raysRT) || colorTarget(gl, Math.max(1, Math.ceil(w / 4)), Math.max(1, Math.ceil(h / 4)), null, raysRT) : raysRT;
  }

  // ---------- State ----------
  const state = {
    route: 0, vel: 0, px: 0, py: 0, spx: 0, spy: 0, focus: -1, focusAmt: [0, 0, 0, 0],
    glitch: 0, glitchUntil: 0, glitchPeak: 0, title: null, fade: 0, flight: 0, span: 0, scroll: 0, scrollY: null, floor: 0, time: 0, clock: 0, bank: 0,
    worldTime: performance.now() / 1000, pace: 1, paceTarget: 1, ptrAt: -1e9, ptrK: 0,
    detail: detailIndex
  };
  const view = mat4.create(), proj = mat4.create(), M = mat4.create(), M2 = mat4.create(), MI = mat4.identity(mat4.create());
  let ptrDir = [0, 0, -1];
  let eye = [0, 0, 3], lastEye = null, lastFwd = null, camR = [1, 0, 0], camU = [0, 1, 0], camF = [0, 0, -1], tanXY = [1, 1], streak = [0, 0, 0];
  const sky = { a: [0, 0, 0], b: [0, 0, 0], c: [0, 0, 0], deep: [0, 0, 0], sun: [0, 0, -1], sunCol: [0, 0, 0], glow: 0 };
  const t = () => state.time;

  // ---------- Annotations: world points the page labels in screen space ----------
  let marks = [];
  const mark = (key, pos, alpha, label, sub, tone) => { if (alpha > 0.02) marks.push({ key, pos, alpha, label, sub, tone }); };
  function project(pos) {
    const v = view, p = proj;
    const vx = v[0] * pos[0] + v[4] * pos[1] + v[8] * pos[2] + v[12], vy = v[1] * pos[0] + v[5] * pos[1] + v[9] * pos[2] + v[13], vz = v[2] * pos[0] + v[6] * pos[1] + v[10] * pos[2] + v[14];
    const cx = p[0] * vx + p[8] * vz, cy = p[5] * vy + p[9] * vz, cw = -vz;
    if (cw <= 0.05) return null;
    return { x: (cx / cw * 0.5 + 0.5) * cssW, y: (1 - (cy / cw * 0.5 + 0.5)) * cssH, depth: cw };
  }
  const routeNow = () => reduced.matches ? Math.round(state.route) : state.route;
  const sceneAlpha = i => kind !== "index" ? 1 : Math.max(0, 1 - Math.abs(routeNow() - i) / 0.38);
  const near = i => kind !== "index" ? 1 : Math.max(0, 1 - Math.abs(routeNow() - i) / 1.45);

  // ---------- Draw helpers ----------
  const blendAdd = () => gl.blendFunc(gl.ONE, gl.ONE);
  const blendOver = () => gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const common = u => { gl.uniformMatrix4fv(u.uProj, false, proj); gl.uniformMatrix4fv(u.uView, false, view); };

  /** light = { dir, col, amb }; opts.ring = { c, n, r: [inner, outer] (world), k, seed }. */
  function drawPlanet(model, mat, light, opts = {}) {
    const { p, u, a } = P.planet;
    gl.useProgram(p); common(u);
    gl.uniformMatrix4fv(u.uModel, false, model);
    gl.uniform3fv(u.uCam, eye); gl.uniform3fv(u.uLight, light.dir); gl.uniform3fv(u.uLightCol, light.col); gl.uniform3fv(u.uAmb, light.amb);
    gl.uniform3fv(u.uFill, light.fill); gl.uniform3fv(u.uFillCol, light.fillCol);
    gl.uniform3fv(u.uDeep, mat.deep); gl.uniform3fv(u.uMid, mat.mid); gl.uniform3fv(u.uHigh, mat.high); gl.uniform3fv(u.uHot, mat.hot); gl.uniform3fv(u.uAtmo, mat.atmo);
    gl.uniform1f(u.uKind, mat.kind); gl.uniform1f(u.uSeed, mat.seed); gl.uniform1f(u.uBands, mat.bands || 7); gl.uniform1f(u.uTime, t());
    gl.uniform1f(u.uEnergy, opts.energy || 0); gl.uniform1f(u.uOpacity, opts.opacity ?? 1);
    // The limb in the page's one tint, at f²·.35 (no rainbow: one bright colour per screen).
    gl.uniform1f(u.uIri, mat.kind !== 7 ? 0.35 : 0); gl.uniform3fv(u.uIriCol, pageTint);
    // Pixels per radius on screen, so surface details can stay crisp without shimmering when small.
    const dist = Math.max(0.001, Math.hypot(model[12] - eye[0], model[13] - eye[1], model[14] - eye[2]));
    gl.uniform1f(u.uPxR, Math.hypot(model[0], model[1], model[2]) / dist * proj[5] * (target || sceneRT).h * 0.5); gl.uniform1f(u.uGrid, mat.grid || 0); gl.uniform1f(u.uStorm, mat.storm ?? 1);
    const r = opts.ring;
    gl.uniform1f(u.uRingK, r ? r.k : 0);
    if (r) { gl.uniform3fv(u.uRingC, r.c); gl.uniform3fv(u.uRingN, r.n); gl.uniform2f(u.uRingR, r.r[0], r.r[1]); gl.uniform1f(u.uRingSeed, r.seed); }
    attribs(gl, sphBuf, [[a.aPos, 3]]);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sphIdx);
    gl.drawElements(gl.TRIANGLES, sphCount, gl.UNSIGNED_SHORT, 0);
  }
  /** Atmosphere around a body: cool colour all round, warm towards the sun, a bright ring when backlit. */
  function drawHalo(center, radius, color, warm, lightDir, alpha, extent = 2.1, fall = 3.2) {
    if (alpha <= 0.003) return;
    const toC = vec3.sub(center, eye), D = vec3.len(toC);
    if (D <= radius * 1.08) return;
    const push = radius * 0.98, limb = (D - push) * radius / Math.sqrt(D * D - radius * radius);
    const lx = view[0] * lightDir[0] + view[4] * lightDir[1] + view[8] * lightDir[2], ly = view[1] * lightDir[0] + view[5] * lightDir[1] + view[9] * lightDir[2];
    const back = Math.pow(Math.max(0, vec3.dot(vec3.scale(toC, 1 / D), lightDir)), 4);
    const { p, u, a } = P.halo;
    gl.useProgram(p); common(u);
    gl.uniform3fv(u.uCenter, center); gl.uniform1f(u.uSize, limb * extent); gl.uniform1f(u.uPush, push);
    gl.uniform1f(u.uExtent, extent); gl.uniform3fv(u.uColor, color); gl.uniform3fv(u.uWarm, warm); gl.uniform2f(u.uLight2, lx, ly);
    gl.uniform1f(u.uAlpha, alpha); gl.uniform1f(u.uFall, fall); gl.uniform1f(u.uBack, back * 1.6 * alpha);
    attribs(gl, quad, [[a.aCorner, 2]]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function drawRing(model, inner, outer, normal, center, radius, cols, alpha, seed, light) {
    if (alpha <= 0.003) return;
    const { p, u, a } = P.ring;
    gl.useProgram(p); common(u);
    gl.uniformMatrix4fv(u.uModel, false, model); gl.uniform2f(u.uR, inner, outer);
    gl.uniform3fv(u.uCam, eye); gl.uniform3fv(u.uLight, light.dir); gl.uniform3fv(u.uLightCol, light.col);
    gl.uniform3fv(u.uRingN, normal); gl.uniform3fv(u.uCenter, center); gl.uniform1f(u.uRad, radius);
    gl.uniform3fv(u.uColA, cols[0]); gl.uniform3fv(u.uColB, cols[1]); gl.uniform3fv(u.uColC, cols[2]);
    gl.uniform1f(u.uAlpha, alpha); gl.uniform1f(u.uSeed, seed);
    attribs(gl, ringBuf, [[a.aRing, 3]]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, ring.count);
  }
  function drawTorus(model, look, alpha, light = sky.sun) {
    if (alpha <= 0.003) return;
    const { p, u, a } = P.torus;
    gl.useProgram(p); common(u);
    gl.uniformMatrix4fv(u.uModel, false, model);
    gl.uniform3fv(u.uCam, eye); gl.uniform3fv(u.uLight, light); gl.uniform3fv(u.uBase, look.base); gl.uniform3fv(u.uEmit, look.emit);
    gl.uniform3fv(u.uEnvA, sky.deep); gl.uniform3fv(u.uEnvB, look.env || sky.b);
    gl.uniform1f(u.uTime, t()); gl.uniform1f(u.uDash, look.dash || 24); gl.uniform1f(u.uSpeed, look.speed || 0.1); gl.uniform1f(u.uSpin, look.spin || 0); gl.uniform1f(u.uAlpha, alpha);
    attribs(gl, torBuf, [[a.aPos, 3], [a.aNrm, 3], [a.aUV, 2]]);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, torIdx);
    gl.drawElements(gl.TRIANGLES, torCount, gl.UNSIGNED_SHORT, 0);
  }
  function drawBeams(set, model, colA, colB, width, alpha, pulse = 0, speed = 0.2, build = 0) {
    if (alpha <= 0.003) return;
    const { p, u, a } = P.beam;
    gl.useProgram(p); common(u);
    const rt = target || sceneRT;
    gl.uniformMatrix4fv(u.uModel, false, model); gl.uniform2f(u.uRes, rt.w, rt.h);
    gl.uniform1f(u.uWidth, width * q.ratio * rt.w / sceneRT.w); gl.uniform3fv(u.uColA, colA); gl.uniform3fv(u.uColB, colB);
    gl.uniform1f(u.uAlpha, alpha); gl.uniform1f(u.uTime, t()); gl.uniform1f(u.uPulse, pulse); gl.uniform1f(u.uSpeed, speed); gl.uniform1f(u.uBuild, build);
    attribs(gl, set.buf, [[a.aA, 3], [a.aB, 3], [a.aInfo, 4]]);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, set.idx);
    gl.drawElements(gl.TRIANGLES, set.count, gl.UNSIGNED_SHORT, 0);
  }
  function drawSprite(center, size, color, alpha, shape = 0, core = 40, ringAmt = 0, rot = 0) {
    if (alpha <= 0.003) return;
    const { p, u, a } = P.sprite;
    gl.useProgram(p); common(u);
    gl.uniform3fv(u.uCenter, center); gl.uniform1f(u.uSize, size); gl.uniform1f(u.uScreen, 0);
    gl.uniform3fv(u.uColor, color); gl.uniform1f(u.uAlpha, alpha); gl.uniform1f(u.uCore, core); gl.uniform1f(u.uRing, ringAmt);
    gl.uniform1f(u.uShape, shape); gl.uniform1f(u.uRot, rot); gl.uniform1f(u.uTime, t());
    attribs(gl, quad, [[a.aCorner, 2]]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function drawDust(geo, model, mode, cols, alpha, len = 0.6, nearFade = 0.25) {
    if (alpha <= 0.003 || !geo) return;
    const { p, u, a } = P.dust;
    gl.useProgram(p); common(u);
    gl.uniformMatrix4fv(u.uModel, false, model); gl.uniform3fv(u.uCam, eye);
    gl.uniform1f(u.uPx, q.ratio); gl.uniform1f(u.uTime, t()); gl.uniform1f(u.uMode, mode); gl.uniform1f(u.uLen, len); gl.uniform1f(u.uNear, nearFade);
    gl.uniform3fv(u.uColA, cols[0]); gl.uniform3fv(u.uColB, cols[1]); gl.uniform3fv(u.uColC, cols[2]); gl.uniform1f(u.uAlpha, alpha);
    attribs(gl, geo.buf, [[a.aPos, 3], [a.aDir, 3], [a.aInfo, 4]]);
    gl.drawArrays(gl.POINTS, 0, geo.count);
  }
  const lightOf = (dir, col, amb = [0.02, 0.015, 0.035], fillCol = C.dev) => ({ dir, col, amb, fill: vec3.norm([-dir[0], -dir[1] - 0.6, -dir[2]]), fillCol });
  /** Right-handed frame whose Y axis is n (a torus built in XZ then faces n). */
  const frameFor = n => { const x = vec3.norm(vec3.cross(Math.abs(n[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0], n)); return [x, n, vec3.cross(x, n)]; };
  const ringNormal = m => vec3.norm([m[4], m[5], m[6]]);

  // ---------- Worlds (pass 0: opaque bodies, pass 1: light, rings and particles) ----------
  const SUN0 = SKY_INDEX[0].sun;
  const ICE = [124 / 255, 233 / 255, 1];
  const L0 = lightOf(SUN0, mix(C.accent, WHITE, 0.62), [0.03, 0.02, 0.06], mul(ICE, 0.5));
  const planetM0 = mat4.create();
  function world0(o, pass) {
    // The Entrée: the planet's centre is out of the frame at the bottom right (camera()); only its crescent, lit
    // from the top left, shows, with the cold rim of its night side and its ring drawn as one thin line. Nothing
    // else: no moons, no probe, no sun disc, nothing behind the title.
    const c = WORLDS[0].c;
    if (pass === 0) {
      drawPlanet(mat4.model(planetM0, c, 0.12, t() * 0.035, 0.08, 1), MAT.hero, L0);
      return;
    }
    // Leaving, the camera swings up over the ring: it dims from the first fifth of the way, so a single step
    // never flashes (WCAG 2.3.1).
    const leave = 1 - 0.75 * smoothstep(0.02, 0.18, routeNow());
    const ringCol = mul(mix(C.accent, WHITE, 0.45), 0.7);
    drawBeams(ring0, MI, ringCol, ringCol, 1.5, 0.35 * o * leave, 0, 0);
    drawHalo(c, 1, mul(C.accent, 0.35), mix(C.accent, WHITE, 0.3), SUN0, 0.45 * o * (1 + arrive * 0.35), 1.9, 4.6);
  }

  const L1 = lightOf(SKY_INDEX[1].sun, mix(C.photo, WHITE, 0.7), [0.025, 0.02, 0.05], C.accent);
  const lensM = mat4.create();
  function world1(o, pass) {
    const c = c1;
    const a = t() * 0.22;
    const moon = vec3.add(c, [Math.cos(a) * 1.5, Math.sin(a * 0.7) * 0.25, Math.sin(a) * 1.5]);
    if (pass === 0) {
      drawPlanet(mat4.model(M, c, 0.4, t() * 0.05, -0.2, 0.74), MAT.ocean, L1);
      drawPlanet(mat4.model(M, moon, 0, -t() * 0.2, 0, 0.21), MAT.moon, L1);
      return;
    }
    blendAdd();
    drawHalo(c, 0.74, mul(mix(C.dev, WHITE, 0.55), 0.55), mix(C.accent, WHITE, 0.7), SKY_INDEX[1].sun, 0.5 * o * (1 + arrive * 0.35), 1.9, 4.4);
    drawHalo(moon, 0.21, mul(mix(C.worlds, WHITE, 0.6), 0.7), mix(C.worlds, WHITE, 0.7), SKY_INDEX[1].sun, 0.35 * o, 2.1, 5);
    // The lens: a graduated ring of light around both bodies, facing the beams.
    const [lx, ly, lz] = frameFor(vec3.norm(vec3.add(vec3.norm(vec3.sub(WORLDS[1].eye, c)), [0.35, 0.25, 0])));
    // The eye: the world is its pupil, an iris of light fibres turns around it inside the lens.
    {
      const { p, u, a } = P.iris;
      gl.useProgram(p); common(u);
      gl.uniformMatrix4fv(u.uModel, false, mat4.basis(M, c, lx, ly, lz, 1)); gl.uniform2f(u.uR, 0.8, 1.13);
      gl.uniform3fv(u.uColA, mix(C.accent, WHITE, 0.55)); gl.uniform3fv(u.uColB, mul(WHITE, 0.85)); gl.uniform3fv(u.uColC, mix(C.worlds, WHITE, 0.65));
      // 0.005 turn/s: 18 whole turns in the clock's hour, so its wrap does not jump.
      gl.uniform1f(u.uSpin, (t() * 0.005) % 1); gl.uniform1f(u.uAlpha, 0.5 * o * (1 + arrive * 0.25));
      attribs(gl, ringBuf, [[a.aRing, 3]]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, ring.count);
    }
    blendOver();
    drawTorus(mat4.basis(lensM, c, lx, ly, lz, 1.16), { base: [0.07, 0.06, 0.1], emit: mul(WHITE, 0.5), env: mul(mix(C.worlds, WHITE, 0.5), 0.35), dash: 36, speed: 0.06 }, o, SKY_INDEX[1].sun);
    drawTorus(mat4.basis(M, c, lx, ly, lz, 1.3), { base: [0.06, 0.05, 0.08], emit: mul(mix(C.accent, WHITE, 0.6), 0.4), env: mul(WHITE, 0.25), dash: 72, speed: -0.03 }, o * 0.85, SKY_INDEX[1].sun);
    blendAdd();
    // Four ways of looking (the four domains) meet in one lens; one beam goes on to the domains.
    beams1.forEach((b, i) => drawBeams(b, MI, mul(DOM[i], 0.08), DOM[i], 2, 0.42 * o, 1, 0.18));
    drawBeams(beamOut, MI, mul(WHITE, 0.1), WHITE, 2.2, 0.32 * o, 1, 0.22);
    drawSprite(c, 0.4, WHITE, 0.3 * o, 0, 30);
  }

  const tipPos = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  function drawTree() {
    const { p, u, a } = P.tree;
    gl.useProgram(p); common(u);
    gl.uniformMatrix4fv(u.uModel, false, treeM); gl.uniform3fv(u.uCam, eye); gl.uniform3fv(u.uHeart, mat4.apply(treeM, HEART));
    // Against the backlight the wood reads dark: deep bark, a rim of light along its edges.
    gl.uniform3fv(u.uBark, [0.04, 0.02, 0.032]); gl.uniform3fv(u.uRim, mix(C.accent, WHITE, 0.35)); gl.uniform3fv(u.uFill, mul(C.dev, 0.3)); gl.uniform3fv(u.uSap, C.accent);
    gl.uniform1f(u.uTime, t()); branchLight(u);
    attribs(gl, tree.buf, [[a.aPos, 3], [a.aNrm, 3], [a.aV, 1], [a.aId, 1]]);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, tree.idx);
    gl.drawElements(gl.TRIANGLES, tree.count, gl.UNSIGNED_SHORT, 0);
  }
  function drawWater(o) {
    const { p, u, a } = P.water;
    gl.useProgram(p); common(u);
    bind(2, reflRT ? reflRT.tex : noise);
    gl.uniform3f(u.uC, c2[0], WATER_Y, c2[2]); gl.uniform1f(u.uR, 2.4 * TREE_S); gl.uniform2f(u.uRes, sceneRT.w, sceneRT.h);
    gl.uniform3fv(u.uCam, eye); gl.uniform3fv(u.uDeep, [0.006, 0.006, 0.016]); gl.uniform3fv(u.uNeonA, C.accent); gl.uniform3fv(u.uNeonB, C.dev);
    gl.uniform1f(u.uTime, t()); gl.uniform1f(u.uRain, 0); gl.uniform1f(u.uHasRefl, mirrored ? 1 : 0); gl.uniform1f(u.uAlpha, 0.92 * o);
    attribs(gl, quad, [[a.aCorner, 2]]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function drawBlossoms(cols, rimCol, alpha) {
    if (alpha <= 0.003) return;
    const { p, u, a } = P.blossom;
    gl.useProgram(p); common(u);
    gl.uniformMatrix4fv(u.uModel, false, treeM); gl.uniform3fv(u.uCam, eye);
    gl.uniform1f(u.uPx, q.ratio); gl.uniform1f(u.uSize, TREE_S);
    gl.uniform3fv(u.uColA, cols[0]); gl.uniform3fv(u.uColB, cols[1]); gl.uniform3fv(u.uColC, cols[2]); gl.uniform3fv(u.uRimCol, rimCol); gl.uniform1f(u.uAlpha, alpha);
    branchLight(u);
    attribs(gl, blossoms.buf, [[a.aPos, 3], [a.aDir, 3], [a.aInfo, 4]]);
    gl.drawArrays(gl.POINTS, 0, blossoms.count);
  }
  function world2(o, pass, mirror = false) {
    const c = c2;
    // The tree turns slowly: 90 s, 40 whole turns in the clock's hour (its wrap does not jump).
    // Its four limbs are the four domains: pointing at a card lights its branch.
    const phi = t() * TAU * 40 / 3600, cp = Math.cos(phi), sp = Math.sin(phi);
    mat4.basis(treeM, vec3.add(c, [0, 0.56 * (TREE_S - 1), 0]), [cp, 0, sp], [0, 1, 0], [-sp, 0, cp], TREE_S);
    const heart = mat4.apply(treeM, HEART);
    heartNow[0] = heart[0]; heartNow[1] = heart[1]; heartNow[2] = heart[2];
    for (let i = 0; i < 4; i++) tipPos[i] = mat4.apply(treeM, TREE.tips[i]);
    if (pass === 0) { drawTree(); return; }
    // Backlight: a great pale glow behind the crown, on the camera's line through the heart. Drawn before the
    // water (which hides what of it lies below the water line); the trunk and the limbs, opaque, stand dark
    // against it; the light shafts start from it.
    blendAdd();
    const back = vec3.add(heart, vec3.scale(vec3.norm(vec3.sub(heart, eye)), 2.2));
    drawSprite(back, 1.95 * TREE_S, mix(C.accent, C.worlds, 0.35), 0.3 * o * (1 + arrive * 0.25), 0, 2.2);
    drawSprite(back, 0.85 * TREE_S, mix(C.accent, WHITE, 0.55), 0.2 * o, 0, 5);
    // Black water under the tree, with the mirror image rendered beforehand.
    if (!mirror) { blendOver(); drawWater(o); }
    blendAdd();
    // The heart of the tree: the person, one light, four ways of looking at it.
    drawSprite(heart, 0.36, mix(C.accent, C.writing, 0.3), 0.07 * o * (1 + arrive), 0, 12);
    drawSprite(heart, 0.08, mix(C.accent, WHITE, 0.7), 0.42 * o, 0, 60);
    // Blossoms cover each other (they are petals, not lights): deep pink clusters that never burn to white,
    // with a rim of light where they stand against the glow.
    blendOver();
    drawBlossoms([mul(mix(C.accent, WHITE, 0.4), 0.7), mul(C.accent, 0.6), mul(mix(C.writing, C.accent, 0.5), 0.48)], mul(mix(C.accent, WHITE, 0.6), 0.95), 0.82 * o);
    blendAdd();
    if (!mirror) drawDust(shed, treeM, 1, [mix(C.accent, WHITE, 0.5), C.accent, C.writing], 0.85 * o, 1.6, 0.3);
  }

  const meshM = mat4.create(), armM = [mat4.create(), mat4.create(), mat4.create()];
  const toGiantDir = (c, giant) => vec3.norm(vec3.sub(c, giant));
  function world3(o, pass, c = WORLDS[3].c, withPlanet = true) {
    // On portrait screens the camera stands further back: the horizon goes lower, under the buttons.
    const giant = vec3.add(c, [-1.2, -5.25 - (kind === "index" ? portraitAmount() * 1.6 : 0), -3.4]);
    const giantAlpha = !withPlanet ? 0 : kind !== "index" ? 1 : clamp01((routeNow() - 2.2) / 0.5);
    const giantLight = lightOf(toGiantDir(c, giant), mix(C.aether, WHITE, 0.3), [0.02, 0.012, 0.03]);
    const toGiant = giantLight.dir;
    mat4.model(starM, c, 0.3, t() * 0.09, 0.1, 0.17);
    if (pass === 0) {
      if (giantAlpha >= 1) drawPlanet(mat4.model(M, giant, 0.2, t() * 0.02, 0.3, 2.9), MAT.giant, giantLight);
      // Lumina: a living star at the heart of the parc.
      drawPlanet(starM, MAT.lumina, giantLight);
      return;
    }
    if (giantAlpha > 0 && giantAlpha < 1) { blendOver(); drawPlanet(mat4.model(M, giant, 0.2, t() * 0.02, 0.3, 2.9), MAT.giant, giantLight, { opacity: giantAlpha }); }
    blendAdd();
    if (giantAlpha > 0) drawHalo(giant, 2.9, mul(C.aether, 0.35), C.aether, toGiant, 0.5 * o * giantAlpha, 1.4, 6);
    mat4.model(meshM, c, 0.2 + Math.sin(t() * 0.1) * 0.05, t() * 0.06, 0, 1.25);
    // Armillary sphere: three gilded rings turning around Lumina.
    const arm = [[0.3, t() * 0.05, 0.1, 0.78], [1.25, -t() * 0.04, 0.5, 0.92], [-0.6, t() * 0.03, -0.9, 1.06]];
    blendOver();
    arm.forEach(([rx, ry, rz, s], i) => drawTorus(mat4.model(armM[i], c, rx, ry, rz, s), { base: mul(C.aether, 0.3), emit: i === 1 ? C.accent : C.aether, env: mul(C.aether, 0.55), dash: 22 + i * 10, speed: 0.04 * (i % 2 ? -1 : 1) }, o * 0.9, [0, 1, 0]));
    blendAdd();
    drawBeams(meshBeams, meshM, C.aether, C.accent, 1.5, 0.42 * o, 1.2, 0.35);
    // The grand chantier: chords of the parc still being drawn, a spark at their head.
    drawBeams(scaffold, meshM, mix(C.aether, WHITE, 0.4), C.aether, 1.2, 0.5 * o, 0, 0, 1);
    drawDust(meshDots, meshM, 0, [mix(C.aether, WHITE, 0.4), C.aether, C.accent], 1 * o);
    mat4.model(M2, c, 0.25, 0, 0.1, 1);
    drawDust(accretion, M2, 2, [C.aether, mix(C.aether, WHITE, 0.4), C.accent], 0.6 * o);
    const pulse = 0.5 + 0.5 * Math.sin(t() * 2.1);
    drawBeams(prominences, starM, mul(C.aether, 0.6), mix(C.accent, C.aether, 0.4), 2.6, 0.6 * o, 1.4, 0.45);
    drawSprite(c, 0.95, mix(C.aether, C.accent, 0.25), (0.15 + pulse * 0.06) * o * (1 + arrive * 0.6), 4, 26);
    drawSprite(c, 0.42, C.aether, (0.16 + pulse * 0.08) * o, 0, 22, 0.35);
    // The mesh is the parc: its nodes carry the real project names.
    const sa = sceneAlpha(3) * (kind === "index" ? 1 : 0.9);
    mark("lumina", c, sa, "LUMINA", "système cognitif", "aether");
    PARC.forEach(([node, name, sub], k) => mark("n" + k, mat4.apply(meshM, meshNodes[node]), sa * 0.92, name, sub, k % 3 ? "dim" : "aether"));
  }
  const worldFns = [world0, world1, world2, world3];

  // Gates between worlds: the camera passes through rings of light on every transition.
  const gateM = mat4.create();
  const GATES = [1, 3, 5].map((k, i) => {
    const p = PATH[k], tan = vec3.norm(vec3.sub(curve(PATH, k + 0.02), curve(PATH, k - 0.02)));
    const side = vec3.norm(vec3.cross(tan, [0, 1, 0])), up = vec3.cross(side, tan);
    return { p, tan, side, up, cols: [[mix(C.worlds, WHITE, 0.6), mix(C.dev, WHITE, 0.6)], [C.dev, C.writing, C.photo, C.worlds], [C.aether, mix(C.aether, WHITE, 0.4)]][i] };
  });
  // Arrival: when the camera settles on a new world, its light swells for a moment.
  let arrive = 0, arrivedAt = -1;
  function arrival(dt) {
    arrive *= Math.exp(-dt * 1.6);
    if (kind !== "index" || reduced.matches) return;
    const r = routeNow(), i = Math.round(r);
    if (Math.abs(r - i) < 0.08 && i !== arrivedAt) { if (arrivedAt >= 0) arrive = 1; arrivedAt = i; }
  }
  const gateSide = [0, 0, 0];
  function crossGates() {
    if (kind !== "index" || reduced.matches) return;
    GATES.forEach((g, i) => {
      const s = Math.sign(vec3.dot(vec3.sub(eye, g.p), g.tan));
      if (gateSide[i] && s !== gateSide[i] && vec3.len(vec3.sub(eye, g.p)) < 2) {
        // For the sound (and anything else): the camera has just passed gate i. No flash, no glitch.
        canvas.dispatchEvent(new CustomEvent("world-gate", { bubbles: true, detail: { gate: i, to: i + 1 } }));
      }
      gateSide[i] = s;
    });
  }
  const TUNNEL = [0, 2, 3][startTier];
  const tunnels = GATES.map((g, i) => Array.from({ length: TUNNEL * 2 }, (_, k) => {
    const s = (k % 2 ? 1 : -1) * 0.13 * (1 + (k >> 1)), u = 2 * i + 1 + s;
    const p = curve(PATH, u), tan = vec3.norm(vec3.sub(curve(PATH, u + 0.02), curve(PATH, u - 0.02)));
    const side = vec3.norm(vec3.cross(tan, [0, 1, 0])), up = vec3.cross(side, tan);
    return { p, tan, side, up, size: 1.05 + 0.12 * (k >> 1) };
  }));
  function gates(pass) {
    if (pass === 0) return;
    const r = routeNow();
    GATES.forEach((g, i) => {
      const prox = Math.max(0, 1 - Math.abs(r - (i + 0.5)) / 0.45);
      if (prox <= 0) return;
      blendOver();
      // Rings the camera is about to pass through fade out before they fill the screen: the crossing stays
      // a rush of light, not a flood of one colour.
      const passing = p => smoothstep(0.7, 2.3, vec3.len(vec3.sub(eye, p)));
      // Through the ring, the sky of the world on the other side (tier 1 and up); it opens out as the camera
      // nears, and is gone before it would fill the screen.
      if (q.tier > 0) {
        const dest = SKY_INDEX[Math.sign(vec3.dot(vec3.sub(eye, g.p), g.tan)) < 0 ? i + 1 : i];
        const { p, u, a } = P.portal;
        gl.useProgram(p); common(u);
        gl.uniform3fv(u.uP, g.p); gl.uniform3fv(u.uS, g.side); gl.uniform3fv(u.uU, g.up); gl.uniform1f(u.uRad, 0.9); gl.uniform3fv(u.uCam, eye);
        gl.uniform3fv(u.uNebA, dest.a); gl.uniform3fv(u.uNebB, dest.b); gl.uniform3fv(u.uNebC, dest.c); gl.uniform3fv(u.uDeep, dest.deep);
        gl.uniform3fv(u.uSun, dest.sun); gl.uniform3fv(u.uSunCol, dest.sunCol); gl.uniform1f(u.uGlow, dest.glow); gl.uniform3fv(u.uBand, BAND);
        gl.uniform1f(u.uTime, t()); gl.uniform1f(u.uAlpha, 0.7 * Math.min(1, prox * 1.6) * passing(g.p));
        attribs(gl, quad, [[a.aCorner, 2]]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      for (let k = 0; k < 3; k++) {
        const col = g.cols[k % g.cols.length];
        drawTorus(mat4.basis(gateM, g.p, g.side, g.tan, g.up, 0.95 + k * 0.32), { base: [0.07, 0.06, 0.09], emit: col, env: mul(col, 0.7), dash: 20 + k * 8, speed: 0.12 * (k % 2 ? -1 : 1), spin: k * 0.31 }, Math.min(1, prox * 1.6) * passing(g.p));
      }
      // The tunnel: rings of light the camera rushes through, before and after the gate.
      tunnels[i].forEach((r, k) => drawTorus(mat4.basis(gateM, r.p, r.side, r.tan, r.up, r.size), { base: [0.03, 0.03, 0.05], emit: g.cols[(k + 1) % g.cols.length], env: mul(g.cols[0], 0.4), dash: 36, speed: 0.5 * (k % 2 ? -1 : 1), spin: k * 0.17 }, Math.min(1, prox * 1.4) * 0.8 * passing(r.p)));
      blendAdd();
      drawSprite(g.p, 1.7, g.cols[0], 0.25 * prox, 0, 8, 0.6);
    });
  }

  function drawStars(o) {
    const { p, u, a } = P.star;
    gl.useProgram(p); common(u);
    gl.uniform1f(u.uPx, q.ratio); gl.uniform1f(u.uAlpha, o); gl.uniform1f(u.uTime, t());
    attribs(gl, stars, [[a.aPos, 3], [a.aInfo, 3]]);
    gl.uniform3f(u.uStreak, 0, 0, 0); gl.uniform1f(u.uPoint, 1);
    gl.drawArrays(gl.POINTS, 0, STARS * 2);
    if (vec3.len(streak) > 0.01) { gl.uniform3fv(u.uStreak, streak); gl.uniform1f(u.uPoint, 0); gl.drawArrays(gl.LINES, 0, STARS * 2); }
  }
  function drawStream() {
    if (!stream) return;
    drawDust(stream, MI, 1, [C.accent, C.dev, C.aether], 0.9, 0.9, 0.5);
  }

  // ---------- Identity layer: sakura petals, butterflies, mist ----------
  function drawPetals() {
    if (mood.petals <= 0.01 || !petalTex || QA.off("petals")) return;
    const { p, u, a } = P.petal;
    gl.useProgram(p); common(u);
    bind(1, petalTex);
    // The scene's key light (Tyndall): a diagonal from the top left through the world's centre, which the
    // pointer pulls a little; petals light up only where it crosses them. Focus on the world's centre: a petal
    // far from it is out of focus (a coarser mip, a little larger, less energy).
    const centre = kind === "index" ? curve(CENTERS, routeU(routeNow())) : [0, 0, 0];
    let focusAt = centre;
    if (kind === "index") for (let i = 0; i < 4; i++) if (state.focusAmt[i] > 0.01) focusAt = vec3.lerp(focusAt, tipPos[i], state.focusAmt[i] * (1 - Math.min(1, Math.abs(routeNow() - 2) / 0.4)));
    gl.uniform3fv(u.uBeamO, centre);
    gl.uniform3fv(u.uBeamD, vec3.norm(vec3.add(vec3.add(vec3.scale(camU, 0.6 - state.spy * 0.1), vec3.scale(camR, -0.8 + state.spx * 0.15)), vec3.scale(camF, 0.3))));
    // The lit title is a light source: petals within a title's height and a half of it glow in its rose.
    const T = state.title;
    gl.uniform4f(u.uTitle, T ? (T[0] + T[2]) / cssW - 1 : 0, T ? 1 - (T[1] + T[3]) / cssH : 0, T ? (T[2] - T[0]) / cssW : 0, T ? (T[3] - T[1]) / cssH : 0);
    gl.uniform1f(u.uTitleK, T && kind === "index" ? sceneAlpha(0) : 0); gl.uniform1f(u.uAspect, cssW / cssH);
    gl.uniform3fv(u.uTitleTint, mix(C.accent, WHITE, 0.55));
    gl.uniform1f(u.uBeamR, 1.6); gl.uniform1f(u.uFocus, vec3.len(vec3.sub(focusAt, eye))); gl.uniform1f(u.uAperture, 0.16);
    const tt = t(), gust = 0.5 + 0.5 * Math.sin(tt * 0.37) * Math.sin(tt * 0.23 + 1);
    gl.uniform3fv(u.uCam, eye); gl.uniform3f(u.uBox, 9, 6, 11); gl.uniform3f(u.uWind, -0.3 - gust * 0.25, -0.2, 0.12); gl.uniform3fv(u.uLight, sky.sun);
    gl.uniform1f(u.uTime, tt); gl.uniform1f(u.uSize, 0.046); gl.uniform1f(u.uGust, gust + Math.min(1, state.vel * 0.5));
    gl.uniform1f(u.uCalm, 1 - clamp01(state.vel * 1.5));
    gl.uniform3fv(u.uPtrDir, ptrDir); gl.uniform1f(u.uPtrK, state.ptrK * 0.9);
    // Pale sakura (#ffe1ec), a deeper base; one colour (no cyan petals).
    const pale = [1, 225 / 255, 236 / 255];
    gl.uniform3fv(u.uColA, mix(C.accent, WHITE, 0.55)); gl.uniform3fv(u.uColB, pale); gl.uniform3fv(u.uColC, pale); gl.uniform1f(u.uAlpha, mood.petals);
    attribs(gl, petals.buf, [[a.aSeed, 4], [a.aRot, 4], [a.aCorner, 4]]);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, petals.idx);
    // At rest only a few petals drift by (a fifth of them, scattered through the buffer); the whole flight
    // rushes past only while the camera travels.
    const share = 0.2 + 0.8 * clamp01(state.vel * 1.5);
    gl.drawElements(gl.TRIANGLES, Math.round(petals.count / 6 * share) * 6, gl.UNSIGNED_SHORT, 0);
  }
  /** Mist into the quarter-resolution fx target (after the shafts, or on a cleared target). */
  function drawMistLayer(hasShafts) {
    if (q.tier === 0 || QA.off("mist") || !raysRT) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, raysRT.fb);
    gl.viewport(0, 0, raysRT.w, raysRT.h);
    if (!hasShafts) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); blendAdd();
    drawMist();
    gl.disable(gl.BLEND);
    return true;
  }
  function drawMist() {
    const { p, u, a } = P.mist;
    gl.useProgram(p); common(u);
    gl.uniform1f(u.uTime, t());
    attribs(gl, quad, [[a.aCorner, 2]]);
    const spots = kind === "index" ? WORLDS.map((w, i) => [w.c, near(i), MOOD[i]]) : [[[0, 0, 0], 1, MOOD[0]]];
    for (const [c, o, m] of spots) {
      if (o <= 0.05) continue;
      for (const [off, size, seed] of MIST) {
        gl.uniform3fv(u.uCenter, vec3.add(c, off)); gl.uniform1f(u.uSize, size); gl.uniform1f(u.uSeed, seed);
        gl.uniform3fv(u.uColA, mul(m.mist[0], 0.5)); gl.uniform3fv(u.uColB, mul(m.mist[1], 0.5)); gl.uniform1f(u.uAlpha, 0.22 * o);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
  }
  const transitOf = () => kind === "index" ? Math.sin(Math.PI * (routeNow() - Math.floor(routeNow()))) : 0;
  /** The flock: at rest a loose swarm in a free corner of the world; in transit they fly ahead of the camera. */
  function updateFlock(dt) {
    const r = routeNow(), tt = t();
    const transit = kind === "index" ? Math.sin(Math.PI * (r - Math.floor(r))) : 0;
    const wi = kind === "index" ? Math.min(3, Math.round(r)) : 0;
    let home = vec3.add(kind === "index" ? WORLDS[wi].c : [0, 0, 0], MOOD[wi].swarm);
    // At the Entrée they keep to the top right of the picture, never over the title (a point of the screen,
    // 2.4 units away); they never follow the pointer.
    const atEntree = kind === "index" && wi === 0, portrait = portraitAmount();
    if (atEntree) home = vec3.add(eye, vec3.scale(vec3.norm(vec3.add(camF, vec3.add(vec3.scale(camR, (0.62 - 0.12 * portrait) * tanXY[0]), vec3.scale(camU, (0.55 + 0.17 * portrait) * tanXY[1])))), 2.4));
    flock.forEach((b, i) => {
      const a = tt * (0.35 + b.r * 0.5) + b.a0;
      const wr = atEntree ? b.r * 0.35 : b.r;
      const wander = [Math.cos(a) * wr, Math.sin(a * 1.3 + b.a1) * wr * 0.5, Math.sin(a * 0.8) * wr * 0.7];
      let target = vec3.add(home, wander);
      if (transit > 0.01) target = vec3.lerp(target, vec3.add(curve(PATH, Math.min(6, routeU(r) + b.lead)), vec3.scale(wander, 0.7)), Math.min(1, transit * 1.4));
      if (!b.pos || reduced.matches) b.pos = target;
      const np = vec3.lerp(b.pos, target, 1 - Math.exp(-dt * (2.2 + transit * 7)));
      const v = vec3.scale(vec3.sub(np, b.pos), 1 / Math.max(dt, 1 / 240));
      b.vel = vec3.lerp(b.vel, v, 1 - Math.exp(-dt * 5));
      b.pos = np;
      if (vec3.len(b.vel) > 0.02) b.head = vec3.norm(vec3.lerp(b.head, vec3.norm(b.vel), 1 - Math.exp(-dt * 6)));
      BF0.set([...b.pos, b.size], i * 4); BF1.set([...b.head, b.phase], i * 4);
    });
  }
  function drawFlock() {
    if (!BFLY || !wingTex || QA.off("bfly")) return;
    const { p, u, a } = P.bfly;
    gl.useProgram(p); common(u);
    bind(1, wingTex);
    gl.uniform4fv(u.uB0, BF0); gl.uniform4fv(u.uB1, BF1); gl.uniform1f(u.uTime, t());
    // Sakura, drawn over (not added): a fine line that the bloom never burns (the persistence draws its wake).
    gl.uniform3fv(u.uColA, mix(C.accent, WHITE, 0.62)); gl.uniform1f(u.uAlpha, 0.85);
    blendOver();
    attribs(gl, bfly.buf, [[a.aWing, 4]]);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bfly.idx);
    gl.drawElements(gl.TRIANGLES, bfly.count, gl.UNSIGNED_SHORT, 0);
    blendAdd();
  }
  /** The light of the current world on screen (sun, central star, Lumina), for the light shafts. */
  function shaftSource() {
    if (kind !== "index" || q.tier === 0 || !raysRT || QA.off("rays")) return null;
    const r = routeNow(), i = Math.round(r), w = 1 - Math.min(1, Math.abs(r - i) * 2.5);
    const src = [[vec3.add(WORLDS[0].c, vec3.scale(SUN0, 40)), 0.32], null, [heartNow, 0.3], [WORLDS[3].c, 0.4]][i];
    if (!src || w <= 0) return null;
    const pr = project(src[0]);
    if (!pr) return null;
    const uv = [pr.x / cssW, 1 - pr.y / cssH];
    const out = Math.max(Math.abs(uv[0] - 0.5), Math.abs(uv[1] - 0.5)) - 0.5;
    const k = src[1] * w * (1 - clamp01(out / 0.35));
    return k > 0.01 ? { uv, k } : null;
  }

  // ---------- Detail pages: the domain's own world, slowly orbited and scrolled ----------
  const detailRingM = mat4.create();
  function detailWorld(pass) {
    const d = state.detail, col = DOM[d] || C.accent, mat = MAT.domains[d] || MAT.hero, c = [0, 0, 0];
    const L = lightOf(SKY[0].sun, mix(col, WHITE, 0.75), [0.03, 0.025, 0.05], mul(col, 0.35));
    mat4.model(detailRingM, c, 0.42, t() * 0.02, 0.12, 1);
    const n = ringNormal(detailRingM);
    const am = t() * 0.13 + 1, moon = vec3.add(c, [Math.cos(am) * 1.85, 0.55 + Math.sin(am) * 0.85, Math.sin(am) * 1.85 - 0.5]);
    // On a portrait screen the moon would cross the text: it leaves with the low horizon (camera()).
    const moonA = 1 - detailPortrait();
    if (pass === 0) {
      drawPlanet(mat4.model(M, c, 0.25, t() * 0.04, 0.1, 1), mat, L, { ring: { c, n, r: [1.35, 2.1], k: 0.7, seed: 0.3 + d * 0.17 } });
      if (moonA >= 1) drawPlanet(mat4.model(M, moon, 0, t() * 0.2, 0, 0.11), MAT.moon, L);
      return;
    }
    blendOver();
    if (moonA > 0 && moonA < 1) drawPlanet(mat4.model(M, moon, 0, t() * 0.2, 0, 0.11), MAT.moon, L, { opacity: moonA });
    // The page's one tint (and the accent): no second channel's colour on a domain's world.
    drawRing(detailRingM, 1.35, 2.1, n, c, 1, [mix(col, WHITE, 0.3), col, mix(col, WHITE, 0.6)], 0.5, 0.3 + d * 0.17, L);
    blendAdd();
    drawDust(belt0, detailRingM, 0, [mix(col, WHITE, 0.4), col, C.accent], 0.4);
    drawHalo(c, 1, mul(col, 0.6), mix(col, WHITE, 0.35), SKY[0].sun, 0.2, 1.9, 4.6);
    drawHalo(moon, 0.11, mix(col, WHITE, 0.6), WHITE, SKY[0].sun, 0.35 * moonA, 2.2, 5);
  }

  // ---------- Camera ----------
  const portraitAmount = () => clamp01((1.05 - cssW / cssH) / 0.55);
  // Domain pages: from 3:4 down (one reading column), the whole low-horizon framing.
  const detailPortrait = () => clamp01((1.05 - cssW / cssH) / 0.3);
  /** Slope (tangent of the angle above the axis) of the top of a sphere's outline, seen from e looking at l;
   *  -Infinity unless the sphere is wholly in front of the eye (passing beside or behind it, nothing to keep down). */
  function limbSlope(e, l, c, rad) {
    const f = vec3.norm(vec3.sub(l, e)), side = vec3.norm(vec3.cross(f, [0, 1, 0])), u = vec3.cross(side, f), v = vec3.sub(c, e);
    const cy = vec3.dot(v, u), cz = vec3.dot(v, f);
    if (cz <= rad) return -Infinity;
    const k = cz * cz - rad * rad;
    return (cy * cz + rad * Math.sqrt(cy * cy + k)) / k;
  }
  /** NDC height of a world's centre (unit radius, `d` away) that puts the top of its limb at CSS y `top`. */
  function horizonNy(d, top) {
    const ty = Math.tan(0.39), limb = Math.atan((2 * Math.min(top, cssH * 1.5) / cssH - 1) * ty);
    return -Math.tan(limb + Math.asin(1 / Math.max(1.05, d))) / ty;
  }
  /** Eye stepped back from cc by `back` (×) and the point to look at so cc shows at (nx, ny) in NDC. */
  function aim(cc, e, back, nx, ny) {
    const ep = vec3.add(cc, vec3.scale(vec3.sub(e, cc), back));
    const dir = vec3.sub(cc, ep), dist = vec3.len(dir);
    const f = vec3.scale(dir, 1 / dist), side = vec3.norm(vec3.cross(f, [0, 1, 0])), up = vec3.cross(side, f);
    const ty = Math.tan(0.39), tx = ty * cssW / cssH;
    return [ep, vec3.sub(cc, vec3.add(vec3.scale(side, nx * tx * dist), vec3.scale(up, ny * ty * dist)))];
  }
  function camera(dt) {
    let e, l, lift = 0;
    const r = routeNow();
    if (kind === "index") {
      const u = routeU(r);
      e = curve(PATH, u); l = curve(LOOKS, u);
      // Portrait screens: step back and aim so each world sits where the copy leaves room: centred behind
      // the title at the Entrée; for the others, up in the right corner above the title (body text lives below).
      // The Domaines' tree is the exception: nearer and centred, it stands behind the title and the lead
      // (y ≈ 90 to 390 on a phone), the reading zones dimming it under the text; tablets get that framing too.
      const portrait = portraitAmount(), d2 = Math.max(0, 1 - Math.abs(r - 2)), pz = Math.min(1, portrait * (1 + d2));
      const cc = curve(CENTERS, u);
      if (pz > 0) {
        const k = clamp01(r);
        const [ep, lp] = aim(cc, e, 1 + pz * (0.5 + 0.6 * k - 1.3 * d2), 0.62 * k - 0.5 * d2, 0.06 + 0.66 * k - 0.32 * d2);
        e = vec3.lerp(e, ep, pz); l = vec3.lerp(l, lp, pz);
      }
      // A landscape window narrower than 16:10 would push the tree off the right edge: the gaze turns to it.
      const narrow = d2 * clamp01((1.6 - cssW / cssH) / 0.6);
      if (narrow > 0) l = vec3.lerp(l, aim(cc, e, 1, 0.12, 0.4)[1], narrow);
      // The Entrée: the gaze lifts so the planet's centre leaves the frame at the bottom right (its crescent,
      // at most a fifth of the frame, far from the title); on a tall screen it is a low horizon (and see `lift`).
      const d0 = Math.max(0, 1 - r * 1.25);
      if (d0 > 0) l = vec3.lerp(l, aim(WORLDS[0].c, e, 1, 1.08 - 0.58 * portrait, -1.12 - 0.39 * portrait)[1], d0);
      // All of it at phone widths, where the row's link shares the planet's corner; a ramp on wider portrait screens.
      if (state.floor > 0 && portrait > 0) lift = d0 * (cssW <= 700 ? 1 : Math.min(1, portrait * 2));
    } else {
      // Detail pages: a slow orbit around the page's own world, scrolled by the reader.
      const a = state.time * 0.04 + state.scroll * 0.6;
      e = [Math.sin(a) * 0.6 - 0.2, 0.25 - state.scroll * 0.6, 3.9 + Math.cos(a) * 0.3];
      l = [-1.55 + state.scroll * 0.2, 0.05 - state.scroll * 0.5, 0];
      // Portrait: the world becomes a low horizon (RÉMANENCE §12.7), nearer so its limb is a wide arc, never above
      // the end of the hero (setFloor) nor a sixth of the screen high; it sets by a third of the screen over the page.
      const pz = detailPortrait();
      if (pz > 0) {
        const top = Math.max(state.floor, cssH * 0.84) + cssH * 0.35 * state.scroll;
        const [ep, lp] = aim([0, 0, 0], e, 0.6, 0.2, horizonNy(0.6 * vec3.len(e), top));
        e = vec3.lerp(e, ep, pz); l = vec3.lerp(l, lp, pz);
      }
    }
    const side = vec3.norm(vec3.cross(vec3.sub(l, e), [0, 1, 0]));
    e = vec3.add(e, vec3.add(vec3.scale(side, state.spx * 0.22), [0, -state.spy * 0.14, 0]));
    if (!reduced.matches) {
      const calm = 1 - Math.min(1, state.vel * 2), tt = state.time;
      e = vec3.add(e, vec3.scale([Math.sin(tt * 0.13) * 0.07, Math.sin(tt * 0.091 + 1) * 0.045, Math.cos(tt * 0.11) * 0.06], calm));
    }
    // The Entrée on a portrait screen: the gaze lifts just enough that the planet's limb (its exact outline, sway
    // included) stays under the bottom row (setFloor, RÉMANENCE §12.7), even when the browser's bars shorten the screen.
    if (lift > 0) {
      const want = (1 - 2 * (state.floor + 4) / cssH) * Math.tan((0.78 + Math.min(0.24, state.vel * 0.13)) / 2);
      const s = limbSlope(e, l, WORLDS[0].c, 1);
      // A tilt about the camera's side axis lowers the limb's angle by exactly the tilt: one step.
      if (s > want) {
        const f = vec3.norm(vec3.sub(l, e)), up = vec3.cross(vec3.norm(vec3.cross(f, [0, 1, 0])), f);
        l = vec3.add(l, vec3.scale(up, lift * vec3.len(vec3.sub(l, e)) * Math.tan(Math.atan(s) - Math.atan(want))));
      }
    }
    // Bank into the turns, like a craft: the roll follows how fast the heading swings.
    const fwd = vec3.norm(vec3.sub(l, e));
    if (lastFwd && !reduced.matches) {
      const yaw = (lastFwd[2] * fwd[0] - lastFwd[0] * fwd[2]) / Math.max(dt, 1 / 240);
      const want = Math.max(-0.3, Math.min(0.3, yaw * 0.35));
      state.bank += (want - state.bank) * (1 - Math.exp(-dt * 3.5));
    } else state.bank = 0;
    if (!Number.isFinite(state.bank)) state.bank = 0; // one bad frame must not take the roll away for the visit
    lastFwd = fwd;
    let roll = state.bank;
    if (kind === "index" && !reduced.matches) {
      const i = Math.min(2, Math.floor(r)), f = r - i;
      roll += [0.16, -0.28, 0.2][i] * Math.sin(Math.PI * f) * Math.sin(Math.PI * f);
    }
    mat4.lookAt(view, e, l, [0, 1, 0], roll);
    const fov = 0.78 + Math.min(0.24, state.vel * 0.13);
    const aspect = sceneRT.w / Math.max(1, sceneRT.h);
    mat4.perspective(proj, fov, aspect, 0.05, 140);
    camR = [view[0], view[4], view[8]]; camU = [view[1], view[5], view[9]]; camF = [-view[2], -view[6], -view[10]];
    tanXY = [Math.tan(fov / 2) * aspect, Math.tan(fov / 2)];
    // Camera velocity in view space drives the star streaks.
    const motion = lastEye ? vec3.scale(vec3.sub(e, lastEye), 1 / Math.max(dt, 1 / 240)) : [0, 0, 0];
    lastEye = e; eye = e;
    const vm = [view[0] * motion[0] + view[4] * motion[1] + view[8] * motion[2], view[1] * motion[0] + view[5] * motion[1] + view[9] * motion[2], view[2] * motion[0] + view[6] * motion[1] + view[10] * motion[2]];
    streak = reduced.matches ? [0, 0, 0] : vec3.scale(vm, -0.045);
  }

  // Sky colours and sun follow the route, so each world has its own light.
  function blendSky() {
    const r = kind === "index" ? routeNow() : 0;
    for (const k of ["a", "b", "c", "deep", "sunCol"]) sky[k] = [0, 0, 0];
    let sun = [0, 0, 0], glow = 0;
    SKY.forEach((s, i) => {
      const w = SKY.length === 1 ? 1 : Math.max(0, 1 - Math.abs(r - i));
      if (w <= 0) return;
      for (const k of ["a", "b", "c", "deep", "sunCol"]) sky[k] = vec3.add(sky[k], vec3.scale(s[k], w));
      sun = vec3.add(sun, vec3.scale(s.sun, w)); glow += s.glow * w;
    });
    sky.sun = vec3.norm(sun); sky.glow = glow;
    mood.petals = 0;
    MOOD.forEach((m, i) => { const w = MOOD.length === 1 ? 1 : Math.max(0, 1 - Math.abs(r - i)); mood.petals += m.petals * w; });
  }

  // ---------- Adaptive quality ----------
  // Frame time is compared with the display's own interval; a sustained shortfall lowers the resolution,
  // then the tier (multisampling, bloom depth, sky resolution). A step down that does not buy frame time
  // means the limit is elsewhere (CPU, compositor): it is undone and the loop holds off, longer each time.
  // After a calm spell one step up is tried; if frames drop again it is undone and the next try waits longer.
  const ad = { ema: 16.7, refresh: 16.7, slow: 0, good: 0, probeAfter: 5, lastChange: 0, trial: null, check: null, holdUntil: 0, hold: 15 };
  function setQuality(tier, scale) { q.tier = tier; q.scale = scale; resize(true); }
  function adapt(dt) {
    if (dt <= 0 || dt > 0.25) return;
    // Only the camera at rest is measured: in transit the main thread also lays out the page's text, and a
    // resolution change there would reallocate targets mid-flight (a visible hitch). Changes happen at rest.
    if (state.vel > 0.05) { ad.slow = 0; ad.good = 0; return; }
    const ms = dt * 1000, nowS = state.clock;
    ad.ema += (ms - ad.ema) * 0.1;
    ad.refresh = ms < ad.refresh ? ms : ad.refresh + dt * 0.3;
    const target = Math.min(16.9, Math.max(coarse ? 16 : 8, ad.refresh));
    const slow = ad.ema > target * 1.3 + 0.6;
    if (slow) { ad.slow += dt; ad.good = 0; } else { ad.good += dt; ad.slow = 0; }
    if (nowS < 3) return;
    if (ad.check && nowS - ad.check.at > 1.6) {
      if (ad.ema > ad.check.ema * 0.93) { setQuality(ad.check.tier, ad.check.scale); ad.holdUntil = nowS + ad.hold; ad.hold = Math.min(120, ad.hold * 2); }
      ad.check = null; ad.lastChange = nowS;
    }
    if (ad.trial && nowS - ad.trial.at > 3) ad.trial = null;
    if (!ad.check && ad.slow > 0.7 && nowS - ad.lastChange > 1.2 && nowS > ad.holdUntil) {
      if (ad.trial) { setQuality(ad.trial.tier, ad.trial.scale); ad.probeAfter = Math.min(80, ad.probeAfter * 2); ad.trial = null; }
      else {
        const before = { tier: q.tier, scale: q.scale, ema: ad.ema, at: nowS };
        if (q.scale > 0.76) setQuality(q.tier, Math.max(0.75, q.scale * 0.86));
        else if (q.tier > 0) setQuality(q.tier - 1, 1);
        else if (q.scale > 0.5) setQuality(0, Math.max(0.5, q.scale * 0.86));
        if (q.tier !== before.tier || q.scale !== before.scale) ad.check = before;
      }
      ad.lastChange = nowS; ad.slow = 0;
    } else if (!ad.trial && !ad.check && ad.good > ad.probeAfter && (q.scale < 1 || q.tier < startTier)) {
      ad.trial = { tier: q.tier, scale: q.scale, at: nowS };
      if (q.scale < 1) setQuality(q.tier, Math.min(1, q.scale / 0.86)); else setQuality(q.tier + 1, 0.75);
      ad.lastChange = nowS; ad.good = 0;
    }
  }

  // ---------- Frame ----------
  let live = false;
  function pass(target, prog, setup) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : canvas.width, target ? target.h : canvas.height);
    gl.useProgram(prog.p);
    setup(prog.u);
    attribs(gl, quad, [[prog.a.aCorner, 2]]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function bind(unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }

  /** dt: time since the last rendered frame; rafDt: the display's last frame interval (for the quality loop). */
  function render(now, dt, rafDt = dt) {
    if (!checkReady()) return !failed;
    if (gl.isContextLost()) return false;
    state.clock = now / 1000;
    // The world's own clock runs at a pace (1 normal, 0 asleep), eased so it slows down and wakes up smoothly.
    state.pace += (state.paceTarget - state.pace) * (1 - Math.exp(-dt * 2.2));
    if (Math.abs(state.pace - state.paceTarget) < 0.002) state.pace = state.paceTarget;
    state.worldTime += dt * state.pace;
    state.time = reduced.matches ? 21 : state.worldTime % 3600;
    if (!reduced.matches) adapt(rafDt);
    if (!sceneRT || canvas.width !== Math.max(1, Math.round(cssW * q.ratio)) || canvas.height !== Math.max(1, Math.round(cssH * q.ratio))) resize(false);
    const k = 1 - Math.exp(-dt * 6);
    state.spx += (state.px - state.spx) * k; state.spy += (state.py - state.spy) * k;
    const focusK = 1 - Math.exp(-dt * 7);
    for (let i = 0; i < 4; i++) state.focusAmt[i] += ((state.focus === i ? 1 : 0) - state.focusAmt[i]) * focusK;
    state.fade = reduced.matches ? 1 : state.fade + (1 - state.fade) * (1 - Math.exp(-dt * 2.2));
    // Fast flight (several worlds in a row: more than a world still to go, or faster than a single step ever
    // goes): the picture dims, like a motion blur, from the very start of the flight, and comes back on arrival,
    // so the worlds' very different lights never alternate strongly in a second (WCAG 2.3.1). It dims quickly
    // and recovers gently.
    const fast = kind === "index" && !reduced.matches ? Math.max(smoothstep(2.2, 4.5, state.vel), smoothstep(1.2, 1.8, state.span)) : 0;
    state.flight += (fast - state.flight) * (1 - Math.exp(-dt * (fast > state.flight ? 16 : 2.6)));
    const remaining = Math.max(0, state.glitchUntil - now);
    state.glitch = remaining > 0 && !reduced.matches ? state.glitchPeak * (0.45 + 0.55 * Math.random()) : 0;

    camera(dt);
    // The pointer's presence: eases in when it moves, out a few seconds after it stops.
    const ptrWant = !reduced.matches && state.clock - state.ptrAt < 2.5 ? 1 : 0;
    state.ptrK += (ptrWant - state.ptrK) * (1 - Math.exp(-dt * (ptrWant ? 3 : 0.8)));
    ptrDir = vec3.norm(vec3.add(camF, vec3.add(vec3.scale(camR, state.px * tanXY[0]), vec3.scale(camU, -state.py * tanXY[1]))));
    crossGates(dt);
    arrival(dt);
    blendSky();
    updateFlock(dt);
    marks = [];
    bind(0, noise);

    // Sky, at low resolution.
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    pass(skyRT, P.sky, u => {
      gl.uniform3fv(u.uRight, camR); gl.uniform3fv(u.uUp, camU); gl.uniform3fv(u.uFwd, camF); gl.uniform2f(u.uTan, tanXY[0], tanXY[1]);
      gl.uniform3fv(u.uSun, sky.sun); gl.uniform3fv(u.uSunCol, sky.sunCol); gl.uniform1f(u.uGlow, sky.glow);
      gl.uniform3fv(u.uNebA, sky.a); gl.uniform3fv(u.uNebB, sky.b); gl.uniform3fv(u.uNebC, sky.c); gl.uniform3fv(u.uDeep, sky.deep); gl.uniform3fv(u.uBand, BAND);
      gl.uniform1f(u.uTime, t());
    });

    renderMirror();

    // Scene.
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneRT.draw);
    gl.viewport(0, 0, sceneRT.w, sceneRT.h);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    bind(1, skyRT.tex);
    gl.useProgram(P.blit.p);
    attribs(gl, quad, [[P.blit.a.aCorner, 2]]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false); blendAdd();
    drawStars(0.95);
    gl.depthMask(true); gl.disable(gl.BLEND);
    if (kind === "index") { for (let i = 0; i < 4; i++) if (near(i) > 0) worldFns[i](near(i), 0); }
    else detailWorld(0);
    gl.enable(gl.BLEND); gl.depthMask(false);
    if (kind === "index") { for (let i = 0; i < 4; i++) if (near(i) > 0) worldFns[i](near(i), 1); gates(1); }
    else detailWorld(1);
    blendAdd();
    drawStream();
    blendOver();
    drawPetals();
    blendAdd();
    drawFlock();
    gl.depthMask(true);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    sceneRT.resolve();

    // Bloom: bright pass at half resolution, blurred down a pyramid and added back up.
    const levels = TIERS[q.tier].bloom;
    const hasBloom = !!(down[0] && levels > 1);
    const shafts = hasBloom ? shaftSource() : null;
    if (hasBloom) {
      bind(1, sceneRT.tex);
      pass(down[0], P.prefilter, u => { gl.uniform2f(u.uTexel, 1 / sceneRT.w, 1 / sceneRT.h); gl.uniform1f(u.uTh, 0.74); gl.uniform1f(u.uKnee, 0.22); });
      if (shafts) {
        bind(1, down[0].tex);
        pass(raysRT, P.rays, u => { gl.uniform2f(u.uSun, shafts.uv[0], shafts.uv[1]); gl.uniform1f(u.uDensity, 0.92); gl.uniform1f(u.uDecay, 0.955); gl.uniform1f(u.uExposure, 1.4 * shafts.k); });
      }
      for (let i = 1; i < levels; i++) {
        bind(1, down[i - 1].tex);
        pass(down[i], P.down, u => gl.uniform2f(u.uTexel, 1 / down[i - 1].w, 1 / down[i - 1].h));
      }
      for (let i = levels - 2; i >= 0; i--) {
        const src = i === levels - 2 ? down[levels - 1] : up[i + 1];
        bind(1, src.tex); bind(2, down[i].tex);
        pass(up[i], P.up, u => { gl.uniform2f(u.uTexel, 0.5 / src.w, 0.5 / src.h); gl.uniform1f(u.uMix, 1); });
      }
    }

    // Mist, at quarter resolution, added over the shafts in the same layer (it is haze: no depth needed).
    const misty = drawMistLayer(!!shafts);
    const fx = !!shafts || misty;

    // Post: compose with the bloom and apply the signal layer.
    bind(1, sceneRT.tex); bind(2, hasBloom ? up[0].tex : sceneRT.tex); bind(3, fx ? raysRT.tex : sceneRT.tex);
    const speed = reduced.matches ? 0 : Math.min(1.4, state.vel);
    const persist = q.tier > 0 && hist[0] && hist[1] && !reduced.matches, half = q.tier === 1;
    const out = persist && !half ? hist[histCur] : null;
    bind(4, persist && histLive ? hist[1 - histCur].tex : sceneRT.tex);
    pass(out, P.post, u => {
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform1f(u.uTime, state.clock % 3600); gl.uniform1f(u.uVel, speed);
      // Deep rest: as the world's clock winds down, its picture dims like a tube on standby (and back on waking).
      gl.uniform1f(u.uGlitch, state.glitch); gl.uniform1f(u.uFade, state.fade * (0.5 + 0.5 * state.pace) * (1 - 0.55 * state.flight));
      gl.uniform1f(u.uBloomK, kind === "index" ? 0.7 : 0.5); gl.uniform1f(u.uHasBloom, hasBloom ? 1 : 0);
      gl.uniform1f(u.uWarp, kind === "index" ? Math.min(0.07, speed * 0.028) : 0); gl.uniform1f(u.uSat, 1.12);
      gl.uniform3fv(u.uTint, sky.c);
      gl.uniform1f(u.uScrim, kind === "index" ? portraitAmount() * 0.5 * clamp01(routeNow()) : 0);
      gl.uniform1f(u.uRaysK, fx ? 1 : 0);
      // Phosphor persistence, per channel: red fades last, so whatever fades turns pink (direction §6.1, §8.1).
      // (At tier 1 the history has already decayed.)
      const pk = persist && histLive ? Math.min(4, dt * 60) : 0;
      if (half) gl.uniform3f(u.uPersist, pk ? 1 : 0, pk ? 1 : 0, pk ? 1 : 0);
      else gl.uniform3f(u.uPersist, pk && Math.pow(0.9, pk), pk && Math.pow(0.83, pk), pk && Math.pow(0.78, pk));
      // The tube, a quiet object: a gentle curvature, a faint phosphor mask and beam lines (integer periods in
      // canvas pixels, about 1 and 3 CSS px). Phones and small tiers get a lighter tube; reading pages too.
      const small = cssW < 700, tube = QA.off("tube") ? 0 : kind === "index" ? 1 : 0.6;
      // A 1.5 % curvature; the aperture mask only on dense screens (at 1:1 it would read as stripes).
      gl.uniform1f(u.uCurve, (small ? 0.012 : 0.015) * tube); gl.uniform1f(u.uPx, Math.max(1, Math.round(q.ratio)));
      gl.uniform1f(u.uLine, Math.max(2, Math.round(3 * q.ratio)));
      gl.uniform1f(u.uMask, (small || q.ratio < 2 ? 0 : [0.03, 0.05, 0.07][q.tier]) * tube);
      gl.uniform1f(u.uScan, (small ? 0.1 : [0.12, 0.17, 0.22][q.tier]) * tube);
      packZones();
      gl.uniform4fv(u.uZone, ZONE); gl.uniform1fv(u.uZoneK, ZONEK); gl.uniform1f(u.uFeather, 150 * q.ratio);
      gl.uniform1f(u.uPool, kind === "index" ? sceneAlpha(0) : 0);
      gl.uniform1f(u.uShowZones, QA.on("zones") ? 1 : 0);
    });
    if (persist && !half) {
      bind(1, hist[histCur].tex);
      pass(null, P.blit, () => {});
      histCur = 1 - histCur; histLive = true;
    } else if (persist) {
      // Tier 1: keep the brighter of this frame's scene and of the decayed history (unit 4 holds the previous).
      bind(1, sceneRT.tex);
      const pk = histLive ? Math.min(4, dt * 60) : 0;
      pass(hist[histCur], P.phos, u => gl.uniform3f(u.uDecay, pk && Math.pow(0.9, pk), pk && Math.pow(0.83, pk), pk && Math.pow(0.78, pk)));
      histCur = 1 - histCur; histLive = true;
    }
    if (!live) {
      live = true;
      document.documentElement.classList.add("world-live");
      canvas.dispatchEvent(new CustomEvent("world-live", { bubbles: true }));
    }
    return true;
  }

  /** The water's reflection: the Domaines world rendered from the mirrored camera, at reduced resolution. */
  let mirrored = false;
  const viewMain = mat4.create();
  function renderMirror() {
    mirrored = false;
    // Only near the Domaines: from the other worlds the water is a few dark pixels, not worth a pass.
    if (kind !== "index" || q.tier === 0 || !reflRT || Math.abs(routeNow() - 2) > 0.8 || QA.off("water")) return;
    viewMain.set(view);
    const eyeMain = eye;
    mat4.multiply(view, viewMain, REFLECT);
    eye = [eye[0], 2 * WATER_Y - eye[1], eye[2]];
    target = reflRT;
    gl.bindFramebuffer(gl.FRAMEBUFFER, reflRT.draw);
    gl.viewport(0, 0, reflRT.w, reflRT.h);
    gl.depthMask(true); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    const flip = v => [v[0], -v[1], v[2]];
    gl.useProgram(P.sky.p);
    const u = P.sky.u;
    gl.uniform3fv(u.uRight, flip(camR)); gl.uniform3fv(u.uUp, flip(camU)); gl.uniform3fv(u.uFwd, flip(camF)); gl.uniform2f(u.uTan, tanXY[0], tanXY[1]);
    gl.uniform3fv(u.uSun, sky.sun); gl.uniform3fv(u.uSunCol, sky.sunCol); gl.uniform1f(u.uGlow, sky.glow);
    gl.uniform3fv(u.uNebA, sky.a); gl.uniform3fv(u.uNebB, sky.b); gl.uniform3fv(u.uNebC, sky.c); gl.uniform3fv(u.uDeep, sky.deep); gl.uniform3fv(u.uBand, BAND);
    gl.uniform1f(u.uTime, t());
    attribs(gl, quad, [[P.sky.a.aCorner, 2]]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    world2(near(2), 0, true);
    gl.enable(gl.BLEND); gl.depthMask(false);
    world2(near(2), 1, true);
    gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    view.set(viewMain); eye = eyeMain; target = null;
    mirrored = true;
  }

  /** Current safe zones as uv boxes: the active scene's and the HUD's, both fading out while the camera travels.
   *  In the flow layout (the page scrolls: state.scrollY) the text stays on the page: every scene's boxes, measured in
   *  page coordinates, follow the scroll and keep their full strength wherever they are on screen. */
  function packZones() {
    ZONE.fill(0); ZONEK.fill(0);
    const j = kind === "index" ? Math.min(3, Math.round(routeNow())) : 0, w = kind === "index" ? sceneAlpha(j) : 0;
    let n = 0;
    const add = (r, k, dy = 0) => {
      if (n >= 12 || k <= 0.01) return;
      ZONE.set([r[0] / cssW, 1 - (r[3] - dy) / cssH, r[2] / cssW, 1 - (r[1] - dy) / cssH], n * 4); ZONEK[n++] = k;
    };
    if (kind === "index" && state.scrollY != null) {
      const y = state.scrollY;
      for (const i of [j, j + 1, j - 1, j + 2, j - 2, j + 3, j - 3]) for (const r of zones[i] || []) if (n < 8 && r[3] > y && r[1] < y + cssH) add(r, 1, y);
      for (const r of hudZones) add(r, 1);
      return;
    }
    for (const r of zones[j] || []) add(r, w);
    for (const r of hudZones) add(r, w);
  }

  // The signal glitches only for a change of page (js/ui/glitch.js), as one soft band: never above 0.25.
  function glitch(amount = 0.25, ms = 300) {
    const now = performance.now();
    state.glitchPeak = Math.min(0.25, Math.max(state.glitch ? state.glitchPeak : 0, amount));
    state.glitchUntil = Math.max(state.glitchUntil, now + ms);
  }

  // Warm-up during a browser idle slot: uploads, first use of every program, so the first gesture stays smooth.
  function warmup() {
    if (!checkReady()) return;
    const saved = { route: state.route, vel: state.vel, fade: state.fade };
    state.route = kind === "index" ? 1.5 : 0;
    state.vel = 0.8;
    render(performance.now(), 1 / 60);
    Object.assign(state, saved);
    lastEye = null; lastFwd = null;
    render(performance.now(), 1 / 60);
  }

  canvas.addEventListener("webglcontextlost", e => {
    e.preventDefault();
    live = false;
    document.documentElement.classList.remove("world-live");
    canvas.dispatchEvent(new CustomEvent("world-lost", { bubbles: true }));
  });
  resize(true);
  // Until the first frame, the canvas shows the page colour rather than black (after resize, which clears it).
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.clearColor(0.027, 0.016, 0.027, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  const idle = window.requestIdleCallback;
  if (idle) idle(() => { if (!document.hidden) warmup(); }, { timeout: 2500 });
  else setTimeout(() => { if (!document.hidden) warmup(); }, 1400);

  return {
    render,
    resize: () => resize(true),
    glitch,
    /** The lit title's box (CSS px), a light for the world (only the Entrée's YOSULJIN is lit). */
    setTitle(box) { state.title = box; },
    /** Route (0..3), its velocity (routes/s) and where the reader is heading (a flight's length so far). */
    setRoute(route, vel = 0, target = route) { state.route = Math.max(0, Math.min(3, route)); state.vel = Math.abs(vel); state.span = Math.abs(target - route); },
    setPointer(x, y) { state.px = x; state.py = y; state.ptrAt = performance.now() / 1000; },
    setFocus(i) { state.focus = i; },
    setScroll(s) { state.scroll = s; },
    /** The index in the flow layout: the page's scroll (CSS px), null in cinema. Scene zones measured in page
     *  coordinates follow it. */
    setScrollY(y) { state.scrollY = y; },
    /** Where the opening text ends (CSS px from the top of the page): the hero on a domain page, the Entrée's bottom
     *  row on the index. A portrait screen keeps the world's horizon under it. */
    setFloor(y) { state.floor = y; },
    /** Pace of the world's clock: 1 normal, 0 asleep (eased). `asleep` is true once it has come to rest. */
    setPace(p) { state.paceTarget = clamp01(p); },
    get asleep() { return state.paceTarget === 0 && state.pace === 0; },
    /** Boxes (CSS px: left, top, right, bottom) of the text of scene i, measured at rest; i = -1 for the fixed HUD. */
    setZones(i, boxes) { if (i < 0) hudZones = boxes.slice(0, 4); else zones[i] = boxes.slice(0, 8); },
    /** Labels for this frame, already projected to CSS pixels. */
    marks() { return marks.map(m => { const p = project(m.pos); return p ? { ...m, x: p.x, y: p.y, depth: p.depth } : null; }).filter(Boolean); },
    get quality() { return (q.tier + q.scale) / 3; }
  };
}
