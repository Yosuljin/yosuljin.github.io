// Preserve the browser's immersive fullscreen across internal page changes.
// In top-level fullscreen mode, internal pages are hosted in a same-origin frame so
// the owning document never navigates and fullscreen survives. In a child frame,
// internal links are delegated back to the owning document.
const FRAME_CLASS = "immersive-frame";
const normalise = p => p.replace(/index\.html$/, "");

function isInternal(url) {
  return url.origin === location.origin && /^https?:$/.test(url.protocol);
}

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
  // and the focus goes into the frame. Leaving the frame reloads the page (leave), so nothing has to undo this.
  for (const el of document.body.children) if (el !== frame) el.inert = true;
  frame.addEventListener("load", () => frame.focus(), { once: true });
  frame.src = url.href;
  if (!replace) history.pushState({}, "", url.href);
  document.documentElement.classList.add("immersive-nav");
  return frame;
}

// Leaving the frame loads the address it showed, for real: assigning the same address, when it has a #fragment,
// would only scroll the page that is still under the frame, inert. That page's scroll offset must not carry over.
function leave() {
  history.scrollRestoration = "manual";
  location.reload();
}

function delegateFromFrame(url) {
  if (!window.parent || window.parent === window) return false;
  window.parent.postMessage({ type: "yosuljin-immersive-nav", href: url.href }, location.origin);
  return true;
}

function interceptAnchor(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest?.("a[href]");
  if (!a || a.getAttribute("target") === "_blank" || a.hasAttribute("download")) return;
  let url;
  try { url = new URL(a.getAttribute("href"), location.href); } catch { return; } // SVG <a>: .href is not a string
  if (!isInternal(url)) return;
  if (normalise(url.pathname) === normalise(location.pathname)) return;
  if (window.parent !== window) {
    e.preventDefault();
    delegateFromFrame(url);
    return;
  }
  if (!document.fullscreenElement) return;
  e.preventDefault();
  loadFrame(url);
}

if (window.parent === window) {
  document.addEventListener("click", interceptAnchor, true);
  addEventListener("message", e => {
    if (e.origin !== location.origin || !e.data) return;
    if (e.data.type === "yosuljin-fullscreen-toggle") {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
      return;
    }
    if (e.data.type !== "yosuljin-immersive-nav") return;
    let url;
    try { url = new URL(e.data.href, location.href); } catch { return; }
    if (!isInternal(url)) return;
    if (normalise(url.pathname) === normalise(location.pathname)) {
      history.pushState({}, "", url.href);
      document.querySelector("." + FRAME_CLASS)?.remove();
      leave();
      return;
    }
    loadFrame(url);
  });
  // Back and forward between framed pages. Without a frame, a #fragment of the page itself (the skip link, a
  // contents list) scrolls as usual.
  addEventListener("popstate", () => {
    if (!document.fullscreenElement || !document.querySelector("." + FRAME_CLASS)) return;
    loadFrame(new URL(location.href), true);
  });
  document.addEventListener("fullscreenchange", () => {
    const frame = document.querySelector("." + FRAME_CLASS);
    if (!document.fullscreenElement && frame) {
      frame.remove();
      document.documentElement.classList.remove("immersive-nav");
      leave();
    }
  });
} else {
  document.addEventListener("click", interceptAnchor, true);
}
