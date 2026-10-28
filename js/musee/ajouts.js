// The list of the museum's drawing additions: the ONE place where a module that draws is plugged in
// (musee.js loads this list, rendu.js is never reopened for an effect). Pure data: no DOM, no GL.
//
// An entry: { nom, palier, charger }
//   nom      the name of the effect.
//   palier   0, 1 or 2: the lowest tier that loads it (0 = every device: the museum of today; 1 and 2: a later file,
//            paliers.js, will set the thresholds). The tier is chosen once, at the start; a lower tier never loads what asks for more.
//   charger  a function that returns the dynamic import of the module, written with the ?v= token of the museum's
//            other imports (verifier.py checks it); the module is loaded only when the entry is wanted.
// The module exports { greffon }:
//   greffon         { nom, init(gl, api) → instance, avant?(cam, etat, instance), apres?(cam, etat, instance),
//                   liberer?(gl, instance) }: code that draws, before the floors and after everything else.
//                   api = { hauteur, palier, qa, reglages } (see rendu.js). No builder here: nothing adds to the geometry.
//                   What a graft leaves behind it: nothing it needs to find again. The drawing puts back, after each call
//                   (init too, and also a call that threw), the screen's framebuffer (0) and viewport, no vertex array (null),
//                   texture unit 0, every vertex attribute off, no scissor, the colour mask open (all four), no face culling,
//                   depth function LESS, depth test on, blend equation ADD, then depth and blend as the stage asks; a graft
//                   that draws off screen binds its own framebuffer and lets go of it (bindFramebuffer(..., null)) itself.
//                   What is NOT put back, and is the graft's to leave as it found it: the textures bound on the units (each
//                   draw binds its own), the current program, the bound element-array buffer, the stencil, polygon
//                   offset, the front face, the pixel-store settings (pixelStorei). A graft that closes a pass with a state of its own (say
//                   colorMask(false) for a depth-only pass) puts it back in the same call.
//                   A graft cut for a fault has its liberer(gl, instance) called once at once (init got through), so what it
//                   allocated is given back; a liberer that throws is only warned of. An init that fails has no instance to
//                   give back: it undoes by itself what it allocated (textures, buffers, framebuffers) before it throws.
//                   An entry that cannot be used (no name, no init, a name already taken) is left out with one warning.
// Whatever fails (an import, a graft) leaves out that entry alone; the museum is the one of the lower tier.
// Entries run in this order, whatever order the imports finish in.
export const AJOUTS = [];
