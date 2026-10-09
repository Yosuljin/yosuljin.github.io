// Immersive display helper. A normal webpage cannot hide browser chrome by force;
// fullscreen is entered only by an explicit user activation on the immersive control.
// Inside the immersive frame, the fullscreen is the owning page's (immersive-nav.js). A frame from another
// origin cannot read it, and is never fullscreen through us.
function parentFullscreen() {
  try { return window.parent !== window && !!window.parent.document.fullscreenElement; } catch { return false; }
}
function paint(button) {
  const active = !!document.fullscreenElement || parentFullscreen();
  button.classList.toggle("is-on", active);
  button.removeAttribute("aria-pressed");
  button.setAttribute("aria-label", active ? "Sortir du mode immersif" : "Entrer en mode immersif");
  const word = button.querySelector(".fullscreen-word");
  if (word) word.textContent = active ? "SORTIR" : "IMMERSIF";
}
function addButton() {
  const cluster = document.querySelector(".brand-cluster");
  if (!cluster || cluster.querySelector("[data-fullscreen-toggle]")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "fullscreen-toggle";
  button.dataset.fullscreenToggle = "";
  button.innerHTML = '<span class="fullscreen-frame" aria-hidden="true"></span><span class="fullscreen-word">IMMERSIF</span>';
  button.addEventListener("click", async () => {
    if (parentFullscreen()) { window.parent.postMessage({ type: "yosuljin-fullscreen-toggle" }, location.origin); return; }
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    } catch {}
    paint(button);
  });
  document.addEventListener("fullscreenchange", () => paint(button));
  cluster.insertBefore(button, cluster.querySelector("[data-mode-toggle]") || cluster.firstChild);
  paint(button);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addButton, { once: true });
else addButton();
