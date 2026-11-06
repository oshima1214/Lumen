<script lang="ts">
  // 設定グループの選択（仕様 4.4: WB、基本補正、トーンカーブ、HSL、カラーグレーディング、切り抜き）。
  // 「設定をコピー」とプリセットの作成で使う。
  import type { ParamGroup } from '../../params/types';

  let { selected = $bindable() }: { selected: ParamGroup[] } = $props();

  const GROUPS: [ParamGroup, string][] = [
    ['wb', 'ホワイトバランス'], ['basic', '基本補正'], ['curve', 'トーンカーブ'],
    ['hsl', 'HSL'], ['grading', 'カラーグレーディング'], ['crop', '切り抜き'],
  ];

  function toggle(g: ParamGroup, on: boolean): void {
    const set = new Set(selected);
    if (on) set.add(g); else set.delete(g);
    // 表示順に並べる
    selected = GROUPS.map(([k]) => k).filter((k) => set.has(k));
  }
</script>

<fieldset class="groups">
  <legend class="sub">対象の設定</legend>
  {#each GROUPS as [g, label] (g)}
    <label class="row">
      <input type="checkbox" checked={selected.includes(g)} onchange={(e) => toggle(g, e.currentTarget.checked)} />
      <span>{label}</span>
    </label>
  {/each}
  <div class="all">
    <button type="button" onclick={() => (selected = GROUPS.map(([k]) => k))}>すべて選択</button>
    <button type="button" onclick={() => (selected = [])}>すべて解除</button>
  </div>
</fieldset>

<style>
  .groups { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; }
  legend { padding: 0; margin-bottom: 4px; }
  .row { display: flex; align-items: center; gap: 10px; min-height: var(--tap); cursor: pointer; }
  .row input { width: 18px; height: 18px; accent-color: var(--accent); }
  .all { display: flex; gap: 8px; margin-top: 4px; }
</style>
