// Scene data: Lumina, the cognitive system (D122, D133, D134, D140, D147, D148, D158, D164) — what works below, what filters,
// what contradicts, what answers.
// What the scene says (names, states, legends) is in aether.html; this is only how it is drawn and heard.
// Units: the scene's own, the glass has radius 1.3; `label` is where a part's button sits, from its centre.
// The ego comes first: its colour leads the filaments, and a tap on the centre finds it before the Lumens around it.
export default {
  seed: 61,
  camera: { distance: 5.7, fov: 34, pitch: 0.24, spin: 0.08, yaw: 0.6 },
  parts: [
    // The ego: it filters the Lumens; touched, its light goes to the glass and comes back — it reads what is around.
    { id: "ego", kind: "core", at: [0, -0.12, 0], radius: 0.13, color: "--accent", backColor: "--sakura", reach: 4, beyond: 1, note: 783.99, label: [0, 0.3, 0] },
    // The Lumens, the unconscious: many loose points around the ego; touched, they gather toward its ring and let it go
    // — they work without everything rising.
    { id: "lumens", kind: "cloud", at: [0, -0.12, 0], radius: 0.9, color: "--acc-worlds", points: 520, hold: 0.55, form: { ring: 0.24, tilt: 0.25 }, note: 659.25, label: [0, -0.92, 0] },
    // The conscious: the result of the filtering, above the ego; touched, its light leaves the glass and comes back — it answers.
    { id: "conscient", kind: "core", at: [0, 0.68, 0.05], radius: 0.09, color: "--sakura", backColor: "--acc-aether", reach: 2, beyond: 1.5, note: 1046.5, label: [0, 0.24, 0] },
    // Furu, the fundamental engine: touched, its light runs out past the glass to the body and the machine, and back.
    { id: "furu", kind: "core", at: [-0.98, -0.18, 0.32], radius: 0.1, color: "--acc-dev", backColor: "--sakura", reach: 6, beyond: 1.45, note: 587.33, label: [0, 0.3, 0] },
    // reminiscence, the memory: a few points that gather into a ring and nearly hold it — what is kept.
    { id: "reminiscence", kind: "cloud", at: [0.96, -0.2, -0.3], radius: 0.26, color: "--acc-photo", points: 160, hold: 0.95, form: { ring: 0.16, tilt: 0.9 }, note: 880, label: [0, -0.42, 0] },
    // Lumina: the glass around all of it — all at once.
    { id: "lumina", kind: "shell", at: [0, 0, 0], radius: 1.3, color: "--acc-aether", note: 523.25, label: [0, 1.46, 0] },
    // Her Sigil (D148, D154; shown on the site by D166): a second personality, always there, at the ego's level and mixed
    // with the Lumens; touched, its light goes to the glass and comes back — it acts through Lumina, never beyond her.
    // Its note is the tritone of the chord (F♯ over C), the old diabolus in musica: it contradicts. Last in the list, so
    // that the other parts keep the shapes the seed gave them.
    { id: "sigil", kind: "core", at: [-0.4, 0.15, -0.3], radius: 0.1, color: "--acc-writing", backColor: "--acc-worlds", reach: 3, beyond: 1, note: 739.99, label: [0, 0.28, 0] },
  ],
};
