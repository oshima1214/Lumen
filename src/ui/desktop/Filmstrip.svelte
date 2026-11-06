<script lang="ts">
  // 下のフィルムストリップ（仕様 5.1）。クリックで開く、Ctrl/Cmd+クリックで複数選択に追加、Shift+クリックで範囲選択。
  import { useApp } from '../context';
  import Thumb from './Thumb.svelte';

  const app = useApp();
  const ed = app.editor;

  // 開いた画像のレーティングを覚えておく（他の画像のサムネイルにも出すため）
  $effect(() => {
    const id = ed.currentId, r = ed.rating;
    if (id !== null) app.ratings.set(id, r);
  });

  // 現在の画像が見えるようにスクロールする
  let strip: HTMLElement;
  $effect(() => {
    const id = ed.currentId;
    if (id === null || !strip) return;
    const el = [...strip.querySelectorAll<HTMLElement>('[data-id]')].find((x) => x.dataset['id'] === id);
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  });

  function pick(id: string, e: MouseEvent): void {
    const mode = e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single';
    void app.select(id, mode);
  }
</script>

<div class="strip" bind:this={strip} data-testid="filmstrip" role="listbox" aria-label="フィルムストリップ" aria-multiselectable="true">
  {#each app.visible as ref (ref.id)}
    <Thumb {ref} selected={ed.selection.includes(ref.id)} current={ref.id === ed.currentId} onpick={(e) => pick(ref.id, e)} />
  {:else}
    {#if !app.loading && !app.needsPermission}
      <p class="sub empty">写真がありません</p>
    {/if}
  {/each}
</div>

<style>
  .strip { height: 100%; display: flex; align-items: center; gap: 6px; padding: 0 8px; overflow-x: auto; overflow-y: hidden; }
  .empty { margin: 0 auto; }
</style>
