<script lang="ts">
  // 「設定をコピー」ダイアログ（仕様 4.4）。グループ単位で選ぶ。WB と切り抜きは既定でオフ（開くたびに既定に戻す）。
  // ペーストは Ctrl+Shift+V / ツールバーで、フィルムストリップの選択全件に行う（App.paste）。
  import { DEFAULT_COPY_GROUPS } from '../../params/partial';
  import type { ParamGroup } from '../../params/types';
  import { useApp } from '../context';
  import GroupPicker from './GroupPicker.svelte';
  import Modal from './Modal.svelte';

  let { onclose }: { onclose: () => void } = $props();
  const app = useApp();
  let selected = $state<ParamGroup[]>([...DEFAULT_COPY_GROUPS]);

  function copy(e: SubmitEvent): void {
    e.preventDefault();
    app.copy(selected);
    onclose();
  }
</script>

<Modal label="設定をコピー" {onclose}>
  <form onsubmit={copy}>
    <GroupPicker bind:selected />
    <p class="sub">コピーした設定は、フィルムストリップで選んだ写真に「設定をペースト」（Ctrl+Shift+V）で貼り付けます。</p>
    <div class="actions">
      <button type="button" onclick={onclose}>キャンセル</button>
      <button type="submit" class="primary" disabled={selected.length === 0}>コピー</button>
    </div>
  </form>
</Modal>

<style>
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
</style>
