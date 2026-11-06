import { describe, it, expect } from 'vitest';
import { History } from '../../src/store/history';

describe('History', () => {
  it('3 回 set → undo 3 回で初期値', () => {
    const h = new History(0);
    h.set(1); h.set(2); h.set(3);
    expect(h.current).toBe(3);
    expect(h.undo()).toBe(2);
    expect(h.undo()).toBe(1);
    expect(h.undo()).toBe(0);
    expect(h.current).toBe(0);
    expect(h.canUndo).toBe(false);
    expect(h.undo()).toBeNull();
  });

  it('redo で戻せる', () => {
    const h = new History('a');
    h.set('b'); h.set('c');
    h.undo(); h.undo();
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toBe('b');
    expect(h.redo()).toBe('c');
    expect(h.redo()).toBeNull();
    expect(h.canRedo).toBe(false);
  });

  it('上限 100 件（古いものから捨てる）', () => {
    const h = new History(0);
    for (let i = 1; i <= 150; i++) h.set(i);
    let n = 0;
    while (h.undo() !== null) n++;
    expect(n).toBe(100);
    expect(h.current).toBe(50);
  });

  it('cap を指定できる', () => {
    const h = new History(0, 3);
    for (let i = 1; i <= 10; i++) h.set(i);
    let n = 0;
    while (h.undo() !== null) n++;
    expect(n).toBe(3);
  });

  it('ジェスチャー中の 50 回の set が 1 件', () => {
    const h = new History(0);
    h.set(1);
    h.beginGesture();
    for (let i = 2; i <= 51; i++) h.set(i);
    expect(h.current).toBe(51);
    h.endGesture();
    expect(h.undo()).toBe(1);
    expect(h.undo()).toBe(0);
    expect(h.canUndo).toBe(false);
  });

  it('変化のないジェスチャーは積まない', () => {
    const h = new History(0);
    h.beginGesture(); h.endGesture();
    expect(h.canUndo).toBe(false);
  });

  it('ジェスチャー中の undo はジェスチャーを確定してから戻す', () => {
    const h = new History(0);
    h.beginGesture(); h.set(5); h.set(6);
    expect(h.undo()).toBe(0);
    expect(h.redo()).toBe(6);
  });

  it('undo 後に set すると redo が消える', () => {
    const h = new History(0);
    h.set(1); h.set(2);
    h.undo();
    h.set(9);
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBeNull();
    expect(h.undo()).toBe(1);
  });
});
