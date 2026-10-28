// The safety net of musee.html (classic script, no import: it must stand when the museum's own modules do not).
// If musee.js or one of the modules it imports does not arrive, the module never runs and nothing else would tell: the
// button would stay grey on « LE MUSÉE SE PRÉPARE… ». Here the page falls back on its readable side, with a way to
// try again and the way to LITE. A press on « Recharger la page » works for every reason (js/musee/musee.js uses it too).
(function () {
  var tag = document.querySelector('script[src*="js/musee/musee.js"]');
  if (tag) tag.addEventListener("error", function () {
    var fallback = function () {
      var main = document.querySelector("[data-musee]");
      if (!main || main.classList.contains("sans-3d")) return;
      main.classList.add("sans-3d");
      main.dataset.raison = "chargement";
      Array.prototype.forEach.call(main.querySelectorAll("[data-lite]"), function (b) {
        b.addEventListener("click", function () {
          try { localStorage.setItem("yosuljin-display-mode", "lite@2026-10-13"); } catch (e) {}   // the key and the dated value of js/core/prefs.js
          location.href = "index.html";
        });
      });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fallback); else fallback();
  });
  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest("[data-recharger]")) location.reload();
  });
})();
