import { test, expect } from 'vitest';
import { HSL_BANDS } from '../../src/params/types';
import { defaultParams } from '../../src/params/defaults';
import { applyPartial } from '../../src/params/partial';
import { BUILTIN_PRESETS, parsePreset, serializePreset } from '../../src/params/presets';
import type { Preset } from '../../src/params/presets';

test('組み込みプリセット 4 件の名前', () =>
  expect(BUILTIN_PRESETS.map((p) => p.name)).toEqual(['モノクロ', '高コントラスト', 'フィルム調', 'ソフト']));

test('組み込みは builtin=true', () => expect(BUILTIN_PRESETS.every((p) => p.builtin)).toBe(true));

test('モノクロは彩度 -100（または全 HSL バンドの s=-100）', () => {
  const mono = BUILTIN_PRESETS.find((p) => p.name === 'モノクロ');
  expect(mono).toBeDefined();
  const pp = mono!.params;
  const allBands = HSL_BANDS.every((b) => pp.hsl?.[b]?.s === -100);
  expect(pp.basic?.saturation === -100 || allBands).toBe(true);
});

test('組み込みプリセットは範囲内（適用しても値が変わらない）', () => {
  for (const p of BUILTIN_PRESETS) {
    const applied = applyPartial(defaultParams(), p.params);
    expect(applyPartial(applied, {})).toEqual(applied);
    expect(parsePreset(serializePreset(p)).params).toEqual(p.params);
  }
});

test('往復', () => {
  const x: Preset = { name: '夕景', builtin: false, params: { basic: { exposure: 0, vibrance: 20 }, curve: { rgb: [[0, 0.05], [1, 1]] } } };
  expect(parsePreset(serializePreset(x))).toEqual(x);
  expect(parsePreset(JSON.parse(serializePreset(x)))).toEqual(x);
});

test('builtin は読み込み時に必ず false', () => {
  const mono = BUILTIN_PRESETS[0]!;
  expect(parsePreset(serializePreset(mono)).builtin).toBe(false);
  expect(parsePreset({ name: 'a', builtin: true, params: {} }).builtin).toBe(false);
});

test('未知のキーは落とす', () =>
  expect(parsePreset({ name: 'a', params: { basic: { exposure: 1, foo: 2 }, bar: 1 } }).params).toEqual({ basic: { exposure: 1 } }));

test('不正なら Error', () => {
  expect(() => parsePreset('not json')).toThrow(Error);
  expect(() => parsePreset(null)).toThrow(Error);
  expect(() => parsePreset({ name: '', params: {} })).toThrow(Error);
  expect(() => parsePreset({ name: 'a', params: [] })).toThrow(Error);
  expect(() => parsePreset({ name: 'a' })).toThrow(Error);
  expect(() => parsePreset({ app: 'other', name: 'a', params: {} })).toThrow(Error);
});
