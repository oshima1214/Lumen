# コア現像エンジン 設計仕様（サブプロジェクト1）

- 日付: 2026-11-06
- ステータス: レビュー待ち（改訂2: iPhone 対応、無料運用、見た目を追加）
- 仮称: **Lumen**（ラテン語で「光」。名称は後で変更可。サイドカーの `app` フィールドにのみ使用。既存製品と同名のため公開時は再検討）

## 1. 目的と前提

### 1.1 目的
Adobe Lightroom の現像機能に匹敵する写真編集を、**ブラウザだけで完結する Web アプリ**として実現する。
本仕様はその土台となる「コア現像エンジン」（サブプロジェクト1）を対象とする。

### 1.2 利用者と成功基準
- 利用者: 本人および身近な人。各自が自分の PC で使う個人ツール（公開・課金・マルチユーザーは対象外）。
- 成功基準:
  - PC と iPhone のブラウザの両方で動く。
  - 手持ちの RAW（Canon EOS 20D / Nikon D5300）と iPhone 各機種の写真（HEIC・JPEG・ProRAW）を開き、Lightroom の基本補正・トーンカーブ・HSL・カラーグレーディング・切り抜きに相当する編集ができる。
  - スライダー操作が滑らか（プレビューで 16ms 以内に再描画）。
  - 編集は非破壊。PC では写真の隣のサイドカー JSON に保存され、フォルダごと移動・別 PC で開いても再現される。iPhone ではアプリ内ライブラリに同じ形式で保存される。
  - 開発・運用費が無料（独自ドメイン等の任意費用を除く）。
  - プリセットと設定のコピー＆ペーストで複数写真へ一括適用できる。
  - サイズ・画質・透かしを指定して JPEG/PNG に書き出せる。

### 1.3 決定事項（ユーザー回答）
| 項目 | 決定 |
|---|---|
| 用途 | 個人ツール |
| 入力形式 | RAW と JPEG/HEIC を同等に扱う。iPhone は全機種の形式に対応 |
| 実行形態 | 完全ローカル（ブラウザ内で完結、サーバーなし） |
| 対象ブラウザ | PC の Chrome / Edge と iPhone の Safari（ほか WebGPU 対応ブラウザ） |
| 編集の保存 | サイドカー JSON。PC はフォルダ方式（写真の隣）、iPhone 等はライブラリ方式（OPFS 内） |
| 技術方式 | TypeScript + WebGPU（案A） |
| UI フレームワーク | Svelte 5（Vite） |
| 費用 | 開発・運用とも無料。有料要素が必要になったら都度相談 |

### 1.4 対象環境
WebGPU は必須。保存方式はブラウザの機能で自動選択する（2.4）。

| 環境 | 保存方式 | 備考 |
|---|---|---|
| PC の Chrome / Edge（最新安定版） | フォルダ方式 | File System Access API を使用 |
| iPhone の Safari（iOS 26 以降）。iPhone 上の他ブラウザも中身は同じ | ライブラリ方式 | ホーム画面に追加（PWA）して使うことを推奨 |
| PC の Safari / Firefox（WebGPU 有効時） | ライブラリ方式 | 動作は保証しないが動くよう作る |

対象カメラ・形式:

| 形式 | 対象 | 対応方法 |
|---|---|---|
| CR2 | Canon EOS 20D | LibRaw（ベイヤー、デモザイクあり） |
| NEF | Nikon D5300 | LibRaw（ベイヤー、デモザイクあり） |
| JPEG / PNG | 全般、全 iPhone | ブラウザ標準 |
| HEIC / HEIF（48MP の HEIF Max を含む） | iPhone 7 以降 | Safari は標準デコード、PC の Chrome / Edge は libheif-WASM |
| Apple ProRAW（DNG、リニア・デモザイク済み） | iPhone 12 Pro 以降の Pro 系 | LibRaw（デモザイクを省略） |
| ProRAW（JPEG XL 圧縮） | iPhone 16 Pro 以降の一部設定 | **要検証**。LibRaw が非対応なら libjxl-WASM を追加 |
| サードパーティアプリの DNG（ベイヤー） | 各 iPhone | LibRaw |
| その他の DNG | — | LibRaw が読める範囲で対応（保証しない） |

- HDR 写真（HEIC のゲインマップ）は v1 では SDR のベース画像として扱う。
- 実機のテスト用サンプルは現時点で未提供。デコードの実ファイルテストはサンプル入手まで保留する（8章）。

### 1.5 全体ロードマップと本仕様の範囲
| # | サブプロジェクト | 本仕様 |
|---|---|---|
| 1 | コア現像エンジン（読み込み、基本補正、トーンカーブ、HSL、カラーグレーディング、切り抜き、プリセット、コピペ、書き出し） | **対象** |
| 2 | ディテール（シャープ、ノイズ除去、レンズ補正、明瞭度・テクスチャ・かすみ除去） | 対象外 |
| 3 | 部分補正（線形・円形グラデーション、ブラシ） | 対象外 |
| 4 | AI マスク（被写体・空の選択） | 対象外 |

**本仕様で明示的に扱わないもの**: 本格的なライブラリ／カタログ（キーワード、コレクション、検索）、クラウド同期・端末間同期、XMP 互換、明瞭度・テクスチャ・かすみ除去、ノイズ除去、レンズ補正、部分補正、HDR 編集・HDR 書き出し、ライトモード、日本語以外の UI 言語。

## 2. アーキテクチャ

### 2.1 構成図
```
┌─────────────── メインスレッド（Svelte UI）───────────────┐
│ Browser(Folder/Library) │ Filmstrip │ Viewer │ DevelopPanel │
│        │                       ▲                 │       │
│        ▼                       │                 ▼       │
│ storage/ ───────────►  store/ (編集状態・Undo履歴)        │
│  ├ FolderBackend  (File System Access, PC Chrome/Edge)   │
│  └ LibraryBackend (OPFS, iPhone Safari ほか)             │
│        │                       │                         │
│        │                       ▼                         │
│        │              engine/ (WebGPUパイプライン)        │
│        ▼                       ▲                         │
│  decode-worker (Web Worker) ───┘ linear float RGB         │
│   ├ LibRaw-WASM  (CR2 / NEF / DNG)                       │
│   ├ libheif-WASM (HEIC、Safari 以外)                      │
│   ├ libjxl-WASM  (JPEG XL 圧縮 ProRAW、必要な場合のみ)    │
│   └ createImageBitmap (JPEG / PNG / Safari の HEIC)       │
└──────────────────────────────────────────────────────────┘
```

### 2.2 モジュール
| モジュール | 責務 | 公開インターフェース | 依存 |
|---|---|---|---|
| `storage/` | 画像の取り込み・一覧、元画像の読み出し、サイドカー・プリセットの読み書き、書き出し先への保存。2 実装を持つ（2.4） | `StorageBackend`（2.4） | File System Access API / OPFS |
| `decode/` | Worker 内でファイルをデコードし `DecodedImage` を返す。埋め込みプレビューの抽出 | `decode(file, opts): Promise<DecodedImage>`, `extractPreview(file): Promise<ImageBitmap>` | LibRaw-WASM, libheif-WASM, libjxl-WASM |
| `params/` | 現像パラメータの型、既定値、スキーマのバージョン移行、部分適用、差分のシリアライズ。**純粋関数のみ** | `DevelopParams`, `defaultParams()`, `migrate(json)`, `applyPartial(base, partial)`, `toSidecar(params)`, `fromSidecar(json)` | なし |
| `color/` | 色計算の参照実装（WB、行列、色温度⇔xy、OKLCh、トーンカーブ評価）。TS と WGSL で同じ式を持つ | 関数群 | なし |
| `engine/` | WebGPU パイプライン。`DecodedImage` と `DevelopParams` から描画。書き出しはタイル単位 | `loadImage(img)`, `render(params, viewport)`, `renderTile(params, rect)`, `histogram()` | WebGPU, `color/` |
| `store/` | 選択状態、現在のパラメータ、Undo/Redo、サイドカーへのデバウンス保存 | Svelte のストア | `params/`, `storage/` |
| `export/` | タイル単位でフル解像度現像、リサイズ、出力シャープ、透かし、エンコード、EXIF 付加、保存 | `exportImages(ids, settings, onProgress, signal)` | `engine/`, `storage/` |
| `platform/` | 実行環境の判定（WebGPU、File System Access、OPFS、端末種別、メモリ上限の目安）と保存方式の選択 | `detectPlatform(): Platform` | なし |
| `cache/` | サムネイルと中間プレビューの IndexedDB キャッシュ（キー: パス＋サイズ＋更新日時） | `get(key)`, `put(key, blob)` | IndexedDB |

設計上の原則:
- `params/` と `color/` は UI・GPU・ファイルに依存しない。単体テストの中心とする。
- `engine/` はファイルの存在を知らない。後続サブプロジェクトは処理段の追加で拡張する。
- `storage/` より上の層は、PC とiPhone のどちらで動いているかを意識しない（違いは `StorageBackend` と UI レイアウトに閉じ込める）。
- デコードとエンコードは Worker で行い、メインスレッドを止めない。

### 2.3 データ型（要点）
```ts
interface DecodedImage {
  width: number; height: number;          // 向き補正前のセンサー寸法
  orientation: 1|3|6|8;                   // EXIF の向き（表示時に適用）
  kind: 'raw' | 'display';                // raw=カメラRGB、display=リニアRec.2020
  pixels: Float32Array | Uint16Array;     // RGB リニア
  camToXyz?: number[];                    // 3x3。kind=raw のみ
  asShotNeutral?: [number, number, number]; // 撮影時 WB（カメラRGB の中性点）
  whiteLevel?: number;                    // 飽和レベル（正規化済みなら 1）
  exif: ExifSummary;                      // 撮影日時、機種、レンズ、ISO、SS、F値、焦点距離、GPS
}
```

### 2.4 保存方式（StorageBackend）
```ts
interface ImageRef { id: string; name: string; size: number; mtime: number; group: string }

interface StorageBackend {
  kind: 'folder' | 'library';
  addSource(): Promise<void>;                 // folder: フォルダ選択 / library: 写真の取り込み
  list(): Promise<ImageRef[]>;
  readOriginal(id: string): Promise<File>;
  readSidecar(id: string): Promise<unknown | null>;
  writeSidecar(id: string, data: unknown): Promise<void>;
  remove?(id: string): Promise<void>;         // library のみ（ライブラリから削除）
  presets: PresetStore;
  saveExport(name: string, blob: Blob): Promise<void>;
}
```

| | FolderBackend（PC の Chrome / Edge） | LibraryBackend（iPhone Safari ほか） |
|---|---|---|
| 取り込み | `showDirectoryPicker()` でフォルダを開く。ハンドルは IndexedDB に保存し、再起動後に権限を再取得 | `<input type="file" multiple>` で「写真」または「ファイル」から選び、OPFS の `library/<id>/` に**コピー** |
| `group` | フォルダの相対パス | 取り込み日（`YYYY-MM-DD`） |
| サイドカー | 写真の隣に `<元ファイル名>.json` | `library/<id>/sidecar.json`（同じ形式） |
| プリセット | ユーザーが指定するプリセットフォルダ | OPFS の `presets/` |
| 書き出し | ユーザーが指定する書き出しフォルダ | 共有シート（`navigator.share({ files })`）→「画像を保存」で写真アプリへ。共有非対応時はダウンロード |
| データ保護 | 元ファイルはユーザーのフォルダにある | `navigator.storage.persist()` を要求。ホーム画面への追加（PWA）を案内する（Safari が 7 日間未使用のサイトデータを消すことへの対策）。「データはこの端末内だけにある」ことを明示 |

- ライブラリ方式では、取り込み時に空き容量を `navigator.storage.estimate()` で確認し、不足する場合は取り込み前に警告する。
- ライブラリ方式の取り込みでは、iOS が HEIC / ProRAW を JPEG に変換して渡すことがある。受け取った形式が元と違う場合（拡張子・MIME で判定）、「『ファイル』から選ぶとオリジナルのまま取り込める」と案内する（要実機検証、10章）。

## 3. 現像パイプライン

### 3.1 デコード（Worker、1画像1回）
- **RAW**: LibRaw でデモザイク（AHD）。WB 係数 1、自動明るさなし、ガンマ 1.0、出力はカメラ RGB（`output_color=0`）、16bit。カメラ行列（`cam_xyz`）、撮影時 WB、黒・白レベルも取得。
- **ProRAW（リニア DNG）**: LibRaw で読み込み、デモザイクは行わない。DNG のカラーマトリクスと撮影時 WB を使い、以降は RAW と同じ扱い（`kind: 'raw'`）。JPEG XL 圧縮の場合は libjxl-WASM で展開してから同じ処理に渡す（LibRaw が直接対応していればそれを使う）。
- **JPEG/PNG**: `createImageBitmap` で取得後、sRGB（ICC が Display P3 なら P3）をリニア化し Rec.2020 へ変換。
- **HEIC**: Safari では `createImageBitmap` で、それ以外では libheif-WASM でデコード。iPhone は Display P3 → リニア Rec.2020。ゲインマップは無視する。
- **2 種類の画像を保持する**:
  - **元データ**: デコード結果のフル解像度。Worker 内の CPU バッファに 16bit 整数で保持し、GPU には載せない。書き出し時にタイルごとに切り出して GPU へ送る。開いている 1 枚分だけを保持する。
  - **作業画像**: 元データを長辺の上限（`platform/` が決める。PC 8192px、iPhone 4096px）以下に縮小し、GPU に `rgba16float` で載せる。プレビューと 100% 表示はこちらから描画する。
- GPU 側では `rgba16float` テクスチャにアップロードし、ミップマップのピラミッドを生成する。

### 3.2 GPU の処理段（WGSL コンピュートシェーダー）
処理順は固定。既定値の処理段は省略する。

| # | 処理段 | 色空間 | 内容 |
|---|---|---|---|
| 1 | ホワイトバランス | RAW: カメラ RGB / display: リニア Rec.2020 | RAW: 色温度・色かぶり → xy → `camToXyz` の逆行列でカメラ中性点 → チャンネル倍率。display: 撮影時を基準とした相対値（色温度・色かぶりとも ±100）を Bradford 変換で適用 |
| 2 | カメラ → Rec.2020、ハイライト処理 | → リニア Rec.2020 | RAW のみ。飽和画素はクリップし、白飛び部分の色かぶりを無彩色側へ寄せる |
| 3 | 露光量 | リニア | `× 2^EV`（−5〜+5） |
| 4 | ハイライト／シャドウ | リニア＋局所 | 縮小ピラミッドからガイデッドフィルターでベース輝度層を作り、局所トーン調整（−100〜+100） |
| 5 | コントラスト、白レベル、黒レベル | log2 | 18% グレーを中心とした S カーブ、両端の調整 |
| 6 | ベーストーンマップ | リニア → 知覚 | フィルム調の既定カーブ（RAW・display 共通。display では恒等に近い形になるよう撮影時を基準にする） |
| 7 | 自然な彩度、彩度 | OKLCh | 自然な彩度は低彩度・肌色を保護 |
| 8 | トーンカーブ | 知覚（ガンマ） | 4 領域のパラメトリックカーブ ＋ RGB/R/G/B ポイントカーブ（単調な 3 次スプライン、1D LUT 化） |
| 9 | HSL | OKLCh | 8 色域（赤、オレンジ、黄、緑、水色、青、紫、マゼンタ）。境界は滑らかな重み |
| 10 | カラーグレーディング | OKLCh | シャドウ・中間調・ハイライトのホイール（色相・彩度・輝度）、グローバル、ブレンド、バランス |
| 11 | 出力 | → sRGB / Display P3 | ガンマ、ディザ。ヒストグラムもここで計算（コンピュート） |

### 3.3 切り抜き・角度補正
- 処理段ではなく、出力時の**サンプリング座標変換**として実装する。元画像は不変。
- 処理段 4 のベース層は切り抜き前の全体で計算する（枠を動かしても色が変わらない）。
- 縦横比の固定（元画像、1:1、4:5、3:2、16:9、自由）。角度は −45°〜+45°。回転時は内接する最大矩形に自動で収める。
- EXIF の向きは切り抜きより前に適用する。

### 3.4 解像度とパフォーマンス
- 編集中は、表示サイズに合うピラミッドの段（PC は長辺 2560px、iPhone は 2048px 程度まで）で描画する。
- 100% 表示では、見えている範囲を作業画像（3.1 の縮小デコード上限まで）から描画する。iPhone で 48MP の写真は、100% 表示も 4096px の作業画像からの拡大になる（v1 の制約）。
- **書き出しはタイル分割**（1 タイル 2048px 角、周囲に 32px の重なり）で行う。メモリが厳しい iPhone と、`maxTextureDimension2D` を超える画像の両方に対応するため。
  - 処理段 4 のベース層は縮小画像から作った 1 枚を全タイルで共有するので、タイルの境目で明るさが変わらない。
  - Lanczos 縮小と出力シャープは近傍の画素を使うため、重なり部分を含めて計算し、重なりを捨てて結合する。
  - 縮小書き出しの場合は、先に縮小率に合わせたタイル計画を立て、出力サイズのバッファだけを確保する。
- 目標:
  - PC: プレビューのスライダー操作から描画まで 16ms 以内。24MP の RAW の読み込みは 3 秒以内（一般的なノート PC）。
  - iPhone（iPhone 15 相当）: プレビュー描画 33ms 以内（30fps）。48MP の書き出しがメモリ不足で落ちずに完了すること。

## 4. パラメータとサイドカー

### 4.1 サイドカー形式
フォルダ方式ではファイル名 `<元ファイル名>.json`（例: `IMG_0001.NEF.json`）、ライブラリ方式では `library/<id>/sidecar.json`。中身の形式は共通。

```jsonc
{
  "app": "lumen",
  "schema": 1,
  "source": { "name": "IMG_0001.NEF", "size": 25123456, "mtime": 1730851200000 },
  "params": {
    "wb":      { "mode": "asShot", "temp": 5200, "tint": 8 },
    "basic":   { "exposure": 0.35, "contrast": 10, "highlights": -40, "shadows": 25,
                 "whites": 5, "blacks": -8, "vibrance": 10, "saturation": 0 },
    "curve":   { "parametric": { "highlights": 0, "lights": 0, "darks": 0, "shadows": 0,
                                 "splits": [0.25, 0.5, 0.75] },
                 "rgb": [[0,0],[1,1]], "r": [[0,0],[1,1]], "g": [[0,0],[1,1]], "b": [[0,0],[1,1]] },
    "hsl":     { "red": { "h": 0, "s": 0, "l": 0 } /* 8 色域分 */ },
    "grading": { "shadows":   { "hue": 0, "sat": 0, "lum": 0 },
                 "midtones":  { "hue": 0, "sat": 0, "lum": 0 },
                 "highlights":{ "hue": 0, "sat": 0, "lum": 0 },
                 "global":    { "hue": 0, "sat": 0, "lum": 0 },
                 "blending": 50, "balance": 0 },
    "crop":    { "x": 0, "y": 0, "w": 1, "h": 1, "angle": 0, "aspect": "original" }
  },
  "rating": 0
}
```

- `wb.mode`: `asShot` | `custom`（RAW）。display 画像では `temp`/`tint` を ±100 の相対値として扱う。
- **既定値と等しい項目は書き出さない**（`toSidecar` が差分のみ出力し、`fromSidecar` が既定値とマージ）。
- `rating`（0〜5）は最小限の絞り込み用。

### 4.2 読み書きの規則
- 書き込みは一時ファイル（`.json.tmp`）に書いてから置き換える。
- 編集のたびに 500ms のデバウンスで自動保存する。
- 読み込みに失敗した場合は既定値で開き、壊れたファイルは `.json.bak` に退避して警告する（上書きで失わない）。
- `source` のサイズまたは更新日時が実ファイルと違う場合は「元ファイルが変わった可能性」を警告する（編集は適用する）。
- `schema` が新しすぎる場合は読み取り専用で開き警告する。古い場合は `migrate()` で変換する。

### 4.3 プリセット
- プリセットは `params` の部分集合（`Partial<DevelopParams>` の深い部分集合）＋名前。
- 適用は `applyPartial()`。含まれる項目だけを上書きする。
- 保存先は `StorageBackend.presets`。フォルダ方式ではユーザーが指定するプリセットフォルダ（`presets/*.json`、ハンドルは IndexedDB に保持）、ライブラリ方式では OPFS の `presets/`。
- プリセットの読み込み・書き出し（JSON ファイル）で、PC と iPhone の間で手動で受け渡しできる。
- 組み込みプリセット: モノクロ、高コントラスト、フィルム調、ソフトの 4 種。

### 4.4 コピー＆ペースト／一括適用
- 「設定をコピー」ダイアログでグループ単位（WB、基本補正、トーンカーブ、HSL、カラーグレーディング、切り抜き）を選択。**WB と切り抜きは既定でオフ**。
- フィルムストリップの複数選択に対してペーストすると、全件に `applyPartial()` を適用し、各サイドカーに保存する。

### 4.5 Undo / Redo
- パラメータ全体のスナップショットを履歴に積む（最大 100 件）。
- スライダーのドラッグ開始から終了までを 1 操作にまとめる。
- 履歴は画像ごとにメモリ上で保持し、サイドカーには保存しない。

## 5. UI

### 5.1 レイアウト（画面幅で切り替え）
**PC（幅 1024px 以上）**
- **左**: フォルダツリー（フォルダ方式）または取り込み日の一覧（ライブラリ方式）、プリセット一覧
- **中央**: ビューア（画面に合わせる／100%、ドラッグで移動、`\` で編集前後の比較）
- **右**: ヒストグラム、パネル（基本補正 / トーンカーブ / HSL / カラーグレーディング / 切り抜き）。スライダーのダブルクリックで既定値に戻す
- **下**: フィルムストリップ。サムネイルは IndexedDB キャッシュ。RAW は埋め込み JPEG を先に表示
- **ショートカット**: ←→ 画像送り、Ctrl+Z / Ctrl+Shift+Z 取り消し／やり直し、Ctrl+Shift+C / V 設定のコピー／ペースト、R 切り抜き、Ctrl+Shift+E 書き出し、0〜5 レーティング

**iPhone（幅 1024px 未満、縦画面）**
- **一覧画面**: サムネイルのグリッド。右下に「＋（取り込み）」ボタン。長押しで複数選択（設定のペースト、書き出し、削除）
- **編集画面**: 上に写真（ピンチで拡大、2 本指で移動、**長押しで編集前を表示**、左右スワイプで画像送り）。下にツールのタブ（ライト / カラー / カーブ / HSL / グレーディング / 切り抜き / プリセット）、その上に選択中のタブのスライダー群。ヒストグラムは折りたたみ表示
- 上部: 戻る、取り消し／やり直し、書き出し（共有）、「…」メニュー（設定のコピー／ペースト）
- 片手操作を想定し、操作要素は画面下半分に集める。タップ領域は 44px 以上。スライダーは値の数字をタップして直接入力できる

### 5.2 見た目と配色
方針: **UI が写真の色の判断を邪魔しない**こと。

| トークン | 値 | 用途 |
|---|---|---|
| `--bg` | `#1C1C1C` | アプリ背景 |
| `--panel` | `#252525` | パネル |
| `--line` | `#333333` | 区切り線 |
| `--text` | `#E6E6E6` | 本文 |
| `--text-sub` | `#9A9A9A` | 補助テキスト、単位 |
| `--accent` | `#D9A441` | 選択中、スライダーのつまみ、主ボタン（面積は最小限） |
| `--danger` | `#E5484D` | エラー、削除 |

- 基調は色みのない（無彩色の）ダークグレー。ライトモードは作らない。
- 写真周囲の背景は 黒 / ダークグレー（`--bg`）/ 18% グレー（`#777777`）から選べる。
- 色を使うのは意味がある箇所だけ: 色温度スライダー（青→黄）、色かぶり（緑→マゼンタ）、HSL の各色、ヒストグラム（R・G・B の重ね表示と白飛び・黒つぶれの警告）。
- 文字: システムフォント（`system-ui`。iPhone はヒラギノ、PC は OS 標準）。数値は等幅数字（`font-variant-numeric: tabular-nums`）。
- アイコン: Lucide（ISC ライセンス、無料）。
- UI 言語は日本語のみ。

## 6. 書き出し

- 設定: 形式（JPEG / PNG）、JPEG 品質（1〜100）、長辺ピクセル数（または原寸）、色空間（sRGB / Display P3）、出力シャープ（なし / 弱 / 標準 / 強）、ファイル名ルール（`{name}`, `{seq}`, `{date}`）、透かし（文字または画像、9 方向の位置、大きさ、不透明度）、GPS を除去するかどうか。
- 保存先: `StorageBackend.saveExport()`。フォルダ方式は指定した書き出しフォルダ（同名ファイルは連番を付けて回避し、上書きしない）。ライブラリ方式は共有シートで写真アプリへ保存（複数枚はまとめて共有）。
- 処理: GPU でタイル単位にフル解像度現像（3.4）→ Lanczos 縮小 → 出力シャープ（アンシャープマスク）→ 透かし合成 → Worker でエンコード（JPEG は MozJPEG-WASM、PNG はブラウザ標準）→ EXIF 付加（撮影日時、機種、レンズ、露出情報、ICC プロファイル。GPS は設定に従う）。
- 一括処理は 1 枚ずつ順に実行。進捗表示とキャンセル（`AbortSignal`）に対応。失敗した写真はスキップし、最後に一覧で報告。

## 7. エラー処理

| 状況 | 振る舞い |
|---|---|
| WebGPU がない | 起動時に判定し、必要なブラウザ・OS バージョンと理由を表示して停止 |
| File System Access API がない | ライブラリ方式で起動（エラーにしない） |
| OPFS もない | 必要なブラウザを表示して停止 |
| デコード失敗・非対応形式 | その写真だけエラーのサムネイルにして理由を表示、他は継続 |
| 取り込み時に容量不足 | 取り込み前に警告し、必要量と空き容量を表示 |
| iOS が JPEG に変換して渡した | 取り込みは行い、「ファイル」から選び直す方法を案内 |
| GPU デバイス喪失（`device.lost`）。iPhone でアプリを切り替えた後にも起こる | デバイスを再作成し、現在の画像とパラメータから再描画 |
| メモリ不足の兆候（GPU のメモリ確保失敗） | 作業画像の上限を一段下げて再試行し、その旨を表示 |
| フォルダ権限の失効（再起動後など） | 「アクセスを再許可」ボタンを表示 |
| 永続化が許可されていない（ライブラリ方式） | 設定画面に「データが消える可能性」とホーム画面への追加手順を表示 |
| サイドカー書き込み失敗 | 画面上部に警告を常時表示。編集はメモリに保持し、次の操作時に再試行 |
| サイドカー破損・新しすぎるスキーマ | 4.2 の規則に従う |
| 書き出し中の失敗 | 該当写真をスキップし、終了時に一覧表示 |

## 8. テスト方針

- **単体テスト（Vitest、TDD）**: `params/`（既定値、差分シリアライズ、移行、部分適用、コピー対象の選択）、`color/`（色温度⇔xy、WB 倍率、行列、OKLCh 往復、トーンカーブの単調性）。
- **GPU と参照実装の一致**: `color/` の TS 参照実装と WGSL の出力を、小さな合成テスト画像で比較（許容誤差つき、Playwright + Chromium の WebGPU で実行）。
- **保存方式**: `StorageBackend` の共通テストを 2 実装に対して実行（FolderBackend はメモリ上の偽ハンドル、LibraryBackend は Playwright 上の実 OPFS）。
- **タイル分割**: 同じ画像を「一括」と「タイル分割」で現像した結果が許容誤差内で一致することを検証（境目の段差がないこと）。
- **デコード（合成データ）**: JPEG / PNG は生成した画像で検証。RAW / HEIC は、ライセンス上再配布可能な公開サンプル（raw.pixls.us 等）を CI 時にダウンロードして寸法・向き・メタデータを検証する（ダウンロードできない場合はスキップ）。
- **デコード（実機の写真）**: EOS 20D の CR2、D5300 の NEF、iPhone の HEIC / ProRAW は**現時点でサンプル未提供のため保留**。入手後に `test-assets/`（`.gitignore` 対象、コミットしない）に置けば自動で有効になるテストとして用意しておく。
- **描画の回帰テスト**: 代表的なパラメータの組み合わせで出力を基準画像と比較（PSNR などの閾値）。
- **レイアウト**: Playwright で PC 幅と iPhone 幅（WebKit エンジン）の画面を撮って確認。
- **iPhone 実機確認**: 自動化できない項目（写真アプリからの取り込み形式、共有シート、メモリ、PWA）は手動確認のチェックリストを用意する。
- **パフォーマンス計測**: プレビュー描画時間と RAW 読み込み時間を計測するベンチマークを用意し、目標（3.4）と比較。

## 9. 技術スタック

- TypeScript（strict）、Svelte 5、Vite
- WebGPU（WGSL コンピュートシェーダー）
- LibRaw の WASM ビルド（既存の npm パッケージを評価し、要件——カメラ RGB 出力、行列・WB の取得、リニア DNG——を満たさなければ自前ビルド）
- libheif の WASM ビルド（Safari 以外で使用）
- libjxl の WASM ビルド（JPEG XL 圧縮の ProRAW 用。必要と判明した場合のみ）
- MozJPEG の WASM ビルド
- Lucide（アイコン）
- Vitest、Playwright（Chromium と WebKit）
- PWA（Web App Manifest ＋ Service Worker。オフラインでも起動できるようアプリ本体をキャッシュ）

### 9.1 無料での運用
| 項目 | 方法 | 費用 |
|---|---|---|
| ライブラリ | すべてオープンソース（LibRaw: LGPL/CDDL、libheif: LGPL、libjxl: BSD、MozJPEG: BSD 系、Svelte/Vite/Lucide: MIT/ISC） | 無料 |
| 公開 | Cloudflare Pages の無料プラン。`_headers` ファイルで COOP/COEP ヘッダーを付与（SharedArrayBuffer に必要）。HTTPS 自動 | 無料 |
| URL | `<名前>.pages.dev` | 無料（独自ドメインは任意、年 1,500 円程度） |
| iPhone での利用 | PWA としてホーム画面に追加。App Store は使わない | 無料（Apple の開発者登録は不要） |
| サーバー・API | 使わない（すべて端末内で処理） | 無料 |
| ソースコード管理・CI | GitHub の無料プランと GitHub Actions | 無料 |

有料の選択肢が必要になった場合（例: 将来の AI 機能でクラウド API を使うか）は、実装前にユーザーと相談する。

## 10. 未確定のリスク

- **LibRaw-WASM の選定**: 既存パッケージがカメラ RGB の出力や行列取得に対応していない場合、自前ビルド（Emscripten）が必要。実装計画の最初のタスクで検証する。
- **RAW の色再現**: 単一の D65 行列による変換のため、Lightroom の DCP プロファイルとは色が一致しない。v1 では「破綻なく自然」を基準とし、完全一致は目標にしない。
- **ハイライト／シャドウの品質**: ガイデッドフィルターのハロや計算量はパラメータ調整が必要。プレビューと書き出しで見た目が一致するよう、半径は画像サイズに比例させる。
- **iPhone Safari の WebGPU**: iOS 26 で標準有効だが、コンピュートシェーダーの性能・`rgba16float` の対応・メモリ上限は実機で確認が必要。実装計画の初期に最小のパイプラインを iPhone 実機で動かして検証する。
- **iPhone のメモリ**: 48MP の写真では、元データ（16bit RGB で約 290MB）、作業画像（4096px で約 100MB）、書き出し用タイルが同時に載る。これで落ちる可能性があるため、作業画像の上限とタイルの大きさは実機計測で調整する。元データを保持しきれない場合は、書き出し時に再デコードする方式に切り替える。
- **写真アプリからの取り込み形式**: iOS がオリジナルではなく JPEG を渡す場合がある（2.4）。実機で確認し、案内の文言を決める。
- **JPEG XL 圧縮の ProRAW**: LibRaw の対応状況を検証し、非対応なら libjxl を組み込む。
- **ライブラリ方式のデータ消失**: OPFS のデータは端末内にしかなく、ブラウザのデータ削除で消える。PWA 化と永続化要求で軽減するが、完全には防げないことを UI で明示する。
