// 幾何（仕様 3.3）。切り抜き・回転・向きは処理段ではなく、出力時のサンプリング座標変換として扱う。
// ここでは DevelopPass が使う SampleTransform の型と恒等変換だけを定義する（残りは計画 Task 15）。
//
// SampleTransform.m は行優先の 3×3: [u, v, 1]ᵀ ∝ m · [px, py, 1]ᵀ。
//   (px, py) = 出力テクスチャ上の画素中心の絶対座標（画素 (x, y) なら (x + 0.5, y + 0.5)。outRect の原点ではない）。
//   (u, v) = 入力画像（向き補正前・切り抜き前の全体）の正規化座標 0..1。画素 (i, j) の中心は ((i + 0.5)/w, (j + 0.5)/h)。
//   3 行目で割る（射影）。アフィン変換なら 3 行目は [0, 0, 1]。

export interface SampleTransform { m: Float32Array }

/** w×h の出力を同じ w×h の入力へ 1:1 で写す恒等変換 */
export function identitySample(w: number, h: number): SampleTransform {
  return { m: new Float32Array([1 / w, 0, 0, 0, 1 / h, 0, 0, 0, 1]) };
}
