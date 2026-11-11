// ファイル名の規則（仕様 2.4 / 4.1 / 6）。

export const IMAGE_EXTS: string[] = [
  'jpg', 'jpeg', 'png', 'heic', 'heif',
  'cr2', 'cr3', 'nef', 'nrw', 'arw', 'dng', 'raf', 'orf', 'rw2', 'pef', 'srw',
];

const EXT_SET = new Set(IMAGE_EXTS);

/** 最後の '.' より後ろ（小文字）。'.' が無い・先頭だけなら '' */
export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** 画像として一覧に出すファイル名か。'.' で始まるもの（macOS の '._*' を含む）とサイドカーは除く */
export function isImageName(name: string): boolean {
  if (name.startsWith('.')) return false;
  return EXT_SET.has(extOf(name));
}

/** フォルダ方式のサイドカー名（仕様 4.1）: 元ファイル名 + '.json' */
export function sidecarName(name: string): string {
  return `${name}.json`;
}

/** 重複しない名前: "a.jpg" → "a-2.jpg" → "a-3.jpg" … */
export function uniqueName(name: string, exists: (n: string) => boolean): string {
  if (!exists(name)) return name;
  const i = name.lastIndexOf('.');
  const stem = i > 0 ? name.slice(0, i) : name;
  const ext = i > 0 ? name.slice(i) : '';
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!exists(candidate)) return candidate;
  }
}
