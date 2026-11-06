<script lang="ts">
  // ダイアログの外枠。ネイティブの <dialog> をモーダルで開く（フォーカスの閉じ込めと Esc は標準の動作）。
  // 表示中は PC 画面のショートカットを止める（DesktopLayout が dialog[open] を見る）。
  import type { Snippet } from 'svelte';

  let { label, onclose, closable = true, children }: {
    label: string;
    onclose: () => void;
    /** false の間は Esc で閉じない（書き出し中など） */
    closable?: boolean;
    children: Snippet;
  } = $props();

  let el: HTMLDialogElement;
  $effect(() => {
    el.showModal();
    return () => { if (el.open) el.close(); };
  });

  function cancel(e: Event): void {
    e.preventDefault();
    if (closable) onclose();
  }
</script>

<dialog bind:this={el} aria-label={label} oncancel={cancel}>
  <h2>{label}</h2>
  {@render children()}
</dialog>

<style>
  dialog {
    background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 8px;
    padding: 16px 20px; width: min(480px, calc(100vw - 16px)); max-height: calc(100vh - 32px); overflow: auto;
  }
  dialog::backdrop { background: rgba(0, 0, 0, 0.55); }
  h2 { font-size: 15px; margin: 0 0 12px; font-weight: 600; }
</style>
