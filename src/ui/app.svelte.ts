// アプリ全体の組み立てと、画面をまたぐ操作（フォルダを開く・権限の再許可・画像送り）。
// コンポーネントは context（src/ui/context.ts）からこれを受け取る。
import { SvelteMap } from 'svelte/reactivity';
import { ThumbCache } from '../cache/thumbs';
import { Decoder } from '../decode/client';
import { createGpu } from '../engine/gpu';
import { Renderer } from '../engine/renderer';
import type { Platform } from '../platform/detect';
import { LibraryBackend, requestPersistence } from '../storage/library';
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
  /** 取り込み後の案内など（警告ではない情報） */
  info = $state<string | null>(null);
  loading = $state(true);
  /** 左のブラウザで選んだグループ（folder: 相対パス / library: 取り込み日）。null はすべて */
  group = $state<string | null>(null);
  /** 'crop' は切り抜きツール（R キー。ツール本体は Task 25） */
  tool = $state<'develop' | 'crop'>('develop');
  /** 書き出しの要求回数（Ctrl+Shift+E。ダイアログは Task 26 がこれを見て開く） */
  exportRequested = $state(0);
  /** このセッションで見たレーティング（Editor は現在の画像の分だけを持つ） */
  readonly ratings = new SvelteMap<string, number>();
  /** フィルムストリップに出す画像（グループで絞り込み） */
  visible = $derived.by(() => {
    const g = this.group, all = this.editor.images;
    return g === null ? all : all.filter((r) => r.group === g || r.group.startsWith(`${g}/`));
  });

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
    const keep = ed.currentId !== null && this.visible.some((r) => r.id === ed.currentId);
    const first = this.visible[0];
    if (!keep && first) await this.select(first.id);
  }

  /** folder: フォルダを開く / library: 写真を取り込む */
  async addSource(): Promise<void> {
    this.error = null;
    this.info = null;
    try {
      await this.backend.addSource();
      this.needsPermission = false;
      this.group = null;
      if (this.backend instanceof LibraryBackend) {
        const r = this.backend.lastImport;
        if (r && r.transcoded.length > 0) {
          this.info = `${r.transcoded.length} 枚は JPEG に変換されて渡されました。「ファイル」から選ぶとオリジナルのまま取り込めます。`;
        }
        if (r && r.rejected.length > 0) {
          this.error = `取り込めなかった写真: ${r.rejected.map((x) => `${x.name}（${x.reason === 'quota' ? '容量不足' : '非対応の形式'}）`).join('、')}`;
        }
      }
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
      const ids = this.visible.map((r) => r.id);
      const a = ids.indexOf(ed.currentId), b = ids.indexOf(id);
      if (a >= 0 && b >= 0) ed.selection = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
      return;
    } else {
      ed.selection = [id];
    }
    if (ed.currentId !== id) await ed.open(id);
  }

  /** 左のブラウザでグループを選ぶ。現在の画像が外れたら先頭を開く */
  async showGroup(g: string | null): Promise<void> {
    this.group = g;
    const ed = this.editor;
    if (!this.visible.some((r) => r.id === ed.currentId) && this.visible[0]) await this.select(this.visible[0].id);
  }

  /** 画像送り（delta = +1 で次、-1 で前） */
  async step(delta: number): Promise<void> {
    const ed = this.editor;
    const list = this.visible;
    const i = list.findIndex((r) => r.id === ed.currentId);
    const next = list[Math.min(list.length - 1, Math.max(0, i + delta))];
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
