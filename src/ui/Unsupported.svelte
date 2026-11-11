<script lang="ts">
  // 非対応画面（仕様 7: WebGPU がない / OPFS もない）。理由と必要な環境を表示して止まる。
  import TriangleAlert from 'lucide-svelte/icons/triangle-alert';

  let { reason }: { reason: string } = $props();
</script>

<main class="unsupported" data-testid="unsupported">
  <div class="box">
    <h1><TriangleAlert size={20} color="var(--danger)" /> Lumen を起動できません</h1>
    <p class="reason">{reason}</p>
    <p class="sub">必要な環境:</p>
    <ul class="sub">
      <li>PC: 最新の Chrome または Edge（WebGPU 対応）</li>
      <li>iPhone: iOS 26 以降の Safari</li>
    </ul>
  </div>
</main>

<style>
  .unsupported { height: 100%; display: grid; place-items: center; padding: 24px; }
  .box { max-width: 520px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 12px; display: flex; align-items: center; gap: 8px; }
  .reason { font-size: 14px; margin: 0 0 16px; }
  ul { margin: 4px 0 0; padding-left: 20px; }
  p { margin: 0; }
</style>
