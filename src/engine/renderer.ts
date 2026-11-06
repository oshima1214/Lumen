// プレビュー描画（仕様 3.3・3.4・5.1）。作業画像を GPU に載せ、切り抜き・回転・向きをサンプリング変換で適用して
// canvas に描く。ヒストグラムは最後に描いた出力から計算する。
import { buildUniforms, packUniforms, type OutputSpace } from '../color/uniforms';
import { defaultParams } from '../params/defaults';
import type { DevelopParams } from '../params/types';
import type { WorkingImage } from '../decode/types';
import { DevelopPass } from './develop';
import { GpuOutOfMemoryError } from './errors';
import { createGpu, type Gpu } from './gpu';
import { orientedSize, sampleTransform } from './geometry';
import { LocalTonePass } from './localtone';
import { uploadRgb16, type GpuImage } from './upload';
import histogramSrc from './histogram.wgsl?raw';

export { GpuOutOfMemoryError };

export interface ViewState {
  mode: 'fit' | '100';
  /** 表示中心（切り抜き後の画像上の正規化座標）。fit では無視 */
  cx: number; cy: number;
  /** true なら編集前（既定パラメータ。切り抜きと向きは現在の値を使う） */
  before: boolean;
  /** 写真の周囲の背景（UI 側の CSS で使う。Renderer は描かない） */
  background: 'black' | 'dark' | 'gray18';
  /** 描画先の大きさ（デバイスピクセル） */
  viewport: { w: number; h: number };
}

export interface Histogram { r: Uint32Array; g: Uint32Array; b: Uint32Array; clipHigh: number; clipLow: number }

export interface RendererOptions {
  previewCap: number;
  outSpace?: OutputSpace;
  /** デバイス喪失時に新しい GPU を作る（既定 createGpu） */
  recreateGpu?: () => Promise<Gpu>;
}

const OUT_FORMAT: GPUTextureFormat = 'rgba8unorm';

export class Renderer {
  private gpu: Gpu;
  private develop: DevelopPass;
  private localTone: LocalTonePass;
  private histPipeline: GPUComputePipeline;
  private ctx: GPUCanvasContext;
  private img: WorkingImage | null = null;
  private gimg: GpuImage | null = null;
  private dummyBase: GPUTexture;
  private out: GPUTexture | null = null;
  private baseKey = '';
  private base: GPUTexture | null = null;
  private pending: { p: DevelopParams; view: ViewState } | null = null;
  private raf = 0;
  private ready: Promise<void> = Promise.resolve();
  private last: { p: DevelopParams; view: ViewState } | null = null;
  private readonly outSpace: OutputSpace;

  constructor(gpu: Gpu, private readonly canvas: HTMLCanvasElement | OffscreenCanvas, private readonly opts: RendererOptions) {
    this.outSpace = opts.outSpace ?? 'srgb';
    const ctx = canvas.getContext('webgpu');
    if (!ctx) throw new Error('WebGPU の canvas を作れません');
    this.ctx = ctx as GPUCanvasContext;
    this.gpu = gpu;
    ({ develop: this.develop, localTone: this.localTone, hist: this.histPipeline, dummy: this.dummyBase } = this.build(gpu));
    this.watchLost();
  }

  private build(gpu: Gpu) {
    const { device } = gpu;
    this.ctx.configure({ device, format: OUT_FORMAT, usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      alphaMode: 'opaque', colorSpace: this.outSpace === 'p3' ? 'display-p3' : 'srgb' });
    const module = device.createShaderModule({ label: 'histogram', code: histogramSrc });
    const dummy = device.createTexture({ size: { width: 1, height: 1 }, format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: dummy }, new Float32Array([0.18]), {}, { width: 1, height: 1 });
    return { develop: new DevelopPass(gpu), localTone: new LocalTonePass(gpu),
      hist: device.createComputePipeline({ label: 'histogram', layout: 'auto', compute: { module, entryPoint: 'main' } }), dummy };
  }

  private watchLost(): void {
    const gpu = this.gpu;
    gpu.onLost(() => {
      if (gpu !== this.gpu) return;
      this.ready = (async () => {
        this.gpu = await (this.opts.recreateGpu ?? createGpu)();
        ({ develop: this.develop, localTone: this.localTone, hist: this.histPipeline, dummy: this.dummyBase } = this.build(this.gpu));
        this.gimg = null; this.out = null; this.base = null; this.baseKey = '';
        if (this.img) await this.upload(this.img);
        this.watchLost();
        if (this.last) this.draw(this.last.p, this.last.view);
      })();
    });
  }

  /** デバイス喪失からの復帰が終わるまで待つ */
  whenReady(): Promise<void> { return this.ready; }

  private async upload(img: WorkingImage): Promise<void> {
    const max = this.gpu.limits.maxTextureDimension2D;
    if (img.width > max || img.height > max) throw new GpuOutOfMemoryError(`画像が GPU の上限（${max}px）を超えています`);
    const { device } = this.gpu;
    device.pushErrorScope('out-of-memory');
    let g: GpuImage | null = null;
    try { g = uploadRgb16(this.gpu, img.pixels, img.width, img.height); } finally {
      const err = await device.popErrorScope();
      if (err) { g?.destroy(); throw new GpuOutOfMemoryError(err.message); }
    }
    this.gimg?.destroy();
    this.gimg = g;
    this.baseKey = '';
  }

  /** 作業画像を GPU に載せる。上限超え・メモリ確保失敗は GpuOutOfMemoryError で reject */
  async setImage(img: WorkingImage): Promise<void> {
    await this.ready;
    await this.upload(img);
    this.img = img;
  }

  /** 次のアニメーションフレームで描く（連続呼び出しは最後の 1 回にまとめる） */
  render(p: DevelopParams, view: ViewState): void {
    this.pending = { p, view };
    if (this.raf) return;
    const run = () => { this.raf = 0; const x = this.pending; this.pending = null; if (x) this.draw(x.p, x.view); };
    this.raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : (setTimeout(run, 0) as unknown as number);
  }

  /** すぐに描いて GPU の完了を待つ（テスト・書き出し前の確認用） */
  async renderNow(p: DevelopParams, view: ViewState): Promise<void> {
    await this.ready;
    this.draw(p, view);
    await this.gpu.device.queue.onSubmittedWorkDone();
  }

  private outSize(p: DevelopParams, view: ViewState, img: WorkingImage): { w: number; h: number; zoom: number } {
    const o = orientedSize(img.width, img.height, img.orientation);
    const cw = o.w * p.crop.w, ch = o.h * p.crop.h;
    const vw = Math.max(1, view.viewport.w), vh = Math.max(1, view.viewport.h);
    if (view.mode === '100') {
      const fit = Math.min(vw / cw, vh / ch);
      return { w: vw, h: vh, zoom: img.fullWidth / img.width / fit };   // 元データ 1px = 出力 1px
    }
    const cap = this.opts.previewCap;
    const k = Math.min(vw / cw, vh / ch, cap / Math.max(cw, ch));
    return { w: Math.max(1, Math.round(cw * k)), h: Math.max(1, Math.round(ch * k)), zoom: 1 };
  }

  private draw(params: DevelopParams, view: ViewState): void {
    const img = this.img, g = this.gimg;
    if (!img || !g) return;
    this.last = { p: params, view };
    const p = view.before ? { ...defaultParams(), crop: params.crop } : params;
    const { device } = this.gpu;
    const size = this.outSize(p, view, img);
    if (this.canvas.width !== size.w || this.canvas.height !== size.h) { this.canvas.width = size.w; this.canvas.height = size.h; }
    if (!this.out || this.out.width !== size.w || this.out.height !== size.h) {
      this.out?.destroy();
      this.out = device.createTexture({ label: 'preview-out', size: { width: size.w, height: size.h }, format: OUT_FORMAT,
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
    }
    const { u, luts } = buildUniforms(p, img, this.outSpace);
    const packed = packUniforms(u);
    this.develop.setLuts(luts);
    // ハイライト／シャドウを使うときだけベース層を作る（WB・露光が変わったら作り直す。Task 14 の判断）
    let base = this.dummyBase;
    if (p.basic.highlights !== 0 || p.basic.shadows !== 0) {
      const key = JSON.stringify([p.wb, p.basic.exposure]);
      if (key !== this.baseKey || !this.base) { this.base = this.localTone.build(g, packed); this.baseKey = key; }
      base = this.base;
    }
    const view2 = view.mode === '100' ? { zoom: size.zoom, cx: view.cx, cy: view.cy } : undefined;
    const sample = sampleTransform({ w: img.width, h: img.height, o: img.orientation }, p.crop, { w: size.w, h: size.h }, view2);
    // 作業画像の何画素が出力 1 画素に当たるかでミップ段を選ぶ
    const o = orientedSize(img.width, img.height, img.orientation);
    const density = (o.w * p.crop.w) / (size.w * (view2?.zoom ?? 1)) ;
    const mip = Math.min(g.mipCount - 1, Math.max(0, Math.floor(Math.log2(Math.max(1, density)))));
    this.develop.run(g.texture, mip, base, packed, this.out, { x: 0, y: 0, w: size.w, h: size.h }, sample);
    const enc = device.createCommandEncoder({ label: 'present' });
    enc.copyTextureToTexture({ texture: this.out }, { texture: this.ctx.getCurrentTexture() }, { width: size.w, height: size.h });
    device.queue.submit([enc.finish()]);
  }

  /** 最後に描いた出力のヒストグラム */
  async histogram(): Promise<Histogram> {
    await this.ready;
    const out = this.out;
    if (!out) return { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), clipHigh: 0, clipLow: 0 };
    const { device } = this.gpu;
    const bins = device.createBuffer({ size: 770 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const read = device.createBuffer({ size: 770 * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const bind = device.createBindGroup({ layout: this.histPipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: out.createView() }, { binding: 1, resource: { buffer: bins } }] });
    const enc = device.createCommandEncoder({ label: 'histogram' });
    const cp = enc.beginComputePass();
    cp.setPipeline(this.histPipeline); cp.setBindGroup(0, bind);
    cp.dispatchWorkgroups(Math.ceil(out.width / 8), Math.ceil(out.height / 8));
    cp.end();
    enc.copyBufferToBuffer(bins, 0, read, 0, 770 * 4);
    device.queue.submit([enc.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const a = new Uint32Array(read.getMappedRange().slice(0));
    read.unmap(); read.destroy(); bins.destroy();
    return { r: a.slice(0, 256), g: a.slice(256, 512), b: a.slice(512, 768), clipHigh: a[768]!, clipLow: a[769]! };
  }

  /** 最後に描いた出力の RGBA8（テスト用） */
  async snapshot(): Promise<{ w: number; h: number; data: Uint8Array }> {
    await this.ready;
    const out = this.out;
    if (!out) return { w: 0, h: 0, data: new Uint8Array() };
    const { device } = this.gpu;
    const bpr = Math.ceil((out.width * 4) / 256) * 256;
    const buf = device.createBuffer({ size: bpr * out.height, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: out }, { buffer: buf, bytesPerRow: bpr }, { width: out.width, height: out.height });
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange());
    const data = new Uint8Array(out.width * out.height * 4);
    for (let y = 0; y < out.height; y++) data.set(src.subarray(y * bpr, y * bpr + out.width * 4), y * out.width * 4);
    buf.unmap(); buf.destroy();
    return { w: out.width, h: out.height, data };
  }

  destroy(): void {
    if (this.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
    this.gimg?.destroy(); this.out?.destroy(); this.dummyBase.destroy();
    this.develop.destroy(); this.localTone.destroy();
    this.ctx.unconfigure();
  }
}
