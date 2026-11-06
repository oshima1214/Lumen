<script lang="ts">
  // アプリの外枠（仕様 5.1）。幅 1024px 以上で PC 画面、未満で iPhone 画面を表示する。
  import type { App } from './app.svelte';
  import { provideApp } from './context';
  import DesktopLayout from './desktop/DesktopLayout.svelte';
  import MobileShell from './mobile/MobileShell.svelte';

  let { app }: { app: App } = $props();
  // svelte-ignore state_referenced_locally
  provideApp(app);

  const query = matchMedia('(min-width: 1024px)');
  let wide = $state(query.matches);
  $effect(() => {
    const on = () => (wide = query.matches);
    query.addEventListener('change', on);
    return () => query.removeEventListener('change', on);
  });
</script>

{#if wide}
  <DesktopLayout />
{:else}
  <MobileShell />
{/if}
