export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Sets a style property only when its serialised value changed (saves style recalcs). */
export function setStyle(el, prop, value) {
  const cache = el.__styleCache || (el.__styleCache = Object.create(null));
  if (cache[prop] === value) return;
  cache[prop] = value;
  if (prop.startsWith("--")) el.style.setProperty(prop, value);
  else el.style[prop] = value;
}
