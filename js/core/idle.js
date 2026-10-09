// The page rests when nobody is there, in two steps, for the whole site:
//  level 1 (html.is-idle), 12 s without input: the decorative ambiance pauses;
//  level 2 (html.is-deep-idle), 90 s without input (45 s on touch screens) or the window out of focus:
//  everything that still moves stops, the WebGL world included.
// The first input wakes everything. Paused animations resume where they stopped, so nothing jumps; reading,
// focus and navigation are never touched. Listeners get "yosuljin:idle" with detail { level }.
const LIGHT = 12000;
const DEEP = matchMedia("(pointer: coarse)").matches ? 45000 : 90000;
const INPUTS = ["pointermove", "pointerdown", "keydown", "wheel", "scroll", "touchstart", "focusin"];
const root = document.documentElement;
let level = 0, light = 0, deep = 0, armedAt = -Infinity;

function setLevel(next) {
  if (next === level) return;
  level = next;
  root.classList.toggle("is-idle", level >= 1);
  root.classList.toggle("is-deep-idle", level >= 2);
  dispatchEvent(new CustomEvent("yosuljin:idle", { detail: { level } }));
}
function wake() {
  const now = performance.now();
  // Pointer moves come by the hundred: while awake, the timers are re-armed twice a second at most.
  if (level === 0 && now - armedAt < 500) return;
  armedAt = now;
  setLevel(0);
  clearTimeout(light); clearTimeout(deep);
  light = setTimeout(() => setLevel(1), LIGHT);
  deep = setTimeout(() => setLevel(2), DEEP);
}
for (const type of INPUTS) addEventListener(type, wake, { capture: true, passive: true });
addEventListener("blur", () => { clearTimeout(light); clearTimeout(deep); setLevel(2); });
addEventListener("focus", wake);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") wake(); });
wake();

/** 0 awake, 1 resting (decoration paused), 2 deep rest (everything stopped). */
export const idleLevel = () => level;
/** True from the first level of rest. */
export const isIdle = () => level > 0;
