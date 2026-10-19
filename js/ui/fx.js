// Shared Yosuljin visual effects: quiet frames on the cards (styles.css, FX PACK), and the sound of the world's
// channel locking when the camera settles on a world of the index (world.js lock(): one soft band, a dry press).
import { sfx } from './sound.js?v=20261019-r1';
let initialized = false;

export function initSpatialFX(){
  if(initialized) return;
  initialized=true;
  document.documentElement.classList.add('fx-ready');
  // The event bubbles from the world's canvas, as world-gate does for sound.js; only the index sends it (a domain
  // page's lock closes the channel's own sound, portal.js; waking from a rest is silent).
  document.addEventListener('world-arrive', () => sfx('press'));
}
