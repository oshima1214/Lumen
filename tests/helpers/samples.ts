// 公開サンプル（.samples/）と実機写真（test-assets/）のパス解決。無ければ null を返し、テスト側で skip する。
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import manifest from '../../scripts/samples.json' with { type: 'json' };

type Entry = { ext: string };
export function samplePath(key: string): string | null {
  const e = (manifest as Record<string, Entry | string>)[key];
  if (!e || typeof e === 'string') return null;
  const p = resolve(`.samples/${key}.${e.ext}`);
  return existsSync(p) ? p : null;
}

/** test-assets/ に置いた実機写真（例: test-assets/eos20d.cr2） */
export function assetPath(name: string): string | null {
  const p = resolve(`test-assets/${name}`);
  return existsSync(p) ? p : null;
}
