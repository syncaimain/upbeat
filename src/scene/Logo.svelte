<!-- One engraved stroke rising like an upbeat gesture, ending in a small
     breath curl. -->
<script lang="ts">
  let { size = 64, title = 'Upbeat' }: { size?: number; title?: string } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title}>
  <path d="M10 50 C 22 50, 26 44, 32 32 S 44 12, 50 12 C 56 12, 57 19, 52 21 C 48 22.5, 46 19, 49 17"
    fill="none" stroke="var(--brass)" stroke-width="2.25" stroke-linecap="round" />
  <path d="M10 50 C 22 50, 26 44, 32 32 S 44 12, 50 12" fill="none" stroke="var(--parchment)" stroke-opacity="0.35"
    stroke-width="0.75" stroke-linecap="round" transform="translate(1.6 1.6)" />
</svg>
