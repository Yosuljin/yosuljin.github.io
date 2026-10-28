// Preserve the browser's immersive fullscreen across internal page changes.
// In top-level fullscreen mode, internal pages are hosted in a same-origin frame so the owning document never
// navigates and fullscreen survives; inside the frame, page changes are handed back to the owning document.
// The page change itself — its departure and arrival (js/ui/portal.js) — asks this script where to go:
// window.__yosuljinImmersive.navigate(url) answers "stay" when the page is framed under this document (which
// stays), "leave" when this framed document handed the change up to its owner, false when the browser's own
// navigation is the right one.
const FRAME_CLASS = "immersive-frame";
const FLAG = "yosuljin-portal";
const DEPART = 260;
const framed = window.parent !== window;

function isInternal(url) {
  return url.origin === location.origin && /^https?:$/.test(url.protocol);
}

/** Where the framed page stands now — its address (a page may have moved its own #fragment) and the state it keeps in
 *  its history (the museum keeps there where the visitor stands, js/musee/musee.js) — written into this document's
 *  own entry: back to it, or the reload that leaves the frame, finds the page as it was left. */
function keepFrame(frame) {
  try {
    const w = frame && frame.contentWindow;
    if (w && w.location.href !== "about:blank") history.replaceState(w.history.state, "", w.location.href);
  } catch {}
}

/** Escape kept for the page (the museum, where it gives the mouse back): in fullscreen, the browser then hands a
 *  press of Escape to the page instead of leaving the fullscreen at once; held down, it still leaves. Chromium's
 *  Keyboard Lock, asked by the top document only; false where the browser has none. */
function keepEscape(keep) {
  const k = navigator.keyboard;
  if (!k || typeof k.lock !== "function") return false;
  try { if (keep) k.lock(["Escape"]).catch(() => {}); else k.unlock(); } catch { return false; }
  return true;
}

/** The screen kept sideways for the page (the museum on a phone, D169): the browser turns it and holds it there while
 *  the fullscreen lasts (Android); it lets go when the page changes or the fullscreen ends. False where it cannot. */
function keepLandscape(keep) {
  const o = screen.orientation;
  if (!o || typeof o.lock !== "function") return false;
  try { if (keep) o.lock("landscape").catch(() => {}); else o.unlock?.(); } catch { return false; }
  return true;
}

/** When the page in the frame last saw the browser take it away: a move through the history (Navigation API), or the
 *  page leaving (where that API is missing). Watched on each page the frame shows. */
const seen = { traverse: -Infinity, gone: -Infinity, loaded: -Infinity };
function watch(frame) {
  try {
    const w = frame.contentWindow;
    w.navigation?.addEventListener("navigate", e => { if (e.navigationType === "traverse") seen.traverse = performance.now(); });
    w.addEventListener("pagehide", () => { seen.gone = performance.now(); });
  } catch {}
}

/** Shows `url` in the frame. The frame's own document is replaced, never navigated: the only history entries are
 *  this document's (pushState), so back and forward move one page at a time, in step with the address bar.
 *  `departed`: when the page being left began to collapse, if it already has (back and forward, below). */
function loadFrame(url, replace = false, departed = 0) {
  let frame = document.querySelector("." + FRAME_CLASS);
  awaited = null;
  // The page that goes away keeps its place in its entry; the one that comes asks for Escape again if it needs it.
  if (frame && !replace) keepFrame(frame);
  keepEscape(false);
  keepLandscape(false);
  // The new entry before the frame's page: that page belongs to it alone. The entry this document had before its
  // frame keeps no page of the frame (back to it, the frame shows this document's own page, below).
  if (!replace) history.pushState({}, "", url.href);
  if (!frame) {
    frame = document.createElement("iframe");
    frame.className = FRAME_CLASS;
    frame.setAttribute("title", "Yosuljin — navigation immersive");
    frame.setAttribute("allowfullscreen", "");
    frame.src = "about:blank";
    frame.addEventListener("load", () => { seen.loaded = performance.now(); watch(frame); checkFrame(frame); });
    document.body.appendChild(frame);
  }
  // The page underneath leaves the accessibility tree and the tab order (the menu keeps it out when it closes),
  // its frame loop sleeps (js/core/loop.js), and the focus goes into the frame. Leaving the frame reloads the page
  // (leave), so nothing has to undo this.
  for (const el of document.body.children) if (el !== frame) el.inert = true;
  frame.addEventListener("load", () => frame.focus(), { once: true });
  const show = () => {
    // The framed page arrives as a change of channel (portal.js), never as a power-on.
    try { sessionStorage.setItem(FLAG, "1"); } catch {}
    try { frame.contentWindow.location.replace(url.href); } catch { frame.src = url.href; }
  };
  // Back or forward: the framed page did not ask for the change, it collapses first (portal.js listens).
  let shown = false;
  try { shown = replace && frame.contentWindow.location.href !== "about:blank"; } catch {}
  if (shown) {
    if (!departed) { frame.contentWindow.postMessage({ type: "yosuljin-depart" }, location.origin); departed = performance.now(); }
    setTimeout(show, Math.max(0, DEPART - (performance.now() - departed)));
  } else show();
  document.documentElement.classList.add("immersive-nav");
  return frame;
}

/** Whether the frame shows the page of `url` (its #fragment aside: a page may move its own, the museum does). */
function shows(frame, url) {
  try { const l = frame.contentWindow.location; return l.pathname === url.pathname && l.search === url.search; } catch { return false; }
}

// Back and forward. History keeps, in each of its entries, the page the frame showed (joint session history): the
// browser itself brings that page back into the frame, with what the page kept in its entry (the museum, where the
// visitor stood). This document lets it — one load, never two — and brings the page itself only where the browser
// does not: the entry this document had before its frame, the same page twice. Should the browser bring another page
// than the entry's, the right one follows.
let step = 0, awaited = null;
function checkFrame(frame) {
  const a = awaited;
  if (!a || a.step !== step) return;
  awaited = null;
  clearTimeout(a.late);
  if (!shows(frame, a.url)) loadFrame(a.url, true);
}

// Leaving the frame loads the address it showed, for real: assigning the same address, when it has a #fragment,
// would only scroll the page that is still under the frame, inert. That page's scroll offset must not carry over.
// The frame stays up until the new document paints (it arrives as a change of channel): nothing shows through.
function leave() {
  keepFrame(document.querySelector("." + FRAME_CLASS));
  try { sessionStorage.setItem(FLAG, "1"); } catch {}
  history.scrollRestoration = "manual";
  location.reload();
}

if (!framed) {
  window.__yosuljinImmersive = {
    navigate(url) {
      if (!document.fullscreenElement || !isInternal(url)) return false;
      loadFrame(url);
      return "stay";
    },
    echap: keepEscape,
    paysage: keepLandscape,
  };
  addEventListener("message", e => {
    if (e.origin !== location.origin || !e.data) return;
    if (e.data.type === "yosuljin-fullscreen-toggle") {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
      return;
    }
    if (e.data.type === "yosuljin-echap") { keepEscape(!!e.data.keep); return; }
    if (e.data.type === "yosuljin-paysage") { keepLandscape(!!e.data.keep); return; }
    // The framed page has drawn its first picture (js/boot.js): this document's own closing lids, if it was the one
    // that left, can go — the frame shows the same closed tube, about to open.
    if (e.data.type === "yosuljin-frame-shown") { document.querySelector(".crt-channel")?.remove(); return; }
    if (e.data.type !== "yosuljin-immersive-nav") return;
    let url;
    try { url = new URL(e.data.href, location.href); } catch { return; }
    if (!isInternal(url)) return;
    // Every page of the site, this one included, is framed while the fullscreen lasts: the owning document never
    // navigates (a navigation would end the fullscreen).
    if (document.fullscreenElement) loadFrame(url); else location.href = url.href;
  });
  // Back and forward between framed pages (above). Without a frame, a #fragment of the page itself (the skip link,
  // a contents list) scrolls as usual.
  addEventListener("popstate", () => {
    const frame = document.querySelector("." + FRAME_CLASS);
    if (!document.fullscreenElement || !frame) return;
    const n = ++step, t = performance.now(), url = new URL(location.href);
    awaited = null;
    // Whoever brings it, the next page arrives as a change of channel (portal.js), and asks for Escape again if it
    // needs it; the page being left collapses at once.
    try { sessionStorage.setItem(FLAG, "1"); } catch {}
    keepEscape(false);
    keepLandscape(false);
    try { frame.contentWindow.postMessage({ type: "yosuljin-depart" }, location.origin); } catch {}
    // The browser starts its own load within a few milliseconds where the Navigation API tells it; elsewhere, the
    // page leaving tells it, later.
    let api = false;
    try { api = !!frame.contentWindow.navigation; } catch {}
    setTimeout(() => {
      if (n !== step) return;
      if (!(seen.traverse >= t - 50 || seen.gone >= t - 50)) { loadFrame(url, true, t); return; }
      // The browser brings it: once it is there, it must be this entry's page. A load that never ends (offline)
      // gives way to this document's own, long after.
      awaited = { step: n, url, late: setTimeout(() => { if (awaited?.step === n) loadFrame(url, true); }, 8000) };
      if (seen.loaded >= t) checkFrame(frame);
    }, api ? 60 : 500);
  });
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && document.querySelector("." + FRAME_CLASS)) leave();
  });
} else {
  window.__yosuljinImmersive = {
    navigate(url) {
      if (!isInternal(url)) return false;
      window.parent.postMessage({ type: "yosuljin-immersive-nav", href: url.href }, location.origin);
      return "leave";
    },
    // The owning document holds the fullscreen, so it is the one that keeps Escape (above).
    echap(keep) {
      if (!navigator.keyboard || typeof navigator.keyboard.lock !== "function") return false;
      window.parent.postMessage({ type: "yosuljin-echap", keep: !!keep }, location.origin);
      return true;
    },
    paysage(keep) {
      if (!screen.orientation || typeof screen.orientation.lock !== "function") return false;
      window.parent.postMessage({ type: "yosuljin-paysage", keep: !!keep }, location.origin);
      return true;
    },
  };
}
