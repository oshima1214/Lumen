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
import { aspectValue, constrainCrop, maxInscribedCrop, orientedSize } from '../engine/geometry';
import type { Aspect, DevelopParams } from '../params/types';

type Crop = DevelopParams['crop'];

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
  /** 'crop' は切り抜きツール（R キー、Task 25） */
  tool = $state<'develop' | 'crop'>('develop');
  /** 切り抜きツールで編集中の枠（確定前）。確定で params.crop に入る */
  cropDraft = $state.raw<Crop | null>(null);
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

  // ---- 切り抜きツール（仕様 3.3、計画 Task 25） ----
  /** 向き補正後のフル解像度の寸法（作業画像が無ければ null） */
  private orientedFull(): { w: number; h: number } | null {
    const img = this.editor.working;
    return img ? orientedSize(img.fullWidth, img.fullHeight, img.orientation) : null;
  }

  /** プレビューは切り抜く前の画像全体（回転込み）を描き、枠はビューアの上に重ねる */
  private showDraft(): void {
    const d = this.cropDraft;
    this.editor.setPreviewCrop(d ? { x: 0, y: 0, w: 1, h: 1, angle: d.angle, aspect: d.aspect } : null);
  }

  enterCrop(): void {
    if (this.editor.currentId === null || !this.editor.working) return;
    this.cropDraft = { ...this.editor.params.crop };
    this.tool = 'crop';
    if (this.editor.view.mode !== 'fit') this.editor.setView({ mode: 'fit' });   // 枠は画面に合わせた表示で扱う
    this.showDraft();
  }

  /** 枠を更新する（回転後の画像からはみ出さないよう収める） */
  setCropDraft(c: Crop): void {
    const o = this.orientedFull();
    if (!o) return;
    this.cropDraft = constrainCrop(c, o.w, o.h);
    this.showDraft();
  }

  setCropAspect(a: Aspect): void {
    const o = this.orientedFull(), d = this.cropDraft;
    if (!o || !d) return;
    const r = aspectValue(a, o.w, o.h);
    if (r === null) { this.cropDraft = { ...d, aspect: a }; return; }
    this.setCropDraft({ ...d, ...maxInscribedCrop(o.w, o.h, d.angle, r), aspect: a });
  }

  setCropAngle(angle: number): void {
    const o = this.orientedFull(), d = this.cropDraft;
    if (!o || !d) return;
    const a = Math.min(45, Math.max(-45, angle));
    const r = aspectValue(d.aspect, o.w, o.h) ?? (d.w * o.w) / (d.h * o.h);
    // 回転したら、今の縦横比のまま回転後の画像に内接する最大の枠にする（Lightroom と同じ）
    this.setCropDraft({ ...d, ...maxInscribedCrop(o.w, o.h, a, r), angle: a });
  }

  resetCrop(): void {
    this.setCropDraft({ x: 0, y: 0, w: 1, h: 1, angle: 0, aspect: 'original' });
  }

  commitCrop(): void {
    const d = this.cropDraft;
    if (d) this.editor.update((p) => { p.crop = { ...d }; });
    this.cancelCrop();
  }

  cancelCrop(): void {
    this.cropDraft = null;
    this.tool = 'develop';
    this.showDraft();
  }

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
    if (ed.currentId !== id) {
      if (this.tool === 'crop') this.cancelCrop();   // 切り抜き中に画像を替えたら確定せずに抜ける
      await ed.open(id);
    }
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
