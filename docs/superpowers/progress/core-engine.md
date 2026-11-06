# SDD ledger — plan: docs/superpowers/plans/2026-11-06-core-develop-engine.md
Spec: docs/superpowers/specs/2026-11-06-core-develop-engine-design.md
Branch: feat/core-engine (BASE main 72ee045)

## Pre-flight
| tasks | produces vs consumes | finding |
|---|---|---|
| 3→4,5 | DevelopParams/defaultParams/clampParams | ok |
| 4↔5 | deepDiff/deepMerge defined in partial.ts during Task 4, extended Task 5 | ok (Task 4 creates partial.ts) |
| 6→7,9 | Mat3/Vec3 types in color/spaces.ts; decode/types imports them | ok |
| 7→13,14 | buildUniforms/packUniforms/developPixel(rgb, baseLum, u, luts) | ok |
| 9,10→11 | DecodedImage/WorkingImage, decodeRaw/decodeDisplay/decodeHeic | ok |
| 12→13,14,15 | Gpu, GpuImage, uploadRgb16 | ok |
| 13→15 | DevelopPass.run(..., sample: SampleTransform) — SampleTransform defined Task 15 | Ruling: define SampleTransform type in engine/geometry.ts during Task 13 (identity helper), Task 15 adds sampleTransform() — avoids forward reference — cost: none |
| 15→19,20 | Renderer.setImage throws GpuOutOfMemoryError; renderTileFull | ok |
| 16→17,18,19,21 | StorageBackend, ImageRef, runStorageContract | ok |
| 21 | ExportSettings.watermark union: `{text}|{image} & {...}` precedence makes position apply only to image | Ruling: type as `null | (({kind:'text';text}|{kind:'image';image}) & {position,size,opacity})` — matches spec 6 (both kinds have position/opacity) — cost: none |
| 22→23,27 | window.__lumenTestBackend injection | ok |

Task 1: Ruling: APP_ID lives in src/app-id.ts and is re-exported from main.ts — importing main.ts in Vitest would mount Svelte into a missing DOM — cost if wrong: none
Task 1: Ruling: no `webkit-layout` Playwright project — WebKit browser is not preinstalled in this environment and the environment says not to run `playwright install`; layout/mobile tests use Chromium with iPhone viewport emulation, OPFS contract runs in Chromium only, iPhone specifics go to docs/iphone-checklist.md (Task 28) — cost if wrong: Safari-only layout/OPFS bugs found later on device
Ledger mirror: docs/superpowers/progress/core-engine.md is a committed copy of this ledger (survives container loss) — user approved resume plan
Task 1: complete (commits 72ee045..9af56e8, tests: sh -c 'npx vitest run && npx playwright test --trace off' →   1 passed (2.7s))
