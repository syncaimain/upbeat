<!-- F2: warm-up as tuning. The SDK needs ~30 s before breathing is stable;
     the choir hums a quiet tuning note meanwhile. -->
<script lang="ts">
  import { CUE } from '../../config/cue';
  import Button from '../components/Button.svelte';
  import Note from '../components/Note.svelte';
  import Stage from '../scene/Stage.svelte';
  import { session } from '../stores/session.svelte';
  import Hud from './Hud.svelte';

  const elapsed = $derived((session.frame - session.warmupStartedAt) / 1000);
  const longWait = $derived(!session.warmupStable && elapsed > CUE.WARMUP_HINT_AFTER_S);
</script>

<Stage tuning={!session.warmupStable}>
  {#snippet hud()}
    <Hud exercise="Warm-up" showStrip={false} />
    <div class="panel">
      <Note title={session.warmupStable ? 'The choir is in tune' : 'Tuning'} testid="warmup">
        {#if session.warmupStable}
          <p>Your breathing is coming through clearly.</p>
          <div class="actions"><Button onclick={() => session.afterWarmup()} testid="warmup-continue">Continue</Button></div>
        {:else}
          <p>Breathe normally and stay still while the choir hums. This takes about half a minute.</p>
          {#if longWait}
            <p class="ragged" role="status">Breathing has not settled yet.</p>
            <p class="muted">{session.gate?.hint || 'Sit still with your chest lit and in view; avoid talking.'}</p>
          {/if}
        {/if}
      </Note>
    </div>
  {/snippet}
</Stage>

<style>
  .panel { position: absolute; right: var(--hud-inset); top: 16%; width: min(32%, 460px); }
</style>
