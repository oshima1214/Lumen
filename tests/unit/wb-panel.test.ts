import { describe, expect, it } from 'vitest';
import { wbSliders, setWb } from '../../src/ui/panels/wb';
import { defaultParams } from '../../src/params/defaults';
import { asShotCctTint } from '../../src/color/wb';
import { SRGB_TO_XYZ } from '../../src/color/spaces';

// sRGB 原色をカメラ RGB とみなし、やや暖色の光源で撮った想定の中性点
const CAM = SRGB_TO_XYZ;
const NEUTRAL: [number, number, number] = [1, 0.85, 0.6];

describe('WB パネルの表示値（RAW は K、display は ±100）', () => {
  it('RAW の撮影時設定は asShot の K と色かぶりを表示する', () => {
    const v = wbSliders(defaultParams().wb, { kind: 'raw', camToXyz: CAM, asShotNeutral: NEUTRAL });
    const want = asShotCctTint(CAM, NEUTRAL);
    expect(v.unit).toBe('K');
    expect(v.temp).toBe(Math.round(want.cct));
    expect(v.tint).toBe(Math.round(want.tint));
    expect(v.tempRange).toEqual([2000, 50000]);
    expect(v.tintRange).toEqual([-150, 150]);
  });

  it('RAW の custom はその値を表示する', () => {
    const v = wbSliders({ mode: 'custom', temp: 4300, tint: 12 }, { kind: 'raw', camToXyz: CAM, asShotNeutral: NEUTRAL });
    expect(v.temp).toBe(4300);
    expect(v.tint).toBe(12);
  });

  it('display は ±100 の相対値（既定 0）', () => {
    const v = wbSliders(defaultParams().wb, { kind: 'display' });
    expect(v.unit).toBe('');
    expect([v.temp, v.tint]).toEqual([0, 0]);
    expect(v.tempRange).toEqual([-100, 100]);
  });

  it('動かすと custom になり、もう一方は表示中の値を保つ', () => {
    const img = { kind: 'raw' as const, camToXyz: CAM, asShotNeutral: NEUTRAL };
    const p = defaultParams();
    setWb(p, img, 'temp', 6000);
    const shot = asShotCctTint(CAM, NEUTRAL);
    expect(p.wb).toEqual({ mode: 'custom', temp: 6000, tint: Math.round(shot.tint) });
  });

  it('display で両方 0 に戻すと asShot に戻る', () => {
    const p = defaultParams();
    setWb(p, { kind: 'display' }, 'temp', 30);
    expect(p.wb).toEqual({ mode: 'custom', temp: 30, tint: 0 });
    setWb(p, { kind: 'display' }, 'temp', 0);
    expect(p.wb).toEqual({ mode: 'asShot', temp: 0, tint: 0 });
  });

  it('範囲外は丸める', () => {
    const p = defaultParams();
    setWb(p, { kind: 'display' }, 'tint', 300);
    expect(p.wb.tint).toBe(100);
  });
});
