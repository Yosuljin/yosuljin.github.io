// The walk (D168): like a video game. The keys under the left hand — ZQSD on a French keyboard, WASD elsewhere: the
// same keys, read by their place (KeyboardEvent.code) — move and step aside; the arrows walk and turn; Shift runs.
// The mouse looks around once a click has locked it (Échap gives it back); without the lock, a drag looks. The lock is
// offered only where Escape can give the mouse back without ending the fullscreen too (`verrouillable`, musee.js). On a
// touch screen, a stick under the left thumb walks and a swipe on the right looks. Walls and closed doors stop the
// visitor, who slides along them; plinths and the map's table too.
import { MURS, PORTES, OEUVRES, MEUBLES, EPAISSEUR } from "./batiment.js?v=20261025-r28";

const RAYON = 0.32, MARCHE = 2.5, COURSE = 4.3, OEIL = 1.62, TOURNE = 1.9;
const AVANT = new Set(["KeyW", "ArrowUp"]), ARRIERE = new Set(["KeyS", "ArrowDown"]), GAUCHE = new Set(["KeyA"]), DROITE = new Set(["KeyD"]);
const root = document.documentElement;

export function createMarche(stage, { verrouillable = () => true } = {}) {
  const j = { x: 0, z: 9.6, yaw: 0, pitch: 0, vx: 0, vz: 0 };
  const touches = new Set();
  const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  let look = null, actif = true;
  // What stops the walk: the walls, a closed door, the furniture's edges (a rectangle is four short walls), and
  // round what stands on the floor (plinths, the map's table, the chair).
  const bords = ([x0, z0, x1, z1]) => [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]];
  const segments = [...MURS, ...PORTES.filter(p => !p.ouverte).map(p => [p.x0, p.z0, p.x1, p.z1]), ...Object.values(MEUBLES).flatMap(bords)];
  const cercles = OEUVRES.filter(o => o.r > 0).map(o => [o.x, o.z, o.r + (o.type === "carte" ? 0 : 0.1)]);
  const listeners = { stick: null, regard: null };

  const regarder = (dx, dy, k) => {
    j.yaw -= dx * k;
    j.pitch = Math.max(-1.25, Math.min(1.25, j.pitch - dy * k));
  };

  // ---------- Keyboard ----------
  const typing = e => e.target?.closest?.("input, textarea, select, [contenteditable]");
  addEventListener("keydown", e => {
    // The site's menu, open over the museum, has the keys.
    if (!actif || typing(e) || e.ctrlKey || e.metaKey || e.altKey || root.classList.contains("menu-open")) return;
    if (/^(Key[WASD]|Arrow(Up|Down|Left|Right)|Shift(Left|Right))$/.test(e.code)) {
      touches.add(e.code);
      if (e.code.startsWith("Arrow")) e.preventDefault();   // the arrows walk, they do not scroll the page
    }
  });
  addEventListener("keyup", e => touches.delete(e.code));
  addEventListener("blur", () => touches.clear());

  // ---------- Mouse: the pointer locked by a click; a drag without it ----------
  const verrouille = () => document.pointerLockElement === stage;
  const verrouiller = () => {
    if (!actif || verrouille() || !verrouillable()) return;
    try { const r = stage.requestPointerLock?.(); r?.catch?.(() => {}); } catch {}
  };
  // A press on the view captures the pointer on the stage (below), so the click lands on the stage, not on the canvas:
  // both are the view. A drag that looked around is not a click to lock.
  let appui = null;
  stage.addEventListener("pointerdown", e => { appui = { x: e.clientX, y: e.clientY }; }, true);
  stage.addEventListener("click", e => {
    const canevas = stage.querySelector("canvas");
    if ((e.target === stage || e.target === canevas) && e.pointerType !== "touch" && (!appui || Math.hypot(e.clientX - appui.x, e.clientY - appui.y) < 8)) verrouiller();
  });
  addEventListener("mousemove", e => { if (actif && verrouille()) regarder(e.movementX, e.movementY, 0.0022); });

  // ---------- Pointers: a drag looks; on a touch screen, the left of the screen is the stick ----------
  stage.addEventListener("pointerdown", e => {
    if (!actif || e.target !== stage.querySelector("canvas")) return;
    const r = stage.getBoundingClientRect();
    if (e.pointerType === "touch" && e.clientX - r.left < r.width * 0.45 && stick.id === null) {
      stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY; stick.x = stick.y = 0;
      listeners.stick?.(true, e.clientX - r.left, e.clientY - r.top, 0, 0);
    } else if (!verrouille() && look === null) {
      look = { id: e.pointerId, x: e.clientX, y: e.clientY, k: e.pointerType === "touch" ? 0.0052 : 0.0034 };
      listeners.regard?.();
    } else return;
    try { stage.setPointerCapture(e.pointerId); } catch {}
  });
  stage.addEventListener("pointermove", e => {
    if (e.pointerId === stick.id) {
      const R = 52, dx = e.clientX - stick.ox, dy = e.clientY - stick.oy, l = Math.hypot(dx, dy), s = l > R ? R / l : 1;
      stick.x = dx * s / R; stick.y = dy * s / R;
      const r = stage.getBoundingClientRect();
      listeners.stick?.(true, stick.ox - r.left, stick.oy - r.top, dx * s, dy * s);
    } else if (look && e.pointerId === look.id) {
      regarder(e.clientX - look.x, e.clientY - look.y, look.k);
      look.x = e.clientX; look.y = e.clientY;
    }
  });
  const fin = e => {
    if (e.pointerId === stick.id) { stick.id = null; stick.x = stick.y = 0; listeners.stick?.(false); }
    if (look && e.pointerId === look.id) look = null;
  };
  stage.addEventListener("pointerup", fin);
  stage.addEventListener("pointercancel", fin);

  // ---------- Walls ----------
  function pousser() {
    for (let pass = 0; pass < 2; pass++) {
      for (const [x0, z0, x1, z1] of segments) {
        const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz;
        const t = Math.max(0, Math.min(1, ((j.x - x0) * dx + (j.z - z0) * dz) / L2));
        const cx = x0 + dx * t, cz = z0 + dz * t, ex = j.x - cx, ez = j.z - cz, d = Math.hypot(ex, ez), min = RAYON + EPAISSEUR / 2;
        if (d < min && d > 1e-6) { j.x = cx + ex / d * min; j.z = cz + ez / d * min; }
      }
      for (const [cx, cz, r] of cercles) {
        const ex = j.x - cx, ez = j.z - cz, d = Math.hypot(ex, ez), min = r + RAYON;
        if (d < min && d > 1e-6) { j.x = cx + ex / d * min; j.z = cz + ez / d * min; }
      }
    }
  }

  /** One step of the walk; returns true while the visitor moves (the drawing then needs frames). */
  function avancer(dt) {
    const k = c => touches.has(c);
    const any = set => [...set].some(k);
    if (actif) j.yaw += ((k("ArrowLeft") ? 1 : 0) - (k("ArrowRight") ? 1 : 0)) * TOURNE * dt;
    let fwd = (any(AVANT) ? 1 : 0) - (any(ARRIERE) ? 1 : 0) - stick.y, side = (any(DROITE) ? 1 : 0) - (any(GAUCHE) ? 1 : 0) + stick.x;
    if (!actif) fwd = side = 0;
    const l = Math.hypot(fwd, side);
    if (l > 1) { fwd /= l; side /= l; }
    const v = k("ShiftLeft") || k("ShiftRight") ? COURSE : MARCHE;
    const fx = -Math.sin(j.yaw), fz = -Math.cos(j.yaw), rx = Math.cos(j.yaw), rz = -Math.sin(j.yaw);
    const tx = (fx * fwd + rx * side) * v, tz = (fz * fwd + rz * side) * v, a = 1 - Math.exp(-dt * 10);
    j.vx += (tx - j.vx) * a; j.vz += (tz - j.vz) * a;
    j.x += j.vx * dt; j.z += j.vz * dt;
    pousser();
    return Math.hypot(j.vx, j.vz) > 0.01 || touches.size > 0 || stick.id !== null || look !== null;
  }

  return {
    joueur: j,
    camera: () => ({ x: j.x, y: OEIL, z: j.z, yaw: j.yaw, pitch: j.pitch }),
    avancer,
    /** Puts the visitor somewhere at once (the plan, a link #salle): no inertia carried over. */
    teleporter(x, z, cap = 0) { j.x = x; j.z = z; j.yaw = cap; j.pitch = 0; j.vx = j.vz = 0; pousser(); },
    set actif(v) { actif = v; if (!v) { touches.clear(); stick.id = null; stick.x = stick.y = 0; look = null; listeners.stick?.(false); if (verrouille()) document.exitPointerLock?.(); } },
    get actif() { return actif; },
    get verrouille() { return verrouille(); },
    /** Asks for the mouse (the press that enters the museum is one: the browser grants it to nothing else). */
    verrouiller,
    surStick(fn) { listeners.stick = fn; },
    /** Called when a drag starts looking around. */
    surRegard(fn) { listeners.regard = fn; },
  };
}
