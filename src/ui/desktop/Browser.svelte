<script lang="ts">
  // 左のブラウザ（仕様 5.1）: フォルダ方式はフォルダツリー、ライブラリ方式は取り込み日の一覧。
  // フォルダの権限が失効していれば「アクセスを再許可」を出す（仕様 7）。その下にプリセット一覧。
  import FolderOpen from 'lucide-svelte/icons/folder-open';
  import ImagePlus from 'lucide-svelte/icons/image-plus';
  import { useApp } from '../context';
  import PresetList from '../dialogs/PresetList.svelte';

  const app = useApp();
  const folder = app.backend.kind === 'folder';

  /** グループ（相対パス／取り込み日）と枚数。フォルダ方式は親フォルダも並べる */
  const groups = $derived.by(() => {
    const count = new Map<string, number>();
    for (const r of app.editor.images) {
      if (folder) {
        const parts = r.group === '' ? [] : r.group.split('/');
        for (let i = 1; i <= parts.length; i++) {
          const g = parts.slice(0, i).join('/');
          count.set(g, (count.get(g) ?? 0) + 1);
        }
      } else count.set(r.group, (count.get(r.group) ?? 0) + 1);
    }
    const keys = [...count.keys()].sort();
    if (!folder) keys.reverse(); // 新しい取り込み日を上に
    return keys.map((g) => ({ g, n: count.get(g) ?? 0, depth: folder ? g.split('/').length : 1, label: folder ? g.split('/').pop() ?? g : g }));
  });
</script>

<nav class="browser" aria-label="ブラウザ">
  {#if app.needsPermission}
    <div class="perm">
      <p>前回開いたフォルダへのアクセス許可が切れています。</p>
      <button class="primary" onclick={() => app.regrant()}>アクセスを再許可</button>
    </div>
  {/if}
  <button class="add" onclick={() => app.addSource()}>
    {#if folder}<FolderOpen size={16} /> フォルダを開く{:else}<ImagePlus size={16} /> 写真を取り込む{/if}
  </button>
  {#if app.editor.images.length > 0}
    <h2>{folder ? 'フォルダ' : '取り込み日'}</h2>
    <ul>
      <li>
        <button class="row" aria-pressed={app.group === null} onclick={() => app.showGroup(null)}>
          <span>すべての写真</span><span class="num sub">{app.editor.images.length}</span>
        </button>
      </li>
      {#each groups as x (x.g)}
        <li>
          <button class="row" aria-pressed={app.group === x.g} style:padding-left={`${8 + x.depth * 12}px`} onclick={() => app.showGroup(x.g)}>
            <span class="name">{x.label}</span><span class="num sub">{x.n}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if !app.needsPermission}<PresetList />{/if}
</nav>

<style>
  .browser { display: flex; flex-direction: column; gap: 8px; }
  .perm { border: 1px solid var(--accent); border-radius: 6px; padding: 8px; }
  .perm p { margin: 0 0 8px; }
  .perm button { width: 100%; }
  .add { width: 100%; }
  h2 { font-size: 12px; color: var(--text-sub); margin: 8px 0 0; font-weight: 600; }
  ul { list-style: none; margin: 0; padding: 0; }
  .row { width: 100%; justify-content: space-between; border-color: transparent; padding: 0 8px; }
  .row[aria-pressed="true"] { color: var(--accent); border-color: transparent; background: var(--line); }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
