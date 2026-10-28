// Scene data: TheHive, the system surface where Lumina will live (D147) — a glass that holds its skeleton, its durability and the machine it aims at.
// What the scene says (names, states, legends) is in aether.html; this is only how it is drawn and heard.
// Units: the scene's own, the glass has radius 1.3; `label` is where a part's button sits, from its centre.
export default {
  seed: 104,
  camera: { distance: 5.7, fov: 34, pitch: 0.24, spin: 0.09, yaw: -0.2 },
  parts: [
    // The skeleton: kernel, drivers, modules — a lit core whose light reaches every edge of the surface.
    { id: "squelette", kind: "core", at: [-0.46, -0.06, 0.12], radius: 0.15, color: "--acc-dev", backColor: "--sakura", reach: 7, beyond: 1.38, note: 659.25, label: [0, 0.34, 0] },
    // Durability: a smaller core, the loss window read in the real mount and brought back.
    { id: "durabilite", kind: "core", at: [0.52, -0.52, 0.14], radius: 0.1, color: "--acc-photo", backColor: "--sakura", reach: 2, beyond: 1.16, note: 880, label: [0, -0.28, 0] },
    // The dedicated machine: aimed at, not there yet — loose points that lean toward a ring.
    { id: "machine", kind: "cloud", at: [0.4, 0.46, -0.12], radius: 0.4, color: "--acc-worlds", points: 260, hold: 0.6, form: { ring: 0.28, tilt: 0.7 }, note: 783.99, label: [0, 0.54, 0] },
    // TheHive itself: the surface, the glass around all three.
    { id: "thehive", kind: "shell", at: [0, 0, 0], radius: 1.3, color: "--acc-aether", note: 523.25, label: [0, -1.46, 0] },
  ],
};
