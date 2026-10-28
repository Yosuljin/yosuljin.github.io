// Project scenes (D147): a small 3D scene a reader touches, one per project, built from the same parts.
// The page holds what a scene says: its parts are buttons, its legend a <dl>, its drawing without 3D an SVG
// (aether.html, figure.aether-scene). This module makes that HTML play — the same way in every mode:
//   - touching a part (finger, mouse, Enter or Space on its button) marks it, says its legend aloud (live region),
//     strikes its note if the site's sound is on, and counts it toward the goal; all parts found completes the scene;
//   - one Tab stop for the whole scene (roving tabindex), arrows and Home/End move between parts;
//   - in FULL 3D, with motion allowed, WebGL and no forced colours, js/scenes/kit.js draws the scene and the
//     buttons ride on what it draws; the drawing turns by itself and under a horizontal drag; otherwise the SVG
//     stays, still, with the same buttons on it.
// A project's data (its parts' shapes, colours, notes) is the module named in data-module; _outils/scenes/
// GRAMMAIRE.md says how a scene is added. The loop stops off screen, in a hidden tab and at deep rest.
import { every, wake } from "../core/loop.js?v=20261014-r1";
import { sfx } from "../ui/sound.js?v=20261025-r28";

const html = document.documentElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const forced = matchMedia("(forced-colors: active)");
const wanted = () => html.classList.contains("mode-full") && !reduced.matches && !forced.matches;

/** Returns `dispose()`, which gives back everything the scene holds on the page (observers, listeners, the drawing) — a showcase of the museum
 *  calls it when it closes, or each opening would leave the scene's nodes and listeners behind. Nothing in the pages that keep their scenes. */
function setup(fig) {
  if (fig.dataset.sceneSetup) return;   // the museum's showcases set up the scenes they show (js/musee/musee.js)
  fig.dataset.sceneSetup = "1";
  const stage = fig.querySelector("[data-scene-stage]");
  const buttons = [...fig.querySelectorAll(".scene-part[data-part]")];
  if (!stage || !buttons.length) return;
  const legend = new Map([...fig.querySelectorAll("[data-legend]")].map(el => [el.dataset.legend, el]));
  const live = fig.querySelector("[data-scene-live]");
  const count = fig.querySelector("[data-scene-count]");
  const still = fig.querySelector(".scene-still");
  const found = new Set();
  let data = null, kit = null, canvas = null, loading = null, onscreen = false, rest = 0, stop = null, drawnOnce = false, disposed = false;
  const undo = [];   // what dispose() gives back (observers, listeners on the window and on the media queries)

  // ---------- What a touch does (every mode) ----------
  const say = text => { if (!live) return; live.textContent = ""; requestAnimationFrame(() => { live.textContent = text; }); };
  const legendText = id => legend.get(id)?.querySelector("dd")?.textContent.trim() || "";
  const nameOf = b => b.querySelector(".scene-part-name")?.textContent.trim() || b.dataset.part;
  const note = id => data?.parts.find(p => p.id === id)?.note;
  function current(id) { legend.forEach((el, k) => el.classList.toggle("is-current", k === id)); }
  function activate(b) {
    const id = b.dataset.part, first = !found.has(id);
    kit?.touch(id);
    current(id);
    sfx("glass", note(id) || 660);
    if (first) {
      found.add(id);
      b.classList.add("is-found");
      legend.get(id)?.classList.add("is-found");
      still?.querySelector(`[data-shape="${id}"]`)?.classList.add("is-found");
      kit?.found(id);
      named();
      if (count) count.textContent = String(found.size);
    }
    const done = found.size === buttons.length;
    let text = `${nameOf(b)}. ${legendText(id)}`;
    if (first && done) {
      fig.classList.add("is-complete");
      kit?.complete();
      setTimeout(() => sfx("chord", buttons.map(x => note(x.dataset.part)).filter(Boolean)), 260);
      text += " " + (fig.dataset.sceneDone || "");
    } else if (!done) text += ` (${found.size} sur ${buttons.length})`;
    say(text);
    wake();
  }

  // ---------- Keyboard: one Tab stop, arrows between parts ----------
  const rove = b => buttons.forEach(x => x.setAttribute("tabindex", x === b ? "0" : "-1"));
  rove(buttons[0]);
  buttons.forEach((b, i) => {
    b.addEventListener("click", () => { rove(b); activate(b); });
    b.addEventListener("focus", () => { rove(b); current(b.dataset.part); named(); });
    b.addEventListener("blur", () => named());
    b.addEventListener("keydown", e => {
      const n = buttons.length;
      const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: n - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      buttons[(to + n) % n].focus();
    });
  });
  fig.addEventListener("focusout", e => { if (!fig.contains(e.relatedTarget)) current(null); });

  // ---------- Placing the buttons ----------
  // A button is moved by its own transform, written only when it moves a quarter pixel: a custom property
  // (--x) set every frame recalculated the park's styles (its :has() rules) and halved the phone's frame rate
  // (2026-10-21, 390 px, CPU ×4: 35 images a second with the buttons riding, 85 without them).
  const moved = new WeakMap(), half = new WeakMap();
  function put(b, x, y) {
    const m = moved.get(b);
    if (m && Math.abs(m[0] - x) < 0.25 && Math.abs(m[1] - y) < 0.25) return;
    moved.set(b, [x, y]);
    const h = half.get(b) || half.set(b, [b.offsetWidth / 2, b.offsetHeight / 2]).get(b);
    b.style.transform = `translate3d(${(x - h[0]).toFixed(1)}px,${(y - h[1]).toFixed(1)}px,0)`;
  }
  // On the still drawing: each part's anchor in the SVG (data-anchor), read through the SVG's own scaling.
  function placeStill() {
    if (!still) return;
    const s = stage.getBoundingClientRect();
    buttons.forEach(b => {
      const a = still.querySelector(`[data-anchor="${b.dataset.part}"]`);
      if (!a) return;
      const r = a.getBoundingClientRect();
      put(b, r.left + r.width / 2 - s.left, r.top + r.height / 2 - s.top);
      b.classList.remove("is-behind");
    });
  }
  const at = [0, 0, 0];
  function placeLive() {
    buttons.forEach(b => {
      if (!kit.screen(b.dataset.part, at)) return;
      put(b, at[0], at[1]);
      if (b.classList.contains("is-behind") !== (at[2] === 1)) b.classList.toggle("is-behind");
    });
  }

  // The names drawn in 3D (kit.labels): the buttons' own text, found, focused from the keyboard; the state's colour
  // is read from the legend (the same rule colours both), since the buttons' text is transparent in 3D.
  function named() {
    kit?.labels(buttons.map(b => {
      const st = b.querySelector(".scene-part-state"), tint = legend.get(b.dataset.part)?.querySelector("dt span");
      return { id: b.dataset.part, name: nameOf(b), state: st?.textContent.trim() || "", stateColor: tint ? getComputedStyle(tint).color : "", found: found.has(b.dataset.part), focus: b === document.activeElement && b.matches(":focus-visible") };
    }));
  }

  // ---------- The 3D drawing ----------
  const size = () => { if (kit) kit.size(stage.clientWidth, stage.clientHeight); else placeStill(); };
  if ("ResizeObserver" in window) {
    const ro = new ResizeObserver(() => { size(); if (kit) wake(); });
    ro.observe(stage);
    undo.push(() => ro.disconnect());
  } else { addEventListener("resize", size); undo.push(() => removeEventListener("resize", size)); }

  // The transparent buttons follow the drawing five times a second: enough for a finger or a pointer, cheap.
  let placed = 0;
  function frame(now) {
    if (!kit || !onscreen || rest > 1) { drawnOnce = false; return false; }
    kit.frame(now);
    if (now - placed > 200) { placed = now; placeLive(); }
    if (!drawnOnce) { drawnOnce = true; fig.classList.add("is-live"); }
    return true;
  }
  function start() {
    if (kit || loading) return;
    const src = fig.dataset.module;
    if (!src) return;
    loading = Promise.all([import("./kit.js?v=20261025-r28"), import(new URL(src, document.baseURI).href)]).then(([k, d]) => {
      loading = null;
      if (disposed || !wanted() || kit) return;
      data = d.default;
      canvas = document.createElement("canvas");
      canvas.className = "scene-canvas";
      canvas.setAttribute("aria-hidden", "true");
      stage.prepend(canvas);
      kit = k.createKit(canvas, data);
      if (!kit) { canvas.remove(); canvas = null; return; }
      canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); end(); }, { once: true });
      kit.size(stage.clientWidth, stage.clientHeight);
      buttons.forEach(b => { if (found.has(b.dataset.part)) kit.found(b.dataset.part); });
      if (found.size === buttons.length) kit.complete();
      named();
      document.fonts?.ready.then(() => kit && named());
      stop = every(frame);
    }, () => { loading = null; });
  }
  function end() {
    stop?.(); stop = null;
    kit?.destroy(); kit = null;
    canvas?.remove(); canvas = null;
    fig.classList.remove("is-live");
    drawnOnce = false;
    placeStill();
  }
  const sync = () => { if (wanted()) { if (onscreen) start(); wake(); } else if (kit || loading) { loading = null; end(); } };

  // Pointer on the drawing: a horizontal drag turns it (vertical swipes stay the page's: touch-action pan-y),
  // a mouse also tilts it; a tap without a drag touches the part under it.
  let down = null;
  stage.addEventListener("pointerdown", e => {
    if (!kit || e.button > 0 || e.target.closest(".scene-part")) return;
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, mouse: e.pointerType === "mouse" };
  });
  stage.addEventListener("pointermove", e => {
    if (!down || e.pointerId !== down.id || !kit) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (!down.moved && Math.hypot(dx, dy) < 6) return;
    if (!down.moved) { down.moved = true; try { stage.setPointerCapture(e.pointerId); } catch {} fig.classList.add("is-turning"); }
    kit.drag(dx, down.mouse ? dy : 0);
    down.x = e.clientX; down.y = e.clientY;
    wake();
  });
  const up = e => {
    if (!down || e.pointerId !== down.id) return;
    if (!down.moved && e.type === "pointerup" && kit) {
      const r = stage.getBoundingClientRect(), id = kit.pick(e.clientX - r.left, e.clientY - r.top);
      const b = id && buttons.find(x => x.dataset.part === id);
      if (b) { rove(b); activate(b); }
    }
    kit?.release();
    fig.classList.remove("is-turning");
    down = null;
  };
  stage.addEventListener("pointerup", up);
  stage.addEventListener("pointercancel", up);

  // Off screen, nothing runs; the drawing is fetched the first time the scene comes near.
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(es => es.forEach(e => { onscreen = e.isIntersecting; sync(); }), { rootMargin: "120px 0px" });
    io.observe(fig);
    undo.push(() => io.disconnect());
  } else { onscreen = true; }
  const onIdle = e => { rest = e.detail?.level | 0; if (!rest) wake(); };
  addEventListener("yosuljin:idle", onIdle);
  const mo = new MutationObserver(sync);
  mo.observe(html, { attributes: true, attributeFilter: ["class"] });
  reduced.addEventListener?.("change", sync);
  forced.addEventListener?.("change", sync);
  undo.push(() => { removeEventListener("yosuljin:idle", onIdle); mo.disconnect(); reduced.removeEventListener?.("change", sync); forced.removeEventListener?.("change", sync); });

  fig.classList.add("is-ready");
  placeStill();
  sync();

  return function dispose() {
    if (disposed) return;
    disposed = true; loading = null;
    undo.splice(0).forEach(f => f());
    end();
  };
}

document.querySelectorAll("figure.aether-scene[data-scene]").forEach(setup);

/** Sets up a scene added to the page later (a showcase of the museum, D168). */
export { setup as setupScene };
