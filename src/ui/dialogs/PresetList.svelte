<script lang="ts">
  // プリセット一覧（仕様 4.3 / 5.1: PC は左のブラウザの下）。
  // - 名前をクリックで、フィルムストリップで選んだ写真（無ければ現在の画像）に適用（含まれる項目だけ上書き）
  // - 「現在の設定から作成」（グループを選ぶ）・「読み込み」（JSON）・各行の「書き出し」（JSON）・「削除」（組み込みは不可）
  // - 保存先はフォルダ方式ではユーザーが選ぶプリセットフォルダ、ライブラリ方式では OPFS の presets/
  import Download from 'lucide-svelte/icons/download';
  import Plus from 'lucide-svelte/icons/plus';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import Upload from 'lucide-svelte/icons/upload';
  import { onMount } from 'svelte';
  import { DEFAULT_COPY_GROUPS, pickGroups } from '../../params/partial';
  import { BUILTIN_PRESETS, parsePreset, serializePreset } from '../../params/presets';
  import type { ParamGroup, Preset } from '../../params/types';
  import { downloadFile } from '../backend';
  import { useApp } from '../context';
  import GroupPicker from './GroupPicker.svelte';
  import Modal from './Modal.svelte';

  const app = useApp();
  const folder = app.backend.kind === 'folder';

  let user = $state.raw<Preset[]>([]);
  /** フォルダ方式のプリセットフォルダ名（undefined は確認中、null は未指定） */
  let dir = $state<string | null | undefined>(folder ? undefined : null);
  let error = $state<string | null>(null);
  let info = $state<string | null>(null);
  let confirming = $state<string | null>(null);
  let creating = $state(false);
  let name = $state('');
  let groups = $state<ParamGroup[]>([...DEFAULT_COPY_GROUPS]);
  let fileInput: HTMLInputElement;

  /** プリセットを置ける状態か（フォルダ方式はプリセットフォルダが必要） */
  const ready = $derived(!folder || (dir !== null && dir !== undefined));
  const builtinNames = new Set(BUILTIN_PRESETS.map((p) => p.name));
  const trimmed = $derived(name.trim());
  const nameError = $derived(builtinNames.has(trimmed) ? '組み込みプリセットと同じ名前は使えません' : null);
  const overwriting = $derived(user.some((p) => p.name === trimmed));

  function message(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  async function reload(): Promise<void> {
    try {
      if (folder) dir = await app.dirName('presets');
      const list = await app.backend.presets.list();
      user = list.filter((p) => !builtinNames.has(p.name)).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    } catch (e) {
      error = `プリセットを読み込めません: ${message(e)}`;
    }
  }
  onMount(() => { void reload(); });

  async function chooseDir(): Promise<void> {
    error = null;
    try {
      if ((await app.chooseDir('presets')) !== null) await reload();
    } catch (e) {
      error = message(e);
    }
  }

  async function apply(p: Preset): Promise<void> {
    error = null;
    info = null;
    await app.editor.applyPreset(p, app.targets());
  }

  function fileName(n: string): string {
    // eslint-disable-next-line no-control-regex
    return `${n.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')}.json`;
  }

  function exportPreset(p: Preset): void {
    downloadFile(fileName(p.name), new Blob([serializePreset(p)], { type: 'application/json' }));
  }

  async function remove(p: Preset): Promise<void> {
    confirming = null;
    error = null;
    try {
      await app.backend.presets.remove(p.name);
    } catch (e) {
      error = `削除できません: ${message(e)}`;
    }
    await reload();
  }

  function startCreate(): void {
    name = '';
    groups = [...DEFAULT_COPY_GROUPS];
    creating = true;
  }

  async function create(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (trimmed === '' || nameError || groups.length === 0) return;
    error = null;
    try {
      await app.backend.presets.save({ name: trimmed, builtin: false, params: pickGroups(app.editor.params, groups) });
      creating = false;
    } catch (err) {
      error = `保存できません: ${message(err)}`;
      creating = false;
    }
    await reload();
  }

  async function importFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    error = null;
    info = null;
    const ok: string[] = [], ng: string[] = [];
    for (const f of files) {
      try {
        const p = parsePreset(await f.text());
        if (builtinNames.has(p.name)) throw new Error('組み込みプリセットと同じ名前です');
        await app.backend.presets.save(p);
        ok.push(p.name);
      } catch (e) {
        ng.push(`${f.name}（${message(e)}）`);
      }
    }
    fileInput.value = '';
    if (ok.length > 0) info = `読み込みました: ${ok.join('、')}`;
    if (ng.length > 0) error = `読み込めませんでした: ${ng.join('、')}`;
    await reload();
  }
</script>

{#snippet row(p: Preset)}
  <li class="item">
    {#if confirming === p.name}
      <span class="ask">「{p.name}」を削除しますか？</span>
      <button class="danger-btn" onclick={() => remove(p)}>削除する</button>
      <button onclick={() => (confirming = null)}>やめる</button>
    {:else}
      <button class="name" title="選択中の写真に適用" disabled={app.editor.currentId === null} onclick={() => apply(p)}>{p.name}</button>
      <button class="icon" aria-label={`${p.name} を書き出し`} title="JSON に書き出し" onclick={() => exportPreset(p)}><Download size={14} /></button>
      {#if !p.builtin}
        <button class="icon" aria-label={`${p.name} を削除`} title="削除" onclick={() => (confirming = p.name)}><Trash2 size={14} /></button>
      {/if}
    {/if}
  </li>
{/snippet}

<section class="presets" aria-label="プリセット">
  <h2>プリセット</h2>
  {#if folder}
    {#if dir === null}
      <p class="sub">プリセットを保存するフォルダを選んでください。</p>
      <button onclick={chooseDir}>プリセットフォルダを選ぶ</button>
    {:else if dir !== undefined}
      <p class="where sub"><span class="dir">保存先: {dir}</span><button class="link" aria-label="プリセットフォルダを変更" onclick={chooseDir}>変更</button></p>
    {/if}
  {/if}
  <div class="actions">
    <button disabled={!ready || app.editor.currentId === null} onclick={startCreate}><Plus size={14} /> 現在の設定から作成</button>
    <button disabled={!ready} onclick={() => fileInput.click()}><Upload size={14} /> 読み込み</button>
    <input bind:this={fileInput} type="file" accept=".json,application/json" multiple hidden onchange={(e) => importFiles(e.currentTarget.files)} />
  </div>
  {#if error}<p class="danger msg" role="alert">{error}</p>{/if}
  {#if info}<p class="sub msg">{info}</p>{/if}
  <ul>
    {#each BUILTIN_PRESETS as p (p.name)}{@render row(p)}{/each}
    {#each user as p (p.name)}{@render row(p)}{/each}
  </ul>
</section>

{#if creating}
  <Modal label="プリセットを作成" onclose={() => (creating = false)}>
    <form onsubmit={create}>
      <label class="field">
        <span>名前</span>
        <input type="text" aria-label="プリセット名" bind:value={name} maxlength="80" />
      </label>
      {#if nameError}<p class="danger">{nameError}</p>{:else if overwriting}<p class="sub">同じ名前のプリセットを上書きします</p>{/if}
      <GroupPicker bind:selected={groups} />
      <div class="dlg-actions">
        <button type="button" onclick={() => (creating = false)}>キャンセル</button>
        <button type="submit" class="primary" disabled={trimmed === '' || nameError !== null || groups.length === 0}>保存</button>
      </div>
    </form>
  </Modal>
{/if}

<style>
  .presets { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
  h2 { font-size: 12px; color: var(--text-sub); margin: 8px 0 0; font-weight: 600; }
  p { margin: 0; }
  .where { display: flex; align-items: center; gap: 4px; }
  .dir { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .link { border-color: transparent; min-width: 0; padding: 0 8px; color: var(--text-sub); }
  .actions { display: flex; flex-wrap: wrap; gap: 4px; }
  .actions button { flex: 1 1 auto; padding: 0 8px; }
  .msg { overflow-wrap: anywhere; }
  ul { list-style: none; margin: 0; padding: 0; }
  .item { display: flex; align-items: center; gap: 2px; }
  .item .name { flex: 1; justify-content: flex-start; border-color: transparent; padding: 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .ask { flex: 1; font-size: 12px; }
  .danger-btn { color: var(--danger); border-color: var(--danger); padding: 0 8px; }
  .field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
  .field input { min-height: var(--tap); padding: 0 8px; }
  .dlg-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
</style>
