// Changing page is a change of channel on the tube (styles.css, 19). The page being left collapses to a line in
// 260 ms (overlays only: the live page is never transformed) while the next page is already downloading; the next
// page arrives covered (js/boot.js marks it before its first paint) and opens from the line. Nothing of it depends
// on the browser. Where cross-document view transitions exist they add one thing, the afterimage: the title being
// left turns rose and dies out over the next page (styles.css, 06). The first page of a visit powers the tube on.
import { reducedMotion } from "../core/prefs.js?v=20261014-r1";
import { wake } from "../core/loop.js?v=20261014-r1";
import { sfx, revive } from "./sound.js?v=20261014-r1";

const FLAG = "yosuljin-portal";
const DEPART = 260;
const normalise = p => p.replace(/index\.html$/, "");
let leaving = false;

// samePage() moves the view itself, so the browser never moves focus: do it here (skip link).
function focusTarget(hash) {
  let el = null;
  try { el = hash && document.getElementById(decodeURIComponent(hash.slice(1))); } catch {}
  if (!el) return;
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
}

/** The tube's lids and the line between them, closing on the page being left. */
function overlay() {
  document.querySelector(".crt-channel")?.remove();
  const el = document.createElement("div");
  el.className = "crt-channel is-closing";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = '<i class="crt-channel-lid top"></i><i class="crt-channel-lid bottom"></i><i class="crt-channel-line"></i>';
  document.body.appendChild(el);
  return el;
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

/** Arrival on a page reached from the site: the picture opens from the line by CSS alone, from the first paint
 *  (styles.css, 19; a short fade under reduced motion). The class only goes once it is over. */
function channelIn() {
  // The channel locks as the lids open (the sound has come back by then, sound.js tryAutostart).
  if (!reducedMotion.matches) setTimeout(() => sfx("channel"), 200);
  setTimeout(() => document.documentElement.classList.remove("channel-pending"), reducedMotion.matches ? 300 : 800);
}

/** Departure: the next page is announced and prefetched, the picture collapses to a line, then the browser goes
 *  at 260 ms at the latest (through the immersive frame when the page is in fullscreen, js/ui/immersive-nav.js). */
function depart(url) {
  if (leaving) return;
  leaving = true;
  try { sessionStorage.setItem(FLAG, "1"); } catch {}
  const link = document.createElement("link");
  link.rel = "prefetch"; link.href = url.href;
  document.head.appendChild(link);
  const go = () => {
    const took = window.__yosuljinImmersive?.navigate(url);
    // Framed under this page, which stays: its lids go once the frame shows the same closed tube (immersive-nav.js).
    if (took === "stay") { leaving = false; return; }
    // Nothing shows under the closed lids: the frame loop sleeps until the next page (js/core/loop.js).
    document.documentElement.classList.add("is-leaving");
    if (!took) location.href = url.href;
  };
  if (reducedMotion.matches) { go(); return; }
  sfx("portal");
  overlay();
  setTimeout(go, DEPART);
  // Still here long after (offline, a refused navigation; a very slow network keeps the old page this long before
  // the next one commits): the picture comes back and the flag goes.
  setTimeout(() => {
    if (document.visibilityState === "hidden" || !document.querySelector(".crt-channel.is-closing")) return;
    comeBack();
    try { sessionStorage.removeItem(FLAG); } catch {}
  }, 10000);
}

/** The page is here after all (a navigation that did not happen, the history coming back): uncovered, awake. */
function comeBack() {
  leaving = false;
  document.querySelector(".crt-channel")?.remove();
  document.documentElement.classList.remove("is-leaving");
  wake();
  revive();
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
  const root = document.documentElement;
  // Arrival: a page reached from a link of the site changes channel; any other arrival (launch, reload) powers on.
  try {
    const crossed = sessionStorage.getItem(FLAG);
    sessionStorage.removeItem(FLAG);
    if (crossed) {
      channelIn();
    } else if (document.querySelector(".signal-gate")) {
      // First page of a visit: the entry gate is open; the tube powers on when the reader enters.
      root.classList.add("power-hold");
      addEventListener("yosuljin:enter", powerOn, { once: true });
    } else {
      powerOn();
    }
  } catch { root.classList.remove("channel-pending"); powerOn(); }
  // The old page is captured just after this event: its title is the one that remains.
  addEventListener("pageswap", e => { if (e.viewTransition) titleBeingLeft()?.classList.add("afterimage"); });
  // Framed, and the owning page moves through its history (immersive-nav.js): this picture collapses first.
  if (window.parent !== window) addEventListener("message", e => { if (e.origin === location.origin && e.data?.type === "yosuljin-depart" && !reducedMotion.matches) overlay(); });
  // Back with the history (bfcache): the page shows as it was, uncovered.
  addEventListener("pageshow", e => {
    if (!e.persisted) return;
    comeBack();
    for (const el of document.querySelectorAll(".afterimage, .is-chosen")) el.classList.remove("afterimage", "is-chosen");
    try { sessionStorage.removeItem(FLAG); } catch {}
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
    e.preventDefault();
    depart(url);
  }, { capture: false });
}
