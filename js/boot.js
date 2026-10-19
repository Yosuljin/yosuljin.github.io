// Runs synchronously in <head> (classic script, CSP-safe) so the first paint already has the
// right layout: cinema (FULL 3D + precise pointer) or document flow (LITE / touch).
(function () {
  var root = document.documentElement, mode = "full";
  // LITE is a dated choice (js/core/prefs.js): a bare "lite" left by a visit before 2026-10-13 no longer applies.
  try { if (localStorage.getItem("yosuljin-display-mode") === "lite@2026-10-13") mode = "lite"; } catch (e) {}
  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.classList.add("js", "mode-" + mode);
  // FULL mode keeps the cinema composition on touch/mobile too; the input method changes, not the scene.
  if (mode === "full" && root.hasAttribute("data-cinema")) root.classList.add("cinema");
  if (reduced) root.classList.add("reduced-motion");
  // Launch: the screen starts dark and portal.js powers the tube on (a bright line that opens onto the page).
  // A page reached from a link of the site arrives covered too, and opens from the line (a change of channel,
  // portal.js). CSS reveals the page by itself if no script runs.
  try {
    if (sessionStorage.getItem("yosuljin-portal")) root.classList.add("channel-pending");
    else if (!reduced) root.classList.add("power-pending");
  } catch (e) {}
  // In the immersive frame (js/ui/immersive-nav.js): the owning page learns when this picture is first drawn.
  if (window.parent !== window) {
    try { requestAnimationFrame(function () { window.parent.postMessage({ type: "yosuljin-frame-shown" }, location.origin); }); } catch (e) {}
  }

  // The index in FULL shows the WebGL world at once, but main.js imports it on demand, i.e. only
  // after its own module graph has run. Announce the three modules now so they download in parallel.
  // Same URLs and versions as the import in main.js / js/page.js and in world.js, or they download twice.
  if (mode === "full" && root.hasAttribute("data-cinema")) {
    ["js/world/world.js?v=20261014-r1", "js/world/gl.js?v=20261009-r2", "js/world/shaders.js?v=20261014-r1"].forEach(function (href) {
      var link = document.createElement("link");
      link.rel = "modulepreload";
      link.href = href;
      document.head.appendChild(link);
    });
  }

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
