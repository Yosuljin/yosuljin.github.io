// Page changes are the browser's own and never wait. Where cross-document view transitions exist, the title being
// left becomes an afterimage: it turns rose and dies out over the next page (styles.css, 06). The first page of a
// visit powers the tube on; a page reached from a link of the site is already on.
import { reducedMotion } from "../core/prefs.js?v=20261008-r9";
import { sfx } from "./sound.js?v=20261009-r2";

const FLAG = "yosuljin-portal";
const normalise = p => p.replace(/index\.html$/, "");

// samePage() moves the view itself, so the browser never moves focus: do it here (skip link).
function focusTarget(hash) {
  let el = null;
  try { el = hash && document.getElementById(decodeURIComponent(hash.slice(1))); } catch {}
  if (!el) return;
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
}

/** The cathode-ray tube switches on: a bright line across the dark screen opens onto the page.
 *  Overlay only (the live page is never transformed); CSS ends it, the timer only tidies up. */
function powerOn() {
  const root = document.documentElement;
  root.classList.remove("power-hold");
  if (reducedMotion.matches) { root.classList.remove("power-pending"); return; }
  document.querySelector(".crt-power")?.remove();
  const el = document.createElement("div");
  el.className = "crt-power";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = '<i class="crt-power-lid top"></i><i class="crt-power-lid bottom"></i><i class="crt-power-line"></i>';
  document.body.appendChild(el);
  root.classList.remove("power-pending");
  setTimeout(() => el.remove(), 1700);
}

/** The title being left: the menu's chosen line when the reader leaves through the menu, else the first heading
 *  on screen. */
function titleBeingLeft() {
  const chosen = document.querySelector(".site-menu.open a.is-chosen b");
  if (chosen) return chosen;
  return [...document.querySelectorAll("h1, h2")].find(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.top < innerHeight && el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) !== false;
  });
}

/**
 * @param {object} options
 * @param {(url: URL) => boolean} [options.samePage] handles links to the current page (e.g. the logo on the index).
 */
export function initPortal({ samePage } = {}) {
  // Arrival: a page reached from a link of the site is already on; any other arrival (launch, reload) powers on.
  try {
    const crossed = sessionStorage.getItem(FLAG);
    sessionStorage.removeItem(FLAG);
    if (crossed) {
      // Nothing to do: the afterimage of the page left is the only trace of the change.
    } else if (document.querySelector(".signal-gate")) {
      // First page of a visit: the entry gate is open; the tube powers on when the reader enters.
      document.documentElement.classList.add("power-hold");
      addEventListener("yosuljin:enter", powerOn, { once: true });
    } else {
      powerOn();
    }
  } catch {}
  // The old page is captured just after this event: its title is the one that remains.
  addEventListener("pageswap", e => { if (e.viewTransition) titleBeingLeft()?.classList.add("afterimage"); });
  // Back with the history (bfcache): the page shows as it was.
  addEventListener("pageshow", () => {
    for (const el of document.querySelectorAll(".afterimage")) el.classList.remove("afterimage");
    for (const el of document.querySelectorAll(".is-chosen")) el.classList.remove("is-chosen");
  });

  document.addEventListener("click", e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.("a[href]");
    if (!a || a.getAttribute("target") === "_blank" || a.hasAttribute("download")) return;
    let url;
    try { url = new URL(a.getAttribute("href"), location.href); } catch { return; } // SVG <a>: .href is not a string
    if (url.origin !== location.origin) return;
    if (normalise(url.pathname) === normalise(location.pathname)) {
      if (url.hash && !samePage) return; // in-page anchors keep native behaviour
      if (samePage) { e.preventDefault(); samePage(url); focusTarget(url.hash); }
      return;
    }
    // A text or data file (robots.txt, tdmrep.json, the font licence) runs no script that would clear the flag.
    if (!/(\/|\.html)$/.test(url.pathname)) return;
    // Another page of the site: the browser goes there at once; the next page knows it was reached from here.
    try { sessionStorage.setItem(FLAG, "1"); } catch {}
    sfx("portal");
  }, { capture: false });
}
