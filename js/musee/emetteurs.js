// Where a sound seems to come from: the head frame, the pan, the "behind me" filter, the distance, the doors, and the
// emitters (small chains of Web Audio nodes that carry one figure at a time). The listener stays FIXED at the origin of the audio
// scene (some engines have no moving listener): every source is expressed in the frame of the head instead, with the camera
// { x, z, yaw }, x to the right, the front at negative z, yaw 0 looking north, pi/2 looking west.
// Two parts. The first is pure (no DOM, no Web Audio, no clock, no Math.random): Node plays it and the bench measures it (M7, M8,
// M9). The second builds nodes from a context it is given (the real one or the bench's fake): it reads nothing of the page,
// and it imports nothing of the sound layer (the layer hands it its context and its outputs).
// EVERY NUMBER BELOW IS A STARTING VALUE, tied to SPEC-son-musee.md 4.7; the bench's M7 to M9 measure it.
import { centrePorte } from "./acoustique.js?v=20261025-r28";

// ---------- Constants ----------
export const PAN_MAX = 0.6;               // the pan never goes past +-0.6 (an equal-power gap of 9.8 dB, about a real head)
export const COUPURE_DEVANT = 6500;       // Hz: the low-pass in front
export const COUPURE_DERRIERE = 2400;     // Hz: the low-pass behind the head
export const GAIN_PLANCHER = 0.35;        // the gain by distance never goes under this (-9.1 dB): the room does the rest
export const OREILLE = 1.62;              // m: the height of the ears (the camera's eye)
export const PORTE_BAS = 2600;            // Hz: the low-pass of a door seen from the side
export const PORTE_BAS_AXE = 5000;        // Hz: the low-pass of a door seen straight on
export const PORTE_AXE = 0.8;             // in the axis of a door: within 0.8 of its half-width, sideways
export const FUITE_DB = -3;               // a leak sounds 3 dB under its figure
export const SEUIL_SAUT_M = 0.6;          // a move of more than this in one frame is a jump (the caller tells the emitter)
export const INTERVALLE_MAJ = 0.05;       // s: at most one update every 50 ms
export const SEUIL_PAN = 0.02;            // an update only when the pan moved by more than this ...
export const SEUIL_COUPURE = 150;         // ... or the cutoff by more than this (Hz) ...
export const SEUIL_GAIN_DB = 0.5;         // ... or the gain by more than this (dB) ...
export const SEUIL_POSITION = 0.05;       // ... or, with the HRTF panner, the position by more than this (m)
export const CONSTANTE_PAN = 0.04;        // s: setTargetAtTime time constants
export const CONSTANTE_COUPURE = 0.05;
export const CONSTANTE_GAIN = 0.08;
export const DUREE_SAUT = 0.03;           // s: after a jump the pan, the filter and the gain are there in 30 ms (+-5)
export const MARGE_OCCUPE = 0.1;          // s: an emitter stays taken this long after its sound
export const FENETRE_SAUT = 0.1;          // s: a jump told by saut(t) waits this long for the new place (the next placer() takes it as a jump)
// The HRTF panner of Blink cross-fades, over 2048 frames (about 43 ms at 48 kHz), whenever the direction it is given has changed since it last worked on a sound:
// an emitter that had been silent and is placed for a new sound would lateralise only half of its first 40 ms (the bench's E4 measured 3 dB and 0.4 ms of 12.7 dB
// and 0.75 ms). So at state 3 the sound waits in a delay line while the panner takes its new direction: the position is written at once, the panner works on the
// silence of the delay, and the sound reaches it AVANCE_HRTF_S later, on a settled direction (the dry sound and its send to the network wait together).
export const AVANCE_HRTF_S = 0.052;       // s: a bit more than the 46.4 ms of the cross-fade at 44.1 kHz and two render quanta (the position lands on the next quantum)

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// A time or a coordinate is finite when IT is: each argument is tested on its own (a sum would let a null or a boolean through).
const fini = Number.isFinite;

// ---------- Pure part ----------
/**
 * A source in the frame of the head: { xa, za, d, az }. `source` is { x, z } and `cam` is { x, z, yaw } (metres, radians).
 * xa: to the right of the head (positive); za: behind it (positive; the front is negative); d: distance on the floor plane;
 * az: azimuth, 0 in front, +pi/2 on the right, +-pi behind. dx = ex - x, dz = ez - z, xa = dx cos(yaw) - dz sin(yaw),
 * za = dx sin(yaw) + dz cos(yaw), az = atan2(xa, -za). TWO signs checked by M7 (a source to the east, a visitor facing north: xa > 0).
 */
export function versLaTete(source, cam) {
  const dx = source.x - cam.x, dz = source.z - cam.z, c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
  const xa = dx * c - dz * s, za = dx * s + dz * c;
  return { xa, za, d: Math.hypot(dx, dz), az: Math.atan2(xa, -za) };
}
/**
 * What the HRTF panner is given for a source: { x, y, z } in metres, in the frame of the head (x to the right, y up, the front at negative z), the
 * listener staying at the origin with its default orientation. `v` is versLaTete(source, cam). x and z are the source's own xa and za, with NO scaling
 * (the panner's distance model is flat: rolloffFactor 0): a bare PannerNode given the same three numbers hears the source where this one does. y is
 * the source's height over the ear. A source within 5 cm of the head is moved 5 cm to the front (the panner has no direction at the centre).
 */
export function positionTete(source, v) {
  const za = Math.hypot(v.xa, v.za) < 0.05 ? -0.05 : v.za;
  return { x: v.xa, y: (source.y ?? OREILLE) - OREILLE, z: za };
}
/** The pan of an azimuth: 0.6 sin(az), from -0.6 (left) to +0.6 (right). */
export const panDe = az => PAN_MAX * Math.sin(az);
/** The cutoff (Hz) of the "behind me" low-pass: 6500 in front, 2400 behind, 2400 + 4100 (1 + cos az) / 2 between. */
export const coupureDos = az => COUPURE_DERRIERE + (COUPURE_DEVANT - COUPURE_DERRIERE) * (1 + Math.cos(az)) / 2;
/** The direct gain by distance: 1 up to the reference distance `ref`, then ref / d, never under 0.35. Without a usable `ref`, 1. */
export function gainDistance(d, ref) {
  if (!(ref > 0)) return 1;
  return clamp(ref / Math.max(d, 1e-6), GAIN_PLANCHER, 1);
}
/** The left and right gains of an equal-power stereo panner for a pan in [-1, 1] (what the engine does with a mono input). */
export function gainsStereo(pan) {
  const th = (clamp(pan, -1, 1) + 1) * Math.PI / 4;
  return { g: Math.cos(th), d: Math.sin(th) };
}
/**
 * Where a leak of the hall seems to come from: the centre of the door of the room it comes from. `salleOrigine` is a room id,
 * `cam` the camera. Returns { x, z, dansAxe } (dansAxe: the visitor stands sideways within 0.8 of the door's half-width of its
 * centre line), or null for a room without a door.
 */
export function sourceDePorte(salleOrigine, cam) {
  const p = centrePorte(salleOrigine);
  if (!p) return null;
  const lateral = Math.abs((cam.x - p.x) * -p.nz + (cam.z - p.z) * p.nx);
  return { x: p.x, z: p.z, dansAxe: lateral <= PORTE_AXE * p.demiLargeur + 1e-9 };
}
/** The level of a leak in dB, from the level of its figure: 3 dB under. */
export const niveauFuite = figureDb => figureDb + FUITE_DB;
/** The low-pass of a door (Hz): 5000 straight in its axis, 2600 from the side. */
export const passeBasPorte = dansAxe => dansAxe ? PORTE_BAS_AXE : PORTE_BAS;

/** The key of a position, to the hundredth of a metre (the same sound place gives the same emitter). */
export const cleDePosition = pos => `${Math.round(pos.x * 100)}|${Math.round((pos.y ?? OREILLE) * 100)}|${Math.round(pos.z * 100)}`;

// ---------- Nodes ----------
/**
 * A parameter followed from the code side. Every change goes through it, and it keeps the last event it gave (fixed value, linear
 * ramp or target curve), so the value the parameter has at an instant is worked out here and never read back from `param.value`
 * (some engines answer that with the last value set, not the automated one: a ramp anchored there would start with a step).
 * valeurA(s): the value at s (s at or after the last event). fixer(valeur, t): at once at t, cancelling what was planned from t on.
 * aller(valeur, t, duree): linearly in `duree` seconds from the value it has at t, cancelling what was planned from t on (no target
 * curve survives). cible(valeur, t, tc): by setTargetAtTime, from the value it has at t (a ramp still running at t is cancelled from t on,
 * and the parameter is anchored at the value the ramp had reached).
 * `t` is the INSTANT ALREADY RENDERED, the context's current time, never ahead of it: a linear ramp is dated by its end, so cancelling
 * it from a t still to come makes the parameter fall back to the value it had at the ramp's start until t, then jump. A caller that
 * pauses a ramp passes ctx.currentTime, with no safety margin.
 */
function suivre(param, initial) {
  let type = "fixe", v0 = initial, v1 = initial, t0 = -Infinity, d = 0;
  const valeurA = s => {
    if (!(s > t0)) return v0;
    if (type === "fixe") return v1;
    if (type === "rampe") return s >= t0 + d ? v1 : v0 + (v1 - v0) * (s - t0) / d;
    return v1 + (v0 - v1) * Math.exp(-(s - t0) / d);
  };
  return {
    param, valeurA,
    fixer(valeur, t) { param.cancelScheduledValues(t); param.setValueAtTime(valeur, t); type = "fixe"; v0 = v1 = valeur; t0 = t; },
    aller(valeur, t, duree) {
      const depart = valeurA(t);
      param.cancelScheduledValues(t); param.setValueAtTime(depart, t); param.linearRampToValueAtTime(valeur, t + duree);
      type = "rampe"; v0 = depart; v1 = valeur; t0 = t; d = duree;
    },
    cible(valeur, t, tc) {
      const depart = valeurA(t);
      // A linear ramp still running at t would leave its end event after the curve in the engine's queue (its start is then read
      // differently from one engine to the next): it is cancelled, and the curve starts from the value the ramp had reached.
      if (type === "rampe" && t < t0 + d) { param.cancelScheduledValues(t); param.setValueAtTime(depart, t); }
      param.setTargetAtTime(valeur, t, tc);
      type = "cible"; v0 = depart; v1 = valeur; t0 = t; d = tc;
    },
  };
}
const dbEntre = (a, b) => Math.abs(20 * Math.log10(Math.max(a, 1e-9) / Math.max(b, 1e-9)));

/**
 * One emitter: emIn (Gain) -> [emDel (Delay, AVANCE_HRTF_S: only under an HRTF panner)] -> emLP (low-pass, the "behind me" filter) -> emPan -> emG (distance gain) -> sortieSec;
 * emSend (Gain) takes emDel (else emIn) BEFORE the panner and the distance and goes to `envoi` (the send to the network of delays).
 * Under an HRTF panner the whole sound, and its send, come out AVANCE_HRTF_S after they went in (see that constant).
 * emPan is a StereoPannerNode (state 2) or a PannerNode (state 3: panningModel "HRTF", distanceModel "linear", rolloffFactor 0,
 * the listener fixed at the origin). `opts`: { palier, sortieSec, envoi, hrtf = true }. Returns
 * { entree, emIn, emLP, emPan, emG, emSend, placer, saut, occuper, libre, couper, etouffer, reprendre, reglerEnvoi, versStereo, fermer, etat }.
 * The sound plays into `entree`. No automation method that Firefox lacks is used.
 */
export function creerEmetteur(ctx, { palier = 2, sortieSec, envoi = null, hrtf = true } = {}) {
  const emIn = ctx.createGain(), emLP = ctx.createBiquadFilter(), emG = ctx.createGain(), emSend = ctx.createGain();
  emLP.type = "lowpass"; emLP.Q.value = -3; emLP.frequency.value = COUPURE_DEVANT;
  emIn.gain.value = 1; emG.gain.value = 1; emSend.gain.value = 1;
  const fabriquerPan = avecHrtf => {
    if (avecHrtf) {
      const p = ctx.createPanner();
      p.panningModel = "HRTF"; p.distanceModel = "linear"; p.rolloffFactor = 0; p.refDistance = 1; p.maxDistance = 10000;
      return p;
    }
    return ctx.createStereoPanner();
  };
  let emPan = fabriquerPan(palier >= 3 && hrtf);
  let estHrtf = palier >= 3 && hrtf;
  // The delay line of the HRTF emitter (see AVANCE_HRTF_S): the head of the chain, so that the sound and the send both wait. Absent under a stereo panner.
  const emDel = estHrtf ? ctx.createDelay(0.1) : null;
  if (emDel) emDel.delayTime.value = AVANCE_HRTF_S;
  const tete = emDel || emIn;                                    // the node the low-pass and the send hang from
  const tIn = suivre(emIn.gain, 1), tSend = suivre(emSend.gain, 1), tFc = suivre(emLP.frequency, COUPURE_DEVANT), tGain = suivre(emG.gain, 1);
  let tPan = null, tPos = null;                                  // the followed parameters of the panner now in place
  const suivrePanneur = (initialPan = 0) => {
    tPan = null; tPos = null;
    if (emPan.positionX) tPos = [suivre(emPan.positionX, 0), suivre(emPan.positionY, 0), suivre(emPan.positionZ, 0)];
    else if (emPan.pan) tPan = suivre(emPan.pan, initialPan);
  };
  suivrePanneur();
  if (emDel) emIn.connect(emDel);
  tete.connect(emLP); emLP.connect(emPan); emPan.connect(emG);
  if (sortieSec) emG.connect(sortieSec);
  if (envoi) { tete.connect(emSend); emSend.connect(envoi); }

  let ferme = false, coupe = false, fin = -Infinity, cle = null, aInitialiser = true, versStereoDemande = false;
  let dernierT = -Infinity, mises = 0, sauts = 0, niveauEnvoi = 1, sautT = -Infinity, sautEnAttente = false, cibleT = -Infinity;
  let cible = null;                                              // the last values computed by placer(): { pan, fc, gain, x, y, z }
  const ap = { pan: null, fc: null, gain: null, x: null, y: null, z: null };   // what is on the parameters now

  function ecrirePosition(x, y, z, t, mode) {
    if (tPos) {
      const vs = [x, y, z];
      tPos.forEach((p, i) => mode === "aller" ? p.aller(vs[i], t, DUREE_SAUT) : mode === "fixer" ? p.fixer(vs[i], t) : p.cible(vs[i], t, CONSTANTE_PAN));
    } else if (typeof emPan.setPosition === "function") emPan.setPosition(x, y, z);
    ap.x = x; ap.y = y; ap.z = z;
  }
  function appliquer(mode, t) {                                  // mode: "fixer" (at once), "aller" (30 ms), "doux" (thresholds + time constants)
    let n = 0;
    const c = cible;
    if (estHrtf) {
      if (mode !== "doux" || ap.x === null || Math.hypot(c.x - ap.x, c.y - ap.y, c.z - ap.z) > SEUIL_POSITION) { ecrirePosition(c.x, c.y, c.z, t, mode); n++; }
    } else if (mode !== "doux" || ap.pan === null || Math.abs(c.pan - ap.pan) > SEUIL_PAN) {
      if (mode === "aller") tPan.aller(c.pan, t, DUREE_SAUT); else if (mode === "fixer") tPan.fixer(c.pan, t); else tPan.cible(c.pan, t, CONSTANTE_PAN);
      ap.pan = c.pan; n++;
    }
    if (mode !== "doux" || ap.fc === null || Math.abs(c.fc - ap.fc) > SEUIL_COUPURE) {
      if (mode === "aller") tFc.aller(c.fc, t, DUREE_SAUT); else if (mode === "fixer") tFc.fixer(c.fc, t); else tFc.cible(c.fc, t, CONSTANTE_COUPURE);
      ap.fc = c.fc; n++;
    }
    if (mode !== "doux" || ap.gain === null || dbEntre(c.gain, ap.gain) > SEUIL_GAIN_DB) {
      if (mode === "aller") tGain.aller(c.gain, t, DUREE_SAUT); else if (mode === "fixer") tGain.fixer(c.gain, t); else tGain.cible(c.gain, t, CONSTANTE_GAIN);
      ap.gain = c.gain; n++;
    }
    return n;
  }
  function remplacerParStereo(t) {
    if (ferme || !estHrtf) { versStereoDemande = false; return; }
    const ancien = emPan, neuf = ctx.createStereoPanner();
    emLP.disconnect(ancien); ancien.disconnect();
    neuf.pan.value = cible ? cible.pan : 0;
    emLP.connect(neuf); neuf.connect(emG);
    emPan = neuf; estHrtf = false; versStereoDemande = false;
    ap.pan = cible ? cible.pan : null; ap.x = ap.y = ap.z = null;
    suivrePanneur(cible ? cible.pan : 0);
    api.emPan = neuf;
  }

  const api = {
    entree: emIn, emIn, emDel, emLP, emPan, emG, emSend,
    /** The number of nodes this emitter holds (five, and the delay line under an HRTF panner). */
    get noeuds() { return 5 + (emDel ? 1 : 0); },
    /**
     * Places the emitter for the source `source` = { x, y?, z, ref?, coupure? } seen from `cam` = { x, z, yaw } at the audio time t.
     * `ref` is the reference distance of the gain by distance (absent: no distance law, as for a leak); `coupure` (Hz, optional) is a
     * second low-pass ceiling (the door's). mode: "doux" (default: at most every 50 ms, only on a change over the thresholds,
     * by setTargetAtTime), "debut" (at once: a new sound), "saut" (in 30 ms: the caller saw a jump of more than 0.6 m).
     * The first placement after occuper() is always "debut". A placement that follows saut(t) within 100 ms (the new place, told after
     * the jump, even on a later frame) is taken as a jump too. A source or a camera that is not a finite number (x, y, z, yaw) is
     * refused: nothing is touched, false is returned. Returns true when the parameters were touched.
     */
    placer(source, cam, t, mode = "doux") {
      if (ferme) return false;
      if (!(fini(source.x) && fini(source.y ?? 0) && fini(source.z) && fini(cam.x) && fini(cam.z) && fini(cam.yaw) && fini(t))) return false;
      const v = versLaTete(source, cam);
      const dist = Math.max(v.d, 0.05);
      const pos = positionTete(source, v);                       // never right inside the head
      const fc = Math.min(coupureDos(v.az), source.coupure > 0 ? source.coupure : Infinity);
      cible = { pan: panDe(v.az), fc, gain: gainDistance(dist, source.ref), x: pos.x, y: pos.y, z: pos.z };
      cibleT = t;
      if (aInitialiser) { aInitialiser = false; mode = "debut"; }
      else if (mode === "doux" && sautEnAttente && t - sautT >= -1e-6 && t - sautT <= FENETRE_SAUT) mode = "saut";   // saut() told the jump before this new place
      if (mode !== "doux") sautEnAttente = false;
      if (mode === "debut") { appliquer("fixer", t); dernierT = t; mises++; return true; }
      if (mode === "saut") { appliquer("aller", t); dernierT = t; mises++; sauts++; return true; }
      if (t - dernierT < INTERVALLE_MAJ) return false;
      if (appliquer("doux", t) === 0) return false;
      dernierT = t; mises++;
      return true;
    },
    /**
     * A jump: the last placed values (pan, filter, gain, position) are reached in 30 ms, no target curve left across it. When the new
     * place was not computed at this very instant (placer() at the same t), the jump stays pending for 100 ms: the next placer() takes it
     * as a jump (the new place is reached in 30 ms from where the parameters are, not by a sweep). Read the clock once, place, then jump.
     */
    saut(t) {
      if (ferme || !Number.isFinite(t)) return false;
      sautT = t; sautEnAttente = !(Math.abs(t - cibleT) < 1e-6);
      if (!cible) return false;
      appliquer("aller", t); dernierT = t; mises++; sauts++;
      return true;
    },
    /**
     * Takes the emitter for a sound of `duree` seconds starting at t; it stays taken duree + 0.1 s. `pos` (optional) is remembered.
     * A t or a duree that is not finite takes nothing. After occuper(), the emitter still wears the parameters of its last sound: the
     * CALLER places it at once, with the last camera it knows, placer(source, cam, tSon, "debut"), and starts the sound at tSon or after
     * (the placement then lands at the very start of the sound, never on top of the old place). Without that call, the first placement
     * is the next one of the frame loop, and the sound must not start before it. A cut emitter (couper(), etouffer()) stays silent:
     * only reprendre() lifts the cut, occuper() does not.
     */
    occuper(t, duree, pos) {
      if (ferme || !fini(t) || !fini(duree)) return;
      if (versStereoDemande && t >= fin) remplacerParStereo(t);
      if (pos) {
        const k = cleDePosition(pos);
        if (k !== cle || t >= fin) aInitialiser = true;
        cle = k;
      } else if (t >= fin) aInitialiser = true;
      fin = Math.max(fin, t + duree + MARGE_OCCUPE);
    },
    /** True when the emitter is free at t (its sound and 0.1 s are over). */
    libre(t) {
      const l = !ferme && t >= fin - 1e-9;
      if (l && versStereoDemande) remplacerParStereo(t);
      return l;
    },
    get fin() { return fin; },
    get cle() { return cle; },
    /** True once fermer() has unplugged the emitter (it is then never chosen). */
    get ferme() { return ferme; },
    /** True when the emitter holds a sound at the position `pos` (to the hundredth of a metre) at t. */
    tient(pos, t) { return !ferme && t < fin - 1e-9 && cle === cleDePosition(pos); },
    /** The cut: input and send to zero at once (value and automation), the emitter free. The button SON's gesture: the master is already down. `t` is the context's current time. */
    couper(t) {
      if (ferme || !fini(t)) return;
      tIn.fixer(0, t); tSend.fixer(0, t);
      coupe = true; fin = -Infinity; aInitialiser = true;
    },
    /**
     * The hush: input and send go to zero in `duree` seconds (60 ms by default), with no step, from the value they have at t (the figure
     * still in flight at a change of room). The emitter is cut (only reprendre() brings it back) and is free once the fade is over.
     * `t` is the context's current time. couper() stays the net gesture of the button SON.
     */
    etouffer(t, duree = 0.06) {
      if (ferme || !fini(t) || !fini(duree) || !(duree > 0)) return;
      tIn.aller(0, t, duree); tSend.aller(0, t, duree);
      coupe = true; fin = t + duree; aInitialiser = true;
    },
    /** After a cut or a hush: the input back to 1 and the send to its level, over `duree` seconds. `t` is the context's current time (call it with the same t as reglerEnvoi, no margin). */
    reprendre(t, duree = 0.1) {
      if (ferme || !fini(t) || !fini(duree) || !(duree > 0)) return;
      tIn.aller(1, t, duree); tSend.aller(niveauEnvoi, t, duree);
      coupe = false;
    },
    /**
     * The send level (linear, 0 or more) of this emitter to the network, by a time constant of 50 ms from `t`, the context's current time
     * (a ramp of reprendre() still running is cancelled from t: see suivre()). Returns true when the level is retained: it is put on the
     * node unless the emitter is cut, where only the retained level changes (reprendre() then raises the send to it). A negative level
     * or one that is not a finite number is refused (false, nothing touched).
     */
    reglerEnvoi(lineaire, t) {
      if (ferme || !fini(lineaire) || !(lineaire >= 0) || !fini(t)) return false;
      niveauEnvoi = lineaire;
      if (!coupe) tSend.cible(lineaire, t, 0.05);
      return true;
    },
    /** Replaces the HRTF panner by a stereo one, as soon as the emitter is free (at once if it is; at the next libre()/occuper() else). */
    versStereo() {
      if (ferme) return false;
      if (!estHrtf) return true;
      versStereoDemande = true;
      if (ctx.currentTime >= fin - 1e-9) { remplacerParStereo(ctx.currentTime); return true; }
      return false;
    },
    /** Unplugs every node of the emitter. */
    fermer() {
      if (ferme) return;
      ferme = true;
      for (const n of [emIn, emDel, emLP, emPan, emG, emSend]) { if (n) try { n.disconnect(); } catch (e) { /* already unplugged */ } }
    },
    get hrtf() { return estHrtf; },
    /** For the bench and the diagnostics: the counters and the values on the parameters. */
    etat() { return { mises, sauts, hrtf: estHrtf, avance: emDel ? AVANCE_HRTF_S : 0, fin, cle, ferme, coupe, appliques: { ...ap }, cible: cible ? { ...cible } : null }; },
  };
  return api;
}

/**
 * The emitter a sound at `pos` gets among `liste`: the one already holding that place (to the hundredth of a metre) at t, else a free
 * one (the one that last held the same place first, then the one free for longest), else null (the sound then goes out at the
 * centre, dry, as today). The emitter is taken for `duree` + 0.1 s from t. A closed emitter is skipped. A t or a duree that is not
 * finite: null. The caller then places the emitter it got at once (placer(..., tSon, "debut"), see occuper()).
 */
export function choisirEmetteur(liste, pos, t, duree) {
  if (!fini(t) || !fini(duree)) return null;
  const k = cleDePosition(pos);
  let choix = liste.find(e => !e.ferme && e.cle === k && !e.libre(t));          // a closed emitter (unplugged) is never handed out
  if (!choix) {
    const libres = liste.filter(e => !e.ferme && e.libre(t));
    choix = libres.find(e => e.cle === k) || libres.sort((a, b) => a.fin - b.fin)[0] || null;
  }
  if (!choix) return null;
  choix.occuper(t, duree, pos);
  return choix;
}
