// What the walls answer to a footstep: the first-order reflections (the virtual ceiling and the four walls of the room), worked
// out for the camera's place and heading, then BAKED into a stereo buffer the size of the first 100 ms of the step. Pure: no DOM,
// no Web Audio except the one factory of buffers (creerReserve) that is given its context, no clock, no Math.random, and
// nothing of the sound layer or of the spatial assembly. Node plays it and the bench measures it (M10, M11).
// EVERY NUMBER BELOW IS A STARTING VALUE, tied to SPEC-son-musee.md 4.8; the bench's M10 and M11 measure it.
import { MURS, SALLES, salleEn, EPAISSEUR } from "./batiment.js?v=20261025-r28";
import { hauteurSalle } from "./lieu.js?v=20261025-r28";

// ---------- Constants ----------
export const OREILLE = 1.62;                // m: the ear (the camera's eye) over a foot on the floor
export const VITESSE_SON = 343;             // m/s
export const REFLEXION_MUR = 0.8;           // amplitude coefficient of a wall
export const REFLEXION_PLAFOND = 0.88;      // amplitude coefficient of the ceiling
export const DOUBLE_COMPTE_DB = -3;         // the network of delays already has first reflections: the walls count 3 dB less
export const COMPENSATION_PIED_DB = -3;     // the dry step goes through the foot panners (equal power, pan -+0.15: -2.1 and -4.2 dB per ear), the baked
                                            // stereo reflection does not: the assembly plays it this much lower (after the voice gain), so that
                                            // M10's levels stay the levels RELATIVE to the dry step as heard. To confirm by the offline render (D2/C80).
export const RETARD_MIN_MS = 2;             // an image under 2 ms is part of the step itself
export const RETARD_MAX_MS = 120;           // over 120 ms the network of delays does it
export const SEUIL_DB = -33;                // an image under -33 dB is not kept
export const ITD_MAX_MS = 0.66;             // the interaural time difference of a source at 90 degrees
export const ILD_MAX_DB = 3;                // and the level difference, +-3 dB around the mean (one ear up, the other down)
export const FENETRE_PAS_S = 0.1;           // the first 100 ms of the step are baked
export const FONDU_FIN_S = 0.01;            // the baked window ends with a 10 ms raised-cosine fade (no click at the cut)
export const TAILLE_TAMPON_S = 0.25;        // the length of the reused buffers
export const MAX_IMAGES = 5;

// ---------- Where the walls are ----------
const EPS = 1e-9;
/** True when the point (px, pz) lies on one of the wall segments of the plan (centre lines): false in a door. */
function surUnMur(px, pz) {
  for (const m of MURS) {
    const [a0, b0, a1, b1] = m;
    if (a0 === a1) { if (Math.abs(px - a0) <= EPS && pz >= Math.min(b0, b1) - EPS && pz <= Math.max(b0, b1) + EPS) return true; }
    else if (Math.abs(pz - b0) <= EPS && px >= Math.min(a0, a1) - EPS && px <= Math.max(a0, a1) + EPS) return true;
  }
  return false;
}

/**
 * The first-order images of a footstep at the camera's place { x, z } (the foot on the floor, the ear 1.62 m up), heading `yaw`
 * (0 north, pi/2 west), in the room `salleId` (an id of the plan; absent or unknown: the room the point is in), under a ceiling of
 * `hauteur` metres (default: the room's, hauteurSalle of lieu.js, the one source of the heights; 4.2 m, the old height of the walls,
 * is no longer the default, it is the explicit case `hauteur = 4.2`: 15.0 ms and -16.5 dB for the hall's ceiling). At most five { retardMs, itdMs, gG, gD }, from the nearest:
 * retardMs is the delay in ms from the dry step to the middle of the head, itdMs the interaural delay (positive: the right ear
 * first, so left = retardMs + itdMs / 2 and right = retardMs - itdMs / 2), gG and gD the linear gains of the left and the right
 * ear. Path of a wall at the distance d of its face: p = sqrt((2d)^2 + 1.62^2), delay (p - 1.62) / 343, level 20 log10(0.8 * 1.62 / p);
 * the ceiling: p = 2H - 1.62, level 20 log10(0.88 * 1.62 / p); then -3 dB. An image whose point of reflection lies in a door
 * (outside every wall segment) is dropped, as are the delays outside 2..120 ms and the levels under -33 dB. The interaural
 * differences follow the real direction of the image AND the heading: turning the head changes them.
 */
export function reflexions(x, z, yaw, salleId, hauteur) {
  const salle = SALLES.find(s => s.id === salleId) || salleEn(x, z);
  if (!salle) return [];
  const H = hauteur ?? hauteurSalle(salle.id);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const sortie = [];
  const garder = (p, coef, sinAz) => {
    const retardMs = (p - OREILLE) / VITESSE_SON * 1000;
    const db = 20 * Math.log10(coef * OREILLE / p) + DOUBLE_COMPTE_DB;
    if (!(retardMs >= RETARD_MIN_MS && retardMs <= RETARD_MAX_MS) || !(db > SEUIL_DB)) return;
    const moy = Math.pow(10, db / 20);
    sortie.push({ retardMs, itdMs: ITD_MAX_MS * sinAz, gG: moy * Math.pow(10, -ILD_MAX_DB * sinAz / 20), gD: moy * Math.pow(10, ILD_MAX_DB * sinAz / 20) });
  };
  // The ceiling: straight above the foot, so on the median plane (no difference between the ears).
  garder(2 * H - OREILLE, REFLEXION_PLAFOND, 0);
  // The four walls: [unit normal pointing out of the room (x, z), the wall's centre-line coordinate, the point of reflection].
  const murs = [
    [-1, 0, salle.x0, salle.x0, z], [1, 0, salle.x1, salle.x1, z],
    [0, -1, salle.z0, x, salle.z0], [0, 1, salle.z1, x, salle.z1],
  ];
  for (const [nx, nz, ligne, px, pz] of murs) {
    const d = Math.max(0, (nx !== 0 ? (ligne - x) * nx : (ligne - z) * nz) - EPAISSEUR / 2);   // from the visitor to the wall's FACE
    if (!surUnMur(px, pz)) continue;                                                           // a door: no echo
    const dx = 2 * d * nx, dz = 2 * d * nz;                                                      // the image of the foot, in the plan
    const xa = dx * c - dz * s, za = dx * s + dz * c, h = Math.hypot(xa, za);
    garder(Math.hypot(2 * d, OREILLE), REFLEXION_MUR, h > EPS ? xa / h : 0);
  }
  sortie.sort((a, b) => a.retardMs - b.retardMs);
  return sortie.slice(0, MAX_IMAGES);
}

// ---------- Baking ----------
const queues = new Map();      // sample rate -> the fade table (made once, never per step)
function queue(sr) {
  let q = queues.get(sr);
  if (!q) {
    const m = Math.max(1, Math.round(FONDU_FIN_S * sr));
    q = new Float32Array(m);
    for (let k = 0; k < m; k++) q[k] = 0.5 * (1 + Math.cos(Math.PI * (k + 1) / (m + 1)));
    queues.set(sr, q);
  }
  return q;
}
/**
 * Bakes the images into `sortie` = { L, R } (two Float32Array of 0.25 s, reused): the sum of the delayed and scaled copies of the
 * first 100 ms of `pas` (the dry step, a Float32Array, the same sample rate as `sr`), the last 10 ms faded out. Nothing is allocated
 * per call (the fade table is made once per sample rate). Returns the number of leading samples that can be non-zero.
 */
export function cuire(pas, liste, sr, sortie) {
  const L = sortie.L, R = sortie.R;
  L.fill(0); R.fill(0);
  const n = Math.min(pas.length, Math.round(FENETRE_PAS_S * sr));
  const q = queue(sr), m = q.length, debutFondu = n - m;
  let utile = 0;
  for (let j = 0; j < liste.length; j++) {
    const r = liste[j], itd = r.itdMs || 0;
    const dG = Math.max(0, Math.round((r.retardMs + itd / 2) * sr / 1000)), dD = Math.max(0, Math.round((r.retardMs - itd / 2) * sr / 1000));
    const gG = r.gG, gD = r.gD;
    const nG = Math.min(n, L.length - dG), nD = Math.min(n, R.length - dD);
    for (let i = 0; i < nG; i++) L[dG + i] += pas[i] * gG * (i >= debutFondu ? q[i - debutFondu] : 1);
    for (let i = 0; i < nD; i++) R[dD + i] += pas[i] * gD * (i >= debutFondu ? q[i - debutFondu] : 1);
    if (dG + nG > utile) utile = dG + nG;
    if (dD + nD > utile) utile = dD + nD;
  }
  return utile;
}

/**
 * A reserve of `n` stereo AudioBuffers of `secondes` seconds (made once, at `sr` Hz: the sample rate of the dry step, so that the same
 * playbackRate applies to both), handed out in turn: nothing is allocated when a step is played. `prendre()` returns the next slot
 * { buffer, L, R, ecrire }. L and R are the slot's OWN working arrays (two Float32Array, never the arrays of the AudioBuffer): they
 * are what cuire() fills. `ecrire()` then copies them into the buffer (copyToChannel, no allocation) and must be called just before
 * `start()`. Why not write into getChannelData(): the specification "acquires" the content of an AudioBuffer when a source starts, and
 * the arrays handed out before are detached (length 0; Firefox really steals them). A slot reused after that would write into nothing,
 * and the walls would replay the reflections of the first six steps for ever. Order of use: prendre(), cuire(pas, liste, sr, c),
 * c.ecrire(), source.buffer = c.buffer, start(). A slot is reused only after the other n - 1 have been taken (six slots at two steps
 * a second: 3 s, far over the 0.4 s of a baked step).
 */
export function creerReserve(ctx, n = 6, secondes = TAILLE_TAMPON_S, sr = 48000) {
  const longueur = Math.round(secondes * sr);
  const cases = [];
  for (let i = 0; i < n; i++) {
    const buffer = ctx.createBuffer(2, longueur, sr);
    const L = new Float32Array(longueur), R = new Float32Array(longueur);
    cases.push({
      buffer, L, R,
      ecrire() { buffer.copyToChannel(L, 0); buffer.copyToChannel(R, 1); },
    });
  }
  let suivant = 0;
  return {
    sr, taille: n, longueur,
    prendre() { const c = cases[suivant]; suivant = (suivant + 1) % n; return c; },
  };
}
