import { test, expect } from 'vitest';
import { sniffFormat } from '../../src/decode/sniff';

const b = (...xs: number[]) => new Uint8Array([...xs, ...new Array(16).fill(0)]);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

test('JPEG', () => expect(sniffFormat(b(0xff, 0xd8, 0xff, 0xe0), 'a.jpg')).toBe('jpeg'));
test('PNG', () => expect(sniffFormat(b(0x89, 0x50, 0x4e, 0x47), 'a.png')).toBe('png'));
for (const brand of ['heic', 'heix', 'mif1']) {
  test(`HEIC ftyp ${brand}`, () => expect(sniffFormat(b(0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii(brand)), 'a.HEIC')).toBe('heic'));
}
for (const name of ['IMG.CR2', 'DSC.NEF', 'IMG.DNG']) {
  test(`TIFF 系 RAW ${name}`, () => expect(sniffFormat(b(0x49, 0x49, 0x2a, 0x00), name)).toBe('raw'));
}
test('ビッグエンディアン TIFF の NEF', () => expect(sniffFormat(b(0x4d, 0x4d, 0x00, 0x2a), 'a.nef')).toBe('raw'));
test('AppleDouble（._IMG.CR2）は unknown', () => expect(sniffFormat(b(0x00, 0x05, 0x16, 0x07), '._IMG.CR2')).toBe('unknown'));
test('TIFF ヘッダでも RAW 拡張子でなければ unknown', () => expect(sniffFormat(b(0x49, 0x49, 0x2a, 0x00), 'a.tif')).toBe('unknown'));
test('乱数は unknown', () => expect(sniffFormat(b(1, 2, 3, 4), 'a.jpg')).toBe('unknown'));
