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
Parallel: Ruling: run track A (Tasks 2-7, subagent, branch feat/track-a) and track C (Tasks 16-17, subagent, branch feat/track-c) in parallel with me on track B (Tasks 8-11) — user approved — cost: merge work
Parallel: Ruling: shared types (DevelopParams, DeepPartial, SourceInfo, Preset, HSL_BANDS) committed up front in src/params/types.ts; sidecar.ts/presets.ts/partial.ts re-export them instead of defining — lets C compile against Preset/SourceInfo without A's branch — cost: none
Parallel: Ruling: Task 18 (thumb cache) moves from track C to me after Task 11 — it consumes Decoder.preview from track B — cost: none
Task 2: complete (track A, commit 72c5f6a, tests: vitest platform → 6 pass)
Task 3: complete (track A, commit aa13add, tests: vitest params-defaults → 7 pass)
Task 4: complete (track A, commit 410f732, tests: vitest sidecar → 12 pass)
Task 5: complete (track A, commit a89866f, tests: vitest partial+presets → 16 pass)
Task 6: complete (track A, commit c74a87b, tests: vitest color-spaces+wb+oklab → 21 pass)
Task 7: complete (track A, commit 3a73326, tests: vitest spline+tone+hsl+pipeline → 31 pass)
Task 16: complete (track C, commit b412a3f, tests: vitest names+folder → 45 pass)
Task 17: complete (track C, commit f861eba, tests: vitest 78 pass; e2e library.spec → 5 pass)
Merge A+C into feat/core-engine: tsc clean, vitest 171/171, e2e 6/6
Task 1(fix): Ruling: process typed both by `declare const process` (A) and @types/node (C); both kept, harmless — cost: none
Task 2: Ruling: iOS = UA iPhone/iPad/iPod or Macintosh+maxTouchPoints>1; no WebGPU checked first — cost: one regex
Task 3: Ruling: clampParams clamps wb.temp to [-100,50000], tint ±150 (keeps 0 sentinel and display ±100); clampWb(wb, kind) does type-aware clamp; RANGES adds wb.tempRel/tintRel — cost: callers must use clampWb when kind known
Task 3: Ruling: clampParams also sanitizes NaN, sorts/clamps curve points and splits, resets unknown aspect/mode — cost: none
Task 4: Ruling: deepMerge follows base shape, ignores unknown/mistyped keys, arrays replaced whole — cost: none
Task 4: Ruling: fromSidecar: schema must be int>=1; older schema without migration throws; newer → readOnly best effort; rating clamped 0..5; bad source → null; sourceChanged compares size+mtime only — cost: small
Task 5: Ruling: pickGroups copies whole groups including default values (paste resets to source) — cost: pasted defaults
Task 5: Ruling: pruneToShape added; preset file format {app:'lumen',type:'preset',schema:1,name,params}; foreign app rejected; builtin never read; built-in values chosen by implementer (モノクロ = saturation −100) — cost: tune values
Task 6: Ruling: plan test "cctTintToXy(6504,0)≈D65" contradicts Kim Planck locus (D65 is Duv +0.0032 off locus); kept formula, tested D65 round trip (≈6504K, tint≈+32) instead — cost: one-constant offset if tint 0 should equal D65
Task 6: Ruling: tint sign: positive tint = illuminant green side (Duv+) → image toward magenta (matches spec slider green→magenta and Lightroom), overriding plan's "正 = Duv 負" — cost: flip TINT_DUV sign
Task 6: Ruling: OKLab M1 composed with REC2020_TO_XYZ and row-normalized so white → a=b=0 exactly — cost: none
Task 7: Ruling: Uniforms pre-scaled for shader; kind 1=raw 0=display; UNIFORM_FLOATS=104 (416 B); offsets in src/color/uniforms.ts header — cost: re-pack
Task 7: Ruling: RAW wbMul normalized min=1, clip at 1; camToWork composed incl. Bradford illuminant→D65; custom WB only when temp>0; highlight desat smoothstep(0.8,1,min) — cost: highlight look
Task 7: Ruling: stages 4/5 are luminance gains in log2; highlights only for base ≥0.09 (pixels <0.05 exactly unchanged) — cost: retune
Task 7: Ruling: curves applied per channel on sRGB-OETF-encoded Rec.2020 with slope-1 extension outside 0..1 — cost: R curve leaks slightly into sRGB G/B
Task 7: Ruling: parametric curve → control points + Fritsch–Carlson, baked into luts.tone; order tone→rgb→r/g/b — cost: look only
Task 7: Ruling: HSL centres in OKLab hue deg (25,55,105,142,195,264,294,328), smoothstep tents; hue shift ±30°; vibrance skin protection 50°±25°; grading σ=1 ↔ chroma 0.1 — cost: retune
Task 7: Ruling: dither excluded from developPixel (deterministic parity); added at 8-bit quantization in Task 13/21 — cost: none
Task 16: Ruling: added @types/node@22 dev + tests/e2e/node.d.ts — cost: Node globals visible to src typecheck
Task 16: Ruling: saveExport returns Promise<string> (plan) — cost: none
Task 16: Ruling: readSidecar throws CorruptSidecarError on bad JSON; caller (Task 19) must catch → quarantineSidecar — cost: Task 19 must handle
Task 16: Ruling: repeated quarantine never overwrites earlier .bak (a.jpg.json.bak, a.jpg.json-2.bak) — cost: none
Task 16: Ruling: FolderBackend holds one root folder; addSource replaces it; id = <root>/<relpath> — cost: multi-root later needs rework
Task 16: Ruling: dot-folders skipped; ids validated (no .., root match, image name) — cost: none
Task 16: Ruling: HandleStore {get,set} keys root/export/presets; idbHandleStore() in handles.ts (untested in Node); setExportDir/setPresetDir(handle) — cost: small
Task 16: Ruling: shared helpers in src/storage/fs.ts (DirectoryPresetStore, writer, quarantine, unique save); preset identity = JSON name; no preset dir → empty list / StorageError('no-preset-dir') on save — cost: none
Task 16: Ruling: runStorageContract(runner{test,expect}, makeSubject) reusable in Vitest and browser — cost: none
Task 17: Ruling: e2e harness bundled in beforeAll via vite build() and served by page.route under /__e2e/; not in dist — cost: spec update if vite API changes
Task 17: Ruling: OPFS preset filenames ASCII-only (Chromium OPFS rejected non-ASCII names) — cost: none
Task 17: Ruling: library saveExport de-dupes names per instance; share() then <a download> fallback — cost: low
Task 17: Ruling: addSource() stores ImportResult in backend.lastImport (interface returns void) — cost: none
Task 17: Ruling: import writes meta.json last; list skips folders without meta; QuotaExceeded mid-write removes partial and rejects 'quota'; original stored as original.<lower ext> — cost: none
Task 17: Ruling: looksTranscoded false for empty/octet-stream type; RAW ext counts transcoded only for display MIME types — cost: iOS conversion with empty type undetected
Task 17: Ruling: sync-access fallback writes .tmp then move(); without move() rewrites in place — cost: brief window where only .tmp holds data
Task 8: Ruling: raw.pixls.us has no D5300; registered D5200 NEF (same generation 24MP Nikon) as key nikon-d5200-nef; Task 10's D5300 test uses it with model "D5200" and long edge 6000±8 — cost: D5300-specific quirk undetected until user supplies a file
Task 8: Ruling: no redistributable iPhone HEIC found; iphone-heic key not registered; HEIC tests rely on test-assets/ — cost: HEIC decode untested until real file
Task 8: Ruling: fixtures generated by tests/fixtures/make-fixtures.py (Pillow) and committed, instead of a TS generator — writing JPEG+EXIF in Node needs extra deps — cost: none
Task 8: Ruling: npm run samples uses NODE_USE_ENV_PROXY=1 (Node fetch ignores proxy otherwise); environment "lumen" created with raw.pixls.us allowed (user approved card) — cost: none
Task 8: complete (commits 97bc070..3f6d544, tests: npm run -s samples → ✓ bayer-dng 10533870 bytes )
Task 9: Ruling: Chromium ignores createImageBitmap imageOrientation:'none' and applies EXIF orientation; decodeDisplay probes once with an embedded 2x1 orientation-6 JPEG and, when the browser rotates, returns upright pixels with orientation 1 (pixels/orientation always consistent, spec 2.3). Plan test "orientation===6 and 40x20" rewritten to accept either consistent pair — cost: none for crop math (crop is relative to upright image either way)
Task 9: Ruling: added src/decode/encoded.ts (rgba8ToLinear2020) shared by display/heic, and tests/e2e/helpers/harness.ts (generic vite-build harness serving tests/fixtures, .samples, test-assets under /__e2e/files/) — cost: none
Task 9: Ruling: libheif-js loaded lazily via dynamic import of libheif-bundle.mjs (2 MB) so it stays out of the main bundle; HEIC P3 assumed when ICC says P3 or Make==Apple; libheif output orientation 1 (irot applied) — cost: non-Apple sRGB HEIC with P3-less ICC still correct
Task 9: Ruling: synthetic HEIC fixture (pillow-heif) + libheif-path e2e added beyond plan; written after the implementation existed (passed first run) — test-after for that one case — cost: weaker proof for HEIC path
Task 9: complete (commits 3f6d544..c9616e9, tests: sh -c 'npx tsc -p . && npx vitest run && npx playwright test --trace off' →   10 passed (5.6s))
Task 10: Ruling: adopted npm libraw-wasm@1.6.0 (ISC; meets a–f) instead of self-building; color_data only with metadata(true) — see docs/decisions/libraw-wasm.md — cost: self-build later if new cameras/JXL needed
Task 10: Ruling: LibRaw outputs slightly larger than nominal (20D 3522-ish vs 3504); dimension tolerance widened ±8 → ±40 — cost: none
Task 10: Ruling: camToXyz fallback chain cam_xyz → DNG ColorMatrix (D65-nearest illuminant) → SRGB_TO_XYZ·rgb_cam; neutral from DNG AsShotNeutral → cam_mul → pre_mul; added as-shot CCT 2500–10000K sanity check to every RAW test (catches matrix orientation errors) — cost: none
Task 10: Ruling: bayer DNG without embedded JPEG → extractRawPreview returns null (Task 11 preview falls back to downscaled decode) — cost: none
Task 10: Ruling: JPEG XL compressed DNG unsupported by bundled LibRaw (placeholder only); added Task 10b to the plan, deferred until a sample exists — cost: iPhone 16 Pro+ JXL ProRAW cannot be opened in v1 (clear error)
Task 10: complete (commits 05229c2..27b332b, tests: sh -c 'npx tsc -p . && npx vitest run && npx playwright test --trace off' →   15 passed (18.7s))
Task 11: Ruling: e2e harness now writes its build to dist/__e2e/<name>/ (served by vite preview) instead of in-memory + page.route — requests from a worker spawned inside a worker (libraw-wasm) bypass page.route, so RAW decode inside the decode worker hung in tests only — cost: dist/ contains __e2e after running e2e; always deploy from a fresh `npm run build` (it empties dist)
Task 11: Ruling: switched to libraw-wasm-nothread@1.6.0-nothread.1 (ISC, single-thread fork, same API) — no SharedArrayBuffer/pthread pool inside a nested worker, less memory on iPhone — cost: slower RAW demosaic on multi-core PCs
Task 11: Ruling: added src/decode/decode-any.ts (format dispatch + DecodeError in worker) and src/decode/preview.ts (embedded JPEG → browser resize; RAW without JPEG → CPU develop with defaultParams via developPixel) — cost: none
Task 11: Ruling: working image pixels are a copy when no downscale is needed so the full-res buffer stays in the worker (transfer would detach it) — cost: one extra copy for small images
Task 11: complete (commits 27b332b..cdf9819, tests: sh -c 'npx tsc -p . && npx vitest run && npx playwright test --trace off' →   21 passed (17.5s))
## Track engine (branch feat/track-engine, NOT YET MERGED into feat/core-engine)
Task 12: complete (track engine, commit e45cd31, tests: gpu-upload.spec 5/5)
Task 13: complete except Step 7 user checkpoint (track engine, commit 582e144, tests: develop-parity 85 cases worst 0.011/512, gpu-check.spec)
Task 14: complete (track engine, commit 28cfa17, tests: baselayer 4/4, localtone.spec 2/2; track total vitest 176, e2e 17)
Track engine fix: commit 1416a7d applyGrading clamped OKLab L>=0 even at defaults (changed out-of-gamut RAW pixels) — removed clamp in TS+WGSL, tests/unit/grading.test.ts RED→GREEN
Task 12: Ruling: upload in row batches ≤ min(64 MiB, maxStorageBufferBindingSize); uploadRgb16 optional {chunkBytes} for tests — cost: none
Task 12: Ruling: mips are plain 2x2 average, odd last row/col dropped — cost: slight edge bias at small mips
Task 12: Ruling: createGpu requests adapter max for maxTextureDimension2D/maxBufferSize/maxStorageBufferBindingSize/maxComputeWorkgroupStorageSize; throws Error('WebGPU を初期化できません') with cause — cost: none
Task 12: Ruling: readTexture returns as many channels as the format has — cost: none
Task 13: Ruling: SampleTransform maps absolute out-texel centre (x+.5,y+.5) → input UV (whole image, pre-orientation/crop) with projective divide; outRect only limits writes — cost: Task 15/20 compose translation
Task 13: Ruling: manual bilinear (4 textureLoad) for source and base layer, deterministic across GPUs — cost: ~3 loads/pixel
Task 13: Ruling: GPU atan2/sin/cos in HSL replaced by series approximations (built-ins were off 0.67/512) — cost: few FMAs
Task 13: Ruling: shader constants generated from TS values at build; SKIN_COS/SIN/EDGE exported from hsl.ts — cost: none
Task 13: Ruling: default-valued stages skipped via uniform branches and identity-LUT mask — cost: none
Task 13: Ruling: output formats rgba8unorm/rgba16float/rgba32float; only rgba8unorm adds ±1/255 triangular hash dither; parity on rgba32float; bgra8unorm canvas left to Task 15 — cost: Task 15 may need blit
Task 13: Ruling: gpu-check HTML moved to dist/gpu-check/index.html in generateBundle hook; page accepts ?size=N; SwiftShader ~1092 ms per 2048² (software, not indicative of iPhone) — cost: re-check hook on Vite changes
Task 14: Ruling: base layer r32float (core WebGPU lacks r16float storage write) — cost: none
Task 14: Ruling: self-guided filter on log2(max(Y,2^-20)) after stages 1–3, eps 0.01, r=max(1,round(0.02·long edge)), clamped box windows, base long edge 512 (or image size), source = smallest mip ≥512 resampled — cost: look retune
Task 14: Ruling: base layer depends on WB/exposure → LocalTonePass.build must rerun when they change (reuses texture) — cost: Task 15 Renderer must rebuild on WB/exposure change
Task 14: Ruling: stages 1–3 factored to linearStages (TS) and common.wgsl — cost: none
Tests(engine): Ruling: tests/e2e/harness/serve.ts + engine-harness.ts (in-memory route approach) — NOTE on merge: my Task 11 ruling moved tests/e2e/helpers/harness.ts to dist/__e2e; engine's serve.ts still uses page.route, fine unless nested workers needed — cost: two harness helpers to unify later
Resume: scheduled self-message 2026-11-06 14:50 JST (trigger trig_01AdqemEqe4gAkwbFZR4fAE7) — next: merge feat/track-engine, then Task 15 (and Task 18 thumbs), Task 13 Step 7 user checkpoint pending
Resume 2026-11-06 14:50 JST: merged feat/track-engine into feat/core-engine — tsc clean, vitest 193/193, e2e 32 pass 1 skip
Parallel(resume): Ruling: subagent track S does Task 18 + 19 (branch feat/track-store); I do Task 15, 20, 21. GpuOutOfMemoryError pre-committed in src/engine/errors.ts (renderer.ts re-exports) so Task 19 compiles without Task 15 — cost: none
Task 15: Ruling: crop frame = rotated frame about oriented-image centre; angle>0 rotates the image clockwise on screen; aspect '3:2' etc follow image orientation (landscape → wide) — cost: sign flip if UI expects opposite
Task 15: Ruling: Renderer.setImage is async (popErrorScope) and rejects GpuOutOfMemoryError (dims > maxTextureDimension2D or OOM scope); told track S — cost: none
Task 15: Ruling: ViewState gains `viewport {w,h}` (device px); fit mode sizes the canvas to the cropped aspect capped at previewCap; '100' mode = 1 full-res px per device px; `background` is UI-only; `before` = defaultParams with current crop — cost: none
Task 15: Ruling: Renderer adds renderNow() (awaits GPU), snapshot() (RGBA8 readback for tests), whenReady() (device-loss recovery; recreateGpu option) — cost: none
Task 15: Ruling: canvas configured rgba8unorm (copyTextureToTexture from the rgba8 storage output); colorSpace display-p3 when outSpace 'p3' — cost: none
Task 15: Ruling: headless SwiftShader loses the device on WebGPU canvas getCurrentTexture unless Chromium gets `--use-vulkan=swiftshader --enable-unsafe-swiftshader`; added to playwright.config.ts + README — cost: none (test env only)
Task 15: Ruling: develop.wgsl dither skipped for pixels at 0 or 1 (clipped) so histogram clip counts are exact — found by histogram test (RED 1022/1024 → GREEN) — cost: none
Task 15: Ruling: renderTileFull is NOT added here; Task 20 adds it with its own tests — cost: none
Task 15: complete (commits 77ad82c..46b8583, tests: sh -c 'npx tsc -p . && npx vitest run && npx playwright test --trace off' →   37 passed (29.6s))
Task 18: complete (track S, commit 7bcd9ad, tests: vitest thumbs 9/9, e2e thumbs.spec 3/3)
Task 19: complete (track S, commit 7b07c8c, tests: vitest history 8 + editor 25; branch total vitest 235, e2e 29)
Merge track S: tsc clean, vitest 246, e2e 40 pass 1 skip
Task 18: Ruling: ThumbCache optional 4th arg store {get,set,del}; default idbThumbStore (DB lumen-thumbs); memoryThumbStore for tests — cost: none
Task 18: Ruling: one record per image keyed `${kind}:${id}` holding {key: thumbKey(ref), blob}; mismatch → rebuild/overwrite; invalidate deletes — cost: none
Task 18: Ruling: concurrency 2 covers readOriginal+preview; duplicate in-flight refs share a job; IndexedDB errors ignored (thumb still returned) — cost: rebuilds when IDB unavailable
Task 18: Ruling: e2e thumbs.spec written after implementation (test-after); unit tests were fail-first — cost: weaker proof for idb path
Task 19: Ruling: RendererPort {setImage(): Promise<void>; render()}; GpuOutOfMemoryError → close handle, halve workCap down to MIN_WORK_CAP 512, notice '解像度を下げて表示しています', then decodeError — cost: none
Task 19: Ruling: all logic in editor.svelte.ts with $state.raw for params/images/view/working (structuredClone-safe) — cost: none
Task 19: Ruling: EditorDeps narrowed (decoder Pick open|close, platform Pick workCap) — cost: none
Task 19: Ruling: Editor adds view/setView, handle, working, canUndo/canRedo — cost: none
Task 19: Ruling: per-image History/state kept in memory for the session; reopening doesn't reread sidecar — cost: external sidecar edits mid-session unseen
Task 19: Ruling: saves serialized per image; edits during write trigger a follow-up write; open(B) awaits A's pending/running save, errors don't block switch — cost: none
Task 19: Ruling: failed save retries after 5 s or next debounced edit; saveError shows first failing image — cost: none
Task 19: Ruling: non-corrupt sidecar read error → defaults, read-only, notice; quarantine failure → read-only (never overwrite unread sidecar) — cost: no saving until fixed
Task 19: Ruling: update runs clampParams; readOnly allows edits but no save; rating saved but not in Undo; resetAll resets all groups incl. crop/WB (undoable) — cost: one line if crop should survive reset
Task 19: Ruling: paste/applyPreset use per-image state (enter Undo); read-only/failed writes reported in `failed`; applyPreset without ids = current image — cost: none
Task 19: Ruling: concurrent open() — only latest applies; stale handles closed — cost: none
Merge fix: Ruling: editor ViewStateLike lacked Renderer's required `viewport` → would crash Renderer.draw at runtime (tsc missed it via method bivariance); ViewStateLike = ViewState, default viewport {1,1}; test 'Renderer に渡す表示状態' RED→GREEN — cost: none
Task 20: Ruling: tiles are cut in OUTPUT space; each renders a full-res frame region (core + margin max(32, ceil(3·frame px per output px)+2)) ≤ TILE, then Task 21 Lanczos-resamples — spec 6 says full-res develop then Lanczos; plan's "長辺 2048 → タイル 1 枚" assumed output-res rendering, so that assertion became "every frame ≤ TILE, cores cover output" — cost: more tiles for small exports
Task 20: Ruling: TilePlan = {frame (full-res crop-frame px incl. margin), src (stored-pixel bbox +2px), core (output px)} replacing plan's {src, core, outOffset}; planTiles returns {outW,outH,scale,tiles} and takes {tile, overlap} opts for tests — cost: none
Task 20: Ruling: geometry gains frameMatrix (frame px → UV, exact, no rounding), matMul/matTranslate/matScale; sampleTransform now composes on frameMatrix (tests unchanged) — cost: none
Task 20: Ruling: renderTileFull(p, tile{data,rect}, frame, out) — frame param added; returns RGBA float (encoded, no dither); develop Pass uniform gains bmap (PASS_BYTES 80→96) so the shared whole-image base layer is sampled at whole-image UV from tile UV — cost: none
Task 20: complete (commits 223cf10..19f181c, tests: sh -c 'npx tsc -p . && npx vitest run && npx playwright test --trace off' →   42 passed (32.4s))
Task 21: Ruling: resampling is per tile: resampleTile(frameRGBA, frame, core, sx, sy) → core RGB (replaces plan's lanczos3Into signature); unsharp applied per tile on core+margin (planTiles outMargin opt) then dithered to 8-bit into an output-size RGBA8 buffer — avoids a 576 MB float buffer for 48 MP on iPhone (spec 3.4) — cost: none
Task 21: Ruling: export worker protocol begin/tile/finish; GPU develop stays on main thread; withMetadata is async (PNG iCCP via CompressionStream) — cost: none
Task 21: Ruling: ICC profiles embedded as base64 constants (src/export/icc/profiles.ts generated from saucecontrol Compact-ICC-Profiles sRGB-v4/DisplayP3-v4, CC0) instead of ?inline asset imports — works in Vitest and build alike — cost: regenerate if profiles change
Task 21: Ruling: exportImages deps take dedicated decoder/renderer instances (the decode worker holds one image; sharing would evict the editor's image) — UI must create separate ones — cost: extra GPU memory during export
Task 21: Ruling: unreadable/corrupt sidecar during export → that image fails (not silently exported with defaults) — cost: none
Task 21: Ruling: EXIF date written from local Date getters (inverse of exifr revive); seq 3-digit; filename chars \/:*?"<>| and controls → _ ; JPEG sharpen/watermark covered by e2e only (no separate unit tests) — cost: weaker unit coverage for sharpen/watermark
Task 21: complete (commits f07f08f..74032d8, tests: sh -c 'npx tsc -p . && npx vitest run && npx playwright test --trace off' →   44 passed (36.5s))
Task 25: partial — src/ui/curve-edit.ts (addPoint/movePoint/removePoint, MAX_POINTS 16, GAP 0.01, points closer than 0.01 in x are not added) done with unit tests 7/7; CurveEditor/CropTool components wait for UI shell (track UI)
Task 28: partial — PWA (vite-plugin-pwa MIT, icons self-drawn), pwa.spec 2/2, bench (BENCH=1 only; SwiftShader preview 1069 ms median, 24MP first draw 2446 ms), docs/iphone-checklist.md, README deploy steps; final full-suite run pending after UI merge. Ruling: bench spec skipped unless BENCH=1 to keep the suite fast — cost: none
Task 22: complete (track UI, commit 4af4072, tests: shell.spec 7/7)
Task 23: complete (track UI, commit 09aae3c, tests: vitest shortcuts 20, desktop.spec 10)
Task 24: complete (track UI, commit 5082eb5, tests: vitest wb-panel 6, panels.spec 8; branch vitest 273, e2e 59)
Merge track UI (package.json conflict: kept lucide-svelte + piexifjs): tsc clean, svelte-check 0/0, vitest 297, e2e 71 pass 2 skip
Task 22: Ruling: useAppHarness(name) builds the app in mode 'test' from tests/e2e/harness/app.html into dist/__e2e/app-<spec>/ with a fake FolderBackend on window.__lumenTestBackend; production build strips the hook (tested) — cost: one vite build per spec
Task 22: Ruling: test builds expose window.__lumenApp {app, editor, renderer, backend} — cost: none
Task 22: Ruling: Shell takes {app: App} (App owns platform, backend, editor, renderer, shared canvas, thumbs; passed via context) — cost: small signature change vs plan
Task 22: Ruling: createGpu failure → Unsupported screen with reason — cost: none
Task 22: Ruling: mobile shell is a placeholder (top bar, settings, banner, add button, 7 inert tool tabs) until Task 27 — cost: no iPhone editing until Task 27
Task 22: Ruling: StatusBanner shows saveError (sticky), corrupted/.bak, read-only, sourceChanged, notice, import messages; settings menu shows storage mode and persistence warning with red dot — cost: none
Task 22: Ruling: --tap 44px on buttons; slider number button 24px inside a ~48px row — cost: Task 27 may enlarge on mobile
Task 23: Ruling: `¥` also toggles before/after; Shift+R = crop; Ctrl+C/V/R/E without Shift and Ctrl+digit are not captured — cost: none
Task 23: Ruling: Ctrl+Shift+C/V use DEFAULT_COPY_GROUPS directly (no dialog yet); R toggles app.tool; Ctrl+Shift+E bumps app.exportRequested — Task 25/26 must hook these — cost: rewiring run()
Task 23: Ruling: lazy thumbnails via visibility; failed thumbs/decodes get data-error — cost: none
Task 23: Ruling: filmstrip ratings only for images opened this session (app.ratings) — cost: unvisited images show no stars
Task 23: Ruling: viewer canvas object-fit contain; ResizeObserver device-px viewport → setView; double-click toggles fit/100% around point; 100% pan moves cx/cy by drag px / full-res cropped size — cost: none
Task 23: Ruling: left browser filters by group; arrow keys & shift-range within filtered list — cost: none
Task 24: Ruling: Slider extra props range/get/set/resetTo/disabled and 'hue' track; hsl-<band> track shows h/s/l gradient by path suffix — cost: none
Task 24: Ruling: relative drag (no jump), click without move records nothing, snap to step, full-width digit input, arrow keys stopPropagation — cost: no click-to-jump
Task 24: Ruling: WB UI: RAW in K/tint (2000–50000, ±150) shown from asShotCctTint in asShot mode; display ±100; slider move → custom; returning to as-shot stores {asShot,0,0}; RAW without matrix falls back to 6500 K — cost: tint 0 ≠ D65 (Task 6)
Task 24: Ruling: grading via per-region H/S/L sliders + swatch, no colour wheels — cost: later UI upgrade
Task 24: Ruling: histogram refresh 120 ms after change + 2 rAF; end bins ignored for scale; clip boxes with % tooltip — cost: ~150 ms lag
Task 24: Ruling: right panel 「すべてリセット」; tone curve/crop sections show 「準備中です」 until Task 25 — cost: none
Tests: Ruling: harness.ts exports routeFiles() (refactor) — cost: none
Task 25: Ruling: crop tool works on app.cropDraft (not params) and shows the WHOLE frame (crop 0,0,1,1 at the draft angle) via new Editor.setPreviewCrop (preview-only override, not saved/undone, cleared on open) — Lightroom-like context around the frame; Enter commits as one undo step, Esc cancels, switching image cancels — cost: rotated-corner areas outside the image show edge-clamped pixels under the dark mask
Task 25: Ruling: changing angle refits the largest inscribed frame at the current aspect (Lightroom behaviour); changing aspect refits maxInscribedCrop; handle drags keep the aspect and are constrained by constrainCrop; entering crop forces fit view — cost: none
Task 25: Ruling: angle control = range + number input (spinbutton '角度'); aspect buttons 元画像/自由/1:1/4:5/3:2/16:9; crop section opens automatically in crop mode — cost: none
Task 25: Ruling: curve editor: RGB/R/G/B tabs (role tab), click adds point, drag moves (one gesture), dblclick removes, parametric 4 sliders + 3 split sliders (min gap 0.05) — cost: none
Task 25: Ruling: e2e test fixes (scrollIntoView before clicking the curve; exact tab name) were test-side issues — cost: none
Task 25: complete (commits 142cd59..53bfe8a, tests: sh -c 'npx tsc -p . && npx svelte-check --tsconfig ./tsconfig.json --threshold error && npx vitest run && npx playwright test --trace off' →   75 passed (1.2m))
