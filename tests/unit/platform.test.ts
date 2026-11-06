import { test, expect } from 'vitest';
import { detectPlatform, type PlatformEnv } from '../../src/platform/detect';

const WIN_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';

const env = (o: Partial<PlatformEnv>): PlatformEnv => ({
  gpu: true, showDirectoryPicker: true, opfs: true, userAgent: WIN_CHROME, maxTouchPoints: 0, ...o,
});

test.each([
  {
    name: 'Windows Chrome',
    e: env({}),
    want: { webgpu: true, backend: 'folder', ios: false, workCap: 8192, previewCap: 2560, unsupportedReason: null },
  },
  {
    name: 'iPhone Safari',
    e: env({ showDirectoryPicker: false, userAgent: IPHONE_SAFARI, maxTouchPoints: 5 }),
    want: { backend: 'library', ios: true, workCap: 4096, previewCap: 2048 },
  },
  {
    name: 'iPad (Mac UA + touch)',
    e: env({ showDirectoryPicker: false, userAgent: MAC_SAFARI, maxTouchPoints: 5 }),
    want: { ios: true, workCap: 4096 },
  },
])('$name', ({ e, want }) => {
  expect(detectPlatform(e)).toMatchObject(want);
});

test('WebGPU なし', () => {
  const p = detectPlatform(env({ gpu: false }));
  expect(p.webgpu).toBe(false);
  expect(p.backend).toBeNull();
  expect(p.unsupportedReason).toContain('WebGPU');
});

test('picker も OPFS もない', () => {
  const p = detectPlatform(env({ showDirectoryPicker: false, opfs: false }));
  expect(p.backend).toBeNull();
  expect(p.unsupportedReason).toContain('保存領域');
});

test('Mac Safari（タッチなし）は iOS ではない', () => {
  const p = detectPlatform(env({ showDirectoryPicker: false, userAgent: MAC_SAFARI, maxTouchPoints: 0 }));
  expect(p).toMatchObject({ ios: false, backend: 'library', workCap: 8192, previewCap: 2560 });
});
