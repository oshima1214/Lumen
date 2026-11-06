// E2E 専用の入口（engine/）。本番バンドルには入らない。tests/e2e/harness/serve.ts でバンドル・配信する。
import { createGpu, type Gpu } from '../../../src/engine/gpu';
import { readTexture, uploadRgb16 } from '../../../src/engine/upload';
import { DevelopPass, lumTexture } from '../../../src/engine/develop';
import { identitySample } from '../../../src/engine/geometry';
import { buildUniforms, packUniforms, type ImageColorInfo, type OutputSpace } from '../../../src/color/uniforms';
import { developPixel, luminance2020 } from '../../../src/color/pipeline';
import type { Vec3 } from '../../../src/color/spaces';
import { defaultParams } from '../../../src/params/defaults';
import { deepMerge } from '../../../src/params/partial';
import type { DeepPartial, DevelopParams } from '../../../src/params/types';

let gpuP: Promise<Gpu> | null = null;
const gpu = () => (gpuP ??= createGpu());

/** Task 12: Uint16 RGB をアップロードし、指定ミップを読み戻す */
async function uploadAndRead(data: number[], width: number, height: number, mip?: number, chunkBytes?: number) {
  const g = await gpu();
  const img = uploadRgb16(g, Uint16Array.from(data), width, height, chunkBytes ? { chunkBytes } : {});
  const level = mip ?? img.mipCount - 1;
  const px = await readTexture(g, img.texture, level);
  const res = { mipCount: img.mipCount, texMips: img.texture.mipLevelCount, format: img.texture.format, pixels: Array.from(px) };
  img.destroy();
  return res;
}

/** Task 12: 一様画像をページ内で作ってアップロードし、ミップ数だけ返す */
async function uploadInfo(width: number, height: number) {
  const g = await gpu();
  const img = uploadRgb16(g, new Uint16Array(width * height * 3).fill(1000), width, height);
  const res = { mipCount: img.mipCount, texMips: img.texture.mipLevelCount };
  img.destroy();
  return res;
}

/**
 * パリティ用の合成画像（Uint16 RGB、リニア値 × 65535）。行ごとに:
 *   0–7 灰色ランプ 0..1、8–11 暗部の細かいランプ 0..0.02、12–15 明部 0.9..1（と 1 超えはクリップ側）、
 *   16–23 原色・二次色（強度 0..1）、24–31 肌色、32–39 高彩度（片側 0）、40–63 疑似乱数色。
 */
export function testImage(w: number, h: number): Uint16Array {
  const d = new Uint16Array(w * h * 3);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const skins: Vec3[] = [[0.62, 0.42, 0.33], [0.45, 0.28, 0.2], [0.85, 0.65, 0.55], [0.3, 0.17, 0.11]];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = x / (w - 1);
    const band = Math.floor((y / h) * 8);
    let c: Vec3;
    switch (band) {
      case 0: c = [t, t, t]; break;
      case 1: c = y % 2 ? [t * 0.02, t * 0.02, t * 0.02] : [0.9 + 0.1 * t, 0.92 + 0.08 * t, 0.88 + 0.12 * t]; break;
      case 2: { const k = (x % 7) + 1; c = [k & 1 ? t : 0, k & 2 ? t : 0, k & 4 ? t : 0]; break; }
      case 3: { const s = skins[(x + y) % 4]!; const k = 0.3 + 0.7 * t; c = [s[0] * k, s[1] * k, s[2] * k]; break; }
      case 4: { const k = x % 6; const v = 0.2 + 0.8 * rnd();
        c = [[v, v * 0.1, 0], [0, v, v * 0.15], [v * 0.05, 0, v], [v, v, 0], [0, v, v], [v, 0, v]][k] as Vec3; break; }
      default: c = [rnd(), rnd(), rnd()]; break;
    }
    for (let k = 0; k < 3; k++) d[(y * w + x) * 3 + k] = Math.round(Math.min(1, Math.max(0, c[k]!)) * 65535);
  }
  return d;
}

export interface ParityCase { name: string; params: DeepPartial<DevelopParams>; img?: ImageColorInfo; out?: OutputSpace }
export interface ParityResult { name: string; maxErr: number; at: string }

interface Fixture { src: Float32Array; lum: Float32Array; img: ReturnType<typeof uploadRgb16>; base: GPUTexture; w: number; h: number }

async function fixture(w: number, h: number, baseLum?: (src: Float32Array) => Float32Array): Promise<Fixture> {
  const g = await gpu();
  const img = uploadRgb16(g, testImage(w, h), w, h);
  const src = await readTexture(g, img.texture, 0);   // rgba16float に量子化された入力をそのまま参照実装へ渡す
  let lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = luminance2020([src[i * 4]!, src[i * 4 + 1]!, src[i * 4 + 2]!]);
  if (baseLum) lum = Float32Array.from(baseLum(src));
  return { src, lum, img, base: lumTexture(g, lum, w, h), w, h };
}

function outTexture(g: Gpu, w: number, h: number): GPUTexture {
  return g.device.createTexture({
    size: { width: w, height: h }, format: 'rgba32float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
  });
}

function compare(name: string, fx: Fixture, out: Float32Array, u: ReturnType<typeof buildUniforms>, only?: (x: number, y: number) => boolean): ParityResult {
  let maxErr = 0, at = '';
  for (let y = 0; y < fx.h; y++) for (let x = 0; x < fx.w; x++) {
    if (only && !only(x, y)) continue;
    const i = y * fx.w + x;
    const ref = developPixel([fx.src[i * 4]!, fx.src[i * 4 + 1]!, fx.src[i * 4 + 2]!], fx.lum[i]!, u.u, u.luts);
    for (let c = 0; c < 3; c++) {
      const e = Math.abs(out[i * 4 + c]! - ref[c]!);
      if (!(e <= maxErr)) { maxErr = Number.isNaN(e) ? Infinity : e; at = `(${x},${y}) c${c} gpu=${out[i * 4 + c]} ref=${ref[c]}`; }
    }
  }
  return { name, maxErr, at };
}

/** Task 13: 各ケースを GPU と developPixel で現像し、全画素の最大差を返す */
async function developParity(cases: ParityCase[]): Promise<ParityResult[]> {
  const g = await gpu();
  const W = 64, H = 64;
  const fx = await fixture(W, H);
  const out = outTexture(g, W, H);
  const pass = new DevelopPass(g);
  const results: ParityResult[] = [];
  for (const c of cases) {
    const built = buildUniforms(deepMerge<DevelopParams>(defaultParams(), c.params), c.img ?? { kind: 'display' }, c.out ?? 'srgb');
    pass.setLuts(built.luts);
    pass.run(fx.img.texture, 0, fx.base, packUniforms(built.u), out, { x: 0, y: 0, w: W, h: H }, identitySample(W, H));
    results.push(compare(c.name, fx, await readTexture(g, out), built));
  }
  pass.destroy();
  out.destroy();
  fx.img.destroy();
  return results;
}

/** Task 13: outRect の外を書かないこと */
async function developRect() {
  const g = await gpu();
  const W = 40, H = 40;
  const fx = await fixture(W, H);
  const out = outTexture(g, W, H);
  g.device.queue.writeTexture({ texture: out }, new Float32Array(W * H * 4).fill(-7), { bytesPerRow: W * 16 }, { width: W, height: H });
  const pass = new DevelopPass(g);
  const built = buildUniforms(deepMerge(defaultParams(), { basic: { exposure: 0.5, contrast: 20 } }), { kind: 'display' }, 'srgb');
  pass.setLuts(built.luts);
  const r = { x: 8, y: 4, w: 13, h: 27 };
  pass.run(fx.img.texture, 0, fx.base, packUniforms(built.u), out, r, identitySample(W, H));
  const px = await readTexture(g, out);
  const inside = (x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  let outsideUntouched = true;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inside(x, y) && px[(y * W + x) * 4] !== -7) outsideUntouched = false;
  }
  const res = compare('rect', fx, px, built, inside);
  pass.destroy();
  return { outsideUntouched, insideMaxErr: res.maxErr };
}

const harness = { uploadAndRead, uploadInfo, developParity, developRect };
export type EngineHarness = typeof harness;

(window as unknown as { __engine: EngineHarness }).__engine = harness;
document.title = 'engine-harness-ready';
