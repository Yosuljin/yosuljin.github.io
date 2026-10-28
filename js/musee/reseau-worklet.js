// The museum's delay network, sample by sample in Float64: the pure kernel AND the worklet processor in one file, no other module. Node runs the kernel (the bench).
// The same input always gives the same bits, whatever the block sizes: every line is read before any is written. The plan (reseau.js, faireplan) is a plain object.
// high-pass -> two all-pass stages -> N lines (linear read at a moving time, low-pass, loop gain) -> Householder mix -> two ears -> bass bridge.
// States under 1e-30 are set to zero where they are written (the worklet scope does not flush denormals).

export const NOM_PROCESSEUR = "reseau-retards";
const PLANCHER = 1e-30;

/** { b0, b1, b2, a1, a2 } of a Web Audio low-pass or high-pass (Q in dB), over a0; limit cases of the specification. */
export function biquad(type, f0, qDb, sr) {
  const nyq = sr / 2;
  if (type === "lowpass") { if (f0 >= nyq) return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }; if (f0 <= 0) return { b0: 0, b1: 0, b2: 0, a1: 0, a2: 0 }; }
  if (type === "highpass") { if (f0 >= nyq) return { b0: 0, b1: 0, b2: 0, a1: 0, a2: 0 }; if (f0 <= 0) return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }; }
  const w0 = 2 * Math.PI * f0 / sr, cs = Math.cos(w0), al = Math.sin(w0) / (2 * Math.pow(10, qDb / 20));
  const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
  const k = type === "lowpass" ? 1 - cs : 1 + cs, s = type === "lowpass" ? 1 : -1;
  return { b0: k / 2 / a0, b1: s * k / a0, b2: k / 2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

export class Noyau {
  constructor(plan) {
    if (!plan || !(plan.N >= 2) || !(plan.sr > 0) || plan.retards.length !== plan.N) throw new TypeError("plan : N, sr et un retard par ligne");
    const { N, sr } = plan;
    this.plan = plan; this.N = N; this.sr = sr; this.n = 0;
    const maxD = Math.max(...plan.retards) + Math.max(...plan.profondeurs.map(Math.abs)) + 8;
    this.taille = 1 << Math.ceil(Math.log2(maxD)); this.masque = this.taille - 1;
    this.anneaux = new Float64Array(N * this.taille);
    this.z = new Float64Array(N);
    this.ga = new Array(N).fill(null); this.gc = new Float64Array(N);
        this.lx1 = new Float64Array(N); this.lx2 = new Float64Array(N); this.ly1 = new Float64Array(N); this.ly2 = new Float64Array(N);
    this.fcCour = NaN; this._coefLP(plan.fc0);
    const h = biquad("highpass", plan.hpHz, plan.qDb, sr);
    this.hb0 = h.b0; this.hb1 = h.b1; this.hb2 = h.b2; this.ha1 = h.a1; this.ha2 = h.a2;
    this.pont = !!plan.pont; this.cpont = plan.pont ? plan.pont.c : 0;
    const p = plan.pont ? biquad("lowpass", plan.pont.fc, plan.qDb, sr) : { b0: 0, b1: 0, b2: 0, a1: 0, a2: 0 };
    this.pb0 = p.b0; this.pb1 = p.b1; this.pb2 = p.b2; this.pa1 = p.a1; this.pa2 = p.a2;
    this.dd = plan.diffuseurs.map(x => x.d); this.da = plan.diffuseurs.map(x => x.a);
    this.dw = plan.diffuseurs.map(x => new Float64Array(x.d)); this.dp = new Int32Array(plan.diffuseurs.length);
    this.retards = Float64Array.from(plan.retards); this.profondeurs = Float64Array.from(plan.profondeurs);
    this.ent = Float64Array.from(plan.entree); this.sor = Float64Array.from(plan.sortie);
    this.c0 = plan.echelle; this.mix = plan.mix;
    this.vider();
  }

  _coefLP(fc) {
    const c = biquad("lowpass", fc, this.plan.qDb, this.sr);
    this.lb0 = c.b0; this.lb1 = c.b1; this.lb2 = c.b2; this.la1 = c.a1; this.la2 = c.a2;   // one set for all the lines
    this.fcCour = fc;
  }

  /** Every state back to zero, phase included. */
  vider() {
    this.anneaux.fill(0); this.z.fill(0);
    this.lx1.fill(0); this.lx2.fill(0); this.ly1.fill(0); this.ly2.fill(0);
    for (const w of this.dw) w.fill(0);
    this.dp.fill(0);
    this.hx1 = this.hx2 = this.hy1 = this.hy2 = 0;
    this.px1 = this.px2 = this.py1 = this.py2 = 0; this.qx1 = this.qx2 = this.qy1 = this.qy2 = 0;
    this.n = 0;
  }

  /**
   * One block of T = gauche.length samples. `entree`: mono samples or null (silence: the network keeps running). `g`: N loop gains, each a number
   * (constant on the block) or an array of T numbers. `fc`: Hz, bounded here; the coefficients change at most once per block. gauche and droite are rewritten.
   */
  traiter(entree, gauche, droite, g, fc) {
    const { N, sr, plan, masque, taille, anneaux, z, ga, gc } = this;
    const T = gauche.length;
    const fb = fc < plan.fcMin ? plan.fcMin : fc > plan.fcMax ? plan.fcMax : fc;
    if (Math.abs(fb - this.fcCour) > 1e-3 * fb) this._coefLP(fb);
    let tous = true;
    for (let i = 0; i < N; i++) { const v = g[i]; if (typeof v === "number") { ga[i] = null; gc[i] = v; } else { ga[i] = v; tous = false; } }
    const lb0 = this.lb0, lb1 = this.lb1, lb2 = this.lb2, la1 = this.la1, la2 = this.la2;
    const { lx1, lx2, ly1, ly2 } = this;
    const { retards, profondeurs, ent, sor } = this;
    const { dd, da, dw, dp } = this, nd = dd.length;
    const hb0 = this.hb0, hb1 = this.hb1, hb2 = this.hb2, ha1 = this.ha1, ha2 = this.ha2;
    const pb0 = this.pb0, pb1 = this.pb1, pb2 = this.pb2, pa1 = this.pa1, pa2 = this.pa2, pont = this.pont, cp = this.cpont;
    const mix = this.mix, c0 = this.c0, modHz = plan.modHz;
    let hx1 = this.hx1, hx2 = this.hx2, hy1 = this.hy1, hy2 = this.hy2;
    let px1 = this.px1, px2 = this.px2, py1 = this.py1, py2 = this.py2, qx1 = this.qx1, qx2 = this.qx2, qy1 = this.qy1, qy2 = this.qy2;
    let n = this.n;
    const DEUXPI = 2 * Math.PI;
    for (let t = 0; t < T; t++, n++) {
      let x = entree ? entree[t] : 0;
      if (x - x !== 0) x = 0;   // one NaN or Infinity in would poison every state for good
      let v = hb0 * x + hb1 * hx1 + hb2 * hx2 - ha1 * hy1 - ha2 * hy2;
      if (Math.abs(v) < PLANCHER) v = 0;
      hx2 = hx1; hx1 = x; hy2 = hy1; hy1 = v;
      for (let k = 0; k < nd; k++) {
        const ring = dw[k], p = dp[k], a = da[k], wd = ring[p];
        let w = v + a * wd; if (Math.abs(w) < PLANCHER) w = 0;
        ring[p] = w; dp[k] = p + 1 === dd[k] ? 0 : p + 1;
        v = -a * w + wd;
      }
      const lfo = modHz ? Math.sin(DEUXPI * ((modHz * n / sr) % 1)) : 0;
      let s = 0, l = 0, r = 0;
      for (let i = 0; i < N; i++) {
        const rp = n - (retards[i] + profondeurs[i] * lfo), i0 = Math.floor(rp), fr = rp - i0, base = i * taille;
        const a = anneaux[base + (i0 & masque)], yy = a + (anneaux[base + ((i0 + 1) & masque)] - a) * fr;
        let f = lb0 * yy + lb1 * lx1[i] + lb2 * lx2[i] - la1 * ly1[i] - la2 * ly2[i];
        if (Math.abs(f) < PLANCHER) f = 0;
        lx2[i] = lx1[i]; lx1[i] = yy; ly2[i] = ly1[i]; ly1[i] = f;
        const gi = tous || ga[i] === null ? gc[i] : ga[i][t];
        const zi = gi * f; z[i] = zi; s += zi;
        l += yy; r += sor[i] * yy;
      }
      s *= mix;
      for (let i = 0; i < N; i++) {
        let e = ent[i] * v + z[i] + s;
        if (Math.abs(e) < PLANCHER) e = 0;
        anneaux[i * taille + (n & masque)] = e;
      }
      l *= c0; r *= c0;
      if (pont) {
        let bL = pb0 * l + pb1 * px1 + pb2 * px2 - pa1 * py1 - pa2 * py2; if (Math.abs(bL) < PLANCHER) bL = 0;
        px2 = px1; px1 = l; py2 = py1; py1 = bL;
        let bR = pb0 * r + pb1 * qx1 + pb2 * qx2 - pa1 * qy1 - pa2 * qy2; if (Math.abs(bR) < PLANCHER) bR = 0;
        qx2 = qx1; qx1 = r; qy2 = qy1; qy1 = bR;
        gauche[t] = l + cp * bR; droite[t] = r + cp * bL;
      } else { gauche[t] = l; droite[t] = r; }
    }
    this.hx1 = hx1; this.hx2 = hx2; this.hy1 = hy1; this.hy2 = hy2;
    this.px1 = px1; this.px2 = px2; this.py1 = py1; this.py2 = py2; this.qx1 = qx1; this.qx2 = qx2; this.qy1 = qy1; this.qy2 = qy2;
    this.n = n;
  }
}

// The processor, only in the worklet scope. g0..g5: a-rate; fc, actif: k-rate (actif 0 = asleep, state frozen).
if (typeof registerProcessor === "function" && typeof AudioWorkletProcessor === "function") {
  class ReseauRetards extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      const d = [0, 1, 2, 3, 4, 5].map(i => ({ name: "g" + i, defaultValue: 0, minValue: 0, maxValue: 0.999, automationRate: "a-rate" }));
      d.push({ name: "fc", defaultValue: 5000, minValue: 200, maxValue: 20000, automationRate: "k-rate" });
      d.push({ name: "actif", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" });
      return d;
    }
    constructor(options) {
      super();
      const plan = options && options.processorOptions && options.processorOptions.plan;
      this.noyau = plan ? new Noyau(plan) : null;
      this.g = new Array(plan ? plan.N : 0).fill(0);
      this.noms = [0, 1, 2, 3, 4, 5].map(i => "g" + i);
      this.fin = false; this.reserve = new Float32Array(128);
      this.port.onmessage = e => { if (e.data && e.data.fin) this.fin = true; };
    }
    process(entrees, sorties, p) {
      if (this.fin) return false;
      const s = sorties[0];
      if (!s || !s[0]) return true;
      const k = this.noyau;
      if (!k || p.actif[0] < 0.5) { for (let c = 0; c < s.length; c++) s[c].fill(0); return true; }
      for (let i = 0; i < k.N; i++) { const gi = p[this.noms[i]]; this.g[i] = gi.length === 1 ? gi[0] : gi; }
      const e = entrees[0] && entrees[0][0] ? entrees[0][0] : null;
      if (s.length < 2) { if (this.reserve.length < s[0].length) this.reserve = new Float32Array(s[0].length); k.traiter(e, s[0], this.reserve.subarray(0, s[0].length), this.g, p.fc[0]); }
      else k.traiter(e, s[0], s[1], this.g, p.fc[0]);
      for (const o of s) for (let i = 0; i < o.length; i++) if (o[i] - o[i] !== 0) { for (const q of s) q.fill(0); this.fin = true; this.port.postMessage({ panne: 1 }); return false; }   // a NaN out would silence the bus for good
      return true;
    }
  }
  registerProcessor(NOM_PROCESSEUR, ReseauRetards);
}
