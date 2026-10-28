// The museum's resonance: a delay network computed sample by sample by ONE AudioWorkletNode (reseau-worklet.js), wired here on the main thread.
// A graph of native Delay nodes did not repeat from one render to the next; the worklet does, to the bit, and Node runs the same kernel for the bench.
// No convolution node, no file, no DOM, no import: espace.js hands over the context and the worklet address and gets the network back.
// Model (SPEC-son-musee.md, 4.5): high-pass 140 Hz -> two Schroeder diffusers -> N lines (read at a time moved by one 0.31 Hz sine, low-pass of the room,
// loop gain) -> Householder mix -> left = sum of the reads, right = signed sum -> BASS BRIDGE: each ear also gets `c` times a low-pass of the other ear.
// Graph: rIn (Gain, one channel) -> worklet node (two outputs) -> rOut (Gain) -> the destination given to brancher(); the node is inserted once the module has loaded.
// SLEEP goes through the parameter `actif`: a worklet is computed even when nothing listens, so debrancher() sets actif to 0 (the state freezes, as the native graph
// froze when cut from the output) and brancher() sets it to 1. Nothing here reads a clock: every time is an argument.

export const DELAI_MAX = 0.1;              // s: the longest line, modulation included (the former Delay maxDelayTime)
export const PASSE_HAUT_HZ = 140;          // Hz: nothing under this in the return (a laptop speaker cannot play it, and it avoids a boom)
export const Q_DB = -3;                    // dB: Q of every low-pass and of the high-pass (the Web Audio low-pass Q is in dB: -3 is about Butterworth)
// The bass bridge: on the exact kernel, 400 Hz gives a coherence of 0.52 in 160-250 Hz (0.7 asked), 600 Hz gives 0.72 (0.28 / 0.22 / 0.26 at 1, 2, 4 kHz, 0.35 at most).
export const PONT_DEFAUT = Object.freeze({ fc: 600, c: 0.6 });
export const ECHANTILLONS_CYCLE_MIN = 128; // a rule of the table, no longer of the engine: kept for the shortest lines and the two diffusers (the sound at 16 kHz)
const NOM_PROCESSEUR = "reseau-retards";   // the same name as in reseau-worklet.js (no import here)

const fige = o => { for (const v of Object.values(o)) if (v && typeof v === "object") fige(v); return Object.freeze(o); };
/**
 * The two shapes of the network. `retardsMs`: the line delays (ms); `entree`: the sign each line takes of the input; `sortie`: the sign of
 * each line in the right ear (the left ear is always +); `diffuseurs`: the Schroeder stages ([ms, a]); `modulation`: the shared oscillator
 * (Hz) and the depth of each line (ms, signed). The Householder gain is -2 / N and the output scale 1 / sqrt(N / 2), both from N.
 * `quatre` is the choice; `six` is the reserve if the bench's R3 finds the tail metallic (a parameter, not other code).
 */
export const TOPOLOGIES = fige({
  quatre: {
    retardsMs: [21.5, 27.6, 37.3, 44.0], entree: [1, 1, -1, -1], sortie: [1, -1, 1, -1],
    diffuseurs: [[4.8, 0.7], [3.6, 0.7]], modulation: { hz: 0.31, profondeursMs: [0.5, -0.4, 0.3, -0.6] },
  },
  six: {
    retardsMs: [19.3, 25.1, 31.7, 38.3, 45.9, 53.1], entree: [1, 1, 1, -1, -1, -1], sortie: [1, -1, 1, -1, 1, -1],
    diffuseurs: [[4.8, 0.7], [3.6, 0.7]], modulation: { hz: 0.31, profondeursMs: [0.5, -0.4, 0.3, -0.6, 0.45, -0.35] },
  },
});

/** The gain of a line of `ms` milliseconds that loses 60 dB in `rt60` seconds: 10^(-3 D / rt60). */
export const gainBoucle = (ms, rt60) => Math.pow(10, -3 * (ms / 1000) / rt60);

const fini = Number.isFinite;
/** Throws a RangeError / TypeError unless the shape is usable on a context of `sr` Hz (a broken line is refused here, not heard later). */
export function verifierTopologie(t, sr = 48000) {
  const N = t && t.retardsMs && t.retardsMs.length;
  if (!(N >= 2) || N > 6) throw new TypeError("topologie : deux à six lignes");
  for (const k of ["entree", "sortie"]) {
    if (!Array.isArray(t[k]) || t[k].length !== N || !t[k].every(s => s === 1 || s === -1)) throw new TypeError(`topologie : ${k} doit donner +1 ou -1 pour chaque ligne`);
  }
  if (!Array.isArray(t.modulation && t.modulation.profondeursMs) || t.modulation.profondeursMs.length !== N || !t.modulation.profondeursMs.every(fini)) throw new TypeError("topologie : une profondeur de modulation par ligne");
  if (!(t.modulation.hz > 0 && fini(t.modulation.hz))) throw new RangeError("topologie : modulation.hz");
  t.retardsMs.forEach((ms, i) => {
    // The line must stay a real delay with its modulation at the deepest swing: a line at 0 ms (or too short) would be a cycle of zero length.
    if (!fini(ms) || (ms - Math.abs(t.modulation.profondeursMs[i])) * sr / 1000 < ECHANTILLONS_CYCLE_MIN) throw new RangeError(`topologie : la ligne ${i + 1} (${ms} ms) tient moins de ${ECHANTILLONS_CYCLE_MIN} échantillons à ${sr} Hz`);
    if (ms / 1000 + Math.abs(t.modulation.profondeursMs[i]) / 1000 > DELAI_MAX) throw new RangeError(`topologie : la ligne ${i + 1} dépasse ${DELAI_MAX} s`);
  });
  if (!Array.isArray(t.diffuseurs) || !t.diffuseurs.every(d => Array.isArray(d) && fini(d[0]) && d[0] > 0 && d[0] / 1000 <= DELAI_MAX && fini(d[1]) && Math.abs(d[1]) < 1)) throw new TypeError("topologie : diffuseurs [ms, a] avec 0 < ms <= " + DELAI_MAX * 1000 + " et |a| < 1");
  return true;
}

const fcBorne = (f, sr) => Math.min(Math.max(f, 200), Math.min(20000, 0.45 * sr));   // a corner never goes above Nyquist (the 16 kHz render of the bench)
function verifierReglages(rt60, fc, pont) {
  if (!(rt60 > 0 && fini(rt60))) throw new RangeError("rt60 : un nombre fini plus grand que zéro");
  if (!(fc > 0 && fini(fc))) throw new RangeError("fc : un nombre fini plus grand que zéro");
  if (pont && !(fini(pont.fc) && pont.fc > 0 && fini(pont.c) && pont.c >= 0)) throw new RangeError("pont : { fc, c } finis, c >= 0");
}

/**
 * The plan the kernel is built from: a plain object (no function, no class), so it travels in processorOptions. Pure: no clock, no chance.
 * Throws what verifierTopologie and creerReseau throw. `pont` null: no bridge; `modulation` false: depths and rate at 0 (a QA switch).
 */
export function faireplan(topologie, sr, { rt60 = 1.8, fc = 5000, pont = PONT_DEFAUT, modulation = true } = {}) {
  verifierTopologie(topologie, sr);
  verifierReglages(rt60, fc, pont);
  const N = topologie.retardsMs.length, m = topologie.modulation;
  return {
    version: 1, sr, N,
    retards: topologie.retardsMs.map(ms => ms / 1000 * sr),
    profondeurs: m.profondeursMs.map(p => modulation ? p / 1000 * sr : 0),
    modHz: modulation ? m.hz : 0,
    entree: topologie.entree.slice(), sortie: topologie.sortie.slice(),
    mix: -2 / N, echelle: 1 / Math.sqrt(N / 2),
    // A whole number of samples, like the model (230 and 173 at 48 kHz), and never under the cycle minimum.
    diffuseurs: topologie.diffuseurs.map(([ms, a]) => ({ d: Math.max(Math.round(ms * sr / 1000), ECHANTILLONS_CYCLE_MIN), a })),
    hpHz: PASSE_HAUT_HZ, qDb: Q_DB,
    pont: pont ? { fc: pont.fc, c: pont.c } : null,
    fcMin: 200, fcMax: Math.min(20000, 0.45 * sr),
    g0: topologie.retardsMs.map(ms => gainBoucle(ms, rt60)),
    fc0: fcBorne(fc, sr),
  };
}

// One attempt per context: ctx -> { promesse, pret }. A failure is remembered too.
const CHARGES = new WeakMap();
/**
 * Loads the worklet module on `ctx` and proves it: addModule accepts a module that throws when evaluated, so a trial node (no plan) is created and dropped.
 * Resolves when the module is usable, rejects otherwise. No timer here: if addModule never answers, the promise stays pending.
 */
export function chargerWorklet(ctx, url, NoeudWorklet = typeof AudioWorkletNode === "function" ? AudioWorkletNode : null) {
  const deja = CHARGES.get(ctx);
  if (deja) return deja.promesse;
  const e = { pret: false, promesse: null };
  e.promesse = (async () => {
    if (!url) throw new Error("chargerWorklet : une adresse est demandée");
    if (!(ctx && ctx.audioWorklet && typeof ctx.audioWorklet.addModule === "function") || !NoeudWorklet) throw new Error("chargerWorklet : pas d'AudioWorklet");
    await ctx.audioWorklet.addModule(url);
    const essai = new NoeudWorklet(ctx, NOM_PROCESSEUR, { numberOfOutputs: 1, outputChannelCount: [2] });
    try { essai.disconnect(); } catch { /* never connected */ }
    try { essai.port.postMessage({ fin: true }); } catch { /* port already closed */ }   // else its processor lives (and is called) until the context closes
    e.pret = true;
  })();
  CHARGES.set(ctx, e);
  return e.promesse;
}

/**
 * Builds the network on `ctx` (real or fake) and returns at once { entree, sortie, noeuds, regler, couper, debrancher, brancher, fermer, estBranche, etat, dernierEnvoi, boucle, topologie, pret }.
 * - entree (rIn, one channel: a stereo send arrives as 0.5 x (L + R)) takes the sends; sortie (rOut, with its `gain`) is plugged by brancher(destination). noeuds: 3.
 * - pret: Promise<boolean>, true once the worklet node is inserted, false if loading or creation failed or nothing was asked (never rejects). Until then the network is
 *   silent. If the module is already loaded for this context, the node is inserted before creerReseau returns.
 * - boucle: { gains: [{ gain: AudioParam }], fc, actif, noeud }, null until inserted; for the bench and the layer's QA (read, do not rewire).
 * - regler({ rt60, fc }, t, tau): loop time (s) and brightness (Hz), reached by setTargetAtTime from `t` with constant `tau`. Either may be left out. Only a rt60 lifts
 *   the loop gains after a couper() (they climb back from 0).
 * - couper(t): the clean cut of the SON button: every loop gain gets 0 AND its automation cancelled, and sortie is unplugged. The state freezes and comes out when
 *   sortie is plugged again: so the layer's reprendre() brancher()s FIRST with the gains at 0, waits the purge (0.2 s, SPEC 4.11), then calls regler({ rt60, fc }).
 *   `t` is for the gains ONLY: sortie is unplugged at the call.
 * - debrancher() / brancher(destination): the sleep (see the top); the destination given once is remembered. estBranche(); etat(): { rt60, fc, branche, ferme }.
 * - fermer(): sleeps, tells the processor to end, unplugs; nothing else works after it, and a late answer of the module inserts nothing.
 * `options`: { topologie = quatre, pont = PONT_DEFAUT (null: no bridge), rt60 = 1.8, fc = 5000, modulation = true (false: QA switch ?sans=modulation), urlWorklet,
 *   NoeudWorklet = AudioWorkletNode, surPanne }: surPanne() is called, with no argument, when the processor fails (the node is then mute).
 */
export function creerReseau(ctx, { topologie = TOPOLOGIES.quatre, pont = PONT_DEFAUT, rt60 = 1.8, fc = 5000, modulation = true, urlWorklet, NoeudWorklet = typeof AudioWorkletNode === "function" ? AudioWorkletNode : null, surPanne } = {}) {
  const sr = ctx.sampleRate;
  verifierTopologie(topologie, sr);
  verifierReglages(rt60, fc, pont);
  const N = topologie.retardsMs.length;
  const rIn = ctx.createGain(), rOut = ctx.createGain();
  // The input is forced to ONE channel (explicit, 'speakers': a stereo send arrives as 0.5 x (L + R)), like the worklet node behind it.
  rIn.channelCount = 1; rIn.channelCountMode = "explicit"; rIn.channelInterpretation = "speakers";

  let destination = null, branche = false, ferme = false, courant = { rt60, fc }, coupe = false, resoudre;
  const pret = new Promise(r => { resoudre = r; });
  const boucle = { gains: null, fc: null, actif: null, noeud: null };
  const dort = () => { if (boucle.actif) boucle.actif.setValueAtTime(0, ctx.currentTime); };

  function inserer() {
    if (ferme || boucle.noeud) return;
    try {
      const plan = faireplan(topologie, sr, { rt60: courant.rt60, fc: courant.fc, pont, modulation });
      if (coupe) plan.g0 = plan.g0.map(() => 0);
      const parameterData = { fc: plan.fc0, actif: branche ? 1 : 0 };
      plan.g0.forEach((g, i) => { parameterData["g" + i] = g; });
      const noeud = new NoeudWorklet(ctx, NOM_PROCESSEUR, {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 1, channelCountMode: "explicit", channelInterpretation: "speakers",
        processorOptions: { plan }, parameterData,
      });
      noeud.onprocessorerror = () => { api.debrancher(); if (surPanne) surPanne(); };
      // The processor itself found a non-finite sample in its output (reseau-worklet.js): it has gone silent, as after an error.
      noeud.port.onmessage = e => { if (e.data && e.data.panne) { api.debrancher(); if (surPanne) surPanne(); } };
      rIn.connect(noeud); noeud.connect(rOut);
      boucle.noeud = noeud;
      boucle.gains = plan.g0.map((_, i) => ({ gain: noeud.parameters.get("g" + i) }));
      boucle.fc = noeud.parameters.get("fc"); boucle.actif = noeud.parameters.get("actif");
      resoudre(true);
    } catch { resoudre(false); }
  }
  if (!urlWorklet || !NoeudWorklet || !(ctx.audioWorklet && typeof ctx.audioWorklet.addModule === "function")) resoudre(false);
  else {
    const deja = CHARGES.get(ctx);
    if (deja && deja.pret) inserer();
    else chargerWorklet(ctx, urlWorklet, NoeudWorklet).then(inserer, () => resoudre(false));
  }

  const api = {
    entree: rIn, sortie: rOut, noeuds: 3, topologie, dernierEnvoi: -Infinity, boucle, pret,
    regler({ rt60: r = null, fc: f = null } = {}, t, tau) {
      if (ferme) return;
      if (!fini(t) || !(fini(tau) && tau >= 0)) throw new RangeError("regler : t et tau doivent être des nombres finis (tau >= 0)");
      if (r !== null && !(r > 0 && fini(r))) throw new RangeError("regler : rt60 fini et plus grand que zéro");
      if (f !== null && !(f > 0 && fini(f))) throw new RangeError("regler : fc fini et plus grand que zéro");
      if (r !== null) { courant = { ...courant, rt60: r }; coupe = false; if (boucle.gains) boucle.gains.forEach((Z, i) => Z.gain.setTargetAtTime(gainBoucle(topologie.retardsMs[i], r), t, tau)); }
      if (f !== null) { courant = { ...courant, fc: f }; if (boucle.fc) boucle.fc.setTargetAtTime(fcBorne(f, sr), t, tau); }
    },
    couper(t) {
      if (ferme) return;
      if (!fini(t)) throw new RangeError("couper : t doit être un nombre fini");
      coupe = true;
      // the cancel-and-hold call is missing in Firefox: cancel from t, then pin the value at t. A target curve started earlier is ended by the pin.
      if (boucle.gains) for (const Z of boucle.gains) { Z.gain.cancelScheduledValues(t); Z.gain.setValueAtTime(0, t); }
      api.debrancher();
    },
    debrancher() { if (ferme || !branche) return; try { rOut.disconnect(); } catch { /* already unplugged */ } branche = false; dort(); },
    brancher(cible) {
      if (ferme) return;
      if (cible) { if (branche && cible !== destination) api.debrancher(); destination = cible; }
      if (!destination) throw new TypeError("brancher : une destination est demandée la première fois");
      if (!branche) { rOut.connect(destination); branche = true; if (boucle.actif) boucle.actif.setValueAtTime(1, ctx.currentTime); }
    },
    estBranche: () => branche && !ferme,
    etat: () => ({ ...courant, branche, ferme }),
    fermer() {
      if (ferme) return;
      api.debrancher(); ferme = true; resoudre(false);
      if (boucle.noeud) {
        try { boucle.noeud.port.postMessage({ fin: true }); } catch { /* port already closed */ }
        try { boucle.noeud.disconnect(); } catch { /* already unplugged */ }
      }
      try { rIn.disconnect(); } catch { /* already unplugged */ }
    },
  };
  return api;
}

/**
 * The start-up check: the same network is built in an OfflineAudioContext of 9 600 frames (200 ms) at 48 000 Hz, the module is loaded there, one impact goes in,
 * and the peak between 30 and 200 ms must be finite, at least 1e-4 and at most 2. Any error, or a failed check, gives { ok: false }:
 * the caller then keeps the lower state. `options`: those of creerReseau (urlWorklet and NoeudWorklet among them), plus { sr = 48000, longueur = 9600 }.
 * Never throws. Returns { ok, crete, erreur? }.
 */
export async function amorcer(OfflineClasse, options = {}) {
  try {
    const { sr = 48000, longueur = 9600, ...reste } = options;
    const ctx = new OfflineClasse(2, longueur, sr);
    await chargerWorklet(ctx, reste.urlWorklet, reste.NoeudWorklet);
    const r = creerReseau(ctx, reste);
    if (!(await r.pret)) throw new Error("amorcer : le noeud du réseau n'a pas pu être créé");
    r.brancher(ctx.destination);
    const b = ctx.createBuffer(1, 1, sr);
    b.getChannelData(0)[0] = 1;
    const src = ctx.createBufferSource();
    src.buffer = b; src.connect(r.entree); src.start(0);
    const rendu = await ctx.startRendering();
    let crete = 0, fini_ = true;
    const a = Math.round(0.03 * sr);
    for (let c = 0; c < rendu.numberOfChannels; c++) {
      const x = rendu.getChannelData(c);
      for (let i = 0; i < x.length; i++) {
        const v = x[i];
        if (!Number.isFinite(v)) { fini_ = false; break; }
        if (i >= a && Math.abs(v) > crete) crete = Math.abs(v);
      }
    }
    r.fermer();
    return { ok: fini_ && crete >= 1e-4 && crete <= 2, crete: fini_ ? crete : NaN };
  } catch (e) {
    return { ok: false, crete: NaN, erreur: String(e && e.message || e) };
  }
}
