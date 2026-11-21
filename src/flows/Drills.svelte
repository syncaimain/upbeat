<!-- F9: drills. Choose one; candles light per cue; results follow. -->
<script lang="ts">
  import Button from '../components/Button.svelte';
  import Note from '../components/Note.svelte';
  import Stage from '../scene/Stage.svelte';
  import { makeDrill, type DrillKind } from '../engine/drills';
  import { session } from '../stores/session.svelte';
  import { settings } from '../stores/settings.svelte';
  import Hud from './Hud.svelte';

  const kinds: DrillKind[] = ['consistency', 'ladder', 'match'];
  const d = $derived(session.drill);

  async function begin(k: DrillKind) {
    if (session.mode !== 'live' && session.mode !== 'replay') {
      const ok = await session.startSensing();
      if (!ok) return;
    }
    session.startDrill(k);
  }
</script>

<Stage>
  {#snippet hud()}
    <Hud exercise={d ? d.def.title : 'Drills'} candles={d ? { total: d.def.targets.length, lit: d.results.length } : null} />
    {#if !d}
      <div class="choose">
        {#each kinds as k (k)}
          {@const def = makeDrill(k, { tempo: settings.value.targetBpm })}
          <Note title={def.title}>
            <p>{def.blurb}</p>
            <div class="actions"><Button onclick={() => begin(k)} testid="drill-{k}">Begin</Button></div>
          </Note>
        {/each}
      </div>
    {:else}
      <div class="target" aria-live="polite">
        <p class="label muted">cue {d.results.length + 1} of {d.def.targets.length}</p>
        <p class="tempo">♩ = {d.def.targets[d.index]}</p>
      </div>
    {/if}
  {/snippet}
</Stage>

<style>
  .choose { position: absolute; left: 50%; top: 52%; transform: translate(-50%, -50%); display: grid; grid-template-columns: repeat(3, minmax(240px, 340px)); gap: 22px; }
  .target { position: absolute; right: var(--hud-inset); top: 16%; text-align: right; }
  .target .tempo { font-size: 56px; }
</style>
