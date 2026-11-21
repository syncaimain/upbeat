<!-- Eight singer light-columns in a shallow semicircle (SATB, two each), or
     four quartet seats. Each column brightens at its own entry time, so a
     ragged entry is seen as staggered light. -->
<script lang="ts">
  interface Props {
    count: 4 | 8;
    posture: 'rest' | 'ready' | 'sing';
    litAt: (number | null)[];
    late: boolean[];
    now: number;
    reduced: boolean;
    labels: string[];
    tone: 'tight' | 'loose' | 'ragged' | null;
  }
  let { count, posture, litAt, late, now, reduced, labels, tone }: Props = $props();

  const positions = $derived.by(() => {
    const n = count;
    const span = n === 8 ? 820 : 560;
    return Array.from({ length: n }, (_, i) => {
      const u = i / (n - 1) - 0.5;
      const x = 800 + u * span;
      // Shallow semicircle: the ends sit lower and nearer.
      const y = (n === 8 ? 452 : 470) - Math.cos(u * Math.PI) * 52;
      const scale = 0.9 + 0.12 * Math.abs(u * 2);
      return { x, y, scale };
    });
  });
  const height = $derived(count === 8 ? (posture === 'rest' ? 196 : 214) : (posture === 'rest' ? 150 : 162));
</script>

<g aria-hidden="true">
  {#each positions as p, i}
    {@const lit = posture === 'sing' && litAt[i] != null && now >= (litAt[i] as number)}
    {@const sinceLit = lit ? now - (litAt[i] as number) : 0}
    {@const flash = !reduced && lit && sinceLit < 260}
    {@const isLate = late[i] ?? false}
    {@const col = lit ? (isLate && tone === 'ragged' ? '#e07a5f' : '#f3e9d2') : posture === 'ready' ? '#d4a93c' : '#8a6a3a'}
    {@const op = lit ? 1 : posture === 'ready' ? 0.55 : 0.28}
    {@const w = 46 * p.scale}
    {@const h = height * p.scale}
    <g transform="translate({p.x} {p.y})" style="transition: opacity {reduced ? 0 : 180}ms" opacity={op}>
      {#if count === 4}
        <!-- seat -->
        <path d="M{-w * 0.9} 6 h {w * 1.8} M{-w * 0.7} 6 v 34 M{w * 0.7} 6 v 34" stroke="#d4a93c" stroke-opacity="0.45" stroke-width="1.25" fill="none" />
      {/if}
      <rect x={-w / 2} y={-h} width={w} height={h} rx={w / 2} fill={col} fill-opacity={lit ? 0.85 : 0.5}
        filter={lit && !reduced ? 'url(#glow)' : undefined} />
      <circle cx="0" cy={-h - w * 0.42} r={w * 0.36} fill={col} fill-opacity={lit ? 0.9 : 0.55}
        filter={flash ? 'url(#glow)' : undefined} />
      <line x1={-w / 2 - 6} x2={w / 2 + 6} y1="4" y2="4" stroke="#d4a93c" stroke-opacity="0.35" stroke-width="1" />
      <title>{labels[i]}</title>
    </g>
  {/each}
</g>
