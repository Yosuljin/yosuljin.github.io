// Display preferences shared by every page.
const KEY = "yosuljin-display-mode";
const listeners = new Set();

export const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
export const finePointer = matchMedia("(pointer: fine)");

function read() {
  try { return localStorage.getItem(KEY) === "lite" ? "lite" : "full"; } catch { return "full"; }
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
  try { localStorage.setItem(KEY, mode); } catch {}
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
