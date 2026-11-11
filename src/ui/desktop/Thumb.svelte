<script lang="ts">
  // フィルムストリップの 1 枚。画面に入ったらサムネイル（IndexedDB キャッシュ、RAW は埋め込み JPEG）を読む。
  // 読めなければ data-error に理由を入れてエラー表示にする（仕様 7: その写真だけ）。
  import ImageOff from 'lucide-svelte/icons/image-off';
  import Star from 'lucide-svelte/icons/star';
  import type { ImageRef } from '../../storage/types';
  import { useApp } from '../context';

  let { ref, selected, current, onpick }: {
    ref: ImageRef; selected: boolean; current: boolean;
    onpick: (e: MouseEvent) => void;
  } = $props();

  const app = useApp();
  let url = $state<string | null>(null);
  let thumbError = $state<string | null>(null);
  let el: HTMLElement;

  const error = $derived(thumbError ?? (current ? app.editor.status.decodeError : null));
  const rating = $derived(current ? app.editor.rating : app.ratings.get(ref.id));

  $effect(() => {
    const r = ref;
    let alive = true;
    let made: string | null = null;
    const load = () => {
      app.thumbs.get(r).then((blob) => {
        if (!alive) return;
        made = URL.createObjectURL(blob);
        url = made;
      }, (e: unknown) => {
        if (alive) thumbError = e instanceof Error ? e.message : String(e);
      });
    };
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver((entries) => {
        if (entries.some((x) => x.isIntersecting)) { io?.disconnect(); io = null; load(); }
      }, { rootMargin: '200px' });
      io.observe(el);
    } else load();
    return () => {
      alive = false;
      io?.disconnect();
      if (made) URL.revokeObjectURL(made);
      url = null;
      thumbError = null;
    };
  });
</script>

<button
  bind:this={el}
  class="thumb"
  class:selected
  class:current
  role="option"
  aria-selected={selected}
  data-id={ref.id}
  data-error={error ?? undefined}
  data-rating={rating ?? undefined}
  title={error ? `${ref.name}: ${error}` : ref.name}
  onclick={onpick}
>
  {#if error}
    <span class="err"><ImageOff size={20} /><span>{error}</span></span>
  {:else if url}
    <img src={url} alt={ref.name} draggable="false" />
  {:else}
    <span class="sub loading">…</span>
  {/if}
  {#if rating}
    <span class="rating num" aria-label={`レーティング ${rating}`}><Star size={10} fill="currentColor" />{rating}</span>
  {/if}
</button>

<style>
  .thumb {
    position: relative; flex: none; width: 104px; height: 88px; padding: 2px; border: 2px solid transparent;
    border-radius: 4px; background: var(--bg); overflow: hidden;
  }
  .thumb.selected { border-color: var(--text-sub); }
  .thumb.current { border-color: var(--accent); }
  img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .err {
    display: flex; flex-direction: column; align-items: center; gap: 2px; color: var(--danger);
    font-size: 10px; line-height: 1.2; text-align: center; overflow: hidden; max-height: 100%;
  }
  .rating {
    position: absolute; left: 4px; bottom: 3px; font-size: 10px; color: var(--accent);
    display: inline-flex; align-items: center; gap: 1px; background: rgba(0, 0, 0, 0.6); padding: 0 3px; border-radius: 3px;
  }
  .loading { font-size: 16px; }
</style>
