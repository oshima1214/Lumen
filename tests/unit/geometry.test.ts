import { test, expect } from 'vitest';
import { orientedSize, maxInscribedCrop, aspectValue, constrainCrop, croppedSize, sampleTransform } from '../../src/engine/geometry';
import { defaultParams } from '../../src/params/defaults';

const crop = (c: Partial<ReturnType<typeof defaultParams>['crop']>) => ({ ...defaultParams().crop, ...c });
/** 出力画素中心 (x+.5, y+.5) → 入力 UV */
function uv(m: Float32Array, x: number, y: number): [number, number] {
  const px = x + 0.5, py = y + 0.5;
  const w = m[6]! * px + m[7]! * py + m[8]!;
  return [(m[0]! * px + m[1]! * py + m[2]!) / w, (m[3]! * px + m[4]! * py + m[5]!) / w];
}
/** 回転した W×H の画像（中心回り）に点 (x,y)（向き補正後の画素座標、回転フレーム）が入るか */
function insideRotated(x: number, y: number, W: number, H: number, deg: number): boolean {
  const t = (deg * Math.PI) / 180, cx = W / 2, cy = H / 2;
  const dx = x - cx, dy = y - cy;
  const rx = Math.cos(t) * dx + Math.sin(t) * dy, ry = -Math.sin(t) * dx + Math.cos(t) * dy;
  return Math.abs(rx) <= W / 2 + 1e-6 && Math.abs(ry) <= H / 2 + 1e-6;
}

test('orientedSize: 6 と 8 は縦横を入れ替える', () => {
  expect(orientedSize(4000, 3000, 6)).toEqual({ w: 3000, h: 4000 });
  expect(orientedSize(4000, 3000, 8)).toEqual({ w: 3000, h: 4000 });
  expect(orientedSize(4000, 3000, 3)).toEqual({ w: 4000, h: 3000 });
});

test('maxInscribedCrop: 0° なら全体', () => {
  const r = maxInscribedCrop(3000, 2000, 0, null);
  for (const [a, b] of [[r.x, 0], [r.y, 0], [r.w, 1], [r.h, 1]] as const) expect(a).toBeCloseTo(b, 9);
});

test('maxInscribedCrop: 10° で縮み、4 隅が回転後の画像内にある', () => {
  const W = 3000, H = 2000, r = maxInscribedCrop(W, H, 10, null);
  expect(r.w).toBeLessThan(1);
  expect(r.h).toBeLessThan(1);
  for (const [x, y] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]] as const) {
    expect(insideRotated(x * W, y * H, W, H, 10)).toBe(true);
  }
  // 縦横比は元画像と同じ（null）
  expect((r.w * W) / (r.h * H)).toBeCloseTo(W / H, 6);
});

test('maxInscribedCrop: 1:1 指定はピクセルで正方形', () => {
  const W = 3000, H = 2000, r = maxInscribedCrop(W, H, 0, 1);
  expect(r.w * W).toBeCloseTo(r.h * H, 6);
  expect(r.h).toBeCloseTo(1, 9);
});

test('aspectValue: original は画像比、free は null、3:2 は画像の向きに合わせる', () => {
  expect(aspectValue('original', 3000, 2000)).toBeCloseTo(1.5);
  expect(aspectValue('free', 3000, 2000)).toBeNull();
  expect(aspectValue('3:2', 3000, 2000)).toBeCloseTo(1.5);
  expect(aspectValue('3:2', 2000, 3000)).toBeCloseTo(2 / 3);
  expect(aspectValue('1:1', 2000, 3000)).toBe(1);
});

test('constrainCrop: 回転で画像外にはみ出す枠は内側に収める', () => {
  const W = 3000, H = 2000;
  const c = constrainCrop(crop({ angle: 10 }), W, H);
  for (const [x, y] of [[c.x, c.y], [c.x + c.w, c.y], [c.x, c.y + c.h], [c.x + c.w, c.y + c.h]] as const) {
    expect(insideRotated(x * W, y * H, W, H, 10)).toBe(true);
  }
  expect(constrainCrop(crop({ x: -0.2, w: 1.5 }), W, H).w).toBeLessThanOrEqual(1);
});

test('croppedSize: orientation 6 で向き補正後の左半分 → 1500x4000（Review Focus 1）', () => {
  expect(croppedSize(4000, 3000, 6, crop({ w: 0.5 }))).toEqual({ w: 1500, h: 4000 });
});

test('sampleTransform: 恒等（向き 1、切り抜きなし、同寸）', () => {
  const t = sampleTransform({ w: 100, h: 50, o: 1 }, crop({}), { w: 100, h: 50 });
  const [u, v] = uv(t.m, 0, 0);
  expect(u).toBeCloseTo(0.5 / 100, 9);
  expect(v).toBeCloseTo(0.5 / 50, 9);
});

test('sampleTransform: orientation 6 + 向き補正後の左半分（Review Focus 1）', () => {
  // 保存画素 40x20。orientation 6 は 90° 時計回りで表示 → 向き補正後 20x40。左半分 = 10x40
  const t = sampleTransform({ w: 40, h: 20, o: 6 }, crop({ w: 0.5 }), { w: 10, h: 40 });
  // 出力の左上 ≈ 向き補正後 (0,0) = 保存画素の左下 (u≈0, v≈1)
  const [u0, v0] = uv(t.m, 0, 0);
  expect(u0).toBeLessThan(0.05);
  expect(v0).toBeGreaterThan(0.95);
  // 出力の右下 ≈ 向き補正後 (10,40) = 保存画素 (u=1, v=0.5)
  const [u1, v1] = uv(t.m, 9, 39);
  expect(u1).toBeGreaterThan(0.95);
  expect(v1).toBeCloseTo(0.5, 1);
});

test('sampleTransform: orientation 8 と 3', () => {
  const t8 = sampleTransform({ w: 40, h: 20, o: 8 }, crop({}), { w: 20, h: 40 });
  const [u8, v8] = uv(t8.m, 0, 0);       // 向き補正後の左上 = 保存の右上
  expect(u8).toBeGreaterThan(0.95); expect(v8).toBeLessThan(0.05);
  const t3 = sampleTransform({ w: 40, h: 20, o: 3 }, crop({}), { w: 40, h: 20 });
  const [u3, v3] = uv(t3.m, 0, 0);       // 左上 = 保存の右下
  expect(u3).toBeGreaterThan(0.95); expect(v3).toBeGreaterThan(0.95);
});

test('sampleTransform: view の 2 倍ズームで中心付近だけを写す', () => {
  const t = sampleTransform({ w: 100, h: 100, o: 1 }, crop({}), { w: 100, h: 100 }, { zoom: 2, cx: 0.5, cy: 0.5 });
  const [u, v] = uv(t.m, 0, 0);
  expect(u).toBeCloseTo(0.25, 2);
  expect(v).toBeCloseTo(0.25, 2);
});
