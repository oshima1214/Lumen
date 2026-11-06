// 作業画像のアップロードとピラミッド（仕様 3.1、計画 Task 12）。
// Uint16 RGB をストレージバッファ（u32 に 2 値ずつ）で送り、コンピュートで rgba16float に展開する。
// 大きな画像は maxStorageBufferBindingSize（と 64MiB）に収まる行数ずつに分けて送る。
// ミップは 2×2 平均のコンピュートで生成する（mipCount = floor(log2(max(w,h))) + 1）。
import type { Gpu } from './gpu';
import shaderSrc from './upload.wgsl?raw';

export interface GpuImage {
  /** rgba16float、全ミップあり */
  texture: GPUTexture;
  width: number;
  height: number;
  mipCount: number;
  destroy(): void;
}

export const WORKING_FORMAT: GPUTextureFormat = 'rgba16float';
const CHUNK_BYTES = 64 * 1024 * 1024;

export function mipCountFor(width: number, height: number): number {
  return Math.floor(Math.log2(Math.max(width, height, 1))) + 1;
}

interface Pipelines { unpack: GPUComputePipeline; downsample: GPUComputePipeline }
const cache = new WeakMap<GPUDevice, Pipelines>();

function pipelines(device: GPUDevice): Pipelines {
  let p = cache.get(device);
  if (!p) {
    const module = device.createShaderModule({ label: 'upload', code: shaderSrc });
    p = {
      unpack: device.createComputePipeline({ label: 'unpack', layout: 'auto', compute: { module, entryPoint: 'unpack' } }),
      downsample: device.createComputePipeline({ label: 'downsample', layout: 'auto', compute: { module, entryPoint: 'downsample' } }),
    };
    cache.set(device, p);
  }
  return p;
}

/** texture の全ミップを mip 0 から作り直す（rgba16float、STORAGE_BINDING 必須） */
export function generateMips(gpu: Gpu, texture: GPUTexture): void {
  const { device } = gpu;
  const { downsample } = pipelines(device);
  const enc = device.createCommandEncoder({ label: 'mips' });
  for (let level = 1; level < texture.mipLevelCount; level++) {
    const w = Math.max(1, texture.width >> level), h = Math.max(1, texture.height >> level);
    const bind = device.createBindGroup({
      layout: downsample.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }) },
        { binding: 1, resource: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }) },
      ],
    });
    const pass = enc.beginComputePass();
    pass.setPipeline(downsample);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
    pass.end();
  }
  device.queue.submit([enc.finish()]);
}

/** opts.chunkBytes はテスト用（1 回に送る最大バイト数） */
export function uploadRgb16(gpu: Gpu, data: Uint16Array, width: number, height: number, opts: { chunkBytes?: number } = {}): GpuImage {
  if (data.length < width * height * 3) throw new Error(`uploadRgb16: データが足りません（${data.length} < ${width * height * 3}）`);
  const { device } = gpu;
  const mipCount = mipCountFor(width, height);
  const texture = device.createTexture({
    label: 'working',
    size: { width, height },
    format: WORKING_FORMAT,
    mipLevelCount: mipCount,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
  });
  const { unpack } = pipelines(device);
  const rowBytes = width * 6;
  const maxBytes = Math.min(opts.chunkBytes ?? CHUNK_BYTES, gpu.limits.maxStorageBufferBindingSize);
  const rowsPerChunk = Math.max(1, Math.min(height, Math.floor(maxBytes / rowBytes)));
  const chunkBytes = Math.ceil((rowsPerChunk * width * 3) / 2) * 4;
  const buffer = device.createBuffer({ label: 'upload', size: chunkBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const params = device.createBuffer({ label: 'upload-params', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bind = device.createBindGroup({
    layout: unpack.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer } },
      { binding: 1, resource: { buffer: params } },
      { binding: 2, resource: texture.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
    ],
  });
  for (let y0 = 0; y0 < height; y0 += rowsPerChunk) {
    const rows = Math.min(rowsPerChunk, height - y0);
    const n = rows * width * 3;
    const chunk = new Uint16Array(n + (n & 1));
    chunk.set(data.subarray(y0 * width * 3, y0 * width * 3 + n));
    device.queue.writeBuffer(buffer, 0, chunk);
    device.queue.writeBuffer(params, 0, new Uint32Array([width, rows, y0, 0]));
    const enc = device.createCommandEncoder({ label: 'unpack' });
    const pass = enc.beginComputePass();
    pass.setPipeline(unpack);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(rows / 8));
    pass.end();
    device.queue.submit([enc.finish()]);
  }
  generateMips(gpu, texture);
  void device.queue.onSubmittedWorkDone().then(() => { buffer.destroy(); params.destroy(); });
  return { texture, width, height, mipCount, destroy: () => texture.destroy() };
}

// ---- 読み戻し（テスト・ヒストグラム用） ----

const TEXEL: Partial<Record<GPUTextureFormat, { bytes: number; channels: number }>> = {
  rgba16float: { bytes: 8, channels: 4 },
  rgba32float: { bytes: 16, channels: 4 },
  r16float: { bytes: 2, channels: 1 },
  r32float: { bytes: 4, channels: 1 },
  rgba8unorm: { bytes: 4, channels: 4 },
};

export function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

/** テクスチャの 1 段を Float32Array（行優先、チャンネル数はフォーマット通り）で読む */
export async function readTexture(gpu: Gpu, tex: GPUTexture, mip = 0): Promise<Float32Array> {
  const info = TEXEL[tex.format];
  if (!info) throw new Error(`readTexture: 未対応のフォーマット ${tex.format}`);
  const { device } = gpu;
  const w = Math.max(1, tex.width >> mip), h = Math.max(1, tex.height >> mip);
  const bytesPerRow = Math.ceil((w * info.bytes) / 256) * 256;
  const buf = device.createBuffer({ size: bytesPerRow * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture: tex, mipLevel: mip }, { buffer: buf, bytesPerRow, rowsPerImage: h }, { width: w, height: h });
  device.queue.submit([enc.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const raw = buf.getMappedRange();
  const n = w * info.channels;
  const out = new Float32Array(w * h * info.channels);
  for (let y = 0; y < h; y++) {
    const off = y * bytesPerRow;
    if (tex.format === 'rgba16float' || tex.format === 'r16float') {
      const row = new Uint16Array(raw, off, n);
      for (let i = 0; i < n; i++) out[y * n + i] = halfToFloat(row[i]!);
    } else if (tex.format === 'rgba8unorm') {
      const row = new Uint8Array(raw, off, n);
      for (let i = 0; i < n; i++) out[y * n + i] = row[i]! / 255;
    } else {
      out.set(new Float32Array(raw, off, n), y * n);
    }
  }
  buf.unmap();
  buf.destroy();
  return out;
}
