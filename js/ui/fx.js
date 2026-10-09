// Shared Yosuljin visual effects: quiet frames on the cards (styles.css, FX PACK).
let initialized = false;

export function initSpatialFX(){
  if(initialized) return;
  initialized=true;
  document.documentElement.classList.add('fx-ready');
}
