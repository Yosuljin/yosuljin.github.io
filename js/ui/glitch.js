// The tube over every page, and the press of a control. Nothing glitches any more (RÉMANENCE §11): the page
// change is portal.js's channel change, and the world keeps its own light.
import { reducedMotion } from "../core/prefs.js?v=20261008-r9";
import { sfx } from "./sound.js?v=20261009-r2";

const CONTROLS = "a[href], button";

/** Builds the cathode-ray tube that sits over every page: still layers only (styles.css, THE TUBE). */
function ensureTube() {
  if (document.querySelector(".crt")) return;
  const tube = document.createElement("div");
  tube.className = "crt";
  tube.setAttribute("aria-hidden", "true");
  tube.innerHTML = '<i class="crt-lines"></i><i class="crt-phosphor"></i><i class="crt-grille"></i><i class="crt-glass"></i>';
  document.body.appendChild(tube);
}

/** A press: the control sinks by one pixel for 80 ms (styles.css, 06). */
function press(el) {
  if (reducedMotion.matches) return;
  el.classList.add("is-pressed");
  clearTimeout(el.__pressTimer);
  el.__pressTimer = setTimeout(() => el.classList.remove("is-pressed"), 80);
}

export function initGlitch() {
  ensureTube();
  const isMenuToggle = el => el?.matches?.(".menu-toggle");
  // Hover and focus are silent and change nothing; only a press sounds and sinks.
  // On release, not on press: the target is fixed by then, so the click lands where the finger is.
  document.addEventListener("pointerup", e => { const c = e.target.closest?.(CONTROLS); if (c && !isMenuToggle(c)) { sfx("press"); press(c); } }, { passive: true });
}
