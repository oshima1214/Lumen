// ホワイトバランスのスライダーの表示値と書き込み（仕様 4.1 / 5.1）。純粋関数。
// - RAW: 絶対値（K と色かぶり ±150）。asShot のときは撮影時の値（camToXyz と asShotNeutral から計算）を表示する。
// - display（JPEG / PNG / HEIC）: ±100 の相対値。asShot は 0。
// - 動かすと custom になる。撮影時の値（display は 0, 0）に戻したら asShot に戻す（既定値なのでサイドカーに書かれない）。
import { asShotCctTint } from '../../color/wb';
import type { Mat3, Vec3 } from '../../color/spaces';
import { RANGES, clampTo } from '../../params/defaults';
import type { DevelopParams } from '../../params/types';

export interface WbImage { kind: 'raw' | 'display'; camToXyz?: Mat3; asShotNeutral?: Vec3 }

type Range = [number, number];

export interface WbView {
  unit: 'K' | '';
  temp: number;
  tint: number;
  tempRange: Range;
  tintRange: Range;
  /** 撮影時の値（ダブルクリックで戻る値） */
  asShot: { temp: number; tint: number };
}

const range = (k: string): Range => RANGES[k] ?? [-100, 100];

export function asShotValues(img: WbImage): { temp: number; tint: number } {
  if (img.kind === 'display') return { temp: 0, tint: 0 };
  if (!img.camToXyz || !img.asShotNeutral) return { temp: 6500, tint: 0 };
  const { cct, tint } = asShotCctTint(img.camToXyz, img.asShotNeutral);
  return {
    temp: Math.round(clampTo(cct, range('wb.temp'), 6500)),
    tint: Math.round(clampTo(tint, range('wb.tint'), 0)),
  };
}

export function wbSliders(wb: DevelopParams['wb'], img: WbImage): WbView {
  const raw = img.kind === 'raw';
  const asShot = asShotValues(img);
  const tempRange = range(raw ? 'wb.temp' : 'wb.tempRel'), tintRange = range(raw ? 'wb.tint' : 'wb.tintRel');
  const custom = wb.mode === 'custom' && (!raw || wb.temp > 0);
  return {
    unit: raw ? 'K' : '',
    temp: custom ? clampTo(wb.temp, tempRange, asShot.temp) : asShot.temp,
    tint: custom ? clampTo(wb.tint, tintRange, asShot.tint) : asShot.tint,
    tempRange, tintRange, asShot,
  };
}

/** p.wb の片方（temp / tint）を表示値 v に変える（もう一方は表示中の値を保つ） */
export function setWb(p: DevelopParams, img: WbImage, which: 'temp' | 'tint', v: number): void {
  const cur = wbSliders(p.wb, img);
  const next = { temp: cur.temp, tint: cur.tint };
  next[which] = clampTo(v, which === 'temp' ? cur.tempRange : cur.tintRange, cur[which]);
  if (next.temp === cur.asShot.temp && next.tint === cur.asShot.tint) p.wb = { mode: 'asShot', temp: 0, tint: 0 };
  else p.wb = { mode: 'custom', temp: next.temp, tint: next.tint };
}
