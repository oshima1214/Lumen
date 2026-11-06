// 公開サンプルを .samples/<key>.<ext> に取得し sha256 を検証する（npm run samples）
// sha256 が空のエントリは取得後にハッシュを表示する（samples.json に記入する）
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

interface Entry { url: string; ext: string; license: string; sha256: string }
const manifest = JSON.parse(readFileSync(new URL('./samples.json', import.meta.url), 'utf8')) as Record<string, Entry | string>;
mkdirSync('.samples', { recursive: true });
let failed = 0;
for (const [key, e] of Object.entries(manifest)) {
  if (typeof e === 'string') continue;
  const path = `.samples/${key}.${e.ext}`;
  let buf: Buffer;
  if (existsSync(path)) buf = readFileSync(path);
  else {
    const res = await fetch(e.url);
    if (!res.ok) { console.error(`✗ ${key}: HTTP ${res.status}`); failed++; continue; }
    buf = Buffer.from(await res.arrayBuffer());
  }
  const hash = createHash('sha256').update(buf).digest('hex');
  if (e.sha256 && e.sha256 !== hash) { console.error(`✗ ${key}: sha256 mismatch ${hash}`); failed++; continue; }
  writeFileSync(path, buf);
  console.log(`✓ ${key} ${buf.length} bytes ${e.sha256 ? '' : `sha256=${hash}`}`);
}
process.exit(failed ? 1 : 0);
