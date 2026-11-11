// iPhone 実機検証ページ（計画 Task 13 Step 5）。アプリ本体とは独立した入口（dist/gpu-check/index.html）。
// 表示する項目: アダプタ情報、rgba16float のストレージ書き込み可否、maxTextureDimension2D、maxBufferSize、
// 合成 2048×2048 の作業画像の現像時間（20 回平均。ベース層の作成時間も別に表示）、4096×3072 と 8064×6048 の rgba16float テクスチャ確保の成否。
import { buildUniforms, packUniforms } from '../color/uniforms';
import { defaultParams } from '../params/defaults';
import { deepMerge } from '../params/partial';
import { DevelopPass } from '../engine/develop';
import { LocalTonePass } from '../engine/localtone';
import { identitySample } from '../engine/geometry';
import { createGpu, type Gpu } from '../engine/gpu';
import { mipCountFor, uploadRgb16 } from '../engine/upload';

type Row = [label: string, value: string, ok?: boolean];
const rows: Row[] = [];
const report: Record<string, unknown> = { userAgent: navigator.userAgent };

function render(status: string): void {
  const table = document.getElementById('results')!;
  table.replaceChildren(...rows.map(([label, value, ok]) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = label;
    const td = document.createElement('td');
    td.textContent = value;
    if (ok !== undefined) td.className = ok ? 'ok' : 'ng';
    tr.append(th, td);
    return tr;
  }));
  document.getElementById('status')!.textContent = status;
  document.getElementById('json')!.textContent = JSON.stringify(report, null, 2);
}

function add(key: string, label: string, value: unknown, ok?: boolean): void {
  report[key] = value;
  rows.push([label, typeof value === 'string' ? value : JSON.stringify(value), ok]);
  render('計測中…');
}

async function scoped<T>(device: GPUDevice, fn: () => T | Promise<T>): Promise<{ value?: T; error?: string }> {
  device.pushErrorScope('validation');
  device.pushErrorScope('out-of-memory');
  device.pushErrorScope('internal');
  let value: T | undefined;
  let thrown: string | undefined;
  try { value = await fn(); } catch (e) { thrown = String(e); }
  const errs = [await device.popErrorScope(), await device.popErrorScope(), await device.popErrorScope()];
  const msg = thrown ?? errs.find((e) => e)?.message;
  return msg ? { error: msg } : { value: value as T };
}

/** rgba16float のストレージテクスチャに書いて読み戻せるか */
async function checkStorage(gpu: Gpu): Promise<{ ok: boolean; detail: string }> {
  const { device } = gpu;
  const r = await scoped(device, async () => {
    const tex = device.createTexture({ size: { width: 8, height: 8 }, format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
    const module = device.createShaderModule({
      code: `@group(0) @binding(0) var t: texture_storage_2d<rgba16float, write>;
        @compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3<u32>) {
          textureStore(t, id.xy, vec4<f32>(0.25, 0.5, 2.0, 1.0)); }`,
    });
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const buf = device.createBuffer({ size: 256 * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: tex.createView() }] }));
    pass.dispatchWorkgroups(1, 1);
    pass.end();
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: 256 }, { width: 8, height: 8 });
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const half = new Uint16Array(buf.getMappedRange().slice(0, 8));
    buf.unmap();
    tex.destroy();
    buf.destroy();
    return Array.from(half);
  });
  if (r.error) return { ok: false, detail: r.error };
  // 0.25, 0.5, 2.0, 1.0 の half
  const expect = [0x3400, 0x3800, 0x4000, 0x3c00];
  const ok = r.value!.every((v, i) => v === expect[i]);
  return { ok, detail: ok ? '書き込み・読み戻し OK' : `値が違う: ${r.value!.map((v) => v.toString(16)).join(',')}` };
}

/** w×h の rgba16float（ミップあり）を確保して全段をクリアできるか */
async function checkAlloc(gpu: Gpu, w: number, h: number): Promise<{ ok: boolean; detail: string }> {
  const { device } = gpu;
  if (Math.max(w, h) > gpu.limits.maxTextureDimension2D) return { ok: false, detail: 'maxTextureDimension2D を超える' };
  let tex: GPUTexture | undefined;
  const r = await scoped(device, async () => {
    tex = device.createTexture({
      size: { width: w, height: h }, format: 'rgba16float', mipLevelCount: mipCountFor(w, h),
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const enc = device.createCommandEncoder();
    for (let level = 0; level < tex.mipLevelCount; level++) {
      enc.beginRenderPass({
        colorAttachments: [{ view: tex.createView({ baseMipLevel: level, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
      }).end();
    }
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
  });
  tex?.destroy();
  const mb = Math.round((w * h * 8 * 4) / 3 / 1e6);
  return r.error ? { ok: false, detail: r.error } : { ok: true, detail: `確保 OK（約 ${mb}MB）` };
}

/** 合成 N×N の作業画像を全処理段ありで現像する時間（20 回平均） */
async function benchDevelop(gpu: Gpu, N: number): Promise<{ avgMs: number; firstMs: number; baseMs: number }> {
  const { device } = gpu;
  const data = new Uint16Array(N * N * 3);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 3;
    data[i] = (x * 32) & 0xffff;
    data[i + 1] = (y * 32) & 0xffff;
    data[i + 2] = ((x + y) * 16) & 0xffff;
  }
  const img = uploadRgb16(gpu, data, N, N);
  const out = device.createTexture({ size: { width: N, height: N }, format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
  const p = deepMerge(defaultParams(), {
    basic: { exposure: 0.5, contrast: 30, highlights: -40, shadows: 30, whites: 10, blacks: -10, vibrance: 20, saturation: 10 },
    curve: { rgb: [[0, 0], [0.25, 0.2], [0.75, 0.8], [1, 1]], parametric: { highlights: -20, lights: 10, darks: 10, shadows: 5, splits: [0.25, 0.5, 0.75] } },
    hsl: { orange: { h: 10, s: -10, l: 5 }, blue: { h: -10, s: 20, l: -10 } },
    grading: { shadows: { hue: 220, sat: 30, lum: 0 }, highlights: { hue: 50, sat: 20, lum: 0 } },
  });
  const { u, luts } = buildUniforms(p, { kind: 'display' }, 'srgb');
  const packed = packUniforms(u);
  const pass = new DevelopPass(gpu);
  pass.setLuts(luts);
  // ベース層（処理段 4。WB・露光を変えたときだけ作り直す）
  const local = new LocalTonePass(gpu);
  let base = local.build(img, packed);
  await device.queue.onSubmittedWorkDone();
  let baseTotal = 0;
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    base = local.build(img, packed);
    await device.queue.onSubmittedWorkDone();
    baseTotal += performance.now() - t0;
  }
  const once = async () => {
    const t0 = performance.now();
    pass.run(img.texture, 0, base, packed, out, { x: 0, y: 0, w: N, h: N }, identitySample(N, N));
    await device.queue.onSubmittedWorkDone();
    return performance.now() - t0;
  };
  const firstMs = await once();   // パイプライン生成を含む
  let total = 0;
  for (let i = 0; i < 20; i++) total += await once();
  pass.destroy();
  local.destroy();
  img.destroy();
  out.destroy();
  return { avgMs: total / 20, firstMs, baseMs: baseTotal / 20 };
}

async function main(): Promise<void> {
  let gpu: Gpu;
  try {
    gpu = await createGpu();
  } catch (e) {
    add('webgpu', 'WebGPU', `使えません: ${String((e as Error).cause ?? e)}`, false);
    render('WebGPU を初期化できません');
    document.title = 'gpu-check-done';
    return;
  }
  const adapter = await navigator.gpu.requestAdapter();
  const info = adapter?.info;
  add('adapter', 'アダプタ', info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } : '不明');
  add('maxTextureDimension2D', 'maxTextureDimension2D', String(gpu.limits.maxTextureDimension2D), gpu.limits.maxTextureDimension2D >= 4096);
  add('maxBufferSize', 'maxBufferSize', `${gpu.limits.maxBufferSize}（${Math.round(gpu.limits.maxBufferSize / 2 ** 20)}MiB）`);
  add('maxStorageBufferBindingSize', 'maxStorageBufferBindingSize', String(gpu.limits.maxStorageBufferBindingSize));
  const storage = await checkStorage(gpu);
  add('rgba16floatStorage', 'rgba16float ストレージ書き込み', storage.detail, storage.ok);
  for (const [w, h] of [[4096, 3072], [8064, 6048]] as const) {
    const r = await checkAlloc(gpu, w, h);
    add(`alloc${w}x${h}`, `rgba16float ${w}×${h} 確保`, r.detail, r.ok);
  }
  // ?size=N で計測サイズを変えられる（自動テスト用。既定 2048）
  const N = Number(new URLSearchParams(location.search).get('size')) || 2048;
  report.benchSize = N;
  try {
    const b = await benchDevelop(gpu, N);
    add('developMs', `現像 ${N}×${N}（20 回平均）`, `${b.avgMs.toFixed(1)} ms（初回 ${b.firstMs.toFixed(0)} ms）`, b.avgMs <= 33);
    add('baseLayerMs', 'ベース層の作成（20 回平均）', `${b.baseMs.toFixed(1)} ms`);
  } catch (e) {
    add('developMs', `現像 ${N}×${N}（20 回平均）`, `失敗: ${String(e)}`, false);
  }
  render('完了');
  document.title = 'gpu-check-done';
}

document.getElementById('copy')?.addEventListener('click', () => {
  void navigator.clipboard?.writeText(JSON.stringify(report, null, 2));
});
void main();
