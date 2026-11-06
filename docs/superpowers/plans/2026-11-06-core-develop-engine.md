# コア現像エンジン（サブプロジェクト1） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PC の Chrome/Edge と iPhone の Safari で動く、RAW/JPEG/HEIC 対応の非破壊写真現像 Web アプリ「Lumen」のコア（読み込み・現像・プリセット・書き出し）を作る。

**Architecture:** Svelte 5 の UI の下に、純粋関数の `params/` と `color/`（参照実装）、Worker で動く `decode/`、WebGPU の `engine/`、保存方式を抽象化した `storage/`（フォルダ方式 / OPFS ライブラリ方式）、`export/` を置く。色の式は `color/` の TS 実装を正とし、WGSL はそれと数値一致することをテストで保証する。CPU 側で `buildUniforms()` がパラメータを GPU 用の数値と LUT に変換し、GPU は画素ごとの計算だけを行う。

**Tech Stack:** TypeScript (strict), Svelte 5, Vite, WebGPU/WGSL, LibRaw-WASM, libheif-js, exifr, @jsquash/jpeg (MozJPEG), @jsquash/png, piexifjs, idb, lucide-svelte, vite-plugin-pwa, Vitest, Playwright (Chromium + WebKit)

**Spec:** `docs/superpowers/specs/2026-11-06-core-develop-engine-design.md`（各タスクの「仕様 x.y」はこの文書の節番号）

## Global Constraints

- 費用ゼロ: 有料サービス・有料 API・有料ライセンスの依存を追加しない。追加する npm 依存はすべて OSS（MIT / BSD / ISC / Apache-2.0 / LGPL / CDDL / CC0）であることを `package.json` 追加時に確認する。有料が必要と判断したら実装を止めてユーザーに相談する。
- 対象: PC の Chrome / Edge（最新安定版）、iPhone の Safari（iOS 26 以降）。WebGPU 必須。
- 作業色空間はリニア Rec.2020。GPU 上の作業画像は `rgba16float`。
- 作業画像の長辺上限: PC 8192px、iPhone 4096px。プレビュー描画の長辺: PC 2560px、iPhone 2048px。
- 書き出しタイル: 2048px 角、重なり 32px。
- サイドカー: `app: "lumen"`、`schema: 1`。既定値と等しい項目は書かない。自動保存はデバウンス 500ms。
- Undo 履歴は最大 100 件、画像ごと、メモリのみ。
- UI 言語は日本語のみ。ライトモードなし。配色トークンは仕様 5.2 の値をそのまま使う（`--bg #1C1C1C` `--panel #252525` `--line #333333` `--text #E6E6E6` `--text-sub #9A9A9A` `--accent #D9A441` `--danger #E5484D`、18% グレー背景 `#777777`）。
- タップ領域 44px 以上。数値は `tabular-nums`。
- 実機写真（CR2 / NEF / iPhone）は未提供。`test-assets/` は `.gitignore` 対象、ファイルがあれば有効になるテストとして書く。
- コミットメッセージにモデル名を書かない。

## Review Focus

1. **縦向きの iPhone 写真（EXIF orientation 6/8）＋切り抜き・回転**: 切り抜き座標は向き補正後の画像に対する正規化座標であり、プレビュー・書き出し・サイドカー再読込で同じ範囲になること → Task 15 のテスト。
2. **RAW+JPEG の同名ペア（`IMG_0001.CR2` と `IMG_0001.JPG`）、日本語・空白入りファイル名、macOS の `._IMG_0001.CR2`、サイドカー自身**: 別々のサイドカーになり、`._*` と `*.json` は画像として一覧に出ないこと → Task 16 のテスト。
3. **編集中の画像切り替え・保存中の連続編集**: デバウンス保存が切り替え前の画像のサイドカーに正しく書かれ、最後の編集が失われないこと → Task 19 のテスト。
4. **上限を超える大きな画像（48MP ProRAW 8064×6048、9000px 超のパノラマ JPEG）**: 作業画像は上限まで縮小され、書き出しはタイルで原寸まで出ること（`maxTextureDimension2D` で落ちない） → Task 9 と Task 20 のテスト。
5. **フォルダ内に壊れたファイル・非対応形式が混在**: その 1 枚だけがエラー表示になり、一覧・他の画像の編集・一括書き出しは続行すること → Task 11 と Task 21 のテスト。

---

## ファイル構成

```
/                         package.json, vite.config.ts, tsconfig.json, playwright.config.ts,
                          vitest.config.ts, public/_headers, .gitignore, README.md
src/main.ts, src/App.svelte
src/platform/detect.ts
src/params/types.ts, defaults.ts, sidecar.ts, partial.ts, presets.ts
src/color/spaces.ts, wb.ts, oklab.ts, tone.ts, spline.ts, hsl.ts, grading.ts, uniforms.ts, pipeline.ts
src/decode/types.ts, sniff.ts, downscale.ts, exif.ts, display.ts, heic.ts, raw.ts, worker.ts, client.ts
src/engine/gpu.ts, upload.ts, upload.wgsl, develop.wgsl, develop.ts, localtone.wgsl, localtone.ts,
           geometry.ts, renderer.ts, histogram.wgsl
src/storage/types.ts, names.ts, folder.ts, library.ts, transcode.ts
src/cache/thumbs.ts
src/store/history.ts, editor.svelte.ts
src/export/tiles.ts, resample.ts, sharpen.ts, watermark.ts, encode.ts, metadata.ts, naming.ts,
           exporter.ts, worker.ts, icc/*.icc
src/ui/theme.css, Shell.svelte, Unsupported.svelte,
       desktop/{Browser,Filmstrip,Viewer,RightPanel}.svelte,
       panels/{Slider,BasicPanel,WbPanel,HslPanel,GradingPanel,Histogram,CurveEditor,CropTool}.svelte,
       dialogs/{CopySettings,ExportDialog,PresetList}.svelte,
       mobile/{Grid,Editor,ToolTabs,Gestures}.ts|svelte
src/gpu-check/ (iPhone 実機検証用の独立ページ)
tests/unit/**   (Vitest)
tests/e2e/**    (Playwright)
tests/fixtures/ (合成画像生成スクリプトと小さな生成物)
scripts/fetch-samples.ts, samples.json
docs/iphone-checklist.md
```

---

### Task 1: プロジェクト雛形とテスト基盤

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts`, `index.html`, `src/main.ts`, `src/App.svelte`, `public/_headers`, `.gitignore`, `tests/unit/smoke.test.ts`, `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Produces: `npm test`（Vitest）、`npm run e2e`（Playwright）、`npm run build`、`npm run dev`。Playwright プロジェクト名 `chromium-webgpu`（WebGPU 有効）と `webkit-layout`（レイアウト確認用）。

- [ ] **Step 1:** `npm create vite@latest . -- --template svelte-ts` 相当で雛形を作り、`strict: true`、`noUncheckedIndexedAccess: true` を設定。依存: `vitest`, `@playwright/test`（プリインストールの Playwright と同じバージョンに固定し、`playwright install` はしない）。
- [ ] **Step 2:** `public/_headers` に全パスへ `Cross-Origin-Opener-Policy: same-origin` と `Cross-Origin-Embedder-Policy: require-corp` を書き、`vite.config.ts` の dev/preview サーバーにも同じヘッダーを付ける。`.gitignore` に `node_modules`, `dist`, `test-assets/`, `.samples/` を入れる。
- [ ] **Step 3: 失敗するテストを書く**
  ```ts
  // tests/unit/smoke.test.ts
  import { APP_ID } from '../../src/main';
  test('app id', () => expect(APP_ID).toBe('lumen'));
  ```
  ```ts
  // tests/e2e/smoke.spec.ts
  test('page loads and WebGPU adapter exists', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Lumen');
    expect(await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter()))).toBe(true);
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  });
  ```
- [ ] **Step 4:** `npm test` と `npm run e2e -- --project=chromium-webgpu --trace off` を実行し、失敗を確認。
- [ ] **Step 5:** `export const APP_ID = 'lumen'` と `<title>Lumen</title>` を実装。`playwright.config.ts` の `chromium-webgpu` に `webServer: npm run preview`、起動引数 `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=swiftshader --use-webgpu-adapter=swiftshader` を設定（アダプタが取れなければ引数の組み合わせを調整し、取れた組み合わせを README に記録する。GPU テストはこの環境が前提なので、取れないまま先に進まない）。
- [ ] **Step 6:** 両テストが PASS することを確認。
- [ ] **Step 7:** コミット `chore: プロジェクト雛形とテスト基盤`

---

### Task 2: 実行環境の判定（platform）

**Files:**
- Create: `src/platform/detect.ts`
- Test: `tests/unit/platform.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface PlatformEnv { gpu: boolean; showDirectoryPicker: boolean; opfs: boolean; userAgent: string; maxTouchPoints: number }
  interface Platform { webgpu: boolean; backend: 'folder' | 'library' | null; ios: boolean;
                       workCap: number; previewCap: number; unsupportedReason: string | null }
  function readEnv(): PlatformEnv            // 実ブラウザから取得
  function detectPlatform(env: PlatformEnv): Platform
  ```

- [ ] **Step 1: 失敗するテストを書く** — 次の表をテーブル駆動で検証:
  | env | 期待 |
  |---|---|
  | gpu, picker, opfs, Windows Chrome UA | backend `folder`, ios false, workCap 8192, previewCap 2560, reason null |
  | gpu, picker なし, opfs, iPhone Safari UA | backend `library`, ios true, workCap 4096, previewCap 2048 |
  | gpu, picker なし, opfs, Mac Safari UA かつ maxTouchPoints 5（iPad） | ios true, workCap 4096 |
  | gpu なし | backend null, reason に「WebGPU」を含む |
  | gpu, picker なし, opfs なし | backend null, reason に「保存領域」を含む |
- [ ] **Step 2:** `npx vitest run tests/unit/platform.test.ts` で FAIL を確認。
- [ ] **Step 3:** `detectPlatform` を実装（純粋関数）。`readEnv` は `'gpu' in navigator`、`'showDirectoryPicker' in window`、`!!navigator.storage?.getDirectory` を読む。
- [ ] **Step 4:** PASS を確認。
- [ ] **Step 5:** コミット `feat(platform): 実行環境の判定`

---

### Task 3: 現像パラメータの型・既定値・範囲

**Files:**
- Create: `src/params/types.ts`, `src/params/defaults.ts`
- Test: `tests/unit/params-defaults.test.ts`

**Interfaces:**
- Produces（仕様 4.1 の JSON と同じ形）:
  ```ts
  type HslBand = 'red'|'orange'|'yellow'|'green'|'aqua'|'blue'|'purple'|'magenta';
  const HSL_BANDS: readonly HslBand[];
  type ParamGroup = 'wb'|'basic'|'curve'|'hsl'|'grading'|'crop';
  type CurvePoint = [number, number];
  type Aspect = 'original'|'free'|'1:1'|'4:5'|'3:2'|'16:9';
  interface DevelopParams {
    wb: { mode: 'asShot'|'custom'; temp: number; tint: number };
    basic: { exposure; contrast; highlights; shadows; whites; blacks; vibrance; saturation: number };
    curve: { parametric: { highlights; lights; darks; shadows: number; splits: [number,number,number] };
             rgb: CurvePoint[]; r: CurvePoint[]; g: CurvePoint[]; b: CurvePoint[] };
    hsl: Record<HslBand, { h: number; s: number; l: number }>;
    grading: Record<'shadows'|'midtones'|'highlights'|'global', { hue: number; sat: number; lum: number }>
             & { blending: number; balance: number };
    crop: { x: number; y: number; w: number; h: number; angle: number; aspect: Aspect };
  }
  function defaultParams(): DevelopParams           // 毎回新しいオブジェクト
  const RANGES: Record<string, [min: number, max: number]>  // キーは 'basic.exposure' 形式
  function clampParams(p: DevelopParams): DevelopParams
  ```
  範囲: exposure −5..5、contrast/highlights/shadows/whites/blacks/vibrance/saturation −100..100、wb.temp 2000..50000（RAW）、wb.tint −150..150、parametric 各 −100..100、hsl h/s/l −100..100、grading hue 0..360・sat 0..100・lum −100..100、blending 0..100、balance −100..100、crop.angle −45..45、crop x/y/w/h 0..1。
  既定: wb `{mode:'asShot', temp:0, tint:0}`（asShot の temp/tint は表示用に撮影時の値を入れる。値 0 は「未計算」）、basic 全 0、splits `[0.25,0.5,0.75]`、各カーブ `[[0,0],[1,1]]`、hsl 全 0、grading 全 0・blending 50・balance 0、crop `{x:0,y:0,w:1,h:1,angle:0,aspect:'original'}`。

- [ ] **Step 1: 失敗するテストを書く** — `defaultParams()` の 2 回の呼び出しが別オブジェクトであること、`HSL_BANDS.length === 8`、`clampParams` で `basic.exposure: 9 → 5`、`crop.w: 1.5 → 1`、`grading.shadows.hue: 400 → 360`。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3:** 実装。
- [ ] **Step 4:** PASS を確認。
- [ ] **Step 5:** コミット `feat(params): 現像パラメータの型と既定値`

---

### Task 4: サイドカーのシリアライズと移行

**Files:**
- Create: `src/params/sidecar.ts`
- Test: `tests/unit/sidecar.test.ts`

**Interfaces:**
- Consumes: Task 3 の `DevelopParams`, `defaultParams`, `clampParams`
- Produces:
  ```ts
  const SIDECAR_SCHEMA = 1;
  interface SourceInfo { name: string; size: number; mtime: number }
  interface SidecarJson { app: 'lumen'; schema: number; source: SourceInfo; params: unknown; rating: number }
  function toSidecar(p: DevelopParams, source: SourceInfo, rating: number): SidecarJson
  interface LoadedSidecar { params: DevelopParams; rating: number; source: SourceInfo | null; readOnly: boolean }
  class SidecarError extends Error {}
  function fromSidecar(json: unknown): LoadedSidecar       // 不正なら SidecarError
  function sourceChanged(saved: SourceInfo | null, actual: SourceInfo): boolean
  ```

- [ ] **Step 1: 失敗するテストを書く**
  ```ts
  test('既定値のみなら params は空', () =>
    expect(toSidecar(defaultParams(), src, 0).params).toEqual({}));
  test('差分だけ書く', () => {
    const p = defaultParams(); p.basic.exposure = 0.35; p.hsl.blue.s = -20;
    expect(toSidecar(p, src, 3).params).toEqual({ basic: { exposure: 0.35 }, hsl: { blue: { s: -20 } } });
  });
  test('カーブは配列ごと比較し、変更時は配列全体を書く', ...);
  test('往復で一致', () => expect(fromSidecar(JSON.parse(JSON.stringify(toSidecar(p, src, 2)))).params).toEqual(p));
  test('範囲外の値は丸める', ...);   // exposure 99 → 5
  test('未知のキーは無視', ...);
  test('schema が新しすぎると readOnly', () => expect(fromSidecar({ ...ok, schema: 2 }).readOnly).toBe(true));
  test('app が違う・JSON でない・params が配列 → SidecarError', ...);
  test('sourceChanged はサイズか mtime が違えば true、null は false', ...);
  ```
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3:** 実装。`diff(defaults, p)` と `merge(defaults, partial)` は Task 5 でも使うので `src/params/partial.ts` に `deepDiff` / `deepMerge` として置き、ここから import する（配列は値として扱い、要素ごとにマージしない）。移行関数は `migrations: Record<number, (j) => j>` の空テーブルとして用意する。
- [ ] **Step 4:** PASS を確認。
- [ ] **Step 5:** コミット `feat(params): サイドカーの読み書きと移行`

---

### Task 5: プリセット・部分適用・コピー対象

**Files:**
- Modify: `src/params/partial.ts`
- Create: `src/params/presets.ts`
- Test: `tests/unit/partial.test.ts`, `tests/unit/presets.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type DeepPartial<T> = ...;                 // 配列は丸ごと置換
  function deepDiff<T>(base: T, value: T): DeepPartial<T>
  function deepMerge<T>(base: T, partial: DeepPartial<T>): T
  function applyPartial(base: DevelopParams, partial: DeepPartial<DevelopParams>): DevelopParams  // deepMerge + clampParams
  function pickGroups(p: DevelopParams, groups: ParamGroup[]): DeepPartial<DevelopParams>
  const DEFAULT_COPY_GROUPS: ParamGroup[]    // ['basic','curve','hsl','grading']（wb と crop は除外）
  interface Preset { name: string; builtin: boolean; params: DeepPartial<DevelopParams> }
  const BUILTIN_PRESETS: Preset[]            // 名前: 'モノクロ','高コントラスト','フィルム調','ソフト'
  function parsePreset(json: unknown): Preset          // 不正なら Error
  function serializePreset(p: Preset): string
  ```

- [ ] **Step 1: 失敗するテストを書く** — `applyPartial` が partial に無い項目を変えないこと、`pickGroups(p, ['hsl'])` が `hsl` キーだけを持つこと、`DEFAULT_COPY_GROUPS` に `wb` と `crop` が無いこと、`BUILTIN_PRESETS` 4 件の名前、モノクロは全 HSL バンドの `s = -100`（または `basic.saturation = -100`）を含むこと、`parsePreset(serializePreset(x))` の往復、`builtin` は読み込み時に必ず false になること。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3:** 実装。
- [ ] **Step 4:** PASS を確認。
- [ ] **Step 5:** コミット `feat(params): プリセットと部分適用`

---

### Task 6: 色計算（色空間・ホワイトバランス）

**Files:**
- Create: `src/color/spaces.ts`, `src/color/wb.ts`, `src/color/oklab.ts`
- Test: `tests/unit/color-spaces.test.ts`, `tests/unit/wb.test.ts`, `tests/unit/oklab.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type Vec3 = [number, number, number]; type Mat3 = number[]; // 行優先 9 要素
  function mul3(a: Mat3, b: Mat3): Mat3; function apply3(m: Mat3, v: Vec3): Vec3; function inv3(m: Mat3): Mat3
  const XYZ_TO_REC2020: Mat3, REC2020_TO_XYZ: Mat3, SRGB_TO_XYZ: Mat3, P3_TO_XYZ: Mat3, XYZ_TO_SRGB: Mat3, XYZ_TO_P3: Mat3
  function srgbEotf(v: number): number; function srgbOetf(v: number): number   // P3 も同じ伝達関数
  function cctTintToXy(cct: number, tint: number): [number, number]
  function xyToCctTint(x: number, y: number): { cct: number; tint: number }
  function rawWbMultipliers(camToXyz: Mat3, cct: number, tint: number): Vec3   // G=1 に正規化
  function asShotCctTint(camToXyz: Mat3, neutral: Vec3): { cct: number; tint: number }
  function bradford(fromXy: [number,number], toXy: [number,number]): Mat3       // XYZ 空間
  function displayWbMatrix(relTemp: number, relTint: number): Mat3              // リニア Rec.2020 → 同
  function linearToOklab(rgb2020: Vec3): Vec3; function oklabToLinear(lab: Vec3): Vec3
  ```
  色温度: Planck 軌跡の近似（Kim らの 3 次式、1667–25000K、それ以上は 25000K で飽和）。tint は軌跡の法線方向の Duv で、`tint 1 = Duv 0.0001`（正 = マゼンタ側 = Duv 負）。display 画像の相対 WB: `relTemp ±100 = ±100 mired`（正で暖色 = 光源を寒色として補正）、`relTint ±100 = Duv ∓0.01`、基準白は D65。

- [ ] **Step 1: 失敗するテストを書く**
  - `apply3(XYZ_TO_REC2020, apply3(REC2020_TO_XYZ, v))` ≈ v（1e-6）。`inv3` の検算。
  - `srgbOetf(srgbEotf(x))` ≈ x（0..1 の 101 点）。
  - `cctTintToXy(6504, 0)` ≈ D65 (0.3127, 0.3290) を 0.002 以内。`xyToCctTint(cctTintToXy(t, d))` が 2500..12000K、tint −50..50 で往復（CCT 1% 以内、tint ±1）。
  - `rawWbMultipliers` を単位行列風の合成 `camToXyz = REC2020_TO_XYZ` で呼ぶと、D65 指定で `[1,1,1]`（1e-3）。`asShotCctTint(m, neutral)` と `rawWbMultipliers` の往復。
  - `displayWbMatrix(0,0)` が単位行列。`displayWbMatrix(50,0)` を灰色に適用すると R > B（暖色）。
  - OKLab: 白 `[1,1,1]` → L≈1, a,b≈0。往復誤差 1e-6。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3:** 実装（行列は Rec.2020/sRGB/P3 の原色と D65 から算出したもの。OKLab は Björn Ottosson の行列を、Rec.2020 → LMS に合成して使う）。
- [ ] **Step 4:** PASS を確認。
- [ ] **Step 5:** コミット `feat(color): 色空間とホワイトバランス`

---

### Task 7: 色計算（トーン・カーブ・HSL・グレーディング）と参照パイプライン

**Files:**
- Create: `src/color/tone.ts`, `src/color/spline.ts`, `src/color/hsl.ts`, `src/color/grading.ts`, `src/color/uniforms.ts`, `src/color/pipeline.ts`
- Test: `tests/unit/tone.test.ts`, `tests/unit/spline.test.ts`, `tests/unit/hsl.test.ts`, `tests/unit/pipeline.test.ts`

**Interfaces:**
- Consumes: Task 3, Task 6
- Produces:
  ```ts
  function monotoneSpline(points: CurvePoint[]): (x: number) => number   // Fritsch–Carlson
  function bakeLut(f: (x: number) => number, n?: number /*=1024*/): Float32Array
  function parametricCurve(p: DevelopParams['curve']['parametric']): (x: number) => number
  function hslBandWeights(hueRad: number): Float32Array   // 長さ 8、合計 1
  interface ImageColorInfo { kind: 'raw'|'display'; camToXyz?: Mat3; asShotNeutral?: Vec3 }
  interface Uniforms {        // GPU の uniform buffer と同じ並び（f32 配列にパック可能）
    kind: 0|1; wbMul: Vec3; camToWork: Mat3; displayWb: Mat3; exposureMul: number;
    contrast: number; whites: number; blacks: number; highlights: number; shadows: number;
    vibrance: number; saturation: number; baseToneMap: 0|1;
    hsl: Float32Array /*8×3*/; grading: Float32Array /*4×3 + blending, balance*/;
    outMatrix: Mat3; outOetf: 0|1;
  }
  interface Luts { tone: Float32Array /*1024*/; rgb: Float32Array; r: Float32Array; g: Float32Array; b: Float32Array }
  type OutputSpace = 'srgb' | 'p3';
  function buildUniforms(p: DevelopParams, img: ImageColorInfo, out: OutputSpace): { u: Uniforms; luts: Luts }
  function packUniforms(u: Uniforms): Float32Array      // WGSL の struct レイアウト（16 byte 境界）に合わせる
  function developPixel(rgbIn: Vec3, baseLum: number, u: Uniforms, luts: Luts): Vec3   // 出力は 0..1 のエンコード済み値
  ```
  処理順は仕様 3.2 の 1〜11（4 のハイライト／シャドウは `baseLum`＝ベース層の輝度を受け取って適用）。各式は実装者が `tone.ts` 等の先頭コメントに書く。ベーストーンマップ（RAW のみ、display は恒等）は輝度ベースの拡張 Reinhard: `f(Y) = Y(1 + Y/16)/(1 + Y)`、RGB は `f(Y)/Y` 倍し、1 を超える成分は `f(Y)` の灰色へ寄せて収める。LUT の補間はすべて線形。

- [ ] **Step 1: 失敗するテストを書く**
  - spline: 単調増加の点列で出力が単調、端点を通る、`[[0,0],[1,1]]` は恒等。
  - parametric: 全 0 で恒等、`highlights: 50` で x=0.85 の出力が増え x=0.1 は不変（1e-3）。
  - hslBandWeights: 赤（0rad）で red の重みが最大、合計 1、隣接バンドの中間で 2 バンドが 0.5 ずつ。
  - pipeline: `defaultParams()` + display 画像 + sRGB 出力で、入力 `srgbEotf(v)` → 出力 `v`（1/1024 以内、0..1 の 64 点の灰色と 8 色の原色）。露光 +1 で display 灰色 0.18 リニア → 0.36 リニア相当。saturation −100 で出力の R=G=B。
  - `packUniforms` の長さが 16 の倍数（float 単位で 4 の倍数）。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3:** 実装。
- [ ] **Step 4:** PASS を確認。
- [ ] **Step 5:** コミット `feat(color): トーン・HSL・グレーディングと参照パイプライン`

---

### Task 8: 公開サンプルの取得スクリプト

**Files:**
- Create: `scripts/fetch-samples.ts`, `scripts/samples.json`, `tests/fixtures/make-fixtures.ts`
- Test: 実行結果の確認のみ

**Interfaces:**
- Produces: `npm run samples` → `.samples/<key>.<ext>` に保存し sha256 を検証。`npm run fixtures` → `tests/fixtures/` に合成 JPEG/PNG（グラデーション、カラーチャート、orientation 6 の JPEG、9000×1000 の JPEG）を生成。`function samplePath(key: string): string | null`（`tests/helpers/samples.ts`、無ければ null → テスト側で `test.skip`）。

- [ ] **Step 1:** `samples.json` に raw.pixls.us などの再配布可能（CC0 / CC-BY）なファイルを登録: キー `canon-20d-cr2`, `nikon-d5300-nef`, `iphone-heic`, `iphone-proraw-dng`, `bayer-dng`。各エントリに `url`, `sha256`, `license` を書く（実際にダウンロードしてハッシュを記入。ライセンスが CC0/CC-BY でないものは登録しない。見つからないキーは登録せず README に記録）。
- [ ] **Step 2:** `npm run samples` と `npm run fixtures` を実行し、ファイルが生成され sha256 が一致することを確認。ネットワークが拒否された場合は `read_documentation` で環境のネットワーク設定を確認し、ユーザーに報告する。
- [ ] **Step 3:** コミット `chore: 公開サンプル取得と合成フィクスチャ`（`.samples/` はコミットしない）

---

### Task 9: デコード（形式判定・縮小・EXIF・JPEG/PNG/HEIC）

**Files:**
- Create: `src/decode/types.ts`, `src/decode/sniff.ts`, `src/decode/downscale.ts`, `src/decode/exif.ts`, `src/decode/display.ts`, `src/decode/heic.ts`
- Test: `tests/unit/sniff.test.ts`, `tests/unit/downscale.test.ts`, `tests/e2e/decode-display.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  type Orientation = 1|3|6|8;
  interface ExifSummary { date?: string; make?: string; model?: string; lens?: string; iso?: number;
                          exposureTime?: number; fNumber?: number; focalLength?: number; gps?: { lat: number; lon: number } }
  interface DecodedImage {            // 仕様 2.3。pixels は RGB 3ch、0..1 を 0..65535 に正規化
    width: number; height: number; orientation: Orientation; kind: 'raw'|'display';
    pixels: Uint16Array; camToXyz?: Mat3; asShotNeutral?: Vec3; exif: ExifSummary;
  }
  interface WorkingImage extends DecodedImage { fullWidth: number; fullHeight: number }  // pixels は縮小済み
  type Format = 'raw'|'jpeg'|'png'|'heic'|'unknown';
  function sniffFormat(head: Uint8Array, name: string): Format
  function downscaleArea(src: Uint16Array, w: number, h: number, maxEdge: number): { data: Uint16Array; width: number; height: number }
  function readExif(file: Blob): Promise<{ exif: ExifSummary; orientation: Orientation; iccIsP3: boolean }>   // exifr
  function decodeDisplay(file: Blob): Promise<DecodedImage>   // JPEG/PNG、Safari の HEIC
  function decodeHeic(file: Blob): Promise<DecodedImage>      // Safari は decodeDisplay、他は libheif-js
  ```
  `decodeDisplay`: `createImageBitmap(file, { imageOrientation: 'none', colorSpaceConversion: 'none' })` → `OffscreenCanvas` の `getImageData(…, { colorSpace: iccIsP3 ? 'display-p3' : 'srgb' })` → `srgbEotf` → P3/sRGB → Rec.2020 → Uint16。

- [ ] **Step 1: 失敗するテストを書く**
  - sniff: `FF D8 FF` → jpeg、`89 50 4E 47` → png、`ftypheic`/`ftypheix`/`ftypmif1` → heic、`II*\0` + `.CR2`/`.NEF`/`.DNG` → raw、`._IMG.CR2` の中身が AppleDouble（`00 05 16 07`）→ unknown。
  - downscale: 9000×1000 を maxEdge 4096 → 4096×455（四捨五入）、一様画像は値が変わらない、上限以下ならそのまま（コピーしない同一参照でも可）。**（Review Focus 4）** 8064×6048 を 4096 → 4096×3072。
  - e2e（chromium）: フィクスチャの sRGB 中間灰 JPEG を `decodeDisplay` → 中央画素がリニア 0.214±0.01（sRGB 128）、orientation 6 の JPEG で `orientation === 6` かつ `width/height` が回転前の値。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3:** 実装（依存追加: `exifr`、`libheif-js`）。
- [ ] **Step 4:** PASS を確認。`iphone-heic` サンプルがあれば Chromium で `decodeHeic` の寸法と orientation を検証するテストも PASS。
- [ ] **Step 5:** コミット `feat(decode): 表示系画像のデコード`

---

### Task 10: LibRaw-WASM の選定と RAW / ProRAW デコード（検証ゲート）

**Files:**
- Create: `src/decode/raw.ts`, `docs/decisions/libraw-wasm.md`
- Test: `tests/e2e/decode-raw.spec.ts`

**Interfaces:**
- Produces: `function decodeRaw(file: Blob): Promise<DecodedImage>`（`kind: 'raw'`、カメラ RGB リニア、`camToXyz` は LibRaw の `cam_xyz` から XYZ(D65) 基準の 3×3、`asShotNeutral` は `cam_mul` の逆数を G=1 正規化）。`function extractRawPreview(file: Blob): Promise<Blob | null>`（埋め込み JPEG）。

- [ ] **Step 1:** npm の既存 LibRaw WASM パッケージ（例: `libraw-wasm`）を評価し、次をすべて満たすか確認して `docs/decisions/libraw-wasm.md` に記録: (a) `output_color=0`（raw color）、`no_auto_bright`、`gamma 1/1`、`use_camera_wb=0`、`user_mul=1,1,1,1`、16bit 出力を指定できる、(b) `cam_xyz`/`rgb_cam`、`cam_mul`、`black`/`maximum` を取得できる、(c) リニア DNG（ProRAW）を読める、(d) サムネイルを取り出せる、(e) Worker で動く、(f) ライセンスが LGPL/CDDL。満たさなければ Emscripten で LibRaw 0.21 以降を自前ビルドする `scripts/build-libraw.sh`（Docker の emscripten/emsdk イメージ、出力を `src/decode/vendor/` に配置）を作る。JPEG XL 圧縮 DNG の対応可否もここで確認し、非対応ならこのファイルに「libjxl 追加が必要」と記録して Task 10b として計画に追記する。
- [ ] **Step 2: 失敗するテストを書く**（各テストはサンプルが無ければ skip）
  - `canon-20d-cr2`: 寸法が 3504×2336（±デモザイク時の縁の切り落とし 8px）、`kind 'raw'`、`exif.model` に `20D`、`asShotNeutral[1] === 1`。
  - `nikon-d5300-nef`: 長辺 6000±8、`exif.model` に `D5300`。
  - `iphone-proraw-dng`: `kind 'raw'`、デモザイク済み判定でも寸法が DNG の `ImageWidth` と一致。
  - 全 RAW 共通: 画素の最大値 ≤ 65535、中央 64×64 の平均が 0 でない、`extractRawPreview` が JPEG を返す。
  - 合成の壊れたファイル（CR2 拡張子の乱数 1KB）で `decodeRaw` が `Error` を reject する（クラッシュしない）。
- [ ] **Step 3:** FAIL を確認。
- [ ] **Step 4:** 実装。
- [ ] **Step 5:** PASS を確認（サンプル未取得のテストは skip と表示されることを確認）。
- [ ] **Step 6:** コミット `feat(decode): LibRaw による RAW デコード`

---

### Task 10b: JPEG XL 圧縮 ProRAW（後回し・サンプル入手後）

Task 10 の検証で、同梱 LibRaw は JPEG XL 圧縮 DNG に非対応と判明した（`docs/decisions/libraw-wasm.md`）。

**Files:** Create `src/decode/jxl-dng.ts`、Test: `tests/e2e/decode-jxl.spec.ts`

- [ ] **Step 1:** iPhone 16 Pro 以降で「ProRAW（JPEG XL）」設定で撮った DNG を `test-assets/proraw-jxl.dng` に置いてもらう。
- [ ] **Step 2: 失敗するテスト** — `decodeRaw` が `kind 'raw'`、寸法が DNG の ImageWidth/ImageLength と一致、撮影時色温度が 2500〜10000K。
- [ ] **Step 3:** 実装方針: libjxl の WASM デコーダー（BSD）で DNG のタイルを展開し、ColorMatrix / AsShotNeutral は TIFF タグから読む。`decodeRaw` は LibRaw が失敗した DNG のうち Compression=52546 のものをこの経路に回す。
- [ ] **Step 4:** PASS を確認しコミット `feat(decode): JPEG XL 圧縮 ProRAW`

---

### Task 11: デコード Worker とクライアント

**Files:**
- Create: `src/decode/worker.ts`, `src/decode/client.ts`
- Test: `tests/e2e/decoder.spec.ts`

**Interfaces:**
- Consumes: Task 9, Task 10
- Produces:
  ```ts
  interface Rect { x: number; y: number; w: number; h: number }
  class DecodeError extends Error { format: Format }
  class Decoder {
    constructor(worker?: Worker)
    open(file: Blob, name: string, opts: { workCap: number }): Promise<{ handle: string; working: WorkingImage }>
    readTile(handle: string, rect: Rect): Promise<Uint16Array>   // 元データ（フル解像度、向き補正前座標）から RGB を切り出す。範囲外は端の画素で埋める
    close(handle: string): void
    preview(file: Blob, name: string, maxEdge: number): Promise<Blob>   // RAW は埋め込み JPEG、他は縮小 JPEG
  }
  ```
  Worker は同時に 1 枚分の元データだけを保持し、`open` で新しい画像を開くと前の元データを破棄する（仕様 3.1）。メッセージは `{ id, type, payload }`、転送は `Transferable`。

- [ ] **Step 1: 失敗するテストを書く**
  - フィクスチャ 9000×1000 JPEG を `open(…, {workCap: 4096})` → `working.width === 4096`、`fullWidth === 9000`。`readTile(h, {x:8990,y:0,w:20,h:4})` が 20×4×3 要素を返す（端の外は端の値）。
  - 2 枚目を `open` した後で 1 枚目の handle に `readTile` すると reject。
  - **（Review Focus 5）** 乱数バイトの `.NEF` を `open` → `DecodeError` で reject し、その後 正常な JPEG の `open` が成功する（Worker が生きている）。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3:** 実装。
- [ ] **Step 4:** PASS を確認。
- [ ] **Step 5:** コミット `feat(decode): デコード Worker`

---

### Task 12: GPU 初期化・作業画像のアップロード・ピラミッド

**Files:**
- Create: `src/engine/gpu.ts`, `src/engine/upload.ts`, `src/engine/upload.wgsl`
- Test: `tests/e2e/gpu-upload.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  interface Gpu { device: GPUDevice; limits: GPUSupportedLimits; onLost(cb: () => void): void }
  function createGpu(): Promise<Gpu>          // 失敗時 Error('WebGPU を初期化できません')
  interface GpuImage { texture: GPUTexture /* rgba16float, mip あり */; width: number; height: number; mipCount: number; destroy(): void }
  function uploadRgb16(gpu: Gpu, data: Uint16Array, width: number, height: number): GpuImage
  function readTexture(gpu: Gpu, tex: GPUTexture, mip?: number): Promise<Float32Array>   // テスト・ヒストグラム用
  ```
  アップロード: Uint16 RGB をストレージバッファ（u32 に 2 値ずつパック）で送り、コンピュートシェーダーで `rgba16float` に展開（`/65535`）。ミップは 2×2 平均のコンピュートで生成。

- [ ] **Step 1: 失敗するテストを書く**（chromium-webgpu）: 5×3 のグラデーションを upload → `readTexture` で値が `/65535` と 1e-3 以内一致。64×64 一様画像の最小ミップが同じ値。mipCount が `floor(log2(max(w,h)))+1`。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3:** 実装。`device.lost` を `onLost` に配線。
- [ ] **Step 4:** PASS を確認。
- [ ] **Step 5:** コミット `feat(engine): GPU 初期化と作業画像のアップロード`

---

### Task 13: 現像シェーダーと参照実装の一致・iPhone 検証ページ

**Files:**
- Create: `src/engine/develop.wgsl`, `src/engine/develop.ts`, `src/gpu-check/index.html`, `src/gpu-check/main.ts`
- Modify: `vite.config.ts`（gpu-check を追加エントリに）
- Test: `tests/e2e/develop-parity.spec.ts`

**Interfaces:**
- Consumes: Task 7 の `buildUniforms`, `packUniforms`, `developPixel`、Task 12
- Produces:
  ```ts
  class DevelopPass {
    constructor(gpu: Gpu)
    setLuts(luts: Luts): void
    run(src: GPUTexture, srcMip: number, base: GPUTexture, u: Float32Array, out: GPUTexture, outRect: Rect,
        sample: SampleTransform): void   // 出力画素 → 入力 UV の写像（Task 15 で定義。ここでは恒等を渡す）
  }
  ```
  処理段 1〜3、5〜11 を 1 つのコンピュートシェーダーで処理し、処理段 4 は `base` テクスチャ（Task 14）の輝度を読む。Task 14 が完成するまでのテストでは、`base` に入力と同寸の「画素の輝度そのもの」のテクスチャを渡す（参照実装にも同じ値を `baseLum` として渡す）。

- [ ] **Step 1: 失敗するテストを書く** — 64×64 の合成画像（灰色ランプ、原色、肌色、高彩度、0 と 1 付近）を、次の各パラメータセットで GPU と `developPixel` の両方で処理し、全画素の最大差 ≤ 1/512:
  既定値 / 露光 +2 / 露光 −3 / コントラスト ±80 / 白・黒 ±60 / 自然な彩度 +80 / 彩度 −100 / 各 HSL バンドの h,s,l ±60 / グレーディング 3 ホイールと blending 0・100 / RGB ポイントカーブ S 字 / R カーブのみ / RAW 種別（合成 camToXyz、wb custom 3200K）/ display の相対 WB +50,−30 / 出力 P3。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3:** 実装。
- [ ] **Step 4:** PASS を確認。
- [ ] **Step 5:** `src/gpu-check/` に、合成 2048×2048 画像を作業画像として現像し、`rgba16float` のストレージ書き込み可否、アダプタ情報、`maxTextureDimension2D`、`maxBufferSize`、1 回の現像時間（20 回平均）、4096×3072 と 8064×6048 の `rgba16float` テクスチャ確保の成否を表示するページを作る。`npm run build` で `dist/gpu-check/index.html` が出ることを確認。
- [ ] **Step 6:** コミット `feat(engine): 現像シェーダーと iPhone 検証ページ`
- [ ] **Step 7: チェックポイント（ユーザー作業）** — ユーザーに `dist/` を Cloudflare Pages（無料、ダッシュボードからのアップロードまたは `npx wrangler pages deploy dist`）に公開してもらい、iPhone の Safari で `/gpu-check/` を開いた結果のスクリーンショットをもらう。現像時間が 33ms を大きく超える、または `rgba16float` のストレージが使えない場合は、続行前に仕様 3.4 の上限値の見直しをユーザーと相談する。待っている間も Task 14 以降の PC 側作業は進めてよい。

---

### Task 14: 局所トーン（ハイライト／シャドウ用ベース層）

**Files:**
- Create: `src/engine/localtone.wgsl`, `src/engine/localtone.ts`
- Modify: `src/color/pipeline.ts`（CPU 参照の `baseLayerRef` を追加）
- Test: `tests/e2e/localtone.spec.ts`, `tests/unit/baselayer.test.ts`

**Interfaces:**
- Produces:
  ```ts
  const BASE_LAYER_EDGE = 512;      // ベース層の長辺
  function baseLayerRef(lum: Float32Array, w: number, h: number): Float32Array   // CPU 参照（ガイデッドフィルター、半径 = 長辺の 2%、eps = 0.01、log 輝度上で計算）
  class LocalTonePass { constructor(gpu: Gpu); build(img: GpuImage, u: Float32Array /* WB・露光までを適用するため */): GPUTexture /* r16float, 長辺 512 */ }
  ```
  ベース層は作業画像のミップのうち長辺 512 以上で最小の段から作り、切り抜きと無関係に画像全体から作る（仕様 3.3）。`DevelopPass` は UV でバイリニア補間して読む。

- [ ] **Step 1: 失敗するテストを書く** — unit: 一様画像でベース層 = 入力輝度、ステップエッジで両側の平坦部（エッジから半径×2 以上離れた所）はそれぞれの輝度に一致（1e-3）。e2e: GPU ベース層と `baseLayerRef` が 1/256 以内、highlights −100 で明部が下がり暗部（輝度 < 0.05）は 1/512 以内で不変、shadows +100 で逆。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3:** 実装し、Task 13 のパリティテストにハイライト／シャドウ ±80 のケースを追加（ベース層は両方とも `baseLayerRef` の値を使う）。
- [ ] **Step 4:** PASS を確認。
- [ ] **Step 5:** コミット `feat(engine): ハイライト／シャドウの局所トーン`

---

### Task 15: 幾何（向き・切り抜き・回転）、Renderer、ヒストグラム

**Files:**
- Create: `src/engine/geometry.ts`, `src/engine/renderer.ts`, `src/engine/histogram.wgsl`
- Test: `tests/unit/geometry.test.ts`, `tests/e2e/renderer.spec.ts`

**Interfaces:**
- Consumes: Task 12〜14
- Produces:
  ```ts
  // geometry.ts（純粋関数）
  function orientedSize(w: number, h: number, o: Orientation): { w: number; h: number }
  function maxInscribedCrop(w: number, h: number, angleDeg: number, aspect: number | null): Rect   // 正規化座標
  function aspectValue(a: Aspect, w: number, h: number): number | null
  function constrainCrop(c: DevelopParams['crop'], w: number, h: number): DevelopParams['crop']  // 回転後の画像内に収める
  interface SampleTransform { m: Float32Array /* 3x3: 出力画素 → 入力 UV */ }
  function sampleTransform(src: { w: number; h: number; o: Orientation }, crop: DevelopParams['crop'],
                           out: { w: number; h: number }, view?: { zoom: number; cx: number; cy: number }): SampleTransform
  function croppedSize(fullW: number, fullH: number, o: Orientation, crop: DevelopParams['crop']): { w: number; h: number }
  // renderer.ts
  interface ViewState { mode: 'fit' | '100'; cx: number; cy: number; before: boolean; background: 'black'|'dark'|'gray18' }
  interface Histogram { r: Uint32Array; g: Uint32Array; b: Uint32Array; clipHigh: number; clipLow: number }  // 各 256 bin
  class Renderer {
    constructor(gpu: Gpu, canvas: HTMLCanvasElement | OffscreenCanvas, opts: { previewCap: number })
    setImage(img: WorkingImage): void                     // GPU のメモリ確保失敗（pushErrorScope('out-of-memory')）は GpuOutOfMemoryError を throw
    render(p: DevelopParams, view: ViewState): void       // rAF で間引く。before=true は defaultParams で描画
    histogram(): Promise<Histogram>
    renderTileFull(p: DevelopParams, tile: { data: Uint16Array; rect: Rect }, out: 'srgb'|'p3'): Promise<Float32Array>  // Task 20 で使用
    destroy(): void
  }
  ```

- [ ] **Step 1: 失敗するテストを書く**
  - `orientedSize(4000,3000,6)` → 3000×4000。
  - `maxInscribedCrop(3000,2000,0,null)` → 全体。角度 10° で幅と高さがともに縮み、4 隅が回転後画像の内側にある（点の内外判定で検証）。
  - **（Review Focus 1）** orientation 6、crop `{x:0,y:0,w:0.5,h:1}`（向き補正後の左半分）で `sampleTransform` が出力左上 → 入力 UV（回転前）の正しい角に写ること。同じ crop で `croppedSize(4000,3000,6,crop)` = 1500×4000。
  - e2e: 左半分赤・右半分青の合成画像に orientation 6 を付け、crop 左半分で描画 → 出力全体が向き補正後の左半分の色（赤か青か、どちらになるかを事前に計算して比較）。
  - ヒストグラム: 一様灰 128 の画像で各チャンネルの bin 128 付近に全画素が集まる。白飛び画素数の検証。
  - `device.lost` を `gpu.device.destroy()` で発生させた後、Renderer が新しいデバイスで再描画できる。
  - `maxTextureDimension2D` を超える作業画像を `setImage` すると `GpuOutOfMemoryError`（`class GpuOutOfMemoryError extends Error` を renderer.ts から export）。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3:** 実装。
- [ ] **Step 4:** PASS を確認。
- [ ] **Step 5:** コミット `feat(engine): 切り抜き・回転・Renderer・ヒストグラム`

---

### Task 16: 保存方式のインターフェースと FolderBackend

**Files:**
- Create: `src/storage/types.ts`, `src/storage/names.ts`, `src/storage/folder.ts`, `tests/unit/storage-contract.ts`, `tests/helpers/fake-fs.ts`
- Test: `tests/unit/folder.test.ts`, `tests/unit/names.test.ts`

**Interfaces:**
- Consumes: Task 4 の `SourceInfo`, Task 5 の `Preset`
- Produces（仕様 2.4）:
  ```ts
  interface ImageRef { id: string; name: string; size: number; mtime: number; group: string }
  interface PresetStore { list(): Promise<Preset[]>; save(p: Preset): Promise<void>; remove(name: string): Promise<void> }
  interface StorageBackend {
    kind: 'folder' | 'library';
    addSource(): Promise<void>;
    list(): Promise<ImageRef[]>;
    readOriginal(id: string): Promise<File>;
    readSidecar(id: string): Promise<unknown | null>;           // 存在しなければ null
    writeSidecar(id: string, data: unknown): Promise<void>;
    quarantineSidecar(id: string): Promise<void>;               // 破損時に .bak へ退避
    remove?(id: string): Promise<void>;
    presets: PresetStore;
    saveExport(name: string, blob: Blob): Promise<string>;      // 実際に保存した名前（重複時は連番）
    needsPermission(): Promise<boolean>; requestPermission(): Promise<boolean>;
  }
  // names.ts
  const IMAGE_EXTS: string[]   // jpg jpeg png heic heif cr2 cr3 nef nrw arw dng raf orf rw2 pef srw
  function isImageName(name: string): boolean      // 先頭が '.' や '._' のものは false
  function sidecarName(name: string): string       // name + '.json'
  function uniqueName(name: string, exists: (n: string) => boolean): string   // "a.jpg" → "a-2.jpg" …
  // folder.ts
  class FolderBackend implements StorageBackend { constructor(deps: { pickDirectory(): Promise<FileSystemDirectoryHandle>; handleStore: HandleStore }) ; setExportDir(...); setPresetDir(...) }
  ```
  `id` はルートフォルダ名＋相対パス。サイドカー書き込みは `createWritable()`（閉じるまで元ファイルを変えない一時ファイル方式のため、仕様 4.2 の「一時ファイル → 置換」を満たす）。フォルダハンドルは `idb` で IndexedDB に保存。

- [ ] **Step 1: 失敗するテストを書く**
  - `storage-contract.ts` に `runStorageContract(makeBackend: () => Promise<StorageBackend>)` を書く: サイドカーの書いて読む往復、存在しないサイドカーは null、`quarantineSidecar` 後は `readSidecar` が null かつ `.bak` が残る、`saveExport` 2 回目の同名が `-2` 付き、プリセットの保存・一覧・削除。
  - folder.test.ts で fake-fs（メモリ上の `FileSystemDirectoryHandle` 互換）を使って契約テストを実行。
  - **（Review Focus 2）** フォルダに `IMG_0001.CR2`, `IMG_0001.JPG`, `IMG_0001.CR2.json`, `._IMG_0001.CR2`, `写真 1.HEIC`, `notes.txt`, サブフォルダ `2024/a.nef` → `list()` は 4 件（CR2、JPG、写真 1.HEIC、2024/a.nef）、`group` は `''` と `'2024'`。CR2 と JPG のサイドカー書き込みが別ファイル（`IMG_0001.CR2.json` と `IMG_0001.JPG.json`）になる。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3:** 実装（依存追加: `idb`）。
- [ ] **Step 4:** PASS を確認。
- [ ] **Step 5:** コミット `feat(storage): 保存方式のインターフェースとフォルダ方式`

---

### Task 17: LibraryBackend（OPFS）と取り込み

**Files:**
- Create: `src/storage/library.ts`, `src/storage/transcode.ts`
- Test: `tests/unit/transcode.test.ts`, `tests/e2e/library.spec.ts`

**Interfaces:**
- Consumes: Task 16
- Produces:
  ```ts
  class LibraryBackend implements StorageBackend {
    constructor(deps: { root: FileSystemDirectoryHandle; pickFiles(): Promise<File[]>; share(files: File[]): Promise<boolean>;
                        estimate(): Promise<{ usage: number; quota: number }>; now(): Date })
    importFiles(files: File[]): Promise<ImportResult>
  }
  interface ImportResult { added: ImageRef[]; transcoded: string[]; rejected: { name: string; reason: 'quota' | 'unsupported' }[] }
  class QuotaError extends Error { needed: number; available: number }
  function looksTranscoded(file: { name: string; type: string }): boolean   // 拡張子が示す形式と File.type が食い違えば true（例: IMG_0001.HEIC なのに image/jpeg）
  function requestPersistence(): Promise<boolean>
  ```
  OPFS 構成: `library/<id>/original.<ext>`、`library/<id>/sidecar.json`、`library/<id>/meta.json`（name, size, mtime, importedAt）、`presets/*.json`。`id` は `crypto.randomUUID()`。`group` は取り込み日 `YYYY-MM-DD`。`addSource()` は `pickFiles` → `importFiles`。取り込み前に `estimate()` で合計サイズ×1.1 の空きを確認し、不足なら 1 枚も書かずに `QuotaError`。書き込みは `createWritable` があればそれ、無ければ専用 Worker の `createSyncAccessHandle` で行う。`saveExport` は `share([file])` が false を返したら `<a download>` でダウンロード。

- [ ] **Step 1: 失敗するテストを書く**
  - transcode: `{name:'IMG_0001.HEIC', type:'image/jpeg'}` → true、`{name:'IMG_0001.JPG', type:'image/jpeg'}` → false、`{name:'IMG_0001.DNG', type:'image/jpeg'}` → true。
  - e2e（chromium と webkit の両方、実 OPFS）: Task 16 の `runStorageContract` を実行。`importFiles` で 2 枚取り込み → `list()` が 2 件で group が今日。`estimate` が空き 1 バイトを返すスタブで `QuotaError`、OPFS に何も増えていない。`remove(id)` でフォルダごと消える。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3:** 実装。
- [ ] **Step 4:** PASS を確認。
- [ ] **Step 5:** コミット `feat(storage): OPFS ライブラリ方式と取り込み`

---

### Task 18: サムネイルキャッシュ

**Files:**
- Create: `src/cache/thumbs.ts`
- Test: `tests/e2e/thumbs.spec.ts`

**Interfaces:**
- Consumes: Task 11 の `Decoder.preview`, Task 16 の `ImageRef`
- Produces:
  ```ts
  const THUMB_EDGE = 320;
  function thumbKey(kind: 'folder'|'library', ref: ImageRef): string   // `${kind}:${id}:${size}:${mtime}`
  class ThumbCache {
    constructor(decoder: Decoder, readOriginal: (id: string) => Promise<File>, kind: 'folder'|'library')
    get(ref: ImageRef): Promise<Blob>    // キャッシュ → 無ければ生成して保存。同時実行は 2 件まで
    invalidate(ref: ImageRef): Promise<void>
  }
  ```
- [ ] **Step 1: 失敗するテストを書く** — 同じ ref の 2 回目の `get` で `decoder.preview` が呼ばれない、`mtime` が変わると再生成、同時に 10 件要求しても `preview` の同時実行が 2 以下。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3:** 実装（`idb`）。
- [ ] **Step 4:** PASS を確認。
- [ ] **Step 5:** コミット `feat(cache): サムネイルキャッシュ`

---

### Task 19: 編集状態・Undo 履歴・自動保存

**Files:**
- Create: `src/store/history.ts`, `src/store/editor.svelte.ts`
- Test: `tests/unit/history.test.ts`, `tests/unit/editor.test.ts`

**Interfaces:**
- Consumes: Task 3〜5, Task 11, Task 15, Task 16
- Produces:
  ```ts
  class History<T> {
    constructor(initial: T, cap?: number /*=100*/)
    readonly current: T
    set(next: T): void                    // ジェスチャー中は current だけ更新し履歴に積まない
    beginGesture(): void; endGesture(): void   // 開始時の値 → 終了時の値を 1 件として積む
    undo(): T | null; redo(): T | null; canUndo: boolean; canRedo: boolean
  }
  interface EditorDeps { backend: StorageBackend; decoder: Decoder; renderer: Renderer | null; platform: Platform;
                         setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }
  function createEditor(deps: EditorDeps): Editor
  interface Editor {
    images: ImageRef[]; selection: string[]; currentId: string | null;
    params: DevelopParams; rating: number; readOnly: boolean;
    status: { saveError: string | null; sourceChanged: boolean; corrupted: boolean; decodeError: string | null; notice: string | null };
    refresh(): Promise<void>;
    open(id: string): Promise<void>;              // 前の画像の保留中の保存を即時実行してから切り替える
    update(mut: (p: DevelopParams) => void): void; beginGesture(): void; endGesture(): void;
    undo(): void; redo(): void; resetAll(): void; setRating(n: number): void;
    copy(groups: ParamGroup[]): void; paste(ids: string[]): Promise<{ failed: string[] }>;
    applyPreset(p: Preset, ids?: string[]): Promise<void>;
    flush(): Promise<void>;
  }
  ```
  保存: 変更から 500ms のデバウンスで `writeSidecar(id, toSidecar(...))`。失敗したら `status.saveError` を立てて内容はメモリに保持し、次の `update` か 5 秒後に再試行。`readOnly` のときは保存しない。読み込み時: `fromSidecar` が `SidecarError` → `quarantineSidecar` して既定値で開き `corrupted = true`。`sourceChanged` は Task 4 の関数で判定。

- [ ] **Step 1: 失敗するテストを書く**（fake timers、メモリ backend、Decoder/Renderer はスタブ）
  - History: 3 回 set → undo 3 回で初期値、上限 100 件、ジェスチャー中の 50 回の set が 1 件、undo 後に set すると redo が消える。
  - 自動保存: update 後 499ms では未保存、500ms で 1 回保存。連続 update は最後の 1 回だけ保存。
  - **（Review Focus 3）** 画像 A を update → 200ms 後に `open(B)` → A のサイドカーに A の最終値が保存され、B のサイドカーには書かれない。B を update → 保存は B のみ。
  - 保存失敗（1 回目 reject）→ `saveError` が立ち、5 秒後の再試行成功で null に戻る。
  - 破損サイドカー → `quarantineSidecar` が呼ばれ、params が既定値、`corrupted === true`。
  - Renderer スタブの `setImage` が 1 回目に `GpuOutOfMemoryError` を投げる → `decoder.open` が `workCap` を半分（4096 → 2048）にして再度呼ばれ、`status.notice` に「解像度を下げて表示しています」が入る（仕様 7 章。`status` に `notice: string | null` を追加）。
  - `paste(['B','C'])` が `DEFAULT_COPY_GROUPS` のみを適用し、B・C の crop と wb は不変。1 枚の書き込み失敗は `failed` に入り、他は保存される。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3:** 実装。
- [ ] **Step 4:** PASS を確認。
- [ ] **Step 5:** コミット `feat(store): 編集状態・Undo・自動保存`

---

### Task 20: タイル計画とタイル現像の一致

**Files:**
- Create: `src/export/tiles.ts`
- Modify: `src/engine/renderer.ts`（`renderTileFull` の実装）
- Test: `tests/unit/tiles.test.ts`, `tests/e2e/tile-parity.spec.ts`

**Interfaces:**
- Consumes: Task 15
- Produces:
  ```ts
  const TILE = 2048, OVERLAP = 32;
  interface TilePlan { src: Rect /* 重なり込みの元座標（向き補正前） */; core: Rect /* 出力に書く範囲（出力座標） */; outOffset: { x: number; y: number } }
  function planTiles(full: { w: number; h: number; o: Orientation }, crop: DevelopParams['crop'],
                     outLongEdge: number | null): { outW: number; outH: number; tiles: TilePlan[] }
  ```
- [ ] **Step 1: 失敗するテストを書く**
  - unit: 6000×4000、原寸 → 出力 6000×4000、タイルの core が重複なく全域を覆う（面積の合計＝出力面積、交差なし）。長辺 2048 指定 → 出力 2048×1365、タイル 1 枚。
  - **（Review Focus 4）** e2e: 9000×1000 の合成グラデーション（作業画像は 4096 に縮小済み）を原寸タイル書き出し → 出力 9000×1000、タイル境界をまたぐ隣接画素の差が、境界以外の隣接画素の差の最大値 + 1/255 以下（段差がない）。同じ画像を 1 枚で現像した結果（画像が小さいケース 3000×2000 で比較）とタイル分割版の最大差 ≤ 1/255。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3:** 実装。`renderTileFull` は、渡された元データ（Uint16）を一時テクスチャに上げ、ベース層は作業画像から作ったもの（Task 14）を共有して現像する。
- [ ] **Step 4:** PASS を確認。
- [ ] **Step 5:** コミット `feat(export): タイル分割現像`

---

### Task 21: 書き出しパイプライン

**Files:**
- Create: `src/export/resample.ts`, `src/export/sharpen.ts`, `src/export/watermark.ts`, `src/export/encode.ts`, `src/export/metadata.ts`, `src/export/naming.ts`, `src/export/exporter.ts`, `src/export/worker.ts`, `src/export/icc/sRGB.icc`, `src/export/icc/DisplayP3.icc`
- Test: `tests/unit/resample.test.ts`, `tests/unit/naming.test.ts`, `tests/unit/metadata.test.ts`, `tests/e2e/export.spec.ts`

**Interfaces:**
- Consumes: Task 11, Task 15, Task 16, Task 19, Task 20
- Produces:
  ```ts
  interface ExportSettings {
    format: 'jpeg' | 'png'; quality: number /*1..100*/; longEdge: number | null; space: 'srgb' | 'p3';
    sharpen: 'none' | 'low' | 'standard' | 'high'; nameRule: string /* {name} {seq} {date} */;
    watermark: null | { kind: 'text'; text: string } | { kind: 'image'; image: Blob }
               & { position: 'tl'|'t'|'tr'|'l'|'c'|'r'|'bl'|'b'|'br'; size: number /*長辺比 0.02..0.5*/; opacity: number /*0..1*/ };
    stripGps: boolean;
  }
  function lanczos3Into(src: Float32Array, sw: number, sh: number, srcRect: Rect, dst: Float32Array, dw: number, dh: number, scale: number, dstRect: Rect): void
  function unsharp(rgb: Float32Array, w: number, h: number, level: ExportSettings['sharpen'], longEdge: number): void   // 半径 = 長辺/2000 px（最小 0.5）、量: low 0.3 / standard 0.6 / high 1.0、閾値 2/255
  function applyWatermark(rgba: Uint8ClampedArray, w: number, h: number, wm: NonNullable<ExportSettings['watermark']>): Promise<void>
  function encode(rgba: Uint8ClampedArray, w: number, h: number, s: ExportSettings): Promise<Uint8Array>   // @jsquash/jpeg, @jsquash/png
  function withMetadata(bytes: Uint8Array, format: 'jpeg'|'png', exif: ExifSummary, space: 'srgb'|'p3', stripGps: boolean): Uint8Array
  function formatName(rule: string, v: { name: string; seq: number; date?: string }, ext: string): string
  function exportImages(ids: string[], s: ExportSettings, deps: ExportDeps,
                        onProgress: (done: number, total: number) => void, signal: AbortSignal)
    : Promise<{ saved: string[]; failed: { id: string; reason: string }[]; cancelled: boolean }>
  ```
  ICC: saucecontrol/Compact-ICC-Profiles の sRGB と Display P3 のコンパクト版（ライセンスが CC0 / MIT であることを確認して同梱）。JPEG は APP2 `ICC_PROFILE`、EXIF は `piexifjs`（撮影日時・機種・レンズ・ISO・SS・F 値・焦点距離、`stripGps` で GPS を除去、Orientation は 1 に）。PNG は `iCCP` と `eXIf` チャンク。8bit 化の前に ±0.5LSB の三角ディザ。

- [ ] **Step 1: 失敗するテストを書く**
  - resample: 一様画像の縮小で値不変、1 画素の白点を 1/2 縮小して総エネルギーが保存（±1%）。
  - naming: `formatName('{name}_{seq}', {name:'IMG_0001.CR2', seq: 3}, 'jpg')` → `IMG_0001_003.jpg`（seq は 3 桁ゼロ埋め、拡張子は元の拡張子を除く）。`{date}` は `YYYYMMDD`、未知のトークンはそのまま。
  - metadata: 生成 JPEG に `withMetadata` → exifr で読むと Model と DateTimeOriginal が一致、`stripGps: true` で GPS 無し、ICC の description が sRGB / Display P3。
  - e2e: 2 枚（1 枚は壊れたファイル）を JPEG・長辺 1024・透かし文字で `exportImages` → `saved` 1 件、`failed` 1 件（**Review Focus 5**）、保存された JPEG の寸法が 1024 の長辺。3 枚目の処理開始前に `abort()` → `cancelled: true`、保存は 2 件目まで。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3:** 実装（依存追加: `@jsquash/jpeg`, `@jsquash/png`, `piexifjs`）。リサイズ・シャープ・透かし・エンコードは `src/export/worker.ts` で実行し、GPU 現像だけメインスレッドで行う。
- [ ] **Step 4:** PASS を確認。
- [ ] **Step 5:** コミット `feat(export): 書き出しパイプライン`

---

### Task 22: UI の土台（テーマ・シェル・非対応画面・レイアウト切り替え）

**Files:**
- Create: `src/ui/theme.css`, `src/ui/Shell.svelte`, `src/ui/Unsupported.svelte`
- Modify: `src/App.svelte`, `src/main.ts`
- Test: `tests/e2e/shell.spec.ts`

**Interfaces:**
- Consumes: Task 2, Task 16, Task 17, Task 19
- Produces: `Shell.svelte`（props: `editor: Editor`, `platform: Platform`）が幅 1024px 以上で `desktop/*`、未満で `mobile/*` を表示。`theme.css` に仕様 5.2 のトークンを CSS 変数として定義。テスト用に、`window.__lumenTestBackend` が定義されていればそれを `StorageBackend` として使う（本番ビルドでは `import.meta.env.MODE === 'test'` のときだけ有効）。`App.svelte` が `detectPlatform(readEnv())` → `backend === null` なら `Unsupported`（`unsupportedReason` を表示）、そうでなければ backend を作って Shell を表示。ライブラリ方式で `requestPersistence()` が false の場合、設定メニューに「データが消える可能性」とホーム画面への追加手順を表示する。

- [ ] **Step 1: 失敗するテストを書く** — `navigator.gpu` を削除した状態（`addInitScript`）で「WebGPU」を含むメッセージが出る。1280×800 で右パネル（`data-testid="right-panel"`）が見え、390×844 で下部ツールタブ（`data-testid="tool-tabs"`）が見える。`body` の背景色が `rgb(28, 28, 28)`。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3:** 実装（依存追加: `lucide-svelte`）。
- [ ] **Step 4:** PASS を確認。
- [ ] **Step 5:** コミット `feat(ui): テーマとアプリの土台`

---

### Task 23: PC 画面（ブラウザ・フィルムストリップ・ビューア・ショートカット）

**Files:**
- Create: `src/ui/desktop/Browser.svelte`, `src/ui/desktop/Filmstrip.svelte`, `src/ui/desktop/Viewer.svelte`, `src/ui/shortcuts.ts`
- Test: `tests/unit/shortcuts.test.ts`, `tests/e2e/desktop.spec.ts`

**Interfaces:**
- Consumes: Task 15, Task 18, Task 19
- Produces: `function shortcutAction(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): Action | null`（`Action = 'next'|'prev'|'undo'|'redo'|'copy'|'paste'|'crop'|'export'|'beforeAfter'|{ rating: number }`。Mac では meta を ctrl と同等に扱う）。

- [ ] **Step 1: 失敗するテストを書く** — unit: 仕様 5.1 のショートカット表（←→、Ctrl+Z、Ctrl+Shift+Z、Ctrl+Shift+C/V、R、Ctrl+Shift+E、`\`、0〜5）を全件。e2e（fake-fs を `window.__lumenTestBackend` で注入する方式を Task 22 の App に用意しておく）: 3 枚のフィルムストリップ、→ で 2 枚目が選択、ビューアに canvas が描画され中央画素が黒でない、`\` 押下中は before、エラー画像のサムネイルに `data-error`。権限失効をシミュレートすると「アクセスを再許可」ボタンが出る。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3:** 実装（ビューア: fit / 100% 切り替え、ドラッグで移動、背景 3 種）。
- [ ] **Step 4:** PASS を確認。
- [ ] **Step 5:** コミット `feat(ui): PC 画面の閲覧と操作`

---

### Task 24: 調整パネル（スライダー・WB・HSL・グレーディング・ヒストグラム）

**Files:**
- Create: `src/ui/panels/Slider.svelte`, `BasicPanel.svelte`, `WbPanel.svelte`, `HslPanel.svelte`, `GradingPanel.svelte`, `Histogram.svelte`, `src/ui/desktop/RightPanel.svelte`
- Test: `tests/e2e/panels.spec.ts`

**Interfaces:**
- Consumes: Task 3 の `RANGES`, Task 19 の `Editor`
- Produces: `Slider.svelte` props: `{ label: string; path: string /* 'basic.exposure' */; step: number; track?: 'temp'|'tint'|`hsl-${HslBand}`; format?: (v: number) => string }`。pointerdown で `beginGesture`、pointerup で `endGesture`、ダブルクリックで既定値、数値タップで直接入力、`tabular-nums`。WB は RAW なら K 表示（`asShot` の値を初期表示）、display なら ±100。

- [ ] **Step 1: 失敗するテストを書く** — 露光スライダーをドラッグ → 1 回の undo で元に戻る。ダブルクリックで 0。数値入力 `1.5` で `params.basic.exposure === 1.5`、`9` は 5 に丸め。色温度スライダーのトラック背景がグラデーション（`background-image` が `linear-gradient` を含む）。HSL の 8 色が並ぶ。ヒストグラムの canvas が描画される。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3:** 実装。
- [ ] **Step 4:** PASS を確認。
- [ ] **Step 5:** コミット `feat(ui): 調整パネル`

---

### Task 25: トーンカーブ編集と切り抜きツール

**Files:**
- Create: `src/ui/panels/CurveEditor.svelte`, `src/ui/panels/CropTool.svelte`, `src/ui/curve-edit.ts`
- Test: `tests/unit/curve-edit.test.ts`, `tests/e2e/crop.spec.ts`

**Interfaces:**
- Consumes: Task 7 の `monotoneSpline`、Task 15 の `maxInscribedCrop`, `constrainCrop`, `aspectValue`
- Produces:
  ```ts
  function addPoint(pts: CurvePoint[], x: number, y: number): CurvePoint[]      // x でソート、端点は固定 x、最大 16 点
  function movePoint(pts: CurvePoint[], i: number, x: number, y: number): CurvePoint[]  // 隣の点の x を越えない（0.01 の余白）
  function removePoint(pts: CurvePoint[], i: number): CurvePoint[]               // 端点は削除不可
  ```
- [ ] **Step 1: 失敗するテストを書く** — unit: 上の 3 関数の境界（17 点目は追加されない、端点の削除は無視、移動は隣を越えない）。e2e: 切り抜きで縦横比 1:1 を選ぶと枠が正方形（向き補正後のピクセルで）、角度 10° で枠が画像内に収まる、R キーで切り抜きモード、Enter で確定し params.crop が更新される。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3:** 実装（カーブは RGB/R/G/B タブとパラメトリック 4 スライダー＋分割点 3 つ）。
- [ ] **Step 4:** PASS を確認。
- [ ] **Step 5:** コミット `feat(ui): トーンカーブと切り抜き`

---

### Task 26: プリセット・設定のコピー＆ペースト・書き出しダイアログ

**Files:**
- Create: `src/ui/dialogs/PresetList.svelte`, `src/ui/dialogs/CopySettings.svelte`, `src/ui/dialogs/ExportDialog.svelte`
- Test: `tests/e2e/dialogs.spec.ts`

**Interfaces:**
- Consumes: Task 5, Task 19, Task 21
- Produces: 書き出し設定は最後に使った値を `localStorage`（try/catch で包む）に保存。プリセットは「現在の設定から作成（グループ選択）」「読み込み（JSON）」「書き出し（JSON）」「削除（組み込みは不可）」。

- [ ] **Step 1: 失敗するテストを書く** — コピーダイアログの初期チェックで WB と切り抜きがオフ、他がオン。2 枚選択してペースト → 2 枚のサイドカーが更新。組み込み「モノクロ」を適用 → 出力の中央画素が R=G=B。プリセット作成 → 一覧に出る → JSON 書き出し → 読み込みで同じ内容。書き出しダイアログで進捗が表示され、キャンセルボタンで止まる、終了時に失敗一覧が出る。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3:** 実装。
- [ ] **Step 4:** PASS を確認。
- [ ] **Step 5:** コミット `feat(ui): プリセット・コピペ・書き出し`

---

### Task 27: iPhone 画面（一覧・編集・ジェスチャー・共有）

**Files:**
- Create: `src/ui/mobile/Grid.svelte`, `src/ui/mobile/Editor.svelte`, `src/ui/mobile/ToolTabs.svelte`, `src/ui/mobile/gestures.ts`
- Test: `tests/unit/gestures.test.ts`, `tests/e2e/mobile.spec.ts`（`webkit-layout` と `chromium-webgpu` の iPhone 15 エミュレーション）

**Interfaces:**
- Consumes: Task 17, Task 19, Task 22, Task 24〜26 のパネル部品（そのまま再利用）
- Produces:
  ```ts
  type Gesture = { kind: 'pinch'; scale: number; cx: number; cy: number } | { kind: 'pan'; dx: number; dy: number }
               | { kind: 'longPressStart' } | { kind: 'longPressEnd' } | { kind: 'swipe'; dir: 'left'|'right' };
  class GestureRecognizer { constructor(onGesture: (g: Gesture) => void, opts?: { longPressMs?: number /*=350*/; swipeMinPx?: number /*=60*/ });
                            pointerDown(e: PointerEventLike): void; pointerMove(e): void; pointerUp(e): void }
  ```
- [ ] **Step 1: 失敗するテストを書く** — unit: 2 点が離れると pinch scale > 1、1 点 350ms 静止で longPressStart、指を離すと longPressEnd、横 80px の素早い移動で swipe。拡大中（scale > 1）は swipe を出さず pan にする。e2e（390×844）: ＋ボタンで取り込み（`setInputFiles`）→ グリッドに出る → タップで編集画面 → タブ「ライト」で露光スライダーが見え、すべてのボタンの境界ボックスが 44×44 以上 → 長押しで before 表示 → 共有ボタンで `navigator.share` スタブが File 付きで呼ばれる。取り込みで HEIC 名の JPEG を渡すと「『ファイル』から選ぶと…」の案内が出る。
- [ ] **Step 2:** FAIL を確認。
- [ ] **Step 3:** 実装。
- [ ] **Step 4:** PASS を確認。
- [ ] **Step 5:** コミット `feat(ui): iPhone 画面`

---

### Task 28: PWA・公開・ベンチマーク・実機チェックリスト

**Files:**
- Create: `public/manifest.webmanifest`, `public/icons/*`, `scripts/bench.ts`, `tests/e2e/bench.spec.ts`, `docs/iphone-checklist.md`, `README.md`
- Modify: `vite.config.ts`（`vite-plugin-pwa`）

**Interfaces:**
- Produces: `npm run bench` → プレビュー（長辺 2560）の現像時間の中央値と、24MP 合成 RAW 相当（Uint16 6000×4000）の open → 初回描画時間を表示。

- [ ] **Step 1:** `vite-plugin-pwa` でアプリ本体（WASM 含む）をプリキャッシュし、オフラインで起動できるようにする。manifest: `name: "Lumen"`, `display: "standalone"`, `background_color/theme_color: "#1C1C1C"`, アイコン 192/512 と apple-touch-icon（シンプルな絞り羽根の図形、自作 SVG から生成）。
- [ ] **Step 2: テストを書く** — e2e: オフラインにしてリロードしてもアプリが起動する。bench: 目標値（16ms / 3s）を超えたら警告として出力（CI を落とさない。合成環境の SwiftShader は遅いため数値は参考扱い）。
- [ ] **Step 3:** FAIL を確認 → 実装 → PASS を確認。
- [ ] **Step 4:** `docs/iphone-checklist.md` を作成: 「写真」からの取り込み（HEIC / ProRAW / 48MP がオリジナルのまま来るか）、「ファイル」からの取り込み、共有シートで写真アプリへ保存、ホーム画面に追加後の起動とデータ保持、アプリ切り替え後の GPU 復帰、48MP の書き出し完走、スライダーの体感速度、各ボタンの押しやすさ。各項目に期待結果と記入欄。
- [ ] **Step 5:** `README.md` に、ローカル開発手順、テスト実行、Cloudflare Pages への無料公開手順（GitHub 連携、ビルドコマンド `npm run build`、出力 `dist`、`_headers` が反映されることの確認方法）、実機写真テストの有効化方法（`test-assets/` に置くファイル名）を書く。
- [ ] **Step 6:** `npm test` と `npm run e2e -- --trace off` の全件、`npm run build` を実行し、すべて成功することを確認。
- [ ] **Step 7:** コミット `feat: PWA 対応・ベンチマーク・実機チェックリスト`
- [ ] **Step 8: チェックポイント（ユーザー作業）** — ユーザーに公開版を iPhone で開き `docs/iphone-checklist.md` を実施してもらう。結果をもとに上限値・文言を調整する。
