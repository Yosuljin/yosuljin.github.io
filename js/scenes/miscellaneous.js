// Scene data: Miscellaneous, the web layer (D141, D147) — a glass that holds Net and Lara.
// What the scene says (names, states, legends) is in aether.html; this is only how it is drawn and heard.
// Units: the scene's own, the glass has radius 1.3; `label` is where a part's button sits, from its centre.
export default {
  seed: 47,
  camera: { distance: 5.7, fov: 34, pitch: 0.24, spin: 0.1, yaw: 0.6 },
  parts: [
    // Net: what lets AlmaS work online — a lit core whose light goes out through the glass and comes back.
    { id: "net", kind: "core", at: [-0.44, -0.08, 0.16], radius: 0.15, color: "--acc-dev", backColor: "--sakura", reach: 7, beyond: 1.42, note: 659.25, label: [0, -0.36, 0] },
    // Lara: in design — loose points that gather toward a lens and let it go, never holding it.
    { id: "lara", kind: "cloud", at: [0.5, 0.2, -0.1], radius: 0.42, color: "--acc-worlds", points: 320, hold: 0.82, form: { ring: 0.3, tilt: 0.6 }, note: 783.99, label: [0, 0.58, 0] },
    // Miscellaneous: the layer itself, the glass around both.
    { id: "miscellaneous", kind: "shell", at: [0, 0, 0], radius: 1.3, color: "--acc-aether", note: 523.25, label: [0, 1.46, 0] },
  ],
};
