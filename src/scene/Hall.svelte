<!-- The hall: aubergine-black with one stage light behind the podium, a
     proscenium line drawing and velvet curtain edges. -->
<script lang="ts">
  let { dim = false }: { dim?: boolean } = $props();
</script>

<defs>
  <radialGradient id="stagelight" cx="800" cy="690" r="760" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#2a1820" />
    <stop offset="0.55" stop-color="#1c1016" />
    <stop offset="1" stop-color="#140c10" />
  </radialGradient>
  <linearGradient id="velvetL" x1="0" x2="1">
    <stop offset="0" stop-color="#3a0d16" />
    <stop offset="0.7" stop-color="#7e1f2e" />
    <stop offset="1" stop-color="#4a111b" />
  </linearGradient>
  <linearGradient id="velvetR" x1="1" x2="0">
    <stop offset="0" stop-color="#3a0d16" />
    <stop offset="0.7" stop-color="#7e1f2e" />
    <stop offset="1" stop-color="#4a111b" />
  </linearGradient>
  <filter id="glow" x="-80%" y="-30%" width="260%" height="160%">
    <feGaussianBlur stdDeviation="14" result="b" />
    <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
  </filter>
</defs>
<rect width="1600" height="900" fill="url(#stagelight)" />
<!-- proscenium -->
<g fill="none" stroke="#d4a93c" stroke-opacity="0.32">
  <path d="M120 900 V 210 Q 120 96 260 96 H 1340 Q 1480 96 1480 210 V 900" stroke-width="1.25" />
  <path d="M132 900 V 214 Q 132 108 262 108 H 1338 Q 1468 108 1468 214 V 900" stroke-width="0.6" />
  <path d="M220 612 Q 800 560 1380 612" stroke-width="0.8" stroke-opacity="0.22" />
</g>
<!-- curtain edges -->
<g opacity="0.92">
  <path d="M0 0 H 118 Q 96 300 112 520 Q 126 720 104 900 H 0 Z" fill="url(#velvetL)" />
  <path d="M1600 0 H 1482 Q 1504 300 1488 520 Q 1474 720 1496 900 H 1600 Z" fill="url(#velvetR)" />
  {#each [24, 52, 80] as x}
    <path d="M{x} 0 Q {x - 8} 450 {x + 4} 900" stroke="#000" stroke-opacity="0.28" stroke-width="3" fill="none" />
    <path d="M{1600 - x} 0 Q {1608 - x} 450 {1596 - x} 900" stroke="#000" stroke-opacity="0.28" stroke-width="3" fill="none" />
  {/each}
</g>
{#if dim}<rect width="1600" height="900" fill="#0b0609" opacity="0.55" />{/if}
