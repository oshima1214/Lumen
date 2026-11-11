// iPhone の写真操作のジェスチャー判定（計画 Task 27）。PointerEvent 相当の値だけを受け取る純粋なクラス。
// - 2 本指: pinch（開始時の指の距離に対する倍率と中心）
// - 1 本指: 拡大中は pan（移動量）。拡大していなければ、素早い横移動を離したときに swipe
// - 1 本指で longPressMs 静止: longPressStart、離すと longPressEnd（編集前の表示）
export type Gesture =
  | { kind: 'pinch'; scale: number; cx: number; cy: number }
  | { kind: 'pan'; dx: number; dy: number }
  | { kind: 'longPressStart' } | { kind: 'longPressEnd' }
  | { kind: 'swipe'; dir: 'left' | 'right' };

export interface PointerEventLike { pointerId: number; clientX: number; clientY: number; timeStamp: number }

const MOVE_TOLERANCE = 10;   // これ以上動いたら長押しにしない（px）
const SWIPE_MAX_MS = 500;

export class GestureRecognizer {
  private pts = new Map<number, { x: number; y: number }>();
  private start: { x: number; y: number; t: number } | null = null;
  private pinch0 = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pressing = false;
  private multi = false;
  private zoomed = false;
  private readonly longPressMs: number;
  private readonly swipeMinPx: number;

  constructor(private readonly onGesture: (g: Gesture) => void, opts: { longPressMs?: number; swipeMinPx?: number } = {}) {
    this.longPressMs = opts.longPressMs ?? 350;
    this.swipeMinPx = opts.swipeMinPx ?? 60;
  }

  /** 拡大中は 1 本指のドラッグを pan にする */
  setZoomed(z: boolean): void { this.zoomed = z; }

  private cancelTimer(): void { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
  private dist(): number {
    const [a, b] = [...this.pts.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  pointerDown(e: PointerEventLike): void {
    this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pts.size === 1) {
      this.multi = false;
      this.start = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      this.cancelTimer();
      this.timer = setTimeout(() => { this.timer = null; this.pressing = true; this.onGesture({ kind: 'longPressStart' }); }, this.longPressMs);
    } else if (this.pts.size === 2) {
      this.multi = true;
      this.cancelTimer();
      this.endPress();
      this.pinch0 = this.dist();
    }
  }

  pointerMove(e: PointerEventLike): void {
    const prev = this.pts.get(e.pointerId);
    if (!prev) return;
    this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pts.size >= 2) {
      const [a, b] = [...this.pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
      if (this.pinch0 > 0) this.onGesture({ kind: 'pinch', scale: this.dist() / this.pinch0, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 });
      return;
    }
    if (this.start && Math.hypot(e.clientX - this.start.x, e.clientY - this.start.y) > MOVE_TOLERANCE) this.cancelTimer();
    if (this.zoomed && !this.pressing) this.onGesture({ kind: 'pan', dx: e.clientX - prev.x, dy: e.clientY - prev.y });
  }

  pointerUp(e: PointerEventLike): void {
    if (!this.pts.has(e.pointerId)) return;
    this.pts.delete(e.pointerId);
    if (this.pts.size > 0) { this.pinch0 = this.dist(); return; }
    this.cancelTimer();
    const s = this.start;
    this.start = null;
    if (this.pressing) { this.endPress(); return; }
    if (!s || this.multi || this.zoomed) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) >= this.swipeMinPx && Math.abs(dx) > 2 * Math.abs(dy) && e.timeStamp - s.t <= SWIPE_MAX_MS) {
      this.onGesture({ kind: 'swipe', dir: dx < 0 ? 'left' : 'right' });
    }
  }

  private endPress(): void {
    if (!this.pressing) return;
    this.pressing = false;
    this.onGesture({ kind: 'longPressEnd' });
  }
}
