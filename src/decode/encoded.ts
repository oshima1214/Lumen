// 8bit のエンコード済み RGBA（sRGB / Display P3）をリニア Rec.2020 の Uint16 RGB に変換する。
import { SRGB_TO_XYZ, P3_TO_XYZ, XYZ_TO_REC2020, mul3, srgbEotf, type Mat3 } from '../color/spaces';

const EOTF_LUT = Float32Array.from({ length: 256 }, (_, i) => srgbEotf(i / 255));
const TO_2020: Record<'srgb' | 'p3', Mat3> = {
  srgb: mul3(XYZ_TO_REC2020, SRGB_TO_XYZ),
  p3: mul3(XYZ_TO_REC2020, P3_TO_XYZ),
};

export function rgba8ToLinear2020(rgba: Uint8ClampedArray | Uint8Array, space: 'srgb' | 'p3'): Uint16Array {
  const m = TO_2020[space];
  const n = rgba.length / 4;
  const out = new Uint16Array(n * 3);
  const [a, b, c, d, e, f, g, h, k] = m as [number, number, number, number, number, number, number, number, number];
  for (let i = 0; i < n; i++) {
    const r = EOTF_LUT[rgba[i * 4]!]!, gr = EOTF_LUT[rgba[i * 4 + 1]!]!, bl = EOTF_LUT[rgba[i * 4 + 2]!]!;
    const o = i * 3;
    out[o] = Math.round(Math.min(1, Math.max(0, a * r + b * gr + c * bl)) * 65535);
    out[o + 1] = Math.round(Math.min(1, Math.max(0, d * r + e * gr + f * bl)) * 65535);
    out[o + 2] = Math.round(Math.min(1, Math.max(0, g * r + h * gr + k * bl)) * 65535);
  }
  return out;
}
