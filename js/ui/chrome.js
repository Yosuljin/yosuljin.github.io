// Shared page chrome: display-mode switch, reveal-on-scroll.
import { $, $$ } from "../core/dom.js?v=20261007-r7";
import { getMode, setMode, reducedMotion } from "../core/prefs.js?v=20261008-r9";

export function initModeSwitch() {
  const button = $("[data-mode-toggle]");
  if (!button) return;
  const paint = () => {
    const full = getMode() === "full";
    button.removeAttribute("aria-pressed");
    button.setAttribute("aria-label", full ? "FULL 3D — passer en mode LITE" : "LITE — passer en mode FULL 3D");
    button.textContent = full ? "FULL 3D" : "LITE";
  };
  paint();
  button.addEventListener("click", () => { setMode(getMode() === "full" ? "lite" : "full"); paint(); });
}

/** Fades content in once when it enters the viewport (document-flow pages and LITE mode). */
export function initReveal(selector = ".reveal") {
  const items = $$(selector);
  if (!("IntersectionObserver" in window) || reducedMotion.matches) { items.forEach(el => el.classList.add("visible")); return; }
  // Keyboard focus can land in the bottom band the observer ignores: never leave a focused link invisible.
  document.addEventListener("focusin", e => e.target.closest?.(selector)?.classList.add("visible"));
  const io = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add("visible"); io.unobserve(entry.target); }
  }), { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  items.forEach(el => io.observe(el));
}
