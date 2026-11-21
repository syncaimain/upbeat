<!-- Error states and pauses: a programme note over the paused stage, always
     with a way on (never a dead end). -->
<script lang="ts">
  import Button from '../components/Button.svelte';
  import Note from '../components/Note.svelte';
  import { session } from '../stores/session.svelte';
  import type { NoteAction } from '../sense/errors';

  const labels: Record<NoteAction, string> = {
    retry: 'Try again', metronome: 'Metronome mode', settings: 'Settings', setup: 'Setup', welcome: 'Back to the foyer', dismiss: 'Close',
  };
  async function act(a: NoteAction) {
    session.note = null;
    if (a === 'retry') await session.startSensing();
    else if (a === 'metronome') { await session.stopSensing(); session.screen = 'practice'; session.mode = 'metronome'; }
    else if (a === 'settings') session.curtain = 'settings';
    else if (a === 'setup') session.go('setup');
    else if (a === 'welcome') session.go('welcome');
  }
</script>

{#if session.note}
  <div class="over" role="alertdialog" aria-label={session.note.title} data-testid="error-note">
    <Note title={session.note.title}>
      <p>{session.note.body}</p>
      <div class="actions">
        {#each session.note.actions as a (a)}<Button kind={a === session.note.actions[0] ? 'primary' : 'quiet'} onclick={() => act(a)}>{labels[a]}</Button>{/each}
      </div>
    </Note>
  </div>
{:else if session.pause}
  <div class="over soft" role="status" data-testid="pause-note">
    <Note title={session.pause.title}>
      <p>{session.pause.hint}</p>
      <p class="muted">The scene resumes by itself after a second of clear view. <kbd>Space</kbd> still gives a count-in entry.</p>
    </Note>
  </div>
{:else if session.stoppedNote && (session.screen === 'practice' || session.screen === 'drills' || session.screen === 'warmup' || session.screen === 'calibration')}
  <div class="over soft" role="status" data-testid="stopped-note">
    <Note title="The hall is quiet">
      <p>The camera and the sound are off.</p>
      <div class="actions">
        <Button onclick={() => session.resume()}>Resume sensing</Button>
        <Button kind="quiet" onclick={() => { session.stoppedNote = false; void session.keyMetronome(); }} keyHint="Space">Count-in entry</Button>
        <Button kind="quiet" onclick={() => { session.stoppedNote = false; session.go('welcome'); }}>Foyer</Button>
      </div>
    </Note>
  </div>
{/if}

<div class="sr-only" aria-live="assertive" data-testid="announcer">{session.announcement}</div>

<style>
  .over { position: fixed; inset: 0; display: grid; place-items: center; background: #0b0609b3; z-index: 30; padding: 24px; }
  .soft { background: transparent; pointer-events: none; }
  .soft :global(.note) { pointer-events: auto; }
</style>
