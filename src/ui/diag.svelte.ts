// 診断ログ（設定メニューに表示）。実機でしか起きない問題の切り分け用に、取り込みなどの段階を時刻つきで残す。
// 個人情報は含めない（ファイル名・形式・サイズ・件数・エラー文だけ）。
const MAX = 60;
export const diagLog = $state<string[]>([]);

export function logDiag(msg: string): void {
  const d = new Date();
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  diagLog.push(`${t} ${msg}`);
  if (diagLog.length > MAX) diagLog.splice(0, diagLog.length - MAX);
}
