import { test, expect } from 'vitest';
import { addPoint, movePoint, removePoint, MAX_POINTS } from '../../src/ui/curve-edit';
import type { CurvePoint } from '../../src/params/types';

const id: CurvePoint[] = [[0, 0], [1, 1]];

test('addPoint は x でソートして挿入する', () => {
  expect(addPoint(addPoint(id, 0.75, 0.8), 0.25, 0.2)).toEqual([[0, 0], [0.25, 0.2], [0.75, 0.8], [1, 1]]);
});
test('addPoint は最大 16 点（17 点目は追加しない）', () => {
  let pts = id;
  for (let i = 1; i <= 20; i++) pts = addPoint(pts, i / 21, i / 21);
  expect(pts.length).toBe(MAX_POINTS);
  expect(MAX_POINTS).toBe(16);
});
test('addPoint は既存の点と x が近すぎる（0.01 未満）なら追加しない', () => {
  expect(addPoint([[0, 0], [0.5, 0.5], [1, 1]], 0.505, 0.9)).toEqual([[0, 0], [0.5, 0.5], [1, 1]]);
});
test('movePoint は隣の点の x を越えない（0.01 の余白）', () => {
  const pts: CurvePoint[] = [[0, 0], [0.3, 0.3], [0.6, 0.6], [1, 1]];
  expect(movePoint(pts, 1, 0.9, 0.5)[1]).toEqual([0.59, 0.5]);
  expect(movePoint(pts, 2, 0.1, 0.5)[2]).toEqual([0.31, 0.5]);
});
test('movePoint: 端点は x を固定し y だけ動く、y は 0..1', () => {
  expect(movePoint(id, 0, 0.4, 0.2)[0]).toEqual([0, 0.2]);
  expect(movePoint(id, 1, 0.4, 1.7)[1]).toEqual([1, 1]);
});
test('removePoint: 端点は削除できない、中間点は削除できる', () => {
  const pts: CurvePoint[] = [[0, 0], [0.5, 0.6], [1, 1]];
  expect(removePoint(pts, 0)).toEqual(pts);
  expect(removePoint(pts, 2)).toEqual(pts);
  expect(removePoint(pts, 1)).toEqual(id);
});
test('元の配列を書き換えない', () => {
  const pts: CurvePoint[] = [[0, 0], [0.5, 0.5], [1, 1]];
  movePoint(pts, 1, 0.4, 0.4); addPoint(pts, 0.2, 0.2); removePoint(pts, 1);
  expect(pts).toEqual([[0, 0], [0.5, 0.5], [1, 1]]);
});
