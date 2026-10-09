// Index entry point.
// FULL 3D on a precise pointer = "cinema": the page is one fixed viewport, the wheel moves a camera
// through the WebGL world and each scene's text flies in and out of depth with it.
// LITE, touch devices and reduced motion keep a normal scrolling document.
import { $, $$, clamp, smoothstep, setStyle } from "./js/core/dom.js?v=20261007-r7";
import { every, wake } from "./js/core/loop.js?v=20261007-r7";
import { getMode, isCinema, onModeChange, reducedMotion, finePointer } from "./js/core/prefs.js?v=20261008-r9";
import { initGlitch } from "./js/ui/glitch.js?v=20261009-r2";
import { initSpatialFX } from "./js/ui/fx.js?v=20261009-r2";
import { initPortal } from "./js/ui/portal.js?v=20261009-r2";
import { initMenu } from "./js/ui/menu.js?v=20261009-r2";
import { initModeSwitch, initReveal } from "./js/ui/chrome.js?v=20261009-r2";
import { initSound, sfx, setScene as soundScene, setVelocity } from "./js/ui/sound.js?v=20261009-r2";
import { idleLevel } from "./js/core/idle.js?v=20261009-r2";

const root = document.documentElement;
const panels = $$(".panel");
const SCENES = panels.map(p => p.id);
const LAST = panels.length - 1;
// The scene to focus once it is active, after a scene link or a scene key used from inside a scene: the scene left
// turns inert, and the focus must not fall to <body>.
let pendingFocus = -1;
const NAMES = panels.map(p => p.dataset.name || p.id.toUpperCase());
const canvas = $(".world-canvas");
const scenesEl = $(".scenes");
const presence = $(".presence-dock");
const progressLine = $(".progress-line i");
const progressIndex = $("[data-progress-index]");
const progressName = $("[data-progress-name]");
const transit = { el: $(".transit"), from: $("[data-transit-from]"), to: $("[data-transit-to]"), bar: $("[data-transit-bar]") };

const setText = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };

// ---------- Route physics ----------
const nav = { target: 0, route: 0, vel: 0, lastInput: 0, settled: true };
const STIFF = 46, DAMP = 2 * Math.sqrt(46) * 0.92;

function goTo(index, instant = false) {
  nav.target = clamp(index, 0, LAST);
  nav.lastInput = -1e9; // a programmatic move is already "settled" on its target
  if (instant || reducedMotion.matches) { nav.route = nav.target; nav.vel = 0; }
  if (!isCinema()) {
    const panel = panels[Math.round(nav.target)];
    panel?.scrollIntoView({ behavior: instant || reducedMotion.matches ? "auto" : "smooth", block: "start" });
  }
  nav.settled = false;
  wake();
}
export function navigateToPanel(id, instant = false) {
  const i = SCENES.indexOf(id);
  if (i >= 0) goTo(i, instant);
}

// ---------- World ----------
let world = null, worldStop = null, lastRoute = -1, lastScene = -1, worldRecoveryTimer = 0;
// The WebGL world (world.js + gl.js + shaders.js) is fetched on demand, as in js/page.js:
// a visit in LITE never downloads it. In FULL, js/boot.js has already announced it
// (modulepreload), so the import does not wait for the rest of this module graph.
let createWorld = null, loadingWorld = null;
function loadWorld() {
  loadingWorld ??= import("./js/world/world.js?v=20261009-r2").then(m => { createWorld = m.createWorld; });
  return loadingWorld;
}

function scheduleWorldRecovery() {
  clearTimeout(worldRecoveryTimer);
  if (getMode() !== "full" || !canvas) return;
  let tries = 0;
  const retry = () => {
    if (getMode() !== "full" || !canvas?.isConnected) return;
    tries++;
    const recovered = ensureWorld();
    if (recovered) {
      root.classList.remove("no-webgl");
      lastRoute = -1;
      wake();
      return;
    }
    if (tries < 10) worldRecoveryTimer = setTimeout(retry, Math.min(1200, 180 + tries * 120));
  };
  worldRecoveryTimer = setTimeout(retry, 220);
}

function ensureWorld() {
  if (world || !canvas || getMode() !== "full") return world;
  if (!createWorld) {
    // Still downloading: the fallback background stays up (no "no-webgl" yet). Once the module is in,
    // build the world and force one frame (lastRoute = -1) so even reduced motion paints it.
    loadWorld().then(() => { if (ensureWorld()) { lastRoute = -1; wake(); } },
      () => { loadingWorld = null; root.classList.add("no-webgl"); root.classList.remove("world-ready"); });
    return null;
  }
  world = createWorld(canvas, { kind: "index", quality: "balanced" });
  if (!world) { root.classList.add("no-webgl"); root.classList.remove("world-ready"); return null; }
  world.setPace?.(idle >= 2 ? 0 : 1);
  remeasure();
  root.classList.add("world-ready");
  canvas.addEventListener("world-lost", () => {
    root.classList.add("no-webgl");
    root.classList.remove("world-ready");
    // Keep the frame task registered but idle; recovery can wake it after restoration.
    world = null;
    scheduleWorldRecovery();
  });
  return world;
}

canvas?.addEventListener("webglcontextrestored", scheduleWorldRecovery, { passive: true });

// ---------- Annotations: labels pinned to objects of the world ----------
const marksLayer = $(".marks");
// Same conditions as the CSS that hides the labels (styles.css 07): no work for labels nobody sees.
const marksHidden = matchMedia("(max-width:700px), (max-height:520px) and (orientation:landscape)");
const markPool = new Map();
function updateMarks() {
  if (!marksLayer || !world) return;
  const seen = new Set();
  for (const m of world.marks()) {
    seen.add(m.key);
    let el = markPool.get(m.key);
    if (!el) {
      el = document.createElement("div");
      el.className = "mark tone-" + (m.tone || "dim");
      el.innerHTML = '<i class="mark-dot"></i><span class="mark-line"></span><span class="mark-text"><b></b><small></small></span>';
      el.querySelector("b").textContent = m.label;
      marksLayer.appendChild(el);
      markPool.set(m.key, el);
    }
    const small = el.querySelector("small");
    if (small.textContent !== (m.sub || "")) { small.textContent = m.sub || ""; el._w = 0; }
    // A label stays whole inside the window: towards the right if it fits, else towards the left, else hidden;
    // an anchor off the window hides it too. Its width is measured once (again when its text changes).
    if (!el._w) el._w = el.querySelector(".mark-text").offsetWidth || 1;
    const fitsRight = m.x + 30 + el._w < innerWidth - 12, fitsLeft = m.x - 30 - el._w > 12;
    const inside = m.x > 12 && m.x < innerWidth - 12 && m.y > 40 && m.y < innerHeight - 24;
    el.classList.toggle("flip", !fitsRight && fitsLeft);
    setStyle(el, "transform", `translate3d(${m.x.toFixed(1)}px,${m.y.toFixed(1)}px,0)`);
    // Under the presence column the label would collide with the links: let it fade (its far end counts).
    const right = fitsRight ? m.x + 30 + el._w : m.x - 30;
    const underDock = root.classList.contains("presence-live") && right > innerWidth - 330;
    setStyle(el, "opacity", (inside && (fitsRight || fitsLeft) ? Math.min(1, m.alpha) * (underDock ? 0.12 : 1) : 0).toFixed(2));
  }
  for (const [key, el] of markPool) if (!seen.has(key)) setStyle(el, "opacity", "0");
}

// ---------- Safe zones: the world dims a bright background behind the text ----------
// Boxes are measured when a scene is at rest (its panel is then untransformed), again after fonts and on resize.
const ZONE_TEXT = ".eyebrow,.kicker,.project-kicker,.hero-title,.hero-lead,.home-bottom,.display-title,.lead,.about-copy,.about-footer,.channels-footer,.aether-bottom";
const HUD_TEXT = ".top-meta,.hud-hint";
const measured = new Set();
// The boxes of the text itself, not of the blocks that hold it (a full-width row would dim a stripe right across
// the world): one rect per line fragment of each text node, then fragments closer than a word gap or a line gap
// are merged, so a paragraph gives one box and a row with text at both ends gives two. Largest first.
function boxes(els) {
  const rects = [], range = document.createRange();
  for (const el of els) {
    if (el.offsetWidth <= 1 && el.offsetHeight <= 1) continue; // visually hidden (a phone's scene links at rest)
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.data.trim()) continue;
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width >= 1 && r.height >= 1 && r.bottom > 0 && r.top < innerHeight) rects.push([r.left, r.top, r.right, r.bottom]);
    }
  }
  const near = (a, b) => a[0] - 40 < b[2] && b[0] - 40 < a[2] && a[1] - 14 < b[3] && b[1] - 14 < a[3];
  for (let merged = true; merged;) {
    merged = false;
    for (let a = 0; a < rects.length && !merged; a++) for (let b = a + 1; b < rects.length; b++) {
      if (!near(rects[a], rects[b])) continue;
      const A = rects[a], B = rects.splice(b, 1)[0];
      rects[a] = [Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[2], B[2]), Math.max(A[3], B[3])];
      merged = true; break;
    }
  }
  return rects.sort((p, q) => (q[2] - q[0]) * (q[3] - q[1]) - (p[2] - p[0]) * (p[3] - p[1]));
}
function measureZones(i) {
  if (!world?.setZones) return;
  if (i === -1) world.setZones(-1, boxes($$(HUD_TEXT)));
  else {
    world.setZones(i, boxes($$(ZONE_TEXT, panels[i]))); measured.add(i);
    // The one lit title (the Entrée's) is a light source for the world: its box, in CSS px.
    const lit = i === 0 && $(".hero-title .write-ink", panels[0])?.getBoundingClientRect();
    if (lit && lit.width) world.setTitle?.([lit.left, lit.top, lit.right, lit.bottom]);
  }
}
/** The Entrée's bottom row ends here (CSS px from the top of the page): on a portrait screen the world keeps its
 *  planet under it (RÉMANENCE §12.7). Layout offsets, so neither a scene's motion nor the scroll changes it. */
function measureFloor() {
  const row = $(".home-bottom", panels[0]);
  if (!row || !world?.setFloor) return;
  let y = row.offsetHeight;
  for (let el = row; el; el = el.offsetParent) y += el.offsetTop;
  world.setFloor(y);
}
// The page scrolls (flow layout): the text on screen is measured in page coordinates and the world shifts the boxes
// by the scroll at each frame. Measured at load, after the fonts, on resize and on a change of layout, and again once
// the scroll settles (no measuring while it moves); reduced motion then draws one frame with them.
let flowTimer = 0;
function measureFlowZones() {
  if (!world?.setZones || isCinema()) return;
  const y = scrollY;
  panels.forEach((p, i) => world.setZones(i, boxes($$(ZONE_TEXT, p)).map(r => [r[0], r[1] + y, r[2], r[3] + y])));
  lastRoute = -1; wake();
}
function remeasure() { measured.clear(); measureZones(-1); measureFloor(); measureFlowZones(); wake(); }

// ---------- Cinema choreography ----------
const phoneQuery = matchMedia("(max-width:700px)");
// Text layers sit at their own depth (data-depth, px) and separate while a scene flies in or out.
// Written as the `translate` property, which composes with hover transforms; nothing is written at rest.
const depthLayers = panels.map(p => $$("[data-depth]", p).map(el => [el, +el.dataset.depth || 0]));
function layoutCinema() {
  // Phones use the same camera language as desktop, with a shorter depth corridor for touch.
  // Adjacent worlds briefly coexist in perspective so a swipe reads as a real spatial transition.
  if (phoneQuery.matches) {
    // Adjacent worlds briefly coexist in perspective so a swipe reads as a real spatial transition.
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i];
      const d = nav.route - i;
      const ad = Math.abs(d);
      const o = 1 - smoothstep(0.18, 0.96, ad);
      const visible = o > 0.004;
      const z = d * 470;
      const y = -d * 26;
      const rx = d * 6.5;
      const scale = 1 - Math.min(0.055, ad * 0.035);
      const active = ad < 0.22;
      setStyle(p, "visibility", visible ? "visible" : "hidden");
      setStyle(p, "opacity", visible ? o.toFixed(3) : "0");
      setStyle(p, "transform", visible ? `translate3d(0,${y.toFixed(1)}px,${z.toFixed(1)}px) rotateX(${rx.toFixed(2)}deg) scale(${scale.toFixed(4)})` : "none");
      setStyle(p, "pointerEvents", active ? "auto" : "none");
      if (p.inert === active) { p.inert = !active; if (active && i === pendingFocus) { pendingFocus = -1; p.tabIndex = -1; p.focus({ preventScroll: true }); } }
      for (const [el] of depthLayers[i]) setStyle(el, "translate", ""); // phones keep the text flat
    }
    if (transit.el) setStyle(transit.el, "opacity", "0");
    if (presence) {
      setStyle(presence, "--reveal", "0");
      if (!presence.inert) presence.inert = true;
    }
    root.classList.remove("presence-live");
    return;
  }
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    const d = nav.route - i, ad = Math.abs(d);
    const visible = ad < 0.62;
    setStyle(p, "visibility", visible ? "visible" : "hidden");
    if (!visible) { if (!p.inert) p.inert = true; continue; }
    const o = 1 - smoothstep(0.14, 0.5, ad);
    // Passing scenes rush past the viewer; arriving scenes rise from deep space.
    const z = d >= 0 ? d * 680 : d * 1150;
    const y = -d * 34, rx = d * 7;
    setStyle(p, "opacity", o.toFixed(3));
    setStyle(p, "transform", `translate3d(0,${y.toFixed(1)}px,${z.toFixed(1)}px) rotateX(${rx.toFixed(2)}deg)`);
    for (const [el, depth] of depthLayers[i]) { const dz = Math.round(d * depth); setStyle(el, "translate", dz ? `0 0 ${dz}px` : ""); }
    const active = ad < 0.22;
    if (p.inert === active) { p.inert = !active; if (active && i === pendingFocus) { pendingFocus = -1; p.tabIndex = -1; p.focus({ preventScroll: true }); } }
    setStyle(p, "pointerEvents", active ? "auto" : "none");
  }
  // Between two worlds the instrument shows where the camera is going.
  if (transit.el) {
    const from = Math.min(LAST - 1, Math.floor(nav.route)), frac = nav.route - from;
    const o = 1 - smoothstep(0.05, 0.17, Math.abs(frac - 0.5));
    setStyle(transit.el, "opacity", o.toFixed(3));
    if (o > 0) {
      if (transit.from.textContent !== NAMES[from]) { transit.from.textContent = NAMES[from]; transit.to.textContent = NAMES[from + 1]; }
      setStyle(transit.bar, "transform", `scaleX(${frac.toFixed(3)})`);
    }
  }
  const reveal = clamp((nav.route - 2.55) / 0.4);
  if (presence) {
    setStyle(presence, "--reveal", reveal.toFixed(3));
    const live = reveal > 0.5;
    if (presence.inert === live) presence.inert = !live;
    root.classList.toggle("presence-live", live);
  }
}
function clearCinema() {
  panels.forEach(p => { ["visibility", "opacity", "transform", "pointerEvents"].forEach(k => setStyle(p, k, "")); p.inert = false; });
  depthLayers.flat().forEach(([el]) => setStyle(el, "translate", ""));
  if (presence) { setStyle(presence, "--reveal", ""); presence.inert = false; }
  root.classList.remove("presence-live");
}

// ---------- Flow mode (LITE / touch): the route follows the document scroll ----------
function routeFromScroll() {
  const y = scrollY + Math.min(scrollY, innerHeight * 0.12);
  for (let i = 0; i < LAST; i++) {
    const a = panels[i].offsetTop, b = panels[i + 1].offsetTop;
    if (y < b) return clamp(i + (y - a) / Math.max(1, b - a), 0, LAST);
  }
  return LAST;
}

// ---------- Idle (js/core/idle.js) ----------
// Level 1: the world stays alive at half rate (one frame out of two). Level 2: its clock slows down to a stop
// and the loop sleeps; the first gesture brings the pace back (eased by the world).
let idle = idleLevel(), idleTick = 0, skipped = 0;
addEventListener("yosuljin:idle", e => {
  idle = e.detail?.level || 0;
  world?.setPace?.(idle >= 2 ? 0 : 1);
  wake();
});

// ---------- Frame ----------
function frame(now, dt) {
  const cinema = isCinema();
  if (cinema) {
    // Soft magnet: once the wheel rests, drift to the nearest world so content is never left half-faded.
    if (now - nav.lastInput > 420) nav.target = Math.round(nav.target);
    const a = STIFF * (nav.target - nav.route) - DAMP * nav.vel;
    nav.vel += a * dt; nav.route = clamp(nav.route + nav.vel * dt, 0, LAST);
    if (Math.abs(nav.target - nav.route) < 0.0005 && Math.abs(nav.vel) < 0.002) { nav.route = nav.target; nav.vel = 0; }
  } else {
    const r = routeFromScroll();
    nav.vel = (r - nav.route) / Math.max(dt, 1 / 240);
    nav.route = r; nav.target = r;
  }
  const moving = nav.route !== lastRoute;
  if (moving) {
    lastRoute = nav.route;
    if (cinema) layoutCinema();
    const i = Math.round(nav.route);
    // Crossing into another world: its sound (the world's gate gives the light; no extra tear on top).
    if (i !== lastScene) { if (lastScene >= 0) sfx("cross"); soundScene(i); lastScene = i; }
    setText(progressIndex, String(i).padStart(2, "0"));
    setText(progressName, NAMES[i]);
    progressLine && setStyle(progressLine, "transform", `scaleY(${(nav.route / LAST).toFixed(4)})`);
    if (window.__YOSULJIN_QA) window.__worldScene = { route: nav.route, scene: i };
  }
  // A scene at rest whose text has not been measured yet (or since a resize): measure it now.
  if (cinema && world && nav.route === nav.target && !nav.vel && Number.isInteger(nav.route) && !measured.has(nav.route)) measureZones(nav.route);
  setVelocity(nav.vel);
  // The open menu is opaque and covers the screen: the world rests behind it (no GPU, no JS per frame).
  // Idle level 1: one frame out of two; the skipped time is carried into the next frame (its clock stays true),
  // while the quality loop still sees the real frame interval.
  const halfRate = idle === 1 && !moving && !!(++idleTick & 1);
  if (halfRate) skipped += dt;
  if (world && getMode() === "full" && !menu.isOpen() && !halfRate && !(world.asleep && !moving)) {
    world.setScrollY?.(cinema ? null : scrollY);
    world.setRoute(nav.route, nav.vel, nav.target);
    if (!reducedMotion.matches || moving) { world.render(now, dt + skipped, dt); skipped = 0; if (cinema && !marksHidden.matches && (Math.floor(now / 33) !== Math.floor((now - dt * 1000) / 33))) updateMarks(); }
  }
  // Keep running while the world animates; otherwise sleep until the next input.
  return !!(world && getMode() === "full" && !reducedMotion.matches && !menu.isOpen() && !world.asleep) || Math.abs(nav.vel) > 0 || nav.route !== nav.target;
}

// ---------- Inputs ----------
const menu = initMenu({ onToggle: open => { if (open) nav.lastInput = performance.now(); else { lastRoute = -1; wake(); } } });
addEventListener("wheel", e => {
  if (!isCinema() || menu.isOpen()) return;
  e.preventDefault();
  pendingFocus = -1; // the reader takes over the navigation
  const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * innerHeight : e.deltaY;
  nav.target = clamp(nav.target + px / Math.max(560, innerHeight) * 0.9, 0, LAST);
  nav.lastInput = performance.now();
  wake();
}, { passive: false });
addEventListener("keydown", e => {
  if (!isCinema() || menu.isOpen() || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.target.closest?.("input,textarea,select,[contenteditable]") || document.querySelector("dialog[open]")) return;
  if (e.key === " " && e.target.closest?.("button,[role=button],summary")) return;
  const at = Math.round(nav.target);
  const map = { ArrowDown: at + 1, PageDown: at + 1, ArrowUp: at - 1, PageUp: at - 1, Home: 0, End: LAST, " ": e.shiftKey ? at - 1 : at + 1 };
  if (!(e.key in map)) return;
  e.preventDefault();
  // From inside a scene or the presence dock, the focus follows to the scene reached; a key that keeps the scene,
  // or one pressed elsewhere (the top bar), leaves no pending focus behind.
  const to = clamp(map[e.key], 0, LAST);
  pendingFocus = e.target.closest?.(".panel, .presence-dock") && panels[to].inert ? to : -1;
  goTo(to);
});
// Touch in cinema: mobile uses the same camera route as desktop. A swipe turns one world, like a pager:
// a short flick is enough (speed or distance), the camera follows the finger meanwhile, and a tap that
// trembles a few pixels stays a tap (dead zone) instead of moving the scene from under the finger.
let touch = null;
const TOUCH_SLOP = 10;
addEventListener("touchstart", e => {
  touch = isCinema() && !menu.isOpen() && e.touches.length === 1
    ? { y0: e.touches[0].clientY, y: e.touches[0].clientY, t0: performance.now(), from: Math.round(nav.target), dragging: false }
    : null;
}, { passive: true });
addEventListener("touchmove", e => {
  if (!touch || !isCinema() || menu.isOpen() || e.touches.length !== 1) return;
  const y = e.touches[0].clientY;
  if (!touch.dragging && Math.abs(y - touch.y0) < TOUCH_SLOP) return; // still a tap
  touch.dragging = true; touch.y = y; pendingFocus = -1;
  e.preventDefault();
  // Follow the finger, never more than one world away from where the gesture started.
  nav.target = clamp(touch.from + clamp((touch.y0 - y) / innerHeight * 1.6, -1, 1), 0, LAST);
  nav.lastInput = performance.now(); wake();
}, { passive: false });
function endTouch() {
  if (touch?.dragging && isCinema() && !menu.isOpen()) {
    const dy = touch.y0 - touch.y, dt = Math.max(1, performance.now() - touch.t0);
    const turn = Math.abs(dy) / dt > 0.3 || Math.abs(dy) > innerHeight * 0.08;
    nav.target = clamp(touch.from + (turn ? Math.sign(dy) : 0), 0, LAST);
    nav.lastInput = -1e9; wake();
  }
  touch = null;
}
addEventListener("touchend", endTouch, { passive: true });
addEventListener("touchcancel", endTouch, { passive: true });

document.addEventListener("click", e => {
  const link = e.target.closest?.("[data-scene-link]");
  if (!link) return;
  e.preventDefault();
  pendingFocus = SCENES.indexOf(link.dataset.sceneLink);
  navigateToPanel(link.dataset.sceneLink);
  if (!isCinema() && pendingFocus >= 0) { const p = panels[pendingFocus]; p.tabIndex = -1; p.focus({ preventScroll: true }); pendingFocus = -1; }
});
// Domain cards light their moon in the world.
$$("[data-domain]").forEach((card, i) => {
  const focus = on => world?.setFocus(on ? i : -1);
  card.addEventListener("pointerenter", () => focus(true));
  card.addEventListener("pointerleave", () => focus(false));
  card.addEventListener("focus", () => focus(true));
  card.addEventListener("blur", () => focus(false));
});
// Pointer parallax for the world and a slight tilt of the scene stack.
addEventListener("pointermove", e => {
  if (!finePointer.matches) return;
  const x = e.clientX / innerWidth * 2 - 1, y = e.clientY / innerHeight * 2 - 1;
  world?.setPointer(x, y);
  if (scenesEl && isCinema()) { setStyle(scenesEl, "--tilt-x", (-y * 1.6).toFixed(2) + "deg"); setStyle(scenesEl, "--tilt-y", (x * 2.4).toFixed(2) + "deg"); }
}, { passive: true });

// ---------- Mode switching ----------
let stopFrame = null;
function applyRuntimeMode() {
  const cinema = isCinema();
  root.classList.toggle("cinema", cinema);
  if (getMode() === "full") ensureWorld();
  if (cinema) {
    // nav.route already tracks the document scroll in flow mode, so it carries over.
    const r = Math.round(nav.route);
    scrollTo(0, 0);
    nav.route = nav.target = r; nav.vel = 0; lastRoute = -1;
  } else {
    const r = Math.round(nav.route);
    clearCinema();
    // scrollTo, not scrollIntoView: the latter also moves the sequential focus start,
    // so the first Tab skipped the skip link and the whole top bar.
    requestAnimationFrame(() => { const p = panels[r]; if (p) scrollTo(0, p.getBoundingClientRect().top + scrollY); });
  }
  if (!stopFrame) stopFrame = every(frame);
  // The layout changed (cinema or flow): the text boxes and the Entrée's row are measured again.
  remeasure();
}
onModeChange(applyRuntimeMode);
addEventListener("scroll", () => {
  if (isCinema()) return;
  wake();
  clearTimeout(flowTimer); flowTimer = setTimeout(measureFlowZones, 150);
}, { passive: true });
addEventListener("resize", () => { world?.resize(); lastRoute = -1; remeasure(); }, { passive: true });
// Webfonts and the title's arrival move the text a little: measure again once both are done.
document.fonts?.ready.then(remeasure);
setTimeout(remeasure, 1600);

// ---------- Boot ----------
initModeSwitch();
initSound();
initGlitch();
initSpatialFX();
// The skip link (« Aller au contenu ») from another scene: #home is still inert, so it takes the focus on arrival.
initPortal({ samePage: url => { menu.close(); pendingFocus = url?.hash && panels[0].inert ? 0 : -1; goTo(0, false); if (!isCinema()) scrollTo({ top: 0, behavior: reducedMotion.matches ? "auto" : "smooth" }); } });
initReveal();
// Deep links (#about, #channels, #aether) open the matching world.
{
  let hash = "";
  try { hash = decodeURIComponent(location.hash.slice(1)); } catch { hash = ""; }
  const fromHash = SCENES.indexOf(hash);
  nav.route = nav.target = isCinema() ? Math.max(0, fromHash) : routeFromScroll();
}
applyRuntimeMode();
// The title is set in Instrument Serif: its words come in only once that face is there (1.5 s at most), so
// they never swap font inside the cinema's 3D layers (direction §4.1; until then .js hides them).
Promise.race([document.fonts?.load?.('400 1em "Instrument Serif"'), new Promise(done => setTimeout(done, 1500))])
  .catch(() => {})
  .then(() => requestAnimationFrame(() => root.classList.add("booted")));

// Stable hooks exist only on the loopback QA server; production exposes no navigation/debug API.
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  window.__YOSULJIN_QA = true;
  window.__navigateToPanel = navigateToPanel;
  window.__qaSetRoute = r => { nav.target = nav.route = clamp(r, 0, LAST); nav.vel = 0; nav.lastInput = performance.now() + 1e9; wake(); };
}


