<script lang="ts">
  // 起動（計画 Task 22）: 実行環境を判定し、非対応なら理由を表示、対応していれば保存方式と GPU を用意して Shell を出す。
  import { onMount } from 'svelte';
  import { detectPlatform, readEnv } from './platform/detect';
  import { startApp, type App } from './ui/app.svelte';
  import Shell from './ui/Shell.svelte';
  import Unsupported from './ui/Unsupported.svelte';

  const platform = detectPlatform(readEnv());
  let app = $state<App | null>(null);
  let reason = $state<string | null>(platform.backend === null ? platform.unsupportedReason : null);

  onMount(() => {
    if (platform.backend === null) return;
    void startApp(platform).then((r) => {
      if (r.ok) { app = r.app; void r.app.init(); } else reason = r.reason;
    });
  });
</script>

{#if reason !== null}
  <Unsupported {reason} />
{:else if app}
  <Shell {app} />
{:else}
  <p class="booting sub">読み込み中…</p>
{/if}

<style>
  .booting { margin: 0; padding: 24px; }
</style>
