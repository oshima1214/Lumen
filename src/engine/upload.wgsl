// 作業画像のアップロード（仕様 3.1）とミップ生成。
// unpack: Uint16 RGB（u32 に 2 値ずつ、下位 16bit が先）を rgba16float に展開（/65535、A = 1）。
//         行を分けて送るため、params.y0 から params.rows 行だけを書く。
// downsample: 1 段上のミップから 2×2 平均（奇数サイズの端は端の画素を繰り返す = 最終列/行は捨てる）。

struct UnpackParams { width: u32, rows: u32, y0: u32, pad: u32 }

@group(0) @binding(0) var<storage, read> packed: array<u32>;
@group(0) @binding(1) var<uniform> up: UnpackParams;
@group(0) @binding(2) var dstUnpack: texture_storage_2d<rgba16float, write>;

fn value(i: u32) -> f32 {
  let word = packed[i >> 1u];
  let v = (word >> ((i & 1u) * 16u)) & 0xFFFFu;
  return f32(v) / 65535.0;
}

@compute @workgroup_size(8, 8)
fn unpack(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= up.width || id.y >= up.rows) { return; }
  let i = (id.y * up.width + id.x) * 3u;
  textureStore(dstUnpack, vec2<u32>(id.x, id.y + up.y0), vec4<f32>(value(i), value(i + 1u), value(i + 2u), 1.0));
}

@group(0) @binding(0) var srcMip: texture_2d<f32>;
@group(0) @binding(1) var dstMip: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn downsample(@builtin(global_invocation_id) id: vec3<u32>) {
  let ds = textureDimensions(dstMip);
  if (id.x >= ds.x || id.y >= ds.y) { return; }
  let last = textureDimensions(srcMip, 0) - vec2<u32>(1u, 1u);
  let p = id.xy * 2u;
  let s = textureLoad(srcMip, min(p, last), 0)
        + textureLoad(srcMip, min(p + vec2<u32>(1u, 0u), last), 0)
        + textureLoad(srcMip, min(p + vec2<u32>(0u, 1u), last), 0)
        + textureLoad(srcMip, min(p + vec2<u32>(1u, 1u), last), 0);
  textureStore(dstMip, id.xy, s * 0.25);
}
