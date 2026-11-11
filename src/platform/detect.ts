// 実行環境の判定（仕様 1.4 / 2.4 / 7章）。detectPlatform は純粋関数。
// - iOS 判定: UA に iPhone / iPad / iPod を含む、または Mac の UA でタッチ点が 2 以上（iPadOS のデスクトップ UA）。
// - 保存方式: showDirectoryPicker があれば folder、なければ OPFS があれば library、どちらもなければ null。
// - WebGPU がなければ保存方式に関係なく backend=null（WebGPU の理由を優先して表示）。

export interface PlatformEnv {
  gpu: boolean;
  showDirectoryPicker: boolean;
  opfs: boolean;
  userAgent: string;
  maxTouchPoints: number;
}

export interface Platform {
  webgpu: boolean;
  backend: 'folder' | 'library' | null;
  ios: boolean;
  workCap: number;
  previewCap: number;
  unsupportedReason: string | null;
}

export const WORK_CAP = { desktop: 8192, ios: 4096 } as const;
export const PREVIEW_CAP = { desktop: 2560, ios: 2048 } as const;

/** 実ブラウザから環境を読む（テストでは使わない） */
export function readEnv(): PlatformEnv {
  const nav = globalThis.navigator as Navigator | undefined;
  return {
    gpu: !!nav && 'gpu' in nav && !!nav.gpu,
    showDirectoryPicker: typeof window !== 'undefined' && 'showDirectoryPicker' in window,
    opfs: !!nav?.storage && typeof nav.storage.getDirectory === 'function',
    userAgent: nav?.userAgent ?? '',
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
  };
}

export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

export function detectPlatform(env: PlatformEnv): Platform {
  const ios = isIos(env.userAgent, env.maxTouchPoints);
  const workCap = ios ? WORK_CAP.ios : WORK_CAP.desktop;
  const previewCap = ios ? PREVIEW_CAP.ios : PREVIEW_CAP.desktop;
  const base = { webgpu: env.gpu, ios, workCap, previewCap };

  if (!env.gpu) {
    return {
      ...base, backend: null,
      unsupportedReason: ios
        ? 'このブラウザでは WebGPU が使えません。iOS 26 以降の Safari で開いてください。'
        : 'このブラウザでは WebGPU が使えません。最新の Chrome または Edge で開いてください。',
    };
  }
  if (env.showDirectoryPicker) return { ...base, backend: 'folder', unsupportedReason: null };
  if (env.opfs) return { ...base, backend: 'library', unsupportedReason: null };
  return {
    ...base, backend: null,
    unsupportedReason: 'このブラウザでは写真と編集内容を保存する保存領域（File System Access API / OPFS）が使えません。最新の Chrome・Edge、または iOS 26 以降の Safari で開いてください。',
  };
}
