// 形式判定してから各デコーダーに振り分ける。Worker 内で使う。
import { sniffFormat } from './sniff';
import { decodeDisplay } from './display';
import { decodeHeic } from './heic';
import { decodeRaw } from './raw';
import type { DecodedImage, Format } from './types';

export class DecodeError extends Error {
  constructor(message: string, readonly format: Format) { super(message); this.name = 'DecodeError'; }
}

export async function formatOf(file: Blob, name: string): Promise<Format> {
  return sniffFormat(new Uint8Array(await file.slice(0, 32).arrayBuffer()), name);
}

export async function decodeAny(file: Blob, name: string): Promise<{ image: DecodedImage; format: Format }> {
  const format = await formatOf(file, name);
  try {
    switch (format) {
      case 'jpeg': case 'png': return { image: await decodeDisplay(file), format };
      case 'heic': return { image: await decodeHeic(file), format };
      case 'raw': return { image: await decodeRaw(file), format };
      default: throw new DecodeError('対応していない形式です', format);
    }
  } catch (e) {
    if (e instanceof DecodeError) throw e;
    throw new DecodeError(`デコードに失敗しました: ${e instanceof Error ? e.message : String(e)}`, format);
  }
}
