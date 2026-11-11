import { test, expect } from 'vitest';
import { formatName } from '../../src/export/naming';

test('{name}_{seq}: 元の拡張子を除き seq は 3 桁ゼロ埋め', () =>
  expect(formatName('{name}_{seq}', { name: 'IMG_0001.CR2', seq: 3 }, 'jpg')).toBe('IMG_0001_003.jpg'));
test('{date} は YYYYMMDD', () =>
  expect(formatName('{date}-{name}', { name: 'a.jpg', seq: 1, date: '2024-05-06T07:08:09.000Z' }, 'png')).toBe('20240506-a.png'));
test('date が無ければ {date} は空', () => expect(formatName('{date}{name}', { name: 'a.jpg', seq: 1 }, 'jpg')).toBe('a.jpg'));
test('未知のトークンはそのまま', () => expect(formatName('{foo}{name}', { name: 'a', seq: 1 }, 'jpg')).toBe('{foo}a.jpg'));
test('ファイル名に使えない文字は _ に置き換える', () => expect(formatName('{name}/x', { name: 'a:b', seq: 1 }, 'jpg')).toBe('a_b_x.jpg'));
