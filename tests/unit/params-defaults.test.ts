import { test, expect } from 'vitest';
import { HSL_BANDS } from '../../src/params/types';
import { defaultParams, RANGES, clampParams, clampWb } from '../../src/params/defaults';

test('defaultParams は毎回新しいオブジェクト', () => {
  const a = defaultParams();
  const b = defaultParams();
  expect(a).not.toBe(b);
  expect(a).toEqual(b);
  a.curve.rgb.push([0.5, 0.6]);
  a.hsl.red.s = 10;
  expect(b.curve.rgb).toEqual([[0, 0], [1, 1]]);
  expect(b.hsl.red.s).toBe(0);
  expect(defaultParams().curve.parametric.splits).toEqual([0.25, 0.5, 0.75]);
});

test('HSL_BANDS は 8 色域', () => expect(HSL_BANDS.length).toBe(8));

test('既定値（仕様 4.1）', () => {
  const p = defaultParams();
  expect(p.wb).toEqual({ mode: 'asShot', temp: 0, tint: 0 });
  expect(p.grading.blending).toBe(50);
  expect(p.grading.balance).toBe(0);
  expect(p.crop).toEqual({ x: 0, y: 0, w: 1, h: 1, angle: 0, aspect: 'original' });
});

test('clampParams', () => {
  const p = defaultParams();
  p.basic.exposure = 9;
  p.crop.w = 1.5;
  p.grading.shadows.hue = 400;
  p.basic.contrast = -300;
  p.crop.angle = 90;
  const c = clampParams(p);
  expect(c.basic.exposure).toBe(5);
  expect(c.crop.w).toBe(1);
  expect(c.grading.shadows.hue).toBe(360);
  expect(c.basic.contrast).toBe(-100);
  expect(c.crop.angle).toBe(45);
  expect(p.basic.exposure).toBe(9); // 入力は変更しない
});

test('clampParams: 非有限値は既定値、カーブ点は 0..1', () => {
  const p = defaultParams();
  p.basic.shadows = Number.NaN;
  p.curve.r = [[-0.2, 0], [1, 1.4]];
  const c = clampParams(p);
  expect(c.basic.shadows).toBe(0);
  expect(c.curve.r).toEqual([[0, 0], [1, 1]]);
});

test('RANGES は "group.key" 形式', () => {
  expect(RANGES['basic.exposure']).toEqual([-5, 5]);
  expect(RANGES['wb.temp']).toEqual([2000, 50000]);
  expect(RANGES['hsl.blue.s']).toEqual([-100, 100]);
  expect(RANGES['grading.midtones.hue']).toEqual([0, 360]);
});

test('clampWb は画像の種類に合わせる', () => {
  expect(clampWb({ mode: 'custom', temp: 100000, tint: 200 }, 'raw')).toEqual({ mode: 'custom', temp: 50000, tint: 150 });
  expect(clampWb({ mode: 'asShot', temp: 0, tint: 0 }, 'raw')).toEqual({ mode: 'asShot', temp: 0, tint: 0 });
  expect(clampWb({ mode: 'custom', temp: 5000, tint: -120 }, 'display')).toEqual({ mode: 'custom', temp: 100, tint: -100 });
});
