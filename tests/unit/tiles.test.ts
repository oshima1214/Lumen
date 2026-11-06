import { test, expect } from 'vitest';
import { planTiles, TILE } from '../../src/export/tiles';
import { defaultParams } from '../../src/params/defaults';

const crop = (c: Partial<ReturnType<typeof defaultParams>['crop']> = {}) => ({ ...defaultParams().crop, ...c });

function coverExactly(plan: ReturnType<typeof planTiles>) {
  let area = 0;
  for (const t of plan.tiles) area += t.core.w * t.core.h;
  expect(area).toBe(plan.outW * plan.outH);
  for (let i = 0; i < plan.tiles.length; i++) for (let j = i + 1; j < plan.tiles.length; j++) {
    const a = plan.tiles[i]!.core, b = plan.tiles[j]!.core;
    const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    expect(ix > 0 && iy > 0).toBe(false);
  }
}

test('6000x4000 原寸: 出力 6000x4000、core が重複なく全域を覆い、描画範囲は TILE 以下', () => {
  const p = planTiles({ w: 6000, h: 4000, o: 1 }, crop(), null);
  expect([p.outW, p.outH]).toEqual([6000, 4000]);
  coverExactly(p);
  for (const t of p.tiles) { expect(t.frame.w).toBeLessThanOrEqual(TILE); expect(t.frame.h).toBeLessThanOrEqual(TILE); }
});

test('長辺 2048 指定: 出力 2048x1365。原寸で現像してから縮小するので描画範囲は TILE 以下', () => {
  const p = planTiles({ w: 6000, h: 4000, o: 1 }, crop(), 2048);
  expect([p.outW, p.outH]).toEqual([2048, 1365]);
  coverExactly(p);
  for (const t of p.tiles) expect(Math.max(t.frame.w, t.frame.h)).toBeLessThanOrEqual(TILE);
});

test('原寸より大きい長辺指定は拡大しない', () => {
  const p = planTiles({ w: 3000, h: 2000, o: 1 }, crop(), 9999);
  expect([p.outW, p.outH]).toEqual([3000, 2000]);
});

test('orientation 6 + 左半分の切り抜き: 出力は向き補正後の寸法', () => {
  const p = planTiles({ w: 4000, h: 3000, o: 6 }, crop({ w: 0.5 }), null);
  expect([p.outW, p.outH]).toEqual([1500, 4000]);
  coverExactly(p);
});

test('src は frame を含む保存画素の範囲（重なり込み）', () => {
  const p = planTiles({ w: 6000, h: 4000, o: 1 }, crop(), null);
  const t = p.tiles[1]!;          // 2 枚目（右隣）は左に重なりを持つ
  expect(t.src.x).toBeLessThan(t.core.x);
  expect(t.src.x + t.src.w).toBeGreaterThan(t.core.x + t.core.w);
});

test('9000x1000（上限超え）でも計画できる', () => {
  const p = planTiles({ w: 9000, h: 1000, o: 1 }, crop(), null);
  expect([p.outW, p.outH]).toEqual([9000, 1000]);
  coverExactly(p);
});
