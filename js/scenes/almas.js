// Scene data: AlmaS, Lumina's first agent (D115, D123, D126, D147) — a glass that holds her team, her furu and her unconscious.
// What the scene says (names, states, legends) is in aether.html; this is only how it is drawn and heard.
// Units: the scene's own, the glass has radius 1.3; `label` is where a part's button sits, from its centre.
export default {
  seed: 115,
  camera: { distance: 5.7, fov: 34, pitch: 0.22, spin: 0.1, yaw: -0.4 },
  parts: [
    // The team of a mission: five roles, five lights that go out through the glass and come back with a report.
    { id: "equipe", kind: "core", at: [-0.5, -0.12, 0.14], radius: 0.15, color: "--acc-dev", backColor: "--sakura", reach: 5, beyond: 1.4, note: 659.25, label: [0, -0.36, 0] },
    // Her furu: a smaller core whose light reaches her own edge, the body she reads before Lumina does.
    { id: "furu", kind: "core", at: [0.5, -0.56, 0.16], radius: 0.09, color: "--acc-photo", backColor: "--sakura", reach: 3, beyond: 1.18, note: 880, label: [0, -0.26, 0] },
    // Her unconscious: decided, not yet in code — loose points that lean toward a ring and let it go.
    { id: "inconscient", kind: "cloud", at: [0.38, 0.44, -0.12], radius: 0.42, color: "--acc-worlds", points: 300, hold: 0.5, form: { ring: 0.3, tilt: 0.8 }, note: 783.99, label: [0, 0.56, 0] },
    // AlmaS herself: the glass around all three.
    { id: "almas", kind: "shell", at: [0, 0, 0], radius: 1.3, color: "--acc-aether", note: 523.25, label: [0, -1.46, 0] },
  ],
};
