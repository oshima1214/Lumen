import { test, expect } from 'vitest';
import { linearToOklab, oklabToLinear } from '../../src/color/oklab';
import type { Vec3 } from '../../src/color/spaces';

test('白 → L≈1, a,b≈0', () => {
  const [L, a, b] = linearToOklab([1, 1, 1]);
  expect(Math.abs(L - 1)).toBeLessThan(1e-3);
  expect(Math.abs(a)).toBeLessThan(1e-3);
  expect(Math.abs(b)).toBeLessThan(1e-3);
});

test('黒 → 0', () => expect(linearToOklab([0, 0, 0]).map(Math.abs)).toEqual([0, 0, 0]));

test('往復誤差 1e-6', () => {
  const vs: Vec3[] = [[0.18, 0.18, 0.18], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.9, 0.4, 0.05], [2, 0.5, 0.1], [-0.01, 0.2, 0.3]];
  for (const v of vs) {
    const r = oklabToLinear(linearToOklab(v));
    v.forEach((c, i) => expect(Math.abs((r[i] ?? NaN) - c)).toBeLessThan(1e-6));
  }
});
