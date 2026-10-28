// Display preferences shared by every page.
const KEY = "yosuljin-display-mode";
// LITE is a dated choice: a bare "lite" written by a visit before the 2026-10-13 publication is stale (an old
// preference must not hide the site's new state), only the dated value counts. The key keeps its name
// (confidentialite.html describes it); js/boot.js reads the same value before the first paint.
const LITE = "lite@2026-10-13";
const listeners = new Set();

// One list to read and another to listen to. Chromium refreshes the answer of a MediaQueryList when it is read, and tells its
// listeners only of a change it has not already given away: the home's frame loop reads `reducedMotion.matches` every frame,
// so the first frame after the setting changed took the news and the event never came (the home stayed in cinema; measured
// on 2026-10-28, Edge 155, front page with the cinema). The list that is listened to is never read.
function query(text) {
  const read = matchMedia(text), watch = matchMedia(text);
  return {
    get matches() { return read.matches; },
    media: read.media,
    addEventListener: typeof watch.addEventListener === "function" ? (type, fn, options) => watch.addEventListener(type, fn, options) : undefined,
    removeEventListener: typeof watch.removeEventListener === "function" ? (type, fn, options) => watch.removeEventListener(type, fn, options) : undefined,
  };
}
export const reducedMotion = query("(prefers-reduced-motion: reduce)");
export const finePointer = query("(pointer: fine)");

function read() {
  try { return localStorage.getItem(KEY) === LITE ? "lite" : "full"; } catch { return "full"; }
}

let mode = read();

export const getMode = () => mode;

/** Full 3D cinema: the index keeps one shared presentation on every viewport. */
export const isCinema = () =>
  mode === "full" &&
  document.documentElement.hasAttribute("data-cinema") &&
  !reducedMotion.matches;

export function setMode(next) {
  mode = next === "lite" ? "lite" : "full";
  try { localStorage.setItem(KEY, mode === "lite" ? LITE : "full"); } catch {}
  applyMode();
  listeners.forEach(fn => fn(mode));
}

export function onModeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function applyMode() {
  const root = document.documentElement;
  root.classList.toggle("mode-full", mode === "full");
  root.classList.toggle("mode-lite", mode === "lite");
  root.classList.toggle("cinema", isCinema());
  root.classList.toggle("reduced-motion", reducedMotion.matches);
}

finePointer.addEventListener?.("change", () => { applyMode(); listeners.forEach(fn => fn(mode)); });
reducedMotion.addEventListener?.("change", () => { applyMode(); listeners.forEach(fn => fn(mode)); });
applyMode();
