// Runs synchronously in <head> (classic script, CSP-safe) so the first paint already has the
// right layout: cinema (FULL 3D + precise pointer) or document flow (LITE / touch).
(function () {
  var root = document.documentElement, mode = "full";
  try { if (localStorage.getItem("yosuljin-display-mode") === "lite") mode = "lite"; } catch (e) {}
  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.classList.add("js", "mode-" + mode);
  // FULL mode keeps the cinema composition on touch/mobile too; the input method changes, not the scene.
  if (mode === "full" && root.hasAttribute("data-cinema")) root.classList.add("cinema");
  if (reduced) root.classList.add("reduced-motion");
  // Launch: the screen starts dark and portal.js powers the tube on (a bright line that opens onto the page).
  // A page reached from a link of the site is already on. CSS reveals the page by itself if no script runs.
  try { if (!reduced && !sessionStorage.getItem("yosuljin-portal")) root.classList.add("power-pending"); } catch (e) {}

  // The index in FULL shows the WebGL world at once, but main.js imports it on demand, i.e. only
  // after its own module graph has run. Announce the three modules now so they download in parallel.
  // Same URLs and versions as the import in main.js / js/page.js and in world.js, or they download twice.
  if (mode === "full" && root.hasAttribute("data-cinema")) {
    ["js/world/world.js?v=20261009-r2", "js/world/gl.js?v=20261009-r2", "js/world/shaders.js?v=20261009-r2"].forEach(function (href) {
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
})();
