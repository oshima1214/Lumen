import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import exifr from 'exifr';
import { withMetadata } from '../../src/export/metadata';

const jpeg = new Uint8Array(readFileSync('tests/fixtures/gray128.jpg'));
const png = new Uint8Array(readFileSync('tests/fixtures/gradient.png'));
const exif = { date: '2024-05-06T07:08:09.000Z', make: 'Canon', model: 'Canon EOS 20D', lens: 'EF50mm f/1.8', iso: 400,
  exposureTime: 0.01, fNumber: 2.8, focalLength: 50, gps: { lat: 35.5, lon: 139.25 } };

test('JPEG: 機種・撮影日時・GPS・ICC（sRGB）', async () => {
  const out = await withMetadata(jpeg, 'jpeg', exif, 'srgb', false);
  const t = await exifr.parse(out, { icc: true, gps: true, reviveValues: false });
  expect(t.Model).toBe('Canon EOS 20D');
  expect(t.DateTimeOriginal).toBe('2024:05:06 07:08:09');
  expect(t.ISO).toBe(400);
  expect(t.latitude).toBeCloseTo(35.5, 3);
  expect(String(t.ProfileDescription)).toMatch(/sRGB/);
});

test('JPEG: stripGps で GPS を除き、P3 の ICC を付ける', async () => {
  const out = await withMetadata(jpeg, 'jpeg', exif, 'p3', true);
  const t = await exifr.parse(out, { icc: true, gps: true });
  expect(t.latitude).toBeUndefined();
  expect(String(t.ProfileDescription)).toMatch(/P3/);
});

test('PNG: iCCP と eXIf チャンクを付け、PNG として読める', async () => {
  const out = await withMetadata(png, 'png', exif, 'srgb', false);
  const t = await exifr.parse(out, { icc: true, tiff: true });
  expect(t.Model).toBe('Canon EOS 20D');
  expect(String(t.ProfileDescription)).toMatch(/sRGB/);
});
