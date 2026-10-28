// AlmaS, the museum's guide (D168 b 4): she welcomes the visitor at the entrance, presents each room, follows the
// visitor — a light that floats beside them — and shows the way. She speaks Mandarin: heard through the browser's
// voice (zh-CN), read in simplified characters, subtitled in English; with no such voice on the device, or the site's
// sound off, the writing alone. What she says is in batiment.js (PAROLES).
import { PAROLES, PORTES, salleEn } from "./batiment.js?v=20261025-r28";
import { isEnabled, onSoundChange } from "../ui/sound.js?v=20261025-r28";

const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
const tactile = () => matchMedia("(pointer: coarse)").matches;

/** The voice she speaks with: a Mandarin voice of mainland China first, any Mandarin one after; never Cantonese. */
function voixChinoise() {
  if (!synth) return null;
  const v = synth.getVoices().filter(x => /^zh/i.test(x.lang) && !/HK|yue/i.test(x.lang));
  return v.find(x => /zh[-_]CN/i.test(x.lang) && /Xiaoxiao|Huihui|Tingting|Yaoyao|普通话|Mandarin/i.test(x.name))
    || v.find(x => /zh[-_]CN/i.test(x.lang)) || v[0] || null;
}

export function createAlmas({ soustitres, zh, en, annonce }) {
  const pos = { x: 0, y: 1.75, z: 7.6, parle: false };
  let voix = voixChinoise(), file = [], courante = null, minuterie = 0, guide = null, jeton = 0;
  if (synth) synth.addEventListener?.("voiceschanged", () => { voix = voixChinoise(); });
  onSoundChange(on => { if (!on) synth?.cancel(); });

  function montrer(ligne) {
    zh.textContent = ligne.zh; en.textContent = ligne.en;
    // The subtitles are not a live region (they come and go with `hidden`): the English line is read from this one, always there.
    if (annonce) annonce.textContent = ligne.en;
    soustitres.hidden = false;
    soustitres.classList.remove("is-out");
  }
  function cacher() {
    if (annonce) annonce.textContent = "";
    soustitres.classList.add("is-out");
    clearTimeout(minuterie);
    minuterie = setTimeout(() => { if (!courante) soustitres.hidden = true; }, 400);
  }
  function suivante() {
    // A line that no longer fits (a room's words, the visitor gone from it) is let go, and told so.
    while (file.length && file[0].si && !file[0].si()) file.shift().sinon?.();
    courante = file.shift() || null;
    pos.parle = !!courante;
    if (!courante) { cacher(); return; }
    clearTimeout(minuterie);
    montrer(courante);
    // The writing stays as long as she speaks, or as long as it takes to read it.
    const lire = Math.max(2600, courante.en.length * 62);
    // Each line has its token: a callback of a line that has been replaced (cancel() ends or fails the old utterance
    // after the new one began) must not shorten the new line.
    const mon = ++jeton;
    let fini = false;
    const done = () => { if (fini || mon !== jeton) return; fini = true; minuterie = setTimeout(suivante, 450); };
    if (synth && voix && isEnabled()) {
      const u = new SpeechSynthesisUtterance(courante.zh);
      u.lang = voix.lang; u.voice = voix; u.rate = 0.98; u.pitch = 1.08;
      u.onend = done; u.onerror = () => setTimeout(done, lire);
      synth.speak(u);
      // A voice that never starts (a refused one) does not hold the writing back.
      setTimeout(() => { if (mon === jeton && !synth.speaking && !fini) setTimeout(done, lire); }, 1200);
    } else minuterie = setTimeout(done, lire);
  }

  /**
   * Says a line of PAROLES (its touch-screen version on a touch screen). `ensuite` queues it after the current one;
   * `si`, asked when its turn comes, says whether it still fits — if not, it is let go and `sinon` called.
   */
  function dire(cle, { ensuite = false, si = null, sinon = null } = {}) {
    const p = PAROLES[cle];
    if (!p) return;
    const ligne = tactile() && p.tactile ? p.tactile : p;
    if (!ensuite) { file.forEach(l => l.sinon?.()); file = []; jeton++; synth?.cancel(); clearTimeout(minuterie); courante = null; }
    file.push({ zh: ligne.zh, en: ligne.en, cle, si, sinon });
    if (!courante) suivante();
  }
  function taire() { file.forEach(l => l.sinon?.()); file = []; jeton++; synth?.cancel(); clearTimeout(minuterie); courante = null; pos.parle = false; cacher(); }

  /**
   * The way from (x, z) to a point of a room: straight within a room; otherwise out through this room's door into the
   * hall, then in through the other's (every room opens on the hall). Returns [[x, z], …].
   */
  function chemin(x, z, cible) {
    const ici = salleEn(x, z)?.id, route = [[x, z]];
    if (ici && ici !== cible.salle) {
      const sortie = PORTES.find(p => p.vers === ici), entree = PORTES.find(p => p.vers === cible.salle);
      if (sortie) route.push(sortie.salle, sortie.hall);
      if (entree) route.push(entree.hall, entree.salle);
    }
    route.push([cible.x, cible.z]);
    return route;
  }

  /** Leads the visitor to a point: the way is drawn, she goes ahead on it; `arrivee` is called on arrival. */
  function mener(cible, arrivee) { guide = { cible, arrivee }; dire("suivre"); }
  function lacher() { guide = null; }

  const lisse = (a, b, dt, k) => a + (b - a) * (1 - Math.exp(-dt * k));
  /** Moves her: beside the visitor, a step ahead to their right; ahead of them on the way when she leads. */
  function avancer(dt, j) {
    let tx, tz, ty = 1.75;
    const fx = -Math.sin(j.yaw), fz = -Math.cos(j.yaw), rx = Math.cos(j.yaw), rz = -Math.sin(j.yaw);
    let route = null;
    if (guide) {
      route = chemin(j.x, j.z, guide.cible);
      const reste = route.reduce((s, p, i) => i ? s + Math.hypot(p[0] - route[i - 1][0], p[1] - route[i - 1][1]) : 0, 0);
      if (reste < 1.4) {
        const a = guide.arrivee; guide = null; route = null;
        dire("arrive");
        a?.();
      } else {
        // Two metres along the way, at the height of the eyes.
        let s = Math.min(2.2, reste), i = 1;
        let p = route[0];
        while (i < route.length) {
          const q = route[i], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (s <= L) { tx = p[0] + (q[0] - p[0]) * s / L; tz = p[1] + (q[1] - p[1]) * s / L; break; }
          s -= L; p = q; i++;
        }
        if (tx === undefined) { tx = route.at(-1)[0]; tz = route.at(-1)[1]; }
        ty = 1.55;
      }
    }
    if (tx === undefined) { tx = j.x + fx * 1.25 + rx * 0.85; tz = j.z + fz * 1.25 + rz * 0.85; }
    pos.x = lisse(pos.x, tx, dt, guide ? 3.2 : 2.2); pos.z = lisse(pos.z, tz, dt, guide ? 3.2 : 2.2); pos.y = lisse(pos.y, ty, dt, 2);
    return route;
  }

  return { pos, dire, taire, mener, lacher, avancer, chemin, get guide() { return guide; }, get voix() { return voix; } };
}
