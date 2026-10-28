// The museum's acoustic table: what each room sounds like, the weights that glide from one room to the next through a
// door, the floor under the foot, and where the sounds come from. Data and small calculations only: no DOM, no Web Audio,
// no clock, no Math.random, so Node can run it and the bench can measure it. The placement (emetteurs.js, murs.js) reads it;
// the network of delays (reseau.js) and the assembly of the spatial layer (espace.js) do; none of them changes a number here except through this file.
// EVERY NUMBER BELOW IS A STARTING VALUE: this is the table to adjust by ear (the bench's R1, R6, E3 and D2 measure it).
import { SALLES, PORTES, OEUVRES, MURS, MURS_HAUT, EPAISSEUR, salleEn } from "./batiment.js?v=20261025-r28";
import { RECETTES, niveauPas } from "./pas.js?v=20261025-r28";

export { MURS, MURS_HAUT, EPAISSEUR };   // re-exported for the neighbours that need the walls with the table

// ---------- Switches (the buttons of the ear tests) ----------
export const NIVEAU_PAS_DBFS = -33;      // an OUTPUT level, not a voice gain: the peak of a walking step on stone at the output (after the bus, the master, the compressor and the limiter), in the louder channel; niveauPas() adds the speed and the floor
// Between the voice and the output sit: the bus (0.72, sound.js), the master (0.68, sound.js), the foot's pan (+-0.15, an equal-power
// StereoPanner, whose louder channel keeps cos((1 - 0.15) * pi / 4) = 0.786, that is -2.1 dB), then the compressor (threshold -15,
// knee 10, ratio 6) and the limiter (threshold -4, ratio 20) of sound.js. The first three ATTENUATE by 8.3 dB. The last two do not
// touch a quiet step (it sits far under both thresholds) but both carry the automatic make-up gain of the Web Audio compressor
// (the spec's and Blink's (1 / saturate(1, k))^0.6), which RAISES everything that passes. So: COMPENSATION_CHAINE_DB = 8.3 - make-up.
export const PAN_PIED = 0.15;
export const ATTENUATION_CHAINE_DB = 20 * Math.log10(1 / (0.72 * 0.68)) - 20 * Math.log10(Math.cos((1 - PAN_PIED) * Math.PI / 4));   // +8.3 dB: what the bus, the master and the pan take away
// MEASURED: 7.6 dB. The bench's banc/e0b.mjs (a sine at -33 dBFS at the bus input, output over input, through the real chain of
// sound.js, offline, Edge headless on the RTX 4050, 27 October 2026) gives 7.61 dB, flat from -60 to -10 dBFS (7.60 to 7.62), left = right.
// It was provisional at 7.5 (the Blink formula, about +7.3 to +7.6). The day the chain changes (bus, master, compressor, limiter), E0b is
// replayed and this number is the only one to change, and NIVEAU_VOIX_PAS_DB with it.
export const RATTRAPAGE_COMPRESSEURS_DB = 7.6;
export const COMPENSATION_CHAINE_DB = ATTENUATION_CHAINE_DB - RATTRAPAGE_COMPRESSEURS_DB;     // about +0.8 dB: what a voice gain must ADD to NIVEAU_PAS_DBFS
export const NIVEAU_VOIX_PAS_DB = NIVEAU_PAS_DBFS + COMPENSATION_CHAINE_DB;     // about -32.3 dB (gain 0.0243 for a tampon of peak 1), before niveauPas(): the make-up is measured (E0b), the level of a step is still to be judged by ear
export const ECART_PAS_DB = 1.5;         // the draw of each step: +-1.5 dB around its level (SPEC-son-musee.md, 4.6, "Niveau")
/**
 * The draw of one step in dB, between -ECART_PAS_DB and +ECART_PAS_DB, from the INJECTED random source `hasard` (a function
 * returning [0, 1), such as the seeded generator of the caller; never Math.random here). The caller gives it to gainVoixPas as `ecartDb`, which adds it in dB.
 */
export const ecartPasDb = hasard => (hasard() * 2 - 1) * ECART_PAS_DB;
/**
 * Linear gain of the voice of one step (a tampon of peak 1): NIVEAU_VOIX_PAS_DB + niveauPas(r, sol) + ecartDb, the floor
 * included. `r` is NOT null: it is the result of suivre() (the step the caller got), the caller tests that before. `ecartDb`
 * (default 0) is the draw of ecartPasDb(hasard). E1 in the real chain is the judge.
 */
export const gainVoixPas = (r, sol, ecartDb = 0) => Math.pow(10, (NIVEAU_VOIX_PAS_DB + niveauPas(r, sol) + ecartDb) / 20);
export const HRTF_ACTIF = true;          // true: the two emitters use a HRTF panner at state 3; false: a plain stereo pan
export const SOLS_VARIES = true;         // true: one floor per room (five heard floors); false: stone everywhere but the rug
// The picture shows a single dark polished floor. The coordination kept the five heard floors of the sound brief anyway,
// to be judged by ear; with SOLS_VARIES false, solEn gives stone everywhere except the one material the picture does show:
// the rug of Game Development.

// The rug of Game Development, [x0, z0, x1, z1]. A COPY of the rectangle the drawing traces (rendu.js, the line
// rectLines(lines, 14.4, 1.6, 16.9, 4.6, ...)); the bench's M6 reads rendu.js and checks that the two have not diverged.
export const TAPIS = [14.4, 1.6, 16.9, 4.6];

// ---------- Heights and volumes ----------
// The ceilings are decided with the picture (choice 6 of the immersion brief): hall 5.6 m, Aether 7.0 m, the side rooms 3.2 m.
// A COPY of the values lieu.js carries: two copies of one decision, which the test of lieu.js
// (_outils/qa/immersion-2026-10-27/lieu/test.mjs) guards by equality, until the lot of the sound that reads lieu.js drops this copy.
// The volumes follow (floor area of SALLES times the height) and only serve to justify the times.
export const HAUTEURS = { hall: 5.6, aether: 7.0, jeux: 3.2, mondes: 3.2, photographie: 3.2, ecriture: 3.2 };
export const VOLUMES = Object.fromEntries(SALLES.map(s => [s.id, Math.round((s.x1 - s.x0) * (s.z1 - s.z0) * HAUTEURS[s.id] * 100) / 100]));

// ---------- The table ----------
// rt60: the T30 aimed at 500 Hz (s). rt60Boucle: the loop time of the delay network (s). fc: the lowpass of the loop (Hz).
// envoi: the send to the network, in dB, for the steps (pas), the figures (figure: the five small sounds of the rooms, and the
// leaks of the hall) and the glass (verre). They are values for a MONO send taken BEFORE the panner: the network's input forces one channel,
// so a stereo send arrives as 0.5 x (L + R) and R6 of the bench (--envoi) must then be played again with that send.
// humideSec: the aimed energy of the return of a lone step over its direct, in dB.
// sol and niveauSol: the floor of the room and its level (dB; the level is the one of the recipe in pas.js).
// echos: the two beaten echoes of state 1 ([ms, dB under the step]). emetteurs: where the room's sounds come from.
// The tail of a small room, to -40 dB under the step, measured by the bench's E3 with the network plugged for the whole render: about 0.66 x rt60Boucle (Game Development 0.56 s,
// Mondes 0.75, Photographie 0.52 for 0.846, 1.128 and 0.784), and E3 asks 0.5 s at most of the three small rooms. Game Development (0.846 -> 0.73) and Photographie (0.784 -> 0.71)
// were lowered for that (0.48 s and 0.47 s expected); Writing (0.495) sits at 0.48 s already, Aether (2.856) at 1.76 s, under the 2 s asked.
// The 0.66 is the ratio of -40 to -60 dB (2/3), true where the network alone shapes the tail (Game Development, Worlds, Photography); it does not hold
// where the steps and the echoes set a floor of their own (Writing: 0.48 / 0.495 = 0.97; Aether 0.62, hall 0.71). So the rule does not choose a value: the
// table's gate is the tail E3 reads in Edge. If Game Development or Photography read over 0.5 s, lower rt60Boucle by the tail read, not by the rule.
// The lowering also moves the sends' calibration (R6, --envoi) and the T30 per octave (R1, 2 kHz of Game Development): both are played again in Edge with this table.
// The sends were set again for the exact network (the worklet of reseau-worklet.js, tour 8): the old ones had been set on a graph of native Delay nodes that added
// one render quantum (128 samples) to some cycles and read 3 to 7 dB hotter than the exact computation. They now come from the kernel run in Node (mesure/noyau.mjs, R6:
// the wet energy of a lone step over its direct, three step seeds, mono send): hall -17.5 -> -12.8, Aether -12.7 -> -11.5, Game Development -14.8 -> -13.7, Worlds -15.7 -> -14.1,
// Photography -16.1 -> -14.9, Writing -17.6 -> -15.0, which puts R6 within 0.5 dB of humideSec in every room. Edge plays R6, file 12 and D1 again with the worklet.
// Set by measure on 28 October (Edge plays the worklet; mesure/reglage.mjs in Node gives the same R6 to 0.1 dB): the sends of the steps were centred on humideSec (R6 was +0.1 to +0.5 dB high in every room),
// Photography was left 0.9 dB high on purpose (its clarity C80 was 8.31 for a ceiling of 8.0: 7.91 now), and the fc of Game Development fell 6 % (3020 -> 2840: T30 at 2 kHz +18.8 % -> +14.1 % for 20 allowed, at 4 kHz -12.3 % -> -21.6 % for 30).
// The dose D1 is NOT met by this table: the steps alone read -57.86 dBFS(A) at 2.5 m/s (ceiling -58), see DECISIONS.md D170 (d) 99.
const bac = z => ({ x: -16.35, y: 0.97, z, ref: 2 });                 // the three trays of the darkroom (rendu.js, the bench: x -16.62..-16.08, z 1.8 / 3.1 / 4.4)
const oeuvre = (id, y, ref) => { const o = OEUVRES.find(e => e.id === id); return { x: o.x, y, z: o.z, ref }; };
const haut = z => ({ x: 16.55, y: 0.85, z, ref: 2 });                 // the two speakers of the desk (rendu.js draws them at z 2.3 and 3.9, x 16.48..16.62, up to 0.96 m)
export const ACOUSTIQUE = {
  hall:         { rt60: 1.8,  rt60Boucle: 1.836, fc: 5180, envoi: { pas: -13.2, figure: -9.2, verre: -15.2 }, humideSec: -1, sol: "pierre",    niveauSol: RECETTES.pierre.niveau,    echos: [[31, -12], [67, -18]],  emetteurs: [] },
  aether:       { rt60: 2.8,  rt60Boucle: 2.856, fc: 6040, envoi: { pas: -11.9, figure: -7.9,  verre: -13.9 }, humideSec: 2,  sol: "beton",     niveauSol: RECETTES.beton.niveau,     echos: [[46, -12], [101, -18]], emetteurs: [oeuvre("carte", 1.62, 4)] },
  jeux:         { rt60: 0.78, rt60Boucle: 0.73,  fc: 2840, envoi: { pas: -14.0, figure: -10.0, verre: -16.0 }, humideSec: -5, sol: "beton",     niveauSol: RECETTES.beton.niveau,     echos: [[14, -12], [31, -18]],  emetteurs: [haut(2.3), haut(3.9)] },
  mondes:       { rt60: 1.2,  rt60Boucle: 1.128, fc: 4110, envoi: { pas: -14.5, figure: -10.5, verre: -16.5 }, humideSec: -4, sol: "pierre",    niveauSol: RECETTES.pierre.niveau,    echos: [[17, -12], [37, -18]],  emetteurs: [oeuvre("maquette", 1.1, 2)] },
  photographie: { rt60: 0.72, rt60Boucle: 0.71,  fc: 3810, envoi: { pas: -14.3, figure: -10.3, verre: -16.3 }, humideSec: -6, sol: "carrelage", niveauSol: RECETTES.carrelage.niveau, echos: [[13, -12], [29, -18]],  emetteurs: [bac(1.8), bac(3.1), bac(4.4)] },
  ecriture:     { rt60: 0.55, rt60Boucle: 0.495, fc: 2800, envoi: { pas: -15.1, figure: -11.1, verre: -17.1 }, humideSec: -8, sol: "parquet",   niveauSol: RECETTES.parquet.niveau,   echos: [[11, -14], [24, -20]],  emetteurs: [oeuvre("pupitre", 1.07, 2)] },
};

// ---------- Doors ----------
/** The centre of a room's door and its opening: { x, z, demiLargeur, nx, nz } (nx, nz: the unit normal, pointing from the hall into the room). */
export function centrePorte(salleId) {
  const p = PORTES.find(e => e.id === salleId);
  if (!p) return null;
  const dx = p.salle[0] - p.hall[0], dz = p.salle[1] - p.hall[1], l = Math.hypot(dx, dz) || 1;
  return { x: (p.x0 + p.x1) / 2, z: (p.z0 + p.z1) / 2, demiLargeur: Math.hypot(p.x1 - p.x0, p.z1 - p.z0) / 2, nx: dx / l, nz: dz / l };
}

const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const FONDU = 1.5;     // m: the weight of a door falls to nothing 1.5 m from its plane and 1.5 m beyond the edges of its opening

/** Closeness of a door to a point, 0..1: 1 on the opening's plane, falling to 0 at 1.5 m from the plane and 1.5 m from the opening's edges. */
function proximite(porte, x, z) {
  const c = centrePorte(porte.id), s = (x - c.x) * c.nx + (z - c.z) * c.nz, t = Math.abs((x - c.x) * -c.nz + (z - c.z) * c.nx);
  const lateral = smooth(1 - Math.max(0, t - c.demiLargeur) / FONDU);
  return lateral * smooth(1 - Math.abs(s) / FONDU);
}

/**
 * The room a point is in and the weights of its sound: `{ salle, voisine, w: [wSalle, wVoisine] }`, ids of the rooms. The room
 * where the point is weighs 1; the neighbour (the room behind the nearest door: the hall, from a side room) weighs the closeness
 * of that door; then both are brought to equal power (the squares add up to 1). Off the plan: `{ salle: null, voisine: null, w: [1, 0] }`.
 */
export function poidsSalles(x, z) {
  const s = salleEn(x, z);
  if (!s) return { salle: null, voisine: null, w: [1, 0] };
  let voisine = null, prox = 0;
  for (const p of PORTES) {
    if (s.id !== "hall" && p.id !== s.id) continue;       // a side room has one door, its own
    const k = proximite(p, x, z);
    if (k > prox) { prox = k; voisine = s.id === "hall" ? p.id : "hall"; }
  }
  const n = Math.sqrt(1 + prox * prox);
  return { salle: s.id, voisine: prox > 0 ? voisine : null, w: [1 / n, prox / n] };
}

const logMoy = (a, b, w, key) => Math.exp(w[0] * Math.log(a[key]) + w[1] * Math.log(b[key]));
/**
 * The sound of the museum at a point: the loop time and the brightness (means of logarithms), the sends (means in dB), each
 * weighted by the square of the weights of `poidsSalles` (so the weights add up to 1). Returns { rt60, fc, envoi, poids }.
 */
export function melange(x, z) {
  const poids = poidsSalles(x, z), a = ACOUSTIQUE[poids.salle || "hall"], b = ACOUSTIQUE[poids.voisine || poids.salle || "hall"], w = poids.w.map(v => v * v);
  const t = {};
  for (const k of ["pas", "figure", "verre"]) t[k] = w[0] * a.envoi[k] + w[1] * b.envoi[k];
  return { rt60: logMoy(a, b, w, "rt60Boucle"), fc: logMoy(a, b, w, "fc"), envoi: t, poids };
}

// ---------- Floors ----------
const dansTapis = (x, z) => x >= TAPIS[0] && x <= TAPIS[2] && z >= TAPIS[1] && z <= TAPIS[3];
/**
 * The floor under the foot: "pierre" | "beton" | "moquette" | "carrelage" | "parquet". Carpet only on the rug, in Game
 * Development. `varies` is SOLS_VARIES unless a test gives another value: false gives stone everywhere but the rug.
 */
export function solEn(salleId, x, z, varies = SOLS_VARIES) {
  if (salleId === "jeux" && dansTapis(x, z)) return "moquette";
  if (!varies) return "pierre";
  return (ACOUSTIQUE[salleId] || ACOUSTIQUE.hall).sol;
}

// ---------- Where the glass is heard ----------
// The y (m) by kind of exhibit: showcases 1.3; panels and frames 1.5; the map, the model and the trays 1.0; the book where it
// stands, 1.36; the lectern 1.07; the chair is the sitting eye of the PC; "pc" is its screen.
const Y_VERRE = { vitrine: 1.3, panneau: 1.5, cadre: 1.5, carte: 1.0, maquette: 1.0, cuves: 1.0, pupitre: 1.07 };
/** Where the glass of an exhibit is heard: { x, y, z } in metres, or null for an unknown id. "pc-chaise" is the sitting eye; "pc" its screen. */
export function positionVerre(id) {
  const pc = OEUVRES.find(o => o.id === "pc");
  if (id === "pc-chaise") return { x: pc.assise.x, y: pc.assise.y, z: pc.assise.z };
  if (id === "pc") return { x: pc.ecran.x, y: pc.ecran.y, z: pc.ecran.z };
  const o = OEUVRES.find(e => e.id === id);
  if (!o) return null;
  if (o.type === "livre") return { x: o.x, y: o.y ?? 1.36, z: o.z };
  const y = Y_VERRE[o.type];
  return y === undefined ? null : { x: o.x, y, z: o.z };
}
