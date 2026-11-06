import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { GestureRecognizer, type Gesture } from '../../src/ui/mobile/gestures';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function rec(opts?: ConstructorParameters<typeof GestureRecognizer>[1]) {
  const got: Gesture[] = [];
  const g = new GestureRecognizer((x) => got.push(x), opts);
  return { g, got };
}
const P = (id: number, x: number, y: number, t = 0) => ({ pointerId: id, clientX: x, clientY: y, timeStamp: t });

test('2 本指が離れると pinch scale > 1', () => {
  const { g, got } = rec();
  g.pointerDown(P(1, 100, 100)); g.pointerDown(P(2, 200, 100));
  g.pointerMove(P(2, 300, 100));
  const p = got.filter((x) => x.kind === 'pinch').at(-1) as Extract<Gesture, { kind: 'pinch' }>;
  expect(p.scale).toBeGreaterThan(1);
});

test('1 本指で 350ms 静止すると longPressStart、離すと longPressEnd', () => {
  const { g, got } = rec();
  g.pointerDown(P(1, 100, 100));
  vi.advanceTimersByTime(349);
  expect(got.some((x) => x.kind === 'longPressStart')).toBe(false);
  vi.advanceTimersByTime(1);
  expect(got.at(-1)).toEqual({ kind: 'longPressStart' });
  g.pointerUp(P(1, 100, 100, 600));
  expect(got.at(-1)).toEqual({ kind: 'longPressEnd' });
});

test('動くと長押しにならない', () => {
  const { g, got } = rec();
  g.pointerDown(P(1, 100, 100));
  g.pointerMove(P(1, 130, 100, 50));
  vi.advanceTimersByTime(500);
  expect(got.some((x) => x.kind === 'longPressStart')).toBe(false);
});

test('横 80px の素早い移動で swipe', () => {
  const { g, got } = rec();
  g.pointerDown(P(1, 200, 100, 0));
  g.pointerMove(P(1, 160, 102, 60));
  g.pointerUp(P(1, 120, 104, 120));
  expect(got.at(-1)).toEqual({ kind: 'swipe', dir: 'left' });
});

test('拡大中（scale > 1）は swipe ではなく pan', () => {
  const { g, got } = rec();
  g.setZoomed(true);
  g.pointerDown(P(1, 200, 100, 0));
  g.pointerMove(P(1, 120, 100, 60));
  g.pointerUp(P(1, 120, 100, 100));
  expect(got.some((x) => x.kind === 'swipe')).toBe(false);
  expect(got.some((x) => x.kind === 'pan' && x.dx === -80)).toBe(true);
});
