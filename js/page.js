// Entry point for domain, dossier and legal pages.
// Each domain page shows its own world from the index (same moon, same colours) behind the reading column.
import { $$ } from "./core/dom.js?v=20261007-r7";
import { every, wake } from "./core/loop.js?v=20261014-r1";
import { idleLevel } from "./core/idle.js?v=20261009-r2";
import { getMode, onModeChange, reducedMotion, finePointer } from "./core/prefs.js?v=20261025-r28";
import { initGlitch } from "./ui/glitch.js?v=20261025-r28";
import { initSpatialFX } from "./ui/fx.js?v=20261025-r28";
import { initPortal } from "./ui/portal.js?v=20261025-r28";
import { initMenu } from "./ui/menu.js?v=20261025-r28";
import { initModeSwitch, initReveal } from "./ui/chrome.js?v=20261009-r2";
import { initSound, setScene as soundScene } from "./ui/sound.js?v=20261025-r28";

const root = document.documentElement;
// The butterfly cursor: a fine pointer only, fetched apart so a phone never downloads it (js/ui/papillon.js).
if (finePointer.matches) import("./ui/papillon.js?v=20261025-r28").then(m => m.demarrer()).catch(() => {});
const kind = document.body.dataset.world;
const DETAIL = { dev: 0, photo: 1, writing: 2, worlds: 3, aether: "aether" };
const canvas = document.querySelector(".world-canvas");

let world = null, stop = null, recoveryTimer = 0, menuOpen = false, skipped = false, skippedDt = 0;
// The WebGL world (world.js + gl.js + shaders.js) is fetched only when a page can show it:
// pages without data-world and every page in LITE never download it.
let createWorld = null, loadingWorld = null;
function loadWorld() {
  loadingWorld ??= import("./world/world.js?v=20261025-r28").then(m => { createWorld = m.createWorld; });
  return loadingWorld;
}
// The world follows the reading progress at every frame. The page height is measured when the page
// changes size, not in the frame callback, where reading it could force a layout; so is the end of the hero,
// under which a portrait screen keeps the world's horizon (world.js, RÉMANENCE §12.7).
const hero = document.querySelector(".detail-hero");
let maxScroll = 1, heroEnd = 0;
const measureScroll = () => {
  maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  heroEnd = hero ? hero.getBoundingClientRect().bottom + scrollY : 0;
  measureZones();
};
// The world dims itself behind the text it must keep readable (its safe zones, world.js packZones): the hero with
// the back link above it (zone 0), the foot (zone 1) and the text set on the sky without a plate (zone 2: the section
// heads of Photographie and its filter status, which cross a phone's horizon, its brightest light), measured
// in page coordinates like the index's flow layout (main.js boxes(): one box per line fragment of the text itself,
// fragments closer than a word gap or a line gap merged, largest first), so the world shifts them by the scroll at each
// frame (setScrollY) and never measures in the frame callback. Measured with the page's size, 100 ms after the fonts are in (.booted), and once the world is.
const ZONE_TEXT = [".detail-hero :is(.detail-index,.detail-title,.detail-lead,.domain-state,.detail-aside b,.detail-aside p), .detail-top", ".detail-foot :is(p,a,.detail-motto)",
  ".photo-section-head :is(.detail-index,h2,.photo-count), .photo-filter-status"];
function boxes(els) {
  const rects = [], range = document.createRange(), y = scrollY;
  for (const el of els) {
    if (el.offsetWidth <= 1 && el.offsetHeight <= 1) continue; // visually hidden
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.data.trim()) continue;
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width >= 1 && r.height >= 1) rects.push([r.left, r.top + y, r.right, r.bottom + y]);
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
function measureZones() {
  measureGuide();
  if (!world?.setZones) return;
  ZONE_TEXT.forEach((selector, i) => world.setZones(i, boxes($$(selector))));
}
// The guide of the world (world.js updateFlock, direction §8.1): its perch in the hero's void (the right column's
// centre, above the aside — only while the hero has two columns, so it is never over the title) and the right margin
// (any margin from 24 px: at 1280 the gutter; wide from 80 px, where it flies as the reader scrolls — narrower, it
// waits there when the ring shows nothing past the plates), the margin a plate aimed at calls it to as well. Measured
// with the zones, out of the frame; on a phone the world keeps it on the horizon's limb and nothing here applies.
const aside = document.querySelector(".detail-aside"), shell = document.querySelector(".detail-shell");
let marginNx = null;
function measureGuide() {
  if (!world?.setPerch || !hero || !shell) return;
  const h = hero.getBoundingClientRect(), s = shell.getBoundingClientRect(), a = aside ? aside.getBoundingClientRect() : null;
  const m = innerWidth - s.right;
  marginNx = m >= 24 ? (s.right + innerWidth) / innerWidth - 1 : null;
  world.setCompanion(marginNx, m >= 80);
  const twoCols = a && a.left - h.left > h.width * 0.4 && a.top - h.top > 30;
  world.setPerch(twoCols ? (a.left + a.right) / innerWidth - 1 : 0, twoCols ? h.top + scrollY + Math.min(0.22 * h.height, (a.top - h.top) * 0.5) : null);
}
measureScroll();
if ("ResizeObserver" in window) new ResizeObserver(measureScroll).observe(document.documentElement);
function scrollProgress() {
  return Math.min(1, scrollY / maxScroll);
}
function renderTask(now, dt) {
  // The open menu is opaque and covers the whole screen: the world behind it is not drawn.
  if (getMode() !== "full" || !world || menuOpen) return false;
  // A resting page (js/core/idle.js): one frame in two at level 1; at level 2 the world slows down to a stop
  // (setPace) and the loop sleeps once it is asleep (at once with a world that cannot slow down).
  const level = idleLevel();
  if (level === 2 && (world.asleep || !world.setPace)) return false;
  if (level === 1 && (skipped = !skipped)) { skippedDt += dt; return true; }
  world.setScroll(scrollProgress());
  world.setScrollY?.(scrollY);
  world.setFloor?.(heroEnd);
  // Third argument: the real frame interval, for the world's quality loop (a skipped frame is not a missed one).
  world.render(now, dt + skippedDt, dt);
  skippedDt = 0;
  // Under reduced motion the world is drawn once, then the loop sleeps: but not before that frame exists. While the shaders are still
  // compiling, render() draws nothing (the root has no world-live yet), and a page with nothing to scroll would never wake the loop again.
  return !reducedMotion.matches || !root.classList.contains("world-live");
}
/** Idempotent: creates the world once, (re)starts its frame task whenever FULL is active. */
function scheduleRecovery() {
  clearTimeout(recoveryTimer);
  if (!canvas || kind == null || getMode() !== "full") return;
  let tries = 0;
  const retry = () => {
    if (!canvas.isConnected || getMode() !== "full") return;
    tries++;
    runWorld();
    if (world) {
      root.classList.remove("no-webgl");
      wake();
      return;
    }
    if (tries < 10) recoveryTimer = setTimeout(retry, Math.min(1200, 180 + tries * 120));
  };
  recoveryTimer = setTimeout(retry, 220);
}

function runWorld() {
  if (!canvas || kind == null || getMode() !== "full") return;
  if (!createWorld) {
    loadWorld().then(runWorld, () => { loadingWorld = null; root.classList.add("no-webgl"); root.classList.remove("world-ready"); });
    return;
  }
  if (!world) {
    world = createWorld(canvas, { kind: "detail", detail: DETAIL[kind], quality: "balanced" });
    if (!world) { root.classList.add("no-webgl"); root.classList.remove("world-ready"); return; }
    canvas.addEventListener("world-lost", () => {
      root.classList.add("no-webgl");
      root.classList.remove("world-ready");
      world = null;
      scheduleRecovery();
    });
    measureZones();
  }
  root.classList.add("world-ready");
  if (!stop) stop = every(renderTask);
  wake();
}

canvas?.addEventListener("webglcontextrestored", scheduleRecovery, { passive: true });

// Progressive reveal for long reading pages.
$$(".detail-grid .detail-block, .photo-section, .detail-foot, .legal-page section").forEach(el => el.classList.add("reveal"));

initModeSwitch();
initSound();
const detailScene = typeof DETAIL[kind] === "number" ? DETAIL[kind] : 3;
soundScene(detailScene);
initGlitch();
initSpatialFX();
initMenu({ onToggle: open => { menuOpen = open; if (!open) wake(); } });
initPortal();
initReveal();
runWorld();
onModeChange(mode => {
  if (mode === "full") runWorld();
  else root.classList.remove("world-ready");
});
addEventListener("pointermove", e => world?.setPointer(e.clientX / innerWidth * 2 - 1, e.clientY / innerHeight * 2 - 1), { passive: true });
// A plate of the route or the foot's link aimed at (a fine pointer over it, or the keyboard's focus) calls the guide
// to the margin, level with its middle; let go, it leaves (world.js setAim). A touch aims nothing: on a phone the
// guide answers the scroll. Under reduced motion nothing is aimed: the guide stays settled on its perch, no change
// of the picture at each Tab.
const aimAt = el => {
  if (marginNx == null || reducedMotion.matches || !world?.setAim) return;
  const r = el.getBoundingClientRect();
  world.setAim(marginNx, r.top + scrollY + r.height / 2);
};
const unaim = () => world?.setAim?.(null, null);
$$(".domain-route a, .detail-foot .a1").forEach(el => {
  el.addEventListener("pointerenter", e => { if (e.pointerType !== "touch") aimAt(el); });
  el.addEventListener("pointerleave", unaim);
  el.addEventListener("focus", () => aimAt(el));
  el.addEventListener("blur", unaim);
});
addEventListener("scroll", () => { if (reducedMotion.matches) wake(); }, { passive: true });
addEventListener("resize", () => { measureScroll(); world?.resize(); }, { passive: true });
addEventListener("yosuljin:idle", e => {
  world?.setPace?.(e.detail.level === 2 ? 0 : 1);
  if (e.detail.level === 0) wake();
});
// The titles are set in Instrument Serif: they come in only once that face is there (1.5 s at most, and never
// blocked by a failed load), so they never swap font inside an animation (RÉMANENCE §4.1), as on the index.
Promise.race([document.fonts?.load?.('400 1em "Instrument Serif"'), new Promise(done => setTimeout(done, 1500))])
  .catch(() => {})
  .then(() => requestAnimationFrame(() => { root.classList.add("booted"); setTimeout(measureZones, 100); }));
// A face that lands after that deadline recomposes the titles without moving the document's height (so neither
// observer sees it): the boxes are measured once more when every font is in.
document.fonts?.ready?.then(() => measureZones());

