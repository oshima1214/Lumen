// 幾何（仕様 3.3）。切り抜き・回転・向きは処理段ではなく、出力時のサンプリング座標変換として扱う。
//
// SampleTransform.m は行優先の 3×3: [u, v, 1]ᵀ ∝ m · [px, py, 1]ᵀ。
//   (px, py) = 出力テクスチャ上の画素中心の絶対座標（画素 (x, y) なら (x + 0.5, y + 0.5)。outRect の原点ではない）。
//   (u, v) = 入力画像（向き補正前・切り抜き前の全体）の正規化座標 0..1。画素 (i, j) の中心は ((i + 0.5)/w, (j + 0.5)/h)。
//   3 行目で割る（射影）。アフィン変換なら 3 行目は [0, 0, 1]。

import type { DevelopParams, Aspect } from '../params/types';
import type { Orientation } from '../decode/types';
import type { Rect } from './develop';

export interface SampleTransform { m: Float32Array }

/** w×h の出力を同じ w×h の入力へ 1:1 で写す恒等変換 */
export function identitySample(w: number, h: number): SampleTransform {
  return { m: new Float32Array([1 / w, 0, 0, 0, 1 / h, 0, 0, 0, 1]) };
}

// ---- Task 15: 向き・切り抜き・回転（純粋関数） ----
// 座標系:
//   保存画素（デコードされたまま、向き補正前）: W×H。UV = 保存画素 / (W, H)。
//   向き補正後（oriented）: OW×OH（orientation 6/8 は W と H が入れ替わる）。
//   切り抜き枠（crop）: 向き補正後の画像を中心回りに angle 度だけ回したフレーム上の正規化矩形（x,y,w,h ∈ 0..1、
//   単位は OW・OH）。angle > 0 で画像が画面上で時計回りに回る。
//   フレーム上の点 d → 向き補正後の点 o = C + Rot(−angle)(d − C)（C は画像中心、Rot は y 下向きの回転行列）。

type Crop = DevelopParams['crop'];
type M3 = [number, number, number, number, number, number, number, number, number];

export function orientedSize(w: number, h: number, o: Orientation): { w: number; h: number } {
  return o === 6 || o === 8 ? { w: h, h: w } : { w, h };
}

/** 縦横比（ピクセルの幅/高さ）。original は画像比、free は null。比率指定は画像の向き（横長/縦長）に合わせる */
export function aspectValue(a: Aspect, w: number, h: number): number | null {
  if (a === 'free') return null;
  if (a === 'original') return w / h;
  const [p, q] = a.split(':').map(Number) as [number, number];
  const r = Math.max(p, q) / Math.min(p, q);
  return w >= h ? r : 1 / r;
}

/** w×h（向き補正後）を angle 度回した画像に内接する、中心を共有する最大の矩形（正規化）。aspect null は画像比 */
export function maxInscribedCrop(w: number, h: number, angleDeg: number, aspect: number | null): Rect {
  const r = aspect ?? w / h;
  const t = (Math.abs(angleDeg) * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const a = Math.min(w / 2 / (c + s / r), h / 2 / (s + c / r), w / 2, (h / 2) * r);   // 半幅
  const b = a / r;
  return { x: 0.5 - a / w, y: 0.5 - b / h, w: (2 * a) / w, h: (2 * b) / h };
}

function cornersInside(c: { x: number; y: number; w: number; h: number }, angle: number, W: number, H: number): boolean {
  const t = (angle * Math.PI) / 180, co = Math.cos(t), si = Math.sin(t);
  for (const [px, py] of [[c.x, c.y], [c.x + c.w, c.y], [c.x, c.y + c.h], [c.x + c.w, c.y + c.h]] as const) {
    const dx = (px - 0.5) * W, dy = (py - 0.5) * H;
    const ox = co * dx + si * dy, oy = -si * dx + co * dy;
    if (Math.abs(ox) > W / 2 + 1e-9 || Math.abs(oy) > H / 2 + 1e-9) return false;
  }
  return true;
}

/** 枠を 0..1 に収め、回転後の画像からはみ出す場合は枠の中心を保って縮める（中心が外なら画像中心へ寄せる） */
export function constrainCrop(c: Crop, w: number, h: number): Crop {
  const cw = Math.min(1, Math.max(1e-4, c.w)), ch = Math.min(1, Math.max(1e-4, c.h));
  let cx = Math.min(1 - cw / 2, Math.max(cw / 2, c.x + c.w / 2)), cy = Math.min(1 - ch / 2, Math.max(ch / 2, c.y + c.h / 2));
  const at = (s: number) => ({ x: cx - (cw * s) / 2, y: cy - (ch * s) / 2, w: cw * s, h: ch * s });
  if (!cornersInside(at(1e-6), c.angle, w, h)) { cx = 0.5; cy = 0.5; }
  let lo = 0, hi = 1;
  if (!cornersInside(at(1), c.angle, w, h)) {
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (cornersInside(at(m), c.angle, w, h)) lo = m; else hi = m; }
    hi = lo;
  }
  return { ...c, ...at(hi) };
}

/** 切り抜き後の画素数（元データの寸法で） */
export function croppedSize(fullW: number, fullH: number, o: Orientation, crop: Crop): { w: number; h: number } {
  const s = orientedSize(fullW, fullH, o);
  return { w: Math.max(1, Math.round(s.w * crop.w)), h: Math.max(1, Math.round(s.h * crop.h)) };
}

const mul = (a: M3, b: M3): M3 => {
  const r = new Array(9).fill(0) as M3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] = r[i * 3 + j]! + a[i * 3 + k]! * b[k * 3 + j]!;
  return r;
};
const translate = (x: number, y: number): M3 => [1, 0, x, 0, 1, y, 0, 0, 1];
const scale = (x: number, y: number): M3 => [x, 0, 0, 0, y, 0, 0, 0, 1];

/** 向き補正後の画素座標 → 保存画素座標 */
function unorient(o: Orientation, OW: number, OH: number): M3 {
  switch (o) {
    case 6: return [0, 1, 0, -1, 0, OW, 0, 0, 1];     // sx = oy, sy = OW − ox
    case 8: return [0, -1, OH, 1, 0, 0, 0, 0, 1];     // sx = OH − oy, sy = ox
    case 3: return [-1, 0, OW, 0, -1, OH, 0, 0, 1];   // sx = OW − ox, sy = OH − oy
    default: return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }
}

/**
 * 切り抜き後の画像（原寸、フレーム座標の画素。幅 crop.w·OW × 高さ crop.h·OH、端数を丸めない）→ 入力 UV の行列（行優先 9 要素）。
 * 書き出しのタイル計画（export/tiles.ts）とプレビューの両方がこれを使う。
 */
export function frameMatrix(src: { w: number; h: number; o: Orientation }, crop: Crop): number[] {
  const { w: OW, h: OH } = orientedSize(src.w, src.h, src.o);
  const t = (crop.angle * Math.PI) / 180, co = Math.cos(t), si = Math.sin(t);
  const rotInv: M3 = [co, si, 0, -si, co, 0, 0, 0, 1];          // Rot(−angle)
  let m = translate(crop.x * OW, crop.y * OH);                    // → 回転フレーム上の向き補正後 px
  m = mul(translate(-OW / 2, -OH / 2), m);
  m = mul(rotInv, m);
  m = mul(translate(OW / 2, OH / 2), m);                          // → 向き補正後 px
  m = mul(unorient(src.o, OW, OH), m);                            // → 保存画素 px
  return mul(scale(1 / src.w, 1 / src.h), m);                     // → UV
}

/** 3x3 行列（行優先 9 要素）の積 a·b */
export function matMul(a: readonly number[], b: readonly number[]): number[] { return mul(a as M3, b as M3); }
export const matTranslate = (x: number, y: number): number[] => translate(x, y);
export const matScale = (x: number, y: number): number[] => scale(x, y);

/**
 * 出力画素（中心の絶対座標）→ 入力 UV の変換。
 * src: 保存画素の寸法と向き。out: 出力の寸法。切り抜き後の画像を out に「収まるように」縮小・中央寄せする。
 * view: zoom（1 = 収まる大きさ）と、表示中心（切り抜き後の画像上の正規化座標）。
 */
export function sampleTransform(src: { w: number; h: number; o: Orientation }, crop: Crop,
  out: { w: number; h: number }, view?: { zoom: number; cx: number; cy: number }): SampleTransform {
  const { w: OW, h: OH } = orientedSize(src.w, src.h, src.o);
  const CW = crop.w * OW, CH = crop.h * OH;
  const k = Math.min(out.w / CW, out.h / CH) * (view?.zoom ?? 1);
  const cx = (view?.cx ?? 0.5) * CW, cy = (view?.cy ?? 0.5) * CH;
  let m = translate(-out.w / 2, -out.h / 2);                       // 出力中心を原点へ
  m = mul(scale(1 / k, 1 / k), m);                                 // 出力 px → 切り抜き後の px
  m = mul(translate(cx, cy), m);                                   // → フレーム px
  return { m: new Float32Array(mul(frameMatrix(src, crop) as M3, m)) };
}
