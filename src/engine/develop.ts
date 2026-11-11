// 現像パス（仕様 3.2、計画 Task 13）。処理段 1〜3、5〜11 を 1 つのコンピュートシェーダー（8×8）で行い、
// 処理段 4 はベース層テクスチャ（r32float、Task 14 の LocalTonePass）を入力 UV で手動バイリニア補間して読む。
// 入力（作業画像）も手動バイリニア（textureLoad 4 回）で読む: 恒等変換では画素中心をそのまま読むので参照実装と一致する。
// LUT は 5 本 × LUT_SIZE の f32 ストレージバッファ（tone, rgb, r, g, b の順）。恒等の LUT は適用しない。
import { GRADING_CHROMA, GRADING_LUM } from '../color/grading';
import { HSL_CENTERS_RAD, HSL_SPAN_NEXT, HSL_SPAN_PREV, SKIN_COS, SKIN_EDGE, SKIN_SIN } from '../color/hsl';
import { LMS_TO_OKLAB, LMS_TO_REC2020, OKLAB_TO_LMS, REC2020_TO_LMS } from '../color/oklab';
import type { Mat3 } from '../color/spaces';
import { LUT_SIZE } from '../color/spline';
import { LUMA_2020 } from '../color/tone';
import { UNIFORM_FLOATS, type Luts } from '../color/uniforms';
import type { SampleTransform } from './geometry';
import type { Gpu } from './gpu';
import commonSrc from './common.wgsl?raw';
import shaderTemplate from './develop.wgsl?raw';

export interface Rect { x: number; y: number; w: number; h: number }

/** DevelopPass が書ける出力フォーマット（rgba8unorm だけディザを付ける） */
export type DevelopOutFormat = 'rgba8unorm' | 'rgba16float' | 'rgba32float';

const f = (v: number): string => {
  const s = String(v);
  return /[.eE]/.test(s) ? s : `${s}.0`;
};
/** 行優先の Mat3 を WGSL の mat3x3（列ベクトルで構成）にする */
const mat = (m: Mat3): string => {
  const col = (c: number) => `vec3<f32>(${f(m[c]!)}, ${f(m[3 + c]!)}, ${f(m[6 + c]!)})`;
  return `mat3x3<f32>(${col(0)}, ${col(1)}, ${col(2)})`;
};
export const wgslLuma = (): string => `const LUMA = vec3<f32>(${LUMA_2020.map(f).join(', ')});`;
const arr = (a: readonly number[]) => `array<f32, ${a.length}>(${a.map(f).join(', ')})`;

export function developShaderSource(format: DevelopOutFormat): string {
  const consts = [
    wgslLuma(),
    `const REC2020_TO_LMS = ${mat(REC2020_TO_LMS)};`,
    `const LMS_TO_OKLAB = ${mat(LMS_TO_OKLAB)};`,
    `const OKLAB_TO_LMS = ${mat(OKLAB_TO_LMS)};`,
    `const LMS_TO_REC2020 = ${mat(LMS_TO_REC2020)};`,
    `var<private> HSL_C: array<f32, 8> = ${arr(HSL_CENTERS_RAD)};`,
    `var<private> HSL_NEXT: array<f32, 8> = ${arr(HSL_SPAN_NEXT)};`,
    `var<private> HSL_PREV: array<f32, 8> = ${arr(HSL_SPAN_PREV)};`,
    `const SKIN_COS: f32 = ${f(SKIN_COS)};`,
    `const SKIN_SIN: f32 = ${f(SKIN_SIN)};`,
    `const SKIN_EDGE: f32 = ${f(SKIN_EDGE)};`,
    `const GRADING_CHROMA: f32 = ${f(GRADING_CHROMA)};`,
    `const GRADING_LUM: f32 = ${f(GRADING_LUM)};`,
    `const LUT_N: u32 = ${LUT_SIZE}u;`,
    `const DITHER: bool = ${format === 'rgba8unorm'};`,
  ].join('\n');
  return shaderTemplate.replace('/*@CONSTS@*/', `${consts}\n${commonSrc}`).replace('/*@FORMAT@*/', format);
}

/** LUT が恒等（x_i = i/(n-1)）なら true */
export function isIdentityLut(lut: Float32Array): boolean {
  const n = lut.length;
  for (let i = 0; i < n; i++) if (Math.abs(lut[i]! - i / (n - 1)) > 1e-6) return false;
  return true;
}

const PASS_BYTES = 96;

export class DevelopPass {
  private readonly device: GPUDevice;
  private readonly pipelines = new Map<DevelopOutFormat, GPUComputePipeline>();
  private readonly params: GPUBuffer;
  private readonly lutBuf: GPUBuffer;
  private lutMask = 0;

  constructor(gpu: Gpu) {
    this.device = gpu.device;
    this.params = this.device.createBuffer({ label: 'develop-params', size: UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.lutBuf = this.device.createBuffer({ label: 'develop-luts', size: 5 * LUT_SIZE * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  }

  private pipeline(format: DevelopOutFormat): GPUComputePipeline {
    let p = this.pipelines.get(format);
    if (!p) {
      const module = this.device.createShaderModule({ label: `develop-${format}`, code: developShaderSource(format) });
      p = this.device.createComputePipeline({ label: `develop-${format}`, layout: 'auto', compute: { module, entryPoint: 'main' } });
      this.pipelines.set(format, p);
    }
    return p;
  }

  setLuts(luts: Luts): void {
    const all = new Float32Array(5 * LUT_SIZE);
    const list = [luts.tone, luts.rgb, luts.r, luts.g, luts.b];
    let mask = 0;
    list.forEach((l, i) => {
      if (l.length !== LUT_SIZE) throw new Error(`LUT の長さは ${LUT_SIZE}（${l.length}）`);
      all.set(l, i * LUT_SIZE);
      if (!isIdentityLut(l)) mask |= 1 << i;
    });
    this.lutMask = mask;
    this.device.queue.writeBuffer(this.lutBuf, 0, all);
  }

  /**
   * src の srcMip 段を読み、out（STORAGE_BINDING、DevelopOutFormat）の outRect 内の画素だけを書く。
   * u は packUniforms の結果。sample は出力画素（out 上の絶対座標）→ 入力 UV（geometry.ts）。
   * base は r32float のベース層（画像全体を覆う。処理段 4 が既定値なら読まない）。
   * baseMap: src が画像の一部（タイル）のとき、src の UV → ベース層の UV（uv * xy + zw）。
   */
  run(src: GPUTexture, srcMip: number, base: GPUTexture, u: Float32Array, out: GPUTexture, outRect: Rect,
    sample: SampleTransform, baseMap: readonly [number, number, number, number] = [1, 1, 0, 0]): void {
    if (u.length !== UNIFORM_FLOATS) throw new Error(`uniform は ${UNIFORM_FLOATS} floats（${u.length}）`);
    const format = out.format as DevelopOutFormat;
    const pipeline = this.pipeline(format);
    const { device } = this;
    device.queue.writeBuffer(this.params, 0, new Float32Array(u));

    const hslOn = u.subarray(52, 84).some((v) => v !== 0) ? 1 : 0;
    const gradingOn = u.subarray(84, 100).some((v) => v !== 0) ? 1 : 0;
    const pass = new ArrayBuffer(PASS_BYTES);
    const fl = new Float32Array(pass, 0, 12);
    const m = sample.m;
    for (let r = 0; r < 3; r++) fl.set([m[r * 3]!, m[r * 3 + 1]!, m[r * 3 + 2]!, 0], r * 4);
    new Uint32Array(pass, 48, 8).set([outRect.x, outRect.y, outRect.w, outRect.h, srcMip, this.lutMask, hslOn, gradingOn]);
    new Float32Array(pass, 80, 4).set(baseMap);
    const passBuf = device.createBuffer({ label: 'develop-pass', size: PASS_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(passBuf, 0, pass);

    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.params } },
        { binding: 1, resource: { buffer: passBuf } },
        { binding: 2, resource: { buffer: this.lutBuf } },
        { binding: 3, resource: src.createView({ baseMipLevel: 0, mipLevelCount: src.mipLevelCount }) },
        { binding: 4, resource: base.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
        { binding: 5, resource: out.createView({ baseMipLevel: 0, mipLevelCount: 1 }) },
      ],
    });
    const enc = device.createCommandEncoder({ label: 'develop' });
    const cp = enc.beginComputePass();
    cp.setPipeline(pipeline);
    cp.setBindGroup(0, bind);
    cp.dispatchWorkgroups(Math.ceil(outRect.w / 8), Math.ceil(outRect.h / 8));
    cp.end();
    device.queue.submit([enc.finish()]);
    passBuf.destroy();
  }

  destroy(): void {
    this.params.destroy();
    this.lutBuf.destroy();
  }
}

/** 輝度（w×h、行優先）を r32float のテクスチャにする（テスト用・Task 13 の仮ベース層） */
export function lumTexture(gpu: Gpu, lum: Float32Array, w: number, h: number): GPUTexture {
  const tex = gpu.device.createTexture({
    label: 'lum', size: { width: w, height: h }, format: 'r32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
  });
  gpu.device.queue.writeTexture({ texture: tex }, new Float32Array(lum), { bytesPerRow: w * 4, rowsPerImage: h }, { width: w, height: h });
  return tex;
}
