<script lang="ts">
  // 設定メニュー。ライブラリ方式で永続化が許可されていなければ「データが消える可能性」と
  // ホーム画面への追加手順を表示する（仕様 2.4 / 7）。
  import Settings from 'lucide-svelte/icons/settings';
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import { useApp } from './context';

  const app = useApp();
  let open = $state(false);
  const warn = $derived(app.backend.kind === 'library' && app.persisted === false);
</script>

<div class="settings">
  <button class="icon" aria-label="設定" aria-expanded={open} onclick={() => (open = !open)}>
    <Settings size={18} />
    {#if warn}<span class="dot" aria-hidden="true"></span>{/if}
  </button>
  {#if open}
    <div class="menu" role="dialog" aria-label="設定">
      <h2>保存方式</h2>
      {#if app.backend.kind === 'folder'}
        <p>フォルダ方式: 編集内容は写真の隣のサイドカー（.json）に保存します。</p>
      {:else}
        <p>ライブラリ方式: 写真と編集内容はこの端末のブラウザ内だけに保存されます。</p>
        {#if warn}
          <div class="warn" data-testid="persist-warning">
            <p class="danger"><TriangleAlert size={14} /> データが消える可能性があります</p>
            <p class="sub">ブラウザがデータの永続保存を許可していません。しばらく使わないと、取り込んだ写真と編集内容が削除されることがあります。</p>
            <p>ホーム画面に追加すると消えにくくなります:</p>
            <ol>
              <li>Safari の共有ボタン（四角から矢印）をタップ</li>
              <li>「ホーム画面に追加」を選ぶ</li>
              <li>ホーム画面のアイコンから Lumen を開く</li>
            </ol>
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .settings { position: relative; }
  .dot { position: absolute; top: 10px; right: 10px; width: 6px; height: 6px; border-radius: 50%; background: var(--danger); }
  .menu {
    position: absolute; right: 0; top: calc(100% + 4px); z-index: 20; width: min(360px, calc(100vw - 16px));
    background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px 16px;
  }
  h2 { font-size: 13px; margin: 0 0 6px; color: var(--text-sub); font-weight: 600; }
  p { margin: 4px 0; display: flex; align-items: center; gap: 6px; }
  .warn { margin-top: 8px; border-top: 1px solid var(--line); padding-top: 8px; }
  ol { margin: 4px 0; padding-left: 20px; }
</style>
