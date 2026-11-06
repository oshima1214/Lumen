// 処理段 4 のベース層（仕様 3.2・3.3、計画 Task 14）。式は src/color/pipeline.ts の baseLayerRef と同じ:
//   I = log2(max(Y, 2^-20))（Y は処理段 1〜3 後の輝度）、自己ガイドのガイデッドフィルター（半径 r、eps）、出力 exp2(q)。
// 中間値は vec2<f32> のストレージバッファ（ベース層の画素数ぶん）。box 平均は縦横に分け、窓は画像内だけで割る。
//   lum:   作業画像のミップ（cfg.mip）を UV で手動バイリニア → linearStages → (I, I²)
//   boxH:  横方向の box 平均（両成分）
//   boxV:  縦方向の box 平均。cfg.mode = 0 なら平均から (a, b) を、1 ならそのまま平均を書く
//   finish: q = mean(a)·I + mean(b) → exp2(q) を r32float に書く
// common.wgsl（Params・linearStages・bilinear）と LUMA 定数は localtone.ts が先頭に連結する。

struct Cfg { w: u32, h: u32, r: u32, mode: u32, mip: u32, eps: f32, pad0: u32, pad1: u32 }

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<uniform> cfg: Cfg;
@group(0) @binding(2) var src: texture_2d<f32>;
@group(0) @binding(3) var<storage, read> inBuf: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read_write> outBuf: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read> abBuf: array<vec2<f32>>;
@group(0) @binding(6) var dst: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn lum(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= cfg.w || id.y >= cfg.h) { return; }
  let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5, 0.5)) / vec2<f32>(f32(cfg.w), f32(cfg.h));
  let Y = luminance(linearStages(bilinear(src, cfg.mip, uv).xyz));
  let I = log2(max(Y, 9.5367431640625e-7));
  outBuf[id.y * cfg.w + id.x] = vec2<f32>(I, I * I);
}

@compute @workgroup_size(8, 8)
fn boxH(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= cfg.w || id.y >= cfg.h) { return; }
  let x0 = u32(max(i32(id.x) - i32(cfg.r), 0));
  let x1 = min(id.x + cfg.r, cfg.w - 1u);
  var s = vec2<f32>(0.0);
  for (var x = x0; x <= x1; x++) { s += inBuf[id.y * cfg.w + x]; }
  outBuf[id.y * cfg.w + id.x] = s / f32(x1 - x0 + 1u);
}

@compute @workgroup_size(8, 8)
fn boxV(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= cfg.w || id.y >= cfg.h) { return; }
  let y0 = u32(max(i32(id.y) - i32(cfg.r), 0));
  let y1 = min(id.y + cfg.r, cfg.h - 1u);
  var s = vec2<f32>(0.0);
  for (var y = y0; y <= y1; y++) { s += inBuf[y * cfg.w + id.x]; }
  let m = s / f32(y1 - y0 + 1u);
  var o = m;
  if (cfg.mode == 0u) {
    let v = max(0.0, m.y - m.x * m.x);
    let a = v / (v + cfg.eps);
    o = vec2<f32>(a, m.x - a * m.x);
  }
  outBuf[id.y * cfg.w + id.x] = o;
}

@compute @workgroup_size(8, 8)
fn finish(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= cfg.w || id.y >= cfg.h) { return; }
  let i = id.y * cfg.w + id.x;
  let ab = abBuf[i];
  textureStore(dst, id.xy, vec4<f32>(exp2(ab.x * inBuf[i].x + ab.y), 0.0, 0.0, 1.0));
}
