// ベンチマーク（npm run bench）。目標: プレビュー描画 16ms 以内、24MP の読み込み〜初回描画 3 秒以内（仕様 3.4）。
// SwiftShader（ソフトウェア GPU）の数値は参考値。目標超えは警告として出力し、テストは落とさない。
import { test } from '@playwright/test';
import { useHarness } from './helpers/harness';
import type { RendererHarness } from './harness/renderer-harness';

test.skip(!process.env.BENCH, 'npm run bench のときだけ実行');
const h = useHarness('tests/e2e/harness/renderer-harness.ts', 'renderer-harness-ready');
test.describe.configure({ timeout: 600_000 });

test('プレビュー描画と 24MP の初回描画', async ({ page }) => {
  await h.open(page);
  const r = await page.evaluate(async () => {
    const { make, image, view, defaultParams } = (window as unknown as { __r: RendererHarness }).__r;
    const { r } = await make({ previewCap: 2560 });
    const img = image(6000, 4000, 1, (x, y) => [x / 6000, y / 4000, 0.3]);
    const t0 = performance.now();
    await r.setImage(img);
    await r.renderNow(defaultParams(), view(2560, 1600));
    const first = performance.now() - t0;
    const p = defaultParams(); p.basic.highlights = -30; p.basic.shadows = 20; p.hsl.blue.s = -20;
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      p.basic.exposure = i * 0.05;
      const s = performance.now(); await r.renderNow(p, view(2560, 1600)); times.push(performance.now() - s);
    }
    times.sort((a, b) => a - b);
    return { first, median: times[5]! };
  });
  const warn = (ok: boolean, msg: string) => console.log(`${ok ? 'OK  ' : 'WARN'} ${msg}`);
  warn(r.median <= 16, `プレビュー描画の中央値 ${r.median.toFixed(1)} ms（目標 16 ms）`);
  warn(r.first <= 3000, `24MP の setImage〜初回描画 ${r.first.toFixed(0)} ms（目標 3000 ms。デコード時間は含まない）`);
});
