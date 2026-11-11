// 出力（rgba8unorm）のヒストグラム。bins: [0..255] R, [256..511] G, [512..767] B, 768 白飛び, 769 黒つぶれ
// 白飛び = いずれかのチャンネルが 255、黒つぶれ = いずれかのチャンネルが 0
@group(0) @binding(0) var img: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> bins: array<atomic<u32>, 770>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let size = textureDimensions(img);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let c = textureLoad(img, vec2<i32>(id.xy), 0).rgb;
  let q = vec3<u32>(round(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)) * 255.0));
  atomicAdd(&bins[q.r], 1u);
  atomicAdd(&bins[256u + q.g], 1u);
  atomicAdd(&bins[512u + q.b], 1u);
  if (max(q.r, max(q.g, q.b)) == 255u) { atomicAdd(&bins[768], 1u); }
  if (min(q.r, min(q.g, q.b)) == 0u) { atomicAdd(&bins[769], 1u); }
}
