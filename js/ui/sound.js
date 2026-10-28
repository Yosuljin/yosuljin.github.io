// Sound design, fully synthesised with Web Audio (no files, nothing remote).
// A cathode-ray room: a restrained space drone and motion wind, plus a few one-shots, each a small instrument
// (a body, a transient, a glint) enveloped from silence to silence and stopped after its envelope: no digital
// click anywhere. The bed stays very low; only a figure comes and goes, and silence stays silence between. Everything
// shares one master, one compressor and one limiter. LITE is a pause: the master goes to zero and comes back with FULL.
// Browsers only allow audio after a user gesture: the bed fades in on the first click / key / tap.
// The museum's spatial layer (js/musee/espace.js) is handed in through brancherEspace(): this module does not import
// it, and with no layer the sound is the site's own, as it always was.
import { getMode, onModeChange } from "../core/prefs.js?v=20261025-r28";

const KEY = "yosuljin-sound";
const LEVEL = 0.68;
const BUS = 0.72;   // the bus's gain: set when the context is made and again when the sound comes back
const level = () => getMode() === "lite" ? 0.0001 : LEVEL;
let ctx = null, master = null, bus = null, limiter = null, voixOut = null, enabled = true, unlocked = false, shuttingDown = false;
let bed = null, scene = 0, lastVel = 0;
// The hard mute (SON button, hidden tab): true from couper() to rallumer(); the context is suspended a little later.
let coupe = false, suspendTimer = 0;
// The context whose suspend() has been sent and has not settled yet: until it does, ctx.state may still say "running".
let suspendEn = null;
// The museum's spatial layer (SPEC 4.14): given by brancherEspace(), built in start() once the bed exists, closed by
// three faults. `voixAt` is the last instant a voice was heard (I2). `rnd` draws every random choice of the figures and
// the start offsets of the noise (SON-6); local QA may replace it (window.__YOSULJIN_SOUND_QA.hasard = f, no parentheses).
let esp = null, fabrique = null, fautes = 0, voixAt = -1e9, rnd = Math.random;
const SCENE_NOTES = [58, 73.42, 92.5, 110];
const SCENE_AIR = [620, 860, 1140, 1480];
const listeners = new Set();

try { enabled = localStorage.getItem(KEY) !== "off"; } catch {}

// An AudioContext created or resumed before the page has had a user gesture is refused, and the browser
// logs a warning for the context and for every source started in it (a scripted focus
// used to cost 9 of them). Nothing audio-related happens until the page has been activated.
// navigator.userActivation is the browser's own answer; the capture-phase flag covers engines without it.
let gestured = false;
// Once the reader has interacted with one page, Chromium lets the next same-site page start audio on its
// own (sticky activation carried over a same-origin navigation): remember it for the whole visit (js/boot.js reads it
// to decide the standby screen).
const VISIT = "yosuljin-signal";
const markGesture = e => {
  if (e.type === "keydown" && e.key === "Escape") return;
  gestured = true;
  try { sessionStorage.setItem(VISIT, "1"); } catch {}
};
for (const type of ["pointerdown", "mousedown", "keydown", "touchend"]) addEventListener(type, markGesture, { capture: true, passive: true });
const activated = () => navigator.userActivation ? navigator.userActivation.hasBeenActive : gestured;

export const isEnabled = () => enabled;
export function onSoundChange(fn) { listeners.add(fn); }

/** AlmaS's recorded voice (js/musee/almas.js): her own gain, into the master — so the master's fades, the SON button and a hidden
 *  tab govern her as they govern the rest. Null while the site's sound is off or not yet opened by a gesture. */
export function sortieVoix() {
  if (!ctx || !master || !unlocked || !enabled || shuttingDown) return null;
  // The recordings are normalised to -1 dBFS (about -16 dBFS rms): 0.4 sits her about 18 dB over the ambience, under the master.
  if (!voixOut) { voixOut = ctx.createGain(); voixOut.gain.value = 0.4; voixOut.connect(master); }
  return { ctx, noeud: voixOut };
}

// The sound button's equaliser moves only while the sound really plays: .is-playing while the context runs and is
// not being muted (styles.css also keeps it still in LITE).
function paintPlaying() {
  document.querySelector("[data-sound-toggle]")?.classList.toggle("is-playing", !!ctx && ctx.state === "running" && enabled && !shuttingDown);
}

// A context that waits for a gesture is "suspended"; Safari also puts it to "interrupted" (a call, another app).
const dormant = () => !!ctx && (ctx.state === "suspended" || ctx.state === "interrupted");

/** Calls the spatial layer; three faults close it (the site's own sound goes on). Returns `repli` when there is no layer
 *  or when it throws. */
function surEsp(appel, repli = undefined) {
  if (!esp) return repli;
  try { return appel(esp); } catch {
    if (++fautes >= 3) fermerEsp();
    return repli;
  }
}
function fermerEsp() {
  const e = esp;
  esp = null;
  if (e) try { e.fermer?.(); } catch {}
}
/** The place a spatial sound goes to: an emitter of the layer, or the bus (the sound as it was). */
function sortieEsp(classe, pos, ou, duree) {
  return surEsp(e => e.sortie(classe, pos, ou, duree), null) || bus;
}
function construire() {
  if (esp || !fabrique || !ctx || !bed) return;
  fautes = 0;
  // `hasard` goes through `rnd` at each draw, so a replacement by local QA also reaches the layer.
  try { esp = fabrique({ ctx, sortie: bus, ouvert: canPlay, hasard: () => rnd() }) || null; } catch { esp = null; }
  // The layer is built after setRoom() may have run (the museum names its room at the door, the layer comes with the first
  // gesture or the dynamic import): it is told the room it is in at once.
  if (esp && salle) surEsp(e => e.salle(salle));
}

/** Hard mute, for the SON button and for a hidden tab (SON-1): the layer goes silent, the master and the bus come down
 *  in a few milliseconds and sit at an exact zero, and only then is the context suspended (a suspend() at once would freeze
 *  the delay lines and let them out again on resume()). Any wake-up cancels the suspension. */
function couper() {
  if (!ctx || !master) return;
  coupe = true;
  clearTimeout(suspendTimer);
  surEsp(e => e.couper());
  const t = ctx.currentTime;
  for (const p of [master.gain, bus.gain]) {
    const v = p.value;
    p.cancelScheduledValues(t);
    p.setValueAtTime(v, t);
    p.setTargetAtTime(0, t, 0.015);
    p.setValueAtTime(0, t + 0.12);
  }
  const c = ctx;
  suspendTimer = setTimeout(() => {
    suspendTimer = 0;
    if (!coupe || ctx !== c) return;
    suspendEn = c;
    const fini = () => { if (suspendEn === c) suspendEn = null; };
    try { c.suspend().then(fini, fini); } catch { fini(); }
  }, esp ? 250 : 180);
}

/** The way back from couper(): the suspension is cancelled, the bus comes back, `retour(t)` brings the master up, the
 *  context resumes if it is not running, and the layer is told only after that. */
function rallumer(retour) {
  if (!ctx || !master) return;
  coupe = false;
  clearTimeout(suspendTimer);
  suspendTimer = 0;
  const t = ctx.currentTime;
  bus.gain.cancelScheduledValues(t);
  bus.gain.setValueAtTime(BUS, t);
  retour(t);
  const reprendre = () => surEsp(e => e.reprendre());
  // A suspend() still on its way counts as a suspended context: resume() is sent behind it.
  if (ctx.state === "running" && suspendEn !== ctx) reprendre();
  else if (ctx.state !== "closed") ctx.resume().then(reprendre, () => {});
}

export function setEnabled(value) {
  enabled = !!value;
  try { localStorage.setItem(KEY, enabled ? "on" : "off"); } catch {}
  listeners.forEach(fn => fn(enabled));
  if (!ctx) {
    if (enabled) unlock();
    return;
  }
  if (enabled) {
    shuttingDown = false;
    // A hidden tab stays muted: the visibilitychange handler brings the sound back when it is seen again.
    if (document.visibilityState !== "hidden") rallumer(t => {
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(0.0001, t);
      master.gain.exponentialRampToValueAtTime(level(), t + 0.45);
    });
  } else {
    shuttingDown = true;
    couper();
  }
  paintPlaying();
}

function fadeMaster(value, seconds) {
  if (!ctx) return;
  const t = ctx.currentTime;
  master.gain.cancelScheduledValues(t);
  master.gain.setValueAtTime(master.gain.value, t);
  master.gain.linearRampToValueAtTime(value, t + seconds);
}

/** The first opening of a visit (SON-2): the master goes to its level at once, in a short ramp, and the bed alone carries the
 *  slow fade-in; a one-shot struck in the first seconds is then heard at its own level instead of being swallowed. */
function ouvrir(quick) {
  const t = ctx.currentTime, g = bed.out.gain;
  fadeMaster(level(), 0.03);
  g.cancelScheduledValues(t);
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(1, t + (quick ? 0.3 : 1.6));
}

function unlock() {
  if (!enabled || !activated()) return;
  start();
}

function createContext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  voixOut = null;
  ctx = new AC({ latencyHint: "interactive" });
  ctx.addEventListener("statechange", paintPlaying);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -15; comp.knee.value = 10; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.18;
  limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -4; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.08;
  master = ctx.createGain(); master.gain.value = 0;
  bus = ctx.createGain(); bus.gain.value = BUS;
  bus.connect(master); master.connect(comp); comp.connect(limiter); limiter.connect(ctx.destination);
}

// The first page of a visit fades in slowly; a page reached from the site (quick) picks the ambience up where
// the previous page left it.
function start(quick = false) {
  if (!enabled) return;
  if (!ctx) createContext();
  if (!ctx) return;
  if (!bed) { buildBed(); construire(); }
  if (dormant()) ctx.resume().catch(() => {});
  if (!unlocked) { unlocked = true; shuttingDown = false; ouvrir(quick); }
  paintPlaying();
}

/** The page is back after a departure that did not happen, or from the history (portal.js): the master comes
 *  back up. */
export function revive() {
  if (!ctx || !enabled || shuttingDown) return;
  if (coupe) { // muted by a hidden tab: the visibilitychange handler does it if the tab is still hidden
    if (document.visibilityState !== "hidden") rallumer(() => fadeMaster(level(), 0.3));
    return;
  }
  if (dormant()) ctx.resume().catch(() => {});
  fadeMaster(level(), 0.3);
}

// LITE is a pause: the master goes down and everything waits; FULL brings it back (styles.css keeps the bars still).
onModeChange(() => { if (!ctx || !unlocked || shuttingDown) return; fadeMaster(level(), getMode() === "lite" ? 0.4 : 0.9); paintPlaying(); });

// Arriving from another page of the site: try to start straight away. If the browser still refuses,
// drop the silent context at once (one console notice, no sources started) and wait for a gesture.
function tryAutostart() {
  if (!enabled || ctx) return;
  createContext();
  const c = ctx;
  if (!c) return;
  setTimeout(() => {
    if (ctx !== c || unlocked) return;
    if (c.state === "running") { start(true); return; }
    c.close().catch(() => {});
    fermerEsp();
    // A hidden tab within these 140 ms muted a context that is gone: the next one starts unmuted.
    coupe = false;
    clearTimeout(suspendTimer);
    suspendTimer = 0;
    suspendEn = null;
    ctx = master = bus = limiter = voixOut = null;
  }, 140);
}

// ---------- Building blocks ----------
let noiseBuffer = null;
function noise() {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < d.length; i++) { // pinkish noise: softer than white, less fatiguing
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.16;
    }
  }
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer; src.loop = true;
  return src;
}
/** A gain envelope from silence to silence: a linear attack to `peak`, an exponential decay to a thousandth of
 *  it, then to zero — no step at either end. Returns the time after which the source can stop. */
function env(gainNode, t, attack, peak, decay) {
  const p = gainNode.gain;
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.exponentialRampToValueAtTime(peak * 0.001, t + attack + decay);
  p.linearRampToValueAtTime(0, t + attack + decay + 0.012);
  return t + attack + decay + 0.03;
}
const osc = (type, f, t) => { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); return o; };
const filt = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
/** A voice: `source → shaper → gain → out` (the bus unless the spatial layer gives an emitter), enveloped from `t`; the
 *  shaper is one node or an [input, output] pair already connected. The source stops after its envelope; returns that
 *  time. A source with a buffer (the noise) starts at a random place in it (SON-6): the same hiss never comes back twice. */
function voice(source, t, attack, peak, decay, shaper = null, out = bus) {
  const g = ctx.createGain();
  if (shaper) { const [sin, sout] = Array.isArray(shaper) ? shaper : [shaper, shaper]; source.connect(sin); sout.connect(g); }
  else source.connect(g);
  g.connect(out);
  const end = env(g, t, attack, peak, decay);
  if (source.buffer) source.start(t, rnd() * 1.5); else source.start(t);
  source.stop(end);
  return end;
}

// ---------- The bed: scene drone + air + motion wind ----------
// The ambience stays deliberately low; effects sit above it and share the same master envelope.

function buildBed() {
  const out = ctx.createGain(); out.gain.value = 1; out.connect(bus);
  const wind = noise(); const bp = ctx.createBiquadFilter();
  bp.type = "bandpass"; bp.frequency.value = 400; bp.Q.value = 0.8;
  const windGain = ctx.createGain(); windGain.gain.value = 0;
  wind.connect(bp); bp.connect(windGain); windGain.connect(out); wind.start();

  // Musical room-tone: a very low detuned dyad and a filtered air bed.
  // It is deliberately quiet; it gives the site a living CRT/space-machine floor without masking speech.
  const initialRoot = SALLES[salle]?.root || SCENE_NOTES[scene] || SCENE_NOTES[0];
  const initialAir = SALLES[salle]?.air || SCENE_AIR[scene] || SCENE_AIR[0];
  const drone = ctx.createOscillator(), droneGain = ctx.createGain(), droneFilter = ctx.createBiquadFilter();
  drone.type = "triangle"; drone.frequency.value = initialRoot; droneGain.gain.value = 0.0096;
  droneFilter.type = "lowpass"; droneFilter.frequency.value = 420; droneFilter.Q.value = 0.5;
  drone.connect(droneFilter); droneFilter.connect(droneGain); droneGain.connect(out); drone.start();

  const pad = ctx.createOscillator(), padGain = ctx.createGain(), padFilter = ctx.createBiquadFilter();
  pad.type = "sine"; pad.frequency.value = initialRoot * 2.006; padGain.gain.value = 0.0048;
  padFilter.type = "lowpass"; padFilter.frequency.value = 760; padFilter.Q.value = 0.45;
  pad.connect(padFilter); padFilter.connect(padGain); padGain.connect(out); pad.start();

  const air = noise(), airBp = ctx.createBiquadFilter(), airGain = ctx.createGain();
  airBp.type = "bandpass"; airBp.frequency.value = initialAir; airBp.Q.value = 0.55; airGain.gain.value = 0.0038;
  air.connect(airBp); airBp.connect(airGain); airGain.connect(out); air.start();

  const lfo = ctx.createOscillator(), lfoDepth = ctx.createGain();
  lfo.type = "sine"; lfo.frequency.value = 0.055; lfoDepth.gain.value = 0.0034;
  lfo.connect(lfoDepth); lfoDepth.connect(droneGain.gain); lfo.start();

  const lfo2 = ctx.createOscillator(), lfo2Depth = ctx.createGain();
  lfo2.type = "sine"; lfo2.frequency.value = 0.041; lfo2Depth.gain.value = 0.0018;
  lfo2.connect(lfo2Depth); lfo2Depth.connect(padGain.gain); lfo2.start();

  bed = { out, windGain, bp, drone, droneGain, droneFilter, pad, padGain, padFilter, airBp, airGain };
}

/** Scene index subtly retunes the background field: each world has its own low harmonic center. */
export function setScene(index) {
  scene = Math.max(0, Math.min(3, Number(index) || 0));
  if (!ctx || !bed) return;
  const t = ctx.currentTime;
  const root = SCENE_NOTES[scene], air = SCENE_AIR[scene];
  bed.drone.frequency.setTargetAtTime(root, t, 0.35);
  bed.pad.frequency.setTargetAtTime(root * 2.006, t, 0.45);
  bed.airBp.frequency.setTargetAtTime(air, t, 0.38);
  bed.droneFilter.frequency.setTargetAtTime(260 + scene * 90, t, 0.4);
  bed.padFilter.frequency.setTargetAtTime(560 + scene * 120, t, 0.4);
}

/** Camera speed opens the wind (called every frame by the index; cheap no-op when idle). */
export function setVelocity(v) {
  if (!ctx || !bed) return;
  v = Math.min(1.5, Math.abs(v));
  if (Math.abs(v - lastVel) < 0.02) return;
  lastVel = v;
  const t = ctx.currentTime;
  bed.windGain.gain.setTargetAtTime(Math.min(0.045, v * 0.032), t, 0.08);
  bed.bp.frequency.setTargetAtTime(300 + v * 1400, t, 0.1);
}

// ---------- The museum's rooms (D169): one ambience each ----------
// Each room retunes the bed — its own low centre, its own air — and, now and then, lets a figure of its own be heard,
// sparse and quiet: a bell in Aether, a game's three notes in Game Development, a breath of air in Mondes, a drop of
// water in the darkroom, a page turned in the library. The bed stays very low; only the figure comes and goes: silence
// stays silence between. The hall has none of its own: with the spatial layer, it lets the figure of a neighbouring
// room through its door, now and then.
const SALLES = {
  hall: { root: 58, air: 620, motif: "fuite", tous: [20, 32] },
  aether: { root: 73.42, air: 980, motif: "cloche", tous: [7, 12] },
  jeux: { root: 92.5, air: 1240, motif: "arpege", tous: [6, 10] },
  mondes: { root: 110, air: 1480, motif: "souffle", tous: [8, 13] },
  photographie: { root: 49, air: 420, motif: "goutte", tous: [4, 9] },
  ecriture: { root: 65.41, air: 760, motif: "page", tous: [8, 14] },
};
// SON-3: the peak gain of each figure. Set so that the loudest 125 ms of each, A-weighted, sits near -50 dBFS(A) (the
// bell's own level) by a linear model of this file, that is BEFORE the automatic make-up gain of the compressor and of the
// limiter (about +7.6 dB on a quiet sound, see RATTRAPAGE_COMPRESSEURS_DB in js/musee/acoustique.js): what counts is the
// gap between the figures, none louder than the bell. The offline bench measures it through the real chain (banc/sound.mjs, T4). Peaks of the bell's two partials, of the page's two swishes.
// 28 October: every peak halved (-6.02 dB, the ratios between the figures kept) for the dose of a visit (D1): through the real chain the bell now reads -48.2 dBFS(A) (T4) where it read -42.3, nearer the -50 this note aimed at before the make-up was counted.
const PIC = { cloche: [0.006, 0.0015], arpege: 0.0125, souffle: 0.0385, goutte: 0.0135, page: [0.0625, 0.045] };
const tirer = n => Math.min(n - 1, Math.floor(rnd() * n));
// `at(pos, duree)` gives the input of an emitter of the spatial layer (or the bus) for a sound of that length (s).
const MOTIFS = {
  // A bell, far: two partials of a pentatonic note over the room's centre, a long tail.
  cloche(r, at = () => bus) {
    const t = ctx.currentTime, f = r.root * [8, 9, 10, 12, 16][tirer(5)], out = at(0, 2.7);
    voice(osc("sine", f, t), t, 0.006, PIC.cloche[0], 2.6, null, out);
    voice(osc("sine", f * 2.76, t), t, 0.004, PIC.cloche[1], 0.9, null, out);
  },
  // A game's three notes, soft, as a menu would answer: the first and the third from one speaker, the second from the other.
  arpege(r, at = () => bus) {
    const t = ctx.currentTime, lp = () => filt("lowpass", 2200, 0.6);
    [8, 10, 12].forEach((k, i) => voice(osc("triangle", r.root * k, t), t + i * 0.13, 0.004, PIC.arpege, 0.26, lp(), at(i === 1 ? 1 : 0, 0.6)));
  },
  // A breath of air, rising.
  souffle(r, at = () => bus) {
    const t = ctx.currentTime, bp = filt("bandpass", 600, 1.2);
    bp.frequency.exponentialRampToValueAtTime(1800, t + 2.2);
    voice(noise(), t, 1.1, PIC.souffle, 1.8, bp, at(0, 2.9));
  },
  // A drop of water in a tray (one of three), now and then a second one.
  goutte(r, at = () => bus) {
    const t = ctx.currentTime;
    const drop = (when, k) => { const o = osc("sine", 1500 * k, when); o.frequency.exponentialRampToValueAtTime(560 * k, when + 0.06); voice(o, when, 0.002, PIC.goutte * k, 0.18, null, at(tirer(3), 0.5)); };
    drop(t, 1);
    if (rnd() < 0.4) drop(t + 0.32, 0.8);
  },
  // A page turned: two swishes of high air.
  page(r, at = () => bus) {
    const t = ctx.currentTime, out = at(0, 0.4);
    voice(noise(), t, 0.03, PIC.page[0], 0.16, filt("bandpass", 3800, 0.9), out);
    voice(noise(), t + 0.11, 0.02, PIC.page[1], 0.2, filt("bandpass", 2900, 0.9), out);
  },
};
let salle = null, motifTimer = 0;
/** True when a figure may start: the museum's layer asks the same question (`ouvert`). */
export const canPlay = () => !!(ctx && bed && enabled && !shuttingDown && ctx.state === "running" && document.visibilityState === "visible" && getMode() !== "lite");
// A voice (AlmaS speaking) was heard less than 600 ms ago: no figure starts over it (I2).
const motifOk = () => canPlay() && performance.now() - voixAt >= 600;
function planifier() {
  clearTimeout(motifTimer);
  const r = SALLES[salle];
  if (!r?.motif) return;
  const [a, b] = r.tous;
  motifTimer = setTimeout(() => {
    if (r.motif === "fuite") { fuite(0); return; }
    if (motifOk()) try { MOTIFS[r.motif](r, (pos, duree) => sortieEsp("figure", pos, salle, duree)); } catch {}
    planifier();
  }, (a + rnd() * (b - a)) * 1000);
}
/** The hall (SPEC 4.9): the layer says which neighbouring room is heard through its door, or nothing yet (null: another
 *  try in 5 s, four at most). With no layer the hall has no figure, as before. */
function fuite(essai) {
  const rep = esp && motifOk() ? surEsp(e => e.fuite?.(), null) : null;
  const r = rep && SALLES[rep.salle];
  if (r && MOTIFS[r.motif]) {
    try { MOTIFS[r.motif](r, (pos, duree) => sortieEsp("fuite", pos, rep.salle, duree)); } catch {}
  } else if (esp && essai < 4) {
    motifTimer = setTimeout(() => fuite(essai + 1), 5000);
    return;
  }
  planifier();
}
/** The museum's room the visitor is in (js/musee/musee.js): the bed takes its tone, its figure comes back now and then;
 *  null lets the bed go back to the site's. */
export function setRoom(id) {
  salle = SALLES[id] ? id : null;
  planifier();
  surEsp(e => e.salle(salle));
  if (!ctx || !bed) return;
  const r = SALLES[salle] || { root: SCENE_NOTES[scene], air: SCENE_AIR[scene] }, t = ctx.currentTime;
  bed.drone.frequency.setTargetAtTime(r.root, t, 0.8);
  bed.pad.frequency.setTargetAtTime(r.root * 2.006, t, 0.9);
  bed.airBp.frequency.setTargetAtTime(r.air, t, 0.8);
  bed.droneFilter.frequency.setTargetAtTime(200 + r.root * 2.4, t, 0.8);
  bed.padFilter.frequency.setTargetAtTime(420 + r.root * 4, t, 0.8);
}

// ---------- One-shots ----------
// Levels are set before the bus (BUS) and the master (LEVEL), under the compressor and the limiter: a press
// peaks around −14 dBFS at the output, the switch-on and the page change around −10.
const SFX = {
  // A press: a soft thock (sine 190→75 Hz) under a tap of filtered noise, and a glint.
  press() {
    const t = ctx.currentTime;
    const o = osc("sine", 190, t); o.frequency.exponentialRampToValueAtTime(75, t + 0.07);
    voice(o, t, 0.0015, 0.28, 0.1);
    voice(noise(), t, 0.001, 0.16, 0.016, filt("bandpass", 1600, 1.2));
    voice(osc("sine", 5200, t), t, 0.0005, 0.05, 0.008);
  },
  // Menu ignition: a degauss thump with a flutter that dies with it, a swell of air, a faint rising whine and a
  // crackle of static as the picture comes.
  ignite() {
    const t = ctx.currentTime;
    const o = osc("sine", 110, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.42);
    const flutter = ctx.createGain(); flutter.gain.value = 0.82;
    const lfo = osc("sine", 13, t), depth = ctx.createGain(); depth.gain.value = 0.18; lfo.connect(depth); depth.connect(flutter.gain);
    const end = voice(o, t, 0.012, 0.36, 0.5, flutter); lfo.start(t); lfo.stop(end);
    const lp = filt("lowpass", 300, 0.8); lp.frequency.exponentialRampToValueAtTime(1500, t + 0.35);
    voice(noise(), t, 0.06, 0.12, 0.45, lp);
    const w = osc("sine", 1800, t); w.frequency.exponentialRampToValueAtTime(6200, t + 0.5);
    voice(w, t + 0.04, 0.1, 0.012, 0.42);
    voice(noise(), t + 0.08, 0.004, 0.05, 0.06, filt("highpass", 3200, 0.7));
  },
  // Menu power-off: the picture zips down to a line, a thud under it, then the dot.
  poweroff() {
    const t = ctx.currentTime;
    const o = osc("triangle", 1500, t); o.frequency.exponentialRampToValueAtTime(52, t + 0.3);
    const lp = filt("lowpass", 4000, 0.7); lp.frequency.exponentialRampToValueAtTime(300, t + 0.3);
    voice(o, t, 0.004, 0.26, 0.33, lp);
    const s = osc("sine", 68, t); s.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    voice(s, t + 0.02, 0.006, 0.22, 0.22);
    voice(osc("sine", 2400, t), t + 0.3, 0.002, 0.06, 0.05);
  },
  // Changing page, the departure (portal.js): the picture folds to a line in 260 ms — a sweep down, the air
  // closing, a tick where the lids meet; the master follows the lids out (the next page brings it back).
  portal() {
    const t = ctx.currentTime;
    const o = osc("triangle", 700, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.26);
    const lp = filt("lowpass", 2600, 0.9); lp.frequency.exponentialRampToValueAtTime(220, t + 0.26);
    voice(o, t, 0.01, 0.3, 0.3, lp);
    const bp = filt("bandpass", 2400, 1.1); bp.frequency.exponentialRampToValueAtTime(260, t + 0.26);
    voice(noise(), t, 0.03, 0.14, 0.28, bp);
    voice(osc("sine", 1900, t), t + 0.25, 0.002, 0.07, 0.06);
    master.gain.setValueAtTime(master.gain.value, t + 0.22);
    master.gain.linearRampToValueAtTime(0.0001, t + 0.3);
  },
  // Changing page, the arrival (portal.js): the channel locks — a burst of static, a bloom, the air opening.
  channel() {
    const t = ctx.currentTime;
    voice(noise(), t, 0.006, 0.07, 0.05, filt("highpass", 2800, 0.7));
    const o = osc("sine", 160, t); o.frequency.exponentialRampToValueAtTime(330, t + 0.2);
    voice(o, t + 0.02, 0.05, 0.16, 0.34);
    const lp = filt("lowpass", 400, 0.8); lp.frequency.exponentialRampToValueAtTime(2200, t + 0.4);
    voice(noise(), t + 0.02, 0.08, 0.08, 0.4, lp);
  },
  // The tube switched on from standby: thump, static, the degauss buzz dying out, the flyback whine settling.
  switchon() {
    const t = ctx.currentTime;
    const k = osc("sine", 80, t); k.frequency.exponentialRampToValueAtTime(34, t + 0.3);
    voice(k, t, 0.004, 0.4, 0.36);
    voice(noise(), t, 0.004, 0.12, 0.4, filt("highpass", 2200, 0.7));
    const d = osc("sawtooth", 50, t), lp = filt("lowpass", 900, 1.1); lp.frequency.exponentialRampToValueAtTime(140, t + 1.2);
    const wobble = ctx.createGain(); wobble.gain.value = 0.75; lp.connect(wobble);
    const wob = osc("sine", 11, t), depth = ctx.createGain(); depth.gain.value = 0.25; wob.frequency.linearRampToValueAtTime(4, t + 1.2);
    wob.connect(depth); depth.connect(wobble.gain);
    const end = voice(d, t + 0.03, 0.05, 0.2, 1.15, [lp, wobble]); wob.start(t); wob.stop(end);
    const w = osc("sine", 8400, t); w.frequency.exponentialRampToValueAtTime(7600, t + 0.6);
    voice(w, t + 0.05, 0.12, 0.014, 0.9);
  },
  // The camera flies through a gate of the world (FULL 3D, "world-gate" event): a breath through the ring,
  // then a soft impact. Quiet when the index's scene change has just played the same crossing.
  gate(detail) {
    if (detail?.quiet) return;
    const t = ctx.currentTime;
    const bp = filt("bandpass", 300, 1.4); bp.frequency.exponentialRampToValueAtTime(3800, t + 0.45);
    voice(noise(), t, 0.22, 0.12, 0.3, bp);
    const k = osc("sine", 64, t + 0.2); k.frequency.exponentialRampToValueAtTime(40, t + 0.45);
    voice(k, t + 0.2, 0.006, 0.2, 0.26);
  },
  // Crossing into another world: a low whoomp and a breath of air.
  cross() {
    const t = ctx.currentTime;
    const o = osc("sine", 72, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.4);
    voice(o, t, 0.04, 0.2, 0.42);
    voice(noise(), t, 0.12, 0.07, 0.35, filt("bandpass", 600, 0.7));
  },
  // A part of a project scene touched (js/scenes/scene.js): struck glass — the part's note `f`, its two
  // inharmonic partials fading first, and a breath of air on the strike.
  glass(f = 660, out = bus) {
    const t = ctx.currentTime;
    voice(osc("sine", f, t), t, 0.004, 0.11, 1.3, null, out);
    voice(osc("sine", f * 2.756, t), t, 0.002, 0.03, 0.45, null, out);
    voice(osc("sine", f * 5.404, t), t, 0.001, 0.01, 0.16, null, out);
    voice(noise(), t, 0.002, 0.025, 0.03, filt("bandpass", Math.min(8000, f * 4), 2), out);
  },
  // A scene completed: its notes struck from low to high, 90 ms apart, over the octave below the lowest.
  chord(notes = [523.25, 659.25, 783.99]) {
    const t = ctx.currentTime, fs = [...notes].sort((a, b) => a - b);
    fs.forEach((f, i) => {
      voice(osc("sine", f, t), t + i * 0.09, 0.006, 0.07, 2.2);
      voice(osc("sine", f * 2.756, t), t + i * 0.09, 0.003, 0.018, 0.5);
    });
    voice(osc("sine", fs[0] / 2, t), t, 0.08, 0.06, 2.6);
  },
};

const lastPlayed = {};
let rejeuEnAttente = false, rejeuJeton = 0;
/** SON-10: a sound asked of a context that is not running yet (new, or waking up) is played again once it runs, if that takes
 *  less than 400 ms; one replay waits at a time, and nothing plays if the context refuses. */
function rejouer(name, arg, at) {
  if (rejeuEnAttente || coupe || !activated() || ctx.state === "closed") return;
  rejeuEnAttente = true;
  const c = ctx, depuis = performance.now(), jeton = ++rejeuJeton;
  const fin = ok => {
    if (jeton === rejeuJeton) rejeuEnAttente = false;
    if (ok && ctx === c && c.state === "running" && performance.now() - depuis < 400) sfx(name, arg, at);
  };
  // Safety: a resume() that never settles (Safari left "interrupted", context dropped) must not block the replays of the visit.
  setTimeout(() => { if (jeton === rejeuJeton) rejeuEnAttente = false; }, 450);
  try { c.resume().then(() => fin(true), () => fin(false)); } catch { if (jeton === rejeuJeton) rejeuEnAttente = false; }
}

/** Plays a one-shot if audio is running. Rate-limited per sound so repeated presses never machine-gun. `at` is the id of a
 *  work of the museum, for "glass" only: the glass then comes from where the work stands; no other sound is placed. */
export function sfx(name, arg, at) {
  if (!enabled || shuttingDown || !SFX[name] || getMode() === "lite") return;
  // A control can call its sound from pointerdown before the global gesture listener runs.
  // Unlock here too, while still inside the user gesture, so the first press is never silent.
  if (!ctx) unlock();
  if (!ctx || shuttingDown || coupe) return;
  if (ctx.state !== "running") { rejouer(name, arg, at); return; }
  const now = performance.now();
  if (lastPlayed[name] && now - lastPlayed[name] < 40) return;
  // The world's gate and the index's scene change mark the same crossing: never both in full.
  if (name === "cross" && now - (lastPlayed.gate || -1e9) < 900) return;
  if (name === "gate" && now - (lastPlayed.cross || -1e9) < 900) arg = { ...arg, quiet: true };
  lastPlayed[name] = now;
  // Only a work's id places the glass: without one (js/scenes/scene.js) the layer is not asked and the glass goes to the bus.
  try { if (name === "glass") SFX.glass(arg, at != null ? sortieEsp("verre", null, at, 1.4) : bus); else SFX[name](arg); } catch {}
}

// ---------- The spatial layer's doors (SPEC 4.14) ----------
/** The museum hands in the layer's factory once; it is built in start(), once the bed exists (never in createContext:
 *  tryAutostart throws that context away), or at once if the context and the bed are already there. */
export function brancherEspace(f) {
  fabrique = typeof f === "function" ? f : null;
  construire();
}
/** Called every frame by the museum, after the drawing: the layer hears the camera. Never throws. `voix`: AlmaS is
 *  really speaking (a voice exists), noted for the figures (I2). */
export function entendre(cam, nowMs, peut, voix) {
  if (voix) voixAt = performance.now();
  surEsp(e => e.entendre(cam, nowMs, peut, voix));
}
/** The museum's WebGL is lost: the layer is closed and not rebuilt. */
export function debrancherEspace() {
  fabrique = null;
  fermerEsp();
}

export function initSound() {
  const button = document.querySelector("[data-sound-toggle]");
  const paint = () => {
    if (!button) return;
    button.setAttribute("aria-pressed", String(enabled));
    button.setAttribute("aria-label", "Son");
    button.classList.toggle("is-on", enabled);
  };
  paint();
  onSoundChange(paint);
  button?.addEventListener("click", e => { e.stopPropagation(); setEnabled(!enabled); });
  // The WebGL world announces each gate the camera flies through (bubbles from its canvas).
  document.addEventListener("world-gate", e => sfx("gate", e.detail));
  const gesture = e => {
    // Do not build the whole audio bed on the menu press path: that synchronous
    // allocation used to delay the click while the interface was opening.
    if (e?.target?.closest?.(".menu-toggle")) {
      requestAnimationFrame(unlock);
      return;
    }
    unlock();
  };
  for (const type of ["pointerdown", "keydown", "touchend"]) addEventListener(type, gesture, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.visibilityState === "hidden") couper();
    else if (enabled && !shuttingDown) {
      if (coupe) rallumer(() => fadeMaster(level(), 0.3)); // seen again after a hidden tab: the sound comes back in 0.3 s
      else if (dormant()) ctx.resume().catch(() => {});
    }
  });
  // The standby screen, when js/boot.js put it up before the first paint (html.gate-pending).
  if (document.documentElement.classList.contains("gate-pending")) showGate();
  else { document.querySelector(".signal-gate")?.remove(); if (enabled) tryAutostart(); }
}

// ---------- Standby screen ----------
// No browser lets a page start sound on its own, nor take the whole screen: the first page of a visit opens on a tube
// in standby, and so does a page that opens outside the fullscreen it should have (js/boot.js decides, D165).
// The whole screen is the switch: a click, a tap or a key turns the picture and the sound on together, in fullscreen
// (boot.js asks for it in the same press). The pages after it start by themselves (see tryAutostart).
function switchOn() {
  unlock();
  if (!ctx) return;
  fadeMaster(level(), 0.06); // the switch-on sound must not wait for the bed's slow fade-in
  if (ctx.state === "running") sfx("switchon");
  else ctx.resume().then(() => sfx("switchon")).catch(() => {});
}

function showGate() {
  const root = document.documentElement;
  if (typeof HTMLDialogElement !== "function") { document.querySelector(".signal-gate")?.remove(); root.classList.remove("gate-pending"); return; }
  // The page carries the screen (every page's <dialog class="signal-gate">, shown by js/boot.js before the first
  // paint): it is adopted here. Built only when a page does not carry it.
  let gate = document.querySelector(".signal-gate");
  const built = !gate;
  if (built) {
    gate = document.createElement("dialog");
    gate.className = "signal-gate";
    gate.setAttribute("aria-label", "Écran en veille");
  }
  if (built) gate.innerHTML =
    '<button type="button" class="signal-gate-switch" data-gate="sound" aria-label="Allumer l’écran" aria-describedby="signal-gate-note">' +
    '<span class="signal-gate-name" aria-hidden="true">YOSULJIN</span>' +
    '<span class="signal-gate-dot" aria-hidden="true"></span>' +
    '<span class="signal-gate-hint" aria-hidden="true"><span class="hint-fine">Cliquez pour allumer</span><span class="hint-coarse">Touchez l’écran pour allumer</span></span>' +
    '<span class="signal-gate-keys" aria-hidden="true">ou appuyez sur une touche</span>' +
    "</button>" +
    '<p class="signal-gate-top" aria-hidden="true"><span>Yosuljin <i>·</i> entre les mondes</span><span>Canal 00</span></p>' +
    '<p class="signal-gate-note" id="signal-gate-note"><span class="note-loud">L’image et le son s’allument ensemble.</span>' +
    '<span class="note-loud-full">L’image et le son s’allument ensemble, en plein écran.</span>' +
    '<span class="note-mute-full">L’image s’allume en plein écran, sans le son.</span></p>' +
    '<button type="button" class="signal-gate-quiet" data-gate="quiet">Allumer sans le son</button>' +
    '<span class="signal-gate-led" aria-hidden="true">Veille</span>';
  let gone = false;
  // mode: "sound" switches on with the sound, "quiet" turns the sound off for good, "skip" (Escape) leaves it
  // for the next gesture.
  const leave = mode => {
    if (gone) return;
    gone = true;
    if (mode === "sound") switchOn(); else if (mode === "quiet") setEnabled(false);
    gate.classList.add("is-leaving");
    const done = () => { if (gate.open) gate.close(); gate.remove(); };
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) done(); else setTimeout(done, 260);
    // The tube powers on underneath while the standby screen fades (portal.js); how the reader came in is said, for
    // the fullscreen (boot.js: « skip », Escape, comes in without it).
    dispatchEvent(new CustomEvent("yosuljin:enter", { detail: mode }));
  };
  gate.addEventListener("click", e => {
    const b = e.target.closest?.("[data-gate]");
    if (b) leave(b.dataset.gate);
  });
  // Any printable key also switches on (Enter and Space already press the focused button; Tab still moves).
  gate.addEventListener("keydown", e => {
    if (e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); leave("sound"); }
  });
  // Escape is not a user activation, so it cannot start the sound: it just lets the reader in.
  gate.addEventListener("cancel", e => { e.preventDefault(); leave("skip"); });
  if (built) document.body.appendChild(gate);
  window.__yosuljinGateReady = true;
  // A press that came before this module (js/boot.js kept the choice): acted on now, the screen already fading.
  const early = window.__yosuljinGateChoice;
  root.classList.remove("gate-pending");
  if (early) { leave(early); return; }
  gate.showModal();
}

// Local QA only; production exposes no audio graph/state.
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  const qa = () => {
    let espace = null;
    try { espace = esp?.etat?.() ?? null; } catch {}
    const palier = esp ? (typeof esp.palier === "function" ? esp.palier() : esp.palier) ?? null : null;
    return { enabled, state: ctx?.state ?? "none", gain: master?.gain.value ?? 0, shuttingDown, espace, palier };
  };
  // `hasard`: the random source of the figures and the noise offsets, replaced by the proofs (a function returning [0, 1)).
  Object.defineProperty(qa, "hasard", { enumerable: true, get: () => rnd, set: f => { rnd = typeof f === "function" ? f : Math.random; } });
  window.__YOSULJIN_SOUND_QA = qa;
}
