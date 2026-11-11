// 現像パラメータの型（仕様 4.1）。実行時コードは置かない（既定値は defaults.ts）。
export type HslBand = 'red' | 'orange' | 'yellow' | 'green' | 'aqua' | 'blue' | 'purple' | 'magenta';
export const HSL_BANDS: readonly HslBand[] = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];

export type ParamGroup = 'wb' | 'basic' | 'curve' | 'hsl' | 'grading' | 'crop';
export type CurvePoint = [number, number];
export type Aspect = 'original' | 'free' | '1:1' | '4:5' | '3:2' | '16:9';

export interface HueSatLum { hue: number; sat: number; lum: number }

export interface DevelopParams {
  wb: { mode: 'asShot' | 'custom'; temp: number; tint: number };
  basic: {
    exposure: number; contrast: number; highlights: number; shadows: number;
    whites: number; blacks: number; vibrance: number; saturation: number;
  };
  curve: {
    parametric: { highlights: number; lights: number; darks: number; shadows: number; splits: [number, number, number] };
    rgb: CurvePoint[]; r: CurvePoint[]; g: CurvePoint[]; b: CurvePoint[];
  };
  hsl: Record<HslBand, { h: number; s: number; l: number }>;
  grading: Record<'shadows' | 'midtones' | 'highlights' | 'global', HueSatLum> & { blending: number; balance: number };
  crop: { x: number; y: number; w: number; h: number; angle: number; aspect: Aspect };
}

/** 配列は丸ごと置換する深い部分型 */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** サイドカーに記録する元ファイル情報（仕様 4.1 / 4.2） */
export interface SourceInfo { name: string; size: number; mtime: number }

/** プリセット（仕様 4.3）。builtin は読み込み時に常に false */
export interface Preset { name: string; builtin: boolean; params: DeepPartial<DevelopParams> }
