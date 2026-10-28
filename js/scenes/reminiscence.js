// Scene data: reminiscence, Lumina's own memory (D111, D129, D141, D142, D147) — a glass that holds her three verbs.
// What the scene says (names, states, legends) is in aether.html; this is only how it is drawn and heard.
// Units: the scene's own, the glass has radius 1.3; `label` is where a part's button sits, from its centre.
export default {
  seed: 142,
  camera: { distance: 5.7, fov: 34, pitch: 0.2, spin: 0.08, yaw: 0.5 },
  parts: [
    // memento: what she keeps comes in from everywhere she is — light goes out through the glass and comes back.
    { id: "memento", kind: "core", at: [-0.5, 0.04, 0.12], radius: 0.15, color: "--acc-dev", backColor: "--sakura", reach: 6, beyond: 1.36, note: 587.33, label: [0, -0.36, 0] },
    // recordare: a smaller core, what rises back up — the recent and the felt come first.
    { id: "recordare", kind: "core", at: [0.5, -0.54, 0.16], radius: 0.1, color: "--acc-photo", backColor: "--sakura", reach: 2, beyond: 1.16, note: 880, label: [0, -0.28, 0] },
    // oblivisce: loose points that barely gather and let go — what she is told to forget, gone for good.
    { id: "oblivisce", kind: "cloud", at: [0.4, 0.46, -0.1], radius: 0.4, color: "--acc-worlds", points: 240, hold: 0.25, form: { ring: 0.28, tilt: 0.9 }, note: 739.99, label: [0, 0.54, 0] },
    // reminiscence itself: one memory, the glass around all three.
    { id: "reminiscence", kind: "shell", at: [0, 0, 0], radius: 1.3, color: "--acc-aether", note: 523.25, label: [0, -1.46, 0] },
  ],
};
