<!-- Drill progress as candles that light one by one. -->
<script lang="ts">
  let { total, lit, reduced }: { total: number; lit: number; reduced: boolean } = $props();
  const idx = $derived(Array.from({ length: total }, (_, i) => i));
</script>

<div class="candles" role="img" aria-label="{lit} of {total} cues done" data-testid="candles">
  <svg width={total * 22 + 4} height="58" viewBox="0 0 {total * 22 + 4} 58" aria-hidden="true">
    {#each idx as i (i)}
      <g transform="translate({4 + i * 22} 0)">
        <rect x="3" y="24" width="10" height="32" fill="#f3e9d2" fill-opacity={i < lit ? 0.9 : 0.25} />
        <line x1="8" y1="24" x2="8" y2="19" stroke="#f3e9d2" stroke-opacity="0.6" />
        {#if i < lit}
          <path d="M8 4 C 13 11, 12 17, 8 19 C 4 17, 3 11, 8 4 Z" fill="#d4a93c" class:flicker={!reduced}
            style="transform-origin: 8px 19px; animation-delay: {i * 130}ms" />
        {/if}
      </g>
    {/each}
  </svg>
</div>

<style>
  .flicker { animation: flicker 2.4s ease-in-out infinite; }
  @keyframes flicker {
    0%, 100% { transform: scale(1, 1); }
    40% { transform: scale(0.92, 1.06); }
    70% { transform: scale(1.04, 0.95); }
  }
</style>
