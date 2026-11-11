// プリセット（仕様 4.3）。純粋関数のみ。
// ファイル形式: { app: 'lumen', type: 'preset', schema: 1, name, params }。
// 読み込みは寛容: app / type / schema は省略可（あれば app は 'lumen' であること）。
// builtin はファイルに書かず、読み込み時は常に false。params は DevelopParams の形に合わない項目を落とす。
import { defaultParams } from './defaults';
import { pruneToShape } from './partial';
import type { DevelopParams, Preset } from './types';

export type { Preset } from './types';

export const PRESET_SCHEMA = 1;

export const BUILTIN_PRESETS: Preset[] = [
  {
    name: 'モノクロ', builtin: true,
    params: { basic: { saturation: -100, vibrance: 0, contrast: 15 } },
  },
  {
    name: '高コントラスト', builtin: true,
    params: { basic: { contrast: 50, whites: 15, blacks: -15, vibrance: 10 } },
  },
  {
    name: 'フィルム調', builtin: true,
    params: {
      basic: { contrast: -10, saturation: -10 },
      curve: { rgb: [[0, 0.06], [0.25, 0.24], [0.75, 0.78], [1, 0.96]] },
      grading: { shadows: { hue: 200, sat: 15, lum: 0 }, highlights: { hue: 45, sat: 12, lum: 0 } },
    },
  },
  {
    name: 'ソフト', builtin: true,
    params: { basic: { contrast: -25, highlights: -20, shadows: 20, saturation: -5 } },
  },
];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** JSON 文字列または解析済みオブジェクトからプリセットを読む。不正なら Error */
export function parsePreset(json: unknown): Preset {
  let j = json;
  if (typeof j === 'string') {
    try {
      j = JSON.parse(j);
    } catch {
      throw new Error('プリセットが JSON ではありません');
    }
  }
  if (!isObj(j)) throw new Error('プリセットが JSON オブジェクトではありません');
  if (j.app !== undefined && j.app !== 'lumen') throw new Error('Lumen のプリセットではありません');
  if (typeof j.name !== 'string' || j.name.trim() === '') throw new Error('プリセットの名前がありません');
  if (!isObj(j.params)) throw new Error('プリセットの params が不正です');
  return { name: j.name, builtin: false, params: pruneToShape<DevelopParams>(defaultParams(), j.params) };
}

export function serializePreset(p: Preset): string {
  return JSON.stringify({ app: 'lumen', type: 'preset', schema: PRESET_SCHEMA, name: p.name, params: p.params }, null, 2);
}
