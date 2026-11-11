<script lang="ts">
  // 画面上部の警告（仕様 4.2 / 7）。保存失敗は解決するまで常に表示する。
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
  import { useApp } from './context';

  const app = useApp();
  const ed = app.editor;

  const messages = $derived.by(() => {
    const out: { text: string; danger: boolean }[] = [];
    const s = ed.status;
    if (s.saveError) out.push({ text: `${s.saveError}（編集内容はメモリに保持し、次の操作時に再試行します）`, danger: true });
    if (app.error) out.push({ text: app.error, danger: true });
    if (s.corrupted) out.push({ text: 'サイドカーが壊れていたため既定値で開きました（元のファイルは .json.bak に退避しました）', danger: false });
    if (ed.currentId !== null && ed.readOnly && !s.corrupted && !s.notice) out.push({ text: '新しいバージョンで保存された編集のため、読み取り専用で開いています', danger: false });
    if (s.sourceChanged) out.push({ text: '元ファイルが変わった可能性があります（編集は適用しています）', danger: false });
    if (s.notice) out.push({ text: s.notice, danger: false });
    if (app.info) out.push({ text: app.info, danger: false });
    return out;
  });
</script>

{#if messages.length > 0}
  <div class="banner" role="status" data-testid="status-banner">
    {#each messages as m (m.text)}
      <p class:danger={m.danger}><TriangleAlert size={14} /> {m.text}</p>
    {/each}
  </div>
{/if}

<style>
  .banner { background: var(--panel); border-bottom: 1px solid var(--line); padding: 4px 12px; }
  p { margin: 2px 0; display: flex; align-items: center; gap: 6px; color: var(--text-sub); }
  p.danger { color: var(--danger); }
</style>
