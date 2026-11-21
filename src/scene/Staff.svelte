<!-- Results on a five-line staff: each entry a notehead at the tempo the
     breath set; a small ring at the tempo measured from the peak; the target
     as a brass line (stepped for ladders and random targets). -->
<script lang="ts">
  interface Props { targets: number[]; set: (number | null)[]; measured: (number | null)[]; qualities: string[] }
  let { targets, set, measured, qualities }: Props = $props();
  const W = 880, H = 300, PAD = 44;
  const all = $derived([...targets, ...set.filter((v): v is number => v !== null), ...measured.filter((v): v is number => v !== null)]);
  const lo = $derived(Math.floor((Math.min(...all, 60) - 8) / 10) * 10);
  const hi = $derived(Math.ceil((Math.max(...all, 120) + 8) / 10) * 10);
  const y = (bpm: number) => PAD + (1 - (bpm - lo) / (hi - lo)) * (H - 2 * PAD);
  const x = (i: number) => PAD + 40 + i * ((W - 2 * PAD - 60) / Math.max(1, targets.length - 1));
  const fill = (q: string | undefined) => (q === 'tight' ? '#9ccb8a' : q === 'ragged' ? '#e07a5f' : '#f3e9d2');
</script>

<svg viewBox="0 0 {W} {H}" width="100%" role="img" aria-label="Tempo of each entry against its target" data-testid="results-staff">
  {#each [0, 1, 2, 3, 4] as l (l)}
    <line x1={PAD} x2={W - PAD} y1={PAD + l * ((H - 2 * PAD) / 4)} y2={PAD + l * ((H - 2 * PAD) / 4)} stroke="#f3e9d2" stroke-opacity="0.3" />
  {/each}
  <text x={PAD - 8} y={PAD + 6} text-anchor="end" fill="#f3e9d2" fill-opacity="0.75" font-size="18">{hi}</text>
  <text x={PAD - 8} y={H - PAD + 6} text-anchor="end" fill="#f3e9d2" fill-opacity="0.75" font-size="18">{lo}</text>
  <polyline points={targets.map((t, i) => `${x(i)},${y(t)}`).join(' ')} fill="none" stroke="#d4a93c" stroke-width="2" />
  {#each targets as _t, i (i)}
    {@const m = measured[i]}
    {@const s = set[i]}
    {#if m != null}
      <circle cx={x(i)} cy={y(m)} r="4" fill="none" stroke="#f3e9d2" stroke-opacity="0.7" />
    {/if}
    {#if s != null}
      <ellipse cx={x(i)} cy={y(s)} rx="10" ry="7" transform="rotate(-18 {x(i)} {y(s)})" fill={fill(qualities[i])} />
    {/if}
  {/each}
</svg>
