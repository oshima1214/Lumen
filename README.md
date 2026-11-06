# Lumen

ブラウザだけで動く写真現像アプリ（個人用）。PC の Chrome / Edge と iPhone の Safari（iOS 26 以降）で動く。仕様: `docs/superpowers/specs/2026-11-06-core-develop-engine-design.md`

## 開発

- `npm run dev` / `npm run build` / `npm run preview`
- `npm test` … Vitest（単体テスト）
- `npm run e2e -- --trace off` … Playwright（Chromium + WebGPU）

### テスト環境の WebGPU
ヘッドレス Chromium では次の起動引数で SwiftShader の WebGPU アダプタが取得できる（`playwright.config.ts`）:
`--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=swiftshader --use-webgpu-adapter=swiftshader --use-vulkan=swiftshader --enable-unsafe-swiftshader`（最後の 2 つが無いと WebGPU canvas の getCurrentTexture でデバイスが失われる）

- `npm run samples` … テスト用の公開 RAW サンプル（raw.pixls.us、CC0）を `.samples/` に取得
- `npm run fixtures` … 合成フィクスチャを再生成（Pillow、HEIC は pillow-heif があれば）
- `npm run bench` … ベンチマーク（SwiftShader の数値は参考値）

### 実機の写真でテストする
`test-assets/` に置くと、該当テストが自動で有効になる（コミットされない）。
- `test-assets/iphone.heic` … iPhone の HEIC

## 無料で公開する（Cloudflare Pages）
1. https://dash.cloudflare.com/ で無料アカウントを作る
2. Workers & Pages → Create → Pages → 「Connect to Git」で GitHub の `oshima1214/Lumen` を選ぶ
3. ビルド設定: Build command `npm run build`、Build output directory `dist`、本番ブランチは公開したいブランチ
4. デプロイ後、`https://<名前>.pages.dev/` を開く。開発者ツールのネットワークで、ページの応答に
   `Cross-Origin-Opener-Policy: same-origin` と `Cross-Origin-Embedder-Policy: require-corp` が付いていることを確認する
   （`public/_headers` が反映される）
5. iPhone では Safari で開き、共有 → ホーム画面に追加 で PWA として使う（データ保持のため推奨）

注意: E2E テストを実行すると `dist/__e2e/` にテスト用ファイルができる。手元の `dist/` を手動でアップロードする場合は、
先に `npm run build` を実行してから（`dist/` が作り直される）アップロードする。

## iPhone 実機の確認
`docs/iphone-checklist.md` の手順で確認する。
