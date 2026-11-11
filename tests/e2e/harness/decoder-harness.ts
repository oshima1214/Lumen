// Decoder（Worker 経由）の E2E 入口（本番バンドル外）。
import { Decoder, DecodeError } from '../../../src/decode/client';

async function file(p: string): Promise<File> {
  const r = await fetch('/__e2e/files/' + p);
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return new File([await r.blob()], p.split('/').pop()!);
}
const decoder = new Decoder();
const api = { file, decoder, isDecodeError: (e: unknown) => e instanceof DecodeError };
export type DecoderHarness = typeof api;
(window as unknown as { __dec: DecoderHarness }).__dec = api;
document.title = 'decoder-harness-ready';
