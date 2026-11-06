# Lumen

ブラウザだけで動く写真現像アプリ（個人用）。仕様: `docs/superpowers/specs/2026-11-06-core-develop-engine-design.md`

## 開発

- `npm run dev` / `npm run build` / `npm run preview`
- `npm test` … Vitest（単体テスト）
- `npm run e2e -- --trace off` … Playwright（Chromium + WebGPU）

### テスト環境の WebGPU
ヘッドレス Chromium では次の起動引数で SwiftShader の WebGPU アダプタが取得できる（`playwright.config.ts`）:
`--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=swiftshader --use-webgpu-adapter=swiftshader --use-vulkan=swiftshader --enable-unsafe-swiftshader`（最後の 2 つが無いと WebGPU canvas の getCurrentTexture でデバイスが失われる）
