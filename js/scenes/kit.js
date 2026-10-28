// Project scenes, the drawing (D147): the shapes a scene is made of, in WebGL without any dependency.
// A project's module only gives data (js/scenes/<project>.js); this kit knows three kinds of part:
//   shell — a glass sphere that holds others (a layer): bright rim, faint parallels, a ring of light where touched;
//   core  — a lit body with filaments to its shell and beyond it: touched, light runs out along them and comes back;
//   cloud — loose points around a centre: touched, they gather toward a form and never hold it (in design).
// Everything turns together (drag, inertia, a slow drift). scene.js owns the page side: the buttons, the legend,
// the keyboard, the sound. The parts' names are drawn here, from a texture of text (labels()): a page element moved
// every frame made the browser re-layer the whole page (2026-10-21, 390 px, CPU ×4: 35 images a second instead of
// 85); the buttons stay on the page, transparent, for the keyboard, screen readers and fingers.
import { mat4, program, buffer, attribs, indexBuffer, sphereMesh, rng } from "../world/gl.js?v=20261025-r28";

const TAU = Math.PI * 2;
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
// Colours are the site's tokens (styles.css 02), read from the body; the hex values are their fallbacks.
const FALLBACK = { "--acc-dev": "#2ee8ff", "--acc-worlds": "#7a6cff", "--acc-aether": "#ffd25a", "--acc-writing": "#e86bff", "--acc-photo": "#ff9d3a", "--accent": "#ff5fa2", "--sakura": "#ffd1e3" };
const token = name => {
  let v = "";
  try { v = getComputedStyle(document.body).getPropertyValue(name).trim(); } catch {}
  return hex(/^#[0-9a-f]{6}$/i.test(v) ? v : FALLBACK[name] || "#ffffff");
};
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const WHITE = [1, 1, 1];

const SHELL_VS = `attribute vec3 aPos;
uniform mat4 uVP, uModel; uniform float uR;
varying vec3 vN, vW, vL;
void main() {
  vec4 w = uModel * vec4(aPos * uR, 1.0);
  vW = w.xyz; vN = (uModel * vec4(aPos, 0.0)).xyz; vL = aPos;
  gl_Position = uVP * w;
}`;
// The glass: a rim that grows toward the silhouette, seven parallels, and the ring a touch sends across it.
const SHELL_FS = `precision mediump float;
varying vec3 vN, vW, vL;
uniform vec3 uEye, uColor, uTouch; uniform float uLit, uWave, uFace;
void main() {
  vec3 n = normalize(vN), v = normalize(uEye - vW);
  float f = 1.0 - abs(dot(n, v));
  float rim = f * f * f * f;
  float band = fract(vL.y * 3.5 + 0.5) - 0.5;
  float par = exp(-band * band * 900.0) * (0.35 + 0.65 * f);
  float ring = 0.0;
  if (uWave > 0.0) {
    float d = acos(clamp(dot(normalize(vL), uTouch), -1.0, 1.0));
    ring = exp(-pow((d - uWave * 2.6) * 16.0, 2.0)) * (1.0 - uWave) * (0.35 + 0.65 * f);
  }
  float k = rim * (0.5 + 0.7 * uLit) + par * (0.035 + 0.06 * uLit) + ring * 0.8 + 0.006 * uLit;
  gl_FragColor = vec4(uColor * k * uFace, 1.0);
}`;
// Billboards: a soft dot, a ring, or a lit ball; size in scene units, so they keep their perspective.
const SPRITE_VS = `attribute vec3 aC; attribute vec4 aQ; attribute vec3 aCol;
uniform mat4 uVP, uModel; uniform vec2 uF;
varying vec2 vUV; varying vec4 vCol;
void main() {
  vec4 c = uVP * uModel * vec4(aC, 1.0);
  c.xy += aQ.xy * aQ.z * uF;
  vUV = aQ.xy; vCol = vec4(aCol, aQ.w);
  gl_Position = c;
}`;
const SPRITE_FS = `precision mediump float;
varying vec2 vUV; varying vec4 vCol;
void main() {
  float r2 = dot(vUV, vUV);
  if (r2 > 1.0) discard;
  float a;
  if (vCol.a < 0.5) a = exp(-r2 * 5.0);
  else if (vCol.a < 1.5) { float r = sqrt(r2); a = exp(-pow((r - 0.74) * 10.0, 2.0)); }
  else { vec3 n = vec3(vUV, sqrt(1.0 - r2)); a = (0.22 + 0.78 * max(dot(n, normalize(vec3(-0.45, 0.6, 0.66))), 0.0)) * (1.0 - smoothstep(0.86, 1.0, r2)); }
  gl_FragColor = vec4(vCol.rgb * a, 1.0);
}`;
const LINE_VS = `attribute vec3 aP; attribute float aA;
uniform mat4 uVP, uModel; varying float vA;
void main() { vA = aA; gl_Position = uVP * uModel * vec4(aP, 1.0); }`;
const LINE_FS = `precision mediump float;
varying float vA; uniform vec3 uColor;
void main() { gl_FragColor = vec4(uColor * vA, 1.0); }`;

// The names: a quad per label in CSS pixels, from the text texture (premultiplied).
const LABEL_VS = `attribute vec2 aP; attribute vec2 aUV; attribute float aA;
uniform vec2 uView; varying vec2 vUV; varying float vA;
void main() { vUV = aUV; vA = aA; gl_Position = vec4(aP.x / uView.x * 2.0 - 1.0, 1.0 - aP.y / uView.y * 2.0, 0.0, 1.0); }`;
const LABEL_FS = `precision mediump float;
uniform sampler2D uTex; varying vec2 vUV; varying float vA;
void main() { gl_FragColor = texture2D(uTex, vUV) * vA; }`;

// Unit directions spread evenly over the sphere (Fibonacci), turned by a seed so two cores never match.
function spread(n, R) {
  const out = [], turn = R() * TAU;
  for (let i = 0; i < n; i++) {
    const y = 1 - (i + 0.5) / n * 2, r = Math.sqrt(1 - y * y), a = i * 2.39996 + turn;
    out.push([Math.cos(a) * r, y * 0.8, Math.sin(a) * r]);
  }
  return out.map(d => { const l = Math.hypot(d[0], d[1], d[2]); return [d[0] / l, d[1] / l, d[2] / l]; });
}
const bez = (A, C, B, t) => { const u = 1 - t; return [0, 1, 2].map(i => u * u * A[i] + 2 * u * t * C[i] + t * t * B[i]); };

/**
 * Draws `data` (a project's scene) into `canvas`. Returns null without WebGL.
 * The caller drives it: size(), frame(now), drag(), release(), touch(id), found(id), complete(), screen(id), pick().
 */
export function createKit(canvas, data) {
  const opts = { alpha: false, antialias: true, depth: false, stencil: false, powerPreference: "low-power" };
  const gl = canvas.getContext("webgl2", opts) || canvas.getContext("webgl", opts);
  if (!gl) return null;
  const R = rng(data.seed || 7);
  const BG = data.background || [10 / 255, 7 / 255, 13 / 255];
  const cam = { distance: 4.9, fov: 36, pitch: 0.22, spin: 0.12, ...data.camera };

  // ---------- Parts ----------
  const parts = data.parts.map(p => ({ ...p, color: token(p.color), touched: -1e9, found: false }));
  const byId = new Map(parts.map(p => [p.id, p]));
  const shells = parts.filter(p => p.kind === "shell");
  const shell = shells[0];
  const shellR = shell ? shell.radius : 1;
  // Filaments of each core: a curve to its shell, then a straight reach beyond it, to a far point that lights
  // when the light gets there.
  for (const p of parts) {
    if (p.kind === "core") {
      p.back = token(p.backColor || "--sakura");
      p.paths = spread(p.reach || 6, R).map(d => {
        const A = [shellR * d[0], shellR * d[1], shellR * d[2]];
        const side = [d[1] * 0.4 - d[2] * 0.3, d[2] * 0.4 - d[0] * 0.3, d[0] * 0.3 - d[1] * 0.4];
        const C = [0, 1, 2].map(i => (p.at[i] + A[i]) / 2 + side[i] * 0.35);
        const far = d.map(v => v * shellR * (p.beyond || 1.42));
        return { A, C, far, lit: 0 };
      });
      p.idleAt = 2;
      p.packets = [];
    }
    if (p.kind === "cloud") {
      const n = p.points || 300, form = p.form || {};
      const ring = form.ring || p.radius * 0.66, tilt = form.tilt || 0.5, ct = Math.cos(tilt), st = Math.sin(tilt);
      p.loose = [];
      p.formed = [];
      for (let i = 0; i < n; i++) {
        // Loose: inside a ball, denser toward its centre. Formed: a ring (a lens), slightly thick, tilted.
        const r = p.radius * Math.cbrt(R()) * 0.95, a = R() * TAU, b = Math.acos(2 * R() - 1);
        p.loose.push([r * Math.sin(b) * Math.cos(a), r * Math.cos(b), r * Math.sin(b) * Math.sin(a), R() * TAU, 0.4 + R() * 0.9]);
        const t = i / n * TAU, w = (R() - 0.5) * ring * 0.16, h = (R() - 0.5) * ring * 0.16;
        const x = Math.cos(t) * (ring + w), y = h, z = Math.sin(t) * (ring + w);
        p.formed.push([x, y * ct - z * st, y * st + z * ct]);
      }
      p.gather = 0;
    }
  }

  // ---------- GL resources ----------
  const progShell = program(gl, SHELL_VS, SHELL_FS), progSprite = program(gl, SPRITE_VS, SPRITE_FS), progLine = program(gl, LINE_VS, LINE_FS);
  const progLabel = program(gl, LABEL_VS, LABEL_FS);
  const sphere = sphereMesh(36, 48);
  const sphereBuf = buffer(gl, sphere.pos), sphereIdx = indexBuffer(gl, sphere.idx);
  // Filaments: a static line list (the curve, then the reach), brighter near the core, fading out beyond the shell.
  const lineData = [];
  for (const p of parts) if (p.kind === "core") p.lineFirst = -1;
  for (const p of parts) if (p.kind === "core") for (const f of p.paths) {
    const S = 24;
    if (p.lineFirst < 0) p.lineFirst = lineData.length / 4;
    for (let i = 0; i < S; i++) {
      const a = bez(p.at, f.C, f.A, i / S), b = bez(p.at, f.C, f.A, (i + 1) / S);
      lineData.push(...a, 0.55 - 0.25 * i / S, ...b, 0.55 - 0.25 * (i + 1) / S);
    }
    lineData.push(...f.A, 0.3, ...f.far, 0.02);
    p.lineCount = lineData.length / 4 - p.lineFirst;
  }
  const lineCount = lineData.length / 4;
  const lineBuf = lineCount ? buffer(gl, new Float32Array(lineData)) : null;
  let spriteCap = 0, spriteArr = null, spriteBuf = null;
  const ensure = n => {
    if (n <= spriteCap) return;
    spriteCap = Math.ceil(n * 1.25);
    spriteArr = new Float32Array(spriteCap * 60);
    if (spriteBuf) gl.deleteBuffer(spriteBuf);
    spriteBuf = buffer(gl, spriteArr, gl.DYNAMIC_DRAW);
  };
  const CORNERS = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];
  let sn = 0;
  const spriteXYZ = (x, y, z, size, col, k, shape) => {
    if (k <= 0.002) return;
    const o = sn * 60;
    for (let v = 0; v < 6; v++) {
      const j = o + v * 10;
      spriteArr[j] = x; spriteArr[j + 1] = y; spriteArr[j + 2] = z;
      spriteArr[j + 3] = CORNERS[v * 2]; spriteArr[j + 4] = CORNERS[v * 2 + 1]; spriteArr[j + 5] = size; spriteArr[j + 6] = shape;
      spriteArr[j + 7] = col[0] * k; spriteArr[j + 8] = col[1] * k; spriteArr[j + 9] = col[2] * k;
    }
    sn++;
  };
  const sprite = (c, size, col, k, shape) => spriteXYZ(c[0], c[1], c[2], size, col, k, shape);
  const maxSprites = () => parts.reduce((s, p) => s + (p.kind === "cloud" ? p.loose.length + 2 : p.kind === "core" ? 4 + p.paths.length * 7 : p.kind === "link" ? 3 + (p.from || []).length * 13 : 3), 0) + 8;
  ensure(maxSprites());

  // ---------- View ----------
  const VP = mat4.create(), P = mat4.create(), V = mat4.create(), M = mat4.create();
  const eye = [0, 0, cam.distance];
  let W = 1, H = 1, dpr = 1;
  let yaw = data.camera?.yaw ?? 0.5, pitch = cam.pitch, vyaw = 0, vpitch = 0, held = false, quietUntil = 0;
  let lit = 0, litTarget = 0, completeAt = null, wave = -1, waveDir = [0, 0, 1], last = 0;

  function size(w, h) {
    W = Math.max(1, w); H = Math.max(1, h);
    // At most 1.6 million pixels drawn: the drawing buffer and its multisampling stay small (GPU memory on a phone).
    dpr = Math.min(2, window.devicePixelRatio || 1, Math.sqrt(1.6e6 / (W * H)));
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    // On a tall frame the sphere is held by the width: the field of view opens so the far points stay in.
    const aspect = W / H, fovY = cam.fov * Math.PI / 180, need = Math.atan(Math.tan(fovY / 2) / Math.min(1, aspect)) * 2;
    mat4.perspective(P, need, aspect, 0.1, 50);
    if (named) labels(named);
  }

  const project = (local, out) => {
    const w = mat4.apply(M, local);
    const x = VP[0] * w[0] + VP[4] * w[1] + VP[8] * w[2] + VP[12], y = VP[1] * w[0] + VP[5] * w[1] + VP[9] * w[2] + VP[13];
    const ww = VP[3] * w[0] + VP[7] * w[1] + VP[11] * w[2] + VP[15];
    out[0] = (x / ww * 0.5 + 0.5) * W; out[1] = (0.5 - y / ww * 0.5) * H; out[2] = ww; out[3] = w[2];
    return out;
  };
  const tmp = [0, 0, 0, 0];
  const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

  // ---------- Input ----------
  function drag(dx, dy) {
    held = true;
    vyaw = dx * 0.009; vpitch = dy * 0.006;
    yaw += vyaw; pitch = Math.max(-0.7, Math.min(0.95, pitch + vpitch));
    quietUntil = last + 4;
  }
  function release() { held = false; }

  function touch(id) {
    const p = byId.get(id);
    if (!p) return;
    p.touched = last;
    if (p.kind === "shell") {
      // The ring starts where the eye meets the glass: the eye's direction brought back into the scene.
      const e = [eye[0], eye[1], eye[2]], l = Math.hypot(...e);
      waveDir = [(M[0] * e[0] + M[1] * e[1] + M[2] * e[2]) / l, (M[4] * e[0] + M[5] * e[1] + M[6] * e[2]) / l, (M[8] * e[0] + M[9] * e[1] + M[10] * e[2]) / l];
      wave = 0;
    }
    if (p.kind === "core") p.paths.forEach((f, i) => p.packets.push({ f, t0: last + i * 0.06, k: 1 }));
  }
  // Each part found warms the glass a little; completion lights it once (frame()).
  function found(id) { const p = byId.get(id); if (p && !p.found) { p.found = true; litTarget += 0.12; } }
  function complete() { completeAt = last; }

  // ---------- Frame ----------
  function frame(now) {
    const t = now / 1000, dt = last ? Math.min(0.1, t - last) : 1 / 60;
    last = t;
    if (!held) {
      yaw += vyaw; pitch = Math.max(-0.7, Math.min(0.95, pitch + vpitch));
      vyaw *= Math.exp(-dt * 3.2); vpitch *= Math.exp(-dt * 3.2);
      if (t > quietUntil) yaw += cam.spin * dt;
      pitch += (cam.pitch - pitch) * (1 - Math.exp(-dt * 0.8));
    }
    // Completion: the glass lights up over 1.4 s and settles; one rise, never a flash (WCAG 2.3.1).
    const since = completeAt === null ? -1 : t - completeAt;
    const target = since < 0 ? litTarget : since < 1.4 ? litTarget + (1 - litTarget) * smooth(since / 1.4) : 1 - 0.35 * smooth(Math.min(1, (since - 1.4) / 4.6));
    lit += (target - lit) * (1 - Math.exp(-dt * 6));
    if (wave >= 0) { wave += dt / 1.5; if (wave >= 1) wave = -1; }

    mat4.model(M, [0, 0, 0], pitch, yaw, 0, 1);
    mat4.lookAt(V, eye, [0, 0, 0], [0, 1, 0]);
    mat4.multiply(VP, P, V);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(BG[0], BG[1], BG[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);

    // The back of the glass first (dim), then filaments and bodies, then its front.
    const drawShell = (face, cull) => {
      if (!shell) return;
      const s = progShell.finish();
      gl.useProgram(s.p);
      gl.enable(gl.CULL_FACE); gl.cullFace(cull);
      gl.uniformMatrix4fv(s.u.uVP, false, VP); gl.uniformMatrix4fv(s.u.uModel, false, M);
      gl.uniform1f(s.u.uR, shell.radius); gl.uniform3fv(s.u.uEye, eye); gl.uniform3fv(s.u.uColor, shell.color);
      gl.uniform3fv(s.u.uTouch, waveDir); gl.uniform1f(s.u.uLit, lit + (shell.found ? 0.08 : 0)); gl.uniform1f(s.u.uWave, wave); gl.uniform1f(s.u.uFace, face);
      attribs(gl, sphereBuf, [[s.a.aPos, 3]]);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sphereIdx);
      gl.drawElements(gl.TRIANGLES, sphere.idx.length, gl.UNSIGNED_SHORT, 0);
      gl.disable(gl.CULL_FACE);
    };
    // sphereMesh winds clockwise seen from outside: its far half faces the eye counter-clockwise (GL's front),
    // its near half clockwise. Culling BACK leaves the far half, culling FRONT the near one.
    drawShell(0.4, gl.BACK);

    if (lineBuf) {
      const l = progLine.finish();
      gl.useProgram(l.p);
      gl.uniformMatrix4fv(l.u.uVP, false, VP); gl.uniformMatrix4fv(l.u.uModel, false, M);
      attribs(gl, lineBuf, [[l.a.aP, 3], [l.a.aA, 1]]);
      // Each core's filaments in its own colour, brighter for a while after it is touched.
      for (const core of parts) {
        if (core.kind !== "core" || !core.lineCount) continue;
        const fresh = Math.max(0, 1 - (t - core.touched) / 1.8);
        gl.uniform3fv(l.u.uColor, core.color.map(v => v * (0.95 + 0.6 * fresh + (core.found ? 0.2 : 0))));
        gl.drawArrays(gl.LINES, core.lineFirst, core.lineCount);
      }
    }

    sn = 0;
    for (const p of parts) {
      const since = t - p.touched;
      if (p.kind === "core") {
        const pulse = since < 0.6 ? Math.sin(since / 0.6 * Math.PI) : 0;
        sprite(p.at, p.radius * (2.6 + pulse * 0.8), p.color, 0.3 + 0.2 * pulse, 0);
        sprite(p.at, p.radius * (0.62 + pulse * 0.08), mix(p.color, WHITE, 0.25), 1, 2);
        if (p.found) sprite(p.at, p.radius * 1.3, p.color, 0.5, 1);
        // Alive at rest: now and then a dim light goes out and back along one filament.
        if (t > p.idleAt) { p.idleAt = t + 2.6 + R() * 2.2; p.packets.push({ f: p.paths[Math.floor(R() * p.paths.length)], t0: t, k: 0.4 }); }
        p.packets = p.packets.filter(q => t - q.t0 < 2.1);
        for (const q of p.packets) {
          const u = t - q.t0;
          if (u < 0) continue;
          // Out (0.9 s): along the curve to the glass, then the reach to the far point; a breath there; back (0.9 s),
          // in the returning colour.
          let s, back = false;
          if (u < 0.9) s = u / 0.9; else if (u < 1.2) { s = 1; q.f.lit = Math.max(q.f.lit, q.k); } else { s = Math.max(0, 1 - (u - 1.2) / 0.9); back = true; }
          for (let k = 0; k < 4; k++) {
            const ss = Math.max(0, Math.min(1, s - (back ? -1 : 1) * k * 0.035));
            const pos = ss < 0.72 ? bez(p.at, q.f.C, q.f.A, ss / 0.72) : q.f.A.map((v, i) => v + (q.f.far[i] - v) * (ss - 0.72) / 0.28);
            sprite(pos, (0.05 - k * 0.008) * (q.k > 0.5 ? 1 : 0.75), back ? p.back : mix(p.color, WHITE, 0.4), q.k * (1 - k * 0.24), 0);
          }
        }
        for (const f of p.paths) {
          sprite(f.far, 0.05 + f.lit * 0.05, mix(p.color, WHITE, 0.3), 0.16 + f.lit * 0.9, 0);
          f.lit *= Math.exp(-dt * 1.6);
        }
      }
      if (p.kind === "cloud") {
        // Gathering: up toward `hold` in 0.9 s, kept 1.4 s, let go in 1.8 s; at rest it barely leans toward the form.
        const g = since < 0.9 ? smooth(since / 0.9) : since < 2.3 ? 1 : since < 4.1 ? 1 - smooth((since - 2.3) / 1.8) : 0;
        p.gather = 0.1 + g * ((p.hold ?? 0.8) - 0.1);
        const col = p.light || (p.light = mix(p.color, WHITE, 0.25));
        for (let i = 0; i < p.loose.length; i++) {
          const L = p.loose[i], F = p.formed[i], ph = L[3], sp = L[4];
          const dx = Math.sin(t * 0.5 * sp + ph) * 0.03, dy = Math.cos(t * 0.43 * sp + ph * 1.3) * 0.03;
          const x = L[0] + dx + (F[0] - L[0] - dx) * p.gather, y = L[1] + dy + (F[1] - L[1] - dy) * p.gather, z = L[2] + (F[2] - L[2]) * p.gather;
          const tw = 0.55 + 0.45 * Math.sin(t * 1.7 * sp + ph * 3);
          spriteXYZ(p.at[0] + x, p.at[1] + y, p.at[2] + z, 0.022, col, (0.35 + 0.4 * g) * tw, 0);
        }
        if (p.found) sprite(p.at, p.radius * 1.25, p.color, 0.35, 1);
      }
      if (p.kind === "plate") {
        // Declared: a fixed ring round a full ball, nothing going out to check it. At rest it never pulses; touched,
        // the ring rises once (0.5 s) and settles (1 s): said, not read.
        const up = since < 0.5 ? smooth(since / 0.5) : since < 1.5 ? 1 - smooth((since - 0.5) / 1) : 0;
        sprite(p.at, p.radius * 2.2, p.color, 0.22 + 0.25 * up, 0);
        sprite(p.at, p.radius * (1 + 0.08 * up), p.color, 0.75 + 0.25 * up, 1);
        sprite(p.at, p.radius * 0.42, mix(p.color, WHITE, 0.25), 0.9, 2);
        if (p.found) sprite(p.at, p.radius * 1.5, p.color, 0.3, 1);
      }
      if (p.kind === "link") {
        // Inferred: a small ball tied to its sources by faint fixed dots (deduced, not read). Touched, a light leaves
        // each source in its colour along the dots (0.9 s); when they arrive the ball lights (0.4 s) and settles.
        const src = (p.from || []).map(id => byId.get(id)).filter(Boolean);
        for (const q of src) for (let k = 1; k < 13; k++) {
          const u = k / 13;
          spriteXYZ(q.at[0] + (p.at[0] - q.at[0]) * u, q.at[1] + (p.at[1] - q.at[1]) * u, q.at[2] + (p.at[2] - q.at[2]) * u, 0.016, mix(q.color, p.color, u), 0.32, 0);
        }
        if (since < 0.9) for (const q of src) {
          const u = smooth(since / 0.9);
          spriteXYZ(q.at[0] + (p.at[0] - q.at[0]) * u, q.at[1] + (p.at[1] - q.at[1]) * u, q.at[2] + (p.at[2] - q.at[2]) * u, 0.05, mix(q.color, WHITE, 0.4), 0.9, 0);
        }
        const on = since < 0.9 ? 0 : since < 1.3 ? smooth((since - 0.9) / 0.4) : since < 2.5 ? 1 - smooth((since - 1.3) / 1.2) : 0;
        sprite(p.at, p.radius * (2.2 + 0.6 * on), p.color, 0.18 + 0.3 * on, 0);
        sprite(p.at, p.radius * 0.6, mix(p.color, WHITE, 0.2 + 0.3 * on), 0.7 + 0.3 * on, 2);
        if (p.found) sprite(p.at, p.radius * 1.4, p.color, 0.3, 1);
      }
    }
    if (sn) {
      const s = progSprite.finish();
      gl.useProgram(s.p);
      gl.uniformMatrix4fv(s.u.uVP, false, VP); gl.uniformMatrix4fv(s.u.uModel, false, M);
      gl.uniform2f(s.u.uF, P[0], P[5]);
      gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, spriteArr.subarray(0, sn * 60));
      attribs(gl, spriteBuf, [[s.a.aC, 3], [s.a.aQ, 4], [s.a.aCol, 3]]);
      gl.drawArrays(gl.TRIANGLES, 0, sn * 6);
    }
    drawShell(1, gl.FRONT);
    unstack(dt);
    drawLabels();
    return true;
  }

  // ---------- Names ----------
  // labels(list): [{ id, name, state, stateColor, found, focus }] — the text of the part's button, drawn as the button
  // is in the still drawing: a diamond (filled once found), the name, the state; a thin gold frame while focused.
  let atlas = null, labelTex = null, labelBuf = null, labelArr = new Float32Array(0), boxes = [];
  const BGCSS = getComputedStyle(document.body).getPropertyValue("--bg").trim() || "#06040b";
  const GOLD = (() => { try { return getComputedStyle(document.body).getPropertyValue("--acc-aether").trim() || "#ffd25a"; } catch { return "#ffd25a"; } })();
  let named = null;
  function labels(list) {
    named = list;
    const k = dpr, c = atlas || (atlas = document.createElement("canvas")), x = c.getContext("2d");
    const font = (px) => `400 ${px * k}px "JetBrains Mono", ui-monospace, Consolas, monospace`;
    const spaced = (px) => { if ("letterSpacing" in x) x.letterSpacing = (0.14 * px * k).toFixed(2) + "px"; };
    const measure = (t, px) => { x.font = font(px); spaced(px); return x.measureText(t).width / k; };
    boxes = list.map(l => {
      const w = Math.ceil(Math.max(44, measure(l.name.toUpperCase(), 11), l.state ? measure(l.state, 10) : 0) + 16);
      const h = Math.ceil(12 + 7 + 3 + 14 + (l.state ? 3 + 13 : 0));
      return { ...l, w, h };
    });
    const AW = Math.ceil(Math.max(...boxes.map(b => b.w)) * k) + 4, AH = Math.ceil(boxes.reduce((s, b) => s + b.h, 0) * k) + 4 * boxes.length;
    c.width = AW; c.height = AH;
    x.clearRect(0, 0, AW, AH);
    let y0 = 0;
    for (const b of boxes) {
      b.u0 = 0; b.v0 = y0 / AH; b.u1 = b.w * k / AW; b.v1 = (y0 + b.h * k) / AH;
      const cx = b.w * k / 2;
      x.save(); x.translate(0, y0);
      if (b.focus) { x.strokeStyle = GOLD; x.lineWidth = k; x.strokeRect(k * 1.5, k * 1.5, b.w * k - 3 * k, b.h * k - 3 * k); }
      // The diamond: an outline, filled gold once the part is found.
      x.save(); x.translate(cx, (6 + 3.5) * k); x.rotate(Math.PI / 4);
      x.lineWidth = k; x.strokeStyle = b.found ? GOLD : "rgba(246,238,242,.7)"; x.strokeRect(-2.5 * k, -2.5 * k, 5 * k, 5 * k);
      if (b.found) { x.fillStyle = GOLD; x.fillRect(-2.5 * k, -2.5 * k, 5 * k, 5 * k); }
      x.restore();
      x.textAlign = "center"; x.textBaseline = "middle";
      const line = (t, px, color, ty) => {
        x.font = font(px); spaced(px);
        // A dark halo under the text, as on the page (text-shadow), so a name stays legible over the glass.
        x.shadowColor = BGCSS; x.shadowBlur = 6 * k; x.fillStyle = BGCSS; x.fillText(t, cx, ty); x.fillText(t, cx, ty);
        x.shadowBlur = 0; x.fillStyle = color; x.fillText(t, cx, ty);
      };
      line(b.name.toUpperCase(), 11, "#f6eef2", (6 + 7 + 3 + 7) * k);
      if (b.state) line(b.state, 10, b.stateColor || "#c4abbb", (6 + 7 + 3 + 14 + 3 + 6.5) * k);
      x.restore();
      y0 += b.h * k + 4;
    }
    if (!labelTex) labelTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, labelTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (labelArr.length < boxes.length * 30) { labelArr = new Float32Array(boxes.length * 30); if (labelBuf) gl.deleteBuffer(labelBuf); labelBuf = buffer(gl, labelArr, gl.DYNAMIC_DRAW); }
  }
  const at4 = [0, 0, 0];
  function drawLabels() {
    if (!boxes.length || !labelTex) return;
    let n = 0;
    for (const b of boxes) {
      if (!screen(b.id, at4)) continue;
      // Snapped to device pixels: the text stays as sharp as the page's.
      const x0 = Math.round((at4[0] - b.w / 2) * dpr) / dpr, y0 = Math.round((at4[1] - b.h / 2) * dpr) / dpr, x1 = x0 + b.w, y1 = y0 + b.h;
      const a = at4[2] ? 0.8 : 1; // behind the centre: dimmed, its small state text still 4.5:1 or more
      const q = [x0, y0, b.u0, b.v0, x1, y0, b.u1, b.v0, x1, y1, b.u1, b.v1, x0, y0, b.u0, b.v0, x1, y1, b.u1, b.v1, x0, y1, b.u0, b.v1];
      for (let v = 0; v < 6; v++) { const o = n * 30 + v * 5; labelArr[o] = q[v * 4]; labelArr[o + 1] = q[v * 4 + 1]; labelArr[o + 2] = q[v * 4 + 2]; labelArr[o + 3] = q[v * 4 + 3]; labelArr[o + 4] = a; }
      n++;
    }
    const l = progLabel.finish();
    gl.useProgram(l.p);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform2f(l.u.uView, W, H);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, labelTex); gl.uniform1i(l.u.uTex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, labelBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, labelArr.subarray(0, n * 30));
    attribs(gl, labelBuf, [[l.a.aP, 2], [l.a.aUV, 2], [l.a.aA, 1]]);
    gl.drawArrays(gl.TRIANGLES, 0, n * 6);
    gl.blendFunc(gl.ONE, gl.ONE);
  }

  // ---------- Page side ----------
  /** The CSS position of a part's button (its anchor), and whether the part is behind the scene's centre. */
  function screen(id, out = [0, 0, 0]) {
    if (!rawScreen(id, out)) return null;
    out[1] += nudge.get(id) || 0;
    return out;
  }
  function rawScreen(id, out) {
    const p = byId.get(id);
    if (!p) return null;
    project(add3(p.at || [0, 0, 0], p.label || [0, 0, 0]), tmp);
    out[0] = tmp[0]; out[1] = tmp[1]; out[2] = tmp[3] < -0.05 ? 1 : 0;
    return out;
  }
  // Names never sit on one another: as the scene turns, two names that would overlap are drawn apart vertically,
  // each by half the overlap, eased (no jump); the buttons follow the same places (screen()).
  const nudge = new Map(), want = new Map();
  function unstack(dt) {
    const L = boxes.map(b => { const o = rawScreen(b.id, [0, 0, 0]); return o && { id: b.id, x: o[0], y: o[1], w: b.w, h: b.h, d: 0 }; }).filter(Boolean).sort((a, b) => a.y - b.y);
    for (let pass = 0; pass < 3; pass++) for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j];
      if (Math.abs(a.x - b.x) >= (a.w + b.w) / 2 - 4) continue;
      const over = (a.h + b.h) / 2 - 2 - ((b.y + b.d) - (a.y + a.d));
      if (over > 0) { a.d -= over / 2; b.d += over / 2; }
    }
    for (const l of L) want.set(l.id, l.d);
    for (const b of boxes) { const n = nudge.get(b.id) || 0; nudge.set(b.id, n + ((want.get(b.id) || 0) - n) * (1 - Math.exp(-dt * 8))); }
  }
  /** The part under a point (CSS px): bodies before the glass that holds them. */
  function pick(x, y) {
    let best = null, bestD = Infinity;
    for (const p of parts) {
      if (p.kind === "shell") continue;
      project(p.at, tmp);
      const r = Math.max(26, (p.kind === "core" ? p.radius * 2.4 : p.radius) * P[5] / tmp[2] * H / 2);
      const d = Math.hypot(x - tmp[0], y - tmp[1]);
      if (d < r && d < bestD) { best = p.id; bestD = d; }
    }
    if (best || !shell) return best;
    project([0, 0, 0], tmp);
    const r = shell.radius * P[5] / tmp[2] * H / 2;
    return Math.hypot(x - tmp[0], y - tmp[1]) < r ? shell.id : null;
  }
  function destroy() {
    try { gl.getExtension("WEBGL_lose_context")?.loseContext(); } catch {}
  }
  return { size, frame, drag, release, touch, found, complete, screen, pick, labels, destroy, gl };
}
