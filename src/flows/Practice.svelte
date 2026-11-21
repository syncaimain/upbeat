<!-- The main stage (F4–F8): Ready, breathe, hear the entry, read what your
     breath said. -->
<script lang="ts">
  import Button from '../components/Button.svelte';
  import Stage from '../scene/Stage.svelte';
  import { profileStore } from '../stores/profile.svelte';
  import { session } from '../stores/session.svelte';
  import Hud from './Hud.svelte';

  const exercise = $derived(session.mode === 'replay' ? 'Recorded session'
    : session.mode === 'live' ? (profileStore.profile?.predictionTrusted === false ? 'Breath-timed entry (fixed tempo)' : 'Breath-cued entry')
    : 'Metronome');
</script>

<Stage>
  {#snippet hud()}
    <Hud {exercise} />
    {#if session.replayEnded}
      <div class="end">
        <p class="label">end of the recorded session</p>
        <div class="row">
          <Button onclick={() => session.startReplay()}>Play again</Button>
          <Button kind="quiet" onclick={() => session.go('welcome')}>Back to the foyer</Button>
        </div>
      </div>
    {/if}
    {#if session.mode !== 'live' && session.mode !== 'replay' && !session.stoppedNote}
      <div class="end">
        <div class="row">
          <Button onclick={() => session.keyMetronome()} keyHint="Space">Count me in</Button>
          {#if session.pipeline?.calibrated || profileStore.profile}
            <Button kind="quiet" onclick={() => session.resume()}>Turn the camera on</Button>
          {:else}
            <Button kind="quiet" onclick={() => session.enterHall()}>Set up the camera</Button>
          {/if}
        </div>
      </div>
    {/if}
  {/snippet}
</Stage>

<style>
  .end { position: absolute; right: var(--hud-inset); top: 18%; text-align: right; }
  .row { display: flex; gap: 12px; justify-content: flex-end; flex-wrap: wrap; }
</style>
