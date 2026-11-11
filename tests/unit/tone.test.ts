import { test, expect } from 'vitest';
import { baseToneMap, contrastGain, localToneGain, parametricCurve } from '../../src/color/tone';

const P0 = { highlights: 0, lights: 0, darks: 0, shadows: 0, splits: [0.25, 0.5, 0.75] as [number, number, number] };

test('parametric: 全 0 で恒等', () => {
  const f = parametricCurve(P0);
  for (let i = 0; i <= 100; i++) expect(Math.abs(f(i / 100) - i / 100)).toBeLessThan(1e-9);
});

test('parametric: highlights 50 で x=0.85 の出力が増え x=0.1 は不変', () => {
  const f = parametricCurve({ ...P0, highlights: 50 });
  expect(f(0.85)).toBeGreaterThan(0.85 + 0.01);
  expect(Math.abs(f(0.1) - 0.1)).toBeLessThan(1e-3);
  expect(f(0)).toBe(0);
  expect(f(1)).toBe(1);
});

test('parametric: 全項目 ±100 でも単調で 0..1', () => {
  for (const s of [-100, 100]) {
    for (const t of [-100, 100]) {
      const f = parametricCurve({ highlights: s, lights: t, darks: s, shadows: t, splits: [0.25, 0.5, 0.75] });
      let prev = 0;
      for (let i = 0; i <= 200; i++) {
        const v = f(i / 200);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
        expect(v).toBeLessThanOrEqual(1);
        prev = v;
      }
    }
  }
});

test('parametric: shadows -100 で暗部が下がる', () =>
  expect(parametricCurve({ ...P0, shadows: -100 })(0.12)).toBeLessThan(0.12 - 0.01));

test('contrastGain: 全 0 で 1、18% グレーは不動、正のコントラストで明暗が離れる', () => {
  expect(contrastGain(0.5, 0, 0, 0)).toBe(1);
  expect(contrastGain(0.18, 0.8, 0, 0)).toBe(1);
  expect(contrastGain(0.6, 0.8, 0, 0)).toBeGreaterThan(1);
  expect(contrastGain(0.03, 0.8, 0, 0)).toBeLessThan(1);
  expect(contrastGain(0.6, -0.8, 0, 0)).toBeLessThan(1);
});

test('contrastGain: 白・黒レベル', () => {
  expect(contrastGain(1.2, 0, 0.6, 0)).toBeGreaterThan(1);
  expect(Math.abs(contrastGain(0.01, 0, 0.6, 0) - 1)).toBeLessThan(1e-6);
  expect(contrastGain(0.005, 0, 0, -0.6)).toBeLessThan(1);
  expect(contrastGain(0.5, 0, 0, -0.6)).toBe(1);
});

test('contrastGain: 極端な組み合わせでも輝度は単調', () => {
  for (const [c, w, b] of [[-1, -1, -1], [1, 1, 1], [-1, 1, -1], [1, -1, 1], [-1, -1, 1]] as const) {
    let prev = 0;
    for (let i = -14; i <= 4; i += 0.01) {
      const y = 0.18 * 2 ** i;
      const v = y * contrastGain(y, c, w, b);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  }
});

test('localToneGain: highlights -1 は明部を下げ、暗部（< 0.05）は不変', () => {
  expect(localToneGain(0.8, -1, 0)).toBeLessThan(0.7);
  expect(localToneGain(0.04, -1, 0)).toBe(1);
  expect(localToneGain(0.01, 0, 1)).toBeGreaterThan(1.5);
  expect(localToneGain(0.5, 0, 1)).toBe(1);
  expect(localToneGain(0.3, 0, 0)).toBe(1);
});

test('baseToneMap: f(Y) = Y(1+Y/16)/(1+Y)、各成分 ≤ 1、色相を保つ', () => {
  const [r, g, b] = baseToneMap([0.5, 0.5, 0.5]);
  const f = (0.5 * (1 + 0.5 / 16)) / 1.5;
  expect(r).toBeCloseTo(f, 12); expect(g).toBeCloseTo(f, 12); expect(b).toBeCloseTo(f, 12);
  expect(baseToneMap([4, 4, 4]).map((v) => Math.abs(v - 1) < 1e-12)).toEqual([true, true, true]);
  expect(baseToneMap([100, 100, 100]).every((v) => Math.abs(v - 1) < 1e-12)).toBe(true);
  const hot = baseToneMap([6, 1, 0.2]);
  expect(Math.max(...hot)).toBeLessThanOrEqual(1 + 1e-12);
  expect(hot[0]).toBeGreaterThan(hot[1]);
  expect(baseToneMap([0, 0, 0])).toEqual([0, 0, 0]);
});
