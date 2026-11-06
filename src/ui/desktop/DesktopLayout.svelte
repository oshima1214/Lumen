<script lang="ts">
  // PC 画面の配置（仕様 5.1）: 上にツールバー、左にブラウザ、中央にビューア、右にパネル、下にフィルムストリップ。
  import FolderOpen from 'lucide-svelte/icons/folder-open';
  import { useApp } from '../context';
  import SettingsMenu from '../SettingsMenu.svelte';
  import StatusBanner from '../StatusBanner.svelte';

  const app = useApp();
  const addLabel = app.backend.kind === 'folder' ? 'フォルダを開く' : '写真を取り込む';
</script>

<div class="desktop">
  <header class="top">
    <span class="logo">Lumen</span>
    <span class="spacer"></span>
    <SettingsMenu />
  </header>
  <div class="banner"><StatusBanner /></div>
  <aside class="left" aria-label="ブラウザ">
    <button onclick={() => app.addSource()}><FolderOpen size={16} /> {addLabel}</button>
  </aside>
  <main class="center" aria-label="ビューア"></main>
  <aside class="right" data-testid="right-panel" aria-label="調整パネル"></aside>
  <footer class="film" aria-label="フィルムストリップ"></footer>
</div>

<style>
  .desktop {
    height: 100%;
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr) 320px;
    grid-template-rows: auto auto minmax(0, 1fr) 120px;
    grid-template-areas: "top top top" "banner banner banner" "left center right" "film film film";
  }
  .top { grid-area: top; display: flex; align-items: center; gap: 4px; padding: 0 8px; background: var(--panel); border-bottom: 1px solid var(--line); }
  .logo { font-weight: 600; letter-spacing: 0.04em; padding: 0 8px; }
  .spacer { flex: 1; }
  .banner { grid-area: banner; }
  .left { grid-area: left; background: var(--panel); border-right: 1px solid var(--line); overflow: auto; padding: 8px; }
  .center { grid-area: center; min-width: 0; min-height: 0; position: relative; }
  .right { grid-area: right; background: var(--panel); border-left: 1px solid var(--line); overflow: auto; }
  .film { grid-area: film; background: var(--panel); border-top: 1px solid var(--line); min-width: 0; }
</style>
