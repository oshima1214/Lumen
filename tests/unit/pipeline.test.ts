import { test, expect } from 'vitest';
import { defaultParams } from '../../src/params/defaults';
import { SRGB_TO_XYZ, XYZ_TO_REC2020, REC2020_TO_XYZ, apply3, mul3, srgbEotf, srgbOetf } from '../../src/color/spaces';
import type { Vec3 } from '../../src/color/spaces';
import { linearToOklab } from '../../src/color/oklab';
import { buildUniforms, packUniforms, UNIFORM_FLOATS } from '../../src/color/uniforms';
import { developPixel, luminance2020 } from '../../src/color/pipeline';
import type { DevelopParams } from '../../src/params/types';

const SRGB_TO_2020 = mul3(XYZ_TO_REC2020, SRGB_TO_XYZ);
const display = { kind: 'display' as const };
const fromSrgb = (v: Vec3): Vec3 => apply3(SRGB_TO_2020, v.map(srgbEotf) as Vec3);
const run = (p: DevelopParams, rgb: Vec3, out: 'srgb' | 'p3' = 'srgb') => {
  const { u, luts } = buildUniforms(p, display, out);
  return developPixel(rgb, luminance2020(rgb), u, luts);
};

test('既定値 + display + sRGB は恒等（64 点の灰色と 8 色）', () => {
  const p = defaultParams();
  const cases: Vec3[] = [];
  for (let i = 0; i < 64; i++) { const v = i / 63; cases.push([v, v, v]); }
  for (let k = 0; k < 8; k++) cases.push([k & 1, (k >> 1) & 1, (k >> 2) & 1]);
  cases.push([0.9, 0.4, 0.05], [0.2, 0.6, 0.85]);
  for (const c of cases) {
    const o = run(p, fromSrgb(c));
    c.forEach((v, i) => expect(Math.abs(o[i]! - v)).toBeLessThan(1 / 1024));
  }
});

test('露光 +1 で灰色 0.18 → 0.36', () => {
  const p = defaultParams(); p.basic.exposure = 1;
  const o = run(p, [0.18, 0.18, 0.18]);
  o.forEach((v) => expect(Math.abs(v - srgbOetf(0.36))).toBeLessThan(1 / 1024));
});

test('彩度 −100 で R=G=B', () => {
  const p = defaultParams(); p.basic.saturation = -100;
  for (const c of [[0.9, 0.2, 0.1], [0.1, 0.7, 0.3], [0.2, 0.3, 0.95]] as Vec3[]) {
    const [r, g, b] = run(p, fromSrgb(c));
    expect(Math.abs(r! - g!)).toBeLessThan(1e-5);
    expect(Math.abs(g! - b!)).toBeLessThan(1e-5);
  }
});

test('自然な彩度は低彩度を強く上げ、肌色を守る', () => {
  const p = defaultParams(); p.basic.vibrance = 80;
  const chroma = (v: Vec3) => { const l = linearToOklab(apply3(mul3(XYZ_TO_REC2020, SRGB_TO_XYZ), v.map(srgbEotf) as Vec3)); return Math.hypot(l[1], l[2]); };
  const ratio = (c: Vec3) => chroma(run(p, fromSrgb(c))) / chroma(c);
  const muted = ratio([0.45, 0.5, 0.6]);
  const vivid = ratio([0.1, 0.2, 0.95]);
  const skin = ratio([0.87, 0.67, 0.55]);
  expect(muted).toBeGreaterThan(1.3);
  expect(vivid).toBeLessThan(muted);
  expect(skin).toBeLessThan(muted);
});

test('HSL: 青バンドの彩度 −100 は青を灰色に、赤は保つ', () => {
  const p = defaultParams(); p.hsl.blue.s = -100;
  const [r, g, b] = run(p, fromSrgb([0, 0, 1]));
  expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!)).toBeLessThan(0.02);
  const red = run(p, fromSrgb([1, 0, 0]));
  expect(Math.abs(red[0]! - 1)).toBeLessThan(1 / 1024);
});

test('グレーディング: シャドウに青を入れると暗部が青く、明部はほぼ不変', () => {
  const p = defaultParams(); p.grading.shadows = { hue: 264, sat: 80, lum: 0 }; p.grading.blending = 0;
  const dark = run(p, fromSrgb([0.2, 0.2, 0.2]));
  expect(dark[2]!).toBeGreaterThan(dark[0]! + 0.02);
  const light = run(p, fromSrgb([0.95, 0.95, 0.95]));
  expect(Math.abs(light[2]! - light[0]!)).toBeLessThan(0.005);
});

test('RGB カーブ・R カーブ', () => {
  const p = defaultParams(); p.curve.r = [[0, 0], [0.5, 0.7], [1, 1]];
  const o = run(p, fromSrgb([0.5, 0.5, 0.5]));
  // カーブは作業空間（Rec.2020 の原色）で掛かるので、sRGB 出力の G/B にも少し漏れる
  expect(o[0]!).toBeGreaterThan(0.6);
  expect(o[0]! - o[1]!).toBeGreaterThan(0.1);
  const s = defaultParams(); s.curve.rgb = [[0, 0], [0.25, 0.18], [0.75, 0.82], [1, 1]];
  const dark = run(s, [0.03, 0.03, 0.03]), light = run(s, [0.5, 0.5, 0.5]);
  expect(dark[0]!).toBeLessThan(srgbOetf(0.03));
  expect(light[0]!).toBeGreaterThan(srgbOetf(0.5));
});

test('出力 P3: 灰色は灰色、sRGB の赤は P3 では R<1', () => {
  const g = run(defaultParams(), [0.18, 0.18, 0.18], 'p3');
  g.forEach((v) => expect(Math.abs(v - srgbOetf(0.18))).toBeLessThan(1 / 1024));
  const r = run(defaultParams(), fromSrgb([1, 0, 0]), 'p3');
  expect(r[0]!).toBeLessThan(0.95);
});

test('display の相対 WB +50 は暖色', () => {
  const p = defaultParams(); p.wb = { mode: 'custom', temp: 50, tint: 0 };
  const [r, , b] = run(p, [0.18, 0.18, 0.18]);
  expect(r!).toBeGreaterThan(b! + 0.01);
});

test('RAW: 撮影時 WB の中性点は灰色になり、白飛びは無彩色になる', () => {
  // カメラ RGB (0.5, 1, 0.7) が D65 の白になる合成カメラ
  const camToXyz = mul3(REC2020_TO_XYZ, [2, 0, 0, 0, 1, 0, 0, 0, 1 / 0.7]);
  const info = { kind: 'raw' as const, camToXyz, asShotNeutral: [0.5, 1, 0.7] as Vec3 };
  const { u, luts } = buildUniforms(defaultParams(), info, 'srgb');
  expect(u.kind).toBe(1);
  expect(u.baseToneMap).toBe(1);
  const gray = developPixel([0.09, 0.18, 0.126], 0.18, u, luts);
  expect(Math.abs(gray[0]! - gray[1]!)).toBeLessThan(1 / 512);
  expect(Math.abs(gray[2]! - gray[1]!)).toBeLessThan(1 / 512);
  // 全チャンネル飽和 → クリップで無彩色。輝度 1 はベーストーンマップで f(1) = 17/32
  const blown = developPixel([1, 1, 1], 1, u, luts);
  expect(Math.max(...blown) - Math.min(...blown)).toBeLessThan(1 / 512);
  expect(Math.abs(blown[1]! - srgbOetf(17 / 32))).toBeLessThan(1 / 512);
  // R と B だけ飽和（WB 後に G より先に飽和する）でもマゼンタにならない
  const pinkish = developPixel([0.6, 0.95, 0.8], 1, u, luts);
  expect(Math.abs(pinkish[0]! - pinkish[1]!)).toBeLessThan(0.02);
  const custom = defaultParams(); custom.wb = { mode: 'custom', temp: 3200, tint: 0 };
  const c = buildUniforms(custom, info, 'srgb');
  const g2 = developPixel([0.09, 0.18, 0.126], 0.18, c.u, c.luts);
  expect(g2[2]!).toBeGreaterThan(g2[0]!); // 光源を電球色とみなすので青くなる
});

test('ハイライト／シャドウは baseLum で決まる', () => {
  const p = defaultParams(); p.basic.highlights = -100;
  const { u, luts } = buildUniforms(p, display, 'srgb');
  const px: Vec3 = [0.5, 0.5, 0.5];
  const hi = developPixel(px, 0.8, u, luts);
  const lo = developPixel(px, 0.02, u, luts);
  expect(hi[0]!).toBeLessThan(lo[0]! - 0.05);
  expect(Math.abs(lo[0]! - srgbOetf(0.5))).toBeLessThan(1 / 1024);
});

test('出力は 0..1', () => {
  const p = defaultParams(); p.basic.exposure = 5; p.basic.contrast = 100; p.basic.saturation = 100;
  for (const c of [[1, 0, 0], [0, 0, 0], [0.5, 0.9, 0.1]] as Vec3[]) {
    for (const v of run(p, c)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  }
});

test('packUniforms の長さが 4 の倍数（16 byte 境界）', () => {
  const p = defaultParams(); p.hsl.red.h = 30; p.grading.global = { hue: 90, sat: 50, lum: 10 };
  const { u } = buildUniforms(p, display, 'srgb');
  const f = packUniforms(u);
  expect(f.length % 4).toBe(0);
  expect(f.length).toBe(UNIFORM_FLOATS);
  expect(f[1]).toBe(1); // exposureMul
  expect(f[52]).toBeCloseTo(0.3, 6); // hsl[0].h
});

test('極端なパラメータと端の画素でも NaN を出さない（Task 13 のパリティ条件）', () => {
  const sets: ((p: DevelopParams) => void)[] = [
    (p) => { p.basic.exposure = 2; }, (p) => { p.basic.exposure = -3; },
    (p) => { p.basic.contrast = 80; p.basic.whites = 60; p.basic.blacks = -60; },
    (p) => { p.basic.contrast = -80; p.basic.whites = -60; p.basic.blacks = 60; },
    (p) => { p.basic.vibrance = 80; p.basic.saturation = -100; },
    (p) => { p.basic.highlights = -100; p.basic.shadows = 100; },
    (p) => { for (const b of Object.values(p.hsl)) { b.h = 60; b.s = -60; b.l = 60; } },
    (p) => { p.grading.shadows = { hue: 200, sat: 100, lum: -100 }; p.grading.highlights = { hue: 40, sat: 100, lum: 100 }; p.grading.blending = 100; p.grading.balance = -100; },
    (p) => { p.grading.midtones = { hue: 300, sat: 100, lum: 50 }; p.grading.blending = 0; p.grading.balance = 100; },
    (p) => { p.curve.rgb = [[0, 0], [0.25, 0.15], [0.75, 0.85], [1, 1]]; p.curve.parametric.shadows = -100; p.curve.parametric.highlights = 100; },
    (p) => { p.wb = { mode: 'custom', temp: 50, tint: -30 }; },
    (p) => { p.wb = { mode: 'custom', temp: 3200, tint: 0 }; },
  ];
  const pixels: Vec3[] = [[0, 0, 0], [1, 1, 1], [1e-6, 0, 0], [0.999, 0.001, 0.5], [0.18, 0.18, 0.18], [0.8, 0.55, 0.45]];
  const infos = [display, { kind: 'raw' as const, camToXyz: mul3(REC2020_TO_XYZ, [2, 0.1, 0, 0, 1, 0, 0, -0.05, 1.4]), asShotNeutral: [0.5, 1, 0.7] as Vec3 }];
  for (const set of sets) {
    const p = defaultParams(); set(p);
    for (const info of infos) {
      for (const out of ['srgb', 'p3'] as const) {
        const { u, luts } = buildUniforms(p, info, out);
        for (const px of pixels) {
          for (const v of developPixel(px, luminance2020(px), u, luts)) {
            expect(Number.isFinite(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  }
});
