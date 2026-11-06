// キーボードショートカット（仕様 5.1）。Mac では Cmd（meta）を Ctrl と同じに扱う。
// ブラウザ標準の操作（Ctrl+C / V / R、Ctrl+数字など）は奪わない。

export type Action =
  | 'next' | 'prev' | 'undo' | 'redo' | 'copy' | 'paste' | 'crop' | 'export' | 'beforeAfter'
  | { rating: number };

export interface KeyLike { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }

export function shortcutAction(e: KeyLike): Action | null {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mod) {
    if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
    if (!e.shiftKey) return null;
    if (key === 'c') return 'copy';
    if (key === 'v') return 'paste';
    if (key === 'e') return 'export';
    return null;
  }
  if (key === 'ArrowRight' && !e.shiftKey) return 'next';
  if (key === 'ArrowLeft' && !e.shiftKey) return 'prev';
  // JIS 配列（Mac）では \ のキーが ¥ を返すことがある
  if (key === '\\' || key === '¥') return 'beforeAfter';
  if (key === 'r') return 'crop';
  if (/^[0-5]$/.test(key) && !e.shiftKey) return { rating: Number(key) };
  return null;
}

/** 入力欄にフォーカスがあるときはショートカットを使わない */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset'].includes(target.type);
  }
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
