<script lang="ts">
  // PC 画面の配置（仕様 5.1）: 上にツールバー、左にブラウザ、中央にビューア、右にパネル、下にフィルムストリップ。
  // キーボードショートカット（仕様 5.1）もここで受ける。
  import Redo2 from 'lucide-svelte/icons/redo-2';
  import Undo2 from 'lucide-svelte/icons/undo-2';
  import { DEFAULT_COPY_GROUPS } from '../../params/partial';
  import { useApp } from '../context';
  import SettingsMenu from '../SettingsMenu.svelte';
  import { isTyping, shortcutAction, type Action } from '../shortcuts';
  import StatusBanner from '../StatusBanner.svelte';
  import Browser from './Browser.svelte';
  import Filmstrip from './Filmstrip.svelte';
  import RightPanel from './RightPanel.svelte';
  import Viewer from './Viewer.svelte';

  const app = useApp();
  const ed = app.editor;

  function run(a: Action): void {
    if (typeof a === 'object') { ed.setRating(a.rating); return; }
    switch (a) {
      case 'next': void app.step(1); break;
      case 'prev': void app.step(-1); break;
      case 'undo': ed.undo(); break;
      case 'redo': ed.redo(); break;
      // 「設定をコピー」ダイアログと書き出しダイアログは Task 26、切り抜きツールは Task 25 で置き換える
      case 'copy': ed.copy(DEFAULT_COPY_GROUPS); break;
      case 'paste': void ed.paste(ed.selection.length > 0 ? ed.selection : ed.currentId !== null ? [ed.currentId] : []); break;
      case 'crop': if (app.tool === 'crop') app.commitCrop(); else app.enterCrop(); break;
      case 'export': app.exportRequested++; break;
      case 'beforeAfter': if (!ed.view.before) ed.setView({ before: true }); break;
    }
  }

  function keydown(e: KeyboardEvent): void {
    if (isTyping(e.target)) return;
    const a = shortcutAction(e);
    if (a === null) return;
    e.preventDefault();
    if (e.repeat && a !== 'next' && a !== 'prev' && a !== 'undo' && a !== 'redo') return;
    run(a);
  }

  function keyup(e: KeyboardEvent): void {
    if ((e.key === '\\' || e.key === '¥') && ed.view.before) ed.setView({ before: false });
  }

  function blur(): void {
    if (ed.view.before) ed.setView({ before: false });
  }
</script>

<svelte:window onkeydown={keydown} onkeyup={keyup} onblur={blur} />

<div class="desktop">
  <header class="top">
    <span class="logo">Lumen</span>
    <button class="icon" aria-label="取り消し" title="取り消し（Ctrl+Z）" disabled={!ed.canUndo} onclick={() => ed.undo()}><Undo2 size={18} /></button>
    <button class="icon" aria-label="やり直し" title="やり直し（Ctrl+Shift+Z）" disabled={!ed.canRedo} onclick={() => ed.redo()}><Redo2 size={18} /></button>
    <span class="spacer"></span>
    <span class="sub name">{ed.images.find((r) => r.id === ed.currentId)?.name ?? ''}</span>
    <span class="spacer"></span>
    <SettingsMenu />
  </header>
  <div class="banner"><StatusBanner /></div>
  <aside class="left"><Browser /></aside>
  <main class="center"><Viewer /></main>
  <aside class="right" data-testid="right-panel" aria-label="調整パネル"><RightPanel /></aside>
  <footer class="film"><Filmstrip /></footer>
</div>

<style>
  .desktop {
    height: 100%;
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr) 320px;
    grid-template-rows: auto auto minmax(0, 1fr) 112px;
    grid-template-areas: "top top top" "banner banner banner" "left center right" "film film film";
  }
  .top { grid-area: top; display: flex; align-items: center; gap: 4px; padding: 0 8px; background: var(--panel); border-bottom: 1px solid var(--line); }
  .logo { font-weight: 600; letter-spacing: 0.04em; padding: 0 8px; }
  .spacer { flex: 1; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .banner { grid-area: banner; }
  .left { grid-area: left; background: var(--panel); border-right: 1px solid var(--line); overflow: auto; padding: 8px; }
  .center { grid-area: center; min-width: 0; min-height: 0; }
  .right { grid-area: right; background: var(--panel); border-left: 1px solid var(--line); overflow: auto; }
  .film { grid-area: film; background: var(--panel); border-top: 1px solid var(--line); min-width: 0; }
</style>
