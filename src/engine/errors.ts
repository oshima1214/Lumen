// エンジンのエラー型（Task 15 の renderer.ts から再 export する）。
/** GPU のメモリ確保に失敗した（作業画像の解像度を下げて再試行する、仕様 7 章） */
export class GpuOutOfMemoryError extends Error {
  constructor(message = 'GPU のメモリが足りません') { super(message); this.name = 'GpuOutOfMemoryError'; }
}
