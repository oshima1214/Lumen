import { test, expect } from 'vitest';
import {
  P3_TO_XYZ, REC2020_TO_XYZ, SRGB_TO_XYZ, XYZ_TO_P3, XYZ_TO_REC2020, XYZ_TO_SRGB,
  apply3, inv3, mul3, srgbEotf, srgbOetf,
} from '../../src/color/spaces';
import type { Mat3, Vec3 } from '../../src/color/spaces';

const I: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const close = (a: readonly number[], b: readonly number[], eps: number) =>
  a.forEach((v, i) => expect(Math.abs(v - (b[i] ?? NaN))).toBeLessThan(eps));

test('Rec.2020 ⇔ XYZ の往復', () => {
  for (const v of [[0.2, 0.5, 0.9], [1, 0, 0], [0.01, 0.3, 0.02]] as Vec3[]) {
    close(apply3(XYZ_TO_REC2020, apply3(REC2020_TO_XYZ, v)), v, 1e-6);
  }
});

test('inv3 の検算', () => {
  const m: Mat3 = [2, 1, 0.5, -1, 3, 0.2, 0.4, 0.1, 1.5];
  close(mul3(m, inv3(m)), I, 1e-12);
  close(mul3(inv3(m), m), I, 1e-12);
  close(mul3(SRGB_TO_XYZ, XYZ_TO_SRGB), I, 1e-9);
  close(mul3(P3_TO_XYZ, XYZ_TO_P3), I, 1e-9);
});

test('白 [1,1,1] は D65（Y=1）', () => {
  const d65: Vec3 = [0.3127 / 0.329, 1, (1 - 0.3127 - 0.329) / 0.329];
  for (const m of [REC2020_TO_XYZ, SRGB_TO_XYZ, P3_TO_XYZ]) close(apply3(m, [1, 1, 1]), d65, 1e-9);
});

test('sRGB の既知の行列値', () => {
  close(SRGB_TO_XYZ, [0.4124, 0.3576, 0.1805, 0.2126, 0.7152, 0.0722, 0.0193, 0.1192, 0.9505], 1e-3);
  close(REC2020_TO_XYZ, [0.6370, 0.1446, 0.1689, 0.2627, 0.6780, 0.0593, 0, 0.0281, 1.0610], 1e-3);
});

test('srgbOetf(srgbEotf(x)) ≈ x', () => {
  for (let i = 0; i <= 100; i++) {
    const x = i / 100;
    expect(Math.abs(srgbOetf(srgbEotf(x)) - x)).toBeLessThan(1e-9);
  }
  expect(srgbEotf(0.5)).toBeCloseTo(0.214041, 5);
});
