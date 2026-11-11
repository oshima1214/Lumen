// 書き出しファイル名（仕様 6）: {name}（元の拡張子を除く）, {seq}（3 桁）, {date}（撮影日 YYYYMMDD、無ければ空）。
const pad = (n: number, w: number) => String(n).padStart(w, '0');

export function formatName(rule: string, v: { name: string; seq: number; date?: string }, ext: string): string {
  const dot = v.name.lastIndexOf('.');
  const base = dot > 0 ? v.name.slice(0, dot) : v.name;
  let date = '';
  if (v.date) {
    const d = new Date(v.date);
    if (!Number.isNaN(d.getTime())) date = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1, 2)}${pad(d.getUTCDate(), 2)}`;
  }
  const s = rule.replace(/\{(name|seq|date)\}/g, (_, k: string) => (k === 'name' ? base : k === 'seq' ? pad(v.seq, 3) : date));
  return `${s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')}.${ext}`;
}
