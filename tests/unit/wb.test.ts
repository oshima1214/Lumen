import { test, expect } from 'vitest';
import { REC2020_TO_XYZ, apply3 } from '../../src/color/spaces';
import type { Mat3, Vec3 } from '../../src/color/spaces';
import {
  D65_XY, asShotCctTint, bradford, cctTintToXy, displayWbMatrix, rawWbMultipliers, xyToCctTint,
} from '../../src/color/wb';

const close = (a: readonly number[], b: readonly number[], eps: number) =>
  a.forEach((v, i) => expect(Math.abs(v - (b[i] ?? NaN))).toBeLessThan(eps));

test('D65 は 6504K（1% 以内）、その色温度・色かぶりから D65 に戻る（0.002 以内）', () => {
  const d = xyToCctTint(D65_XY[0], D65_XY[1]);
  expect(Math.abs(d.cct / 6504 - 1)).toBeLessThan(0.01);
  close(cctTintToXy(6504, d.tint), [0.3127, 0.329], 0.002);
  // D65 は Planck 軌跡より緑側（Duv ≈ +0.0032）= tint ≈ +32
  expect(Math.abs(d.tint - 32)).toBeLessThan(2);
});

test('tint 0 は Planck 軌跡上（6504K ≈ (0.3135, 0.3236)）', () =>
  close(cctTintToXy(6504, 0), [0.3135, 0.3236], 0.002));

test('2856K（A 光源）≈ (0.4476, 0.4074)', () => close(cctTintToXy(2856, 0), [0.4476, 0.4074], 0.002));

test('25000K を超えると飽和', () => close(cctTintToXy(40000, 0), cctTintToXy(25000, 0), 1e-12));

test('xyToCctTint(cctTintToXy(t, d)) の往復', () => {
  for (let t = 2500; t <= 12000; t += 500) {
    for (let d = -50; d <= 50; d += 10) {
      const [x, y] = cctTintToXy(t, d);
      const r = xyToCctTint(x, y);
      expect(Math.abs(r.cct / t - 1)).toBeLessThan(0.01);
      expect(Math.abs(r.tint - d)).toBeLessThan(1);
    }
  }
});

test('tint 正は軌跡より緑側（y が大きい）', () =>
  expect(cctTintToXy(5000, 50)[1]).toBeGreaterThan(cctTintToXy(5000, 0)[1]));

test('rawWbMultipliers: camToXyz = REC2020_TO_XYZ で D65 指定なら [1,1,1]', () => {
  const d = xyToCctTint(D65_XY[0], D65_XY[1]);
  close(rawWbMultipliers(REC2020_TO_XYZ, d.cct, d.tint), [1, 1, 1], 1e-3);
});

test('asShotCctTint と rawWbMultipliers の往復', () => {
  const cam: Mat3 = [0.7, 0.2, 0.1, 0.3, 0.8, -0.1, 0.05, -0.1, 1.2];
  const neutral: Vec3 = [0.45, 1, 0.62];
  const { cct, tint } = asShotCctTint(cam, neutral);
  close(rawWbMultipliers(cam, cct, tint), [1 / 0.45, 1, 1 / 0.62], 1e-3);
});

test('低い色温度ほど青の倍率が大きい', () => {
  const lo = rawWbMultipliers(REC2020_TO_XYZ, 3200, 0);
  const hi = rawWbMultipliers(REC2020_TO_XYZ, 8000, 0);
  expect(lo[2]).toBeGreaterThan(hi[2]);
  expect(lo[1]).toBe(1);
});

test('bradford: 同じ白なら単位行列、白を白へ写す', () => {
  close(bradford(D65_XY, D65_XY), [1, 0, 0, 0, 1, 0, 0, 0, 1], 1e-12);
  const a: [number, number] = [0.4476, 0.4074];
  const m = bradford(a, D65_XY);
  const xyz = (p: [number, number]): Vec3 => [p[0] / p[1], 1, (1 - p[0] - p[1]) / p[1]];
  close(apply3(m, xyz(a)), xyz(D65_XY), 1e-9);
});

test('displayWbMatrix(0,0) は単位行列', () =>
  expect(displayWbMatrix(0, 0)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]));

test('displayWbMatrix(50,0) を灰色に適用すると R > B（暖色）、-50 は寒色', () => {
  const w = apply3(displayWbMatrix(50, 0), [0.18, 0.18, 0.18]);
  expect(w[0]).toBeGreaterThan(w[2]);
  const c = apply3(displayWbMatrix(-50, 0), [0.18, 0.18, 0.18]);
  expect(c[0]).toBeLessThan(c[2]);
});

test('displayWbMatrix の tint 正はマゼンタ側（G が下がる）', () => {
  const m = apply3(displayWbMatrix(0, 50), [0.18, 0.18, 0.18]);
  expect(m[1]).toBeLessThan(Math.min(m[0], m[2]));
});
