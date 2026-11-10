// 編集状態・Undo 履歴・自動保存（仕様 4.2 / 4.4 / 4.5 / 7 章、計画 Task 19）。
//
// - 画像ごとに ImageState（History・rating・元ファイル情報・readOnly・破損フラグ）をメモリに持つ。
//   一度開いた画像は再度開いてもサイドカーを読み直さず、Undo 履歴を引き継ぐ（履歴はサイドカーに保存しない）。
// - 保存は画像ごとの SaveSlot で直列化する。変更から 500ms のデバウンスで、その時点のその画像の状態を
//   toSidecar して書く。書き込み中に変更が来たら、完了後にもう一度書く（最後の編集を失わない）。
// - open(B) は前の画像の保留中の保存を即時実行し、完了を待ってから切り替える（Review Focus 3）。
//   保存は常に「保存対象の画像自身の状態」から作るので、切り替え後の画像の値が前の画像に書かれることはない。
// - 保存失敗: status.saveError を立て、内容はメモリに保持。5 秒後か、次の変更（デバウンス後）に再試行。
// - readOnly（新しすぎる schema、またはサイドカーを読めなかった）の画像は保存しない。
// - Renderer は Task 15 の実装に依存しないよう、必要な形だけを RendererPort として定義する。
import type { ViewState } from '../engine/renderer';
import { DecodeError, type Decoder } from '../decode/client';
import type { WorkingImage } from '../decode/types';
import { GpuOutOfMemoryError } from '../engine/errors';
import { clampParams, defaultParams } from '../params/defaults';
import { applyPartial, pickGroups } from '../params/partial';
import { ForeignSidecarError, fromSidecar, SidecarError, sourceChanged, toSidecar } from '../params/sidecar';
import type { DeepPartial, DevelopParams, ParamGroup, Preset, SourceInfo } from '../params/types';
import type { Platform } from '../platform/detect';
import { CorruptSidecarError, type ImageRef, type StorageBackend } from '../storage/types';
import { History } from './history';

export const SAVE_DEBOUNCE_MS = 500;
export const SAVE_RETRY_MS = 5000;
/** GPU メモリ不足で作業画像を縮める下限（これ未満にはしない） */
export const MIN_WORK_CAP = 512;
export const LOW_RES_NOTICE = '解像度を下げて表示しています';

/** Renderer が受け取る表示状態（Task 15 の ViewState そのもの。viewport はビューアが setView で設定する） */
export type ViewStateLike = ViewState;

/** Editor が使う Renderer の範囲（Task 15 の Renderer が満たす） */
export interface RendererPort {
  /** GPU のメモリ確保に失敗したら GpuOutOfMemoryError で reject */
  setImage(img: WorkingImage): Promise<void>;
  render(p: DevelopParams, view: ViewStateLike): void;
}

export interface EditorDeps {
  backend: StorageBackend;
  decoder: Pick<Decoder, 'open' | 'close'>;
  renderer: RendererPort | null;
  platform: Pick<Platform, 'workCap'>;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

export interface EditorStatus {
  saveError: string | null;
  sourceChanged: boolean;
  corrupted: boolean;
  decodeError: string | null;
  notice: string | null;
}

export interface Editor {
  images: ImageRef[];
  selection: string[];
  currentId: string | null;
  params: DevelopParams;
  rating: number;
  readOnly: boolean;
  status: EditorStatus;
  view: ViewStateLike;
  /** 現在の画像のデコード結果（Worker 側のハンドルと作業画像）。デコード前・失敗時は null */
  handle: string | null;
  working: WorkingImage | null;
  canUndo: boolean;
  canRedo: boolean;
  refresh(): Promise<void>;
  open(id: string): Promise<void>;
  update(mut: (p: DevelopParams) => void): void;
  beginGesture(): void;
  endGesture(): void;
  undo(): void;
  redo(): void;
  resetAll(): void;
  setRating(n: number): void;
  setView(v: Partial<ViewStateLike>): void;
  /** 切り抜きツールで編集中の枠（確定前）。プレビューだけに使い、params・保存・履歴には入れない。null で解除 */
  previewCrop: DevelopParams['crop'] | null;
  setPreviewCrop(c: DevelopParams['crop'] | null): void;
  copy(groups: ParamGroup[]): void;
  paste(ids: string[]): Promise<{ failed: string[] }>;
  applyPreset(p: Preset, ids?: string[]): Promise<void>;
  flush(): Promise<void>;
  /** 取り込み元が変わったとき（フォルダを開き直すなど）: 保留中の保存を書き切ってから、画像ごとの状態を捨てる */
  reset(): Promise<void>;
}

interface ImageState {
  history: History<DevelopParams>;
  rating: number;
  source: SourceInfo;
  readOnly: boolean;
  corrupted: boolean;
  sourceChanged: boolean;
  /** サイドカーを読めなかった（破損以外: 権限切れなど）。readOnly で開き、次に開くときに読み直す */
  unreadable: boolean;
  /** 同じ名前の JSON が他のアプリのもの（読み取り専用、上書きしない） */
  foreign: boolean;
}

export const UNREADABLE_NOTICE = 'サイドカーを読み込めないため、編集内容は保存されません';
export const FOREIGN_NOTICE = '同じ名前の JSON（他のアプリのもの）があるため、この写真の編集内容は保存されません';

type TimerHandle = ReturnType<typeof setTimeout>;

interface SaveSlot {
  dirty: boolean;
  timer: TimerHandle | null;
  retry: TimerHandle | null;
  running: Promise<void> | null;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

class EditorImpl implements Editor {
  images = $state.raw<ImageRef[]>([]);
  selection = $state.raw<string[]>([]);
  currentId = $state<string | null>(null);
  params = $state.raw<DevelopParams>(defaultParams());
  rating = $state(0);
  readOnly = $state(false);
  status = $state<EditorStatus>({ saveError: null, sourceChanged: false, corrupted: false, decodeError: null, notice: null });
  view = $state.raw<ViewStateLike>({ mode: 'fit', cx: 0.5, cy: 0.5, before: false, background: 'dark', viewport: { w: 1, h: 1 } });
  handle = $state<string | null>(null);
  working = $state.raw<WorkingImage | null>(null);
  canUndo = $state(false);
  canRedo = $state(false);

  private states = new Map<string, ImageState>();
  private slots = new Map<string, SaveSlot>();
  private failing = new Map<string, string>();
  private clipboard: DeepPartial<DevelopParams> | null = null;
  private openToken = 0;

  constructor(private deps: EditorDeps) {}

  // ---- 一覧 ----

  async refresh(): Promise<void> {
    const list = await this.deps.backend.list();
    this.images = list;
    const ids = new Set(list.map((r) => r.id));
    this.selection = this.selection.filter((id) => ids.has(id));
  }

  private async refOf(id: string): Promise<ImageRef> {
    let ref = this.images.find((r) => r.id === id);
    if (!ref) {
      await this.refresh();
      ref = this.images.find((r) => r.id === id);
    }
    if (!ref) throw new Error(`画像が見つかりません: ${id}`);
    return ref;
  }

  // ---- 開く ----

  async open(id: string): Promise<void> {
    const token = ++this.openToken;
    this.previewCrop = null;
    const prev = this.currentId;
    if (prev !== null && prev !== id) await this.flushId(prev);
    if (token !== this.openToken) return;

    const ref = await this.refOf(id);
    const st = await this.stateOf(ref);
    if (token !== this.openToken) return;

    if (this.handle !== null) this.deps.decoder.close(this.handle);
    this.handle = null;
    this.working = null;
    this.currentId = id;
    this.status.corrupted = st.corrupted;
    this.status.sourceChanged = st.sourceChanged;
    this.status.decodeError = null;
    this.status.notice = st.unreadable ? UNREADABLE_NOTICE : st.foreign ? FOREIGN_NOTICE : null;
    this.syncFromState(st);

    await this.decode(ref, token);
  }

  private async decode(ref: ImageRef, token: number): Promise<void> {
    const { backend, decoder, renderer } = this.deps;
    let cap = this.deps.platform.workCap;
    try {
      const file = await backend.readOriginal(ref.id);
      for (;;) {
        if (token !== this.openToken) return;
        const { handle, working } = await decoder.open(file, ref.name, { workCap: cap, retain: false });   // 編集用は元データを残さない（最終レビュー I4a）
        if (token !== this.openToken) { decoder.close(handle); return; }
        try {
          await renderer?.setImage(working);
        } catch (e) {
          decoder.close(handle);
          if (e instanceof GpuOutOfMemoryError && cap / 2 >= MIN_WORK_CAP) {
            cap = Math.floor(cap / 2);
            this.status.notice = LOW_RES_NOTICE;
            continue;
          }
          throw e;
        }
        if (token !== this.openToken) { decoder.close(handle); return; }
        this.handle = handle;
        this.working = working;
        this.draw();
        return;
      }
    } catch (e) {
      if (token !== this.openToken) return;
      this.status.decodeError = e instanceof DecodeError || e instanceof GpuOutOfMemoryError ? e.message : message(e);
    }
  }

  /** メモリ上の状態があればそれを、無ければサイドカーから作る */
  private async stateOf(ref: ImageRef): Promise<ImageState> {
    const have = this.states.get(ref.id);
    if (have && !have.unreadable) return have;
    const actual: SourceInfo = { name: ref.name, size: ref.size, mtime: ref.mtime };
    const st: ImageState = {
      history: new History(defaultParams()), rating: 0, source: actual,
      readOnly: false, corrupted: false, sourceChanged: false, unreadable: false, foreign: false,
    };
    const { backend } = this.deps;
    let raw: unknown = null;
    let bad = false;
    try {
      raw = await backend.readSidecar(ref.id);
    } catch (e) {
      if (e instanceof CorruptSidecarError) bad = true;
      else {
        // 権限切れなど。既定値で開くが、読めなかったサイドカーを上書きしないよう保存しない
        st.readOnly = true;
        st.unreadable = true;
        this.states.set(ref.id, st);
        return st;
      }
    }
    if (!bad && raw !== null) {
      try {
        const loaded = fromSidecar(raw);
        st.history = new History(loaded.params);
        st.rating = loaded.rating;
        st.readOnly = loaded.readOnly;
        st.sourceChanged = sourceChanged(loaded.source, actual);
      } catch (e) {
        if (e instanceof ForeignSidecarError) {
          // 他のアプリのファイルは退避も上書きもしない（最終レビュー I2）
          st.readOnly = true;
          st.foreign = true;
        } else if (!(e instanceof SidecarError)) throw e;
        else bad = true;
      }
    }
    if (bad) {
      st.corrupted = true;
      try {
        await backend.quarantineSidecar(ref.id);
      } catch {
        // 退避できなかった壊れたファイルを既定値で上書きしない（仕様 4.2「上書きで失わない」）
        st.readOnly = true;
        st.unreadable = true;
      }
    }
    const again = this.states.get(ref.id); // 並行して読まれていたらそちらを使う
    if (again && !again.unreadable) return again;
    this.states.set(ref.id, st);
    return st;
  }

  private current(): ImageState | null {
    return this.currentId === null ? null : this.states.get(this.currentId) ?? null;
  }

  private syncFromState(st: ImageState): void {
    this.params = st.history.current;
    this.rating = st.rating;
    this.readOnly = st.readOnly;
    this.canUndo = st.history.canUndo;
    this.canRedo = st.history.canRedo;
  }

  previewCrop = $state.raw<DevelopParams['crop'] | null>(null);

  setPreviewCrop(c: DevelopParams['crop'] | null): void {
    this.previewCrop = c;
    this.draw();
  }

  private draw(): void {
    const p = this.previewCrop ? { ...this.params, crop: this.previewCrop } : this.params;
    this.deps.renderer?.render(p, this.view);
  }

  // ---- 編集 ----

  update(mut: (p: DevelopParams) => void): void {
    const st = this.current();
    if (!st) return;
    const next = structuredClone(st.history.current);
    mut(next);
    this.commit(st, clampParams(next));
  }

  private commit(st: ImageState, next: DevelopParams): void {
    st.history.set(next);
    this.afterChange(st);
  }

  private afterChange(st: ImageState): void {
    this.syncFromState(st);
    if (this.currentId !== null) this.schedule(this.currentId, st);
    this.draw();
  }

  beginGesture(): void { this.current()?.history.beginGesture(); }

  endGesture(): void {
    const st = this.current();
    if (!st) return;
    st.history.endGesture();
    this.syncFromState(st);
  }

  undo(): void {
    const st = this.current();
    if (st && st.history.undo() !== null) this.afterChange(st);
  }

  redo(): void {
    const st = this.current();
    if (st && st.history.redo() !== null) this.afterChange(st);
  }

  resetAll(): void {
    const st = this.current();
    if (st) this.commit(st, defaultParams());
  }

  setRating(n: number): void {
    const st = this.current();
    if (!st) return;
    st.rating = Math.min(5, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));
    this.afterChange(st);
  }

  setView(v: Partial<ViewStateLike>): void {
    this.view = { ...this.view, ...v };
    this.draw();
  }

  // ---- コピー＆ペースト・プリセット ----

  copy(groups: ParamGroup[]): void {
    this.clipboard = pickGroups(this.params, groups);
  }

  async paste(ids: string[]): Promise<{ failed: string[] }> {
    if (!this.clipboard) return { failed: [] };
    return this.applyTo(ids, this.clipboard);
  }

  async applyPreset(p: Preset, ids?: string[]): Promise<void> {
    const targets = ids ?? (this.currentId !== null ? [this.currentId] : []);
    await this.applyTo(targets, p.params);
  }

  private async applyTo(ids: string[], partial: DeepPartial<DevelopParams>): Promise<{ failed: string[] }> {
    const failed: string[] = [];
    await Promise.all(ids.map(async (id) => {
      try {
        const st = id === this.currentId ? this.current() : await this.stateOf(await this.refOf(id));
        if (!st || st.readOnly) throw new Error('読み取り専用です');
        st.history.endGesture();
        st.history.set(applyPartial(st.history.current, partial));
        if (id === this.currentId && st === this.current()) {
          this.syncFromState(st);
          this.draw();
        }
        if (!(await this.saveNow(id, st))) throw new Error('保存できません');
      } catch {
        failed.push(id);
      }
    }));
    const order = new Map(ids.map((id, i) => [id, i]));
    failed.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    return { failed };
  }

  // ---- 保存 ----

  private slot(id: string): SaveSlot {
    let s = this.slots.get(id);
    if (!s) { s = { dirty: false, timer: null, retry: null, running: null }; this.slots.set(id, s); }
    return s;
  }

  private clearTimers(s: SaveSlot): void {
    if (s.timer !== null) { this.deps.clearTimeout(s.timer); s.timer = null; }
    if (s.retry !== null) { this.deps.clearTimeout(s.retry); s.retry = null; }
  }

  private schedule(id: string, st: ImageState): void {
    if (st.readOnly) return;
    const s = this.slot(id);
    s.dirty = true;
    this.clearTimers(s);
    s.timer = this.deps.setTimeout(() => { s.timer = null; void this.run(id, st); }, SAVE_DEBOUNCE_MS);
  }

  /** 保留中・実行中の保存を終わらせる。最後の書き込みが成功したら true */
  private async saveNow(id: string, st: ImageState): Promise<boolean> {
    if (st.readOnly) return false;
    this.slot(id).dirty = true;
    await this.run(id, st);
    return !this.failing.has(id);
  }

  private run(id: string, st: ImageState): Promise<void> {
    const s = this.slot(id);
    this.clearTimers(s);
    if (s.running) {
      // 実行中の書き込みの後に、溜まった変更をもう一度書く
      return s.running.then(() => (s.dirty ? this.run(id, st) : undefined));
    }
    if (!s.dirty) return Promise.resolve();
    s.running = this.writeLoop(id, st, s).finally(() => { s.running = null; });
    return s.running;
  }

  private async writeLoop(id: string, st: ImageState, s: SaveSlot): Promise<void> {
    while (s.dirty) {
      s.dirty = false;
      const data = toSidecar(st.history.current, st.source, st.rating);
      try {
        await this.deps.backend.writeSidecar(id, data);
        this.failing.delete(id);
      } catch (e) {
        s.dirty = true;
        this.failing.set(id, message(e));
        if (s.timer === null && s.retry === null) {
          s.retry = this.deps.setTimeout(() => { s.retry = null; void this.run(id, st); }, SAVE_RETRY_MS);
        }
        break;
      }
    }
    this.updateSaveError();
  }

  private updateSaveError(): void {
    const first = this.failing.values().next();
    this.status.saveError = first.done ? null : `編集内容を保存できません: ${first.value}`;
  }

  private async flushId(id: string): Promise<void> {
    const st = this.states.get(id);
    const s = this.slots.get(id);
    if (!st || !s) return;
    if (s.dirty || s.running) await this.run(id, st);
  }

  async flush(): Promise<void> {
    await Promise.all([...this.slots.keys()].map((id) => this.flushId(id)));
  }

  async reset(): Promise<void> {
    // 同じ id でも別のファイルを指しうる（同名フォルダ）ので、状態の使い回しをやめる（最終レビュー I1）
    ++this.openToken;
    await this.flush().catch(() => undefined);
    for (const s of this.slots.values()) {
      if (s.timer !== null) this.deps.clearTimeout(s.timer);
      if (s.retry !== null) this.deps.clearTimeout(s.retry);
    }
    if (this.handle !== null) this.deps.decoder.close(this.handle);
    this.states.clear(); this.slots.clear(); this.failing.clear();
    this.currentId = null; this.handle = null; this.working = null;
    this.selection = []; this.previewCrop = null;
    this.params = defaultParams(); this.rating = 0; this.readOnly = false;
    this.canUndo = false; this.canRedo = false;
    this.status = { saveError: null, sourceChanged: false, corrupted: false, decodeError: null, notice: null };
  }
}

export function createEditor(deps: EditorDeps): Editor {
  return new EditorImpl(deps);
}
