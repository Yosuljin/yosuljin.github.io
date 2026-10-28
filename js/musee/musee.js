// The museum (D168, D169): the site as a museum in 3D where one walks like in a video game, guided by AlmaS. This
// module is the page side: it decides whether the museum can run (FULL 3D, motion allowed, WebGL), opens the doors
// (the entrance, the plan always in view, the room chips), and plays each frame — the walk (marche.js), AlmaS
// (almas.js), the drawing (rendu.js, fetched only when the museum runs). What an exhibit opens is its room's page
// (aether.html, jeux.html, mondes.html, photographie.html, ecriture.html): the page stays the source, the room stages
// it. Elsewhere (LITE, reduced motion, forced colours, no WebGL) the page says that the museum is visited in FULL 3D,
// and leads to the readable site.
//
// The drawing is extensible without being reopened: the additions of ajouts.js (a graft each) are
// fetched here, before createRendu, and handed to it.
import { every, wake } from "../core/loop.js?v=20261014-r1";
import { getMode, setMode, onModeChange, reducedMotion } from "../core/prefs.js?v=20261025-r28";
import { sfx, setRoom, brancherEspace, entendre, debrancherEspace } from "../ui/sound.js?v=20261025-r28";
import { SALLES, OEUVRES, ARRIVEES, salleEn } from "./batiment.js?v=20261025-r28";
import { createMarche } from "./marche.js?v=20261025-r28";
import { createAlmas } from "./almas.js?v=20261025-r28";
import { setupScene } from "../scenes/scene.js?v=20261025-r28";

const main = document.querySelector("[data-musee]");
const root = document.documentElement;
const forced = matchMedia("(forced-colors: active)");
const tactile = () => matchMedia("(pointer: coarse)").matches;
const $ = s => main.querySelector(s);
const framed = window.parent !== window;

// The drawing's tier, chosen once at the start. Today there is one: the lowest, the museum of today. A later file
// (paliers.js, not written yet) will set the thresholds that choose it.
const PALIER = 0;

// The fullscreen of the visit (D165) is the owning page's when the museum is framed under it (js/ui/immersive-nav.js).
// There, a press of Escape leaves it — and the mouse with it — unless the page keeps Escape (Chromium): the mouse is
// then locked only where it can be given back alone; elsewhere, in fullscreen, a drag looks around.
const plein = () => { try { return !!(document.fullscreenElement || (framed && parent.document.fullscreenElement)); } catch { return !!document.fullscreenElement; } };
const garde = () => typeof navigator.keyboard?.lock === "function" && typeof window.__yosuljinImmersive?.echap === "function";
// A phone (D169 (b) 1): the museum is visited sideways. Where the browser can turn the screen (in fullscreen, Android),
// the page holding the fullscreen turns it; upright, the museum waits behind its message (css/musee.css).
const telephone = matchMedia("(pointer: coarse) and (max-width: 600px), (pointer: coarse) and (max-height: 600px)");
const debout = matchMedia("(pointer: coarse) and (orientation: portrait) and (max-width: 600px)");

// Where the visitor stood, kept in the page's own history entry (history.state): back from a page of the site, or
// the reload that leaves the fullscreen, finds them there — framed, the owning page carries it (immersive-nav.js).
// Nothing is stored in the browser.
function repris() {
  let r = null;
  try { r = history.state?.musee || (framed ? parent.history.state?.musee : null) || null; } catch {}
  if (!r || !Number.isFinite(r.x) || !Number.isFinite(r.z) || !Number.isFinite(r.yaw)) return null;
  return salleEn(r.x, r.z) ? r : null;
}

// The spatial layer of the sound lives and dies with the museum: it is let go when the museum leaves for LITE and when the
// 3D is lost (WebGL context lost, a failed set-up), never rebuilt after.
let sonBranche = true;
function quitterSon() {
  sonBranche = false;
  try { setRoom(null); debrancherEspace(); } catch {}
}

function sansTroisD(raison) {
  quitterSon();
  main.classList.add("sans-3d");
  main.dataset.raison = raison;
}

/** A page of the site, reached as from any of its links (js/ui/portal.js: the change of channel, the immersive frame). */
function lienVers(href) {
  const a = document.createElement("a");
  a.href = href; a.hidden = true;
  main.append(a); a.click(); a.remove();
}

// FULL is the museum, LITE the site of today (D168 (b) 5, D169 (b) 2): switched to LITE, the museum leaves for the
// home; switched back to FULL here, it opens. « Lire le site à la place » is that switch.
if (main) {
  onModeChange(m => {
    if (m === "lite" && main.classList.contains("est-pret")) { quitterSon(); lienVers("index.html"); }
    else if (m === "full" && main.dataset.raison === "lite") location.reload();
  });
  main.querySelectorAll("[data-lite]").forEach(b => b.addEventListener("click", () => setMode("lite")));
  main.querySelector("[data-full]")?.addEventListener("click", () => setMode("full"));
}

async function demarrer() {
  if (!main) return;
  // The device's own reasons come first: a device that asks for less motion (or its own colours) and is in LITE must
  // be told so, not offered "Passer en FULL 3D" that its next load would refuse (onModeChange reloads only for "lite").
  if (reducedMotion.matches) return sansTroisD("mouvement");
  if (forced.matches) return sansTroisD("couleurs");
  if (getMode() !== "full") {
    // In LITE, before offering "Passer en FULL 3D": a device without WebGL would be offered a door its next load shuts.
    // The probe costs nothing to FULL, which never takes this branch; the context is given back at once.
    let gl = null;
    try { const c = document.createElement("canvas"); gl = c.getContext("webgl2") || c.getContext("webgl"); gl?.getExtension("WEBGL_lose_context")?.loseContext(); } catch {}
    return sansTroisD(gl ? "lite" : "webgl");
  }
  const scene = $("[data-musee-scene]");
  const canvas = document.createElement("canvas");
  canvas.className = "musee-canvas";
  canvas.setAttribute("aria-hidden", "true");
  scene.prepend(canvas);
  // The additions' wait starts here, with their import (not after the fonts): 3 s at most in all, then the museum opens
  // without what has not come.
  const ajouts = chargerAjouts(PALIER);
  const ajoutsPrets = Promise.race([ajouts, new Promise(r => setTimeout(() => r({ greffons: [] }), 3000))]);
  // The signs are drawn once, in the site's fonts: they are waited for (2.5 s at most).
  const fonts = document.fonts ? Promise.all([
    document.fonts.load('400 64px "Instrument Serif"'), document.fonts.load('italic 400 48px "Instrument Serif"'),
    document.fonts.load('500 26px "JetBrains Mono"'),
    document.fonts.load('120px "Yosuljin Hanzi"', "世界之間"),
  ]).catch(() => {}) : Promise.resolve();
  await Promise.race([fonts, new Promise(r => setTimeout(r, 2500))]);
  const { greffons } = await ajoutsPrets;
  // The drawing's module not arriving is the network's doing (« chargement »); arriving but drawing nothing is the device's (« webgl »).
  let module = null, rendu = null;
  try { module = await import("./rendu.js?v=20261025-r28"); } catch (e) { console.error(e); }
  if (!module) { canvas.remove(); return sansTroisD("chargement"); }
  try { rendu = module.createRendu(canvas, { palier: PALIER, greffons }); } catch (e) { console.error(e); }
  if (!rendu) { canvas.remove(); return sansTroisD("webgl"); }
  main.classList.add("est-pret");
  // Any failure while the museum is set up falls back on the readable page, never on a greyed button for good.
  try { jouer(scene, canvas, rendu); } catch (e) { console.error(e); canvas.remove(); main.classList.remove("est-pret"); return sansTroisD("webgl"); }
}

/** The additions of ajouts.js whose tier is within the current one, fetched together (a failed one is left out, whatever
 *  the reason); in the list's order. Never rejects. */
async function chargerAjouts(palier) {
  const greffons = [];
  try {
    const { AJOUTS } = await import("./ajouts.js?v=20261025-r28");
    const liste = (Array.isArray(AJOUTS) ? AJOUTS : []).filter(a => a && typeof a.charger === "function" && (a.palier | 0) <= palier);
    const modules = await Promise.all(liste.map(a => Promise.resolve().then(() => a.charger()).catch(e => { console.warn(`[musee] addition ${a.nom} left out`, e); return null; })));
    for (const m of modules) {
      if (!m) continue;
      if (m.greffon && typeof m.greffon === "object") greffons.push(m.greffon);
    }
  } catch (e) { console.warn("[musee] ajouts.js not loaded", e); }
  return { greffons };
}

const angle = a => Math.atan2(Math.sin(a), Math.cos(a));
const lisse = u => u * u * (3 - 2 * u);

function jouer(scene, canvas, rendu) {
  const marche = createMarche(scene, { verrouillable: () => !plein() || garde() });
  const almas = createAlmas({ soustitres: $("[data-soustitres]"), zh: $("[data-zh]"), en: $("[data-en]"), annonce: $("[data-annonce]") });
  // The sound's spatial layer (SPEC 4.15): made apart, and only if the museum still stands when it arrives; any failure is swallowed.
  import("./espace.js?v=20261025-r28").then(m => { if (!sonBranche) return; m.preparer(); brancherEspace(env => m.creerEspace(env)); }).catch(() => {});
  const action = $("[data-action]"), ici = $("[data-ici]"), stick = $("[data-stick]"), entree = $("[data-entree]");
  const vitrine = $("[data-vitrine]"), corps = vitrine.querySelector("[data-vitrine-corps]"), titre = vitrine.querySelector("[data-vitrine-titre]");
  const plan = $("[data-plan]"), hud = $(".musee-hud");
  let commence = false, salle = null, proche = null, cle = "", route = null, last = 0, place = 0, stop = null, relache = -1e9, note = -1e9;
  let mort = false, redessin = false, densiteVue = devicePixelRatio;   // the 3D is lost for good; the next frame must draw although the museum sleeps (the size changed); the density the canvas was made for
  // Where the book of Écriture is: on its shelf, in the hand, open on the lectern.
  let livre = "etagere";
  const vues = new Set();

  // ---------- Size ----------
  const size = () => rendu.size(scene.clientWidth, scene.clientHeight);
  size();
  // Resizing empties the canvas: while the museum sleeps (no focus, deep rest) one frame must be drawn after it.
  // The strip of chips scrolls where the screen is narrow: the chip of the room one stands in is brought into view (its own
  // axis only, the page does not move), again when the screen changes size.
  const puceEnVue = () => {
    const c = main.querySelector(".musee-puce[aria-current]"), n = c?.parentElement;
    if (!n || n.scrollWidth <= n.clientWidth) return;
    const a = c.getBoundingClientRect(), b = n.getBoundingClientRect();
    n.scrollLeft += a.left + a.width / 2 - (b.left + b.width / 2);
  };
  const retaille = () => { if (mort) return; puceEnVue(); densiteVue = devicePixelRatio; size(); redessin = true; wake(); boucle(); };
  if ("ResizeObserver" in window) new ResizeObserver(retaille).observe(scene); else addEventListener("resize", retaille);
  // A new pixel density at the same size (a window dragged to a denser screen, the scale of Windows changed) reaches neither
  // the observer nor resize: its query is watched, and made again for each density; each frame also checks it, as not every
  // browser tells (the emulated density of the QA never does).
  const densite = () => { if (mort) return; try { const q = matchMedia(`(resolution: ${devicePixelRatio}dppx)`); q.addEventListener?.("change", () => { retaille(); densite(); }, { once: true }); } catch {} };
  densite();
  // The 3D is lost: the museum is over. The readable page takes its place, and what moved stops with it — the loop, the keys
  // (M, E), the walk, the mouse, the voice; an open plan or showcase closes.
  const finir = raison => {
    if (mort) return;
    mort = true; commence = false; anim = null; assis = null;
    stop?.(); stop = null;
    marche.actif = false;
    fermer(plan); fermer(vitrine);
    almas.taire();
    try { document.exitPointerLock?.(); } catch {}
    canvas.remove();
    sansTroisD(raison);
  };
  canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); finir("perdue"); }, { once: true });
  // Less motion (or the device's own colours) asked for while the museum runs: a page opened with that setting is the
  // readable page (demarrer), so this one becomes it too — the voice, the walk and the sound spatial layer stop with it.
  // Asked back, the museum opens again by a reload, as a new page would.
  const reglage = () => {
    if (reducedMotion.matches) finir("mouvement");
    else if (forced.matches) finir("couleurs");
    else if (main.dataset.raison === "mouvement" || main.dataset.raison === "couleurs") location.reload();
  };
  reducedMotion.addEventListener?.("change", reglage);
  forced.addEventListener?.("change", reglage);

  // ---------- Where one arrives: back where one stood, else a link #salle, else the hall ----------
  const avant = repris();
  const placer = (x, z, cap) => { marche.teleporter(x, z, cap); almas.pos.x = x + 0.8; almas.pos.z = z - 1.2; };
  // A saved place inside a plinth is pushed out by the walls' push, maybe through a wall: it must stay in its room, else the hall.
  const tient = avant && (placer(avant.x, avant.z, avant.yaw), salleEn(marche.joueur.x, marche.joueur.z)?.id === salleEn(avant.x, avant.z)?.id);
  if (avant && tient) {
    (avant.vues || []).forEach(v => vues.add(v));
    if (["etagere", "main", "pupitre"].includes(avant.livre)) livre = avant.livre;
    if (livre === "main" && salleEn(avant.x, avant.z)?.id !== "ecriture") livre = "etagere";
  } else { const h = location.hash.slice(1), a = Object.prototype.hasOwnProperty.call(ARRIVEES, h) ? ARRIVEES[h] : ARRIVEES.hall; placer(a.x, a.z, a.cap); }

  /** Writes where the visitor stands into the page's history entry (repris above): at most every 1.5 s on the way,
   *  at once when it matters — a room, a dialog, a link. */
  function noter(maintenant) {
    const t = performance.now();
    if (!maintenant && t - note < 1500) return;
    note = t;
    const j = marche.joueur, s = history.state;
    const musee = { x: +j.x.toFixed(2), z: +j.z.toFixed(2), yaw: +j.yaw.toFixed(3), vues: [...vues], entre: commence, livre };
    try { history.replaceState({ ...(s && typeof s === "object" ? s : {}), musee }, "", salle ? `#${salle}` : location.href); } catch {}
  }
  document.addEventListener("click", e => { if (e.target.closest?.("a[href]")) noter(true); }, true);
  addEventListener("pagehide", () => noter(true));

  // ---------- The plan: the map in its corner, the chips of the rooms, the big plan ----------
  const plans = [...main.querySelectorAll("[data-plan-svg]")].map(svg => dessinerPlan(svg));
  const allerA = (id, avec) => {
    const a = ARRIVEES[id];
    if (!a || anim) return;
    fermer(plan);
    if (avec) { almas.mener({ salle: id, x: a.x, z: a.z }); return; }
    almas.lacher();
    marche.teleporter(a.x, a.z, a.cap);
    almas.dire("arrive");
  };
  // A link #salle pasted into the tab where the museum already runs (a change of fragment alone): one goes there, as by the plan.
  addEventListener("hashchange", () => { const h = location.hash.slice(1); if (!mort && Object.prototype.hasOwnProperty.call(ARRIVEES, h) && h !== salle) allerA(h, false); });
  main.querySelectorAll("[data-aller]").forEach(b => b.addEventListener("click", () => allerA(b.dataset.aller, b.hasAttribute("data-avec"))));
  // The big plan is touched too: a room there leads to it (the list beside it stays the way for the keyboard; the SVG is hidden from it).
  main.querySelectorAll("svg.grand").forEach(svg => svg.addEventListener("click", e => { const r = e.target.closest?.(".plan-salle"); if (r) allerA(r.dataset.salle, false); }));
  main.querySelectorAll("[data-plan-ouvrir]").forEach(b => b.addEventListener("click", () => ouvrir(plan)));

  // ---------- Dialogs: the plan, an exhibit ----------
  function ouvrir(d) {
    if (d.open || (d === plan && anim)) return;   // like the M key: not while one sits down or gets up
    marche.actif = false;
    noter(true);
    d.showModal();
  }
  function fermer(d) { if (d.open) d.close(); }
  // A scene shown in a showcase draws in its own WebGL context: it is let go when the showcase closes, or the browser
  // would end the oldest context — the museum's — once it holds too many.
  // The scenes it set up hold observers and listeners on the page itself (js/scenes/scene.js): each gives them back, or every opening would leave its scene behind.
  let scenes = [];
  const viderVitrine = () => {
    corps.querySelectorAll("canvas").forEach(c => { try { (c.getContext("webgl2") || c.getContext("webgl"))?.getExtension("WEBGL_lose_context")?.loseContext(); } catch {} });
    for (const dispose of scenes.splice(0)) { try { dispose(); } catch (e) { console.error(e); } }
    corps.textContent = "";
  };
  for (const d of [plan, vitrine]) {
    d.addEventListener("close", () => {
      if (d === vitrine) { viderVitrine(); if (assis) { relever(); return; } }
      marche.actif = commence && !anim; wake(); boucle();
    });
    d.addEventListener("click", e => { if (e.target === d || e.target.closest("[data-fermer]")) fermer(d); });
  }

  // The rooms' pages, each fetched once: what the exhibits show.
  const pages = new Map();
  const lirePage = url => {
    if (!pages.has(url)) pages.set(url, fetch(url).then(r => r.ok ? r.text() : Promise.reject(r.status)).then(t => new DOMParser().parseFromString(t, "text/html")));
    return pages.get(url).catch(e => { pages.delete(url); throw e; });
  };
  lirePage("aether.html").catch(() => {});

  /** The exhibit that holds a sheet of the Aether page (the showcase a #projet-… link opens), if the museum has one. */
  const oeuvreDe = id => OEUVRES.find(x => x.contenu?.some(c => c === `#${id}` || c === `#scene-${id.replace(/^projet-/, "")}`));
  /** What the page says, for an exhibit: its own nodes (a list item comes with its list, so it keeps its look). */
  function extraire(doc, o) {
    const box = document.createElement("div");
    box.className = "musee-contenu";
    for (const sel of o.contenu) for (const el of doc.querySelectorAll(sel)) {
      const n = document.importNode(el, true);
      if (n.tagName === "LI") {
        const art = document.createElement("article"), ul = document.createElement("ul");
        art.className = "detail-block"; ul.append(n); art.append(ul); box.append(art);
      } else box.append(n);
    }
    // A link to another sheet of the Aether page (#projet-…) opens that sheet's showcase when the museum has one; the others
    // lead to the Aether page itself, where the sheet is (the ids exist there, not here: the link was dead).
    box.querySelectorAll('a[href^="#"]').forEach(a => { const id = a.getAttribute("href").slice(1); if (!oeuvreDe(id)) a.setAttribute("href", `aether.html#${id}`); });
    // The showcase's title is an h2: the sheet's headings follow it, one level under (h3), whatever level the Aether page gave
    // them; aria-level moves them for the reader and leaves the tags, which the styles speak to.
    const titres = [...box.querySelectorAll("h1,h2,h3,h4,h5,h6")];
    if (titres.length) {
      const decalage = 3 - Math.min(...titres.map(h => +h.localName[1]));
      if (decalage) titres.forEach(h => h.setAttribute("aria-level", String(Math.min(6, +h.localName[1] + decalage))));
    }
    // "Sur la carte" points at the page's map; the museum has its own. The dividers' sweep belongs to the page.
    box.querySelectorAll(".project-map, .divider").forEach(a => a.remove());
    return box;
  }
  const texte = el => (el?.textContent || "").replace(/\s+/g, " ").trim();
  const elt = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

  /** A theme's frame (Photographie): its number, its name, its words — and what the page says of its photos. */
  function cadre(doc, o) {
    const th = doc.querySelector(o.contenu[0]), box = elt("div", "musee-cadre");
    box.append(elt("div", "musee-cadre-vide"));
    const txt = elt("div", "musee-cadre-texte");
    txt.append(elt("p", "detail-index", `THÈME ${texte(th?.querySelector("span")) || String(o.n).padStart(2, "0")}`),
      elt("h3", null, texte(th?.querySelector("b")) || o.nom), elt("p", "musee-cadre-mots", texte(th?.querySelector("i")) || o.sous.toLowerCase()));
    const vide = [...doc.querySelectorAll("#photos-seules *")].find(e => !e.children.length && /AUCUNE/i.test(e.textContent));
    if (vide) txt.append(elt("p", "musee-note", texte(vide)));
    box.append(txt);
    return box;
  }

  /** The book, open (Écriture): what exists of it — its title, what it is, where it stands; its sentence; its page. */
  function ouvrage(doc, o) {
    const li = doc.querySelector(o.contenu[0]), fig = doc.querySelector(o.contenu[1]), pub = doc.querySelector(o.contenu[2]);
    const book = elt("div", "musee-livre"), g = elt("div", "musee-feuillet gauche"), d = elt("div", "musee-feuillet droite");
    const cite = li?.querySelector("cite");
    const t = elt("h3", "musee-livre-titre"); t.append(cite ? document.importNode(cite, true) : o.nom);
    const quoi = texte(li?.querySelector("span"))?.split("—")[1]?.trim();
    g.append(elt("p", "detail-index", "ÉCRITURE"), t);
    if (quoi) g.append(elt("p", "musee-livre-quoi", quoi));
    if (li?.querySelector("i")) g.append(elt("p", "musee-livre-etat", texte(li.querySelector("i"))));
    if (fig) d.append(document.importNode(fig, true));
    if (pub) d.append(document.importNode(pub, true));
    book.append(g, d);
    return book;
  }

  let ouverture = 0;
  async function montrerOeuvre(o) {
    const n = ++ouverture;
    const dedans = vitrine.open;   // a link of a showcase leads to another one: the link that had the focus goes with the old content
    titre.textContent = o.nom;
    viderVitrine();
    vitrine.dataset.oeuvre = o.type;
    vitrine.dataset.salle = o.salle;
    ouvrir(vitrine);
    if (dedans) { vitrine.scrollTop = corps.scrollTop = 0; vitrine.querySelector("[data-fermer]")?.focus(); }
    sfx("glass", o.type === "pupitre" ? 520 : 880, o.id);
    const url = o.page || "aether.html";
    let doc = null;
    try { doc = await lirePage(url); } catch {}
    if (!vitrine.open || n !== ouverture) return;
    if (!doc) {
      corps.innerHTML = "";
      const p = elt("p", "musee-erreur", "Cette vitrine n’a pas pu s’ouvrir. ");
      const a = elt("a", null, "Lire la page"); a.href = url; p.append(a);
      corps.append(p);
      return;
    }
    const box = o.type === "cadre" ? cadre(doc, o) : o.type === "pupitre" ? ouvrage(doc, o) : extraire(doc, o);
    corps.append(box);
    box.querySelectorAll("figure.aether-scene[data-scene]").forEach(f => { const dispose = setupScene(f); if (dispose) scenes.push(dispose); });
  }
  // In what an exhibit shows: a link to another sheet of the Aether page opens the showcase that holds it; a link to a
  // room's page leads to that room; any other one, to its page.
  corps.addEventListener("click", e => {
    const a = e.target.closest?.("a[href]");
    if (!a) return;
    const href = a.getAttribute("href");
    if (href.startsWith("#")) {
      e.preventDefault();
      const id = href.slice(1);
      const o = oeuvreDe(id);
      // Not an exhibit: the sheet is on the Aether page (extraire points the link there; this is for a link made since). The
      // showcase is a modal dialog, which keeps a click made by the script from reaching the page behind it: it closes first.
      if (o) montrerOeuvre(o); else { fermer(vitrine); lienVers(`aether.html#${id}`); }
      return;
    }
    let url;
    try { url = new URL(href, location.href); } catch { return; }
    const s = url.origin === location.origin && !url.hash && SALLES.find(x => url.pathname.endsWith("/" + x.page));
    if (s) { e.preventDefault(); fermer(vitrine); allerA(s.id, false); }
  });

  // ---------- Game Development: one sits down, the screen opens; one gets up ----------
  // The eye is carried along a few poses; the walk waits meanwhile.
  let anim = null, assis = null;
  function porter(poses, duree, puis) {
    anim = { poses, duree, t0: performance.now(), puis };
    marche.actif = false;
    wake(); boucle();
  }
  function poseAnim(now) {
    const { poses, duree, t0 } = anim, k = poses.length - 1;
    // A frame's time can come before the press that started the move (it began earlier): never before the start.
    const u = Math.max(0, Math.min(1, (now - t0) / duree)) * k, i = Math.min(k - 1, Math.floor(u));
    const a = poses[i], b = poses[i + 1], f = lisse(u - i);
    const cam = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f, yaw: a.yaw + angle(b.yaw - a.yaw) * f, pitch: a.pitch + (b.pitch - a.pitch) * f };
    if (now - t0 >= duree) { const puis = anim.puis; anim = null; puis?.(cam); }
    return cam;
  }
  function asseoir(o) {
    if (anim) return;
    const de = marche.camera(), chaise = { ...o.assise, pitch: -0.06 };
    const dedans = { x: o.ecran.x - 0.5, y: o.ecran.y, z: o.ecran.z, yaw: o.assise.yaw, pitch: 0 };
    assis = { o, dedans };
    sfx("glass", 440, "pc-chaise");
    porter([de, chaise, dedans], 1500, () => montrerOeuvre(o));
  }
  function relever() {
    const { o, dedans } = assis;
    assis = null;
    const debout = { x: o.x - 0.95, y: 1.62, z: o.z, yaw: o.assise.yaw, pitch: 0 };
    marche.teleporter(debout.x, debout.z, debout.yaw);
    porter([dedans, { ...o.assise, pitch: -0.06 }, debout], 900, () => { marche.actif = commence; });
  }

  // ---------- Écriture: the book, taken, laid on the lectern, read ----------
  function prendre() {
    livre = "main";
    sfx("glass", 660, "livre");
    almas.dire("livre", { ensuite: true });
    noter(true);
  }
  function poser() {
    livre = "pupitre";
    sfx("glass", 520, "pupitre");
    noter(true);
  }

  // ---------- What is within reach ----------
  const cibles = OEUVRES.map(o => ({ o, x: o.x + (o.nx || 0) * 1.1, z: o.z + (o.nz || 0) * 1.1, portee: o.portee || (o.type === "carte" ? 3.4 : o.type === "panneau" ? 3.2 : o.type === "cadre" ? 2.2 : 2.4) }));
  // What an exhibit lets one do now: its verb, or nothing (the book's places depend on where the book is).
  function verbe(o) {
    if (o.type === "livre") return livre === "etagere" ? "PRENDRE" : null;
    if (o.type === "pupitre") return livre === "main" ? "POSER LE LIVRE" : livre === "pupitre" ? "LIRE" : null;
    return o.verbe || "REGARDER";
  }
  function aPortee(j) {
    let best = null, bestS = -1;
    const fx = -Math.sin(j.yaw), fz = -Math.cos(j.yaw);
    for (const c of cibles) {
      const dx = c.x - j.x, dz = c.z - j.z, d = Math.hypot(dx, dz);
      if (d > c.portee || !verbe(c.o)) continue;
      const face = (dx * fx + dz * fz) / (d || 1);
      if (face < 0.45 && d > 1.2) continue;
      const s = face - d * 0.15;
      if (s > bestS) { bestS = s; best = c; }
    }
    return best;
  }
  function agir() {
    if (!proche || !commence || anim) return;
    const o = proche.o;
    if (o.type === "pc") asseoir(o);
    else if (o.type === "livre") prendre();
    else if (o.type === "pupitre") { if (livre === "main") poser(); else if (livre === "pupitre") montrerOeuvre(o); }
    else montrerOeuvre(o);
  }
  action.addEventListener("click", agir);
  const menuOuvert = () => root.classList.contains("menu-open");
  addEventListener("keydown", e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.("input, textarea, select")) return;
    if (!commence || vitrine.open || menuOuvert()) return;
    if (e.key === "e" || e.key === "E") { if (!plan.open) agir(); }
    else if (e.key === "m" || e.key === "M") { if (anim) return; if (plan.open) fermer(plan); else ouvrir(plan); }
  });

  // ---------- Escape and the mouse ----------
  // Kept by the page (Chromium, in fullscreen), Escape comes here: it gives the mouse back first; an open dialog or the
  // menu closes by itself; otherwise it leaves the fullscreen, as everywhere on the site (D165).
  const garderEchap = () => { if (commence && plein() && garde()) window.__yosuljinImmersive.echap(true); };
  const tourner = () => { if (telephone.matches && plein()) window.__yosuljinImmersive?.paysage?.(true); };
  const regard = () => main.classList.toggle("regard-glisse", plein() && !garde() && !tactile());
  regard();
  tourner();
  document.addEventListener("fullscreenchange", () => { regard(); garderEchap(); tourner(); });
  // Turned, the view takes its new size and the museum wakes; upright, it sleeps (frame below).
  debout.addEventListener?.("change", retaille);
  document.addEventListener("pointerlockchange", () => {
    main.classList.toggle("est-verrouille", marche.verrouille);
    if (!marche.verrouille) relache = performance.now();
  });
  marche.surRegard(() => main.classList.add("a-regarde"));
  addEventListener("keydown", e => {
    if (e.key !== "Escape" || e.defaultPrevented || !commence || plan.open || vitrine.open || menuOuvert()) return;
    if (anim) { e.preventDefault(); return; }
    if (marche.verrouille || performance.now() - relache < 400) { e.preventDefault(); document.exitPointerLock?.(); return; }
    if (!plein() || !garde()) return;
    e.preventDefault();
    noter(true);
    if (framed) parent.postMessage({ type: "yosuljin-fullscreen-toggle" }, location.origin);
    else document.exitFullscreen?.().catch(() => {});
  });

  // ---------- The stick under the thumb ----------
  marche.surStick((on, x, y, dx, dy) => {
    stick.classList.toggle("is-on", on);
    if (on) { stick.style.transform = `translate3d(${x.toFixed(0)}px,${y.toFixed(0)}px,0)`; stick.firstElementChild.style.transform = `translate3d(${dx.toFixed(0)}px,${dy.toFixed(0)}px,0)`; }
  });

  // ---------- The entrance; back in the museum, no entrance ----------
  function entrer(accueil) {
    commence = true;
    entree.hidden = true;
    // The chips and the plan were behind the card (inert in the page, musee.html): the keyboard reaches them now, after the scene.
    hud.inert = false;
    scene.tabIndex = -1;
    scene.focus({ preventScroll: true });
    main.classList.add("est-entre");
    marche.actif = true;
    garderEchap();
    if (accueil) {
      if (!tactile()) marche.verrouiller();
      almas.dire("bienvenue");
      almas.dire("commandes", { ensuite: true });
    } else almas.dire("retour");
    noter(true);
    wake(); boucle();
  }
  // The button answers only once it can: its listener is on, so no press is lost (musee.html holds it grey until now).
  const entrerBouton = $("[data-entrer]");
  entrerBouton.addEventListener("click", () => entrer(true));
  entrerBouton.textContent = "ENTRER DANS LE MUSÉE";
  entrerBouton.disabled = false;
  const pret = $("[data-pret]");
  if (pret) pret.textContent = "Le musée est prêt.";   // the button changing from grey to active says nothing by itself
  marche.actif = false;

  // ---------- Each frame ----------
  let rest = 0;
  const CAMERA = new Event("yosuljin:camera"), vue = { x: NaN, z: NaN, yaw: NaN, pitch: NaN };
  function frame(now) {
    if (mort) return false;
    if (plan.open || vitrine.open || document.visibilityState === "hidden" || debout.matches) { last = 0; return false; }
    // Deep rest (js/core/idle.js): the museum sleeps until the next gesture, unless AlmaS is speaking or the eye moves.
    if (rest > 1 && !almas.pos.parle && !anim && !redessin) { last = 0; return false; }
    if (devicePixelRatio !== densiteVue) { densiteVue = devicePixelRatio; size(); }
    const t = now / 1000, dt = last ? Math.min(0.05, t - last) : 1 / 60;
    last = t;
    const bouge = marche.avancer(dt);
    const j = marche.joueur;
    // The room one is in: its name in its corner, its address, AlmaS's word the first time.
    const s = salleEn(j.x, j.z);
    if (s && s.id !== salle) {
      // Out of Écriture with the book in hand: AlmaS puts it back on its shelf.
      if (salle === "ecriture" && livre === "main") { livre = "etagere"; almas.dire("range", { ensuite: true }); }
      salle = s.id;
      setRoom(salle);
      ici.textContent = s.nom.toUpperCase();
      main.querySelectorAll("[data-aller]").forEach(b => b.classList.toggle("is-ici", b.dataset.aller === salle));
      main.querySelectorAll(".musee-puce").forEach(b => { if (b.dataset.aller === salle) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current"); });
      puceEnVue();
      noter(true);
    }
    // A room's words wait their turn; if the visitor has left it by then, they are kept for the next time.
    if (commence && salle && !vues.has(salle)) {
      const id = salle;
      vues.add(id);
      almas.dire(id, { ensuite: true, si: () => salle === id, sinon: () => vues.delete(id) });
    }
    if (bouge && commence) noter();
    // What is within reach: one button, a key on a keyboard.
    const p = commence && !anim ? aPortee(j) : null, v = p ? verbe(p.o) : "", k = p ? `${p.o.id}:${v}` : "";
    if (k !== cle) {
      cle = k; proche = p;
      action.hidden = !p;
      if (p) action.innerHTML = `<span class="musee-touche" aria-hidden="true">${tactile() ? "" : "E"}</span><span>${v}</span><b>${p.o.nom}</b>`;
    }
    route = almas.avancer(dt, j);
    const cam = anim ? poseAnim(now) : marche.camera();
    // The butterfly cursor beats its wings while the camera moves (js/ui/papillon.js): more than 1 mm or 0.0001 rad since
    // the last frame; the walk's slow tail (the speed fades out, never exactly zero) is not a move.
    if (Math.abs(cam.x - vue.x) + Math.abs(cam.z - vue.z) > 1e-3 || Math.abs(cam.yaw - vue.yaw) + Math.abs(cam.pitch - vue.pitch) > 1e-4) dispatchEvent(CAMERA);
    vue.x = cam.x; vue.z = cam.z; vue.yaw = cam.yaw; vue.pitch = cam.pitch;
    rendu.frame(cam, { t, almas: almas.pos, chemin: route, livre, visiteur: { x: j.x, z: j.z, yaw: j.yaw }, calme: false });
    // The sound hears the camera once the 3D is drawn.
    entendre(cam, now, commence && !anim && marche.actif, !!almas.voix && almas.pos.parle);
    images++;
    redessin = false;
    if (now - place > 200) { place = now; plans.forEach(pl => pl.joueur(j, almas.pos, route)); }
    return true;
  }
  function boucle() { if (!stop && !mort) stop = every(now => { const r = frame(now); if (!r) { stop?.(); stop = null; } return r; }); }
  // Local QA only (127.0.0.1): where the visitor is, a jump, what is within reach, the frames drawn.
  let images = 0;
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__YOSULJIN_MUSEE_QA = {
    ou: () => ({ ...marche.joueur, salle, proche: proche?.o.nom || null, verbe: proche ? verbe(proche.o) : null, almas: { ...almas.pos }, guide: !!almas.guide,
      voix: almas.voix?.name || null, images, verrouille: marche.verrouille, commence, livre, anim: !!anim, assis: !!assis }),
    aller: (x, z, cap = 0) => { marche.teleporter(x, z, cap); boucle(); },
    agir,
  };
  if (avant?.entre) entrer(false);
  // Back from a page of the site, the museum as it was left (the browser kept it): AlmaS greets the return too.
  addEventListener("pageshow", e => { if (e.persisted && commence) { almas.dire("retour"); garderEchap(); wake(); boucle(); } });
  boucle();
  addEventListener("yosuljin:idle", e => { rest = e.detail?.level | 0; if (!rest) boucle(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") boucle(); else noter(true); });
  addEventListener("keydown", () => boucle());
  scene.addEventListener("pointerdown", () => boucle());
}

// ---------- The plan: the building seen from above, in SVG; the visitor and AlmaS on it ----------
const NS = "http://www.w3.org/2000/svg";
function dessinerPlan(svg) {
  const el = (tag, attrs, parent = svg) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.append(e); return e; };
  svg.setAttribute("viewBox", "-18 -23 36 37");
  for (const s of SALLES) {
    const r = el("rect", { x: s.x0, y: s.z0, width: s.x1 - s.x0, height: s.z1 - s.z0, class: "plan-salle", "data-salle": s.id });
    r.style.setProperty("--teinte", `var(${s.teinte})`);
    const t = el("text", { x: (s.x0 + s.x1) / 2, y: (s.z0 + s.z1) / 2, class: "plan-nom" });
    t.textContent = s.court || (s.id === "hall" ? "HALL" : s.nom.toUpperCase());
    t.style.setProperty("--teinte", `var(${s.teinte})`);
  }
  for (const o of OEUVRES) {
    const c = el("circle", { cx: o.x, cy: o.z, r: o.type === "carte" ? 1.3 : o.type === "maquette" ? 1.0 : o.type === "cadre" ? 0.3 : 0.42, class: `plan-oeuvre ${o.type}` });
    c.style.setProperty("--teinte", `var(${SALLES.find(s => s.id === o.salle).teinte})`);
  }
  const route = el("polyline", { class: "plan-route", points: "" });
  const almas = el("circle", { r: 0.5, class: "plan-almas" });
  const moi = el("path", { d: "M0 -1.1 L0.75 0.8 L0 0.35 L-0.75 0.8 Z", class: "plan-moi" });
  return {
    joueur(j, a, chemin) {
      moi.setAttribute("transform", `translate(${j.x.toFixed(2)} ${j.z.toFixed(2)}) rotate(${(-j.yaw * 180 / Math.PI).toFixed(1)})`);
      almas.setAttribute("cx", a.x.toFixed(2)); almas.setAttribute("cy", a.z.toFixed(2));
      route.setAttribute("points", chemin ? chemin.map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ") : "");
    },
  };
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", demarrer, { once: true }); else demarrer();
