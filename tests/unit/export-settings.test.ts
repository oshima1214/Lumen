// 書き出し設定の記憶（計画 Task 26: 最後に使った値を localStorage に。try/catch で包む）
import { describe, test, expect } from 'vitest';
import { DEFAULT_EXPORT_FORM, loadExportForm, saveExportForm, toExportSettings, type ExportForm } from '../../src/ui/dialogs/export-settings';

function memory(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map, get length() { return map.size; }, clear: () => map.clear(), key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null, setItem: (k, v) => { map.set(k, String(v)); }, removeItem: (k) => { map.delete(k); },
  };
}

const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } } as unknown as Storage;

describe('書き出し設定の保存と復元', () => {
  test('保存した値が次回の初期値になる', () => {
    const s = memory();
    const f: ExportForm = { ...DEFAULT_EXPORT_FORM, format: 'png', quality: 70, longEdge: 2048, space: 'p3', sharpen: 'high',
      nameRule: '{date}_{seq}', stripGps: false, wmKind: 'text', wmText: '© 自分', wmPosition: 'tl', wmSize: 0.1, wmOpacity: 0.3 };
    saveExportForm(f, s);
    expect(loadExportForm(s)).toEqual(f);
  });

  test('保存が無い・壊れている・ストレージが使えないときは既定値（例外を出さない）', () => {
    expect(loadExportForm(memory())).toEqual(DEFAULT_EXPORT_FORM);
    const bad = memory();
    bad.setItem('lumen.export', '{not json');
    expect(loadExportForm(bad)).toEqual(DEFAULT_EXPORT_FORM);
    expect(loadExportForm(throwing)).toEqual(DEFAULT_EXPORT_FORM);
    expect(() => saveExportForm(DEFAULT_EXPORT_FORM, throwing)).not.toThrow();
    expect(loadExportForm(undefined)).toEqual(DEFAULT_EXPORT_FORM);
  });

  test('範囲外・型違いの値は項目ごとに既定値か範囲内に直す', () => {
    const s = memory();
    s.setItem('lumen.export', JSON.stringify({ format: 'gif', quality: 500, longEdge: -3, space: 'p3', sharpen: 'x', nameRule: '',
      stripGps: 'yes', wmKind: 'image', wmText: 5, wmPosition: 'zz', wmSize: 9, wmOpacity: -1 }));
    const f = loadExportForm(s);
    expect(f.format).toBe(DEFAULT_EXPORT_FORM.format);
    expect(f.quality).toBe(100);
    expect(f.longEdge).toBe(DEFAULT_EXPORT_FORM.longEdge);
    expect(f.space).toBe('p3');
    expect(f.sharpen).toBe(DEFAULT_EXPORT_FORM.sharpen);
    expect(f.nameRule).toBe(DEFAULT_EXPORT_FORM.nameRule);
    expect(f.stripGps).toBe(DEFAULT_EXPORT_FORM.stripGps);
    // 画像の透かしは画像そのものを保存しないので、復元時は「なし」に戻す
    expect(f.wmKind).toBe('none');
    expect(f.wmPosition).toBe(DEFAULT_EXPORT_FORM.wmPosition);
    expect(f.wmSize).toBe(0.5);
    expect(f.wmOpacity).toBe(0);
  });

  test('ExportSettings への変換: 透かし・長辺・品質', () => {
    expect(toExportSettings({ ...DEFAULT_EXPORT_FORM, wmKind: 'none' }, null).watermark).toBeNull();
    const t = toExportSettings({ ...DEFAULT_EXPORT_FORM, wmKind: 'text', wmText: 'Lumen', wmPosition: 'c', wmSize: 0.2, wmOpacity: 0.5 }, null);
    expect(t.watermark).toEqual({ kind: 'text', text: 'Lumen', position: 'c', size: 0.2, opacity: 0.5 });
    const img = new Blob(['x']);
    const i = toExportSettings({ ...DEFAULT_EXPORT_FORM, wmKind: 'image' }, img);
    expect(i.watermark && i.watermark.kind === 'image' && i.watermark.image).toBe(img);
    expect(toExportSettings({ ...DEFAULT_EXPORT_FORM, wmKind: 'image' }, null).watermark).toBeNull();
    expect(toExportSettings({ ...DEFAULT_EXPORT_FORM, wmKind: 'text', wmText: '  ' }, null).watermark).toBeNull();
    expect(toExportSettings({ ...DEFAULT_EXPORT_FORM, longEdge: null }, null).longEdge).toBeNull();
  });
});
