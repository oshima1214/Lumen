import { describe, test, expect } from 'vitest';
import { IMAGE_EXTS, isImageName, sidecarName, uniqueName } from '../../src/storage/names';

describe('IMAGE_EXTS', () => {
  test('対応拡張子', () => {
    expect([...IMAGE_EXTS].sort()).toEqual(
      ['jpg', 'jpeg', 'png', 'heic', 'heif', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'dng', 'raf', 'orf', 'rw2', 'pef', 'srw'].sort(),
    );
  });
});

describe('isImageName', () => {
  test.each([
    ['IMG_0001.CR2', true],
    ['IMG_0001.JPG', true],
    ['img.jpeg', true],
    ['写真 1.HEIC', true],
    ['a.nef', true],
    ['x.Dng', true],
    ['IMG_0001.CR2.json', false],
    ['IMG_0001.CR2.json.bak', false],
    ['._IMG_0001.CR2', false],
    ['.hidden.jpg', false],
    ['notes.txt', false],
    ['jpg', false],
    ['noext', false],
    ['a.jpg.tmp', false],
  ])('%s → %s', (name, ok) => expect(isImageName(name)).toBe(ok));
});

test('sidecarName は元ファイル名 + .json', () => {
  expect(sidecarName('IMG_0001.CR2')).toBe('IMG_0001.CR2.json');
  expect(sidecarName('写真 1.HEIC')).toBe('写真 1.HEIC.json');
});

describe('uniqueName', () => {
  const taken = (...names: string[]) => (n: string) => names.includes(n);
  test('空いていればそのまま', () => expect(uniqueName('a.jpg', taken())).toBe('a.jpg'));
  test('2 回目は -2', () => expect(uniqueName('a.jpg', taken('a.jpg'))).toBe('a-2.jpg'));
  test('-2 も使われていれば -3', () => expect(uniqueName('a.jpg', taken('a.jpg', 'a-2.jpg'))).toBe('a-3.jpg'));
  test('拡張子なし', () => expect(uniqueName('README', taken('README'))).toBe('README-2'));
  test('最後の拡張子の前に付ける', () => expect(uniqueName('a.b.png', taken('a.b.png'))).toBe('a.b-2.png'));
  test('日本語と空白', () => expect(uniqueName('写真 1.jpg', taken('写真 1.jpg'))).toBe('写真 1-2.jpg'));
});
