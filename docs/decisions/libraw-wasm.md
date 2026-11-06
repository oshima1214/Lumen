# LibRaw の WASM ビルドの選定（Task 10）

採用: npm `libraw-wasm@1.6.0`（ISC。中身の LibRaw は LGPL-2.1 / CDDL-1.0 のデュアル）

## 要件の確認（計画 Task 10 Step 1）
| 要件 | 結果 |
|---|---|
| (a) raw color 出力、自動明るさなし、ガンマ 1、カメラ WB 不使用、user_mul 1、16bit | 設定 `outputColor:0, noAutoBright:true, gamm:[1,1], useCameraWb:false, userMul:[1,1,1,1], outputBps:16` で可能 |
| (b) カラーマトリクス、cam_mul、black/maximum | `metadata(true)` の `color_data` に `cam_xyz`, `rgb_cam`, `cam_mul`, `pre_mul`, `black`, `maximum`, `dng_color`, `dng_levels` がある。**`metadata(false)` では `color_data` が返らない** |
| (c) リニア DNG（ProRAW） | iPhone 12 Pro の ProRAW を読めた。`cam_xyz` は空で、`dng_color[].colormatrix` から取得 |
| (d) サムネイル | `thumbnailData()`。サードパーティ製アプリの DNG のように JPEG を持たないファイルもある（その場合 `null`） |
| (e) Worker で動く | パッケージ自体が Worker を起動する（pthread 版。COOP/COEP 必須、本アプリは設定済み） |
| (f) ライセンス | ISC + LGPL/CDDL。無料で利用可 |
| JPEG XL 圧縮 DNG | **非対応**（バイナリに `jxl_dng_load_raw_placeholder` しかない）。→ 計画の Task 10b（libjxl の追加）として後回し。サンプル入手まで検証不能 |

## カラーマトリクスの取り方（src/decode/raw.ts）
1. `cam_xyz`（XYZ → カメラ）が非ゼロならその上 3 行の逆行列
2. DNG は `dng_color` のうち光源が D65 に近い ColorMatrix の逆行列
3. どちらも無ければ `SRGB_TO_XYZ · rgb_cam`

撮影時 WB は DNG の AsShotNeutral、無ければ `cam_mul`、`pre_mul` の順。

検証（tests/e2e/decode-raw.spec.ts）: EOS 20D CR2 / D5200 NEF / iPhone 12 Pro ProRAW / iPhone 8 ベイヤー DNG の 4 種で、撮影時 WB から求めた色温度が 2500〜10000K に入ることを確認（行列の向きと WB の取り違えを検出する）。

## 自前ビルドに切り替える条件
- JPEG XL 圧縮 DNG に対応する必要が出たとき（Task 10b）
- LibRaw の新しいカメラ対応（CR3 の新機種など）が必要になったとき
