// Sound design, fully synthesised with Web Audio (no files, nothing remote).
// A cathode-ray room: a restrained space drone and motion wind, plus a few one-shots, each a small instrument
// (a body, a transient, a glint) enveloped from silence to silence and stopped after its envelope: no digital
// click anywhere. No always-on mains hum or hiss: silence means silence, and everything shares one master, one
// compressor and one limiter. LITE is a pause: the master goes to zero and comes back with FULL.
// Browsers only allow audio after a user gesture: the bed fades in on the first click / key / tap.
import { getMode, onModeChange } from "../core/prefs.js?v=20261014-r1";

const KEY = "yosuljin-sound";
const LEVEL = 0.68;
const level = () => getMode() === "lite" ? 0.0001 : LEVEL;
let ctx = null, master = null, bus = null, limiter = null, enabled = true, unlocked = false, shuttingDown = false;
let bed = null, scene = 0, lastVel = 0;
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
// own (sticky activation carried over a same-origin navigation): remember it for the whole visit.
const VISIT = "yosuljin-signal";
const visited = () => { try { return sessionStorage.getItem(VISIT) === "1"; } catch { return false; } };
const markGesture = e => {
  if (e.type === "keydown" && e.key === "Escape") return;
  gestured = true;
  try { sessionStorage.setItem(VISIT, "1"); } catch {}
};
for (const type of ["pointerdown", "mousedown", "keydown", "touchend"]) addEventListener(type, markGesture, { capture: true, passive: true });
const activated = () => navigator.userActivation ? navigator.userActivation.hasBeenActive : gestured;

export const isEnabled = () => enabled;
export function onSoundChange(fn) { listeners.add(fn); }

// The sound button's equaliser moves only while the sound really plays: .is-playing while the context runs and is
// not being muted (styles.css also keeps it still in LITE).
function paintPlaying() {
  document.querySelector("[data-sound-toggle]")?.classList.toggle("is-playing", !!ctx && ctx.state === "running" && enabled && !shuttingDown);
}

export function setEnabled(value) {
  enabled = !!value;
  try { localStorage.setItem(KEY, enabled ? "on" : "off"); } catch {}
  listeners.forEach(fn => fn(enabled));
  if (!ctx) {
    if (enabled) unlock();
    return;
  }
  const t = ctx.currentTime;
  master.gain.cancelScheduledValues(t);
  if (enabled) {
    shuttingDown = false;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setValueAtTime(0.72, t);
    if (ctx.state === "suspended") ctx.resume();
    master.gain.setValueAtTime(0.0001, t);
    master.gain.exponentialRampToValueAtTime(level(), t + 0.45);
  } else {
    // Hard mute both gain stages, then suspend the graph. No automation tail can escape.
    shuttingDown = true;
    master.gain.cancelScheduledValues(t);
    bus.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(0, t);
    bus.gain.setValueAtTime(0, t);
    master.gain.value = 0;
    bus.gain.value = 0;
    ctx.suspend().catch(() => {});
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

function unlock() {
  if (!enabled || !activated()) return;
  start();
}

function createContext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC({ latencyHint: "interactive" });
  ctx.addEventListener("statechange", paintPlaying);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -15; comp.knee.value = 10; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.18;
  limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -4; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.08;
  master = ctx.createGain(); master.gain.value = 0;
  bus = ctx.createGain(); bus.gain.value = 0.72;
  bus.connect(master); master.connect(comp); comp.connect(limiter); limiter.connect(ctx.destination);
}

// The first page of a visit fades in slowly; a page reached from the site (quick) picks the ambience up where
// the previous page left it.
function start(quick = false) {
  if (!enabled) return;
  if (!ctx) createContext();
  if (!ctx) return;
  if (!bed) buildBed();
  if (ctx.state === "suspended") ctx.resume();
  if (!unlocked) { unlocked = true; shuttingDown = false; fadeMaster(level(), quick ? 0.3 : 1.6); }
  paintPlaying();
}

/** The page is back after a departure that did not happen, or from the history (portal.js): the master comes
 *  back up. */
export function revive() {
  if (!ctx || !enabled || shuttingDown) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
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
    ctx = master = bus = limiter = null;
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
/** A voice: `source → shaper → gain → bus`, enveloped from `t`; the shaper is one node or an [input, output]
 *  pair already connected. The source starts at `t` and stops after its envelope; returns that time. */
function voice(source, t, attack, peak, decay, shaper = null) {
  const g = ctx.createGain();
  if (shaper) { const [sin, sout] = Array.isArray(shaper) ? shaper : [shaper, shaper]; source.connect(sin); sout.connect(g); }
  else source.connect(g);
  g.connect(bus);
  const end = env(g, t, attack, peak, decay);
  source.start(t); source.stop(end);
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
  const initialRoot = SCENE_NOTES[scene] || SCENE_NOTES[0];
  const initialAir = SCENE_AIR[scene] || SCENE_AIR[0];
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

  bed = { windGain, bp, drone, droneGain, droneFilter, pad, padGain, padFilter, airBp, airGain };
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

// ---------- One-shots ----------
// Levels are set before the bus (0.72) and the master (0.68), under the compressor and the limiter: a press
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
};

const lastPlayed = {};
/** Plays a one-shot if audio is running. Rate-limited per sound so repeated presses never machine-gun. */
export function sfx(name, arg) {
  if (!enabled || shuttingDown || !SFX[name] || getMode() === "lite") return;
  // A control can call its sound from pointerdown before the global gesture listener runs.
  // Unlock here too, while still inside the user gesture, so the first press is never silent.
  if (!ctx) unlock();
  if (!ctx || ctx.state !== "running" || shuttingDown) return;
  const now = performance.now();
  if (lastPlayed[name] && now - lastPlayed[name] < 40) return;
  // The world's gate and the index's scene change mark the same crossing: never both in full.
  if (name === "cross" && now - (lastPlayed.gate || -1e9) < 900) return;
  if (name === "gate" && now - (lastPlayed.cross || -1e9) < 900) arg = { ...arg, quiet: true };
  lastPlayed[name] = now;
  try { SFX[name](arg); } catch {}
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
    if (document.visibilityState === "hidden") ctx.suspend(); else if (enabled && !shuttingDown) ctx.resume();
  });
  if (enabled && !visited()) showGate();
  else { document.querySelector(".signal-gate")?.remove(); if (enabled) tryAutostart(); }
}

// ---------- Standby screen ----------
// No browser lets a page start sound on its own: the first page of a visit opens on a tube in standby.
// The whole screen is the switch: a click, a tap or a key turns the picture and the sound on together.
// The pages after it start by themselves (see tryAutostart).
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
    '<button type="button" class="signal-gate-switch" data-gate="sound" aria-label="Allumer l’écran et le son" aria-describedby="signal-gate-note">' +
    '<span class="signal-gate-name" aria-hidden="true">YOSULJIN</span>' +
    '<span class="signal-gate-dot" aria-hidden="true"></span>' +
    '<span class="signal-gate-hint" aria-hidden="true"><span class="hint-fine">Cliquez pour allumer</span><span class="hint-coarse">Touchez l’écran pour allumer</span></span>' +
    '<span class="signal-gate-keys" aria-hidden="true">ou appuyez sur une touche</span>' +
    "</button>" +
    '<p class="signal-gate-top" aria-hidden="true"><span>Yosuljin <i>·</i> entre les mondes</span><span>Canal 00</span></p>' +
    '<p class="signal-gate-note" id="signal-gate-note">L’image et le son s’allument ensemble.</p>' +
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
    // The tube powers on underneath while the standby screen fades (portal.js).
    dispatchEvent(new Event("yosuljin:enter"));
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
  window.__YOSULJIN_SOUND_QA = () => ({
    enabled, state: ctx?.state ?? "none", gain: master?.gain.value ?? 0, shuttingDown
  });
}
