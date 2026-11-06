// EXIF とカラープロファイルの要約（exifr）。失敗しても既定値を返す（デコード自体は続ける）。
import exifr from 'exifr';
import type { ExifSummary, Orientation } from './types';

const ORIENTATIONS: readonly number[] = [1, 3, 6, 8];

export async function readExif(file: Blob): Promise<{ exif: ExifSummary; orientation: Orientation; iccIsP3: boolean }> {
  let t: Record<string, unknown> = {};
  try {
    t = (await exifr.parse(file, { tiff: true, exif: true, gps: true, icc: true, xmp: false, translateValues: false, reviveValues: true })) ?? {};
  } catch {
    t = {};
  }
  const num = (k: string) => (typeof t[k] === 'number' && Number.isFinite(t[k]) ? (t[k] as number) : undefined);
  const s = (k: string) => (typeof t[k] === 'string' ? (t[k] as string).trim() : undefined);
  const dateV = t.DateTimeOriginal ?? t.CreateDate ?? t.ModifyDate;
  const exif: ExifSummary = {
    date: dateV instanceof Date && !Number.isNaN(dateV.getTime()) ? dateV.toISOString() : undefined,
    make: s('Make'), model: s('Model'), lens: s('LensModel'),
    iso: num('ISO') ?? num('ISOSpeedRatings'),
    exposureTime: num('ExposureTime'), fNumber: num('FNumber'), focalLength: num('FocalLength'),
  };
  const lat = num('latitude'), lon = num('longitude');
  if (lat !== undefined && lon !== undefined) exif.gps = { lat, lon };
  for (const k of Object.keys(exif) as (keyof ExifSummary)[]) if (exif[k] === undefined) delete exif[k];
  const o = num('Orientation') ?? 1;
  const desc = `${s('ProfileDescription') ?? ''} ${s('ProfileDescriptionText') ?? ''}`;
  return { exif, orientation: (ORIENTATIONS.includes(o) ? o : 1) as Orientation, iccIsP3: /P3/i.test(desc) };
}
