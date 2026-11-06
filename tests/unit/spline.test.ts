import { test, expect } from 'vitest';
import { bakeLut, monotoneSpline, sampleLut } from '../../src/color/spline';

test('[[0,0],[1,1]] は恒等', () => {
  const f = monotoneSpline([[0, 0], [1, 1]]);
  for (let i = 0; i <= 50; i++) expect(Math.abs(f(i / 50) - i / 50)).toBeLessThan(1e-12);
});

test('単調増加の点列で出力が単調、端点を通る', () => {
  const pts: [number, number][] = [[0, 0.05], [0.2, 0.1], [0.3, 0.6], [0.35, 0.62], [0.8, 0.9], [1, 0.95]];
  const f = monotoneSpline(pts);
  for (const [x, y] of pts) expect(Math.abs(f(x) - y)).toBeLessThan(1e-12);
  let prev = -Infinity;
  for (let i = 0; i <= 1000; i++) {
    const v = f(i / 1000);
    expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
    prev = v;
  }
});

test('範囲外は端の値、並び順は問わない', () => {
  const f = monotoneSpline([[0.8, 0.9], [0.2, 0.1]]);
  expect(f(0)).toBe(0.1);
  expect(f(1)).toBe(0.9);
  expect(f(0.5)).toBeCloseTo(0.5, 12);
});

test('bakeLut と sampleLut（線形補間）', () => {
  const lut = bakeLut((x) => x * x);
  expect(lut.length).toBe(1024);
  expect(lut[0]).toBe(0);
  expect(lut[1023]).toBe(1);
  expect(Math.abs(sampleLut(lut, 0.5) - 0.25)).toBeLessThan(1e-6);
  const id = bakeLut((x) => x, 16);
  expect(id.length).toBe(16);
  for (let i = 0; i <= 100; i++) expect(Math.abs(sampleLut(id, i / 100) - i / 100)).toBeLessThan(1e-7);
  expect(sampleLut(id, -1)).toBe(0);
  expect(sampleLut(id, 2)).toBe(1);
});
