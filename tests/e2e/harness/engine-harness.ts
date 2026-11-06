// E2E 専用の入口（engine/）。本番バンドルには入らない。tests/e2e/harness/serve.ts でバンドル・配信する。
import { createGpu, type Gpu } from '../../../src/engine/gpu';
import { readTexture, uploadRgb16 } from '../../../src/engine/upload';

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

const harness = { uploadAndRead, uploadInfo };
export type EngineHarness = typeof harness;

(window as unknown as { __engine: EngineHarness }).__engine = harness;
document.title = 'engine-harness-ready';
