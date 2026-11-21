<!-- Thin engraved line icons (1.25 px). -->
<script lang="ts">
  let { name, size = 22 }: { name: 'gear' | 'stop' | 'help' | 'record' | 'shield'; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name === 'gear'}
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M5.5 18.5l2.1-2.1M16.4 7.6l2.1-2.1" />
    <circle cx="12" cy="12" r="6.4" stroke-opacity="0.55" />
  {:else if name === 'stop'}
    <rect x="5.5" y="5.5" width="13" height="13" />
    <rect x="8" y="8" width="8" height="8" stroke-opacity="0.5" />
  {:else if name === 'help'}
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.6M12 16.6v.4" />
  {:else if name === 'record'}
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4" fill="currentColor" fill-opacity="0.6" />
  {:else}
    <path d="M12 3l7 3v5.5c0 4.4-3 7.8-7 9.5-4-1.7-7-5.1-7-9.5V6z" />
    <path d="M9 12l2.2 2.2L15.5 10" stroke-opacity="0.7" />
  {/if}
</svg>
