<script lang="ts">
  // iPhone 画面の仮置き（計画 Task 22）。一覧・編集・ジェスチャーは Task 27 で作る。
  // ここではツールのタブ（仕様 5.1）と設定・警告だけを置く。
  import { useApp } from '../context';
  import SettingsMenu from '../SettingsMenu.svelte';
  import StatusBanner from '../StatusBanner.svelte';

  const app = useApp();
  const TABS = ['ライト', 'カラー', 'カーブ', 'HSL', 'グレーディング', '切り抜き', 'プリセット'] as const;
  let tab = $state<(typeof TABS)[number]>('ライト');
  const addLabel = app.backend.kind === 'folder' ? 'フォルダを開く' : '写真を取り込む';
</script>

<div class="mobile">
  <header class="top">
    <span class="logo">Lumen</span>
    <span class="spacer"></span>
    <SettingsMenu />
  </header>
  <StatusBanner />
  <main class="photo">
    {#if app.editor.images.length === 0}
      <button class="primary" onclick={() => app.addSource()}>{addLabel}</button>
    {/if}
  </main>
  <nav class="tabs" data-testid="tool-tabs" aria-label="ツール">
    {#each TABS as t (t)}
      <button class:active={tab === t} aria-pressed={tab === t} onclick={() => (tab = t)}>{t}</button>
    {/each}
  </nav>
</div>

<style>
  .mobile { height: 100%; display: flex; flex-direction: column; }
  .top { display: flex; align-items: center; padding: env(safe-area-inset-top) 8px 0; background: var(--panel); border-bottom: 1px solid var(--line); }
  .logo { font-weight: 600; padding: 0 8px; }
  .spacer { flex: 1; }
  .photo { flex: 1; min-height: 0; display: grid; place-items: center; }
  .tabs {
    display: flex; overflow-x: auto; gap: 2px; padding: 4px 4px calc(4px + env(safe-area-inset-bottom));
    background: var(--panel); border-top: 1px solid var(--line);
  }
  .tabs button { border-color: transparent; white-space: nowrap; flex: none; }
</style>
