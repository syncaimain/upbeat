<!-- The podium. Rim: dim (idle), brass glow (Ready), parchment (sounding). -->
<script lang="ts">
  let { state, reduced }: { state: 'idle' | 'ready' | 'sounding' | 'paused'; reduced: boolean } = $props();
  const rim = $derived(state === 'sounding' ? '#f3e9d2' : state === 'ready' ? '#d4a93c' : '#5a4630');
</script>

<g aria-hidden="true">
  <path d="M 640 812 L 960 812 L 1010 900 L 590 900 Z" fill="#1e1218" stroke="#d4a93c" stroke-opacity="0.35" stroke-width="1" />
  <path d="M 630 806 L 970 806" stroke={rim} stroke-width="5" stroke-linecap="square"
    filter={state === 'ready' && !reduced ? 'url(#glow)' : undefined} data-testid="podium-rim" data-state={state} />
  <path d="M 652 822 L 948 822" stroke="#d4a93c" stroke-opacity="0.28" stroke-width="0.8" />
</g>
