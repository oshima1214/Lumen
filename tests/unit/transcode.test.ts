import { test, expect } from 'vitest';
import { looksTranscoded } from '../../src/storage/transcode';

test.each([
  [{ name: 'IMG_0001.HEIC', type: 'image/jpeg' }, true],
  [{ name: 'IMG_0001.JPG', type: 'image/jpeg' }, false],
  [{ name: 'IMG_0001.DNG', type: 'image/jpeg' }, true],
  [{ name: 'IMG_0001.HEIC', type: 'image/heic' }, false],
  [{ name: 'IMG_0001.heif', type: 'image/heif' }, false],
  [{ name: 'IMG_0001.jpeg', type: 'image/jpeg' }, false],
  [{ name: 'a.png', type: 'image/png' }, false],
  [{ name: 'a.png', type: 'image/jpeg' }, true],
  [{ name: 'IMG_0001.JPG', type: 'image/heic' }, true],
  [{ name: 'IMG_0001.DNG', type: 'image/x-adobe-dng' }, false],
  [{ name: 'IMG_0001.DNG', type: 'image/heic' }, true],
  [{ name: 'IMG_0001.CR2', type: 'image/x-canon-cr2' }, false],
  // 種類不明（空・汎用）は判断できないので false
  [{ name: 'IMG_0001.HEIC', type: '' }, false],
  [{ name: 'IMG_0001.NEF', type: 'application/octet-stream' }, false],
  [{ name: 'noext', type: 'image/jpeg' }, false],
])('%o → %s', (file, expected) => expect(looksTranscoded(file)).toBe(expected));
