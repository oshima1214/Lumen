import { describe, expect, it } from 'vitest';
import { shortcutAction, type Action } from '../../src/ui/shortcuts';

type Mods = { ctrl?: boolean; meta?: boolean; shift?: boolean };
const k = (key: string, m: Mods = {}) => shortcutAction({ key, ctrlKey: !!m.ctrl, metaKey: !!m.meta, shiftKey: !!m.shift });

describe('shortcutAction（仕様 5.1 のショートカット表）', () => {
  const table: [string, Mods, Action][] = [
    ['ArrowRight', {}, 'next'],
    ['ArrowLeft', {}, 'prev'],
    ['z', { ctrl: true }, 'undo'],
    ['Z', { ctrl: true, shift: true }, 'redo'],
    ['z', { ctrl: true, shift: true }, 'redo'],
    ['C', { ctrl: true, shift: true }, 'copy'],
    ['V', { ctrl: true, shift: true }, 'paste'],
    ['r', {}, 'crop'],
    ['R', { shift: true }, 'crop'],
    ['E', { ctrl: true, shift: true }, 'export'],
    ['\\', {}, 'beforeAfter'],
    ['0', {}, { rating: 0 }],
    ['1', {}, { rating: 1 }],
    ['2', {}, { rating: 2 }],
    ['3', {}, { rating: 3 }],
    ['4', {}, { rating: 4 }],
    ['5', {}, { rating: 5 }],
  ];
  for (const [key, m, want] of table) {
    it(`${m.ctrl ? 'Ctrl+' : ''}${m.shift ? 'Shift+' : ''}${key} → ${JSON.stringify(want)}`, () => {
      expect(k(key, m)).toEqual(want);
    });
  }

  it('Mac では Cmd を Ctrl と同じに扱う', () => {
    expect(k('z', { meta: true })).toBe('undo');
    expect(k('Z', { meta: true, shift: true })).toBe('redo');
    expect(k('C', { meta: true, shift: true })).toBe('copy');
    expect(k('V', { meta: true, shift: true })).toBe('paste');
    expect(k('E', { meta: true, shift: true })).toBe('export');
  });

  it('JIS 配列の ¥ キーも編集前後の比較', () => {
    expect(k('¥')).toBe('beforeAfter');
  });

  it('ブラウザ標準の操作や表にないキーは null', () => {
    expect(k('c', { ctrl: true })).toBeNull();        // 通常のコピー
    expect(k('v', { ctrl: true })).toBeNull();
    expect(k('r', { ctrl: true })).toBeNull();        // 再読み込み
    expect(k('e', { ctrl: true })).toBeNull();
    expect(k('1', { ctrl: true })).toBeNull();        // タブ切り替え
    expect(k('6')).toBeNull();
    expect(k('a')).toBeNull();
    expect(k('ArrowRight', { ctrl: true })).toBeNull();
    expect(k('ArrowLeft', { shift: true })).toBeNull();
    expect(k('z')).toBeNull();
    expect(k('\\', { ctrl: true })).toBeNull();
  });
});
