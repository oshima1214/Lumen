<script lang="ts">
  // iPhone 画面（仕様 5.1、計画 Task 27）: 一覧画面と編集画面を切り替える。設定と警告は両方の画面で上に出す。
  import { useApp } from '../context';
  import SettingsMenu from '../SettingsMenu.svelte';
  import StatusBanner from '../StatusBanner.svelte';
  import Editor from './Editor.svelte';
  import Grid from './Grid.svelte';

  const app = useApp();
  let screen = $state<'grid' | 'edit'>('grid');

  function back(): void {
    if (app.tool === 'crop') app.commitCrop();
    screen = 'grid';
  }
</script>

<div class="mobile">
  {#if screen === 'grid'}
    <header class="top">
      <span class="logo">Lumen</span>
      <span class="spacer"></span>
      <SettingsMenu />
    </header>
    <StatusBanner />
    <main class="body"><Grid onopen={() => (screen = 'edit')} /></main>
  {:else}
    <StatusBanner />
    <main class="body"><Editor onback={back} /></main>
  {/if}
</div>

<style>
  .mobile { height: 100%; display: flex; flex-direction: column; }
  .top { display: flex; align-items: center; padding: env(safe-area-inset-top) 8px 0; background: var(--panel); border-bottom: 1px solid var(--line); min-height: 44px; }
  .logo { font-weight: 600; padding: 0 8px; }
  .spacer { flex: 1; }
  .body { flex: 1; min-height: 0; }
</style>
