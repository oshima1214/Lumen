// 書き出しダイアログの入力値（仕様 6）と、その記憶（計画 Task 26: 最後に使った値を localStorage に保存。try/catch で包む）。
// 透かしの画像（Blob）は保存できないので、画像の透かしを選んでいた場合は復元時に「なし」に戻す。
import type { ExportSettings } from '../../export/exporter';
import type { SharpenLevel } from '../../export/sharpen';
import type { WatermarkPosition } from '../../export/watermark';

export const EXPORT_FORM_KEY = 'lumen.export';

export interface ExportForm {
  format: 'jpeg' | 'png';
  quality: number;
  /** null は原寸 */
  longEdge: number | null;
  space: 'srgb' | 'p3';
  sharpen: SharpenLevel;
  nameRule: string;
  stripGps: boolean;
  wmKind: 'none' | 'text' | 'image';
  wmText: string;
  wmPosition: WatermarkPosition;
  /** 長辺比 0.02〜0.5 */
  wmSize: number;
  /** 0〜1 */
  wmOpacity: number;
}

export const WM_POSITIONS: WatermarkPosition[] = ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br'];
export const SHARPEN_LEVELS: SharpenLevel[] = ['none', 'low', 'standard', 'high'];

export const DEFAULT_EXPORT_FORM: ExportForm = {
  format: 'jpeg', quality: 90, longEdge: null, space: 'srgb', sharpen: 'none', nameRule: '{name}', stripGps: true,
  wmKind: 'none', wmText: '', wmPosition: 'br', wmSize: 0.04, wmOpacity: 0.6,
};

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
function oneOf<T extends string>(v: unknown, list: readonly T[], d: T): T {
  return list.includes(v as T) ? (v as T) : d;
}

/** 保存した値を読む。無い・壊れている・ストレージが使えないときは既定値。項目ごとに検証する */
export function loadExportForm(storage: Storage | undefined = defaultStorage()): ExportForm {
  const d = DEFAULT_EXPORT_FORM;
  let j: Record<string, unknown>;
  try {
    const raw = storage?.getItem(EXPORT_FORM_KEY);
    if (!raw) return { ...d };
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ...d };
    j = v as Record<string, unknown>;
  } catch {
    return { ...d };
  }
  return {
    format: oneOf(j.format, ['jpeg', 'png'], d.format),
    quality: num(j.quality) ? Math.round(clamp(j.quality, 1, 100)) : d.quality,
    longEdge: j.longEdge === null ? null : num(j.longEdge) && j.longEdge >= 1 ? Math.round(j.longEdge) : d.longEdge,
    space: oneOf(j.space, ['srgb', 'p3'], d.space),
    sharpen: oneOf(j.sharpen, SHARPEN_LEVELS, d.sharpen),
    nameRule: typeof j.nameRule === 'string' && j.nameRule.trim() !== '' ? j.nameRule : d.nameRule,
    stripGps: typeof j.stripGps === 'boolean' ? j.stripGps : d.stripGps,
    wmKind: j.wmKind === 'text' ? 'text' : 'none',
    wmText: typeof j.wmText === 'string' ? j.wmText : d.wmText,
    wmPosition: oneOf(j.wmPosition, WM_POSITIONS, d.wmPosition),
    wmSize: num(j.wmSize) ? clamp(j.wmSize, 0.02, 0.5) : d.wmSize,
    wmOpacity: num(j.wmOpacity) ? clamp(j.wmOpacity, 0, 1) : d.wmOpacity,
  };
}

export function saveExportForm(f: ExportForm, storage: Storage | undefined = defaultStorage()): void {
  try {
    storage?.setItem(EXPORT_FORM_KEY, JSON.stringify(f));
  } catch {
    // プライベートブラウズ・容量超過などでは記憶しないだけ
  }
}

/** 入力値 → exportImages の設定。透かしは文字が空、または画像が未選択なら付けない */
export function toExportSettings(f: ExportForm, wmImage: Blob | null): ExportSettings {
  const common = { position: f.wmPosition, size: clamp(f.wmSize, 0.02, 0.5), opacity: clamp(f.wmOpacity, 0, 1) };
  const watermark: ExportSettings['watermark'] =
    f.wmKind === 'text' && f.wmText.trim() !== '' ? { kind: 'text', text: f.wmText, ...common }
      : f.wmKind === 'image' && wmImage ? { kind: 'image', image: wmImage, ...common }
        : null;
  return {
    format: f.format, quality: Math.round(clamp(f.quality, 1, 100)), longEdge: f.longEdge, space: f.space,
    sharpen: f.sharpen, nameRule: f.nameRule.trim() === '' ? DEFAULT_EXPORT_FORM.nameRule : f.nameRule,
    watermark, stripGps: f.stripGps,
  };
}
