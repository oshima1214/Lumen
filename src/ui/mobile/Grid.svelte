<script lang="ts">
  // iPhone の一覧画面（仕様 5.1）: サムネイルのグリッド、右下の「＋（取り込み）」。
  // 長押しで複数選択モード → 設定の貼り付け・共有（書き出し）・削除（ライブラリ方式のみ）。
  import Plus from 'lucide-svelte/icons/plus';
  import Thumb from '../desktop/Thumb.svelte';
  import { useApp } from '../context';
  import { shareImages } from './share';

  let { onopen }: { onopen: () => void } = $props();
  const app = useApp();
  const ed = app.editor;
  let selecting = $state(false);
  let picked = $state<string[]>([]);
  let busy = $state<string | null>(null);
  const addLabel = app.backend.kind === 'folder' ? 'フォルダを開く' : '写真を取り込む';

  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressed = false;
  function pressStart(id: string): void {
    longPressed = false;
    pressTimer = setTimeout(() => { longPressed = true; selecting = true; if (!picked.includes(id)) picked = [...picked, id]; }, 500);
  }
  function pressEnd(): void { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }

  async function tap(id: string): Promise<void> {
    if (longPressed) { longPressed = false; return; }
    if (selecting) { picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]; return; }
    await app.select(id);
    onopen();
  }
  function done(): void { selecting = false; picked = []; }

  async function paste(): Promise<void> { busy = '貼り付け中…'; await ed.paste(picked); busy = null; done(); }
  async function share(): Promise<void> {
    busy = '書き出し中…';
    const r = await shareImages(app, picked, (d, t) => (busy = `書き出し中… ${d}/${t}`));
    busy = r.failed.length ? `${r.failed.length} 枚を書き出せませんでした` : null;
    done();
  }
  async function remove(): Promise<void> {
    if (app.backend.kind !== 'library' || !app.backend.remove) return;
    if (!confirm(`${picked.length} 枚をライブラリから削除します。元に戻せません。`)) return;
    for (const id of picked) await app.backend.remove(id);
    done();
    await ed.refresh();
  }
</script>

<div class="grid-screen">
  {#if selecting}
    <div class="bar">
      <span>{picked.length} 枚を選択</span>
      <span class="spacer"></span>
      <button onclick={paste} disabled={picked.length === 0}>設定を貼り付け</button>
      <button onclick={share} disabled={picked.length === 0}>共有</button>
      {#if app.backend.kind === 'library'}<button class="danger" onclick={remove} disabled={picked.length === 0}>削除</button>{/if}
      <button onclick={done}>完了</button>
    </div>
  {/if}
  {#if busy}<p class="busy sub">{busy}</p>{/if}
  {#if ed.images.length === 0 && !app.loading}
    <p class="empty sub">右下の「＋」から写真を取り込んでください</p>
  {/if}
  <div class="grid">
    {#each app.visible as ref (ref.id)}
      <div class="cell" data-testid="grid-item" class:picked={picked.includes(ref.id)} role="presentation"
        onpointerdown={() => pressStart(ref.id)} onpointerup={pressEnd} onpointerleave={pressEnd} onpointercancel={pressEnd}>
        <Thumb {ref} selected={picked.includes(ref.id)} current={false} onpick={() => tap(ref.id)} />
      </div>
    {/each}
  </div>
  <button class="fab" aria-label={addLabel} title={addLabel} onclick={() => app.addSource()}><Plus size={28} /></button>
</div>

<style>
  .grid-screen { position: relative; height: 100%; overflow-y: auto; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; padding: 2px; }
  .cell { aspect-ratio: 1; overflow: hidden; }
  .cell :global(button) { width: 100%; height: 100%; }
  .cell.picked { outline: 3px solid var(--accent); outline-offset: -3px; }
  .bar { position: sticky; top: 0; z-index: 1; display: flex; gap: 4px; align-items: center; padding: 4px 8px; background: var(--panel); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .spacer { flex: 1; }
  .danger { color: var(--danger); }
  .busy, .empty { padding: 12px; text-align: center; }
  .fab {
    position: fixed; right: 16px; bottom: calc(76px + env(safe-area-inset-bottom)); width: 56px; height: 56px; border-radius: 50%;
    background: var(--accent); color: #1c1c1c; border: 0; display: grid; place-items: center; box-shadow: 0 2px 8px rgba(0,0,0,0.5);
  }
</style>
