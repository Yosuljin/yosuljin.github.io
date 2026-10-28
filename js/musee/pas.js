// The museum's footsteps: when a foot lands, how loud, and the sound of each floor. Pure module: no DOM, no Web
// Audio, no Math.random, no clock of its own (the caller passes the time), so Node can run it and the bench can measure it.
// - creerPas() decides WHEN a foot lands, from the distance the camera really moved between two frames. Never from the walk's
//   stored velocity (marche.js leaves it untouched when a wall pushes the body back) and never from a timer.
// - rendrePas() draws the samples of one step, silent at both ends, from a seed. The page copies them into an AudioBuffer once.
// - niveauPas(), foulee() are the two small laws: how loud, how long a stride.
// Every number below is a starting value for the ear (the table to adjust by listening); the judge is the bench's M4.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- 1. The two laws ----------
/** Length of a stride (m) for a real speed (m/s): 1.10 m at 2.5 m/s (2.27 steps per second), 1.50 m at 4.3 m/s (2.87 per second). */
export const foulee = v => clamp(0.55 + 0.22 * v, 0.62, 1.50);

/**
 * Level of a step in dB, relative to a walking step on stone. It is a RELATIVE level: the voice gain adds NIVEAU_VOIX_PAS_DB from
 * acoustique.js (NIVEAU_PAS_DBFS is the level at the output; the voice must also make up the bus, the master and the pan, less the make-up gain of the compressor and the limiter). Walking at 2.5 m/s: 0. Slower: down to -6 dB at 0.5 m/s. Running (above 3.3 m/s): up to +1.5 dB at 4.3 m/s.
 * A soft step (a foot that comes to rest) is -8 dB. `sol` adds the floor's own level (RECETTES[sol].niveau); without it, 0.
 */
export function niveauPas({ v = 2.5, course = false, doux = false } = {}, sol) {
  const sNiv = (sol && RECETTES[sol]) ? RECETTES[sol].niveau : 0;
  if (doux) return -8 + sNiv;
  const rel = course ? 1.5 * clamp((v - 3.3) / 1.0, 0, 1) : (v < 2.5 ? -6 * clamp((2.5 - v) / 2.0, 0, 1) : 0);
  return rel + sNiv;
}

// ---------- 2. The floors ----------
export const SOLS = ["pierre", "beton", "moquette", "carrelage", "parquet"];
/** The six seeds of the six variants of each floor (30 buffers): the set the bench's M4 measures. */
export const GRAINES = [1, 2, 3, 4, 5, 6];

// One recipe per floor, four layers from silence to silence. THE VALUES ARE THE ONES M4 LEFT: the brief's starting amplitudes put
// 20 to 70 % of a step above 2 kHz and 12 dB between raw and A-weighted level, so the heel was brought down and the knock up; the
// bodies sit higher in pitch than the brief's (stone 250 to 190 Hz, not 170 to 128), the carpet's heel lower (270 Hz, low-passed at
// 2.4 kHz). To be re-tuned by ear; M4 says when a change leaves the window.
// The layers: the heel (band-passed noise), the body (a sine that falls), the
// knock (a sine at 2.4 times the body, which a small speaker can render) and the toe (a second, softer contact), plus a ring
// (hard floors) or a hollow (wood). Amplitudes are relative to the heel's noise before the whole is brought to peak 1.
//   niveau: the floor's level in dB. The brief had stone 0, concrete -1, carpet -7, tiles -5, wood 0; the A-weighted 125 ms peak of a
//   step at -33 dBFS then fell outside the -56..-50 window for stone, wood, carpet and tiles, so all five were levelled to it (the bench prints it).
//   talon: { f Hz, q, att s, dec s, g }          corps: { f0 -> f1 Hz in `chute` s, att, dec, g }
//   toc: { g, dec } or null                       pointe: { delai s, f, q, dec, g } or null
//   anneau: { f, dec, g } or null                 creux: { f, q, dec, g } or null (re-tuned +-8 % at every step)
export const RECETTES = {
  pierre: { niveau: -1.5, talon: { f: 2800, q: 1.3, att: 0.0006, dec: 0.01287, g: 0.5725 }, corps: { f0: 250.4, f1: 188.5, chute: 0.05, att: 0.001, dec: 0.06689, g: 0.1434 }, toc: { g: 0.55, dec: 0.04709 }, pointe: { delai: 0.07, f: 1900, q: 1, dec: 0.02, g: 0.1789 }, anneau: { f: 5200, dec: 0.008, g: 0.04 }, creux: null },
  beton: { niveau: -1, talon: { f: 2100, q: 1, att: 0.0007, dec: 0.01506, g: 0.5192 }, corps: { f0: 218, f1: 162, chute: 0.06, att: 0.001, dec: 0.04792, g: 0.2553 }, toc: { g: 0.4609, dec: 0.0482 }, pointe: { delai: 0.075, f: 1500, q: 1, dec: 0.026, g: 0.2142 }, anneau: null, creux: null },
  moquette: { niveau: -3.5, talon: { f: 270, q: 0.7, att: 0.0015, dec: 0.0468, g: 1, lp: 2400 }, corps: { f0: 83.32, f1: 63.48, chute: 0.06, att: 0.002, dec: 0.05945, g: 0.095 }, toc: null, pointe: null, anneau: null, creux: null },
  carrelage: { niveau: -3.5, talon: { f: 3000, q: 1.3, att: 0.0005, dec: 0.0063, g: 0.6136 }, corps: { f0: 291.5, f1: 224.2, chute: 0.04, att: 0.001, dec: 0.04689, g: 0.1363 }, toc: { g: 0.3721, dec: 0.05593 }, pointe: { delai: 0.06, f: 2400, q: 1.2, dec: 0.012, g: 0.09787 }, anneau: { f: 4800, dec: 0.0135, g: 0.0296 }, creux: null },
  parquet: { niveau: -2.5, talon: { f: 1700, q: 0.9, att: 0.0008, dec: 0.026, g: 0.5 }, corps: { f0: 345, f1: 250, chute: 0.05, att: 0.001, dec: 0.166, g: 0.2341 }, toc: null, pointe: { delai: 0.08, f: 1300, q: 0.9, dec: 0.024, g: 0.1933 }, anneau: null, creux: { f: 230, q: 3, dec: 0.256, g: 0.9776 } },
};

let travail = new Float64Array(0);                // the working area of rendrePas, reused from one call to the next
export const DUREE_TAMPON = 0.26;                 // s: 12 480 samples at 48 000 Hz
const FONDU_FIN = 0.060;                          // s: the release at the end of the buffer (a squared raised cosine: the tail is under -40 dB well before the end)

// A seeded generator (4 lines) and a normal draw from it: all the "randomness" of a step comes from its seed.
function mulberry32(a) { return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(rng) { let u = 0; while (!u) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); }

// A Web Audio / RBJ biquad, one sample at a time (Q in dB for the high-pass, as the node has it).
function biquad(type, f0, Q, sr) {
  const w0 = 2 * Math.PI * Math.min(f0, sr * 0.499) / sr, cs = Math.cos(w0), sn = Math.sin(w0);
  let b0, b1, b2, a0, a1, a2;
  if (type === "highpass") { const al = sn / (2 * Math.pow(10, Q / 20)); b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else if (type === "lowpass") { const al = sn / (2 * Math.pow(10, Q / 20)); b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  else { const al = sn / (2 * Q); b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return x => { const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}

/**
 * One variant of a step: mono, `Float32Array(round(0.26 * sr))` (12 480 samples at 48 kHz), exactly 0 at the first and the last
 * sample, peak 1. Same floor + seed + foot + rate gives the same samples, always. `pied` 0 is the left foot, 1 the right:
 * the right foot has a body 3.5 % lower and a heel 6 % darker. The seed draws the noise, the heel's cut-off (+-8 %), the
 * body's pitch (+-5 %) and decay (+-20 %), the toe's delay and the hollow's tuning.
 */
export function rendrePas(sol, graine, sr = 48000, pied = 0) {
  const R = RECETTES[sol];
  if (!R) throw new Error("sol inconnu : " + sol);
  const n = Math.round(DUREE_TAMPON * sr);
  if (travail.length < n) travail = new Float64Array(n);
  const out = travail; out.fill(0, 0, n);                                // one scratch, grown once: only the result is allocated per step
  const rng = mulberry32(Math.imul(graine | 0, 7919) + 13), j = rel => 1 + (rng() * 2 - 1) * rel;
  const noise = k => { const r = mulberry32(Math.imul(graine | 0, 104729) + k); return () => gauss(r); };
  const droit = pied ? 1 : 0, T = R.talon, C = R.corps;
  const fT = T.f * j(0.08) * (droit ? 0.94 : 1), decT = T.dec * j(0.10);
  const fC = j(0.05) * (droit ? 0.965 : 1), f0 = C.f0 * fC, f1 = C.f1 * fC, decC = C.dec * j(0.20);
  const dPointe = R.pointe ? R.pointe.delai + (rng() * 2 - 1) * 0.008 : 0, fCreux = R.creux ? R.creux.f * j(0.08) : 0;
  const lv = () => Math.pow(10, (rng() * 2 - 1) / 20);                // +-1 dB on a component
  const att = (t, a) => t >= a ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * t / a);
  const dec = (tau) => Math.exp(-1 / (sr * tau));                     // per-sample factor of an exponential decay of constant tau
  const TWO_PI = 2 * Math.PI;

  // Heel: noise, band-passed around the floor's heel frequency, with a gentle high-pass so no boom rides on it (and, for a soft
  // floor, a low-pass: the carpet drinks the top).
  { const g = noise(1), bp = biquad("bandpass", fT, T.q, sr), hp = biquad("highpass", Math.max(250, fT * 0.28), -3, sr), lp = T.lp ? biquad("lowpass", T.lp, -3, sr) : null, k = dec(decT), lev = lv(); let e = 1;
    for (let i = 0; i < n; i++) { const y = hp(bp(g())); out[i] += (lp ? lp(y) : y) * att(i / sr, T.att) * e * T.g * lev; e *= k; } }
  // Body and knock: a sine whose pitch falls from f0 to f1 in `chute` seconds, and a sine at 2.4 times its pitch (the knock), each
  // with its own phase, its own pitch drift and its own level, so two variants never line up.
  { let ph = rng() * TWO_PI, ph2 = rng() * TWO_PI, eB = 1, eK = 1; const kB = dec(decC), kK = R.toc ? dec(R.toc.dec) : 1, ratio = f1 / f0, nCh = Math.round(C.chute * sr), rK = 2.4 * j(0.08), lB = lv(), lK = lv();
    for (let i = 0; i < n; i++) {
      const t = i / sr, f = i < nCh ? f0 * Math.pow(ratio, i / nCh) : f1;
      ph += TWO_PI * f / sr;
      out[i] += Math.sin(ph) * att(t, C.att) * eB * C.g * lB; eB *= kB;
      if (R.toc) { ph2 += TWO_PI * f * rK / sr; out[i] += Math.sin(ph2) * att(t, 0.001) * eK * R.toc.g * lK; eK *= kK; }
    } }
  // Ring of a hard floor: a short sine well above the body.
  if (R.anneau) { const A = R.anneau, ff = A.f * j(0.03), k = dec(A.dec); let ph = rng() * TWO_PI, e = 1;
    for (let i = 0; i < n; i++) { ph += TWO_PI * ff / sr; out[i] += Math.sin(ph) * att(i / sr, 0.0008) * e * A.g; e *= k; } }
  // Hollow of the wood: noise through a narrow band-pass, re-tuned at each step, a slow decay.
  if (R.creux) { const K = R.creux, g = noise(4), bp = biquad("bandpass", fCreux, K.q, sr), k = dec(K.dec); let e = 1;
    for (let i = 0; i < n; i++) { out[i] += bp(g()) * att(i / sr, 0.003) * e * K.g * 2.2; e *= k; } }
  // Toe: the second contact, a softer burst of noise a little later.
  if (R.pointe) { const P = R.pointe, g = noise(3), bp = biquad("bandpass", P.f * j(0.08), P.q, sr), k = dec(P.dec), i0 = Math.round(dPointe * sr); let e = 1;
    for (let i = i0; i < n; i++) { out[i] += bp(g()) * att((i - i0) / sr, 0.0006) * e * P.g * 1.4; e *= k; } }

  // Silent ends, unit peak.
  const fade = Math.round(FONDU_FIN * sr);
  for (let i = 0; i < fade; i++) { const c = 0.5 - 0.5 * Math.cos(Math.PI * i / fade); out[n - 1 - i] *= c * c; }
  let pk = 0; for (let i = 0; i < n; i++) { const a = Math.abs(out[i]); if (a > pk) pk = a; }
  const buf = new Float32Array(n), k = pk > 0 ? 1 / pk : 0;
  for (let i = 0; i < n; i++) buf[i] = out[i] * k;
  buf[0] = 0; buf[n - 1] = 0;
  return buf;
}

// ---------- 3. When a foot lands ----------
export const PAS = {
  vMin: 0.35,        // m/s: slower than this is a shuffle in place; the stride in progress is forgotten
  saut: 0.6,         // m in one frame: a teleport (the walk moves 0.215 m at most in a frame)
  sommeil: 0.25,     // s without a call: the loop slept (dialog, hidden tab); everything is forgotten
  premier: 0.30,     // m before the first foot of a walk (about 0.2 s at 2.5 m/s)
  premierApres: 200, // ms: and not sooner than this after the walk starts (a run covers 0.3 m in 0.14 s)
  course: 3.3,       // m/s: above it, a run
  tau: 0.12,         // s: smoothing of the speed that sets the stride
  tauArret: 0.04,    // s: smoothing of the speed that says "stopped"
  dtMax: 0.05,       // s: the walk integrates with this clamp (musee.js), so the speed is read with the same one
  douxMin: 0.45,     // part of a stride walked for a foot that comes to rest to step once, softly
  douxApres: 180,    // ms since the last step for that soft step
  douxParcouru: 0.9, // m walked in this walk before a soft step is allowed
};

/**
 * The decision "a foot lands". One call per drawn frame with the CAMERA position and the real clock (ms): `suivre(x, z,
 * nowMs, peut)` returns null, or `{ pied: 0|1, v, course, doux, db }` when a foot lands. `peut` is false while the visitor may not
 * walk (sitting, a dialog, before ENTRER, sound off, a plan open): the step is lost, not caught up. A teleport (more than
 * 0.6 m in a frame) or a sleep of the loop (more than 0.25 s) gives silence and forgets the stride. The glide that follows a
 * dialog or a sitting (a speed that only falls from the first frames on) is recognised and ignored. A foot that comes to
 * rest steps once, softly (-8 dB). `remise()` forgets everything, the position too. A position or a time that is not a finite number
 * does the same (nothing is heard, nothing is kept). Two calls with the same time stamp count as one frame: the second is ignored.
 * `db` of a returned step is the level WITHOUT the floor: the caller asks niveauPas(step, sol) for the final one.
 */
export function creerPas(options = {}) {
  const o = { ...PAS, ...options };
  let px = NaN, pz = NaN, tp = NaN, pied = 0, dernier = -1e9;
  let debut = 0, v = 0, vf = 0, vm = 0, marche = false, depart = false, glisse = false, age = 0, dist = 0, parcouru = 0, spPrec = 0;
  const oublier = () => { v = 0; vf = 0; vm = 0; marche = false; depart = false; glisse = false; age = 0; dist = 0; parcouru = 0; spPrec = 0; };
  const remise = () => { px = pz = tp = NaN; oublier(); };
  function suivre(x, z, nowMs, peut) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(nowMs)) { remise(); return null; }
    const dt = (nowMs - tp) / 1000, premiere = !Number.isFinite(tp);
    // The same time stamp (a coarse clock, a replayed frame): nothing has elapsed. Nothing is kept either, so the next frame reads the whole move over the whole time.
    if (peut && !premiere && dt === 0) return null;
    const d = Math.hypot(x - px, z - pz);
    px = x; pz = z; tp = nowMs;
    if (!peut || premiere || !(dt > 0) || dt > o.sommeil || d > o.saut) { oublier(); return null; }
    const dte = Math.min(dt, o.dtMax), sp = d / dte;
    // The glide after a dialog or a sitting is not a walk: it ends when the speed is gone, or when it rises again (a key pressed).
    if (glisse) {
      if (sp < o.vMin) { glisse = false; spPrec = sp; return null; }
      if (sp <= spPrec * Math.exp(2 * dte) + 0.05) { spPrec = sp; return null; }
      glisse = false;                                             // it rises again: a new walk starts from this frame
    }
    v += (sp - v) * (1 - Math.exp(-dte / o.tau));
    vf += (sp - vf) * (1 - Math.exp(-dte / o.tauArret));
    if (!marche) {
      if (sp < o.vMin && vf < o.vMin) return null;                // standing
      marche = true; depart = false; age = 0; dist = 0; parcouru = 0; vm = sp; debut = nowMs - dte * 1000;
    } else if (age < 4 && spPrec > 1.0 && sp < spPrec * Math.exp(-4 * dte)) {
      // Only falling from the first frames on, from a speed a standing start never has: the glide.
      oublier(); glisse = true; spPrec = sp; return null;
    } else if (sp >= o.vMin) vm = 0.7 * vm + 0.3 * sp;
    // Stopped: a foot that comes to rest steps once, softly; the stride in progress is forgotten.
    if (sp < o.vMin && vf < o.vMin) {
      let doux = null;
      if (parcouru > o.douxParcouru && dist > o.douxMin * foulee(vm) && nowMs - dernier > o.douxApres) {
        pied ^= 1; dernier = nowMs;
        doux = { pied, v: vm, course: false, doux: true, db: niveauPas({ v: vm, doux: true }) };
      }
      oublier();
      return doux;
    }
    age++; spPrec = sp;
    dist += d; parcouru += d;
    const seuil = depart ? foulee(Math.max(v, o.vMin)) : o.premier;
    if (dist < seuil || (!depart && nowMs - debut < o.premierApres)) return null;
    dist = depart ? Math.min(dist - seuil, seuil) : 0;                   // the first foot starts the count of the strides
    depart = true; pied ^= 1; dernier = nowMs;
    const course = v > o.course;
    return { pied, v, course, doux: false, db: niveauPas({ v, course }) };
  }
  return { suivre, remise };
}
