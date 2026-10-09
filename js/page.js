// Entry point for domain, dossier and legal pages.
// Each domain page shows its own world from the index (same moon, same colours) behind the reading column.
import { $$ } from "./core/dom.js?v=20261007-r7";
import { every, wake } from "./core/loop.js?v=20261007-r7";
import { idleLevel } from "./core/idle.js?v=20261009-r2";
import { getMode, onModeChange, reducedMotion } from "./core/prefs.js?v=20261008-r9";
import { initGlitch } from "./ui/glitch.js?v=20261009-r2";
import { initSpatialFX } from "./ui/fx.js?v=20261009-r2";
import { initPortal } from "./ui/portal.js?v=20261009-r2";
import { initMenu } from "./ui/menu.js?v=20261009-r2";
import { initModeSwitch, initReveal } from "./ui/chrome.js?v=20261009-r2";
import { initSound, setScene as soundScene } from "./ui/sound.js?v=20261009-r2";

const root = document.documentElement;
const kind = document.body.dataset.world;
const DETAIL = { dev: 0, photo: 1, writing: 2, worlds: 3, aether: "aether" };
const canvas = document.querySelector(".world-canvas");

let world = null, stop = null, recoveryTimer = 0, menuOpen = false, skipped = false, skippedDt = 0;
// The WebGL world (world.js + gl.js + shaders.js) is fetched only when a page can show it:
// pages without data-world and every page in LITE never download it.
let createWorld = null, loadingWorld = null;
function loadWorld() {
  loadingWorld ??= import("./world/world.js?v=20261009-r2").then(m => { createWorld = m.createWorld; });
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
};
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
  world.setFloor?.(heroEnd);
  // Third argument: the real frame interval, for the world's quality loop (a skipped frame is not a missed one).
  world.render(now, dt + skippedDt, dt);
  skippedDt = 0;
  return !reducedMotion.matches;
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
  .then(() => requestAnimationFrame(() => root.classList.add("booted")));

