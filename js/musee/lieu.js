// The place in data: the height of each room, its volume, the depth of a threshold, the air of each room. The single source
// of what the image and the sound share (IMMERSION-musee.md, I1): the day the image and the sound read it, no other module
// will have its own height, its own threshold or its own fog. Until then acoustique.js keeps a copy of HAUTEURS and VOLUMES
// (test.mjs of this lot compares them) and its own door weights (poidsSalles, a 1.5 m fade where seuil() has 2.25 m), to be
// replaced by seuil() in the lot of the sound that reads this file; rendu.js keeps BG, DENS and MURS_HAUT. Pure: no DOM, no
// GL, no clock, so Node can play it. Nothing reads it yet; the lots that follow do (the ceiling in rendu.js, the air with
// the light, the volumes and the reverberation in acoustique.js).
// Units are metres, x to the east, z to the south, y up, the floor at y = 0.
//
// Wiring rendu.js, with the lot of the ceiling and not before the proofs on the real GPU of the third round have been replayed.
// The heights below are for tiers 1 and 2 ONLY: at tier 0 the picture of today stays, MURS_HAUT for every wall and every lintel,
// 0.042 and BG for the air (airPlat()). Tiers 1 and 2, all of it, so that the image and the lintels agree:
//   - the wall loop (`for (const [x0, z0, x1, z1] of MURS)`, the call wall(solid, x0, z0, x1, z1, 0, MURS_HAUT, ...)) and the
//     lit line at the top of each wall (MURS_HAUT - 0.02) take HAUTEURS_MURS[i] (the loop becomes a forEach with its index);
//   - the lintels (wall(solid, p.x0, ..., PORTE_HAUT, MURS_HAUT, ...)) take HAUTEURS_PORTES[i]; the door's frame stays at PORTE_HAUT;
//   - whatever hangs from or sits on the ceiling (the lamps' cords, the piece above the hall) reads hauteurSalle(id), and the
//     api's hauteur(id) answers hauteurSalle(id); MURS_HAUT stays only as the fallback of an unknown id;
//   - the air of each room is NOT part of this wiring: it is put off and wired with the light. When it is: ONE density and ONE
//     fog colour per frame, read once (airEn(eye.x, eye.z, teintes, SORTIE_AIR)), then used by uDens, uFog, the clear colour
//     AND the fades of the signs and of the images (the two Math.exp(-DENS * DENS * d * d)), so that the signs go out at the
//     same range as the geometry;
//   - the lowest tier (tier 0, no define) calls airPlat(), NOT airEn without tints: airPlat() is today's air (0.042, BG).
// On a hot path (once per frame, and the sound reads the same) pass the last argument (a work object made once, with an array
// `fog` of its own: const SORTIE_AIR = { dens: 0, fog: [0, 0, 0] }, never a copy of AIR_AUJOURDHUI or of airPlat()'s answer,
// whose `fog` is the frozen BG): without it the functions allocate their answer; with it, they allocate nothing.
import { SALLES, MURS, PORTES, MURS_HAUT } from "./batiment.js?v=20261025-r28";
import { BG } from "./matieres.js?v=20261025-r28";

/** Smoothstep on [0, 1]: 0 below, 1 above, its slope nil at both ends. */
export const lisse = t => { const k = t <= 0 ? 0 : t >= 1 ? 1 : t; return k * k * (3 - 2 * k); };

// A table is read by its own keys only: an id like "constructor" or "toString" is no room (it would answer a function).
const possede = (table, id) => typeof id === "string" && Object.prototype.hasOwnProperty.call(table, id);

// ---------- Heights (taste choice 6): the hall 5.6 m, Aether 7.0 m, the four side rooms 3.2 m ----------
export const HAUTEURS = Object.freeze({ hall: 5.6, aether: 7.0, jeux: 3.2, mondes: 3.2, photographie: 3.2, ecriture: 3.2 });

/** The height of a room's ceiling (the old walls' height for an id the table does not know). */
export const hauteurSalle = id => possede(HAUTEURS, id) ? HAUTEURS[id] : MURS_HAUT;

/** The id of the room a point is in (the walls' lines included, as salleEn of batiment.js), or null; no allocation. */
function salleDe(x, z) {
  for (let i = 0; i < SALLES.length; i++) { const s = SALLES[i]; if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return s.id; }
  return null;
}

/** The room (its id) a point is strictly inside, or null: the walls' lines belong to none. */
const salleStricte = (x, z) => { const s = SALLES.find(e => x > e.x0 && x < e.x1 && z > e.z0 && z < e.z1); return s ? s.id : null; };

/**
 * The height of a wall [x0, z0, x1, z1]: that of the tallest room it touches on either side (an outer wall: that of its
 * room). Read along the whole wall, at half a metre from its line, so a long wall between two rooms takes the taller.
 * Also takes the wall as one array, hauteurMur(MURS[3]), or as an object with x0, z0, x1, z1 (a door of PORTES:
 * hauteurMur(PORTES[i])). A number that is not one (NaN, undefined, a null, a string) throws. It answers the old 4.2 (MURS_HAUT)
 * only for a wall of no length or a wall that touches no room; no wall of the plan is either.
 */
export function hauteurMur(x0, z0, x1, z1) {
  if (Array.isArray(x0)) [x0, z0, x1, z1] = x0;
  else if (x0 !== null && typeof x0 === "object") ({ x0, z0, x1, z1 } = x0);
  if (![x0, z0, x1, z1].every(Number.isFinite)) throw new TypeError("hauteurMur: needs a wall [x0, z0, x1, z1], an object { x0, z0, x1, z1 } or four finite numbers");
  const L = Math.hypot(x1 - x0, z1 - z0);
  if (!(L > 0)) return MURS_HAUT;
  const n = Math.max(1, Math.ceil(L / 0.5)), nx = -(z1 - z0) / L, nz = (x1 - x0) / L, ECART = 0.5;
  let haut = -1;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t;
    for (const side of [1, -1]) {
      const id = salleStricte(px + nx * ECART * side, pz + nz * ECART * side);
      if (id) haut = Math.max(haut, hauteurSalle(id));
    }
  }
  return haut < 0 ? MURS_HAUT : haut;
}

/** The height of each wall of batiment.js, in the same order as MURS (rendu.js draws each at its height). */
export const HAUTEURS_MURS = Object.freeze(MURS.map(m => hauteurMur(m)));

/**
 * The height of the wall each door stands in, in the same order as PORTES: 7.0 for Aether's, 5.6 for the four side doors
 * (the hall's side is the taller). The lintel over a door (rendu.js: from PORTE_HAUT up) rises to this height, so that no gap
 * stays open between it and the wall beside it. The door's own frame (its lines) stays at PORTE_HAUT.
 */
export const HAUTEURS_PORTES = Object.freeze(PORTES.map(p => hauteurMur(p.x0, p.z0, p.x1, p.z1)));

// ---------- Volumes (the inside of each room, in cubic metres; the sound reads them) ----------
export const VOLUMES = Object.freeze(Object.fromEntries(SALLES.map(s => [s.id, Math.round((s.x1 - s.x0) * (s.z1 - s.z0) * hauteurSalle(s.id) * 100) / 100])));
export const volumeSalle = id => possede(VOLUMES, id) ? VOLUMES[id] : undefined;

// ---------- The threshold: one function of depth, for the light, the air, the reverberation and the fade of the volumes ----------
// Across the plane of a door, from 2.25 m before to 2.25 m after: u goes from 0 (the hall) to 1 (the room), continuous and
// monotone. Beside the door's line (more than half its width plus 1 m from its axis) u is 0 in the hall and 1 in the room:
// the change from one to the other is smoothed over the next 1.5 m so that nothing jumps where one can walk.
export const SEUIL = Object.freeze({ demi: 2.25, lateral: 1.0, fondu: 1.5 });

const PLANS = PORTES.map(p => {
  const mx = (p.x0 + p.x1) / 2, mz = (p.z0 + p.z1) / 2, largeur = Math.hypot(p.x1 - p.x0, p.z1 - p.z0);
  let nx = p.salle[0] - p.hall[0], nz = p.salle[1] - p.hall[1];
  const n = Math.hypot(nx, nz);
  nx /= n; nz /= n;
  return { p, mx, mz, nx, nz, tx: -nz, tz: nx, largeur, bord: largeur / 2 + SEUIL.lateral };
});

// Work objects, made once: seuil, airEn and the sound's reads call poids() on every frame, and nothing here is allocated per
// call. They are private and used within one synchronous call (never kept by a caller): lectures() fills LECT/LISTE and
// poids() fills PESEE and RES, and whoever reads them reads them at once.
const LECT = PLANS.map(d => ({ porte: d.p, s: 0, m: 0, core: 0 }));
const LISTE = [];
const LEC = { de: null, n: 0, meilleure: null };
const PESEE = Array.from({ length: PLANS.length + 1 }, () => ({ id: "", w: 0 }));
const RES = { de: null, u: 0, meilleure: null, n: 0 };

// What each door says of a point: s (signed distance to the door's plane: negative on the hall's side), m (how much the
// point is in front of the door, 1 to 0), core (the depth function along the axis), for the doors that matter to the point.
function lectures(x, z) {
  const de = salleDe(x, z);
  let n = 0;
  for (let k = 0; k < PLANS.length; k++) {
    const d = PLANS[k];
    if (de && de !== "hall" && de !== d.p.vers) continue;      // a room feels its own door only
    const dx = x - d.mx, dz = z - d.mz, l = LECT[k];
    l.s = dx * d.nx + dz * d.nz;
    l.m = 1 - lisse((Math.abs(dx * d.tx + dz * d.tz) - d.bord) / SEUIL.fondu);
    l.core = lisse((l.s + SEUIL.demi) / (2 * SEUIL.demi));
    LISTE[n++] = l;
  }
  LISTE.length = n;
  // The door the point is nearest to (by the depth of its plane), among those it is in front of.
  let meilleure = null;
  for (let k = 0; k < n; k++) {
    const l = LISTE[k];
    if (l.m > 0 && (!meilleure || Math.abs(l.s) < Math.abs(meilleure.s) - 1e-9 || (Math.abs(Math.abs(l.s) - Math.abs(meilleure.s)) <= 1e-9 && l.m > meilleure.m))) meilleure = l;
  }
  LEC.de = de; LEC.n = n; LEC.meilleure = meilleure;
  return LEC;
}

// The weights of the rooms at a point: PESEE[0..RES.n - 1] = { id, w } adding up to 1, and the threshold depth u that goes with them.
function poids(x, z) {
  const { de, n, meilleure } = lectures(x, z);
  RES.de = de; RES.meilleure = meilleure;
  if (de === "hall") {
    let somme = 0;
    for (let k = 0; k < n; k++) somme += LISTE[k].m * LISTE[k].core;
    const echelle = somme > 1 ? 1 / somme : 1, u = Math.min(1, somme);
    PESEE[0].id = "hall"; PESEE[0].w = 1 - u;
    let c = 1;
    for (let k = 0; k < n; k++) {
      const l = LISTE[k], v = l.m * l.core;
      if (v > 0) { PESEE[c].id = l.porte.vers; PESEE[c].w = v * echelle; c++; }
    }
    RES.u = u; RES.n = c;
  } else if (de) {
    const l = n > 0 ? LISTE[0] : null, c = l ? l.m * (1 - l.core) : 0;
    PESEE[0].id = de; PESEE[0].w = 1 - c;
    PESEE[1].id = "hall"; PESEE[1].w = c;
    RES.u = 1 - c; RES.n = 2;
  } else {
    const u = meilleure ? meilleure.core : 0;
    PESEE[0].id = "hall"; PESEE[0].w = meilleure ? 1 - u : 1;
    if (meilleure) { PESEE[1].id = meilleure.porte.vers; PESEE[1].w = u; }
    RES.u = u; RES.n = meilleure ? 2 : 1;
  }
  return RES;
}

/**
 * The depth of the threshold at a point: { porte, de, vers, u }. `porte` is the id of the door the point is in front of:
 * null when the point is more than 2.25 m from the door's plane, OR outside the door's lateral band (half its width plus
 * 1 m, faded over 1.5 m: in Aether, a point 9 m to the side of its door has none even half a metre from the wall's plane).
 * `de` is the room the point is in (null off the plan), `vers` the room on the other side of that door (the room from the
 * hall, the hall from a room), `u` the depth, 0 in the hall to 1 in the room. Only `u` is continuous: `porte` may change
 * name (jeux to mondes along the hall's wall) or fall to null where `u` does not move.
 * With `sortie` (an object made once), the answer is written into it and returned: no allocation.
 */
export function seuil(x, z, sortie) {
  const { de, u, meilleure } = poids(x, z), o = sortie || { porte: null, de: null, vers: null, u: 0 };
  o.de = de; o.u = u;
  if (!meilleure || Math.abs(meilleure.s) >= SEUIL.demi) { o.porte = null; o.vers = null; return o; }   // out of the band: in front of no door
  o.porte = meilleure.porte.id;
  o.vers = de && de !== "hall" ? "hall" : meilleure.porte.vers;
  return o;
}

// ---------- The air of each room ----------
// The fog is the colour the screen is cleared with plus, at most, 6/255 per channel in the hue of the room's lamp: black
// stays black at 40 m. The density is the fog's (rendu.js: exp(-dens^2 d^2)), never above 0.055, so a sign read at 8 m stays legible.
// The clear colour and the fog are ONE colour: once a room is tinted, rendu.js MUST clear the frame (gl.clearColor) with the
// same airEn(...).fog it gives uFog, every frame, so that through an opening the edge of the image is the fog and not a plain
// BG (IMMERSION-musee.md, track 7: the fog colour equals the clear colour). It does not yet (wired with the light, the air is put
// off): today rendu.js clears with BG and gives BG to uFog; the test of this lot refuses a rendu.js that calls airEn and still
// clears with BG. The lowest tier keeps today's image: airPlat().
// STARTING VALUES, to be judged on the real GPU (the hall's 0.038 replaces today's 0.042; at tier 0 it is airPlat()).
export const DENSITES = Object.freeze({ hall: 0.038, aether: 0.028, jeux: 0.05, mondes: 0.05, ecriture: 0.05, photographie: 0.055 });
export const DENSITE_MAX = 0.055;
export const TEINTE_MAX = 6 / 255;
/** The density the museum has always had (rendu.js: DENS), the same in every room. */
export const DENSITE_AUJOURDHUI = 0.042;
/** Today's air, the same everywhere: { dens: 0.042, fog: BG }. What the lowest tier gives to the image. Frozen. */
export const AIR_AUJOURDHUI = Object.freeze({ dens: DENSITE_AUJOURDHUI, fog: BG });

/**
 * Today's air (the lowest tier): the same density and the same fog as rendu.js has always used, in every room, whatever the
 * point, and seuil() is not read. Without argument it returns the frozen AIR_AUJOURDHUI; with `sortie` ({ dens, fog: [r, g, b] }
 * made once, with an array `fog` of its own) it writes into it and returns it. A `fog` that is frozen or is not an array (the one
 * of AIR_AUJOURDHUI is BG, frozen) is replaced by a fresh array in `sortie`: BG is never written.
 */
export function airPlat(sortie) {
  if (!sortie) return AIR_AUJOURDHUI;
  sortie.dens = DENSITE_AUJOURDHUI;
  if (!Array.isArray(sortie.fog) || Object.isFrozen(sortie.fog)) sortie.fog = [0, 0, 0];
  for (let i = 0; i < 3; i++) sortie.fog[i] = BG[i];
  return sortie;
}

const densite = id => Math.min(DENSITE_MAX, possede(DENSITES, id) ? DENSITES[id] : DENSITES.hall);
const canal = (t, i) => Math.min(1, Math.max(0, +t[i] || 0));
/** The tint of a room read in `teintes` ({ roomId: [r, g, b] }), by the table's own keys: the array, or null. */
const teinteDe = (teintes, id) => teintes && possede(teintes, id) && teintes[id] ? teintes[id] : null;
/** What the lamp's hue adds to channel i of the fog: at most 6/255 on the strongest channel, 0 without a tint. */
function ajout(t, i) {
  if (!t) return 0;
  const haut = Math.max(canal(t, 0), canal(t, 1), canal(t, 2));
  return haut > 0 ? TEINTE_MAX * canal(t, i) / haut : 0;
}

/**
 * The air of a room: { dens, fog: [r, g, b] }. `teintes` is a table { roomId: [r, g, b] } (0 to 1) of the rooms' lamps,
 * read from the CSS tokens by rendu.js; only its hue is used, so a room without one has the plain clear colour.
 */
export function air(idSalle, teintes) {
  const t = teinteDe(teintes, idSalle);
  return { dens: densite(idSalle), fog: [BG[0] + ajout(t, 0), BG[1] + ajout(t, 1), BG[2] + ajout(t, 2)] };
}

/**
 * The air at a point: the airs of the two rooms of the threshold, mixed by the weights of seuil() (the same u).
 * With `sortie` ({ dens, fog: [r, g, b] }, made once, its `fog` an array of its own, never BG's), the answer is written into it and
 * returned: no allocation. A frozen `fog` (a copy of AIR_AUJOURDHUI) is replaced by a fresh array.
 */
export function airEn(x, z, teintes, sortie) {
  const { n } = poids(x, z), o = sortie || { dens: 0, fog: [0, 0, 0] };
  if (sortie && (!Array.isArray(o.fog) || Object.isFrozen(o.fog))) o.fog = [0, 0, 0];
  let dens = 0, f0 = 0, f1 = 0, f2 = 0;
  for (let k = 0; k < n; k++) {
    const { id, w } = PESEE[k];
    if (!(w > 0)) continue;
    const t = teinteDe(teintes, id);
    dens += w * densite(id);
    f0 += w * (BG[0] + ajout(t, 0)); f1 += w * (BG[1] + ajout(t, 1)); f2 += w * (BG[2] + ajout(t, 2));
  }
  o.dens = dens; o.fog[0] = f0; o.fog[1] = f1; o.fog[2] = f2;
  return o;
}
