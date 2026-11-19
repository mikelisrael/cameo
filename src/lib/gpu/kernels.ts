/**
 * WGSL for the clean-up, ported from `src/lib/refine.ts` with the same math, constants and order.
 *
 * Layout shared by the kernels: the photo is one u32 per pixel (r | g << 8 | b << 16); the alpha plane is one byte per
 * pixel, four to a u32, and a kernel that writes it handles a whole word, so nothing needs atomics. Sub-sampled planes
 * are f32 vectors (vec4 for the guided filter, vec2 for the contrast). Every shader binds at most five storage buffers.
 */

/** Invocations per workgroup. */
export const WG = 64

const LIN = `fn lin(g: vec3<u32>, nw: vec3<u32>) -> u32 { return g.y * nw.x * ${WG}u + g.x; }`
const MAIN = `@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>)`
const RGB = `
fn rgb(v: u32) -> vec3<f32> { return vec3<f32>(f32(v & 255u), f32((v >> 8u) & 255u), f32((v >> 16u) & 255u)); }`

/**
 * Bilinear resize of the model's mask to the photo's size, pixel centres aligned and clamped at the border, rounded to
 * a byte: what a canvas `drawImage` does when `RawImage.resize` runs in a browser worker. Bindings: mask bytes,
 * alpha words (out), params { w, h, mw, mh, n }.
 */
export const RESIZE = `
struct P { w: u32, h: u32, mw: u32, mh: u32, n: u32 }
@group(0) @binding(0) var<storage, read> mask: array<u32>;
@group(0) @binding(1) var<storage, read_write> alpha: array<u32>;
@group(0) @binding(2) var<uniform> p: P;
${LIN}
fn m(i: u32) -> f32 { return f32((mask[i >> 2u] >> ((i & 3u) * 8u)) & 255u); }
${MAIN} {
  let word = lin(g, nw);
  let first = word * 4u;
  if (first >= p.n) { return; }
  var out = 0u;
  for (var k = 0u; k < 4u; k++) {
    let i = first + k;
    if (i >= p.n) { break; }
    let y = i / p.w;
    let x = i - y * p.w;
    let sy = clamp((f32(y) + 0.5) * f32(p.mh) / f32(p.h) - 0.5, 0.0, f32(p.mh - 1u));
    let sx = clamp((f32(x) + 0.5) * f32(p.mw) / f32(p.w) - 0.5, 0.0, f32(p.mw - 1u));
    let y0 = u32(floor(sy));
    let x0 = u32(floor(sx));
    let y1 = min(y0 + 1u, p.mh - 1u);
    let x1 = min(x0 + 1u, p.mw - 1u);
    let fy = sy - floor(sy);
    let fx = sx - floor(sx);
    let top = mix(m(y0 * p.mw + x0), m(y0 * p.mw + x1), fx);
    let bottom = mix(m(y1 * p.mw + x0), m(y1 * p.mw + x1), fx);
    out |= u32(floor(mix(top, bottom, fy) + 0.5)) << (k * 8u);
  }
  alpha[word] = out;
}`

/**
 * Mean of the photo's colour and of alpha over each s x s block (the sub-sampling of the guided filter and of the wide
 * blur-fusion pass), one invocation per block, for `rows` block rows starting at block row `sy0` (a strip). Writes
 * (r, g, b, alpha), or with `channel` only (channel `c`, alpha), as 0..1.
 * Bindings: image, alpha words, planes (out), params { w, h, ws, rows, s, sy0, c }.
 */
export function downsample(channel: boolean) {
  return `
struct P { w: u32, h: u32, ws: u32, rows: u32, s: u32, sy0: u32, c: u32 }
@group(0) @binding(0) var<storage, read> image: array<u32>;
@group(0) @binding(1) var<storage, read> alpha: array<u32>;
@group(0) @binding(2) var<storage, read_write> planes: array<${channel ? 'vec2<f32>' : 'vec4<f32>'}>;
@group(0) @binding(3) var<uniform> p: P;
${LIN}
${MAIN} {
  let k = lin(g, nw);
  if (k >= p.ws * p.rows) { return; }
  let sy = p.sy0 + k / p.ws;
  let sx = k % p.ws;
  let y1 = min(p.h, (sy + 1u) * p.s);
  let x1 = min(p.w, (sx + 1u) * p.s);
  var c0 = 0u; var c1 = 0u; var c2 = 0u; var pa = 0u; var cnt = 0u;
  for (var y = sy * p.s; y < y1; y++) {
    for (var x = sx * p.s; x < x1; x++) {
      let i = y * p.w + x;
      let v = image[i];
      ${
        channel ? 'c0 += (v >> (p.c * 8u)) & 255u;' : 'c0 += v & 255u; c1 += (v >> 8u) & 255u; c2 += (v >> 16u) & 255u;'
      }
      pa += (alpha[i >> 2u] >> ((i & 3u) * 8u)) & 255u;
      cnt++;
    }
  }
  let c = f32(cnt);
  planes[k] = ${
    channel ? 'vec2<f32>(f32(c0) / c, f32(pa) / c)' : 'vec4<f32>(f32(c0) / c, f32(c1) / c, f32(c2) / c, f32(pa) / c)'
  } / 255.0;
}`
}

/** What the horizontal blur reads for each element: the plane itself, or one of the guided filter's products. */
const PRODUCTS = `
  let q = src[i];
  if (p.mode == 1u) { return vec4<f32>(q.x * q.x, q.x * q.y, q.x * q.z, q.x * q.w); }
  if (p.mode == 2u) { return vec4<f32>(q.y * q.y, q.y * q.z, q.y * q.w, q.z * q.z); }
  if (p.mode == 3u) { return vec4<f32>(q.z * q.w, 4.0 * q.w * (1.0 - q.w), 0.0, 0.0); }
  return q;`

/** The same for the wide blur-fusion pass over (colour channel, alpha): mode 1 is (I*A, A), mode 2 is (I*(1-A), 0). */
const FUSION_PRODUCTS = `
  let q = src[i];
  if (p.mode == 1u) { return vec2<f32>(q.x * q.y, q.y); }
  return vec2<f32>(q.x * (1.0 - q.y), 0.0);`

type Element = 'vec4<f32>' | 'vec2<f32>' | 'f32'

/**
 * Horizontal pass of the box blur, one invocation per row, a running sum like `boxBlur`: the window is clamped to the
 * image and divided by the number of pixels inside, so borders are exact. `T` is the element type. With `products`
 * `mode` picks what is blurred: 0 the plane, and for 'gf' (vec4 only) 1..3 the products the guided filter needs
 * (I0*I0, I0*I1, I0*I2, I0*p / I1*I1, I1*I2, I1*p, I2*I2 / I2*p, 4p(1-p)), for 'fusion' (vec2 only) 1..2 as
 * `FUSION_PRODUCTS`. Bindings: src, dst (out), params { w, h, r, mode }.
 */
export function blurH(T: Element, products: false | 'gf' | 'fusion') {
  return `
struct P { w: u32, h: u32, r: u32, mode: u32 }
@group(0) @binding(0) var<storage, read> src: array<${T}>;
@group(0) @binding(1) var<storage, read_write> dst: array<${T}>;
@group(0) @binding(2) var<uniform> p: P;
${LIN}
fn load(i: u32) -> ${T} { ${products === 'gf' ? PRODUCTS : products === 'fusion' ? FUSION_PRODUCTS : 'return src[i];'} }
${MAIN} {
  let y = lin(g, nw);
  if (y >= p.h) { return; }
  let row = y * p.w;
  var sum = ${T}(0.0);
  let first = min(p.r, p.w - 1u);
  for (var x = 0u; x <= first; x++) { sum += load(row + x); }
  for (var x = 0u; x < p.w; x++) {
    let lo = select(0u, x - p.r, x > p.r);
    let hi = min(x + p.r, p.w - 1u);
    dst[row + x] = sum / f32(hi - lo + 1u);
    if (x + 1u + p.r < p.w) { sum += load(row + x + 1u + p.r); }
    if (x >= p.r) { sum -= load(row + x - p.r); }
  }
}`
}

/** Vertical pass of the box blur, one invocation per column, otherwise as `blurH`. Bindings: src, dst (out), params { w, h, r }. */
export function blurV(T: Element) {
  return `
struct P { w: u32, h: u32, r: u32 }
@group(0) @binding(0) var<storage, read> src: array<${T}>;
@group(0) @binding(1) var<storage, read_write> dst: array<${T}>;
@group(0) @binding(2) var<uniform> p: P;
${LIN}
${MAIN} {
  let x = lin(g, nw);
  if (x >= p.w) { return; }
  var sum = ${T}(0.0);
  let last = min(p.r, p.h - 1u);
  for (var y = 0u; y <= last; y++) { sum += src[y * p.w + x]; }
  for (var y = 0u; y < p.h; y++) {
    let lo = select(0u, y - p.r, y > p.r);
    let hi = min(y + p.r, p.h - 1u);
    dst[y * p.w + x] = sum / f32(hi - lo + 1u);
    if (y + 1u + p.r < p.h) { sum += src[(y + 1u + p.r) * p.w + x]; }
    if (y >= p.r) { sum -= src[(y - p.r) * p.w + x]; }
  }
}`
}

/**
 * The guided filter's per-block solve: covariances from the blurred products, then a = (Sigma + eps*I)^-1 * covIP by
 * cofactors and b = mP - a.m, as in `guidedFilter`. Writes (a0, a1, a2, b) over `b1`, and the band weight
 * min(1, 4 * blur(4p(1-p))) into `b3`.x. Bindings: m (blurred planes), b1 (blurred products 1; out), b2 (products 2),
 * b3 (products 3; out), params { n, eps }.
 */
export const SOLVE = `
struct P { n: u32, eps: f32 }
@group(0) @binding(0) var<storage, read> m: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> b1: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> b2: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> b3: array<vec4<f32>>;
@group(0) @binding(4) var<uniform> p: P;
${LIN}
${MAIN} {
  let k = lin(g, nw);
  if (k >= p.n) { return; }
  let mm = m[k];
  let q1 = b1[k];
  let q2 = b2[k];
  let q3 = b3[k];
  let vRG = q1.y - mm.x * mm.y;
  let vRB = q1.z - mm.x * mm.z;
  let vGB = q2.y - mm.y * mm.z;
  let cR = q1.w - mm.x * mm.w;
  let cG = q2.z - mm.y * mm.w;
  let cB = q3.x - mm.z * mm.w;
  let a = q1.x - mm.x * mm.x + p.eps;
  let b = vRG;
  let c = vRB;
  let d = q2.x - mm.y * mm.y + p.eps;
  let e = vGB;
  let f = q2.w - mm.z * mm.z + p.eps;
  let A00 = d * f - e * e;
  let A01 = c * e - b * f;
  let A02 = b * e - c * d;
  let A11 = a * f - c * c;
  let A12 = b * c - a * e;
  let A22 = a * d - b * b;
  let invDet = 1.0 / (a * A00 + b * A01 + c * A02);
  let a0 = (A00 * cR + A01 * cG + A02 * cB) * invDet;
  let a1 = (A01 * cR + A11 * cG + A12 * cB) * invDet;
  let a2 = (A02 * cR + A12 * cG + A22 * cB) * invDet;
  b1[k] = vec4<f32>(a0, a1, a2, mm.w - a0 * mm.x - a1 * mm.y - a2 * mm.z);
  b3[k] = vec4<f32>(min(1.0, 4.0 * q3.y), 0.0, 0.0, 0.0);
}`

/** (first sub-sampled index, second, weight of the second) for full-res index i, as makeAxis. */
const AXIS = `
fn axis(i: u32, s: f32, sub: u32) -> vec3<f32> {
  let c = clamp((f32(i) + 0.5) / s - 0.5, 0.0, f32(sub - 1u));
  let a = floor(c);
  return vec3<f32>(a, min(a + 1.0, f32(sub - 1u)), c - a);
}`

/**
 * Moves one strip of the guided filter's result (rows of the strip's own, not its halo) into the planes that cover the
 * whole sub-sampled grid: the blurred coefficients, and the band weight (from `wsrc`.x) as a plain f32.
 * Bindings: m (blurred coefficients), wsrc, coefOut (out), wgtOut (out), params { count, src0, dst0 }.
 */
export const STORE_COEF = `
struct P { count: u32, src0: u32, dst0: u32 }
@group(0) @binding(0) var<storage, read> m: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> wsrc: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> coefOut: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> wgtOut: array<f32>;
@group(0) @binding(4) var<uniform> p: P;
${LIN}
${MAIN} {
  let k = lin(g, nw);
  if (k >= p.count) { return; }
  coefOut[p.dst0 + k] = m[p.src0 + k];
  wgtOut[p.dst0 + k] = wsrc[p.src0 + k].x;
}`

/**
 * Applies the guided filter at full size: the blurred coefficients and the band weight are bilinearly interpolated
 * from the sub-sampled grid, q = a.I + b, blended with the old alpha by the weight. Where the weight is 0 alpha is left
 * as it was, which is how pixels far from any edge keep the model's value. Bindings: image, coef (blurred a, b), wgt,
 * alpha words (in place), params { w, h, ws, hs, s, n }.
 */
export const REFINE_APPLY = `
struct P { w: u32, h: u32, ws: u32, hs: u32, s: u32, n: u32 }
@group(0) @binding(0) var<storage, read> image: array<u32>;
@group(0) @binding(1) var<storage, read> coef: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> wgt: array<f32>;
@group(0) @binding(3) var<storage, read_write> alpha: array<u32>;
@group(0) @binding(4) var<uniform> p: P;
${LIN}
${RGB}
${AXIS}
${MAIN} {
  let word = lin(g, nw);
  let first = word * 4u;
  if (first >= p.n) { return; }
  let old4 = alpha[word];
  var out = 0u;
  for (var k = 0u; k < 4u; k++) {
    let i = first + k;
    if (i >= p.n) { break; }
    let old = (old4 >> (k * 8u)) & 255u;
    let y = i / p.w;
    let x = i - y * p.w;
    let ax = axis(x, f32(p.s), p.ws);
    let ay = axis(y, f32(p.s), p.hs);
    let fx = ax.z;
    let fy = ay.z;
    let gx = 1.0 - fx;
    let gy = 1.0 - fy;
    let w00 = gx * gy;
    let w01 = fx * gy;
    let w10 = gx * fy;
    let w11 = fx * fy;
    let r0 = u32(ay.x) * p.ws;
    let r1 = u32(ay.y) * p.ws;
    let k00 = r0 + u32(ax.x);
    let k01 = r0 + u32(ax.y);
    let k10 = r1 + u32(ax.x);
    let k11 = r1 + u32(ax.y);
    let wg = wgt[k00] * w00 + wgt[k01] * w01 + wgt[k10] * w10 + wgt[k11] * w11;
    if (wg <= 0.0) {
      out |= old << (k * 8u);
      continue;
    }
    let c = rgb(image[i]) / 255.0;
    let co = coef[k00] * w00 + coef[k01] * w01 + coef[k10] * w10 + coef[k11] * w11;
    let q = co.x * c.x + co.y * c.y + co.z * c.z + co.w;
    let v = clamp(f32(old) / 255.0 * (1.0 - wg) + q * wg, 0.0, 1.0);
    out |= u32(floor(v * 255.0 + 0.5)) << (k * 8u);
  }
  alpha[word] = out;
}`

/**
 * Mean luminance and mean squared luminance over each f x f block (clipped at the border), for the contrast measure of
 * `tightenAdaptive`, for `rows` block rows starting at block row `gy0` (a strip). Bindings: image, ls (out), params
 * { w, h, rw, rows, f, gy0 }.
 */
export const LUMINANCE = `
struct P { w: u32, h: u32, rw: u32, rows: u32, f: u32, gy0: u32 }
@group(0) @binding(0) var<storage, read> image: array<u32>;
@group(0) @binding(1) var<storage, read_write> ls: array<vec2<f32>>;
@group(0) @binding(2) var<uniform> p: P;
${LIN}
${RGB}
${MAIN} {
  let k = lin(g, nw);
  if (k >= p.rw * p.rows) { return; }
  let y = p.gy0 + k / p.rw;
  let x = k % p.rw;
  var sum = 0.0; var sq = 0.0; var cnt = 0.0;
  for (var dy = 0u; dy < p.f; dy++) {
    let yy = y * p.f + dy;
    if (yy >= p.h) { break; }
    for (var dx = 0u; dx < p.f; dx++) {
      let xx = x * p.f + dx;
      if (xx >= p.w) { break; }
      let l = dot(rgb(image[yy * p.w + xx]), vec3<f32>(0.299, 0.587, 0.114)) / 255.0;
      sum += l;
      sq += l * l;
      cnt += 1.0;
    }
  }
  ls[k] = vec2<f32>(sum / cnt, sq / cnt);
}`

/** From the blurred (mean, mean square) to the local standard deviation, in place. Bindings: ls, params { n }. */
export const CONTRAST = `
struct P { n: u32 }
@group(0) @binding(0) var<storage, read_write> ls: array<vec2<f32>>;
@group(0) @binding(1) var<uniform> p: P;
${LIN}
${MAIN} {
  let k = lin(g, nw);
  if (k >= p.n) { return; }
  let v = ls[k];
  ls[k] = vec2<f32>(sqrt(max(0.0, v.y - v.x * v.x)), 0.0);
}`

/**
 * The adaptive stretch of `tightenAdaptive`: the local contrast (ls.x, at 1/f size) picks, through a smoothstep between
 * `low` and `high`, how wide the band is that gets stretched to 0 and 255. Alpha 0 and 255 are left alone. Handles the
 * pixels i0 <= i < i1 (a strip; the words at its ends keep the pixels outside it), with `ls` holding block rows from
 * `gy0`. Bindings: ls, alpha words (in place), params { w, rw, f, i0, i1, gy0, soft, hard, low, high }.
 */
export const TIGHTEN_ADAPTIVE = `
struct P { w: u32, rw: u32, f: u32, i0: u32, i1: u32, gy0: u32, soft: f32, hard: f32, low: f32, high: f32 }
@group(0) @binding(0) var<storage, read> ls: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> alpha: array<u32>;
@group(0) @binding(2) var<uniform> p: P;
${LIN}
${MAIN} {
  let word = (p.i0 >> 2u) + lin(g, nw);
  let first = word * 4u;
  if (first >= p.i1) { return; }
  let old4 = alpha[word];
  var out = 0u;
  for (var k = 0u; k < 4u; k++) {
    let i = first + k;
    let a = (old4 >> (k * 8u)) & 255u;
    if (i < p.i0 || i >= p.i1 || a == 0u || a == 255u) {
      out |= a << (k * 8u);
      continue;
    }
    let y = i / p.w;
    let x = i - y * p.w;
    let c = ls[(y / p.f - p.gy0) * p.rw + x / p.f].x;
    let u = clamp((c - p.low) / (p.high - p.low), 0.0, 1.0);
    let s = u * u * (3.0 - 2.0 * u);
    let lo = p.hard + (p.soft - p.hard) * s;
    let v = floor(((f32(a) / 255.0 - lo) / (1.0 - 2.0 * lo)) * 255.0 + 0.5);
    out |= u32(clamp(v, 0.0, 255.0)) << (k * 8u);
  }
  alpha[word] = out;
}`

/**
 * End of the wide blur-fusion pass for one colour channel `c`: from the blurred (I*A, A) in `pf` and (I*(1-A), 0) in
 * `pb`, F = blur(I*A) / (blur(A) + 1e-5) and B = blur(I*(1-A)) / (1 - blur(A) + 1e-5), kept as two 16-bit fractions in
 * one u32 (`fused[c * sub + k]`, F in the low half): 1/65535 is under a hundredth of a level and it halves the memory
 * that has to stay until the full-size pass. Bindings: pf, pb, fused (out), params { n, c, sub }.
 */
export const FUSION_NORMALISE = `
struct P { n: u32, c: u32, sub: u32 }
@group(0) @binding(0) var<storage, read> pf: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read> pb: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> fused: array<u32>;
@group(0) @binding(3) var<uniform> p: P;
${LIN}
${MAIN} {
  let k = lin(g, nw);
  if (k >= p.n) { return; }
  let a = pf[k];
  fused[p.c * p.sub + k] = pack2x16unorm(vec2<f32>(a.x / (a.y + 1e-5), pb[k].x / (1.0 - a.y + 1e-5)));
}`

/** The colour `out` starts as: the photo with alpha 255, which is what decontaminate leaves at every pixel it does not touch. Bindings: image, out (out), params { n }. */
export const DECON_INIT = `
struct P { n: u32 }
@group(0) @binding(0) var<storage, read> image: array<u32>;
@group(0) @binding(1) var<storage, read_write> out: array<u32>;
@group(0) @binding(2) var<uniform> p: P;
${LIN}
${MAIN} {
  let i = lin(g, nw);
  if (i >= p.n) { return; }
  out[i] = (image[i] & 0x00FFFFFFu) | 0xFF000000u;
}`

/** alpha / 255 for the pixels of one strip's region (rows from `ry0`), as the f32 plane the box blur reads. Bindings: alpha words, src (out), params { w, ry0, count }. */
export const DECON_ALPHA = `
struct P { w: u32, ry0: u32, count: u32 }
@group(0) @binding(0) var<storage, read> alpha: array<u32>;
@group(0) @binding(1) var<storage, read_write> src: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
${LIN}
${MAIN} {
  let k = lin(g, nw);
  if (k >= p.count) { return; }
  let i = p.ry0 * p.w + k;
  src[k] = f32((alpha[i >> 2u] >> ((i & 3u) * 8u)) & 255u) / 255.0;
}`

/**
 * F1 of `blurFusionCoarse`, made on the fly for a strip's region so it never exists for the whole photo: image where
 * alpha is 255, 0 where it is 0, blur fusion in between, rounded to a byte; and written already multiplied by alpha,
 * which is what pass 2 blurs (`src` of `pass2Region`). Channel `c`. Bindings: image, alpha words, fused, src (out),
 * params { w, ws, hs, d, ry0, count, c, sub }.
 */
export const DECON_F = `
struct P { w: u32, ws: u32, hs: u32, d: u32, ry0: u32, count: u32, c: u32, sub: u32 }
@group(0) @binding(0) var<storage, read> image: array<u32>;
@group(0) @binding(1) var<storage, read> alpha: array<u32>;
@group(0) @binding(2) var<storage, read> fused: array<u32>;
@group(0) @binding(3) var<storage, read_write> src: array<f32>;
@group(0) @binding(4) var<uniform> p: P;
${LIN}
${AXIS}
${MAIN} {
  let k = lin(g, nw);
  if (k >= p.count) { return; }
  let i = p.ry0 * p.w + k;
  let al = (alpha[i >> 2u] >> ((i & 3u) * 8u)) & 255u;
  if (al == 0u) {
    src[k] = 0.0;
    return;
  }
  let ic = f32((image[i] >> (p.c * 8u)) & 255u) / 255.0;
  if (al == 255u) {
    src[k] = ic;
    return;
  }
  let a = f32(al) / 255.0;
  let y = i / p.w;
  let x = i - y * p.w;
  let ax = axis(x, f32(p.d), p.ws);
  let ay = axis(y, f32(p.d), p.hs);
  let fx = ax.z;
  let fy = ay.z;
  let gx = 1.0 - fx;
  let gy = 1.0 - fy;
  let r0 = u32(ay.x) * p.ws;
  let r1 = u32(ay.y) * p.ws;
  let off = p.c * p.sub;
  let q00 = unpack2x16unorm(fused[off +r0 + u32(ax.x)]);
  let q01 = unpack2x16unorm(fused[off +r0 + u32(ax.y)]);
  let q10 = unpack2x16unorm(fused[off +r1 + u32(ax.x)]);
  let q11 = unpack2x16unorm(fused[off +r1 + u32(ax.y)]);
  let q = q00 * (gx * gy) + q01 * (fx * gy) + q10 * (gx * fy) + q11 * (fx * fy);
  let v = q.x + a * (ic - a * q.x - (1.0 - a) * q.y);
  src[k] = floor(clamp(v, 0.0, 1.0) * 255.0 + 0.5) / 255.0 * a;
}`

/**
 * The background estimate B of pass 2 for one strip's region, multiplied by (1 - alpha); 0 where alpha is 255. Channel
 * `c`. Bindings: alpha words, fused, src (out), params { w, ws, hs, d, ry0, count, c, sub }.
 */
export const DECON_B = `
struct P { w: u32, ws: u32, hs: u32, d: u32, ry0: u32, count: u32, c: u32, sub: u32 }
@group(0) @binding(0) var<storage, read> alpha: array<u32>;
@group(0) @binding(1) var<storage, read> fused: array<u32>;
@group(0) @binding(2) var<storage, read_write> src: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
${LIN}
${AXIS}
${MAIN} {
  let k = lin(g, nw);
  if (k >= p.count) { return; }
  let i = p.ry0 * p.w + k;
  let al = (alpha[i >> 2u] >> ((i & 3u) * 8u)) & 255u;
  if (al == 255u) {
    src[k] = 0.0;
    return;
  }
  let y = i / p.w;
  let x = i - y * p.w;
  let ax = axis(x, f32(p.d), p.ws);
  let ay = axis(y, f32(p.d), p.hs);
  let fx = ax.z;
  let fy = ay.z;
  let gx = 1.0 - fx;
  let gy = 1.0 - fy;
  let r0 = u32(ay.x) * p.ws;
  let r1 = u32(ay.y) * p.ws;
  let off = p.c * p.sub;
  let bb = unpack2x16unorm(fused[off +r0 + u32(ax.x)]).y * (gx * gy) + unpack2x16unorm(fused[off +r0 + u32(ax.y)]).y * (fx * gy) + unpack2x16unorm(fused[off +r1 + u32(ax.x)]).y * (gx * fy) + unpack2x16unorm(fused[off +r1 + u32(ax.y)]).y * (fx * fy);
  src[k] = bb * (1.0 - f32(al) / 255.0);
}`

/**
 * The last step of pass 2 for channel `c` over a strip's own pixels (rows from `t0`; the region it was blurred over
 * starts at `ry0`): the soft pixels get the new colour, the others keep what `out` has. Writes one byte of the pixel's
 * word, and each pixel belongs to one invocation. Bindings: image, alpha words, outF, outB, bA, out (in place), params
 * { w, t0, ry0, c, count }.
 */
export const DECON_FINAL = `
struct P { w: u32, t0: u32, ry0: u32, c: u32, count: u32 }
@group(0) @binding(0) var<storage, read> image: array<u32>;
@group(0) @binding(1) var<storage, read> alpha: array<u32>;
@group(0) @binding(2) var<storage, read> outF: array<f32>;
@group(0) @binding(3) var<storage, read> outB: array<f32>;
@group(0) @binding(4) var<storage, read> bA: array<f32>;
@group(0) @binding(5) var<storage, read_write> out: array<u32>;
@group(0) @binding(6) var<uniform> p: P;
${LIN}
${MAIN} {
  let k = lin(g, nw);
  if (k >= p.count) { return; }
  let i = p.t0 * p.w + k;
  let al = (alpha[i >> 2u] >> ((i & 3u) * 8u)) & 255u;
  if (al == 0u || al == 255u) { return; }
  let kr = (p.t0 - p.ry0) * p.w + k;
  let a = f32(al) / 255.0;
  let bf = outF[kr] / (bA[kr] + 1e-5);
  let bb = outB[kr] / (1.0 - bA[kr] + 1e-5);
  let ic = f32((image[i] >> (p.c * 8u)) & 255u) / 255.0;
  let v = bf + a * (ic - a * bf - (1.0 - a) * bb);
  let bv = u32(floor(clamp(v, 0.0, 1.0) * 255.0 + 0.5));
  let sh = p.c * 8u;
  out[i] = (out[i] & ~(255u << sh)) | (bv << sh);
}`

/** `tightenAlpha`: every alpha byte through a 256-entry table made on the CPU, so it is exact. Bindings: lut, alpha words (in place), params { n }. */
export const TIGHTEN_LUT = `
struct P { n: u32 }
@group(0) @binding(0) var<storage, read> lut: array<u32>;
@group(0) @binding(1) var<storage, read_write> alpha: array<u32>;
@group(0) @binding(2) var<uniform> p: P;
${LIN}
${MAIN} {
  let word = lin(g, nw);
  let first = word * 4u;
  if (first >= p.n) { return; }
  let old4 = alpha[word];
  var out = 0u;
  for (var k = 0u; k < 4u; k++) {
    if (first + k >= p.n) { break; }
    out |= lut[(old4 >> (k * 8u)) & 255u] << (k * 8u);
  }
  alpha[word] = out;
}`
