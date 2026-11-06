// 局所トーン（処理段 4 のベース層。仕様 3.2・3.3・3.4、計画 Task 14）。式は src/color/pipeline.ts の baseLayerRef。
// ベース層は作業画像のミップのうち長辺 BASE_LAYER_EDGE 以上で最小の段から、切り抜きと無関係に画像全体で作る。
// 大きさは baseLayerSize（長辺 512。作業画像がそれより小さければ同寸）。ミップの大きさと違えば UV で手動バイリニアして縮める。
// 出力は r32float（DevelopPass が textureLoad で手動バイリニアするので filterable でなくてよい。f16 より精度がよい）。
// 処理段 1〜3（WB・露光）の結果に依存するので、それらのパラメータが変わったら build し直す。
import { BASE_LAYER_EDGE, BASE_LAYER_EPS, baseLayerRadius, baseLayerSize } from '../color/pipeline';
import { UNIFORM_FLOATS } from '../color/uniforms';
import { wgslLuma } from './develop';
import type { Gpu } from './gpu';
import type { GpuImage } from './upload';
import commonSrc from './common.wgsl?raw';
import shaderSrc from './localtone.wgsl?raw';

export { BASE_LAYER_EDGE, baseLayerRef } from '../color/pipeline';

/** 長辺が BASE_LAYER_EDGE 以上で最小のミップ段（画像がそれより小さければ 0） */
export function baseLayerMip(w: number, h: number): number {
  let level = 0;
  while (Math.max(w >> (level + 1), h >> (level + 1)) >= BASE_LAYER_EDGE) level++;
  return level;
}

type Stage = 'lum' | 'boxH' | 'boxV' | 'finish';

export class LocalTonePass {
  private readonly device: GPUDevice;
  private readonly pipelines: Record<Stage, GPUComputePipeline>;
  private readonly params: GPUBuffer;
  private bufs: GPUBuffer[] = [];
  private out: GPUTexture | null = null;

  constructor(gpu: Gpu) {
    this.device = gpu.device;
    const module = this.device.createShaderModule({ label: 'localtone', code: `${wgslLuma()}\n${commonSrc}\n${shaderSrc}` });
    const make = (entryPoint: Stage) =>
      this.device.createComputePipeline({ label: `localtone-${entryPoint}`, layout: 'auto', compute: { module, entryPoint } });
    this.pipelines = { lum: make('lum'), boxH: make('boxH'), boxV: make('boxV'), finish: make('finish') };
    this.params = this.device.createBuffer({ label: 'localtone-params', size: UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  private ensure(w: number, h: number): GPUTexture {
    if (this.out && this.out.width === w && this.out.height === h) return this.out;
    this.out?.destroy();
    for (const b of this.bufs) b.destroy();
    this.bufs = [0, 1, 2].map((i) => this.device.createBuffer({ label: `localtone-${i}`, size: w * h * 8, usage: GPUBufferUsage.STORAGE }));
    this.out = this.device.createTexture({
      label: 'base-layer', size: { width: w, height: h }, format: 'r32float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    return this.out;
  }

  /**
   * ベース層を作る。u は packUniforms の結果（処理段 1〜3 の WB・露光だけを使う）。
   * 返すテクスチャはこのパスが持ち、次に大きさの違う build をするか destroy() するまで有効（同じ大きさなら上書き）。
   */
  build(img: GpuImage, u: Float32Array): GPUTexture {
    if (u.length !== UNIFORM_FLOATS) throw new Error(`uniform は ${UNIFORM_FLOATS} floats（${u.length}）`);
    const { device } = this;
    const { w, h } = baseLayerSize(img.width, img.height);
    const out = this.ensure(w, h);
    const [b0, b1, b2] = this.bufs as [GPUBuffer, GPUBuffer, GPUBuffer];
    device.queue.writeBuffer(this.params, 0, new Float32Array(u));
    const cfg = (mode: number) => {
      const buf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const data = new ArrayBuffer(32);
      new Uint32Array(data).set([w, h, baseLayerRadius(w, h), mode, baseLayerMip(img.width, img.height)]);
      new Float32Array(data, 20, 1)[0] = BASE_LAYER_EPS;
      device.queue.writeBuffer(buf, 0, data);
      return buf;
    };
    const cfg0 = cfg(0), cfg1 = cfg(1);
    const enc = device.createCommandEncoder({ label: 'localtone' });
    const step = (stage: Stage, entries: GPUBindGroupEntry[]) => {
      const p = this.pipelines[stage];
      const pass = enc.beginComputePass();
      pass.setPipeline(p);
      pass.setBindGroup(0, device.createBindGroup({ layout: p.getBindGroupLayout(0), entries }));
      pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
      pass.end();
    };
    const c = (buf: GPUBuffer): GPUBindGroupEntry => ({ binding: 1, resource: { buffer: buf } });
    const rd = (buf: GPUBuffer): GPUBindGroupEntry => ({ binding: 3, resource: { buffer: buf } });
    const wr = (buf: GPUBuffer): GPUBindGroupEntry => ({ binding: 4, resource: { buffer: buf } });
    step('lum', [{ binding: 0, resource: { buffer: this.params } }, c(cfg0), { binding: 2, resource: img.texture.createView() }, wr(b0)]);
    step('boxH', [c(cfg0), rd(b0), wr(b1)]);
    step('boxV', [c(cfg0), rd(b1), wr(b2)]);   // (a, b)
    step('boxH', [c(cfg1), rd(b2), wr(b1)]);
    step('boxV', [c(cfg1), rd(b1), wr(b2)]);   // (mean a, mean b)
    step('finish', [c(cfg1), rd(b0), { binding: 5, resource: { buffer: b2 } }, { binding: 6, resource: out.createView() }]);
    device.queue.submit([enc.finish()]);
    cfg0.destroy();
    cfg1.destroy();
    return out;
  }

  destroy(): void {
    this.out?.destroy();
    this.out = null;
    for (const b of this.bufs) b.destroy();
    this.bufs = [];
    this.params.destroy();
  }
}
