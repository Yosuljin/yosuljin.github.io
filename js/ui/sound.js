// Sound design, fully synthesised with Web Audio (no files, nothing remote).
// A cathode-ray room: a restrained space drone and motion wind, plus a few quiet one-shots.
// No always-on mains hum or hiss: silence means silence, and effects share a controlled loudness envelope.
// Browsers only allow audio after a user gesture: the bed fades in on the first click / key / tap.
const KEY = "yosuljin-sound";
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
    master.gain.exponentialRampToValueAtTime(0.68, t + 0.45);
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

function start() {
  if (!enabled) return;
  if (!ctx) createContext();
  if (!ctx) return;
  if (!bed) buildBed();
  if (ctx.state === "suspended") ctx.resume();
  if (!unlocked) { unlocked = true; shuttingDown = false; fadeMaster(0.68, 1.6); }
  paintPlaying();
}

// Arriving from another page of the site: try to start straight away. If the browser still refuses,
// drop the silent context at once (one console notice, no sources started) and wait for a gesture.
function tryAutostart() {
  if (!enabled || ctx) return;
  createContext();
  const c = ctx;
  if (!c) return;
  setTimeout(() => {
    if (ctx !== c || unlocked) return;
    if (c.state === "running") { start(); return; }
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
function env(gainNode, t, attack, peak, decay) {
  gainNode.gain.setValueAtTime(0.0001, t);
  gainNode.gain.exponentialRampToValueAtTime(peak, t + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
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
  drone.type = "triangle"; drone.frequency.value = initialRoot; droneGain.gain.value = 0.0048;
  droneFilter.type = "lowpass"; droneFilter.frequency.value = 420; droneFilter.Q.value = 0.5;
  drone.connect(droneFilter); droneFilter.connect(droneGain); droneGain.connect(out); drone.start();

  const pad = ctx.createOscillator(), padGain = ctx.createGain(), padFilter = ctx.createBiquadFilter();
  pad.type = "sine"; pad.frequency.value = initialRoot * 2.006; padGain.gain.value = 0.0024;
  padFilter.type = "lowpass"; padFilter.frequency.value = 760; padFilter.Q.value = 0.45;
  pad.connect(padFilter); padFilter.connect(padGain); padGain.connect(out); pad.start();

  const air = noise(), airBp = ctx.createBiquadFilter(), airGain = ctx.createGain();
  airBp.type = "bandpass"; airBp.frequency.value = initialAir; airBp.Q.value = 0.55; airGain.gain.value = 0.0019;
  air.connect(airBp); airBp.connect(airGain); airGain.connect(out); air.start();

  const lfo = ctx.createOscillator(), lfoDepth = ctx.createGain();
  lfo.type = "sine"; lfo.frequency.value = 0.055; lfoDepth.gain.value = 0.0017;
  lfo.connect(lfoDepth); lfoDepth.connect(droneGain.gain); lfo.start();

  const lfo2 = ctx.createOscillator(), lfo2Depth = ctx.createGain();
  lfo2.type = "sine"; lfo2.frequency.value = 0.041; lfo2Depth.gain.value = 0.0009;
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
const SFX = {
  // Press: a dry digital tick on a low thump.
  press() {
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.09);
    o.connect(g); g.connect(bus); env(g, t, 0.002, 0.06, 0.11); o.start(t); o.stop(t + 0.14);
    SFX.tick();
  },
  tick() {
    const t = ctx.currentTime, n = noise(), g = ctx.createGain(), hp = ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 2500; n.connect(hp); hp.connect(g); g.connect(bus);
    env(g, t, 0.001, 0.042, 0.025); n.start(t); n.stop(t + 0.04);
  },
  // Menu ignition: degauss thump, rising whine.
  ignite() {
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain(), trem = ctx.createOscillator(), tremAmt = ctx.createGain();
    o.frequency.setValueAtTime(72, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.6);
    trem.frequency.value = 14; tremAmt.gain.value = 0.08; trem.connect(tremAmt); tremAmt.connect(g.gain);
    o.connect(g); g.connect(bus); env(g, t, 0.01, 0.062, 0.7); o.start(t); trem.start(t); o.stop(t + 0.8); trem.stop(t + 0.8);
    const w = ctx.createOscillator(), wg = ctx.createGain();
    w.frequency.setValueAtTime(2400, t); w.frequency.exponentialRampToValueAtTime(7800, t + 0.5);
    w.connect(wg); wg.connect(bus); env(wg, t + 0.05, 0.08, 0.0045, 0.5); w.start(t); w.stop(t + 0.7);
  },
  // Menu power-off: the picture collapses to a dot.
  poweroff() {
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "triangle"; o.frequency.setValueAtTime(1600, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.3);
    o.connect(g); g.connect(bus); env(g, t, 0.004, 0.052, 0.32); o.start(t); o.stop(t + 0.38);
    SFX.tick();
  },
  // Page portal: an inhale through the gate.
  portal() {
    const t = ctx.currentTime, n = noise(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    bp.type = "bandpass"; bp.Q.value = 2; bp.frequency.setValueAtTime(200, t); bp.frequency.exponentialRampToValueAtTime(5200, t + 0.45);
    n.connect(bp); bp.connect(g); g.connect(bus); env(g, t, 0.25, 0.055, 0.25); n.start(t); n.stop(t + 0.55);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(880, t + 0.45);
    o.connect(og); og.connect(bus); env(og, t, 0.2, 0.028, 0.28); o.start(t); o.stop(t + 0.5);
  },
  // The tube switched on from standby: thump, static, the degauss buzz dying out, the flyback whine settling.
  switchon() {
    const t = ctx.currentTime;
    const k = ctx.createOscillator(), kg = ctx.createGain();
    k.frequency.setValueAtTime(72, t); k.frequency.exponentialRampToValueAtTime(36, t + 0.28);
    k.connect(kg); kg.connect(bus); env(kg, t, 0.004, 0.075, 0.32); k.start(t); k.stop(t + 0.42);
    const n = noise(), hp = ctx.createBiquadFilter(), ng = ctx.createGain();
    hp.type = "highpass"; hp.frequency.value = 2400;
    n.connect(hp); hp.connect(ng); ng.connect(bus); env(ng, t, 0.004, 0.03, 0.36); n.start(t); n.stop(t + 0.46);
    const d = ctx.createOscillator(), lp = ctx.createBiquadFilter(), dg = ctx.createGain(), wob = ctx.createOscillator(), wobDepth = ctx.createGain();
    d.type = "sawtooth"; d.frequency.value = 50;
    lp.type = "lowpass"; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(140, t + 1.2);
    wob.frequency.setValueAtTime(11, t); wob.frequency.linearRampToValueAtTime(4, t + 1.2);
    d.connect(lp); lp.connect(dg); dg.connect(bus); wob.connect(wobDepth); wobDepth.connect(dg.gain);
    env(dg, t + 0.03, 0.05, 0.045, 1.15); env(wobDepth, t + 0.03, 0.05, 0.018, 1.15);
    d.start(t); wob.start(t); d.stop(t + 1.35); wob.stop(t + 1.35);
    const w = ctx.createOscillator(), wg = ctx.createGain();
    w.frequency.setValueAtTime(8400, t); w.frequency.exponentialRampToValueAtTime(7600, t + 0.6);
    w.connect(wg); wg.connect(bus); env(wg, t + 0.05, 0.12, 0.004, 0.9); w.start(t); w.stop(t + 1.1);
  },
  // The camera flies through a gate of the world (FULL 3D, "world-gate" event): a breath through the ring,
  // then a soft impact. Quiet when the index's scene change has just played the same crossing.
  gate(detail) {
    const t = ctx.currentTime;
    if (!detail?.quiet) {
      const n = noise(), bp = ctx.createBiquadFilter(), ng = ctx.createGain();
      bp.type = "bandpass"; bp.Q.value = 1.4; bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(3800, t + 0.45);
      n.connect(bp); bp.connect(ng); ng.connect(bus); env(ng, t, 0.22, 0.04, 0.3); n.start(t); n.stop(t + 0.6);
      const k = ctx.createOscillator(), kg = ctx.createGain();
      k.frequency.setValueAtTime(64, t + 0.2); k.frequency.exponentialRampToValueAtTime(40, t + 0.45);
      k.connect(kg); kg.connect(bus); env(kg, t + 0.2, 0.006, 0.045, 0.26); k.start(t); k.stop(t + 0.55);
    }
  },
  // Crossing into another world: a low swell.
  cross() {
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sawtooth"; o.frequency.setValueAtTime(55, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.4);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 300;
    o.connect(lp); lp.connect(g); g.connect(bus); env(g, t, 0.05, 0.052, 0.45); o.start(t); o.stop(t + 0.55);
  }
};

const lastPlayed = {};
/** Plays a one-shot if audio is running. Rate-limited per sound so repeated presses never machine-gun. */
export function sfx(name, arg) {
  if (!enabled || shuttingDown || !SFX[name]) return;
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
  if (enabled) visited() ? tryAutostart() : showGate();
}

// ---------- Standby screen ----------
// No browser lets a page start sound on its own: the first page of a visit opens on a tube in standby.
// The whole screen is the switch: a click, a tap or a key turns the picture and the sound on together.
// The pages after it start by themselves (see tryAutostart).
function switchOn() {
  unlock();
  if (!ctx) return;
  fadeMaster(0.68, 0.06); // the switch-on sound must not wait for the bed's slow fade-in
  if (ctx.state === "running") sfx("switchon");
  else ctx.resume().then(() => sfx("switchon")).catch(() => {});
}

function showGate() {
  if (document.querySelector(".signal-gate") || typeof HTMLDialogElement !== "function") return;
  const gate = document.createElement("dialog");
  gate.className = "signal-gate";
  gate.setAttribute("aria-label", "Écran en veille");
  gate.innerHTML =
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
    const done = () => { gate.close(); gate.remove(); };
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
  document.body.appendChild(gate);
  gate.showModal();
}

// Local QA only; production exposes no audio graph/state.
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  window.__YOSULJIN_SOUND_QA = () => ({
    enabled, state: ctx?.state ?? "none", gain: master?.gain.value ?? 0, shuttingDown
  });
}
