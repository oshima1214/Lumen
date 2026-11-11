// WebGPU の初期化（仕様 1.4: WebGPU 必須）。アダプタの上限まで limits を引き上げてデバイスを作る。
// device.lost は onLost で登録したコールバックへ配線する（Renderer が作り直しに使う。Task 15）。

export interface Gpu {
  device: GPUDevice;
  limits: GPUSupportedLimits;
  /** デバイス喪失時のコールバックを登録する。戻り値で登録を解除する */
  onLost(cb: () => void): () => void;
}

export const GPU_INIT_ERROR = 'WebGPU を初期化できません';

/** 大きな作業画像（PC 8192px）に必要な上限。アダプタが許す範囲で要求する */
const WANTED_LIMITS = [
  'maxTextureDimension2D',
  'maxBufferSize',
  'maxStorageBufferBindingSize',
  'maxComputeWorkgroupStorageSize',
] as const;

export async function createGpu(): Promise<Gpu> {
  let device: GPUDevice;
  try {
    const gpu = typeof navigator !== 'undefined' ? navigator.gpu : undefined;
    if (!gpu) throw new Error('navigator.gpu がありません');
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('アダプタがありません');
    const requiredLimits: Record<string, number> = {};
    for (const k of WANTED_LIMITS) requiredLimits[k] = adapter.limits[k];
    device = await adapter.requestDevice({ requiredLimits });
  } catch (e) {
    throw new Error(GPU_INIT_ERROR, { cause: e });
  }
  const listeners: (() => void)[] = [];
  let lost = false;
  void device.lost.then(() => {
    lost = true;
    for (const cb of listeners) cb();
  });
  return {
    device,
    limits: device.limits,
    onLost(cb) {
      let active = true;
      if (lost) queueMicrotask(() => { if (active) cb(); });
      else listeners.push(cb);
      return () => { active = false; const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); };
    },
  };
}
