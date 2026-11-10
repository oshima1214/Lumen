<script lang="ts">
  // 書き出しが終わったら「共有する」を押してもらう（共有シートはタップ直後にしか開けないため。最終レビュー I3）
  import { useApp } from '../context';
  import { deliverShare } from './share';

  let { files, failed, ondone }: { files: File[]; failed: number; ondone: () => void } = $props();
  const app = useApp();
  let error = $state<string | null>(null);

  async function send(): Promise<void> {
    try { await deliverShare(app, files); ondone(); } catch (e) { error = e instanceof Error ? e.message : String(e); }
  }
</script>

<div class="prompt" role="dialog" aria-label="共有">
  <p>{files.length} 枚の書き出しができました{failed > 0 ? `（${failed} 枚は書き出せませんでした）` : ''}</p>
  {#if error}<p class="danger">{error}</p>{/if}
  <div class="row">
    <button onclick={ondone}>やめる</button>
    <button class="primary" disabled={files.length === 0} onclick={send}>共有する（{files.length} 枚）</button>
  </div>
</div>

<style>
  .prompt { position: fixed; left: 8px; right: 8px; bottom: calc(80px + env(safe-area-inset-bottom)); z-index: 10;
    background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.5); }
  .row { display: flex; gap: 8px; justify-content: flex-end; }
  .row button { min-height: 44px; }
  .primary { background: var(--accent); color: #1c1c1c; border-color: var(--accent); }
  .danger { color: var(--danger); }
</style>
