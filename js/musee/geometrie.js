// The museum's geometry helpers, pure (no DOM, no GL: they play under Node). They fill flat arrays the way rendu.js
// reads them: `solid` and `glass` take 10 floats per vertex (position, normal, colour, emission), `lines` 7 per vertex
// (position, colour, strength). rendu.js imports them; the effects that follow import them from here, so
// they never need to reopen rendu.js.
const TAU = Math.PI * 2;

export function quad(out, a, b, c, d, n, col, e) {
  for (const p of [a, b, c, a, c, d]) out.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2], e);
}
/** A box between two corners, its five visible faces (no bottom). */
export function box(out, x0, y0, z0, x1, y1, z1, col, e = 0) {
  quad(out, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], col, e);
  quad(out, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], col, e);
  quad(out, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], col, e);
  quad(out, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], col, e);
  quad(out, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], col, e);
}
/** A box given by its centre and its three axes (half sizes included): for what turns (a book in the hand). */
export function boite(out, c, ax, ay, az, col, e = 0) {
  const P = (i, j, k) => [c[0] + ax[0] * i + ay[0] * j + az[0] * k, c[1] + ax[1] * i + ay[1] * j + az[1] * k, c[2] + ax[2] * i + ay[2] * j + az[2] * k];
  const N = (v, s) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l * s, v[1] / l * s, v[2] / l * s]; };
  quad(out, P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), N(ay, 1), col, e);
  quad(out, P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), N(ay, -1), col, e);
  quad(out, P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), N(az, 1), col, e);
  quad(out, P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), N(az, -1), col, e);
  quad(out, P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), N(ax, 1), col, e);
  quad(out, P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), N(ax, -1), col, e);
}
/** One quad cut into nu x nv tiles (a to b is the first direction, a to d the second); the same normal and colour. */
function carreaux(out, a, b, c, d, n, col, e, nu, nv) {
  const at = (u, v) => {
    const s = 1 - v;
    return [0, 1, 2].map(i => (a[i] * (1 - u) + b[i] * u) * s + (d[i] * (1 - u) + c[i] * u) * v);
  };
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const u0 = i / nu, u1 = (i + 1) / nu, v0 = j / nv, v1 = (j + 1) / nv;
    quad(out, at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1), n, col, e);
  }
}
/**
 * A wall along a centre line, `t` thick, from y0 to y1. `pas` (optional, a length in metres, kept between 0.5 and 1):
 * the faces are cut into tiles of about that size, so that a colour per vertex can follow the light along them; absent,
 * the wall is the five quads of before. No caller cuts a wall yet: kept for a later lot, tested on its own.
 */
export function wall(out, x0, z0, x1, z1, y0, y1, t, col, pas) {
  const L = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / L, dz = (z1 - z0) / L, nx = -dz * t / 2, nz = dx * t / 2;
  const P = (x, z, s, y) => [x + nx * s, y, z + nz * s];
  const faces = [
    [P(x0, z0, 1, y0), P(x1, z1, 1, y0), P(x1, z1, 1, y1), P(x0, z0, 1, y1), [-dz, 0, dx]],
    [P(x1, z1, -1, y0), P(x0, z0, -1, y0), P(x0, z0, -1, y1), P(x1, z1, -1, y1), [dz, 0, -dx]],
    [P(x0, z0, -1, y1), P(x0, z0, 1, y1), P(x1, z1, 1, y1), P(x1, z1, -1, y1), [0, 1, 0]],
    [P(x0, z0, -1, y0), P(x0, z0, 1, y0), P(x0, z0, 1, y1), P(x0, z0, -1, y1), [-dx, 0, -dz]],
    [P(x1, z1, 1, y0), P(x1, z1, -1, y0), P(x1, z1, -1, y1), P(x1, z1, 1, y1), [dx, 0, dz]],
  ];
  const k = Number.isFinite(pas) && pas > 0 ? Math.min(1, Math.max(0.5, pas)) : 0;
  if (!k) { for (const [a, b, c, d, n] of faces) quad(out, a, b, c, d, n, col, 0); return; }
  const nL = Math.max(1, Math.ceil(L / k - 1e-9)), nH = Math.max(1, Math.ceil(Math.abs(y1 - y0) / k - 1e-9));
  // The two long faces: along the wall and up; the top: along the wall; the two ends: up.
  const cuts = [[nL, nH], [nL, nH], [1, nL], [1, nH], [1, nH]];
  faces.forEach(([a, b, c, d, n], i) => carreaux(out, a, b, c, d, n, col, 0, cuts[i][0], cuts[i][1]));
}
export function cylinder(out, cx, cz, r, y0, y1, col, seg = 40) {
  for (let i = 0; i < seg; i++) {
    const a = i / seg * TAU, b = (i + 1) / seg * TAU;
    const pa = [cx + Math.cos(a) * r, cz + Math.sin(a) * r], pb = [cx + Math.cos(b) * r, cz + Math.sin(b) * r];
    const m = (a + b) / 2;
    quad(out, [pa[0], y0, pa[1]], [pb[0], y0, pb[1]], [pb[0], y1, pb[1]], [pa[0], y1, pa[1]], [Math.cos(m), 0, Math.sin(m)], col, 0);
    for (const p of [[cx, y1, cz], [pb[0], y1, pb[1]], [pa[0], y1, pa[1]]]) out.push(p[0], p[1], p[2], 0, 1, 0, col[0], col[1], col[2], 0);
  }
}
export const line = (out, a, b, col, k) => out.push(a[0], a[1], a[2], col[0], col[1], col[2], k, b[0], b[1], b[2], col[0], col[1], col[2], k);
export function circle(out, cx, y, cz, r, col, k, seg = 64) {
  for (let i = 0; i < seg; i++) {
    const a = i / seg * TAU, b = (i + 1) / seg * TAU;
    line(out, [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r], [cx + Math.cos(b) * r, y, cz + Math.sin(b) * r], col, k);
  }
}
/** A vertical rectangle of light: from (x0, z0) to (x1, z1), y0..y1. */
export function frameLines(out, x0, z0, x1, z1, y0, y1, col, k) {
  line(out, [x0, y0, z0], [x0, y1, z0], col, k); line(out, [x1, y0, z1], [x1, y1, z1], col, k);
  line(out, [x0, y1, z0], [x1, y1, z1], col, k); line(out, [x0, y0, z0], [x1, y0, z1], col, k);
}
/** The outline of a rectangle on the floor (or at any height). */
export function rectLines(out, x0, z0, x1, z1, y, col, k) {
  line(out, [x0, y, z0], [x1, y, z0], col, k); line(out, [x1, y, z0], [x1, y, z1], col, k);
  line(out, [x1, y, z1], [x0, y, z1], col, k); line(out, [x0, y, z1], [x0, y, z0], col, k);
}
/** A long line cut in two at the space nearest its middle. */
export function enDeux(t, max = 22) {
  if (!t) return [];
  if (t.length <= max) return [t];
  let best = -1;
  for (let i = 0; i < t.length; i++) if (t[i] === " " && (best < 0 || Math.abs(i - t.length / 2) < Math.abs(best - t.length / 2))) best = i;
  return best < 0 ? [t] : [t.slice(0, best), t.slice(best + 1)];
}
