<!-- 64 px score strip: target tempo and the last ten entries as noteheads on
     a staff (height = tempo set relative to target; colour = together/ragged). -->
<script lang="ts">
  import type { CueResult } from '../engine/types';
  import { scoredTempo } from '../engine/drills';
  let { target, entries }: { target: number; entries: CueResult[] } = $props();
  const W = 500, H = 48;
  const y = (r: CueResult) => {
    const t = scoredTempo(r) ?? r.plannedBpm;
    const err = Math.max(-24, Math.min(24, t - (r.targetBpm ?? target)));
    return H / 2 - (err / 24) * (H / 2 - 4);
  };
  const fill = (q: string) => (q === 'tight' ? '#9ccb8a' : q === 'ragged' ? '#e07a5f' : '#f3e9d2');
</script>

<div class="strip" data-testid="score-strip">
  <span class="tempo" aria-label="Target tempo {Math.round(target)} beats per minute">♩ = {Math.round(target)}</span>
  <svg width={W} height={H} viewBox="0 0 {W} {H}" role="img" aria-label="Last {entries.length} entries">
    {#each [0, 1, 2, 3, 4] as l (l)}
      <line x1="0" x2={W} y1={4 + l * ((H - 8) / 4)} y2={4 + l * ((H - 8) / 4)} stroke="#f3e9d2" stroke-opacity="0.28" stroke-width="1" />
    {/each}
    <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="#d4a93c" stroke-width="1.5" stroke-opacity="0.8" />
    {#each entries as r, i (r.id)}
      <ellipse cx={30 + i * 48} cy={y(r)} rx="8" ry="5.5" transform="rotate(-18 {30 + i * 48} {y(r)})" fill={fill(r.quality)} />
    {/each}
  </svg>
</div>

<style>
  .strip { display: flex; align-items: center; gap: 22px; height: var(--strip-h); }
  .tempo { min-width: 130px; }
</style>
