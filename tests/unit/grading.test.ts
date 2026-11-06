import { test, expect } from 'vitest';
import { applyGrading } from '../../src/color/grading';

// 仕様 3.2「既定値の処理段は省略する」: 既定値（全 0）のグレーディングは、色域外で L < 0 の色も含めて厳密に恒等
test('既定値のグレーディングは恒等（L < 0 の色域外の色も）', () => {
  const zero = new Float32Array(14);
  for (const lab of [[0.5, 0.1, -0.05], [0, 0, 0], [-0.12, -0.03, -0.2], [1.2, 0.3, 0.1]] as [number, number, number][]) {
    expect(applyGrading(lab, zero)).toEqual(lab);
  }
});
