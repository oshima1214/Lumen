// develop.wgsl と localtone.wgsl で共有する部分（Params の並びは src/color/uniforms.ts の packUniforms）。
// 処理段 1〜3 は src/color/pipeline.ts の linearStages と同じ式。LUMA は呼び出し側の定数として連結時に与える。

struct Params {
  head: vec4<f32>,            // kind, exposureMul, baseToneMap, outOetf
  wbMul: vec4<f32>,
  cam: array<vec4<f32>, 3>,
  dwb: array<vec4<f32>, 3>,
  outM: array<vec4<f32>, 3>,
  tone1: vec4<f32>,           // contrast, whites, blacks, highlights
  tone2: vec4<f32>,           // shadows, vibrance, saturation, 0
  hsl: array<vec4<f32>, 8>,
  grading: array<vec4<f32>, 4>,
  gradingExtra: vec4<f32>,    // blending, balance
}

const MID_GRAY: f32 = 0.18;

fn mat3x(m: array<vec4<f32>, 3>, v: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(dot(m[0].xyz, v), dot(m[1].xyz, v), dot(m[2].xyz, v));
}

fn luminance(c: vec3<f32>) -> f32 { return dot(LUMA, c); }

// ---- 入力の読み取り（手動バイリニア、端は端の画素） ----
fn bilinear(t: texture_2d<f32>, mip: u32, uv: vec2<f32>) -> vec4<f32> {
  let size = textureDimensions(t, mip);
  let last = vec2<i32>(size) - vec2<i32>(1, 1);
  let p = uv * vec2<f32>(size) - vec2<f32>(0.5, 0.5);
  let f0 = floor(p);
  let f = p - f0;
  let i0 = vec2<i32>(f0);
  let a = clamp(i0, vec2<i32>(0, 0), last);
  let b = clamp(i0 + vec2<i32>(1, 1), vec2<i32>(0, 0), last);
  let c00 = textureLoad(t, a, i32(mip));
  let c10 = textureLoad(t, vec2<i32>(b.x, a.y), i32(mip));
  let c01 = textureLoad(t, vec2<i32>(a.x, b.y), i32(mip));
  let c11 = textureLoad(t, b, i32(mip));
  return mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
}

// ---- 処理段 1〜3（WB、カメラ → Rec.2020・ハイライト処理、露光） ----
fn linearStages(rgbIn: vec3<f32>) -> vec3<f32> {
  var rgb: vec3<f32>;
  if (P.head.x == 1.0) {
    let c = min(rgbIn * P.wbMul.xyz, vec3<f32>(1.0));
    let w = smoothstep(0.8, 1.0, min(c.x, min(c.y, c.z)));
    let m = mat3x(P.cam, c);
    rgb = mix(m, vec3<f32>(luminance(m)), w);
  } else {
    rgb = mat3x(P.dwb, rgbIn);
  }
  return rgb * P.head.y;
}
