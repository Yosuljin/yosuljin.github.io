// The butterfly cursor (D170 (d) 101 to 112), on a fine pointer: it follows the pointer, rests, and beats its wings while
// the camera moves or something is pressed. One popover="manual" element, in the top layer above the modal dialogs.
// Loaded by main.js and js/page.js; it adds css/papillon.css itself, so if it fails the arrow stays (hidden at the
// first pointer move, never before). createEtat, CIBLES, NATIF: tried in Node (_outils/qa/papillon-2026-10-28/mesure).

/** Minimum flight of a press (a click is shorter than a wingbeat) and flight after the camera's last move, in ms. */
export const DUREE_APPUI = 500;
export const DUREE_CAMERA = 400;

/** Rests or flies. Presses carry an id (a button, a key); times are performance.now() values. No allocation once the
 *  ids are known. */
export function createEtat() {
  const prises = new Set();
  let fin = -Infinity;
  return {
    appui(t, id = "") { prises.add(id); if (t + DUREE_APPUI > fin) fin = t + DUREE_APPUI; },
    relache(t, id = "") { prises.delete(id); },
    camera(t) { if (t + DUREE_CAMERA > fin) fin = t + DUREE_CAMERA; },
    vol(t) { return prises.size > 0 || t < fin; },
    fin() { return prises.size > 0 ? Infinity : fin; },
    efface() { prises.clear(); fin = -Infinity; },
    get tenu() { return prises.size; },
  };
}

/** Over these it grows and opens its wings: the cursor:pointer targets of css/. */
export const CIBLES = "a[href],button:not(:disabled),summary,[role=link],[role=button],[role=tab],.plan-salle";
/** Over these the arrow comes back. */
export const NATIF = "input:not([type=checkbox],[type=radio],[type=button],[type=submit],[type=reset],[type=range],[type=file],[type=image],[type=color]),textarea,select,[contenteditable]:not([contenteditable=false]),video,audio";

/** Keys that move no camera. */
const SANS_GESTE = /^(Tab|Shift|Control|Alt|Meta|CapsLock|Escape)$/;
/** Over these the wings half fold (the scenes that turn when dragged: css/aether.css, css/scenes.css). */
const PRISE = ".aether-orbit-stage.is-gl,.aether-scene.is-live .scene-stage";
/** Pointer kept across one page change (session storage, declared in confidentialite.html). */
const CLE = "yosuljin-pointeur";

const SPRITE = typeof document === "undefined" ? "" : new URL("../../motifs.svg", import.meta.url).pathname;
const svg = (cls, box, id) => `<svg class="${cls}" viewBox="${box}" aria-hidden="true"><use href="${SPRITE}#${id}"/></svg>`;

let demarre = false;

/** Adds the stylesheet, then the butterfly; false without Popover (the arrow stays). */
export function demarrer() {
  if (demarre || typeof document === "undefined" || typeof HTMLElement.prototype.showPopover !== "function") return false;
  demarre = true;
  const feuille = new URL("../../css/papillon.css", import.meta.url);
  feuille.search = new URL(import.meta.url).search;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = feuille.href;
  link.addEventListener("load", monter, { once: true });
  link.addEventListener("error", () => link.remove(), { once: true });
  document.head.append(link);
  return true;
}

function monter() {
  const root = document.documentElement;
  const el = document.createElement("span");
  el.className = "papillon";
  el.setAttribute("popover", "manual");
  el.setAttribute("aria-hidden", "true");
  el.inert = true;
  el.innerHTML = '<span class="papillon-pose">' + svg("papillon-aile papillon-g", "0 0 60 100", "butterfly-wing-l") +
    svg("papillon-aile papillon-d", "0 0 60 100", "butterfly-wing-r") + svg("papillon-corps", "0 0 120 100", "butterfly-body") + "</span>";
  document.body.append(el);
  try { el.showPopover(); } catch { el.remove(); return; }

  const qs = ["(pointer: fine)", "(prefers-contrast: more)", "(forced-colors: active)"].map(q => matchMedia(q));
  const permis = () => qs[0].matches && !qs[1].matches && !qs[2].matches;
  const musee = document.body.classList.contains("musee-page");
  const etat = createEtat();
  let x = 0, y = 0, px = 0, py = 0;   // drawn at x, y; pointer at px, py (apart when locked)
  let vu = false, hors = false, verrouille = false, survol = false, prise = false;
  let pret = false, aVu = false, dernierAppui = -Infinity;   // pret: the sprite loaded; aVu: a pointer position is known
  let demande = 0, minuterie = 0, ecrit = "";
  // Arriving by a click on a link: the last position, so the arrow is not shown until the next move.
  try {
    const m = sessionStorage.getItem(CLE);
    sessionStorage.removeItem(CLE);
    const [a, b] = (m || "").split(",").map(Number);
    if (m && isFinite(a) && isFinite(b)) { x = px = a; y = py = b; aVu = true; }
  } catch {}
  // Without its drawing the arrow stays.
  fetch(SPRITE).then(r => { if (r.ok) { pret = true; if (aVu) commencer(); } }).catch(() => {});

  const image = () => {
    demande = 0;
    const t = performance.now();
    const m = "translate3d(" + x + "px," + y + "px,0)";
    if (m !== ecrit) { ecrit = m; el.style.transform = m; }
    const v = etat.vol(t);
    el.classList.toggle("vol", v);
    el.classList.toggle("vu", vu && permis());
    el.classList.toggle("hors", hors);
    el.classList.toggle("lien", survol && !verrouille);
    el.classList.toggle("prise", prise && !survol);
    el.classList.toggle("centre", verrouille);
    clearTimeout(minuterie);
    const f = etat.fin();
    if (v && f !== Infinity) minuterie = setTimeout(demander, f - t + 10);
  };
  function demander() { if (!demande) demande = requestAnimationFrame(image); }
  const ecoute = (type, fn) => addEventListener(type, fn, { capture: true, passive: true });
  function commencer() { aVu = true; if (pret && !vu) { vu = true; root.classList.add("papillon-on"); demander(); } }

  // Pointer locked (the museum): the butterfly takes the middle, the crosshair's place, and goes back when freed.
  ecoute("pointermove", e => {
    if (e.pointerType === "touch" || verrouille) return;
    x = px = e.clientX; y = py = e.clientY;
    hors = e.target.localName === "iframe";
    commencer();
    demander();
  });
  const poser = () => { if (verrouille) { x = innerWidth / 2; y = innerHeight / 2; } else { x = px; y = py; } demander(); };
  document.addEventListener("pointerlockchange", () => {
    verrouille = !!document.pointerLockElement;
    if (verrouille) { hors = false; commencer(); }
    poser();
  });
  addEventListener("resize", () => { if (verrouille) poser(); }, { passive: true });

  // Under it: a link grows it, a field brings the arrow back, a frame has its own butterfly.
  ecoute("pointerover", e => {
    if (e.pointerType === "touch") return;
    const cible = e.target;
    if (!(cible instanceof Element)) return;
    survol = !!cible.closest(CIBLES);
    prise = !!cible.closest(PRISE);
    root.classList.toggle("papillon-natif", !!cible.closest(NATIF));
    if (cible.localName === "iframe") hors = true;
    demander();
  });
  ecoute("pointerout", e => { if (!e.relatedTarget) { hors = true; demander(); } });

  // Presses (buttons, keys held) and the camera; listened to on the window in capture, which a stopPropagation of the site never starves.
  const faire = fn => e => { if (e.pointerType !== "touch") { fn(performance.now(), e.type.startsWith("key") ? e.code : "p" + e.button, e); demander(); } };
  ecoute("pointerdown", faire((t, id) => { dernierAppui = t; etat.appui(t, id); }));
  addEventListener("pagehide", () => {
    if (vu && !verrouille && performance.now() - dernierAppui < 1000) try { sessionStorage.setItem(CLE, px + "," + py); } catch {}
  });
  ecoute("pointerup", faire((t, id) => etat.relache(t, id)));
  ecoute("pointercancel", faire(() => etat.efface()));
  ecoute("keydown", faire((t, id, e) => { if (!e.repeat && !SANS_GESTE.test(e.key)) etat.appui(t, id); }));
  ecoute("keyup", faire((t, id, e) => { if (e.key === "Meta") etat.efface(); else etat.relache(t, id); }));   // no keyup after Meta+key
  const bouge = faire(t => etat.camera(t));
  addEventListener("yosuljin:camera", bouge);
  if (!musee) { ecoute("wheel", bouge); ecoute("scroll", bouge); }   // in the museum the camera is the event above

  const absent = () => { etat.efface(); demander(); };
  addEventListener("blur", absent);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { absent(); clearTimeout(minuterie); } });
  for (const q of qs) q.addEventListener("change", () => { root.classList.toggle("papillon-on", vu && permis()); demander(); });

  // Back on top after a modal dialog or a full screen shown after it.
  let enHaut = false;
  const remonter = () => {
    if (enHaut) return;
    enHaut = true;
    queueMicrotask(() => { enHaut = false; try { el.hidePopover(); el.showPopover(); } catch {} });
  };
  new MutationObserver(liste => { for (const m of liste) if (m.target.localName === "dialog" && m.target.open) { remonter(); return; } })
    .observe(document, { subtree: true, attributes: true, attributeFilter: ["open"] });
  document.addEventListener("fullscreenchange", remonter);

  demander();
}
