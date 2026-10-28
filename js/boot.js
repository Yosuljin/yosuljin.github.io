// Runs synchronously in <head> (classic script, CSP-safe) so the first paint already has the
// right layout: cinema (FULL 3D + precise pointer) or document flow (LITE / touch).
(function () {
  var root = document.documentElement, mode = "full";
  // LITE is a dated choice (js/core/prefs.js): a bare "lite" left by a visit before 2026-10-13 no longer applies.
  try { if (localStorage.getItem("yosuljin-display-mode") === "lite@2026-10-13") mode = "lite"; } catch (e) {}
  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  // In FULL the home is the museum's hall (D169 (b) 2): the page goes there before anything is drawn — wherever the
  // museum can open (motion not reduced, colours not forced, a browser that draws in 3D); elsewhere the home stays as
  // it is, and in LITE it is the site of today. The museum is a page of its own (musee.html): its address says so.
  if (mode === "full" && root.hasAttribute("data-accueil-musee") && !reduced &&
      !(window.matchMedia && matchMedia("(forced-colors: active)").matches) && (window.WebGL2RenderingContext || window.WebGLRenderingContext)) {
    root.classList.add("vers-musee");
    location.replace("musee.html" + location.search + location.hash);
    return;
  }
  root.classList.add("js", "mode-" + mode);
  // FULL mode keeps the cinema composition on touch/mobile too; the input method changes, not the scene.
  if (mode === "full" && root.hasAttribute("data-cinema")) root.classList.add("cinema");
  if (reduced) root.classList.add("reduced-motion");
  // The site opens in the browser's fullscreen, on a computer as on a phone (D165): wherever the browser lets a page
  // take it — not on iPhone, where Safari keeps it for videos — the press that switches the tube on takes it too, and
  // js/ui/immersive-nav.js keeps it from page to page. The visit remembers where it stands (yosuljin-immersive):
  // "asked" by that press, "on" once the fullscreen came, "off" once the reader left it or passed the standby screen
  // with Escape — the site then leaves the reader outside until the visit ends. A press that never brought it ("asked"
  // still there when the next page opens) counts as "off": no standby screen comes back for a fullscreen refused.
  // Only the page that owns the fullscreen counts: a page framed under it (immersive-nav.js) has nothing to ask.
  var IMM = "yosuljin-immersive", owner = window.parent === window, immersive = false;
  var remember = function (state) { try { sessionStorage.setItem(IMM, state); } catch (e) {} };
  try {
    var said = sessionStorage.getItem(IMM);
    if (owner && said === "asked") { remember("off"); said = "off"; }
    immersive = owner && !!document.fullscreenEnabled && typeof root.requestFullscreen === "function" && said !== "off";
  } catch (e) {}
  // The tube in standby (the <dialog class="signal-gate"> of every page): the first page of a visit, unless the sound
  // was turned off for good; and, since only a press opens the fullscreen, any page that opens outside the fullscreen
  // it should have (a reload, a sound turned off for good). Decided here, before the first paint, so it shows at once on
  // a slow network instead of when the modules arrive (measured on 2026-10-19, Slow 4G: 1.9 s against 4.5 to 6.7 s).
  // sound.js makes it modal and takes it down; portal.js holds the tube dark until the reader enters (power-hold). Its
  // note says what the press does (styles.css): gate-mute, the sound stays off; gate-full, in fullscreen.
  var gate = false, mute = false;
  try { mute = localStorage.getItem("yosuljin-sound") === "off"; } catch (e) {}
  try { gate = typeof HTMLDialogElement === "function" && (immersive || (sessionStorage.getItem("yosuljin-signal") !== "1" && !mute)); } catch (e) {}
  if (gate) {
    root.classList.add("gate-pending", "power-hold");
    if (mute) root.classList.add("gate-mute");
    if (immersive) root.classList.add("gate-full");
  }
  // Launch: the screen starts dark and portal.js powers the tube on (a bright line that opens onto the page), behind
  // the standby screen whenever it is up. A page reached from a link of the site arrives covered too, and opens from
  // the line (a change of channel, portal.js). CSS reveals the page by itself if no script runs.
  try {
    if (!gate && sessionStorage.getItem("yosuljin-portal")) root.classList.add("channel-pending");
    else if (!reduced) root.classList.add("power-pending");
  } catch (e) {}
  // Where the fullscreen stands for the visit (above). Left while the page shows — Escape, the SORTIR control, the back
  // gesture — it is the reader's choice. Lost while the page is hidden (another tab, another app) or unloading (a
  // reload: Chromium sends no event then, measured on 2026-10-25), it is not: the standby screen comes back with the
  // next page that opens outside it.
  if (owner) {
    var unloading = false;
    addEventListener("pagehide", function () { unloading = true; });
    addEventListener("pageshow", function () { unloading = false; });
    document.addEventListener("fullscreenchange", function () {
      if (document.fullscreenElement) remember("on");
      else if (!unloading && document.visibilityState === "visible") remember("off");
    });
    // Escape on the standby screen (sound.js, « skip ») lets the reader in without a press: outside, for the visit.
    addEventListener("yosuljin:enter", function (e) { if (e.detail === "skip") remember("off"); });
  }
  // In the immersive frame (js/ui/immersive-nav.js): the owning page learns when this picture is first drawn.
  if (window.parent !== window) {
    try { requestAnimationFrame(function () { window.parent.postMessage({ type: "yosuljin-frame-shown" }, location.origin); }); } catch (e) {}
  }

  // The index in FULL shows the WebGL world at once, but main.js imports it on demand, i.e. only
  // after its own module graph has run. Announce the three modules now so they download in parallel.
  // Same URLs and versions as the import in main.js / js/page.js and in world.js, or they download twice.
  if (mode === "full" && root.hasAttribute("data-cinema")) {
    ["js/world/world.js?v=20261025-r28", "js/world/gl.js?v=20261025-r28", "js/world/shaders.js?v=20261025-r28"].forEach(function (href) {
      var link = document.createElement("link");
      link.rel = "modulepreload";
      link.href = href;
      document.head.appendChild(link);
    });
  }

  // A press on the standby screen before sound.js is here: the choice is kept (and the screen fades at once), sound.js
  // acts on it as soon as it runs. The press is a user activation of the page: the sound may start from it later.
  // Should the modules never come, the tube's failsafe (styles.css, power-pending) uncovers the page 3 s after the press.
  var early = function (mode) {
    if (window.__yosuljinGateReady || !root.classList.contains("gate-pending")) return;
    window.__yosuljinGateChoice = mode;
    var gate = document.querySelector(".signal-gate");
    if (gate) gate.classList.add("is-leaving");
    root.classList.remove("power-hold");
  };
  // The same press asks for the fullscreen, in the press itself — a browser grants it to nothing else —, whether
  // sound.js is here yet or not. Refused, it is "off" for the visit: the site does not ask again.
  var immerse = function () {
    if (!immersive || document.fullscreenElement) return;
    immersive = false;
    var refused = function () { remember("off"); };
    remember("asked");
    try {
      var asked = root.requestFullscreen({ navigationUI: "hide" });
      if (asked && typeof asked.then === "function") asked.then(null, refused);
    } catch (e) { refused(); }
  };
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest(".signal-gate [data-gate]") : null;
    if (!b) return;
    immerse();
    early(b.getAttribute("data-gate"));
  }, true);
  // The screen says « ou appuyez sur une touche »: before sound.js makes it modal, the focus is not inside it.
  document.addEventListener("keydown", function (e) {
    if (!e.key || e.key.length !== 1 || e.key === " " || e.ctrlKey || e.metaKey || e.altKey) return;
    var g = document.querySelector(".signal-gate");
    if (!g || g.classList.contains("is-leaving") || !(g.open || root.classList.contains("gate-pending"))) return;
    immerse();
    early("sound");
  }, true);

  // Capture the menu before the module graph finishes loading. This removes the
  // small post-load window where the button used to exist without a listener.
  document.addEventListener("click", function (e) {
    if (window.__yosuljinMenuReady) return;
    var target = e.target && e.target.closest ? e.target.closest(".menu-toggle") : null;
    if (!target) return;
    var menu = document.querySelector(".site-menu");
    if (!menu) return;
    e.preventDefault();
    var open = target.getAttribute("aria-expanded") !== "true";
    target.setAttribute("aria-expanded", String(open));
    var word = target.querySelector(".menu-word");
    if (word) word.textContent = open ? "FERMER" : "MENU";
    menu.setAttribute("aria-hidden", String(!open));
    menu.toggleAttribute("inert", !open);
    var page = document.querySelectorAll("main, body > .site-footer");
    for (var i = 0; i < page.length; i++) page[i].toggleAttribute("inert", open);
    menu.classList.toggle("open", open);
    root.classList.toggle("menu-open", open);
  }, true);

  // Between two pages of the site the browser may run a view transition over the arriving page (the afterimage,
  // portal.js). While it runs, Chromium gives that page no pointer input: the root takes the press, whatever
  // `::view-transition{pointer-events:none}` says. Measured on 2026-10-18 (Chromium 141): under the menu button
  // the hit test found only <html> until the transition ended, and a click there was lost — a fraction of a
  // second on a fast machine, seconds on a slow one. So the first press ends the transition, and the click it
  // makes is handed to what is under the pointer once the page is back; nothing changes for whoever waits.
  // The bench: _outils/qa/transition-2026-10-18 (menu opened by a click during the transition: 0/10 before, 12/12).
  var transition = null, pressPending = 0;
  window.addEventListener("pagereveal", function (e) {
    if (!e.viewTransition) return;
    transition = e.viewTransition;
    var done = function () { transition = null; };
    try { transition.finished.then(done, done); } catch (err) { transition = null; }
  });
  window.addEventListener("pointerdown", function (e) {
    if (!transition || e.target !== root) return;
    pressPending = Date.now();
    try { transition.skipTransition(); } catch (err) {}
  }, true);
  window.addEventListener("keydown", function () {
    if (transition) try { transition.skipTransition(); } catch (err) {}
  }, true);
  // The same click, given to what is under the pointer: every listener already in place takes it as it would
  // have — the menu button, a link (portal.js), a node of the Aether map (an SVG group with role="link", which
  // has no click() method). An open menu or a frame covers the page: the element found is theirs, never under them
  // (an inert <main> is skipped by the hit test). Nothing under the pointer but the root: nothing to give.
  var hand = function (x, y) {
    var under = document.elementFromPoint(x, y);
    if (!under || under === root || under === document.body) return false;
    under.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, view: window, detail: 1, button: 0, clientX: x, clientY: y }));
    return true;
  };
  document.addEventListener("click", function (e) {
    if (!pressPending) return;
    var recent = Date.now() - pressPending < 1500;
    pressPending = 0;
    if (!recent || e.target !== root) return; // the browser found the element itself: nothing to redo
    e.stopPropagation();
    var x = e.clientX, y = e.clientY;
    if (hand(x, y)) return;
    // The click can come before the skipped transition is torn down (measured: 1 press in 12 under CPU x4): the hit
    // test still finds the root. Once it is over and the next frame drawn, what is under the pointer answers.
    var later = function () { requestAnimationFrame(function () { requestAnimationFrame(function () { hand(x, y); }); }); };
    if (transition) transition.finished.then(later, later); else later();
  }, true);
})();
