// Scene data: Furu, how Lumina senses her body (D105, D127, D147) — a glass that holds four quantities, one per regime.
// What the scene says (names, regimes, legends) is in aether.html; this is only how it is drawn and heard.
// Units: the scene's own, the glass has radius 1.3; `label` is where a part's button sits, from its centre.
export default {
  seed: 105,
  camera: { distance: 5.7, fov: 34, pitch: 0.2, spin: 0.09, yaw: 0.35 },
  parts: [
    // Measured: a probe reads it — light goes out to the edge of the body and comes back with the value.
    { id: "libre", kind: "core", at: [-0.76, 0, 0.1], radius: 0.14, color: "--acc-dev", backColor: "--sakura", reach: 5, beyond: 1.32, note: 587.33, label: [0, 0.3, 0] },
    // Declared: said by the machine's configuration, never read — a steady ring, nothing goes out to check it.
    { id: "totale", kind: "plate", at: [0.8, 0.1, -0.05], radius: 0.17, color: "--sakura", note: 698.46, label: [0, 0.34, 0] },
    // Inferred: drawn from the two above and never read itself — touched, a light comes from each of its sources.
    { id: "utilisee", kind: "link", at: [0.12, -0.62, 0.2], radius: 0.1, from: ["libre", "totale"], color: "--acc-photo", note: 880, label: [0, -0.3, 0] },
    // Unknown: no instrument measures it yet — loose points that lean toward a shape and never hold one.
    { id: "vibrations", kind: "cloud", at: [-0.42, 0.58, -0.15], radius: 0.36, color: "--acc-worlds", points: 260, hold: 0.55, form: { ring: 0.26, tilt: 1.1 }, note: 493.88, label: [0, 0.46, 0] },
    // furu itself: the body these quantities belong to, the glass around them.
    { id: "furu", kind: "shell", at: [0, 0, 0], radius: 1.3, color: "--acc-aether", note: 523.25, label: [0, -1.46, 0] },
  ],
};
