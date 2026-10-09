// The index: a CRT overlay. A brief ignition opens it (a line, then two lids) and a power-off closes it. One line is
// lit, the current page's or the one being read, and only a lit line shows its Chinese word; a butterfly, the guide,
// rests on the current page's line and flies only when a line is chosen.
import { $, $$ } from "../core/dom.js?v=20261007-r7";
import { reducedMotion, getMode } from "../core/prefs.js?v=20261008-r9";
import { sfx } from "./sound.js?v=20261009-r2";

const ZH = { dev: "開發", photo: "攝影", writing: "寫作", worlds: "世界" };
// The sprite by this module's own address: the 404 page is served at any depth, where a path relative to the
// page would miss it.
const SPRITE = new URL("../../motifs.svg", import.meta.url).pathname;
const svg = (cls, box, id) => `<svg class="${cls}" viewBox="${box}" aria-hidden="true"><use href="${SPRITE}#${id}"/></svg>`;

/** The Chinese word of a line, beside its number: its own element, in its own language, hidden from assistive
 *  technology (the number keeps the page's language). */
function withWord(number, word) {
  const holder = document.createElement("span");
  holder.className = "menu-num";
  number.replaceWith(holder);
  const zh = document.createElement("span");
  zh.className = "menu-zh";
  zh.lang = "zh-Hant";
  zh.setAttribute("aria-hidden", "true");
  zh.textContent = word;
  holder.append(number, zh);
}

// Decorative parts of the menu (styles.css, 05), built once and hidden from assistive technology: the tube cover of
// the ignition (the links never move under it) and its still veil, the dossier's golden node, the guide (two
// wings hinged on a body), and the Chinese words of the lines.
function dress(menu) {
  if ($(".menu-tube", menu)) return;
  const tube = document.createElement("div");
  tube.className = "menu-tube";
  tube.setAttribute("aria-hidden", "true");
  tube.innerHTML = '<i class="menu-tube-scan"></i><i class="menu-tube-lid top"></i><i class="menu-tube-lid bottom"></i><i class="menu-tube-line"></i>';
  menu.append(tube);
  for (const a of $$(".menu-domains a[data-accent]", menu)) {
    const number = $("small", a);
    if (number && ZH[a.dataset.accent]) withWord(number, ZH[a.dataset.accent]);
  }
  const dossier = $(".menu-project-main small", menu);
  if (dossier) withWord(dossier, "以太");
  const node = $(".menu-aether-sigil", menu);
  if (node) node.innerHTML = svg("menu-node", "0 0 24 24", "node-projet");
  const stage = $(".menu-structure", menu);
  if (stage) {
    const guide = document.createElement("span");
    guide.className = "menu-guide";
    guide.setAttribute("aria-hidden", "true");
    guide.innerHTML = svg("bf-wing bf-l", "0 0 60 100", "butterfly-wing-l") + svg("bf-wing bf-r", "0 0 60 100", "butterfly-wing-r") + svg("bf-body", "0 0 120 100", "butterfly-body");
    stage.append(guide);
  }
}

/** The current page's line is lit (and announced as the current page); the index and the pages outside the
 *  channels have none. */
function markCurrent(menu) {
  const path = href => { try { return new URL(href, location.href).pathname.replace(/index\.html$/, ""); } catch { return ""; } };
  const here = location.pathname.replace(/index\.html$/, "");
  for (const a of $$(".menu-domains a[href], .menu-project-main[href]", menu)) {
    const current = path(a.getAttribute("href")) === here;
    a.classList.toggle("is-lit", current);
    if (current) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
}

/** The guide perches on the top of the last letter of a line's name. It rests on the current page's line (on the
 *  dossier elsewhere) and never follows the pointer: it flies only when a line is chosen (click, tap or Enter),
 *  in 400 ms, while the next page loads. Without motion (reduced motion, LITE) it stays where it is. */
function guide(menu) {
  const fly = $(".menu-guide", menu), stage = $(".menu-structure", menu);
  const lines = [...$$(".menu-domains a[data-accent]", menu), ...$$(".menu-project-main", menu)];
  if (!fly || !stage || !lines.length) return { home() {} };
  const homeLine = () => lines.find(a => a.classList.contains("is-lit")) || $(".menu-project-main", menu) || lines[0];
  const place = a => {
    const name = $("b", a) || a;
    const s = stage.getBoundingClientRect(), r = name.getBoundingClientRect();
    if (!r.width) return false;
    fly.style.setProperty("--gx", (r.right - s.left - fly.offsetWidth * 0.45).toFixed(1) + "px");
    fly.style.setProperty("--gy", (r.top - s.top - fly.offsetHeight * 0.62).toFixed(1) + "px");
    return true;
  };
  const home = () => {
    // A jump, without transition (two frames, so the style is computed with the class on).
    fly.classList.add("no-flight");
    fly.classList.remove("is-flying");
    if (place(homeLine())) fly.classList.add("is-placed");
    requestAnimationFrame(() => requestAnimationFrame(() => fly.classList.remove("no-flight")));
  };
  for (const a of lines) {
    a.addEventListener("click", e => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // opened elsewhere: this page stays
      // The chosen line's name becomes the afterimage of the page being left (portal.js).
      a.classList.add("is-chosen");
      if (a.classList.contains("is-lit") || reducedMotion.matches || getMode() === "lite") return;
      if (place(a)) fly.classList.add("is-flying");
    });
  }
  return { home };
}

export function initMenu({ onToggle } = {}) {
  const menu = $(".site-menu");
  const toggle = $(".menu-toggle");
  const word = $(".menu-word");
  if (!menu || !toggle) return { isOpen: () => false, close() {} };
  const root = document.documentElement;
  dress(menu);
  markCurrent(menu);
  const guideBird = guide(menu);
  let open = menu.classList.contains("open") && toggle.getAttribute("aria-expanded") === "true";
  let lastFocus = null, timer = 0;
  // Ignition (the tube's cover, .5 s): decoration only.
  const ignite = () => {
    if (reducedMotion.matches) return;
    menu.classList.add("menu-ignition");
    timer = setTimeout(() => menu.classList.remove("menu-ignition"), 520);
  };
  const focusables = () => $$("a[href], button", menu).filter(el => el.offsetParent !== null);

  const setOpenState = value => {
    open = value;
    menu.toggleAttribute("inert", !value);
    menu.setAttribute("aria-hidden", String(!value));
    // The open menu covers the whole screen: the page under it (and the index's footer, outside <main>) leaves the
    // accessibility tree too. Under the immersive frame (immersive-nav.js) it stays out when the menu closes.
    const covered = root.classList.contains("immersive-nav");
    for (const el of document.querySelectorAll("main, body > .site-footer")) el.toggleAttribute("inert", value || covered);
    toggle.setAttribute("aria-expanded", String(value));
    if (word) word.textContent = value ? "FERMER" : "MENU";
    root.classList.toggle("menu-open", value);
    onToggle?.(value);
  };

  function show() {
    if (open) return;
    lastFocus = document.activeElement;
    clearTimeout(timer);
    menu.classList.remove("menu-poweroff");
    menu.classList.add("open");
    // The ignition only covers links that are already in place: they take clicks from the first frame.
    ignite();
    setOpenState(true);
    // Paint the menu first; the synthesized ignition sound can build Web Audio lazily.
    requestAnimationFrame(() => { guideBird.home(); sfx("ignite"); });
    setTimeout(() => focusables()[0]?.focus({ preventScroll: true }), reducedMotion.matches ? 0 : 140);
  }
  function hide({ restoreFocus = true } = {}) {
    if (!open) return;
    clearTimeout(timer);
    menu.classList.remove("menu-ignition");
    setOpenState(false);
    sfx("poweroff");
    if (reducedMotion.matches) menu.classList.remove("open");
    else {
      menu.classList.add("menu-poweroff");
      timer = setTimeout(() => menu.classList.remove("open", "menu-poweroff"), 380);
    }
    if (restoreFocus) (lastFocus && document.contains(lastFocus) ? lastFocus : toggle).focus?.({ preventScroll: true });
    lastFocus = null;
  }

  setOpenState(open);
  window.__yosuljinMenuReady = true;
  if (open) { ignite(); requestAnimationFrame(() => guideBird.home()); }
  // The names' widths change when the display font arrives, and with the window.
  document.fonts?.ready.then(() => { if (open) guideBird.home(); });
  addEventListener("resize", () => { if (open) guideBird.home(); }, { passive: true });
  // Back from the history (bfcache): the guide is home again.
  addEventListener("pageshow", e => { if (e.persisted && open) guideBird.home(); });
  toggle.addEventListener("click", () => (open ? hide() : show()));
  $(".menu-shade")?.addEventListener("click", () => hide());
  document.addEventListener("keydown", e => {
    if (!open) return;
    if (e.key === "Escape") { e.preventDefault(); hide(); return; }
    if (e.key === "Tab") {
      // Keep keyboard focus inside the open menu (the toggle stays reachable to close it).
      const items = [toggle, ...focusables()];
      const i = items.indexOf(document.activeElement);
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === items.length - 1 ? 0 : i + 1);
      e.preventDefault();
      items[next].focus();
    }
  });
  // A link closes the menu behind it. When it opens elsewhere (a new tab or window, a download), this page stays:
  // the focus goes back to the toggle instead of falling to <body>.
  menu.addEventListener("click", e => {
    const a = e.target.closest("a[href]");
    if (!a) return;
    const stays = a.target === "_blank" || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey;
    setTimeout(() => hide({ restoreFocus: stays }), 500);
  });
  return { isOpen: () => open, close: hide, open: show };
}
