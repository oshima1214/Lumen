<script lang="ts">
  // 書き出しダイアログ（仕様 6）。対象は開いた時点のフィルムストリップの選択（無ければ現在の画像）。
  // 設定 → 書き出し中（進捗とキャンセル）→ 結果（保存枚数と失敗一覧）の 3 段階。
  // 設定は書き出し開始時に localStorage へ記憶する（export-settings.ts）。
  import type { ExportResult } from '../../export/exporter';
  import type { WatermarkPosition } from '../../export/watermark';
  import { useApp } from '../context';
  import { loadExportForm, saveExportForm, SHARPEN_LEVELS, toExportSettings, WM_POSITIONS } from './export-settings';
  import Modal from './Modal.svelte';

  let { onclose }: { onclose: () => void } = $props();
  const app = useApp();
  const folder = app.backend.kind === 'folder';
  const ids = app.targets();

  let form = $state(loadExportForm());
  let customEdge = $state(form.longEdge ?? 2048);
  let wmImage = $state<File | null>(null);
  let dir = $state<string | null>(null);
  let phase = $state<'form' | 'running' | 'done'>('form');
  let done = $state(0);
  let result = $state.raw<ExportResult | null>(null);
  let error = $state<string | null>(null);
  let cancelling = $state(false);
  let controller: AbortController | null = null;

  if (folder) void app.dirName('export').then((n) => { dir = n; });

  const SHARPEN_LABEL: Record<string, string> = { none: 'なし', low: '弱', standard: '標準', high: '強' };
  const POS_LABEL: Record<WatermarkPosition, string> = {
    tl: '左上', t: '上', tr: '右上', l: '左', c: '中央', r: '右', bl: '左下', b: '下', br: '右下',
  };
  const canStart = $derived(ids.length > 0 && !(form.wmKind === 'image' && wmImage === null)
    && (form.longEdge === null || form.longEdge >= 1));

  function setOriginal(original: boolean): void {
    form.longEdge = original ? null : Math.max(1, Math.round(customEdge || 2048));
  }

  async function chooseDir(): Promise<void> {
    error = null;
    try {
      const n = await app.chooseDir('export');
      if (n !== null) dir = n;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function start(): Promise<void> {
    error = null;
    if (folder && dir === null) {
      await chooseDir();
      if (dir === null) { error = '書き出し先のフォルダを選んでください'; return; }
    }
    saveExportForm(form);
    const settings = toExportSettings(form, wmImage);
    controller = new AbortController();
    cancelling = false;
    done = 0;
    phase = 'running';
    try {
      result = await app.exportImages(ids, settings, (n) => { done = n; }, controller.signal);
    } catch (e) {
      result = { saved: [], failed: [], cancelled: false };
      error = `書き出しできません: ${e instanceof Error ? e.message : String(e)}`;
    }
    phase = 'done';
  }

  function cancel(): void {
    cancelling = true;
    controller?.abort();
  }
</script>

<Modal label="書き出し" {onclose} closable={phase !== 'running'}>
  {#if phase === 'form'}
    <form class="form" onsubmit={(e) => { e.preventDefault(); void start(); }}>
      <p class="target">対象: <span class="num">{ids.length} 枚</span></p>
      {#if folder}
        <div class="where">
          <span class="dir">書き出し先: {dir ?? '未指定'}</span>
          <button type="button" onclick={chooseDir}>書き出し先を選ぶ</button>
        </div>
      {:else}
        <p class="sub">共有シートが開きます。「画像を保存」で写真アプリに保存できます。</p>
      {/if}

      <fieldset>
        <legend>形式</legend>
        <label><input type="radio" name="format" value="jpeg" bind:group={form.format} /> JPEG</label>
        <label><input type="radio" name="format" value="png" bind:group={form.format} /> PNG</label>
      </fieldset>
      {#if form.format === 'jpeg'}
        <label class="field">
          <span>品質 <span class="num">{form.quality}</span></span>
          <input type="range" min="1" max="100" step="1" aria-label="JPEG 品質" bind:value={form.quality} />
        </label>
      {/if}

      <fieldset>
        <legend>サイズ</legend>
        <label><input type="radio" name="size" checked={form.longEdge === null} onchange={() => setOriginal(true)} /> 原寸</label>
        <label><input type="radio" name="size" checked={form.longEdge !== null} onchange={() => setOriginal(false)} /> 長辺</label>
        <input class="edge num" type="number" min="1" max="65535" step="1" aria-label="長辺のピクセル数" disabled={form.longEdge === null}
          bind:value={customEdge} oninput={() => setOriginal(false)} /> <span class="sub">px</span>
      </fieldset>

      <fieldset>
        <legend>色空間</legend>
        <label><input type="radio" name="space" value="srgb" bind:group={form.space} /> sRGB</label>
        <label><input type="radio" name="space" value="p3" bind:group={form.space} /> Display P3</label>
      </fieldset>

      <label class="field inline">
        <span>出力シャープ</span>
        <select bind:value={form.sharpen} aria-label="出力シャープ">
          {#each SHARPEN_LEVELS as l (l)}<option value={l}>{SHARPEN_LABEL[l]}</option>{/each}
        </select>
      </label>

      <label class="field">
        <span>ファイル名</span>
        <input type="text" aria-label="ファイル名のルール" bind:value={form.nameRule} />
        <span class="sub hint">{'{name}'} 元の名前、{'{seq}'} 連番（001〜）、{'{date}'} 撮影日（YYYYMMDD）</span>
      </label>

      <fieldset>
        <legend>透かし</legend>
        <label><input type="radio" name="wm" value="none" bind:group={form.wmKind} /> なし</label>
        <label><input type="radio" name="wm" value="text" bind:group={form.wmKind} /> 文字</label>
        <label><input type="radio" name="wm" value="image" bind:group={form.wmKind} /> 画像</label>
      </fieldset>
      {#if form.wmKind !== 'none'}
        <div class="wm">
          {#if form.wmKind === 'text'}
            <input type="text" aria-label="透かしの文字" placeholder="© 名前" bind:value={form.wmText} />
          {:else}
            <label class="field">
              <span>透かしの画像{wmImage ? `: ${wmImage.name}` : '（選んでください）'}</span>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" aria-label="透かしの画像"
                onchange={(e) => { wmImage = e.currentTarget.files?.[0] ?? null; }} />
            </label>
          {/if}
          <div class="pos" role="radiogroup" aria-label="透かしの位置">
            {#each WM_POSITIONS as p (p)}
              <label class="cell" title={POS_LABEL[p]}>
                <input type="radio" name="wmpos" value={p} aria-label={POS_LABEL[p]} bind:group={form.wmPosition} />
              </label>
            {/each}
          </div>
          <label class="field">
            <span>大きさ <span class="num">{Math.round(form.wmSize * 100)}%</span></span>
            <input type="range" min="0.02" max="0.5" step="0.01" aria-label="透かしの大きさ" bind:value={form.wmSize} />
          </label>
          <label class="field">
            <span>不透明度 <span class="num">{Math.round(form.wmOpacity * 100)}%</span></span>
            <input type="range" min="0" max="1" step="0.05" aria-label="透かしの不透明度" bind:value={form.wmOpacity} />
          </label>
        </div>
      {/if}

      <label class="check"><input type="checkbox" bind:checked={form.stripGps} /> 位置情報（GPS）を除去</label>

      {#if error}<p class="danger" role="alert">{error}</p>{/if}
      <div class="actions">
        <button type="button" onclick={onclose}>キャンセル</button>
        <button type="submit" class="primary" disabled={!canStart}>書き出す</button>
      </div>
    </form>
  {:else if phase === 'running'}
    <div class="running">
      <div class="bar" role="progressbar" aria-label="書き出しの進捗" aria-valuemin="0" aria-valuemax={ids.length} aria-valuenow={done}>
        <div class="fill" style:width={`${(done / Math.max(1, ids.length)) * 100}%`}></div>
      </div>
      <p class="num">{done} / {ids.length}</p>
      <div class="actions">
        <button onclick={cancel} disabled={cancelling}>{cancelling ? 'キャンセル中…' : 'キャンセル'}</button>
      </div>
    </div>
  {:else if result}
    <div class="result">
      {#if result.cancelled}<p>キャンセルしました</p>{/if}
      <p>{result.saved.length} 枚を保存しました</p>
      {#if folder && dir}<p class="sub">保存先: {dir}</p>{/if}
      {#if error}<p class="danger" role="alert">{error}</p>{/if}
      {#if result.failed.length > 0}
        <p class="danger">{result.failed.length} 枚は書き出せませんでした</p>
        <ul class="failed" aria-label="書き出せなかった写真">
          {#each result.failed as f (f.id)}
            <li><span class="fname">{app.nameOf(f.id)}</span><span class="sub">{f.reason}</span></li>
          {/each}
        </ul>
      {/if}
      <div class="actions">
        <button class="primary" onclick={onclose}>閉じる</button>
      </div>
    </div>
  {/if}
</Modal>

<style>
  .form { display: flex; flex-direction: column; gap: 10px; }
  p { margin: 0; }
  fieldset { border: 0; margin: 0; padding: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; }
  legend { color: var(--text-sub); padding: 0; margin-bottom: 2px; width: 100%; }
  fieldset label, .check { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; cursor: pointer; }
  input[type="radio"], input[type="checkbox"] { accent-color: var(--accent); width: 16px; height: 16px; }
  input[type="range"] { accent-color: var(--accent); width: 100%; }
  input[type="text"], input[type="number"], select { min-height: 36px; padding: 0 8px; }
  .edge { width: 96px; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field.inline { flex-direction: row; align-items: center; justify-content: space-between; }
  .hint { font-size: 12px; }
  .where { display: flex; align-items: center; gap: 8px; }
  .dir { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wm { display: flex; flex-direction: column; gap: 8px; padding-left: 8px; border-left: 2px solid var(--line); }
  .pos { display: grid; grid-template-columns: repeat(3, 32px); gap: 4px; }
  .cell { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: 1px solid var(--line); border-radius: 4px; cursor: pointer; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
  .running { display: flex; flex-direction: column; gap: 8px; }
  .bar { height: 8px; background: var(--bg); border-radius: 4px; overflow: hidden; }
  .fill { height: 100%; background: var(--accent); transition: width 0.2s; }
  .result { display: flex; flex-direction: column; gap: 6px; }
  .failed { margin: 0; padding-left: 18px; max-height: 200px; overflow: auto; }
  .failed li { display: flex; flex-direction: column; }
  .fname { overflow-wrap: anywhere; }
</style>
