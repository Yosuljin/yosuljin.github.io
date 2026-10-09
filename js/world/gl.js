// Tiny WebGL toolkit (WebGL2 when available, WebGL1 otherwise; every shader is GLSL ES 1.00):
// column-major mat4/vec3 math, programs, buffers, meshes, render targets and a noise texture.

export const vec3 = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
};

// Matrices write into an `out` array so a frame allocates nothing (no garbage-collector pauses on phones).
export const mat4 = {
  create: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  identity(out) { out.fill(0); out[0] = out[5] = out[10] = out[15] = 1; return out; },
  perspective(out, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    out.fill(0);
    out[0] = f / aspect; out[5] = f; out[10] = (far + near) * nf; out[11] = -1; out[14] = 2 * far * near * nf;
    return out;
  },
  /** View matrix looking from `eye` at `target`, rolled by `roll` radians around the view axis. */
  lookAt(out, eye, target, up, roll = 0) {
    let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    let yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    if (roll) {
      const c = Math.cos(roll), s = Math.sin(roll);
      const rx = xx * c + yx * s, ry = xy * c + yy * s, rz = xz * c + yz * s;
      yx = yx * c - xx * s; yy = yy * c - xy * s; yz = yz * c - xz * s;
      xx = rx; xy = ry; xz = rz;
    }
    out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
    out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
    out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
    out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    out[15] = 1;
    return out;
  },
  /** Translation · rotation (Y then X then Z) · uniform scale. */
  model(out, pos, rx = 0, ry = 0, rz = 0, s = 1) {
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    // R = Rz * Rx * Ry
    out[0] = (cz * cy - sz * sx * sy) * s; out[1] = (sz * cy + cz * sx * sy) * s; out[2] = -cx * sy * s; out[3] = 0;
    out[4] = -sz * cx * s; out[5] = cz * cx * s; out[6] = sx * s; out[7] = 0;
    out[8] = (cz * sy + sz * sx * cy) * s; out[9] = (sz * sy - cz * sx * cy) * s; out[10] = cx * cy * s; out[11] = 0;
    out[12] = pos[0]; out[13] = pos[1]; out[14] = pos[2]; out[15] = 1;
    return out;
  },
  /** Model matrix from an orthonormal basis: the mesh's X, Y and Z axes become x, y and z, scaled by s. */
  basis(out, pos, x, y, z, s = 1) {
    out[0] = x[0] * s; out[1] = x[1] * s; out[2] = x[2] * s; out[3] = 0;
    out[4] = y[0] * s; out[5] = y[1] * s; out[6] = y[2] * s; out[7] = 0;
    out[8] = z[0] * s; out[9] = z[1] * s; out[10] = z[2] * s; out[11] = 0;
    out[12] = pos[0]; out[13] = pos[1]; out[14] = pos[2]; out[15] = 1;
    return out;
  },
  multiply(out, a, b) {
    const o = out === a || out === b ? new Float32Array(16) : out;
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    if (o !== out) out.set(o);
    return out;
  },
  /** Applies a model matrix to a point. */
  apply(m, p) {
    return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
  },
  /** Applies only the rotation part (unit-scale models) to a direction. */
  rotate(m, d) {
    return [m[0] * d[0] + m[4] * d[1] + m[8] * d[2], m[1] * d[0] + m[5] * d[1] + m[9] * d[2], m[2] * d[0] + m[6] * d[1] + m[10] * d[2]];
  }
};

/** Compiles and links; returns { p, u, a } with every active uniform and attribute location cached. */
export function program(gl, vs, fs, defines = "") {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, defines + src); gl.compileShader(s);
    return s;
  };
  const p = gl.createProgram();
  const v = compile(gl.VERTEX_SHADER, vs), f = compile(gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v); gl.attachShader(p, f);
  gl.linkProgram(p);
  // Status is read later (finish), so drivers with KHR_parallel_shader_compile build every program at once.
  const prog = { p, u: {}, a: {}, ready: false };
  prog.finish = () => {
    if (prog.ready) return prog;
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getShaderInfoLog(v) || gl.getShaderInfoLog(f) || gl.getProgramInfoLog(p) || "link";
      throw new Error(log);
    }
    for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) { const info = gl.getActiveUniform(p, i); prog.u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name); }
    for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES); i < n; i++) { const info = gl.getActiveAttrib(p, i); prog.a[info.name] = gl.getAttribLocation(p, info.name); }
    gl.deleteShader(v); gl.deleteShader(f);
    prog.ready = true;
    return prog;
  };
  return prog;
}

/**
 * Uniforms keep their value per program, hence per location: wraps the setters so a call that would resend
 * the value a location already holds is skipped (most of a frame's colours and constants). No allocation.
 */
export function cacheUniforms(gl) {
  const u1f = gl.uniform1f.bind(gl), u2f = gl.uniform2f.bind(gl), u3f = gl.uniform3f.bind(gl), u3fv = gl.uniform3fv.bind(gl);
  const u1fv = gl.uniform1fv.bind(gl), u4fv = gl.uniform4fv.bind(gl), m4 = gl.uniformMatrix4fv.bind(gl);
  const same = (l, v, n) => {
    let c = l.__c;
    if (!c || c.length !== n) { c = l.__c = new Array(n).fill(NaN); }
    let i = 0;
    while (i < n && c[i] === v[i]) i++;
    if (i === n) return true;
    for (; i < n; i++) c[i] = v[i];
    return false;
  };
  const v3 = [0, 0, 0], v2 = [0, 0];
  gl.uniform1f = (l, x) => { if (l && l.__x !== x) { l.__x = x; u1f(l, x); } };
  gl.uniform2f = (l, x, y) => { if (!l) return; v2[0] = x; v2[1] = y; if (!same(l, v2, 2)) u2f(l, x, y); };
  gl.uniform3f = (l, x, y, z) => { if (!l) return; v3[0] = x; v3[1] = y; v3[2] = z; if (!same(l, v3, 3)) u3f(l, x, y, z); };
  gl.uniform3fv = (l, v) => { if (l && !same(l, v, 3)) u3fv(l, v); };
  gl.uniform1fv = (l, v) => { if (l && !same(l, v, v.length)) u1fv(l, v); };
  gl.uniform4fv = (l, v) => { if (l && !same(l, v, v.length)) u4fv(l, v); };
  gl.uniformMatrix4fv = (l, t, m) => { if (l && !same(l, m, 16)) m4(l, t, m); };
}

export function buffer(gl, data, usage) {
  const b = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW);
  return b;
}
export function indexBuffer(gl, data) {
  const b = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return b;
}

/** Binds interleaved float attributes: layout = [[location, size], ...]; turns off the ones it does not use. */
let enabledAttribs = 0;
export function attribs(gl, buf, layout) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  const stride = layout.reduce((s, [, n]) => s + n, 0) * 4;
  let offset = 0, mask = 0;
  for (const [loc, size] of layout) {
    if (loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset); mask |= 1 << loc; }
    offset += size * 4;
  }
  for (let i = 0; i < 16; i++) if ((enabledAttribs & (1 << i)) && !(mask & (1 << i))) gl.disableVertexAttribArray(i);
  enabledAttribs = mask;
}

export function sphereMesh(rows, cols) {
  const pos = [], idx = [];
  for (let y = 0; y <= rows; y++) {
    const phi = (y / rows) * Math.PI, sp = Math.sin(phi);
    for (let x = 0; x <= cols; x++) { const th = (x / cols) * Math.PI * 2; pos.push(sp * Math.cos(th), Math.cos(phi), sp * Math.sin(th)); }
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { const a = y * (cols + 1) + x, b = a + cols + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  return { pos: new Float32Array(pos), idx: new Uint16Array(idx) };
}

/** Torus in the XZ plane (major radius 1): position, normal, (u around the ring, v around the tube). */
export function torusMesh(seg, tube, minor) {
  const v = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg, a = u * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    for (let j = 0; j <= tube; j++) {
      const w = j / tube, b = w * Math.PI * 2, cb = Math.cos(b), sb = Math.sin(b);
      v.push((1 + minor * cb) * ca, minor * sb, (1 + minor * cb) * sa, cb * ca, sb, cb * sa, u, w);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < tube; j++) {
    const a = i * (tube + 1) + j, b = a + tube + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return { data: new Float32Array(v), idx: new Uint16Array(idx) };
}

/**
 * Tapered tubes along polylines (branches): position, normal, v (0 at the base of the line, 1 at its tip).
 * lines = [{ pts: [[x, y, z], ...], r0, r1 }], `sides` vertices per ring.
 */
export function tubeMesh(lines, sides = 6) {
  const v = [], idx = [];
  for (const line of lines) {
    const { pts, r0, r1 } = line;
    const base = v.length / 8, n = pts.length;
    for (let k = 0; k < n; k++) {
      const p = pts[k], q = pts[Math.min(n - 1, k + 1)], o = pts[Math.max(0, k - 1)];
      let t = [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
      const tl = Math.hypot(t[0], t[1], t[2]) || 1; t = [t[0] / tl, t[1] / tl, t[2] / tl];
      const ref = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      let a = [t[1] * ref[2] - t[2] * ref[1], t[2] * ref[0] - t[0] * ref[2], t[0] * ref[1] - t[1] * ref[0]];
      const al = Math.hypot(a[0], a[1], a[2]) || 1; a = [a[0] / al, a[1] / al, a[2] / al];
      const b = [t[1] * a[2] - t[2] * a[1], t[2] * a[0] - t[0] * a[2], t[0] * a[1] - t[1] * a[0]];
      const s = k / (n - 1), r = r0 + (r1 - r0) * s;
      for (let j = 0; j < sides; j++) {
        const ang = j / sides * Math.PI * 2, c = Math.cos(ang), sn = Math.sin(ang);
        const nx = a[0] * c + b[0] * sn, ny = a[1] * c + b[1] * sn, nz = a[2] * c + b[2] * sn;
        v.push(p[0] + nx * r, p[1] + ny * r, p[2] + nz * r, nx, ny, nz, s, line.id ?? 0);
      }
    }
    for (let k = 0; k < n - 1; k++) for (let j = 0; j < sides; j++) {
      const a0 = base + k * sides + j, a1 = base + k * sides + (j + 1) % sides, b0 = a0 + sides, b1 = a1 + sides;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
  }
  return { data: new Float32Array(v), idx: new Uint16Array(idx) };
}

/** Flat annulus in the XZ plane as a strip: (cos, sin, t) with t = 0 on the inner edge, 1 on the outer. */
export function ringMesh(seg) {
  const v = [];
  for (let i = 0; i <= seg; i++) { const a = i / seg * Math.PI * 2; v.push(Math.cos(a), Math.sin(a), 0, Math.cos(a), Math.sin(a), 1); }
  return { data: new Float32Array(v), count: (seg + 1) * 2 };
}

/**
 * 256×256 value noise packed for one-fetch 3D noise: G(x, y) = R(x + 37, y + 17), same for A and B.
 * Repeat-wrapped and filtered so the shaders read smooth noise with a single texture2D per octave.
 */
export function noiseTexture(gl, seed = 7) {
  const R = rng(seed), n = 256, a = new Uint8Array(n * n), b = new Uint8Array(n * n), px = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) { a[i] = (R() * 256) | 0; b[i] = (R() * 256) | 0; }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, j = ((y + 17) & 255) * n + ((x + 37) & 255);
    px[i * 4] = a[i]; px[i * 4 + 1] = a[j]; px[i * 4 + 2] = b[i]; px[i * 4 + 3] = b[j];
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return tex;
}

/** Which colour formats the bloom chain can render into: half float when the GPU allows it, bytes otherwise. */
export function floatFormat(gl) {
  const gl2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
  if (gl2) {
    if (gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float")) {
      return { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
    }
    return null;
  }
  // WebGL1: half float must be both renderable and filterable (an unfilterable texture samples black).
  const half = gl.getExtension("OES_texture_half_float");
  if (half && gl.getExtension("OES_texture_half_float_linear") && (gl.getExtension("EXT_color_buffer_half_float") || gl.getExtension("WEBGL_color_buffer_float"))) {
    return { internal: gl.RGBA, format: gl.RGBA, type: half.HALF_FLOAT_OES };
  }
  return null;
}

function texture(gl, w, h, fmt) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (fmt) gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, w, h, 0, fmt.format, fmt.type, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/** Colour-only target (sky, bloom levels). Returns null if the format cannot be rendered to. */
export function colorTarget(gl, w, h, fmt, old) {
  if (old && old.w === w && old.h === h && old.fmt === fmt) return old;
  if (old) { gl.deleteTexture(old.tex); gl.deleteFramebuffer(old.fb); }
  const tex = texture(gl, w, h, fmt);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) { gl.deleteTexture(tex); gl.deleteFramebuffer(fb); return null; }
  return { tex, fb, w, h, fmt };
}

/**
 * Scene target: colour + depth. With WebGL2 and samples > 0 the scene is drawn multisampled and
 * resolved into the texture (resolve()); otherwise it is drawn straight into the texture.
 */
export function sceneTarget(gl, w, h, samples, old) {
  if (old && old.w === w && old.h === h && old.samples === samples) return old;
  if (old) old.dispose();
  const gl2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
  const tex = texture(gl, w, h, null);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const t = { tex, fb, w, h, samples: 0, draw: fb, rbs: [] };
  if (gl2 && samples > 0) {
    const n = Math.min(samples, gl.getParameter(gl.MAX_SAMPLES) || 0);
    if (n > 0) {
      const color = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, color);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, n, gl.RGBA8, w, h);
      const depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, n, gl.DEPTH_COMPONENT16, w, h);
      const msfb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, msfb);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
        t.draw = msfb; t.samples = samples; t.rbs.push(color, depth); t.msfb = msfb;
      } else { gl.deleteRenderbuffer(color); gl.deleteRenderbuffer(depth); gl.deleteFramebuffer(msfb); }
    }
  }
  if (!t.samples) {
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    t.rbs.push(depth);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  t.resolve = () => {
    if (!t.msfb) return;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.msfb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.fb);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  };
  t.dispose = () => {
    gl.deleteTexture(tex); gl.deleteFramebuffer(fb);
    if (t.msfb) gl.deleteFramebuffer(t.msfb);
    t.rbs.forEach(r => gl.deleteRenderbuffer(r));
  };
  return t;
}

/** Deterministic pseudo random generator so the world is the same on every visit. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
