// サイドカー JSON の読み書き（仕様 4.1 / 4.2）。純粋関数のみ。
// - toSidecar: 既定値と等しい項目は書かない（deepDiff）
// - fromSidecar: 検証 → 移行（migrations）→ 既定値へマージ → 範囲に丸める
//   schema が SIDECAR_SCHEMA より新しい場合は移行せずに読めた範囲で読み、readOnly=true
import { clampParams, defaultParams } from './defaults';
import { deepDiff, deepMerge } from './partial';
import type { DeepPartial, DevelopParams, SourceInfo } from './types';

export type { SourceInfo } from './types';

export const SIDECAR_SCHEMA = 1;

export interface SidecarJson { app: 'lumen'; schema: number; source: SourceInfo; params: unknown; rating: number }

export interface LoadedSidecar { params: DevelopParams; rating: number; source: SourceInfo | null; readOnly: boolean }

export class SidecarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SidecarError';
  }
}

type Json = Record<string, unknown>;

/** migrations[n] は schema n の JSON を schema n+1 に変換する。現在は空 */
export const migrations: Record<number, (j: Json) => Json> = {};

export function toSidecar(p: DevelopParams, source: SourceInfo, rating: number): SidecarJson {
  return {
    app: 'lumen',
    schema: SIDECAR_SCHEMA,
    source: { name: source.name, size: source.size, mtime: source.mtime },
    params: deepDiff(defaultParams(), p),
    rating,
  };
}

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readSource(v: unknown): SourceInfo | null {
  if (!isObj(v)) return null;
  const { name, size, mtime } = v;
  if (typeof name !== 'string' || typeof size !== 'number' || typeof mtime !== 'number') return null;
  return { name, size, mtime };
}

function readRating(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return Math.min(5, Math.max(0, Math.round(v)));
}

export function fromSidecar(json: unknown): LoadedSidecar {
  if (!isObj(json)) throw new SidecarError('サイドカーが JSON オブジェクトではありません');
  if (json.app !== 'lumen') throw new SidecarError('サイドカーの app が lumen ではありません');
  let schema = json.schema;
  if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1) {
    throw new SidecarError('サイドカーの schema が不正です');
  }
  let j: Json = json;
  const readOnly = schema > SIDECAR_SCHEMA;
  while (schema < SIDECAR_SCHEMA) {
    const m = migrations[schema];
    if (!m) throw new SidecarError(`schema ${schema} からの移行がありません`);
    j = m(j);
    schema += 1;
  }
  const raw = j.params ?? {};
  if (!isObj(raw)) throw new SidecarError('サイドカーの params が不正です');
  const params = clampParams(deepMerge<DevelopParams>(defaultParams(), raw as DeepPartial<DevelopParams>));
  return { params, rating: readRating(j.rating), source: readSource(j.source), readOnly };
}

/** 保存時の元ファイル情報と実ファイルでサイズか更新日時が違えば true（保存情報が無ければ false） */
export function sourceChanged(saved: SourceInfo | null, actual: SourceInfo): boolean {
  if (!saved) return false;
  return saved.size !== actual.size || saved.mtime !== actual.mtime;
}
