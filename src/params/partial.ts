// 深い差分と深いマージ（仕様 4.1 / 4.3）。配列は値として扱い、要素ごとにはマージしない。
import { clampParams } from './defaults';
import type { DeepPartial, DevelopParams, ParamGroup } from './types';

export type { DeepPartial } from './types';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

/** base と異なる項目だけを返す。配列は丸ごと比較し、違えば配列全体を（複製して）返す */
export function deepDiff<T>(base: T, value: T): DeepPartial<T> {
  const out: Record<string, unknown> = {};
  if (!isPlainObject(base) || !isPlainObject(value)) return out as DeepPartial<T>;
  for (const k of Object.keys(value)) {
    const b = base[k];
    const v = value[k];
    if (isPlainObject(b) && isPlainObject(v)) {
      const d = deepDiff(b, v) as Record<string, unknown>;
      if (Object.keys(d).length > 0) out[k] = d;
    } else if (!deepEqual(b, v)) {
      out[k] = clone(v);
    }
  }
  return out as DeepPartial<T>;
}

/**
 * base に partial を重ねた新しいオブジェクトを返す（どちらも変更しない）。
 * 実行時は base の形を正とし、外部 JSON にも使えるよう寛容に扱う:
 * - base に無いキーは無視する
 * - 値の型が base と違う（数値の所に文字列、オブジェクトの所に配列など）場合は無視する
 * - 配列は丸ごと置換する（要素の検証は clampParams 側）
 */
export function deepMerge<T>(base: T, partial: DeepPartial<T>): T {
  return mergeUnknown(base, partial) as T;
}

function mergeUnknown(base: unknown, partial: unknown): unknown {
  if (isPlainObject(base)) {
    const out: Record<string, unknown> = {};
    const p = isPlainObject(partial) ? partial : {};
    for (const k of Object.keys(base)) out[k] = k in p ? mergeUnknown(base[k], p[k]) : clone(base[k]);
    return out;
  }
  if (Array.isArray(base)) return Array.isArray(partial) ? clone(partial) : clone(base);
  if (partial === undefined || typeof partial !== typeof base) return base;
  return partial;
}

/**
 * partial のうち base と同じ形の項目だけを残す（未知のキーと型違いを落とす）。
 * deepDiff と違い、base と等しい値も残す（プリセットが明示的に 0 に戻す項目を失わないため）。
 */
export function pruneToShape<T>(base: T, partial: unknown): DeepPartial<T> {
  return (pruneUnknown(base, partial) ?? {}) as DeepPartial<T>;
}

function pruneUnknown(base: unknown, partial: unknown): unknown {
  if (isPlainObject(base)) {
    if (!isPlainObject(partial)) return undefined;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(partial)) {
      if (!(k in base)) continue;
      const v = pruneUnknown(base[k], partial[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (Array.isArray(base)) return Array.isArray(partial) ? clone(partial) : undefined;
  return typeof partial === typeof base ? partial : undefined;
}

// ---- DevelopParams 向け（仕様 4.3 / 4.4） ----

/** 含まれる項目だけを上書きし、範囲に丸める */
export function applyPartial(base: DevelopParams, partial: DeepPartial<DevelopParams>): DevelopParams {
  return clampParams(deepMerge<DevelopParams>(base, partial));
}

/** 指定グループの値を丸ごと（既定値と等しい項目も含めて）取り出す。貼り付け先を元と同じ値にするため */
export function pickGroups(p: DevelopParams, groups: ParamGroup[]): DeepPartial<DevelopParams> {
  const out: Record<string, unknown> = {};
  for (const g of groups) out[g] = clone(p[g]);
  return out as DeepPartial<DevelopParams>;
}

/** 「設定をコピー」の既定（WB と切り抜きは既定でオフ） */
export const DEFAULT_COPY_GROUPS: ParamGroup[] = ['basic', 'curve', 'hsl', 'grading'];
