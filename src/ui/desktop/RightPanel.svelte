<script lang="ts">
  // 右のパネル（仕様 5.1）: ヒストグラム、基本補正（WB を含む）/ トーンカーブ / HSL / カラーグレーディング / 切り抜き。
  import ChevronDown from 'lucide-svelte/icons/chevron-down';
  import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
  import { useApp } from '../context';
  import BasicPanel from '../panels/BasicPanel.svelte';
  import GradingPanel from '../panels/GradingPanel.svelte';
  import Histogram from '../panels/Histogram.svelte';
  import HslPanel from '../panels/HslPanel.svelte';
  import WbPanel from '../panels/WbPanel.svelte';
  import CurveEditor from '../panels/CurveEditor.svelte';
  import CropTool from '../panels/CropTool.svelte';

  const app = useApp();
  const ed = app.editor;
  type Section = 'basic' | 'curve' | 'hsl' | 'grading' | 'crop';
  const SECTIONS: [Section, string][] = [['basic', '基本補正'], ['curve', 'トーンカーブ'], ['hsl', 'HSL'], ['grading', 'カラーグレーディング'], ['crop', '切り抜き']];
  let open = $state<Record<Section, boolean>>({ basic: true, curve: false, hsl: true, grading: true, crop: false });
  // 切り抜きツールに入ったら切り抜きの欄を開く
  $effect(() => { if (app.tool === 'crop') open.crop = true; });
</script>

<div class="right-panel">
  <Histogram />
  <div class="tools">
    <button onclick={() => ed.resetAll()} disabled={ed.currentId === null}><RotateCcw size={14} /> すべてリセット</button>
  </div>
  <fieldset class="sections" disabled={ed.currentId === null}>
    {#each SECTIONS as [key, title] (key)}
      <section class="section">
        <button class="head" aria-expanded={open[key]} onclick={() => (open[key] = !open[key])}>
          <span>{title}</span><span class="chev" class:closed={!open[key]}><ChevronDown size={16} /></span>
        </button>
        {#if open[key]}
          <div class="body">
            {#if key === 'basic'}
              <WbPanel />
              <BasicPanel />
            {:else if key === 'hsl'}
              <HslPanel />
            {:else if key === 'grading'}
              <GradingPanel />
            {:else if key === 'curve'}
              <CurveEditor />
            {:else}
              <CropTool />
            {/if}
          </div>
        {/if}
      </section>
    {/each}
  </fieldset>
</div>

<style>
  .right-panel { padding-bottom: 16px; }
  .tools { display: flex; justify-content: flex-end; padding: 4px 12px; }
  .sections { border: 0; margin: 0; padding: 0; min-width: 0; }
  .section { border-bottom: 1px solid var(--line); }
  .head { width: 100%; justify-content: space-between; border: 0; border-radius: 0; font-weight: 600; padding: 0 12px; }
  .chev { display: inline-flex; transition: transform 0.15s; }
  .chev.closed { transform: rotate(-90deg); }
  .body { padding-bottom: 8px; }
</style>
