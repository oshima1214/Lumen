// アプリ全体の組み立てと、画面をまたぐ操作（フォルダを開く・権限の再許可・画像送り）。
// コンポーネントは context（src/ui/context.ts）からこれを受け取る。
import { ThumbCache } from '../cache/thumbs';
import { Decoder } from '../decode/client';
import { createGpu } from '../engine/gpu';
import { Renderer } from '../engine/renderer';
import type { Platform } from '../platform/detect';
import { requestPersistence } from '../storage/library';
import type { StorageBackend } from '../storage/types';
import { createEditor, type Editor } from '../store/editor.svelte';
import { createBackend, testBackend } from './backend';

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

export class App {
  /** フォルダ権限が失効している（再起動後など）。「アクセスを再許可」を出す */
  needsPermission = $state(false);
  /** ライブラリ方式で永続化が許可されたか（フォルダ方式は null） */
  persisted = $state<boolean | null>(null);
  /** 一覧の読み込みや取り込みの失敗 */
  error = $state<string | null>(null);
  loading = $state(true);

  constructor(
    readonly platform: Platform,
    readonly backend: StorageBackend,
    readonly editor: Editor,
    readonly renderer: Renderer,
    /** ビューアに置く canvas（レイアウトが切り替わっても同じ要素を使う） */
    readonly canvas: HTMLCanvasElement,
    readonly thumbs: ThumbCache,
  ) {}

  /** 起動時: 権限を確認し、一覧を読み、先頭の画像を開く */
  async init(): Promise<void> {
    try {
      if (this.backend.kind === 'library') this.persisted = await requestPersistence();
      this.needsPermission = await this.backend.needsPermission();
      if (!this.needsPermission) await this.reload();
    } catch (e) {
      this.error = message(e);
    } finally {
      this.loading = false;
    }
  }

  private async reload(): Promise<void> {
    await this.editor.refresh();
    const ed = this.editor;
    const keep = ed.currentId !== null && ed.images.some((r) => r.id === ed.currentId);
    if (!keep && ed.images[0]) await this.select(ed.images[0].id);
  }

  /** folder: フォルダを開く / library: 写真を取り込む */
  async addSource(): Promise<void> {
    this.error = null;
    try {
      await this.backend.addSource();
      this.needsPermission = false;
      await this.reload();
    } catch (e) {
      if (!isAbort(e)) this.error = message(e);
    }
  }

  /** 「アクセスを再許可」（クリックの中から呼ぶ） */
  async regrant(): Promise<void> {
    this.error = null;
    try {
      if (await this.backend.requestPermission()) {
        this.needsPermission = false;
        await this.reload();
      }
    } catch (e) {
      this.error = message(e);
    }
  }

  /** 画像を選ぶ。single = それだけ選択して開く、toggle = 複数選択に追加／除外、range = 現在の画像から範囲選択 */
  async select(id: string, mode: 'single' | 'toggle' | 'range' = 'single'): Promise<void> {
    const ed = this.editor;
    if (mode === 'toggle') {
      ed.selection = ed.selection.includes(id) ? ed.selection.filter((x) => x !== id) : [...ed.selection, id];
      if (ed.selection.length === 0) ed.selection = [id];
    } else if (mode === 'range' && ed.currentId !== null) {
      const ids = ed.images.map((r) => r.id);
      const a = ids.indexOf(ed.currentId), b = ids.indexOf(id);
      if (a >= 0 && b >= 0) ed.selection = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
      return;
    } else {
      ed.selection = [id];
    }
    if (ed.currentId !== id) await ed.open(id);
  }

  /** 画像送り（delta = +1 で次、-1 で前） */
  async step(delta: number): Promise<void> {
    const ed = this.editor;
    const i = ed.images.findIndex((r) => r.id === ed.currentId);
    const next = ed.images[Math.min(ed.images.length - 1, Math.max(0, i + delta))];
    if (next && next.id !== ed.currentId) await this.select(next.id);
  }
}

export type StartResult = { ok: true; app: App } | { ok: false; reason: string };

/** 実行環境から App を組み立てる。WebGPU の初期化に失敗したら理由を返す */
export async function startApp(platform: Platform): Promise<StartResult> {
  if (platform.backend === null) return { ok: false, reason: platform.unsupportedReason ?? 'このブラウザでは動きません。' };
  let gpu;
  try {
    gpu = await createGpu();
  } catch (e) {
    return { ok: false, reason: `${message(e)}。このブラウザでは WebGPU が使えない可能性があります。` };
  }
  const backend = testBackend() ?? (await createBackend(platform.backend));
  const canvas = document.createElement('canvas');
  const renderer = new Renderer(gpu, canvas, { previewCap: platform.previewCap });
  const decoder = new Decoder();
  const editor = createEditor({
    backend, decoder, renderer, platform,
    setTimeout: globalThis.setTimeout.bind(globalThis) as typeof setTimeout,
    clearTimeout: globalThis.clearTimeout.bind(globalThis) as typeof clearTimeout,
  });
  const thumbs = new ThumbCache(decoder, (id) => backend.readOriginal(id), backend.kind);
  const app = new App(platform, backend, editor, renderer, canvas, thumbs);
  // 閉じる・別のアプリに切り替える前に保留中の保存を書く
  addEventListener('pagehide', () => { void editor.flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void editor.flush(); });
  if (import.meta.env.MODE === 'test') {
    (window as unknown as { __lumenApp: unknown }).__lumenApp = { app, editor, renderer, backend };
  }
  return { ok: true, app };
}
