// The museum's drawing (D168, D169), in WebGL without any dependency: WebGL2 when available, WebGL1 otherwise, every
// shader in GLSL ES 1.00. It draws the building of batiment.js in the site's style: a dark floor with a faint grid and
// pools of light, dark walls with lit edges, doors framed in their room's hue, and each room's things — the map of
// Aether as a table of light, its showcases and panels; the PC of Game Development with Frame on its screen; the model
// of the museum in Mondes; the darkroom of Photographie, its trays, lines and empty frames; the library of Écriture,
// its one book and its lectern — then signs, and AlmaS. The page side (musee.js) drives it: size(), frame(),
// projeter(), destroy().
//
// Extensible without being reopened: the geometry helpers live in geometrie.js; createRendu(canvas, options) takes
// GRAFTS ({ nom, init(gl, api) → instance, avant?, apres?, liberer? }: code that draws, before the floors and after
// everything). They are fetched by musee.js from ajouts.js; one that throws is cut alone and never takes the museum
// down. (Builders that add to the geometry were left out: what they leave behind is not checked, so one badly formed
// entry could take the whole 3D down. Not before a check of what they leave exists.)
import { mat4, program, buffer, attribs, cacheUniforms } from "../world/gl.js?v=20261025-r28";
import { SALLES, MURS, PORTES, OEUVRES, CARTE, MEUBLES, MAQUETTE, enMaquette, MURS_HAUT, EPAISSEUR, PORTE_HAUT } from "./batiment.js?v=20261025-r28";
import { quad, box, boite, wall, cylinder, line, circle, frameLines, rectLines, enDeux } from "./geometrie.js?v=20261025-r28";

const TAU = Math.PI * 2;
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
// Colours are the site's tokens (styles.css 02), read from the body; the hex values are their fallbacks.
const FALLBACK = { "--accent": "#ff5fa2", "--acc-aether": "#ffd25a", "--acc-dev": "#2ee8ff", "--acc-photo": "#ff9d3a", "--acc-writing": "#e86bff",
  "--acc-worlds": "#7a6cff", "--acc-worlds-text": "#a89cff", "--acc-games": "#5cf0bd", "--sakura": "#ffd1e3", "--rose": "#ff8cc0", "--paper": "#f6eef2", "--dim": "#a48d9e" };
const token = name => {
  if (name.startsWith("#")) return hex(name);
  let v = "";
  try { v = getComputedStyle(document.body).getPropertyValue(name).trim(); } catch {}
  return hex(/^#[0-9a-f]{6}$/i.test(v) ? v : FALLBACK[name] || "#ffffff");
};
const font = name => { try { return getComputedStyle(document.body).getPropertyValue(name).trim(); } catch { return ""; } };
const BG = [6 / 255, 4 / 255, 11 / 255];
const MUR = [0.075, 0.05, 0.1], SOCLE = [0.06, 0.045, 0.085], BOIS = [0.085, 0.06, 0.07], NOIR = [0.035, 0.03, 0.045];
const salleDe = (x, z) => SALLES.find(s => x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1);
const lumiere = s => token(s.lumiere || s.teinte);

// ---------- Shaders ----------
const SOLID_VS = `attribute vec3 aPos; attribute vec3 aNorm; attribute vec3 aCol; attribute float aEmit;
uniform mat4 uVP; varying vec3 vW, vN, vC; varying float vE;
void main() { vW = aPos; vN = aNorm; vC = aCol; vE = aEmit; gl_Position = uVP * vec4(aPos, 1.0); }`;
// Walls and furniture: lit from above, brighter near the floor, a little rim, lost in the fog far away.
const POOLS = `uniform vec4 uPool[NPOOL]; uniform vec3 uPoolCol[NPOOL];
vec3 pools(vec3 w, float lift) {
  vec3 c = vec3(0.0);
  for (int i = 0; i < NPOOL; i++) { vec4 p = uPool[i]; vec2 d = w.xz - p.xy; c += uPoolCol[i] * p.w * exp(-dot(d, d) / (p.z * p.z)) * lift; }
  return c;
}`;
const SOLID_FS = `precision mediump float;
varying vec3 vW, vN, vC; varying float vE;
uniform vec3 uEye, uFog; uniform float uDens;
void main() {
  vec3 n = normalize(vN), v = normalize(uEye - vW);
  vec3 c = vC * (0.55 + 0.45 * n.y) * (1.0 + 0.6 * clamp(1.0 - vW.y / 1.2, 0.0, 1.0));
  c += vC * pow(1.0 - abs(dot(n, v)), 3.0) * 0.6;
  c = mix(c, vC, vE);
  float d = length(uEye - vW);
  gl_FragColor = vec4(mix(c, uFog, 1.0 - exp(-uDens * uDens * d * d)), 1.0);
}`;
const FLOOR_VS = `attribute vec3 aPos; uniform mat4 uVP; varying vec3 vW;
void main() { vW = aPos; gl_Position = uVP * vec4(aPos, 1.0); }`;
// The floor: dark, a grid of a metre (brighter every four), the pools of light, a soft sheen toward the eye.
const FLOOR_FS = `precision mediump float;
varying vec3 vW;
uniform vec3 uEye, uFog, uBase, uGrid; uniform float uDens;
${POOLS}
void main() {
  float d = length(uEye - vW), w = 0.012 + 0.0024 * d;
  vec2 l1 = 0.5 - abs(fract(vW.xz) - 0.5), l4 = 2.0 - abs(fract(vW.xz / 4.0) - 0.5) * 4.0;
  float g = (1.0 - smoothstep(w * 0.5, w * 1.6, min(l1.x, l1.y))) * 0.32 + (1.0 - smoothstep(w * 0.7, w * 2.2, min(l4.x, l4.y))) * 0.55;
  vec3 c = uBase + uGrid * g * exp(-d * 0.05) + pools(vW, 1.0) * 0.5;
  c += uGrid * 0.05 * pow(clamp(1.0 - d / 30.0, 0.0, 1.0), 2.0);
  gl_FragColor = vec4(mix(c, uFog, 1.0 - exp(-uDens * uDens * d * d)), 1.0);
}`;
// Additive light: lines and glass carry their colour, faded by the fog.
const LINE_VS = `attribute vec3 aPos; attribute vec4 aCol; uniform mat4 uVP; uniform vec3 uEye; uniform float uDens; varying vec4 vC;
void main() { float d = length(uEye - aPos); vC = vec4(aCol.rgb * aCol.a * exp(-uDens * uDens * d * d), 1.0); gl_Position = uVP * vec4(aPos, 1.0); }`;
const LINE_FS = `precision mediump float; varying vec4 vC; void main() { gl_FragColor = vC; }`;
const GLASS_FS = `precision mediump float;
varying vec3 vW, vN, vC; varying float vE;
uniform vec3 uEye; uniform float uDens;
void main() {
  vec3 n = normalize(vN), v = normalize(uEye - vW);
  float f = 1.0 - abs(dot(n, v)), d = length(uEye - vW);
  gl_FragColor = vec4(vC * (0.04 + pow(f, 2.2) * 0.5) * vE * exp(-uDens * uDens * d * d), 1.0);
}`;
// Points of light (map nodes, the showcases' hearts, AlmaS, the way): a soft dot whose size follows the distance.
const POINT_VS = `attribute vec3 aPos; attribute vec4 aCol; attribute float aSize;
uniform mat4 uVP; uniform float uScale; uniform vec3 uEye; uniform float uDens; varying vec4 vC;
void main() {
  vec4 c = uVP * vec4(aPos, 1.0);
  gl_Position = c;
  gl_PointSize = clamp(aSize * uScale / max(c.w, 0.05), 1.0, 240.0);
  float d = length(uEye - aPos);
  vC = vec4(aCol.rgb * aCol.a * exp(-uDens * uDens * d * d), 1.0);
}`;
const POINT_FS = `precision mediump float; varying vec4 vC;
void main() { vec2 q = gl_PointCoord * 2.0 - 1.0; float r = dot(q, q); if (r > 1.0) discard; gl_FragColor = vec4(vC.rgb * (exp(-r * 5.0) + 0.35 * exp(-r * 40.0)), 1.0); }`;
// Signs: a texture of white text, coloured and faded by the fog (premultiplied alpha). A screen: the same quad, its
// picture in colour, lit by itself.
const TEXT_VS = `attribute vec2 aCorner; uniform mat4 uVP; uniform vec3 uCenter, uRight, uUp; uniform vec2 uSize; varying vec2 vUV;
void main() { vec3 p = uCenter + uRight * aCorner.x * uSize.x + uUp * aCorner.y * uSize.y; vUV = vec2(aCorner.x + 0.5, 0.5 - aCorner.y); gl_Position = uVP * vec4(p, 1.0); }`;
const TEXT_FS = `precision mediump float; varying vec2 vUV; uniform sampler2D uTex; uniform vec3 uCol; uniform float uK;
void main() { float a = texture2D(uTex, vUV).a * uK; gl_FragColor = vec4(uCol * a, a); }`;
const IMAGE_FS = `precision mediump float; varying vec2 vUV; uniform sampler2D uTex; uniform float uK;
void main() { gl_FragColor = vec4(texture2D(uTex, vUV).rgb * uK, 1.0); }`;

// ---------- Geometry ----------
// The helpers (quad, box, boite, wall, cylinder, line, circle, frameLines, rectLines, enDeux) are in geometrie.js.
const mapAt = n => [(n.x - 500) / 1000 * 4.2, n.kind === "core" ? 1.62 : 1.24 + (n.kind === "inscrit" ? -0.08 : 0), -11 + (n.y - 300) / 660 * 2.8];
const nodeColor = kind => token({ core: "--acc-aether", noyau: "--acc-writing", code: "--acc-dev", future: "--acc-worlds-text", vision: "--acc-worlds-text", inscrit: "--dim" }[kind] || "--paper");

// ---------- Signs: text drawn once into a canvas, then a texture ----------
function signCanvas(lines) {
  const c = document.createElement("canvas"), x = c.getContext("2d");
  const fontOf = l => `${l.weight || 400} ${l.size}px ${l.family}`;
  let w = 0, h = 0;
  for (const l of lines) { x.font = fontOf(l); x.letterSpacing = l.spacing || "0px"; w = Math.max(w, x.measureText(l.text).width); h += l.size * (l.lead || 1.25); }
  c.width = Math.ceil(w + 48); c.height = Math.ceil(h + 24);
  let y = 12;
  for (const l of lines) {
    x.font = fontOf(l); x.letterSpacing = l.spacing || "0px"; x.fillStyle = "#fff"; x.textBaseline = "top"; x.textAlign = "center";
    x.globalAlpha = l.alpha ?? 1;
    x.fillText(l.text, c.width / 2, y + l.size * ((l.lead || 1.25) - 1) / 2);
    y += l.size * (l.lead || 1.25);
  }
  return c;
}

/** Frame's screen (D169): its page, in the site's style — a page of the site, not a store's (the store's own page,
 *  when it opens, will be a link on it). Drawn once, 16:9. */
function ecranCanvas(SERIF, MONO, SANS, teinte) {
  const c = document.createElement("canvas"); c.width = 1280; c.height = 720;
  const x = c.getContext("2d"), t = `rgb(${teinte.map(v => Math.round(v * 255)).join(",")})`;
  const g = x.createLinearGradient(0, 0, 0, 720);
  g.addColorStop(0, "#0b0812"); g.addColorStop(1, "#05040a");
  x.fillStyle = g; x.fillRect(0, 0, 1280, 720);
  const r = x.createRadialGradient(940, 300, 20, 940, 300, 520);
  r.addColorStop(0, "rgba(92,240,189,.16)"); r.addColorStop(1, "rgba(92,240,189,0)");
  x.fillStyle = r; x.fillRect(0, 0, 1280, 720);
  // The top bar, as on the site's pages.
  x.fillStyle = "rgba(255,255,255,.06)"; x.fillRect(0, 0, 1280, 64);
  x.textBaseline = "middle"; x.fillStyle = "#f6eef2";
  x.font = `500 22px ${MONO}`; x.letterSpacing = "5px"; x.fillText("YOSULJIN", 48, 32);
  x.fillStyle = t; x.fillText("GAME DEVELOPMENT", 980, 32);
  // The page itself.
  x.textBaseline = "alphabetic"; x.letterSpacing = "6px"; x.font = `500 22px ${MONO}`; x.fillStyle = t;
  x.fillText("JEU VIDÉO · TITRE PROVISOIRE", 96, 190);
  x.letterSpacing = "0px"; x.font = `400 190px ${SERIF}`; x.fillStyle = "#f6eef2"; x.fillText("Frame", 88, 360);
  x.font = `italic 400 48px ${SERIF}`; x.fillStyle = "rgba(246,238,242,.72)"; x.fillText("Mon premier jeu vidéo.", 96, 432);
  x.font = `400 28px ${SANS}`; x.fillStyle = "rgba(246,238,242,.62)";
  x.fillText("Pas encore commencé.", 96, 492);
  // Where the store's button will be: no link, no logo, only the words of the pages ("il sortira sur Steam").
  x.strokeStyle = t; x.lineWidth = 3; x.strokeRect(96, 548, 520, 72);
  x.font = `500 24px ${MONO}`; x.letterSpacing = "6px"; x.fillStyle = t; x.fillText("IL SORTIRA SUR STEAM", 132, 594);
  // The frame of a game: corners, as in the menu's sigil.
  x.strokeStyle = "rgba(92,240,189,.55)"; x.lineWidth = 4;
  for (const [cx, cy, sx, sy] of [[760, 160, 1, 1], [1184, 160, -1, 1], [760, 600, 1, -1], [1184, 600, -1, -1]]) {
    x.beginPath(); x.moveTo(cx, cy + 60 * sy); x.lineTo(cx, cy); x.lineTo(cx + 60 * sx, cy); x.stroke();
  }
  x.font = `400 120px ${SERIF}`; x.fillStyle = "rgba(92,240,189,.85)"; x.textAlign = "center"; x.fillText("F", 972, 420);
  return c;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Returns the drawing, or null without WebGL.
 * options = { palier (0 to 2: today always 0), greffons: [{ nom, init, avant, apres, liberer }], qa (optional: a reader of
 * QA flags, handed on to the grafts; absent, every flag is off) }. See ajouts.js for how musee.js fills them.
 */
export function createRendu(canvas, options = {}) {
  const opt = options || {};
  const opts = { alpha: false, antialias: true, depth: true, stencil: false, powerPreference: "high-performance" };
  const gl = canvas.getContext("webgl2", opts) || canvas.getContext("webgl", opts);
  if (!gl) return null;
  cacheUniforms(gl);
  const palier = (opt.palier | 0) > 0 ? Math.min(2, opt.palier | 0) : 0;
  // Continuous knobs that recompile nothing: rendu.reglage(nom, valeur). Today only `definition` (the canvas's scale) and
  // `calme` (the nodes stop breathing) act in this file; grains, flaquesDyn and exposition are kept for the grafts to read
  // and nothing here reads them yet (rendu.reglage("exposition", 1.3) changes no pixel until a graft uses it).
  const reglages = { definition: 1, grains: 0, flaquesDyn: 0, exposition: 1, calme: false };
  const SERIF = font("--serif") || "Georgia, serif", MONO = font("--mono") || "monospace", SANS = font("--sans") || "sans-serif";

  // ---------- Building the static geometry ----------
  const solid = [], glass = [], lines = [], points = [], floors = [], signs = [], images = [];
  const pools = [];
  const pool = (x, z, r, k, col) => pools.push({ x, z, r, k, col });
  const sign = (texts, center, right, h, col, more = {}) => signs.push({ lines: texts, center, right, h, col, ...more });
  const titre = (t, size = 96) => ({ text: t, family: SERIF, size });
  const sous = (t, size = 22) => ({ text: t, family: MONO, size, weight: 500, spacing: "4px", alpha: 0.75 });
  // A sign on a wall facing (nx, nz): its right is (nz, -nx), the visitor's right when reading it.
  const surMur = (texts, x, y, z, nx, nz, h, col, more) => sign(texts, [x + nx * 0.02, y, z + nz * 0.02], [nz, 0, -nx], h, col, more);
  const point = (x, y, z, c, a, s) => points.push(x, y, z, c[0], c[1], c[2], a, s);

  // Floors, one per room, with its grid's hue (its own light, when it has one).
  for (const s of SALLES) floors.push({ s, data: new Float32Array([s.x0, 0, s.z0, s.x1, 0, s.z0, s.x1, 0, s.z1, s.x0, 0, s.z0, s.x1, 0, s.z1, s.x0, 0, s.z1]), grid: lumiere(s) });
  // Walls, then what is above each door; their lit edges, on each face, in the light of the room it faces.
  for (const [x0, z0, x1, z1] of MURS) {
    wall(solid, x0, z0, x1, z1, 0, MURS_HAUT, EPAISSEUR, MUR);
    const L = Math.hypot(x1 - x0, z1 - z0), nx = -(z1 - z0) / L, nz = (x1 - x0) / L;
    for (const side of [1, -1]) {
      const o = EPAISSEUR / 2 + 0.012, mx = (x0 + x1) / 2 + nx * side * 0.8, mz = (z0 + z1) / 2 + nz * side * 0.8;
      const room = salleDe(mx, mz);
      if (!room) continue;
      const col = lumiere(room), ox = nx * side * o, oz = nz * side * o;
      line(lines, [x0 + ox, 0.03, z0 + oz], [x1 + ox, 0.03, z1 + oz], col, 0.55);
      line(lines, [x0 + ox, MURS_HAUT - 0.02, z0 + oz], [x1 + ox, MURS_HAUT - 0.02, z1 + oz], col, 0.22);
    }
  }
  const accent = token("--accent"), sakura = token("--sakura"), gold = token("--acc-aether");
  for (const p of PORTES) {
    wall(solid, p.x0, p.z0, p.x1, p.z1, PORTE_HAUT, MURS_HAUT, EPAISSEUR, MUR);
    const room = SALLES.find(s => s.id === p.vers), col = token(room.teinte);
    const L = Math.hypot(p.x1 - p.x0, p.z1 - p.z0), ux = (p.x1 - p.x0) / L, uz = (p.z1 - p.z0) / L;
    const nx = -uz * (EPAISSEUR / 2 + 0.015), nz = ux * (EPAISSEUR / 2 + 0.015);
    for (const s of [1, -1]) frameLines(lines, p.x0 + nx * s, p.z0 + nz * s, p.x1 + nx * s, p.z1 + nz * s, 0, PORTE_HAUT, col, 0.9);
    // Over the door, on the hall's side, the room's name; on the room's side, the hall's (to find one's way back).
    const mx = (p.x0 + p.x1) / 2, mz = (p.z0 + p.z1) / 2;
    const hx = Math.sign(p.hall[0] - mx), hz = Math.sign(p.hall[1] - mz), d = EPAISSEUR / 2 + 0.03;
    const aether = room.id === "aether";
    surMur([{ text: aether ? "AETHER" : room.nom.toUpperCase(), family: SERIF, size: 96 }, sous(room.sous || "", 22)],
      mx + hx * d, 3.45, mz + hz * d, hx, hz, aether ? 0.62 : 0.5, col);
    surMur([{ text: "LE HALL", family: MONO, size: 40, weight: 500, spacing: "8px" }], mx - hx * d, 3.3, mz - hz * d, -hx, -hz, 0.2, accent);
  }

  // ---------- Aether: the map, a round plinth and a table of light, its nodes and links (aether.html's map) ----------
  cylinder(solid, 0, -11, 1.35, 0, 0.98, SOCLE);
  circle(lines, 0, 0.99, -11, 1.35, gold, 0.8);
  circle(lines, 0, 1.06, -11, 2.25, gold, 0.25);
  circle(lines, 0, 0.02, -11, 1.6, gold, 0.35);
  pool(0, -11, 4.5, 0.42, gold);
  const nodes = new Map(CARTE.noeuds.map(n => [n.id, { ...n, at: mapAt(n), col: nodeColor(n.kind) }]));
  for (const [a, b] of CARTE.liens) {
    const A = nodes.get(a), B = nodes.get(b);
    line(lines, A.at, B.at, A.id === "lumina" || B.id === "lumina" ? gold : A.col, 0.55);
  }
  for (const n of nodes.values()) line(lines, [n.at[0], 1.06, n.at[2]], n.at, n.col, 0.18);

  // ---------- Showcases and panels (Aether, Mondes, Game Development) ----------
  for (const o of OEUVRES) {
    if (o.type === "vitrine") {
      // The showcase turns to face what it stands around (Aether's map, Mondes' model): its plinth's front, and the
      // sign on it, face the visitor who comes from there.
      const col = token(o.teinte), s = 0.42, [cx, cz] = o.face || [0, -11];
      const dx = cx - o.x, dz = cz - o.z, L = Math.hypot(dx, dz), fx = dx / L, fz = dz / L;
      const F = [fx * s, 0, fz * s], R = [fz * s, 0, -fx * s];
      boite(solid, [o.x, 0.46, o.z], R, [0, 0.46, 0], F, SOCLE);
      boite(glass, [o.x, 1.4875, o.z], R, [0, 0.5625, 0], F, col, 0.75);
      for (const k of [1, -1]) frameLines(lines, o.x + F[0] * k - R[0], o.z + F[2] * k - R[2], o.x + F[0] * k + R[0], o.z + F[2] * k + R[2], 0.92, 2.05, col, 0.25);
      for (const [a, b] of [[0, 0], [TAU / 4, 1]]) for (let i = 0; i < 48; i++) {
        // Two rings around the heart of the scene: a glass in its glass.
        const u = i / 48 * TAU, v = (i + 1) / 48 * TAU, r = 0.27;
        const P = t => b ? [o.x + Math.cos(t) * r * Math.cos(a), 1.48 + Math.sin(t) * r, o.z + Math.cos(t) * r * Math.sin(a)] : [o.x + Math.cos(t) * r, 1.48, o.z + Math.sin(t) * r];
        line(lines, P(u), P(v), col, 0.45);
      }
      circle(lines, o.x, 1.48, o.z, 0.27, col, 0.25);
      point(o.x, 1.48, o.z, col, 1, 0.16); point(o.x, 1.48, o.z, col, 0.35, 0.9);
      pool(o.x, o.z, 1.5, 0.6, col);
      // Its name on the plinth's front, never wider than the plinth: a long line goes on two.
      sign([{ text: o.nom, family: SERIF, size: 64 }, ...enDeux(o.sous).map(t => sous(t))], [o.x + fx * (s + 0.02), 0.6, o.z + fz * (s + 0.02)], [fz, 0, -fx], 0.32, [1, 1, 1], { maxW: 2 * s - 0.06 });
    } else if (o.type === "panneau") {
      const col = o.teinte ? token(o.teinte) : gold, half = o.l / 2;
      const ax = o.nz !== 0 ? 1 : 0, az = o.nx !== 0 ? 1 : 0;        // along the wall
      const cx = o.x + o.nx * 0.05, cz = o.z + o.nz * 0.05;
      const x0 = cx - ax * half, x1 = cx + ax * half, z0 = cz - az * half, z1 = cz + az * half;
      if (ax) box(solid, x0, 0.85, cz - 0.04, x1, 3.15, cz + 0.04, [0.09, 0.065, 0.12]); else box(solid, cx - 0.04, 0.85, z0, cx + 0.04, 3.15, z1, [0.09, 0.065, 0.12]);
      const fx = o.nx * 0.06, fz = o.nz * 0.06;
      frameLines(lines, x0 + fx, z0 + fz, x1 + fx, z1 + fz, 0.85, 3.15, col, 0.75);
      line(lines, [x0 + fx, 2.15, z0 + fz], [x1 + fx, 2.15, z1 + fz], col, 0.18);
      pool(o.x + o.nx * 1.2, o.z + o.nz * 1.2, 2.2, 0.28, col);
      surMur([{ text: o.nom, family: SERIF, size: 72 }, sous(o.sous)], o.x + o.nx * 0.08, 2.62, o.z + o.nz * 0.08, o.nx, o.nz, 0.5, [1, 1, 1]);
      surMur([{ text: "REGARDER", family: MONO, size: 22, weight: 500, spacing: "5px", alpha: 0.7 }], o.x + o.nx * 0.08, 1.2, o.z + o.nz * 0.08, o.nx, o.nz, 0.1, col);
    }
  }
  // The names of the map's nodes, small, turning toward the eye.
  for (const n of nodes.values()) {
    sign([{ text: n.id === "la-lumina" ? "LA LUMINA" : n.id === "thehive" ? "THEHIVE" : n.id.toUpperCase(), family: MONO, size: 26, weight: 500, spacing: "3px" }],
      [n.at[0], n.at[1] + (n.kind === "core" ? 0.3 : 0.17), n.at[2]], null, n.kind === "core" ? 0.11 : 0.075, n.col, { billboard: true });
  }

  // ---------- The hall: its title over the Aether door, in view from the arrival; a word of the lexicon ----------
  pool(0, 6, 6.5, 0.22, accent);
  pool(0, -1.2, 2.6, 0.3, gold);
  sign([{ text: "YOSULJIN", family: SERIF, size: 120 }, { text: "LE MUSÉE · ENTRE LES MONDES", family: MONO, size: 26, weight: 500, spacing: "6px", alpha: 0.8 }],
    [0, MURS_HAUT + 0.58, 0.4], [1, 0, 0], 0.85, sakura);
  surMur([{ text: "世界之間", family: '"Yosuljin Hanzi", serif', size: 120 }], 0, 3.0, 11.83, 0, -1, 0.5, sakura, { faible: true });
  // Each room's name, high on its far wall: read from the door; come close, it rises to the top of the view and fades
  // there, under the site's bar and the chips.
  const haut = { haut: true };
  surMur([titre("AETHER", 130), sous("LUMINA ET CE QUI LA CONSTRUIT", 24)], 0, 3.62, -21.83, 0, 1, 0.78, gold, haut);
  const jeux = token("--acc-games"), mondes = token("--acc-worlds-text"), ecriture = token("--acc-writing"), rouge = token("#ff3a2a");
  surMur([titre("GAME DEVELOPMENT"), sous("MES JEUX VIDÉO")], 16.83, 3.15, 3.1, -1, 0, 0.62, jeux, haut);
  surMur([titre("MONDES"), sous("MES AUTRES PROJETS")], 16.83, 3.15, 9.6, -1, 0, 0.62, mondes, haut);
  surMur([titre("PHOTOGRAPHIE"), sous("LA CHAMBRE NOIRE")], -16.83, 3.4, 3.1, 1, 0, 0.62, rouge, haut);
  surMur([titre("ÉCRITURE"), sous("LA BIBLIOTHÈQUE")], -16.83, 3.4, 9.6, 1, 0, 0.62, ecriture, haut);

  // ---------- Game Development: the desk, the PC, Frame on the screen, the chair ----------
  {
    const [bx0, bz0, bx1, bz1] = MEUBLES.bureau;
    box(solid, bx0, 0.7, bz0, bx1, 0.74, bz1, NOIR);                          // the top
    box(solid, bx0, 0, bz0, bx1, 0.7, bz0 + 0.04, NOIR);                       // its two sides
    box(solid, bx0, 0, bz1 - 0.04, bx1, 0.7, bz1, NOIR);
    line(lines, [bx0, 0.742, bz0], [bx0, 0.742, bz1], jeux, 0.45);             // its lit front edge
    // The screen: a dark body, its stand, and the picture (drawn with the images, below).
    box(solid, 16.44, 0.94, 2.52, 16.49, 1.56, 3.68, NOIR);
    box(solid, 16.5, 0.74, 3.05, 16.56, 1.0, 3.15, NOIR);
    box(solid, 16.38, 0.74, 2.9, 16.62, 0.76, 3.3, NOIR);
    images.push({ id: "ecran", canvas: ecranCanvas(SERIF, MONO, SANS, jeux), center: [16.435, 1.25, 3.1], right: [0, 0, 1], w: 1.08, h: 0.6075 });
    pool(15.9, 3.1, 1.9, 0.75, jeux);
    point(16.3, 1.25, 3.1, jeux, 0.18, 1.6);
    // The keyboard (its keys a faint light), the mouse on its pad, two speakers.
    box(solid, 15.98, 0.74, 2.82, 16.16, 0.765, 3.38, NOIR);
    for (let r = 0; r < 4; r++) line(lines, [16.0 + r * 0.04, 0.767, 2.85], [16.0 + r * 0.04, 0.767, 3.35], jeux, 0.22);
    box(solid, 15.95, 0.74, 3.46, 16.3, 0.745, 3.92, [0.05, 0.04, 0.06]);
    box(solid, 16.05, 0.745, 3.62, 16.14, 0.77, 3.68, NOIR);
    for (const z of [2.3, 3.9]) { box(solid, 16.48, 0.74, z - 0.07, 16.62, 0.96, z + 0.07, NOIR); point(16.47, 0.85, z, jeux, 0.5, 0.05); }
    // The PC beside the desk: a tower with a glass side, lit from inside.
    const [tx0, tz0, tx1, tz1] = MEUBLES.tour;
    box(solid, tx0, 0, tz0, tx1, 0.52, tz1, NOIR);
    quad(glass, [tx0 - 0.002, 0.04, tz0 + 0.02], [tx0 - 0.002, 0.04, tz1 - 0.02], [tx0 - 0.002, 0.48, tz1 - 0.02], [tx0 - 0.002, 0.48, tz0 + 0.02], [-1, 0, 0], jeux, 1.2);
    rectLines(lines, tx0 - 0.004, tz0 + 0.02, tx0 - 0.004, tz1 - 0.02, 0.04, jeux, 0.5);
    for (let i = 0; i < 3; i++) point(tx0 - 0.01, 0.12 + i * 0.13, (tz0 + tz1) / 2, jeux, 0.7, 0.07);
    pool(15.8, 4.45, 1.0, 0.5, jeux);
    // The chair, facing the screen: seat, back, its foot and its star.
    const pc = OEUVRES.find(o => o.id === "pc"), cx = pc.x, cz = pc.z;
    box(solid, cx - 0.24, 0.42, cz - 0.25, cx + 0.24, 0.5, cz + 0.25, BOIS);
    box(solid, cx - 0.32, 0.5, cz - 0.24, cx - 0.24, 1.0, cz + 0.24, BOIS);
    line(lines, [cx - 0.24, 1.0, cz - 0.24], [cx - 0.24, 1.0, cz + 0.24], jeux, 0.35);
    cylinder(solid, cx, cz, 0.035, 0.06, 0.42, NOIR, 12);
    cylinder(solid, cx, cz, 0.3, 0.02, 0.06, NOIR, 20);
    // A rug under the chair and the desk.
    rectLines(lines, 14.4, 1.6, 16.9, 4.6, 0.012, jeux, 0.3);
    pool(12.2, 3.1, 4.4, 0.16, jeux);
  }

  // ---------- Mondes: the museum at 1/16 on its table, where one sees oneself ----------
  {
    const [tx0, tz0, tx1, tz1] = MEUBLES.table, y = MAQUETTE.y, k = MAQUETTE.echelle;
    box(solid, tx0, y - 0.04, tz0, tx1, y - 0.02, tz1, NOIR);
    box(solid, tx0 + 0.1, 0, tz0 + 0.1, tx1 - 0.1, y - 0.04, tz1 - 0.1, SOCLE);
    rectLines(lines, tx0, tz0, tx1, tz1, y - 0.02, mondes, 0.6);
    // Its floors, each in its room's light, and its walls, low, their tops lit.
    for (const s of SALLES) {
      const [ax, az] = enMaquette(s.x0, s.z0), [bx, bz] = enMaquette(s.x1, s.z1), col = lumiere(s);
      quad(glass, [ax, y + 0.001, az], [ax, y + 0.001, bz], [bx, y + 0.001, bz], [bx, y + 0.001, az], [0, 1, 0], col, 0.3);
      rectLines(lines, ax, az, bx, bz, y + 0.002, col, 0.35);
    }
    for (const [x0, z0, x1, z1] of MURS) {
      const [ax, az] = enMaquette(x0, z0), [bx, bz] = enMaquette(x1, z1);
      wall(solid, ax, az, bx, bz, y, y + 0.09, EPAISSEUR * k, [0.16, 0.12, 0.2]);
      line(lines, [ax, y + 0.092, az], [bx, y + 0.092, bz], sakura, 0.3);
    }
    // The model's own table, in the model.
    const [mx0, mz0] = enMaquette(tx0, tz0), [mx1, mz1] = enMaquette(tx1, tz1);
    rectLines(lines, mx0, mz0, mx1, mz1, y + 0.01, mondes, 0.6);
    pool(MAQUETTE.cx, MAQUETTE.cz, 2.4, 0.5, mondes);
    pool(12.4, 9.6, 4.6, 0.15, mondes);
  }

  // ---------- Photographie: the darkroom — its red light, the bench and its trays, the lines, the empty frames ----------
  {
    const [bx0, bz0, bx1, bz1] = MEUBLES.paillasse;
    box(solid, bx0, 0, bz0, bx1, 0.9, bz1, NOIR);
    line(lines, [bx1 + 0.002, 0.9, bz0], [bx1 + 0.002, 0.9, bz1], rouge, 0.5);
    // Facing the bench (west), the left is the south: developer, stop, fixer, as one works.
    const cuves = ["FIXATEUR", "ARRÊT", "RÉVÉLATEUR"];
    cuves.forEach((nom, i) => {
      const z0 = 1.35 + i * 1.3, z1 = z0 + 0.9;
      box(solid, -16.62, 0.9, z0, -16.08, 0.97, z0 + 0.03, [0.12, 0.1, 0.12]);
      box(solid, -16.62, 0.9, z1 - 0.03, -16.08, 0.97, z1, [0.12, 0.1, 0.12]);
      box(solid, -16.62, 0.9, z0, -16.59, 0.97, z1, [0.12, 0.1, 0.12]);
      box(solid, -16.11, 0.9, z0, -16.08, 0.97, z1, [0.12, 0.1, 0.12]);
      quad(glass, [-16.59, 0.95, z0 + 0.03], [-16.59, 0.95, z1 - 0.03], [-16.11, 0.95, z1 - 0.03], [-16.11, 0.95, z0 + 0.03], [0, 1, 0], rouge, 1.4);
      surMur([{ text: nom, family: MONO, size: 30, weight: 500, spacing: "6px" }], bx1 + 0.005, 0.72, (z0 + z1) / 2, 1, 0, 0.09, rouge);
    });
    // The safelight, on the wall above the bench: the room's only light.
    box(solid, -16.85, 2.3, 2.9, -16.74, 2.62, 3.3, [1, 0.24, 0.16], 1);
    point(-16.7, 2.46, 3.1, rouge, 0.9, 0.35); point(-16.7, 2.46, 3.1, rouge, 0.25, 2.4);
    pool(-15.6, 3.1, 3.6, 0.95, rouge);
    pool(-12.4, 3.1, 5.0, 0.28, rouge);
    // The lines across the room, and their pegs, where the prints will dry.
    for (const z of [1.6, 3.1, 4.6]) {
      line(lines, [-15.6, 2.32, z], [-8.4, 2.32, z], [0.9, 0.75, 0.7], 0.32);
      for (let x = -15.2; x < -8.6; x += 0.55) box(solid, x - 0.012, 2.25, z - 0.01, x + 0.012, 2.33, z + 0.01, [0.4, 0.3, 0.26]);
    }
    // The six frames, one per theme, empty: a dark mat, its glass, its edges; the theme's name under it.
    for (const o of OEUVRES.filter(o => o.type === "cadre")) {
      const w = 1.3, h = 0.9, y0 = 1.2, y1 = y0 + h, x0 = o.x - w / 2, x1 = o.x + w / 2, z = o.z + o.nz * 0.02;
      const zz = o.z + o.nz * 0.045;
      if (o.nz > 0) quad(solid, [x1, y0, z], [x0, y0, z], [x0, y1, z], [x1, y1, z], [0, 0, 1], [0.05, 0.04, 0.05], 0);
      else quad(solid, [x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [0, 0, -1], [0.05, 0.04, 0.05], 0);
      quad(glass, [x0, y0, zz], [x1, y0, zz], [x1, y1, zz], [x0, y1, zz], [0, 0, o.nz], rouge, 0.5);
      frameLines(lines, x0 - 0.06, zz, x1 + 0.06, zz, y0 - 0.06, y1 + 0.06, rouge, 0.65);
      frameLines(lines, x0 + 0.1, zz, x1 - 0.1, zz, y0 + 0.1, y1 - 0.1, rouge, 0.2);
      surMur([{ text: String(o.n).padStart(2, "0"), family: MONO, size: 26, weight: 500, spacing: "4px", alpha: 0.7 }, { text: o.nom, family: SERIF, size: 64 }, sous(o.sous, 20)],
        o.x, 0.82, o.z + o.nz * 0.03, 0, o.nz, 0.42, [1, 0.86, 0.82]);
      pool(o.x, o.z + o.nz * 1.0, 1.3, 0.35, rouge);
    }
  }

  // ---------- Écriture: the shelves (empty), the lectern ----------
  const ETAGERES = [0.08, 0.5, 0.92, 1.34, 1.76, 2.18, 2.6];
  {
    const rayons = (x0, z0, x1, z1, fond) => {
      // A bookcase: its back against the wall (`fond`: the side of the wall), its sides and uprights, its planks.
      const alongX = x1 - x0 > z1 - z0;
      if (fond === "x0") box(solid, x0, 0, z0, x0 + 0.04, 2.66, z1, BOIS);
      if (fond === "z1") box(solid, x0, 0, z1 - 0.04, x1, 2.66, z1, BOIS);
      if (fond === "z0") box(solid, x0, 0, z0, x1, 2.66, z0 + 0.04, BOIS);
      const L = alongX ? x1 - x0 : z1 - z0, n = Math.max(1, Math.round(L / 1.4));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        if (alongX) { const x = x0 + t * (x1 - x0); box(solid, x - 0.02, 0, z0, x + 0.02, 2.66, z1, BOIS); }
        else { const z = z0 + t * (z1 - z0); box(solid, x0, 0, z - 0.02, x1, 2.66, z + 0.02, BOIS); }
      }
      for (const y of ETAGERES) {
        box(solid, x0, y - 0.025, z0, x1, y, z1, BOIS);
        // Their front edges, a faint light.
        if (fond === "x0") line(lines, [x1 + 0.003, y, z0], [x1 + 0.003, y, z1], ecriture, 0.24);
        if (fond === "z1") line(lines, [x0, y, z0 - 0.003], [x1, y, z0 - 0.003], ecriture, 0.24);
        if (fond === "z0") line(lines, [x0, y, z1 + 0.003], [x1, y, z1 + 0.003], ecriture, 0.24);
      }
    };
    rayons(...MEUBLES.rayonsO, "x0");
    rayons(...MEUBLES.rayonsS, "z1");
    rayons(...MEUBLES.rayonsN, "z0");
    // The lectern: its foot, its base, its top slanting toward the reader (who stands east of it, facing west).
    const lp = OEUVRES.find(o => o.id === "pupitre"), lx = lp.x, lz = lp.z;
    box(solid, lx - 0.3, 0, lz - 0.28, lx + 0.25, 0.04, lz + 0.28, BOIS);
    box(solid, lx - 0.1, 0.04, lz - 0.1, lx + 0.06, 1.0, lz + 0.1, BOIS);
    const A = [lx + 0.24, 0.98, lz - 0.32], B = [lx + 0.24, 0.98, lz + 0.32], Cc = [lx - 0.26, 1.16, lz + 0.32], D = [lx - 0.26, 1.16, lz - 0.32];
    quad(solid, A, B, Cc, D, [0.34, 0.94, 0], BOIS, 0);
    quad(solid, [A[0], A[1] - 0.03, A[2]], [B[0], B[1] - 0.03, B[2]], B, A, [1, 0, 0], BOIS, 0);
    line(lines, A, B, ecriture, 0.5);
    pool(lx, lz, 1.8, 0.75, ecriture);
    // A lamp hangs over the lectern, warm.
    // Low over the lectern, below the room's name on the far wall (seen from the door, they do not cross).
    line(lines, [lx, MURS_HAUT, lz], [lx, 1.98, lz], [0.6, 0.5, 0.45], 0.25);
    box(solid, lx - 0.12, 1.88, lz - 0.12, lx + 0.12, 1.98, lz + 0.12, [1, 0.82, 0.62], 0.9);
    point(lx, 1.86, lz, [1, 0.85, 0.7], 0.8, 0.22); point(lx, 1.8, lz, [1, 0.8, 0.65], 0.18, 2.0);
    pool(lx, lz, 2.6, 0.35, [1, 0.8, 0.62]);
    pool(-16.2, OEUVRES.find(o => o.id === "livre").z, 1.5, 0.55, ecriture);
    pool(-12.6, 9.6, 4.6, 0.14, ecriture);
  }

  // ---------- Dust in the light, still ----------
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const s of SALLES) {
    const n = Math.round((s.x1 - s.x0) * (s.z1 - s.z0) * 0.55);
    for (let i = 0; i < n; i++) {
      const x = s.x0 + rnd() * (s.x1 - s.x0), z = s.z0 + rnd() * (s.z1 - s.z0), c = rnd() < 0.5 ? sakura : lumiere(s);
      point(x, 0.3 + rnd() * 3.6, z, c, 0.12 + rnd() * 0.18, 0.025 + rnd() * 0.03);
    }
  }

  // ---------- What the grafts are handed (init(gl, api)) ----------
  // The settings are handed as a read-only view: a graft reads them, rendu.reglage() (which clamps) is the only way to change one.
  const reglagesVue = {};
  for (const k of Object.keys(reglages)) Object.defineProperty(reglagesVue, k, { enumerable: true, get: () => reglages[k] });
  const api = { hauteur: _id => MURS_HAUT, palier, qa: typeof opt.qa === "function" ? opt.qa : () => false, reglages: reglagesVue };
  const avertis = new Set();
  const avertir = (cle, texte, e) => { if (avertis.has(cle)) return; avertis.add(cle); try { console.warn(`[musee] ${texte}`, e && e.message ? e.message : e); } catch {} };

  // ---------- GL resources ----------
  // The pools light the floors: each room's floor has its own (the ones within it), so a room never pays for another's.
  const enSalle = p => salleDe(p.x, p.z) || SALLES.reduce((best, s) => {
    const d = Math.hypot(Math.max(s.x0 - p.x, 0, p.x - s.x1), Math.max(s.z0 - p.z, 0, p.z - s.z1));
    return !best || d < best.d ? { s, d } : best;
  }, null).s;
  for (const f of floors) f.pools = pools.filter(p => enSalle(p) === f.s);
  const NPOOL = Math.max(1, Math.min(14, Math.max(...floors.map(f => f.pools.length))));
  for (const f of floors) {
    f.poolArr = new Float32Array(NPOOL * 4); f.poolCol = new Float32Array(NPOOL * 3);
    for (let i = 0; i < NPOOL; i++) f.poolArr[i * 4 + 2] = 1;   // an unused pool: radius 1, no light (never a division by zero)
    f.pools.slice(0, NPOOL).forEach((p, i) => { f.poolArr.set([p.x, p.z, p.r, p.k], i * 4); f.poolCol.set(p.col, i * 3); });
  }
  const progSolid = program(gl, SOLID_VS, SOLID_FS), progFloor = program(gl, FLOOR_VS, FLOOR_FS, `#define NPOOL ${NPOOL}\n`), progLine = program(gl, LINE_VS, LINE_FS);
  const progGlass = program(gl, SOLID_VS, GLASS_FS), progPoint = program(gl, POINT_VS, POINT_FS), progText = program(gl, TEXT_VS, TEXT_FS), progImage = program(gl, TEXT_VS, IMAGE_FS);
  for (const p of [progSolid, progFloor, progLine, progGlass, progPoint, progText, progImage]) p.finish();
  const solidBuf = buffer(gl, new Float32Array(solid)), solidN = solid.length / 10;
  const glassBuf = buffer(gl, new Float32Array(glass)), glassN = glass.length / 10;
  const lineBuf = buffer(gl, new Float32Array(lines)), lineN = lines.length / 7;
  const pointBuf = buffer(gl, new Float32Array(points)), pointN = points.length / 8;
  for (const f of floors) f.buf = buffer(gl, f.data);
  const cornerBuf = buffer(gl, new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5]));
  const DYN = 600, dynArr = new Float32Array(DYN * 8), dynBuf = buffer(gl, dynArr, gl.DYNAMIC_DRAW);
  // What moves and is solid: the book (on its shelf, in the hand, open on the lectern).
  const DSOL = 400, dsolArr = new Float32Array(DSOL * 10), dsolBuf = buffer(gl, dsolArr, gl.DYNAMIC_DRAW);

  // Text seen from afar or askew stays whole: mipmaps (WebGL2, or a power-of-two picture in WebGL1) and, where the
  // card has it, anisotropic filtering.
  const gl2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic") || gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
  const texture = c => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    const mip = gl2 || ((c.width & (c.width - 1)) === 0 && (c.height & (c.height - 1)) === 0);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  // The signs' textures, drawn once the site's fonts are there (musee.js waits for them); the screens' pictures.
  for (const s of signs) {
    const c = signCanvas(s.lines); s.w = s.h * c.width / c.height;
    if (s.maxW && s.w > s.maxW) { s.h *= s.maxW / s.w; s.w = s.maxW; }   // no wider than what bears it
    s.tex = texture(c);
  }
  for (const im of images) im.tex = texture(im.canvas);

  // ---------- Grafts: init once; avant/apres called every frame, each in its own try ----------
  const greffons = Object.create(null);
  const gref = [];
  const couper = (r, quand, e) => {
    r.vivant = false;
    delete greffons[r.nom];
    avertir(`gref:${r.nom}`, `graft ${r.nom} cut (${quand}):`, e);
    // What it made before its fault is given back now, once (the context lives as long as the page): only if init got through.
    if (r.initOk && typeof r.g.liberer === "function") {
      try { r.g.liberer(gl, r.inst); } catch (e2) { avertir(`lib:${r.nom}`, `graft ${r.nom} release:`, e2); }
    }
  };
  // What a graft did to the GL state (or threw in the middle of) is put back after each of its calls, init included: the
  // frame goes on from the state it expects: the screen's framebuffer and viewport, no vertex array, texture unit 0, no
  // vertex attribute left on or divided (attribs() of world/gl.js turns on what each draw needs), no scissor, the colour mask open,
  // no face culling, the depth test LESS, the blend equation ADD, then depth and blend as the stage asks. Only a graft
  // that was tried costs these calls (none without a graft: the drawing makes the very calls of before the hooks).
  // Read at the first use: a device may count only 8 vertex attributes (the minimum), and an index past that is an error.
  let nAttr = 0, vaoExt, instExt;
  function retablir(quand) {
    if (!nAttr) { nAttr = Math.min(16, gl.getParameter(gl.MAX_VERTEX_ATTRIBS) | 0 || 8); vaoExt = gl2 ? null : gl.getExtension("OES_vertex_array_object"); instExt = gl2 ? null : gl.getExtension("ANGLE_instanced_arrays"); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (gl2) gl.bindVertexArray(null);
    else if (vaoExt) vaoExt.bindVertexArrayOES(null);
    gl.activeTexture(gl.TEXTURE0);
    for (let i = 0; i < nAttr; i++) gl.disableVertexAttribArray(i);
    // Instanced draws leave a divisor on the attribute: back to 0 (WebGL2, or the extension of WebGL1 when the device has it).
    if (gl2 && typeof gl.vertexAttribDivisor === "function") for (let i = 0; i < nAttr; i++) gl.vertexAttribDivisor(i, 0);
    else if (!gl2 && instExt) for (let i = 0; i < nAttr; i++) instExt.vertexAttribDivisorANGLE(i, 0);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.disable(gl.CULL_FACE);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.DEPTH_TEST);
    gl.blendEquation(gl.FUNC_ADD);
    if (quand === "avant") { gl.depthMask(true); gl.disable(gl.BLEND); }
    else { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false); }
  }
  for (const [rang, g] of (Array.isArray(opt.greffons) ? opt.greffons : []).entries()) {
    if (!g || typeof g.nom !== "string" || typeof g.init !== "function" || Object.prototype.hasOwnProperty.call(greffons, g.nom)) {
      avertir(`ign:${rang}`, `graft #${rang} ${g && typeof g.nom === "string" ? g.nom : "(no name)"} ignored (name, init or duplicate)`);
      continue;
    }
    const r = { nom: g.nom, g, inst: undefined, vivant: true };
    try { r.inst = g.init(gl, api); }
    catch (e) { couper(r, "init", e); retablir("avant"); continue; }
    r.initOk = true;
    greffons[g.nom] = r.inst;
    gref.push(r);
    retablir("avant");
  }
  /** A graft's call; the state is put back after it (retablir), also when it threw. */
  function appeler(quand, cam, etat) {
    for (const r of gref) {
      if (!r.vivant) continue;
      try {
        const f = r.g[quand];
        if (typeof f !== "function") continue;
        f.call(r.g, cam, etat, r.inst);
      } catch (e) { couper(r, quand, e); }
      retablir(quand);
    }
  }

  // ---------- View ----------
  const P = mat4.create(), V = mat4.create(), VP = mat4.create();
  let W = 1, H = 1, dpr = 1, scale = 1, dimensionne = false;
  const eye = [0, 1.6, 0], target = [0, 1.6, -1];
  const DENS = 0.042;

  function size(w, h) {
    W = Math.max(1, w); H = Math.max(1, h);
    dpr = Math.min(1.75, window.devicePixelRatio || 1, Math.sqrt(1.6e6 / (W * H))) * reglages.definition;
    dimensionne = true;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const aspect = W / H, fov = aspect >= 1 ? 62 : Math.min(88, 2 * Math.atan(Math.tan(31 * Math.PI / 180) / Math.max(aspect, 0.55)) * 180 / Math.PI);
    mat4.perspective(P, fov * Math.PI / 180, aspect, 0.05, 80);
    scale = canvas.height * P[5] / 2;
  }

  function uniforms(p) {
    gl.uniformMatrix4fv(p.u.uVP, false, VP);
    if (p.u.uEye) gl.uniform3f(p.u.uEye, eye[0], eye[1], eye[2]);
    if (p.u.uDens) gl.uniform1f(p.u.uDens, DENS);
    if (p.u.uFog) gl.uniform3f(p.u.uFog, BG[0], BG[1], BG[2]);
  }

  // The book's places (batiment.js: the shelf's book, the lectern).
  const livre = OEUVRES.find(o => o.id === "livre"), pupitre = OEUVRES.find(o => o.id === "pupitre");
  const COUV = [0.42, 0.12, 0.38], PAGES = [0.95, 0.9, 0.86];

  /**
   * One image. cam: { x, y, z, yaw, pitch }; etat: { t (seconds), almas: { x, y, z, parle }, chemin: [[x, z], …] or
   * null, livre: "etagere" | "main" | "pupitre", visiteur: { x, z, yaw } (the model shows them), calme }.
   */
  function frame(cam, etat) {
    const ch = Math.cos(cam.pitch);
    const calme = !!(etat.calme || reglages.calme);
    eye[0] = cam.x; eye[1] = cam.y; eye[2] = cam.z;
    target[0] = cam.x - Math.sin(cam.yaw) * ch; target[1] = cam.y + Math.sin(cam.pitch); target[2] = cam.z - Math.cos(cam.yaw) * ch;
    mat4.lookAt(V, eye, target, [0, 1, 0]);
    mat4.multiply(VP, P, V);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(BG[0], BG[1], BG[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
    if (gref.length) appeler("avant", cam, etat);

    // Floors, each with its pools.
    gl.useProgram(progFloor.p); uniforms(progFloor);
    gl.uniform3f(progFloor.u.uBase, 0.03, 0.022, 0.045);
    for (const f of floors) {
      gl.uniform4fv(progFloor.u.uPool, f.poolArr); gl.uniform3fv(progFloor.u.uPoolCol, f.poolCol);
      gl.uniform3f(progFloor.u.uGrid, f.grid[0] * 0.5, f.grid[1] * 0.5, f.grid[2] * 0.5);
      attribs(gl, f.buf, [[progFloor.a.aPos, 3]]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    // Walls and furniture; then the book, wherever it is.
    gl.useProgram(progSolid.p); uniforms(progSolid);
    attribs(gl, solidBuf, [[progSolid.a.aPos, 3], [progSolid.a.aNorm, 3], [progSolid.a.aCol, 3], [progSolid.a.aEmit, 1]]);
    gl.drawArrays(gl.TRIANGLES, 0, solidN);
    const book = [];
    if (etat.livre === "etagere") {
      // Standing on its shelf, its spine toward the room.
      box(book, livre.x - 0.12, livre.y, livre.z - 0.035, livre.x + 0.07, livre.y + 0.26, livre.z + 0.035, COUV);
      quad(book, [livre.x + 0.071, livre.y + 0.02, livre.z + 0.03], [livre.x + 0.071, livre.y + 0.02, livre.z - 0.03], [livre.x + 0.071, livre.y + 0.24, livre.z - 0.03], [livre.x + 0.071, livre.y + 0.24, livre.z + 0.03], [1, 0, 0], ecriture, 0.85);
    } else if (etat.livre === "pupitre") {
      // Open on the lectern: two pages in a shallow V, lit.
      const lx = pupitre.x, lz = pupitre.z;
      const p = (u, side) => [lx + 0.2 - u * 0.4, 0.995 + u * 0.144 + 0.012, lz + side * 0.27];
      const m = u => [lx + 0.2 - u * 0.4, 0.995 + u * 0.144 + 0.004, lz];
      quad(book, p(0, -1), m(0), m(1), p(1, -1), [0.3, 0.95, 0], PAGES, 0.85);
      quad(book, m(0), p(0, 1), p(1, 1), m(1), [0.3, 0.95, 0], PAGES, 0.85);
      // The cover, a little larger, under the pages.
      const q = (u, side) => [lx + 0.215 - u * 0.43, 0.99 + u * 0.155 + 0.006, lz + side * 0.29];
      quad(book, q(0, -1), q(0, 1), q(1, 1), q(1, -1), [0.3, 0.95, 0], COUV, 0.1);
    } else if (etat.livre === "main") {
      // In the hand, low on the right of the view, turned toward the eye.
      const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw), sp = Math.sin(cam.pitch);
      const f = [-sy * ch, sp, -cy * ch], r = [cy, 0, -sy], u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
      const c = [0, 1, 2].map(i => eye[i] + f[i] * 0.5 + r[i] * 0.27 - u[i] * 0.21);
      const tilt = 0.35, ax = r.map((v, i) => (v * Math.cos(tilt) + u[i] * Math.sin(tilt)) * 0.05), ay = u.map((v, i) => (v * Math.cos(tilt) - r[i] * Math.sin(tilt)) * 0.07), az = f.map(v => v * 0.015);
      boite(book, c, ax, ay, az, COUV, 0.15);
      boite(book, [c[0] - f[0] * 0.019, c[1] - f[1] * 0.019, c[2] - f[2] * 0.019], ax.map(v => v * 0.82), ay.map(v => v * 0.82), az.map(v => v * 0.08), ecriture, 0.5);
    }
    if (book.length) {
      const n = Math.min(DSOL, book.length / 10);
      dsolArr.set(book.slice(0, n * 10));
      gl.bindBuffer(gl.ARRAY_BUFFER, dsolBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, dsolArr.subarray(0, n * 10));
      attribs(gl, dsolBuf, [[progSolid.a.aPos, 3], [progSolid.a.aNorm, 3], [progSolid.a.aCol, 3], [progSolid.a.aEmit, 1]]);
      gl.drawArrays(gl.TRIANGLES, 0, n);
    }
    // The screens: their pictures, lit by themselves.
    gl.useProgram(progImage.p); uniforms(progImage);
    attribs(gl, cornerBuf, [[progImage.a.aCorner, 2]]);
    for (const im of images) {
      const d = Math.hypot(im.center[0] - eye[0], im.center[1] - eye[1], im.center[2] - eye[2]);
      gl.uniform3f(progImage.u.uCenter, im.center[0], im.center[1], im.center[2]);
      gl.uniform3f(progImage.u.uRight, im.right[0], im.right[1], im.right[2]);
      gl.uniform3f(progImage.u.uUp, 0, 1, 0);
      gl.uniform2f(progImage.u.uSize, im.w, im.h);
      gl.uniform1f(progImage.u.uK, Math.exp(-DENS * DENS * d * d) * 0.95);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, im.tex); gl.uniform1i(progImage.u.uTex, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // Signs: blended over what is drawn, without writing depth.
    gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(progText.p); uniforms(progText);
    attribs(gl, cornerBuf, [[progText.a.aCorner, 2]]);
    const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    for (const s of signs) {
      const d = Math.hypot(s.center[0] - eye[0], s.center[1] - eye[1], s.center[2] - eye[2]);
      let k = Math.exp(-DENS * DENS * d * d) * (s.faible ? 0.4 : 1);
      if (s.haut) {
        // Its centre's height on the screen (-1 at the bottom, 1 at the top): all there up to 0.5, gone from 0.66.
        const [cx, cy, cz] = s.center, y = VP[1] * cx + VP[5] * cy + VP[9] * cz + VP[13], w = VP[3] * cx + VP[7] * cy + VP[11] * cz + VP[15];
        if (w > 0.05) k *= Math.min(1, Math.max(0, (0.66 - y / w) / 0.16));
      }
      if (k < 0.02) continue;
      if (!s.billboard) {
        // A sign seen from behind is not drawn (its text would read backwards).
        const nx = -s.right[2], nz = s.right[0];
        if ((eye[0] - s.center[0]) * nx + (eye[2] - s.center[2]) * nz < 0) continue;
      }
      gl.uniform3f(progText.u.uCenter, s.center[0], s.center[1], s.center[2]);
      if (s.billboard) gl.uniform3f(progText.u.uRight, rx, 0, rz); else gl.uniform3f(progText.u.uRight, s.right[0], s.right[1], s.right[2]);
      gl.uniform3f(progText.u.uUp, 0, 1, 0);
      gl.uniform2f(progText.u.uSize, s.w, s.h);
      gl.uniform3f(progText.u.uCol, s.col[0], s.col[1], s.col[2]);
      gl.uniform1f(progText.u.uK, k);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, s.tex); gl.uniform1i(progText.u.uTex, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // Light: glass, lines, points, added.
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(progGlass.p); uniforms(progGlass);
    attribs(gl, glassBuf, [[progGlass.a.aPos, 3], [progGlass.a.aNorm, 3], [progGlass.a.aCol, 3], [progGlass.a.aEmit, 1]]);
    gl.drawArrays(gl.TRIANGLES, 0, glassN);
    gl.useProgram(progLine.p); uniforms(progLine);
    attribs(gl, lineBuf, [[progLine.a.aPos, 3], [progLine.a.aCol, 4]]);
    gl.drawArrays(gl.LINES, 0, lineN);
    gl.useProgram(progPoint.p); uniforms(progPoint);
    gl.uniform1f(progPoint.u.uScale, scale);
    attribs(gl, pointBuf, [[progPoint.a.aPos, 3], [progPoint.a.aCol, 4], [progPoint.a.aSize, 1]]);
    gl.drawArrays(gl.POINTS, 0, pointN);

    // What moves: the map's nodes breathing, AlmaS and her sparks, the way she shows, the visitor on the model.
    let n = 0;
    const put = (x, y, z, c, a, s) => { if (n >= DYN) return; const o = n * 8; dynArr[o] = x; dynArr[o + 1] = y; dynArr[o + 2] = z; dynArr[o + 3] = c[0]; dynArr[o + 4] = c[1]; dynArr[o + 5] = c[2]; dynArr[o + 6] = a; dynArr[o + 7] = s; n++; };
    const t = etat.t;
    for (const nd of nodes.values()) {
      const k = nd.kind === "core" ? 0.42 : 0.16, pulse = calme ? 1 : 1 + 0.12 * Math.sin(t * 1.7 + nd.x * 0.01);
      put(nd.at[0], nd.at[1], nd.at[2], nd.col, 1, k * 0.35 * pulse);
      put(nd.at[0], nd.at[1], nd.at[2], nd.col, 0.3, k * pulse);
    }
    if (etat.almas) {
      const a = etat.almas, bob = calme ? 0 : Math.sin(t * 2.1) * 0.05, glow = a.parle && !calme ? 1 + 0.25 * Math.sin(t * 9) : 1;
      put(a.x, a.y + bob, a.z, [1, 0.97, 0.98], 1, 0.1);
      put(a.x, a.y + bob, a.z, accent, 0.5 * glow, 0.42);
      put(a.x, a.y + bob, a.z, sakura, 0.14 * glow, 1.0);
      for (let i = 0; i < 3; i++) {
        const u = (calme ? 0 : t * 1.6) + i * TAU / 3;
        put(a.x + Math.cos(u) * 0.3, a.y + bob + Math.sin(u * 1.3) * 0.08, a.z + Math.sin(u) * 0.3, sakura, 0.8, 0.05);
      }
      // On the model, AlmaS too.
      const [mx, mz] = enMaquette(a.x, a.z);
      put(mx, MAQUETTE.y + 0.05, mz, accent, 0.9, 0.035);
    }
    if (etat.visiteur) {
      // The visitor on the model: a light, and a few sparks ahead of it, where they look.
      const v = etat.visiteur, [mx, mz] = enMaquette(v.x, v.z), fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
      const pulse = calme ? 1 : 1 + 0.3 * Math.sin(t * 5);
      put(mx, MAQUETTE.y + 0.04, mz, [1, 1, 1], 1, 0.03 * pulse);
      put(mx, MAQUETTE.y + 0.04, mz, sakura, 0.5, 0.09);
      for (let i = 1; i <= 3; i++) put(mx + fx * 0.025 * i, MAQUETTE.y + 0.04, mz + fz * 0.025 * i, [1, 1, 1], 0.5 - i * 0.12, 0.012);
    }
    if (etat.livre === "etagere") put(livre.x + 0.1, livre.y + 0.13, livre.z, ecriture, 0.5 + (calme ? 0 : 0.25 * Math.sin(t * 2.4)), 0.22);
    if (etat.livre === "pupitre") put(pupitre.x, 1.2, pupitre.z, [1, 0.95, 0.9], 0.35, 0.8);
    if (etat.chemin && etat.chemin.length > 1) {
      // The way: dots on the floor from the visitor to where AlmaS leads, flowing toward it.
      let s0 = 0;
      for (let i = 0; i + 1 < etat.chemin.length; i++) {
        const [ax, az] = etat.chemin[i], [bx, bz] = etat.chemin[i + 1], L = Math.hypot(bx - ax, bz - az);
        for (let s = (0.6 - (s0 % 0.6)) % 0.6; s < L; s += 0.6) {
          const u = (s0 + s), f = calme ? 0.6 : 0.45 + 0.4 * Math.max(0, Math.sin(u * 1.4 - t * 4));
          put(ax + (bx - ax) * s / L, 0.06, az + (bz - az) * s / L, accent, f, 0.09);
        }
        s0 += L;
      }
    }
    if (n) {
      gl.bindBuffer(gl.ARRAY_BUFFER, dynBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, dynArr.subarray(0, n * 8));
      attribs(gl, dynBuf, [[progPoint.a.aPos, 3], [progPoint.a.aCol, 4], [progPoint.a.aSize, 1]]);
      gl.drawArrays(gl.POINTS, 0, n);
    }
    if (gref.length) appeler("apres", cam, etat);
    gl.depthMask(true); gl.disable(gl.BLEND);
  }

  /** Where a point of the building falls on the page: out = [x, y] in CSS pixels; false when behind the eye. */
  function projeter(p, out) {
    const x = VP[0] * p[0] + VP[4] * p[1] + VP[8] * p[2] + VP[12], y = VP[1] * p[0] + VP[5] * p[1] + VP[9] * p[2] + VP[13];
    const w = VP[3] * p[0] + VP[7] * p[1] + VP[11] * p[2] + VP[15];
    if (w <= 0.05) return false;
    out[0] = (x / w * 0.5 + 0.5) * W; out[1] = (0.5 - y / w * 0.5) * H;
    return true;
  }
  /** A continuous knob; nothing is recompiled. definition: the scale of the canvas, 0.7 to 1, in steps of 0.05 (the next
   *  size() takes it at once); grains 0 to 1; flaquesDyn 0 to 3 (whole); exposition 0.8 to 1.3; calme: true or false.
   *  An unknown name is ignored. Returns the value kept. */
  function reglage(nom, valeur) {
    if (!Object.prototype.hasOwnProperty.call(reglages, nom)) return undefined;
    if (nom === "calme") return (reglages.calme = !!valeur);
    const v = Number(valeur);
    if (!Number.isFinite(v)) return reglages[nom];
    if (nom === "definition") {
      const q = Math.round(clamp(v, 0.7, 1) * 20) / 20;
      if (q !== reglages.definition) { reglages.definition = q; if (dimensionne) size(W, H); }
    } else if (nom === "grains") reglages.grains = clamp(v, 0, 1);
    else if (nom === "flaquesDyn") reglages.flaquesDyn = Math.round(clamp(v, 0, 3));
    else if (nom === "exposition") reglages.exposition = clamp(v, 0.8, 1.3);
    return reglages[nom];
  }
  function destroy() {
    for (const r of gref) if (r.vivant && typeof r.g.liberer === "function") { try { r.g.liberer(gl, r.inst); } catch (e) { avertir(`lib:${r.nom}`, `graft ${r.nom} release:`, e); } }
    gref.length = 0;
    try { gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch {}
  }
  return { size, frame, projeter, destroy, gl, palier, greffons, reglage, reglages: reglagesVue };
}
