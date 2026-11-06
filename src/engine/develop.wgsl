// 現像シェーダー（仕様 3.2 の処理段 1〜3、5〜11 と、ベース層を読む処理段 4）。
// 式は src/color/pipeline.ts の developPixel と同じ（各段の式は src/color/*.ts の先頭コメント）。
// 定数（OKLab 行列・HSL 色域の中心など）は develop.ts が TS の値から生成して下の CONSTS の印に入れる。
// 出力フォーマットは dst の FORMAT の印に入る。8bit 出力のときだけ DITHER = true（パリティ用の float 出力ではディザしない）。
// 既定値の処理段は uniform の値で分岐して省略する（仕様 3.2）。
// Params・処理段 1〜3・手動バイリニアは common.wgsl（develop.ts が先頭に連結する。localtone.wgsl と共有）。

/*@CONSTS@*/

struct Pass {
  m0: vec4<f32>,              // SampleTransform の行 0..2
  m1: vec4<f32>,
  m2: vec4<f32>,
  rect: vec4<u32>,            // outRect x, y, w, h
  flags: vec4<u32>,           // srcMip, lutMask（bit: tone, rgb, r, g, b。1 = 適用）, hslOn, gradingOn
}

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<uniform> S: Pass;
@group(0) @binding(2) var<storage, read> luts: array<f32>;
@group(0) @binding(3) var src: texture_2d<f32>;
@group(0) @binding(4) var base: texture_2d<f32>;
@group(0) @binding(5) var dst: texture_storage_2d</*@FORMAT@*/, write>;

const TAU: f32 = 6.283185307179586;
const PI: f32 = 3.141592653589793;

// ---- 伝達関数 ----
fn srgbEotf(v: f32) -> f32 {
  return select(pow((v + 0.055) / 1.055, 2.4), v / 12.92, v <= 0.04045);
}
fn srgbOetf(v: f32) -> f32 {
  return select(1.055 * pow(max(v, 0.0031308), 1.0 / 2.4) - 0.055, v * 12.92, v <= 0.0031308);
}

// ---- OKLab ----
fn cbrt(x: f32) -> f32 {
  let a = abs(x);
  return select(sign(x) * pow(a, 1.0 / 3.0), 0.0, a == 0.0);
}
fn toOklab(c: vec3<f32>) -> vec3<f32> {
  let lms = REC2020_TO_LMS * c;
  return LMS_TO_OKLAB * vec3<f32>(cbrt(lms.x), cbrt(lms.y), cbrt(lms.z));
}
fn fromOklab(lab: vec3<f32>) -> vec3<f32> {
  let l = OKLAB_TO_LMS * lab;
  return LMS_TO_REC2020 * (l * l * l);
}

// ---- 処理段 4・5・6（tone.ts） ----
fn localToneGain(B: f32, h: f32, s: f32) -> f32 {
  let L = log2(max(B, 9.5367431640625e-7) / MID_GRAY);
  let d = 2.0 * h * smoothstep(-1.0, 2.0, L) + 2.0 * s * (1.0 - smoothstep(-4.0, 0.0, L));
  return exp2(d);
}
fn contrastGain(Y: f32, c: f32, w: f32, b: f32) -> f32 {
  let x = log2(max(Y, 1e-10) / MID_GRAY);
  let d = 1.5 * c * tanh(x / 2.5) + 0.75 * w * smoothstep(0.0, 2.5, x) + 1.5 * b * (1.0 - smoothstep(-6.0, -1.5, x));
  return exp2(d);
}
fn baseToneMap(rgb: vec3<f32>) -> vec3<f32> {
  let Yp = max(luminance(rgb), 1e-10);
  let Yc = min(Yp, 4.0);
  let f = (Yc * (1.0 + Yc / 16.0)) / (1.0 + Yc);
  let c = rgb * (f / Yp);
  let m = max(c.x, max(c.y, c.z));
  let t = clamp((m - 1.0) / max(m - f, 1e-6), 0.0, 1.0);
  return mix(c, vec3<f32>(f), t);
}

// ---- 精度を保証した三角関数 ----
// GPU の組み込み sin/cos/atan2 は精度の保証が粗い（Vulkan: sin/cos は絶対誤差 2^-11）ため、色相の回転と色域の重みでは
// 級数で計算する（誤差 1e-7 程度）。
fn atanSmall(z: f32) -> f32 {   // |z| ≤ tan(π/8)
  let z2 = z * z;
  return z * (1.0 + z2 * (-1.0 / 3.0 + z2 * (1.0 / 5.0 + z2 * (-1.0 / 7.0 + z2 * (1.0 / 9.0
    + z2 * (-1.0 / 11.0 + z2 * (1.0 / 13.0 + z2 * (-1.0 / 15.0))))))));
}
fn atan2p(y: f32, x: f32) -> f32 {
  let ax = abs(x);
  let ay = abs(y);
  let r = min(ax, ay) / max(max(ax, ay), 1e-30);
  var a = select(atanSmall(r), PI / 4.0 + atanSmall((r - 1.0) / (r + 1.0)), r > 0.41421356);
  if (ay > ax) { a = PI / 2.0 - a; }
  if (x < 0.0) { a = PI - a; }
  return select(a, -a, y < 0.0);
}
fn sinSmall(x: f32) -> f32 {    // |x| ≤ π/6
  let x2 = x * x;
  return x * (1.0 + x2 * (-1.0 / 6.0 + x2 * (1.0 / 120.0 + x2 * (-1.0 / 5040.0 + x2 * (1.0 / 362880.0)))));
}
fn cosSmall(x: f32) -> f32 {
  let x2 = x * x;
  return 1.0 + x2 * (-0.5 + x2 * (1.0 / 24.0 + x2 * (-1.0 / 720.0 + x2 * (1.0 / 40320.0 + x2 * (-1.0 / 3628800.0)))));
}

// ---- 処理段 7・9（hsl.ts） ----
fn vibranceSaturation(lab: vec3<f32>, v: f32, s: f32) -> vec3<f32> {
  let C = length(lab.yz);
  let cosd = (lab.y * SKIN_COS + lab.z * SKIN_SIN) / max(C, 1e-8);
  let skin = smoothstep(SKIN_EDGE, 1.0, cosd);
  let vEff = v - 0.6 * skin * max(v, 0.0);
  let kv = 1.0 + vEff * (1.0 - smoothstep(0.0, 0.2, C));
  let k = max(0.0, (1.0 + s) * kv);
  return vec3<f32>(lab.x, lab.yz * k);
}
fn applyHsl(lab: vec3<f32>) -> vec3<f32> {
  let C = length(lab.yz);
  let hue = select(0.0, atan2p(lab.z, lab.y), C > 0.0);
  var d = vec3<f32>(0.0);
  for (var i = 0u; i < 8u; i++) {
    let x = hue - HSL_C[i];
    let dd = x - TAU * floor(x / TAU + 0.5);
    let t = select(-dd / HSL_PREV[i], dd / HSL_NEXT[i], dd >= 0.0);
    let w = 1.0 - smoothstep(0.0, 1.0, t);
    d += w * P.hsl[i].xyz;
  }
  let th = d.x * (PI / 6.0);
  let cs = cosSmall(th);
  let sn = sinSmall(th);
  let k = max(0.0, 1.0 + d.y);
  return vec3<f32>(
    lab.x * (1.0 + 0.3 * d.z * smoothstep(0.0, 0.04, C)),
    (lab.y * cs - lab.z * sn) * k,
    (lab.y * sn + lab.z * cs) * k,
  );
}

// ---- 処理段 10（grading.ts） ----
fn applyGrading(lab: vec3<f32>) -> vec3<f32> {
  let L = lab.x;
  let t = pow(max(L, 1e-6), exp2(-P.gradingExtra.y));
  let half = 0.1 + 0.4 * P.gradingExtra.x;
  let wS = 1.0 - smoothstep(1.0 / 3.0 - half, 1.0 / 3.0 + half, t);
  let wH = smoothstep(2.0 / 3.0 - half, 2.0 / 3.0 + half, t);
  let wM = 1.0 - wS - wH;
  let fade = min(1.0, 3.0 * max(L, 0.0));
  let g = wS * P.grading[0].xyz + wM * P.grading[1].xyz + wH * P.grading[2].xyz + P.grading[3].xyz;
  return vec3<f32>(L + g.z * GRADING_LUM, lab.y + g.x * GRADING_CHROMA * fade, lab.z + g.y * GRADING_CHROMA * fade);
}

// ---- 処理段 8（spline.ts の sampleLut。範囲外は傾き 1 で延長） ----
fn lutApply(k: u32, x: f32) -> f32 {
  let t = clamp(x, 0.0, 1.0) * f32(LUT_N - 1u);
  let i0 = min(u32(floor(t)), LUT_N - 1u);
  let i1 = min(i0 + 1u, LUT_N - 1u);
  let a = luts[k * LUT_N + i0];
  let b = luts[k * LUT_N + i1];
  return a + (b - a) * (t - f32(i0)) + (x - clamp(x, 0.0, 1.0));
}
fn curveChannel(v: f32, ch: u32, mask: u32) -> f32 {
  var e = srgbOetf(v);
  if ((mask & 1u) != 0u) { e = lutApply(0u, e); }
  if ((mask & 2u) != 0u) { e = lutApply(1u, e); }
  if ((mask & (4u << ch)) != 0u) { e = lutApply(2u + ch, e); }
  return srgbEotf(e);
}

fn hash(p: vec2<u32>, salt: u32) -> f32 {
  var h = (p.x * 0x8da6b343u) ^ (p.y * 0xd8163841u) ^ (salt * 0xcb1ab31fu);
  h = (h ^ (h >> 16u)) * 0x7feb352du;
  h = (h ^ (h >> 15u)) * 0x846ca68bu;
  h = h ^ (h >> 16u);
  return f32(h >> 8u) / 16777216.0;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= S.rect.z || id.y >= S.rect.w) { return; }
  let px = id.xy + S.rect.xy;
  let pc = vec3<f32>(vec2<f32>(px) + vec2<f32>(0.5, 0.5), 1.0);
  let q = vec3<f32>(dot(S.m0.xyz, pc), dot(S.m1.xyz, pc), dot(S.m2.xyz, pc));
  let uv = q.xy / q.z;
  let rgbIn = bilinear(src, S.flags.x, uv).xyz;

  // 1〜3
  var rgb = linearStages(rgbIn);
  // 4
  if (P.tone1.w != 0.0 || P.tone2.x != 0.0) {
    rgb *= localToneGain(bilinear(base, 0u, uv).x, P.tone1.w, P.tone2.x);
  }
  // 5
  if (any(P.tone1.xyz != vec3<f32>(0.0))) {
    rgb *= contrastGain(luminance(rgb), P.tone1.x, P.tone1.y, P.tone1.z);
  }
  // 6
  if (P.head.z == 1.0) { rgb = baseToneMap(rgb); }
  // 7
  if (P.tone2.y != 0.0 || P.tone2.z != 0.0) {
    rgb = fromOklab(vibranceSaturation(toOklab(rgb), P.tone2.y, P.tone2.z));
  }
  // 8
  let mask = S.flags.y;
  if (mask != 0u) {
    rgb = vec3<f32>(curveChannel(rgb.x, 0u, mask), curveChannel(rgb.y, 1u, mask), curveChannel(rgb.z, 2u, mask));
  }
  // 9・10
  if (S.flags.z != 0u || S.flags.w != 0u) {
    var lab = toOklab(rgb);
    if (S.flags.z != 0u) { lab = applyHsl(lab); }
    if (S.flags.w != 0u) { lab = applyGrading(lab); }
    rgb = fromOklab(lab);
  }
  // 11
  var o = clamp(mat3x(P.outM, rgb), vec3<f32>(0.0), vec3<f32>(1.0));
  if (P.head.w == 1.0) { o = vec3<f32>(srgbOetf(o.x), srgbOetf(o.y), srgbOetf(o.z)); }
  if (DITHER) {
    let n = vec3<f32>(hash(px, 1u) + hash(px, 2u), hash(px, 3u) + hash(px, 4u), hash(px, 5u) + hash(px, 6u)) - 1.0;
    o = clamp(o + n / 255.0, vec3<f32>(0.0), vec3<f32>(1.0));
  }
  textureStore(dst, px, vec4<f32>(o, 1.0));
}
