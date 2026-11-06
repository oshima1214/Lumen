import { test, expect } from 'vitest';
import { defaultParams } from '../../src/params/defaults';
import {
  DEFAULT_COPY_GROUPS, applyPartial, deepDiff, deepMerge, pickGroups, pruneToShape,
} from '../../src/params/partial';

test('deepDiff / deepMerge の往復', () => {
  const base = defaultParams();
  const v = defaultParams(); v.basic.whites = 12; v.curve.b = [[0, 0], [0.3, 0.2], [1, 1]];
  expect(deepMerge(base, deepDiff(base, v))).toEqual(v);
});

test('deepMerge は入力を変更せず、配列を複製する', () => {
  const base = defaultParams();
  const pts: [number, number][] = [[0, 0.1], [1, 1]];
  const m = deepMerge(base, { curve: { r: pts } });
  pts.push([0.5, 0.5]);
  expect(m.curve.r).toEqual([[0, 0.1], [1, 1]]);
  expect(base.curve.r).toEqual([[0, 0], [1, 1]]);
});

test('applyPartial は partial に無い項目を変えない', () => {
  const base = defaultParams();
  base.basic.exposure = 1.2; base.wb = { mode: 'custom', temp: 4300, tint: 5 }; base.crop.angle = 4;
  const out = applyPartial(base, { basic: { contrast: 30 }, hsl: { green: { s: -40 } } });
  const want = structuredClone(base); want.basic.contrast = 30; want.hsl.green.s = -40;
  expect(out).toEqual(want);
  expect(base.basic.contrast).toBe(0);
});

test('applyPartial は範囲に丸める', () =>
  expect(applyPartial(defaultParams(), { basic: { exposure: 12 } }).basic.exposure).toBe(5));

test("pickGroups(p, ['hsl']) は hsl キーだけを持つ", () => {
  const p = defaultParams(); p.hsl.aqua.l = 7; p.basic.exposure = 1;
  const g = pickGroups(p, ['hsl']);
  expect(Object.keys(g)).toEqual(['hsl']);
  expect(g.hsl).toEqual(p.hsl);
  expect(g.hsl).not.toBe(p.hsl);
});

test('ペーストで既定値に戻す項目も伝わる（グループ全体を含む）', () => {
  const src = defaultParams();
  const dst = defaultParams(); dst.basic.exposure = 2;
  expect(applyPartial(dst, pickGroups(src, DEFAULT_COPY_GROUPS)).basic.exposure).toBe(0);
});

test('DEFAULT_COPY_GROUPS に wb と crop が無い', () => {
  expect(DEFAULT_COPY_GROUPS).toEqual(['basic', 'curve', 'hsl', 'grading']);
  expect(DEFAULT_COPY_GROUPS).not.toContain('wb');
  expect(DEFAULT_COPY_GROUPS).not.toContain('crop');
});

test('pruneToShape は既定値と等しい値も残し、未知のキーと型違いを落とす', () => {
  const p = pruneToShape(defaultParams(), { basic: { exposure: 0, foo: 1, contrast: 'x' }, zzz: 1, curve: { rgb: [[0, 0], [1, 1]] } });
  expect(p).toEqual({ basic: { exposure: 0 }, curve: { rgb: [[0, 0], [1, 1]] } });
});
