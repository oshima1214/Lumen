import { test, expect } from 'vitest';
import { HSL_BANDS } from '../../src/params/types';
import { HSL_CENTERS_RAD, hslBandWeights } from '../../src/color/hsl';

const sum = (w: Float32Array) => w.reduce((a, b) => a + b, 0);
const argmax = (w: Float32Array) => w.indexOf(Math.max(...w));

test('赤（0rad）で red の重みが最大、合計 1', () => {
  const w = hslBandWeights(0);
  expect(w.length).toBe(8);
  expect(HSL_BANDS[argmax(w)]).toBe('red');
  expect(sum(w)).toBeCloseTo(1, 6);
});

test('合計は常に 1、負にならない', () => {
  for (let i = -100; i <= 100; i++) {
    const w = hslBandWeights((i / 100) * 2 * Math.PI);
    expect(sum(w)).toBeCloseTo(1, 6);
    expect(Math.min(...w)).toBeGreaterThanOrEqual(0);
  }
});

test('各バンドの中心でそのバンドが 1', () => {
  HSL_CENTERS_RAD.forEach((c, i) => expect(hslBandWeights(c)[i]).toBeCloseTo(1, 6));
});

test('隣接バンドの中間で 2 バンドが 0.5 ずつ', () => {
  for (let i = 0; i < 8; i++) {
    const a = HSL_CENTERS_RAD[i]!;
    let b = HSL_CENTERS_RAD[(i + 1) % 8]!;
    if (b < a) b += 2 * Math.PI;
    const w = hslBandWeights((a + b) / 2);
    expect(w[i]).toBeCloseTo(0.5, 6);
    expect(w[(i + 1) % 8]).toBeCloseTo(0.5, 6);
  }
});
