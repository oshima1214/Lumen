import { test, expect } from 'vitest';
import { defaultParams } from '../../src/params/defaults';
import {
  SIDECAR_SCHEMA, SidecarError, fromSidecar, sourceChanged, toSidecar,
} from '../../src/params/sidecar';

const src = { name: 'IMG_0001.NEF', size: 25123456, mtime: 1730851200000 };
const ok = { app: 'lumen', schema: 1, source: src, params: {}, rating: 0 };

test('ヘッダー', () => {
  const s = toSidecar(defaultParams(), src, 4);
  expect(s).toMatchObject({ app: 'lumen', schema: SIDECAR_SCHEMA, source: src, rating: 4 });
  expect(SIDECAR_SCHEMA).toBe(1);
});

test('既定値のみなら params は空', () =>
  expect(toSidecar(defaultParams(), src, 0).params).toEqual({}));

test('差分だけ書く', () => {
  const p = defaultParams(); p.basic.exposure = 0.35; p.hsl.blue.s = -20;
  expect(toSidecar(p, src, 3).params).toEqual({ basic: { exposure: 0.35 }, hsl: { blue: { s: -20 } } });
});

test('カーブは配列ごと比較し、変更時は配列全体を書く', () => {
  const p = defaultParams();
  expect(toSidecar(p, src, 0).params).toEqual({});
  p.curve.rgb = [[0, 0], [0.5, 0.6], [1, 1]];
  p.curve.parametric.splits = [0.2, 0.5, 0.75];
  expect(toSidecar(p, src, 0).params).toEqual({
    curve: { rgb: [[0, 0], [0.5, 0.6], [1, 1]], parametric: { splits: [0.2, 0.5, 0.75] } },
  });
});

test('往復で一致', () => {
  const p = defaultParams();
  p.wb = { mode: 'custom', temp: 5200, tint: 8 };
  p.basic.contrast = 10; p.basic.highlights = -40;
  p.curve.g = [[0, 0.1], [0.4, 0.5], [1, 1]];
  p.hsl.orange.h = 12;
  p.grading.shadows = { hue: 210, sat: 20, lum: -5 }; p.grading.blending = 70;
  p.crop = { x: 0.1, y: 0.05, w: 0.8, h: 0.9, angle: -3.5, aspect: '3:2' };
  const loaded = fromSidecar(JSON.parse(JSON.stringify(toSidecar(p, src, 2))));
  expect(loaded.params).toEqual(p);
  expect(loaded.rating).toBe(2);
  expect(loaded.source).toEqual(src);
  expect(loaded.readOnly).toBe(false);
});

test('範囲外の値は丸める', () =>
  expect(fromSidecar({ ...ok, params: { basic: { exposure: 99 } } }).params.basic.exposure).toBe(5));

test('未知のキーは無視', () => {
  const l = fromSidecar({ ...ok, extra: 1, params: { basic: { exposure: 1, foo: 3 }, bar: { x: 1 }, hsl: { cyan: { h: 1 } } } });
  const want = defaultParams(); want.basic.exposure = 1;
  expect(l.params).toEqual(want);
});

test('型の違う値は無視', () => {
  const l = fromSidecar({ ...ok, params: { basic: { exposure: '2' }, crop: 5, curve: { rgb: 'x' } } });
  expect(l.params).toEqual(defaultParams());
});

test('schema が新しすぎると readOnly', () => expect(fromSidecar({ ...ok, schema: 2 }).readOnly).toBe(true));

test('rating は 0..5 の整数、source が無ければ null', () => {
  const { source: _s, ...noSource } = ok;
  const l = fromSidecar({ ...noSource, rating: 9 });
  expect(l.rating).toBe(5);
  expect(l.source).toBeNull();
});

test('app が違う・JSON でない・params が配列 → SidecarError', () => {
  expect(() => fromSidecar({ ...ok, app: 'other' })).toThrow(SidecarError);
  expect(() => fromSidecar('{"app":"lumen"}')).toThrow(SidecarError);
  expect(() => fromSidecar(null)).toThrow(SidecarError);
  expect(() => fromSidecar([1])).toThrow(SidecarError);
  expect(() => fromSidecar({ ...ok, params: [] })).toThrow(SidecarError);
  expect(() => fromSidecar({ ...ok, schema: 'x' })).toThrow(SidecarError);
  expect(() => fromSidecar({ ...ok, schema: 0 })).toThrow(SidecarError);
});

test('sourceChanged はサイズか mtime が違えば true、null は false', () => {
  expect(sourceChanged(src, { ...src })).toBe(false);
  expect(sourceChanged(src, { ...src, size: 1 })).toBe(true);
  expect(sourceChanged(src, { ...src, mtime: 2 })).toBe(true);
  expect(sourceChanged(src, { ...src, name: 'other.NEF' })).toBe(false);
  expect(sourceChanged(null, src)).toBe(false);
});
