// Undo / Redo 履歴（仕様 4.5、計画 Task 19）。値のスナップショットをそのまま積む（メモリのみ）。
// - cap は Undo できる回数の上限（既定 100）。超えたら古いものから捨てる
// - ジェスチャー（スライダーのドラッグ）中の set は current だけを更新し、
//   endGesture で「開始時の値 → 終了時の値」を 1 件として積む。値が変わっていなければ積まない（参照比較）
// - ジェスチャー中に undo / redo されたら、先にジェスチャーを確定する
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private cur: T;
  private gestureStart: { value: T } | null = null;

  constructor(initial: T, private readonly cap = 100) {
    this.cur = initial;
  }

  get current(): T { return this.cur; }
  get canUndo(): boolean { return this.past.length > 0 || (this.gestureStart !== null && this.gestureStart.value !== this.cur); }
  get canRedo(): boolean { return this.gestureStart === null ? this.future.length > 0 : this.gestureStart.value === this.cur && this.future.length > 0; }
  get inGesture(): boolean { return this.gestureStart !== null; }

  set(next: T): void {
    if (next === this.cur) return;
    if (this.gestureStart === null) this.push(this.cur);
    this.cur = next;
  }

  beginGesture(): void {
    if (this.gestureStart === null) this.gestureStart = { value: this.cur };
  }

  endGesture(): void {
    const g = this.gestureStart;
    if (g === null) return;
    this.gestureStart = null;
    if (g.value !== this.cur) this.push(g.value);
  }

  undo(): T | null {
    this.endGesture();
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(this.cur);
    this.cur = prev;
    return prev;
  }

  redo(): T | null {
    this.endGesture();
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.cur);
    this.cur = next;
    return next;
  }

  private push(v: T): void {
    this.past.push(v);
    if (this.past.length > this.cap) this.past.splice(0, this.past.length - this.cap);
    this.future = [];
  }
}
