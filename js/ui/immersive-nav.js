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

/** Shows `url` in the frame. The frame's own document is replaced, never navigated: the only history entries are
 *  this document's (pushState), so back and forward move one page at a time, in step with the address bar. */
function loadFrame(url, replace = false) {
  let frame = document.querySelector("." + FRAME_CLASS);
  if (!frame) {
    frame = document.createElement("iframe");
    frame.className = FRAME_CLASS;
    frame.setAttribute("title", "Yosuljin — navigation immersive");
    frame.setAttribute("allowfullscreen", "");
    frame.src = "about:blank";
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
  if (shown) { frame.contentWindow.postMessage({ type: "yosuljin-depart" }, location.origin); setTimeout(show, DEPART); }
  else show();
  if (!replace) history.pushState({}, "", url.href);
  document.documentElement.classList.add("immersive-nav");
  return frame;
}

// Leaving the frame loads the address it showed, for real: assigning the same address, when it has a #fragment,
// would only scroll the page that is still under the frame, inert. That page's scroll offset must not carry over.
// The frame stays up until the new document paints (it arrives as a change of channel): nothing shows through.
function leave() {
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
  };
  addEventListener("message", e => {
    if (e.origin !== location.origin || !e.data) return;
    if (e.data.type === "yosuljin-fullscreen-toggle") {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
      return;
    }
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
  // Back and forward between framed pages. Without a frame, a #fragment of the page itself (the skip link, a
  // contents list) scrolls as usual.
  addEventListener("popstate", () => {
    if (!document.fullscreenElement || !document.querySelector("." + FRAME_CLASS)) return;
    loadFrame(new URL(location.href), true);
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
  };
}
