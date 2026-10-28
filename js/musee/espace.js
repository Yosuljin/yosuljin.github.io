// The museum's spatial layer: the assembly (SPEC-son-musee.md, 4.2 to 4.13). It takes what the neighbours offer and puts it in one place:
//   acoustique.js (the table of the rooms, the floors, the weights that glide through the doors), pas.js (when a foot lands, and its samples),
//   reseau.js (the network of delays: the resonance), emetteurs.js (where a sound comes from) and murs.js (what the walls answer to a step).
// It imports NEITHER sound.js (the layer is handed in by sound.js' brancherEspace(): the museum gives it a factory) NOR the DOM at load time: every
// access to the page (window, navigator, document, matchMedia, timers) is inside a function and guarded, so Node plays the module as it is.
// Four states, chosen alone and only ever lowered during a visit (never raised, never stored):
//   0 absent (the site's own sound, nothing added), 1 steps alone (mono, dry, with two beaten echoes per room), 2 room (stereo: the network of
//   delays, left and right feet, two emitters panned), 3 full (state 2, the HRTF on the two emitters and the reflections of the walls).
// Everything is a starting value tied to the SPEC; the bench's E1 to E14 measure it. The layer never throws to its caller: a fault is caught and
// counted, and the third one closes the layer (the site's own sound goes on). No storage key, no file, no remote resource, no convolution.
import { ACOUSTIQUE, HRTF_ACTIF, PAN_PIED, poidsSalles, solEn, positionVerre, gainVoixPas, ecartPasDb } from "./acoustique.js?v=20261025-r28";
import { creerPas, rendrePas, GRAINES, SOLS, DUREE_TAMPON } from "./pas.js?v=20261025-r28";
import { creerReseau, amorcer } from "./reseau.js?v=20261025-r28";
import { creerEmetteur, choisirEmetteur, sourceDePorte, passeBasPorte, SEUIL_SAUT_M, OREILLE } from "./emetteurs.js?v=20261025-r28";
import { reflexions, cuire, creerReserve, COMPENSATION_PIED_DB } from "./murs.js?v=20261025-r28";

export const ETATS = Object.freeze({ absent: 0, pas: 1, salle: 2, plein: 3 });

// ---------- Constants (starting values) ----------
// The network's processor lives in its own file (a worklet module): one address, the same token as the other modules of the sound.
const URL_WORKLET = new URL("./reseau-worklet.js?v=20261025-r28", import.meta.url).href;
const SR_TAMPON = 48000;                  // the step buffers are made at 48 kHz whatever the context's rate (the engine resamples at play time)
const DECALAGE_PAS_S = 0.01;              // a step is scheduled 10 ms ahead of the audio clock
const ECART_RATE = 0.06;                  // playbackRate +- 6 %
const VOIX_MAX = 6;                       // steps sounding at once; the oldest goes out in 20 ms
const EXTINCTION_S = 0.02;
const MARGE_ARRET_S = 0.02;               // a source is stopped this long after the end of its envelope
const FILTRE_ECHOS_HZ = 2200;             // the low-pass of the two beaten echoes (state 1)
const PAS_MAJ_S = 0.05;                   // the mix is written at most 20 times a second
const TAU_MELANGE = 0.12, TAU_MELANGE_SAUT = 0.25;
const SEUIL_RT60 = 0.04, SEUIL_FC = 0.06, SEUIL_ENVOI_DB = 0.25;     // a mixed parameter is written only when it moved this far (logarithmic for the first two): few events per second
const DUCK = { emetteurs: -9, retour: -4, pas: -2, attaque: 0.12, relache: 0.5 };
const CREUX_ESP = 0.1, CREUX_BAISSE_S = 0.03, CREUX_REMONTE_S = 0.12;  // the dip of espOut at a jump
const PURGE_S = 0.2, REMONTEE_S = 0.1;   // after a cut: the purge, then espOut rises
const SOMMEIL_FACTEUR = 1.1, SOMMEIL_MARGE_S = 0.4;   // the network stays plugged: the length of the sound sent + 1.1 x rt60 + 0.4 s
// a leak: 3 s of stillness first, then 20 s at least between two (so three in any 60 s window, half-open, whatever calls fuite(): the layer holds the ceiling itself)
const FUITE_ARRET_S = 3, FUITE_ENTRE_S = 20, FUITE_NIVEAU_LIN = Math.pow(10, -3 / 20);
const VEILLE = { fenetreS: 2, rapport: 0.94, fenetres: 2, intervalle: 45, fenetreImagesMs: 4000, imagesMin: 20, visibleMs: 1900, entreDescentesMs: 6000 };
const FAUTES_MAX = 3;
export const DELAIS = { liberation: 3500, versStereo: 3200, fermeture: 130 };   // ms; a test may shorten them
const dbLin = db => Math.pow(10, db / 20);
// What the foot panner takes from a step (the equal-power law at pan +-PAN_PIED, one channel): NIVEAU_VOIX_PAS_DB already counts it, so at state 1,
// where the step goes straight to the bus, the voice gain gives it back (else the step would sound 2.1 dB louder than at states 2 and 3).
const PERTE_PANNEUR_LIN = Math.cos((1 - PAN_PIED) * Math.PI / 4);
const finiN = Number.isFinite;

// ---------- The state of the layer, chosen alone ----------
/** The page the choice is read from, when no argument is given: { coarse, minSide, cores, memory, saveData, stereoPanner, hostname, search }. */
export function lireEnv() {
  const w = typeof window !== "undefined" ? window : null, n = typeof navigator !== "undefined" ? navigator : {};
  const nombre = (v, repli) => (finiN(v) && v > 0 ? v : repli);
  let coarse = false;
  try { coarse = !!(w && w.matchMedia && w.matchMedia("(pointer: coarse)").matches); } catch { /* no media query */ }
  const sc = (w && w.screen) || {};
  return {
    coarse,
    minSide: Math.min(nombre(sc.width, w ? w.innerWidth : 1280) || 1280, nombre(sc.height, w ? w.innerHeight : 800) || 800),
    cores: nombre(n.hardwareConcurrency, 4), memory: nombre(n.deviceMemory, 4),
    saveData: !!(n.connection && n.connection.saveData),
    stereoPanner: typeof StereoPannerNode === "function",
    hostname: (w && w.location && w.location.hostname) || "", search: (w && w.location && w.location.search) || "",
  };
}
const boucleLocale = h => /^(localhost|127\.0\.0\.1)$/.test(h || "");
/**
 * The state at the start of a visit (SPEC 4.2): t = (coarse || minSide < 600) ? 1 : 2, minus 1 when cores <= 4 or memory <= 2 (floor 0) as
 * world.js does for the image; the state is t + 1, capped at 2 with saveData and at 1 without a StereoPannerNode; `?son=0|1|2|3` wins, on
 * localhost and 127.0.0.1 only. Pure: the environment is an argument.
 */
export function palierSon(env = lireEnv()) {
  const cores = env.cores || 4, memory = env.memory || 4;
  let t = (env.coarse || env.minSide < 600) ? 1 : 2;
  if (cores <= 4 || memory <= 2) t = Math.max(0, t - 1);
  let etat = t + 1;
  if (env.saveData) etat = Math.min(etat, 2);
  if (env.stereoPanner === false) etat = Math.min(etat, 1);
  if (boucleLocale(env.hostname)) {
    const v = new URLSearchParams(env.search || "").get("son");
    if (v !== null && /^[0-3]$/.test(v)) etat = +v;
  }
  return etat;
}
const EFFETS = ["fuites", "murs", "verre", "duck", "pont", "hrtf", "pas", "modulation"];     // "modulation": the network's delay times stay fixed (the bench's E13 uses it to find what makes two renders of one seed differ)
/** The effects `?sans=fuites,murs,...` removes (local QA only; the eighth, `modulation`, is the bench's). Returns an object { fuites: bool, ... }. */
export function lireSans(env = lireEnv()) {
  const r = Object.fromEntries(EFFETS.map(e => [e, false]));
  if (!boucleLocale(env.hostname)) return r;
  const v = new URLSearchParams(env.search || "").get("sans");
  if (v) for (const e of v.split(",")) if (e.trim() in r) r[e.trim()] = true;
  return r;
}

// ---------- The mix of the rooms, from a table ----------
const logMoy = (a, b, w, k) => Math.exp(w[0] * Math.log(a[k]) + w[1] * Math.log(b[k]));
/**
 * The sound of the museum at a point from a table: the same numbers as acoustique.js' melange(), but on the table the layer was given
 * (the tests change it). Returns { rt60, fc, envoi: { pas, figure, verre }, poids }.
 */
export function melangerTable(table, x, z) {
  const poids = poidsSalles(x, z), a = table[poids.salle || "hall"], b = table[poids.voisine || poids.salle || "hall"], w = poids.w.map(v => v * v);
  const envoi = {};
  for (const k of ["pas", "figure", "verre"]) envoi[k] = w[0] * a.envoi[k] + w[1] * b.envoi[k];
  return { rt60: logMoy(a, b, w, "rt60Boucle"), fc: logMoy(a, b, w, "fc"), envoi, poids };
}

// ---------- The samples of the steps, made before the first gesture ----------
// One variant per task, so that no task keeps the page busy for long (a step is a few milliseconds of plain JavaScript). Seeds 1 to 6: the
// odd ones are the right foot, the even ones the left (the set pas.js' bench M4 measures).
const tampons = new Map();                // "sol:graine" -> Float32Array
let preparation = null;
const PIED_DE = g => g & 1;
const GRAINES_DU_PIED = [GRAINES.filter(g => !PIED_DE(g)), GRAINES.filter(g => PIED_DE(g))];
const cleTampon = (sol, g) => sol + ":" + g;
/**
 * Starts the making of the step samples, before any gesture: the floor of the arrival room first (`arrivee`, the hall by default), then the
 * hall's, then the others. Nothing at state 0; no effect when already started. Returns a promise that settles when everything is made (the
 * museum does not wait for it). `immediat: true` makes everything at once (the bench and the tests).
 */
export function preparer({ arrivee = "hall", immediat = false, palier = null, table = ACOUSTIQUE } = {}) {
  if (preparation) return preparation;
  if ((palier ?? palierSon()) === 0) return Promise.resolve(false);
  const ordre = [];
  for (const sol of [(table[arrivee] || table.hall).sol, table.hall.sol, ...SOLS]) if (!ordre.includes(sol)) ordre.push(sol);
  const taches = [];
  for (const sol of ordre) for (const g of GRAINES) taches.push([sol, g]);
  preparation = new Promise(fini => {
    let i = 0;
    const un = () => {
      if (i >= taches.length) { fini(true); return; }
      const [sol, g] = taches[i++];
      try { if (!tampons.has(cleTampon(sol, g))) tampons.set(cleTampon(sol, g), rendrePas(sol, g, SR_TAMPON, PIED_DE(g))); } catch { /* a variant that fails is a variant missing */ }
      if (immediat) un(); else planifier(un);
    };
    if (immediat) un(); else planifier(un);
  });
  return preparation;
}
function planifier(f) {
  if (typeof requestIdleCallback === "function") requestIdleCallback(() => f(), { timeout: 400 });
  else setTimeout(f, 40);
}
/** For the tests: forgets the made samples. */
export function oublierTampons() { tampons.clear(); preparation = null; }
/** For the tests and the bench: the keys of the samples made so far, in the order they were made ("sol:graine"). */
export const clesTampons = () => [...tampons.keys()];

// ---------- The layer ----------
/**
 * Builds the layer on `ctx`, its output going to `sortie` (the bus of sound.js). Returns null at state 0. Options: `ouvert()` (may a sound start now), `table`
 * (the rooms' table), `hasard` (a function returning [0, 1): every random choice), `horloge()` (the wall clock in ms: performance.now by default),
 * `horsLigne` (rendering into an OfflineAudioContext: the audio clock is the clock given, never ctx.currentTime, and no timer, no watching, no sleep),
 * `palier` (the state), `essais` (expose the probes `sondes` for the bench), `Worklet` (the class of the network's node: AudioWorkletNode by default) and
 * `urlWorklet` (the address of the network's module). Offline, the caller has awaited chargerWorklet(ctx, url) of reseau.js first. Extras for the tests: `env` (what ?sans= and the page's address read; the state is `palier`, a separate option), `amorcage`
 * (async () => ({ ok })), `Offline` (the class of the start-up check), `media` (matchMedia), `visible()`, `detecteur` (a { suivre, remise } of steps).
 */
export function creerEspace({ ctx, sortie: bus, ouvert = () => true, table = ACOUSTIQUE, hasard = Math.random, horloge = null, horsLigne = false, palier = palierSon(), essais = false,
  Worklet = null, urlWorklet = URL_WORKLET, env = null, amorcage = null, Offline = null, media = null, visible = null, detecteur = null } = {}) {
  if (!ctx || !bus) return null;
  let etat = palier | 0;
  if (!(etat >= 1)) return null;                                           // state 0: nothing is built
  etat = Math.min(etat, 3);
  // The network is a worklet: without a worklet on the context, or without a node class to build it with, the layer starts at state 1 (the context stays as it is).
  const NoeudWorklet = Worklet || (typeof AudioWorkletNode === "function" ? AudioWorkletNode : null);
  const aWorklet = !!(ctx.audioWorklet && typeof ctx.audioWorklet.addModule === "function") && typeof NoeudWorklet === "function";
  if (etat >= 2 && (typeof ctx.createStereoPanner !== "function" || !aWorklet)) etat = 1;
  const lieu = env || lireEnv(), sans = lireSans(lieu);
  const mediaRequete = media || (typeof matchMedia === "function" ? matchMedia : null);
  let reduit = null;
  try { reduit = mediaRequete ? mediaRequete("(prefers-reduced-motion: reduce)") : null; } catch { reduit = null; }
  if (reduit && reduit.matches) return null;                               // the museum does not open with reduced motion; the layer neither
  const estVisible = visible || (() => typeof document === "undefined" || document.visibilityState === "visible");

  // ----- clocks
  let dernierNow = 0, enImage = false;
  const mur = () => (horloge ? horloge() : (typeof performance !== "undefined" ? performance.now() : Date.now()));
  // Offline: inside a frame the audio clock is that frame's nowMs / 1000; between frames it is the injected clock (else the last frame's). Never ctx.currentTime.
  const tAudio = () => (horsLigne ? (enImage || !horloge ? dernierNow : horloge()) / 1000 : ctx.currentTime);

  // ----- state
  let ferme = false, muet = false, reprise = null, fermeture = null, salleId = null, fautes = 0;
  let cam = null, camPrec = null, dernierMouvement = -1e9, dernierNowMs = null, dernierDeltaMs = 0;
  let sommeilAu = -Infinity, reseauPret = horsLigne, poidsVus = null, minuterie = 0;
  let courant = null, dernierMelange = -1e9, mixEnAttente = true, voixPrec = false, dernierSaut = -1e9, dip = null;
  let derniereFuite = null, derniereFuiteT = -1e9, derniereVoixT = -1e9;
  let descentes = 0, derniereDescente = -1e9, lents = 0, rapportVeille = null, veilleRef = null, vuDepuis = null, sommeInt = 0, nInt = 0, fenInt0 = null, ticks = 0;
  const voix = [], historique = [[], []], journalPas = essais ? [] : null;
  let joues = 0, perdus = 0;
  let vivantes = [];                                                        // the step sources still sounding or scheduled: their end on the audio clock
  const permanents = [];                                                    // the nodes of the layer itself (the network and the emitters count apart)
  const nouveau = n => { permanents.push(n); return n; };
  const tamponsAudio = new Map();
  const suiveur = detecteur || creerPas();

  // ----- the graph
  const pasBus = nouveau(ctx.createGain());
  let espOut = null, emBus = null, pieds = null, pasSend = null, reseau = null, emetteurs = [], reserve = null, lpEcho = null;
  const infos = new Map(), attente = new Map();                            // emitter -> { classe, src, finSon } ; emitter -> time to lift its hush
  function batirHaut() {
    espOut = nouveau(ctx.createGain()); emBus = nouveau(ctx.createGain()); pasSend = nouveau(ctx.createGain());
    const g = nouveau(ctx.createStereoPanner()), d = nouveau(ctx.createStereoPanner());
    g.pan.value = -PAN_PIED; d.pan.value = PAN_PIED; pieds = [g, d];
    pasSend.gain.value = dbLin(table.hall.envoi.pas);
    // A failure of the module, of the node or of its processor (processorerror) takes the layer down to state 1: the steps stay, dry.
    reseau = creerReseau(ctx, { rt60: table.hall.rt60Boucle, fc: table.hall.fc, pont: sans.pont ? null : undefined, modulation: !sans.modulation, urlWorklet, NoeudWorklet, surPanne: () => { if (!ferme) versEtat1(); } });
    for (const p of pieds) p.connect(pasBus);
    pasBus.connect(espOut); emBus.connect(espOut); espOut.connect(bus);
    pasSend.connect(reseau.entree);
    for (let i = 0; i < 2; i++) emetteurs.push(creerEmetteur(ctx, { palier: etat, sortieSec: emBus, envoi: reseau.entree, hrtf: HRTF_ACTIF && !sans.hrtf }));
    // the send of an emitter starts at the table's level, not at 0 dB: the first figure of the visit does not push too much into the network during its attack
    for (const e of emetteurs) e.reglerEnvoi(dbLin(table.hall.envoi.figure), tAudio());
    if (etat >= 3 && !sans.murs) reserve = creerReserve(ctx, 6, 0.25, SR_TAMPON);
  }
  function batirBas() {
    lpEcho = nouveau(ctx.createBiquadFilter()); lpEcho.type = "lowpass"; lpEcho.frequency.value = FILTRE_ECHOS_HZ; lpEcho.Q.value = -3;
    lpEcho.connect(pasBus); pasBus.connect(bus);
  }
  let hautBati = false;
  if (etat >= 2) {
    // A failure of the upper part (a panner refused, a delay line, the network) must not leave the visitor without steps: what was made is unplugged and the layer starts at state 1.
    try { batirHaut(); hautBati = true; }
    catch {
      for (const n of permanents.splice(1)) { try { n.disconnect(); } catch { /* unplugged */ } }   // permanents[0] is pasBus
      try { pasBus.disconnect(); } catch { /* unplugged */ }
      try { if (reseau) reseau.fermer(); } catch { /* a late answer of the module must insert nothing */ }
      espOut = emBus = pasSend = reseau = reserve = pieds = null; emetteurs = []; etat = 1;
    }
  }
  if (!hautBati) batirBas();
  courant = { rt60: table.hall.rt60Boucle, fc: table.hall.fc, pas: table.hall.envoi.pas };

  const sortieMute = () => (etat >= 2 && espOut ? espOut : pasBus);        // the gain that carries the cut
  const nbNoeuds = () => permanents.length + (reseau ? reseau.noeuds : 0) + emetteurs.reduce((n, e) => n + (e.noeuds ?? 5), 0);

  // ----- the two answers the network waits for (asynchronous): it is built asleep, unplugged, and only used once BOTH have come in:
  //   1. the start-up check (amorcer: the module loads in a fresh offline context and renders one impact: the calculation runs),
  //   2. reseau.pret (the module is loaded in THIS context and the node is in place).
  // Either one false, or rejected: state 1 (the first door, as a failed check was). A layer closed while waiting counts for nothing.
  if (etat >= 2 && !horsLigne) {
    let verifOk = false, noeudOk = false;
    const accord = () => { if (verifOk && noeudOk) reseauPret = true; };
    const verif = amorcage || (() => amorcer(Offline || (typeof OfflineAudioContext === "function" ? OfflineAudioContext : typeof webkitOfflineAudioContext === "function" ? webkitOfflineAudioContext : null), { pont: sans.pont ? null : undefined, urlWorklet, NoeudWorklet }));
    Promise.resolve().then(verif).then(r => {
      if (ferme) return;
      if (r && r.ok) { verifOk = true; accord(); } else versEtat1();
    }, () => { if (!ferme) versEtat1(); });
    Promise.resolve(reseau && reseau.pret).then(ok => {
      if (ferme) return;
      if (ok === true) { noeudOk = true; accord(); } else versEtat1();
    }, () => { if (!ferme) versEtat1(); });
  }

  // ----- faults
  function faute() { if (++fautes >= FAUTES_MAX) fermer(); }

  // ----- steps
  const aBuffer = (sol, g) => {
    const k = cleTampon(sol, g);
    let b = tamponsAudio.get(k);
    if (b) return b;
    const f = tampons.get(k);
    if (!f) return null;
    b = ctx.createBuffer(1, f.length, SR_TAMPON);
    b.copyToChannel(f, 0);
    tamponsAudio.set(k, b);
    return b;
  };
  function choisirVariante(sol, pied) {
    const toutes = GRAINES_DU_PIED[pied].filter(g => tampons.has(cleTampon(sol, g)));
    if (!toutes.length) return null;
    const h = historique[pied];
    // three variants a foot: only the last one is left out (two choices, drawn by hasard()); the two last, when the floor has more than three
    let ok = toutes.filter(g => toutes.length > 3 ? !h.includes(g) : g !== h[h.length - 1]);
    if (!ok.length) ok = toutes.filter(g => g !== h[h.length - 1]);
    if (!ok.length) ok = toutes;
    const g = ok[Math.min(ok.length - 1, Math.floor(hasard() * ok.length))];
    h.push(g); if (h.length > 2) h.shift();
    return g;
  }
  function fondreVoix(v, t) {
    for (const s of v.sources) { try { s.g.gain.cancelScheduledValues(t); s.g.gain.setValueAtTime(s.gain, t); s.g.gain.linearRampToValueAtTime(0, t + EXTINCTION_S); s.src.stop(t + EXTINCTION_S + 0.005); } catch { /* already over */ } }
  }
  function source(buf, taux, gain, t0, cible, v) {
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; src.playbackRate.value = taux; g.gain.value = gain;
    src.connect(g); g.connect(cible);
    const fin = t0 + buf.duration / taux + MARGE_ARRET_S;
    const s = { src, g, gain, fin };
    vivantes.push(s);
    // Offline there is no clean-up while the render runs: `onended` is a main-thread callback that fires at whatever moment the engine reaches the end of
    // the source, a race inside the render itself (the bench's E13 asks for identical renders). A finite render frees everything when it is dropped.
    if (!horsLigne) src.onended = () => { try { src.disconnect(); g.disconnect(); } catch { /* unplugged */ } };
    src.start(t0); src.stop(fin);
    v.sources.push(s); v.fin = Math.max(v.fin, fin);
    return s;
  }
  /** One step. `r` is what suivre() gave; `c` the camera; `t` the audio clock now. Returns true when a step sounded. */
  function jouerPas(r, c, t) {
    const room = poidsSalles(c.x, c.z).salle || salleId || "hall";
    const sol = solEn(room, c.x, c.z);
    const pied = r.pied & 1, graine = choisirVariante(sol, pied);
    if (graine === null) { perdus++; return false; }
    const buf = aBuffer(sol, graine);
    if (!buf) { perdus++; return false; }
    const taux = 1 + (hasard() * 2 - 1) * ECART_RATE, gain = gainVoixPas(r, sol, ecartPasDb(hasard)) * (etat >= 2 ? 1 : PERTE_PANNEUR_LIN);
    const t0 = t + DECALAGE_PAS_S;
    for (let i = voix.length - 1; i >= 0; i--) if (voix[i].fin < t) voix.splice(i, 1);
    vivantes = vivantes.filter(q => q.fin > t);
    while (voix.length >= VOIX_MAX) fondreVoix(voix.shift(), t);
    const v = { sources: [], fin: t0, t0 };
    if (etat >= 2) {
      source(buf, taux, gain, t0, pieds[pied], v);
      source(buf, taux, gain, t0, pasSend, v);                              // only the dry step goes to the network
      if (etat >= 3 && reserve && !sans.murs) {
        const lste = reflexions(c.x, c.z, c.yaw, poidsSalles(c.x, c.z).salle);
        if (lste.length) {
          const slot = reserve.prendre();
          if (cuire(tampons.get(cleTampon(sol, graine)), lste, SR_TAMPON, slot) > 0) {
            slot.ecrire();
            source(slot.buffer, taux, gain * dbLin(COMPENSATION_PIED_DB), t0, pasBus, v);
          }
        }
      }
      envoyer(t0, DUREE_TAMPON, courant.rt60);
    } else {
      source(buf, taux, gain, t0, pasBus, v);
      const echos = table[room] && table[room].echos;
      if (echos) for (const [ms, db] of echos) source(buf, taux, gain * dbLin(db), t0 + ms / 1000, lpEcho, v);   // two beaten echoes, 12 and 18 dB under the step
    }
    voix.push(v);
    joues++;
    if (journalPas) journalPas.push({ t: t0, pied, v: r.v, course: !!r.course, doux: !!r.doux, sol, graine, taux, gainDb: 20 * Math.log10(gain), salle: room });
    return true;
  }

  // ----- the sleep of the network: plugged while something is being sent (`duree` s from `t`) and for 1.1 x rt60 + 0.4 s after
  function envoyer(t, duree, rt60) {
    if (!reseau || !reseauPret || muet || ferme) return;
    reseau.dernierEnvoi = t;
    sommeilAu = Math.max(sommeilAu, t + duree + SOMMEIL_FACTEUR * rt60 + SOMMEIL_MARGE_S);
    if (!reseau.estBranche()) reseau.brancher(espOut);
  }
  // The sleep saves the processor of a live page. A render offline is ONE snapshot of the graph: a disconnect made while the frames are being
  // scheduled mutes the network from the first sample of the render to the last (the bench measured the tail of every room at 0.22 s for that reason).
  // So offline the network never sleeps: only a cut (couper) unplugs it, as live.
  function dormir(t) { if (!horsLigne && reseau && reseau.estBranche() && t > sommeilAu) reseau.debrancher(); }

  // ----- the mix of the room
  function ecrireMelange(m, t, tau, force) {
    if (etat < 2 || !reseau) return;
    const c = courant;
    if (force || Math.abs(Math.log(m.rt60 / c.rt60)) > SEUIL_RT60) { reseau.regler({ rt60: m.rt60 }, t, tau); c.rt60 = m.rt60; }
    if (force || Math.abs(Math.log(m.fc / c.fc)) > SEUIL_FC) { reseau.regler({ fc: m.fc }, t, tau); c.fc = m.fc; }
    if (force || Math.abs(m.envoi.pas - c.pas) > SEUIL_ENVOI_DB) { pasSend.gain.setTargetAtTime(dbLin(m.envoi.pas), t, tau); c.pas = m.envoi.pas; }
    for (const e of emetteurs) {
      const i = infos.get(e);
      if (!i || i.classe === "fuite" || t >= i.finSon || attente.has(e)) continue;
      const db = m.envoi[i.classe];
      if (force || Math.abs(db - i.envoiDb) > SEUIL_ENVOI_DB) { e.reglerEnvoi(dbLin(db), t); i.envoiDb = db; }
    }
  }
  function appliquerDuck(parle, t) {
    const tau = parle ? DUCK.attaque : DUCK.relache;
    if (etat >= 2) { emBus.gain.setTargetAtTime(parle ? dbLin(DUCK.emetteurs) : 1, t, tau); reseau.sortie.gain.setTargetAtTime(parle ? dbLin(DUCK.retour) : 1, t, tau); }
    pasBus.gain.setTargetAtTime(parle ? dbLin(DUCK.pas) : 1, t, tau);
  }
  // espOut's level at t, worked out from its own plan (a dip in progress), never read back from the parameter
  function niveauEsp(t) {
    if (!dip || t >= dip.t0 + CREUX_BAISSE_S + CREUX_REMONTE_S) return 1;
    if (t <= dip.t0) return dip.v0;
    if (t <= dip.t0 + CREUX_BAISSE_S) return dip.v0 + (CREUX_ESP - dip.v0) * (t - dip.t0) / CREUX_BAISSE_S;
    return CREUX_ESP + (1 - CREUX_ESP) * (t - dip.t0 - CREUX_BAISSE_S) / CREUX_REMONTE_S;
  }
  function creuxEsp(t) {
    if (etat < 2 || muet) return;
    const v = niveauEsp(t), p = espOut.gain;
    p.cancelScheduledValues(t); p.setValueAtTime(v, t);
    p.linearRampToValueAtTime(CREUX_ESP, t + CREUX_BAISSE_S); p.linearRampToValueAtTime(1, t + CREUX_BAISSE_S + CREUX_REMONTE_S);
    dip = { t0: t, v0: v };
  }

  // ----- the emitters
  function sourceDeInfo(i, c) {
    if (i.classe === "fuite") {
      const p = sourceDePorte(i.ou, c);
      if (!p) return null;
      const d = Math.max(Math.hypot(p.x - c.x, p.z - c.z), 0.05);
      return { x: p.x, y: OREILLE, z: p.z, coupure: passeBasPorte(p.dansAxe), ref: FUITE_NIVEAU_LIN * d };   // ref = 0.708 d : the direct gain is exactly 3 dB under the figure
    }
    return i.src;
  }
  const reprendreEmetteur = (e, t) => e.reprendre(t, 0.2);                 // after a hush: back up in 0.2 s
  /**
   * The input node of a free emitter for a sound of `duree` seconds, or null (the sound then goes out at the centre, dry, as today).
   * classe: "figure" (pos = the index in the room's list), "fuite" (ou = the room it comes from), "verre" (ou = the id of the work).
   * At state 3 the sound comes out of the emitter AVANCE_HRTF_S (52 ms) after it went in, its send to the network with it: the HRTF panner takes its direction in that silence.
   */
  function sortieEmetteur(classe, pos, ou, duree) {
    if (ferme || etat < 2 || muet || !cam || !finiN(duree) || !ouvert()) return null;
    if (classe === "verre" && sans.verre) return null;
    if (classe === "fuite" && sans.fuites) return null;
    const t = tAudio();
    let src = null;
    if (classe === "figure") {
      const room = salleId || (poidsVus && poidsVus.salle), lste = table[room] && table[room].emetteurs;
      if (!lste || !lste.length) return null;
      src = lste[Math.min(lste.length - 1, Math.max(0, pos | 0))];
    } else if (classe === "verre") {
      const p = positionVerre(ou);
      if (!p) return null;
      src = { x: p.x, y: p.y, z: p.z, ref: 2 };
    } else if (classe === "fuite") {
      const p = sourceDePorte(ou, cam);
      if (!p) return null;
      src = { x: p.x, y: OREILLE, z: p.z };
    } else return null;
    const libres = emetteurs.filter(e => !attente.has(e));
    const e = choisirEmetteur(libres, src, t, duree);
    if (!e) return null;
    const info = { classe, ou, src, finSon: t + duree + 0.1, envoiDb: 0 };
    const m = melangerTable(table, cam.x, cam.z);
    info.envoiDb = classe === "fuite" ? table.hall.envoi.figure : m.envoi[classe];
    infos.set(e, info);
    if (!e.placer(sourceDeInfo(info, cam), cam, t, "debut")) { infos.delete(e); return null; }
    e.reglerEnvoi(dbLin(info.envoiDb), t);
    if (!muet) envoyer(t, duree, m.rt60);
    return e.entree;
  }

  // ----- a jump (a teleport: more than 0.6 m in one frame)
  function saut(t) {
    dernierSaut = t;
    creuxEsp(t);
    mixEnAttente = true;
    for (const e of emetteurs) { const i = infos.get(e); if (i && t < i.finSon) e.placer(sourceDeInfo(i, cam), cam, t, "saut"); }
  }

  // ----- one frame
  function corps(c, nowMs, peut, parle) {
    if (!c || !finiN(c.x) || !finiN(c.z) || !finiN(nowMs)) { suiveur.remise(); camPrec = null; return; }
    dernierNow = nowMs;
    const t = tAudio(), m = mur();
    if (parle) derniereVoixT = t;
    const yaw = finiN(c.yaw) ? c.yaw : 0;
    cam = { x: c.x, z: c.z, yaw };
    tick(t);
    // frame interval (the second reason to go down)
    if (!horsLigne) {
      if (dernierNowMs !== null) { const d = nowMs - dernierNowMs; if (d > 0 && d < 250) { sommeInt += d; nInt++; } }
      if (fenInt0 === null) fenInt0 = nowMs;
      if (nowMs - fenInt0 >= VEILLE.fenetreImagesMs) {
        const lent = nInt >= VEILLE.imagesMin && sommeInt / nInt > VEILLE.intervalle;
        if (lent && ctx.state === "running" && estVisible() && vuDepuis !== null && m - vuDepuis >= VEILLE.visibleMs) descendre("images");
        sommeInt = 0; nInt = 0; fenInt0 = nowMs;
      }
    }
    dernierDeltaMs = dernierNowMs === null ? 0 : nowMs - dernierNowMs;
    dernierNowMs = nowMs;
    const saute = camPrec !== null && Math.hypot(cam.x - camPrec.x, cam.z - camPrec.z) > SEUIL_SAUT_M;
    // "Walking" is a speed, not a distance per frame: 0.1 m/s is enough (at 144 images a second a walker moves 0.017 m a frame).
    if (camPrec === null) dernierMouvement = t;
    else { const dS = (dernierDeltaMs || 0) / 1000, dd = Math.hypot(cam.x - camPrec.x, cam.z - camPrec.z); if (dS > 0 ? dd / dS > 0.1 : dd > 0.02) dernierMouvement = t; }
    camPrec = { x: cam.x, z: cam.z };
    if (!muet && etat >= 2) {
      if (saute) saut(t);
      // the mix of the room: at most 20 times a second, 0.25 s constant after a jump
      if (saute || mixEnAttente || m - dernierMelange >= PAS_MAJ_S * 1000) {
        const mix = melangerTable(table, cam.x, cam.z);
        ecrireMelange(mix, t, saute || t - dernierSaut < 0.5 ? TAU_MELANGE_SAUT : TAU_MELANGE, saute);
        mixEnAttente = false; dernierMelange = m; poidsVus = mix.poids;
      }
      // the emitters that still sound follow the head
      if (!saute) for (const e of emetteurs) { const i = infos.get(e); if (i && t < i.finSon) e.placer(sourceDeInfo(i, cam), cam, t, "doux"); }
    }
    if (!muet && !sans.duck && parle !== voixPrec) { appliquerDuck(parle, t); voixPrec = parle; }
    // the decision "a foot lands", on the CAMERA (not on the walker): always called, so that its accumulators follow the frames
    const ok = !!peut && !muet && !ferme && ouvert();
    const r = suiveur.suivre(cam.x, cam.z, nowMs, ok);
    if (r && ok && !sans.pas) jouerPas(r, cam, t);
  }

  /** Called every frame by the museum, after the drawing. Never throws. */
  function entendre(c, nowMs, peut, parle) {
    if (ferme) { try { if (fermeture) tick(tAudio()); } catch { /* closing */ } return; }
    enImage = true;
    try { corps(c, nowMs, !!peut, !!parle); } catch { faute(); }
    enImage = false;
  }

  // ----- the clock's chores: the end of a purge, the hushed emitters, the sleep, the end of a closing
  function tick(t) {
    if (reprise && t >= reprise.jusqua) finirReprise(t);
    if (!muet) for (const [e, tf] of attente) if (t >= tf) { attente.delete(e); reprendreEmetteur(e, t); }
    if (fermeture && t >= fermeture.jusqua) liberer();
    dormir(t);
    // the voice lowers the figures and the glass; nothing says "she stopped" while the loop sleeps (the plan or a showcase is open): after 0.6 s of silence from the flag, let go
    if (voixPrec && !ferme && !muet && !sans.duck && t - derniereVoixT > 0.6) { appliquerDuck(false, t); voixPrec = false; }
  }
  function surMinuterie() {
    if (ferme && !fermeture) return;
    try {
      tick(tAudio());
      if (!ferme && ++ticks % 4 === 0) veille();
    } catch { faute(); }
  }

  // ----- watching the clock: the audio clock against the wall clock, in windows of 2 s
  function veille() {
    const m = mur(), a = ctx.currentTime;
    if (ctx.state !== "running" || !estVisible()) { veilleRef = null; vuDepuis = null; lents = 0; return; }
    if (vuDepuis === null) { vuDepuis = m; veilleRef = { m, a }; return; }
    const dm = (m - veilleRef.m) / 1000, da = a - veilleRef.a;
    veilleRef = { m, a };
    if (m - vuDepuis < VEILLE.visibleMs || dm < 1.5) return;
    if (da < 0.005) { lents = 0; rapportVeille = 0; return; }                // a frozen audio clock judges nothing
    rapportVeille = da / dm;
    lents = rapportVeille < VEILLE.rapport ? lents + 1 : 0;
    if (lents >= VEILLE.fenetres) { lents = 0; descendre("horloge"); }
  }
  /** A suspend or a resume of the context (the SON button, a tab hidden then seen) stops the audio clock for a while: the
   *  window being measured would call the machine slow. It starts over, and the next one waits its visible time again. */
  function veilleRecommence() { veilleRef = null; vuDepuis = null; lents = 0; }
  let lastRaison = null;
  /** One step down (never up). `forcer` (the bench's way, through the probes) skips the 6 s rule and works offline too; the watching never forces. */
  function descendre(raison, forcer = false) {
    if (ferme || (horsLigne && !forcer)) return false;
    const m = mur();
    if (!forcer && m - derniereDescente < VEILLE.entreDescentesMs) return false;
    derniereDescente = m; descentes++; lastRaison = raison;
    if (etat === 3) versEtat2();
    else if (etat === 2) versEtat1();
    else fermer();
    return true;
  }
  function versEtat2() {
    etat = 2; reserve = null;
    for (const e of emetteurs) e.versStereo();
    if (!horsLigne) { const h = setTimeout(() => { if (!ferme) for (const e of emetteurs) e.versStereo(); }, DELAIS.versStereo); h.unref?.(); }
  }
  let haut = null;                                                         // the upper part, kept for a while after a descent to state 1
  function versEtat1() {
    if (etat < 2 || ferme) return;
    etat = 1;
    // The upper part stays plugged for a while: a figure on an emitter and the tail of the network finish; then it is unplugged.
    haut = { reseau, emetteurs, nodes: permanents.splice(0, permanents.length).filter(n => n !== pasBus) };
    permanents.push(pasBus);
    reseau = null; emetteurs = []; reserve = null; pieds = null; pasSend = null; espOut = null; emBus = null;
    try { pasBus.disconnect(); } catch { /* unplugged */ }
    batirBas();
    if (!horsLigne) { const h = setTimeout(liberer2, DELAIS.liberation); h.unref?.(); }
  }
  function liberer2() {
    const x = haut; haut = null;
    if (!x) return;
    try { x.reseau && x.reseau.fermer(); } catch { /* closed */ }
    for (const e of x.emetteurs) { try { e.fermer(); } catch { /* closed */ } }
    for (const n of x.nodes) { try { n.disconnect(); } catch { /* unplugged */ } }
    infos.clear(); attente.clear();
  }

  // ----- the room told by sound.js
  function salle(id) {
    const avant = salleId;
    salleId = id || null;
    if (ferme || etat < 2 || avant === salleId || avant === null) return;
    try {
      const t = tAudio();
      for (const e of emetteurs) {
        const i = infos.get(e);
        if (i && (i.classe === "figure" || i.classe === "fuite") && t < i.finSon && !muet) {
          e.etouffer(t, 0.06);
          attente.set(e, Math.max(t + 0.06, i.finSon));                    // lifted by tick(): the rest of a figure of another room stays hushed to the end of its sound (as after a cut)
        }
      }
    } catch { faute(); }
  }

  // ----- the leaks of the hall
  function fuite() {
    try {
      if (ferme || etat < 2 || sans.fuites || muet || !cam || !ouvert()) return null;
      const t = tAudio();
      if (!poidsVus || poidsVus.salle !== "hall") return null;
      if (t - dernierMouvement < FUITE_ARRET_S) return null;               // walking, or stopped for less than 3 s
      if (voixPrec || t - derniereVoixT < 0.6) return null;
      if (t - derniereFuiteT < FUITE_ENTRE_S) return null;
      if (!emetteurs.some(e => !attente.has(e) && e.libre(t))) return null;
      const autres = ["aether", "jeux", "mondes", "photographie", "ecriture"].filter(s => s !== derniereFuite);
      const choix = autres[Math.min(autres.length - 1, Math.floor(hasard() * autres.length))];
      derniereFuite = choix; derniereFuiteT = t;
      return { salle: choix };
    } catch { faute(); return null; }
  }

  // ----- the cut and the way back (SPEC 4.11)
  function couper() {
    if (ferme || (muet && !reprise)) return;                               // idempotent; a cut during a purge starts over
    veilleRecommence();
    try {
      muet = true; reprise = null;
      const t = tAudio();
      const g = sortieMute().gain;
      g.cancelScheduledValues(t); g.setValueAtTime(0, t); dip = null;
      for (const v of voix) for (const s of v.sources) { try { s.src.stop(t + 0.001); } catch { /* over */ } }
      voix.length = 0;
      if (etat >= 2) {
        pasSend.gain.cancelScheduledValues(t); pasSend.gain.setValueAtTime(0, t);
        reseau.couper(t);
        for (const e of emetteurs) e.couper(t);
      }
      attente.clear();
    } catch { faute(); }
  }
  function reprendre() {
    if (ferme || !muet || reprise) return;
    veilleRecommence();
    try {
      const t = tAudio();
      reprise = { jusqua: t + PURGE_S };
      // the network is plugged first, its loop gains and the output still at zero: the delay lines flush during the purge
      if (etat >= 2 && reseauPret) reseau.brancher(espOut);
    } catch { faute(); }
  }
  function finirReprise(t) {
    reprise = null; muet = false;
    if (etat >= 2) {
      const p = espOut.gain;
      p.cancelScheduledValues(t); p.setValueAtTime(0, t); p.linearRampToValueAtTime(1, t + REMONTEE_S);
      const c = cam || { x: 0, z: 6 };
      const mix = melangerTable(table, c.x, c.z);
      reseau.regler({ rt60: mix.rt60, fc: mix.fc }, t, 0.15);              // the loop gains climb back from zero
      courant = { rt60: mix.rt60, fc: mix.fc, pas: mix.envoi.pas };
      pasSend.gain.setTargetAtTime(dbLin(mix.envoi.pas), t, 0.15);
      for (const e of emetteurs) {
        const i = infos.get(e);
        if (i && i.finSon > t) { attente.set(e, i.finSon); continue; }     // a figure that was sounding when the clock stopped: its rest stays hushed
        e.reglerEnvoi(dbLin(i && i.classe !== "fuite" ? mix.envoi[i.classe] : table.hall.envoi.figure), t);
        e.reprendre(t, REMONTEE_S);
      }
    } else {
      const p = pasBus.gain, v = voixPrec && !sans.duck ? dbLin(DUCK.pas) : 1;
      p.cancelScheduledValues(t); p.setValueAtTime(0, t); p.linearRampToValueAtTime(v, t + REMONTEE_S);
    }
    mixEnAttente = true;
  }
  const surEtat = () => { veilleRecommence(); if (ctx.state === "running" && muet && !reprise) reprendre(); };
  try { if (ctx.addEventListener) ctx.addEventListener("statechange", surEtat); } catch { /* no events */ }
  const surReduit = e => { if (e && e.matches) fermer(); };
  try { if (reduit) { if (reduit.addEventListener) reduit.addEventListener("change", surReduit); else if (reduit.addListener) reduit.addListener(surReduit); } } catch { /* no listener */ }

  // ----- closing: nothing sounding is abandoned (a 30 ms fade, then everything is unplugged)
  function fermer() {
    if (ferme) return;
    ferme = true;
    clearInterval(minuterie);
    try { ctx.removeEventListener && ctx.removeEventListener("statechange", surEtat); } catch { /* none */ }
    try { if (reduit) { if (reduit.removeEventListener) reduit.removeEventListener("change", surReduit); else if (reduit.removeListener) reduit.removeListener(surReduit); } } catch { /* none */ }
    const t = tAudio();
    try {
      const p = sortieMute().gain, v = muet ? 0 : (etat >= 2 ? niveauEsp(t) : (voixPrec && !sans.duck ? dbLin(DUCK.pas) : 1));
      p.cancelScheduledValues(t); p.setValueAtTime(v, t); p.setTargetAtTime(0, t, 0.01);
    } catch { /* gone */ }
    etat = 0;
    fermeture = { jusqua: t + DELAIS.fermeture / 1000 };
    if (!horsLigne) { const h = setTimeout(() => { try { liberer(); } catch { /* closed */ } }, DELAIS.fermeture); h.unref?.(); }
  }
  function liberer() {
    if (!fermeture) return;
    fermeture = null;
    for (const v of voix) for (const s of v.sources) { try { s.src.stop(); } catch { /* over */ } try { s.src.disconnect(); s.g.disconnect(); } catch { /* unplugged */ } }
    voix.length = 0;
    liberer2();
    if (reseau) try { reseau.fermer(); } catch { /* closed */ }
    for (const e of emetteurs) { try { e.fermer(); } catch { /* closed */ } }
    for (const n of permanents) { try { n.disconnect(); } catch { /* unplugged */ } }
    permanents.length = 0; reseau = null; emetteurs = []; reserve = null;
    infos.clear(); attente.clear(); tamponsAudio.clear();
  }

  if (!horsLigne) { minuterie = setInterval(surMinuterie, 500); if (minuterie.unref) minuterie.unref(); }

  // ----- what the layer says of itself
  const api = {
    get palier() { return etat; },
    salle, entendre, fuite, couper, reprendre, fermer,
    sortie(classe, pos, ou, duree) { try { return sortieEmetteur(classe, pos, ou, duree); } catch { faute(); return null; } },
    etat() {
      const t = tAudio();
      return {
        palier: etat, salle: salleId, noeuds: nbNoeuds(), vivants: (vivantes = vivantes.filter(q => q.fin > t)).length,
        pas: { voix: voix.filter(v => v.fin >= t).length, joues, perdus, prets: tampons.size },
        sommeil: { branche: !!(reseau && reseau.estBranche()), jusqua: sommeilAu, pret: reseauPret },
        veille: { rapport: rapportVeille, lents, descentes, raison: lastRaison, intervalleMoyenMs: nInt ? sommeInt / nInt : null },
        fautes, muet, ferme,
        emetteurs: emetteurs.map(e => { const i = infos.get(e); const s = e.etat(); return { libre: e.libre(t), classe: i ? i.classe : null, fin: e.fin, hrtf: s.hrtf, coupe: s.coupe, mises: s.mises, sauts: s.sauts }; }),
        poids: poidsVus,
      };
    },
  };
  if (essais) {
    api.sondes = {
      get entree() { return reseau && reseau.entree; }, get retour() { return reseau && reseau.sortie; }, get reseau() { return reseau; },
      get espOut() { return espOut; }, get pasBus() { return pasBus; }, get pasSend() { return pasSend; }, get emBus() { return emBus; }, get pieds() { return pieds; },
      get emetteurs() { return emetteurs; }, journalPas, ctx,
      /** Plays one step now, whatever the walk (the bench's way to measure a single step). */
      pas(r, c) { return jouerPas({ pied: 0, v: 2.5, course: false, doux: false, ...r }, c || cam || { x: 0, z: 6, yaw: 0 }, tAudio()); },
      tick, veille, descendre: raison => descendre(raison || "essai", true),
    };
  }
  if (!preparation) preparer({ palier: etat });
  return api;
}
