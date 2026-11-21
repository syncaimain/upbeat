<!-- F1: informed, camera-only consent before any camera access. -->
<script lang="ts">
  import Button from '../components/Button.svelte';
  import Note from '../components/Note.svelte';
  import Stage from '../scene/Stage.svelte';
  import { session } from '../stores/session.svelte';
  import { settings } from '../stores/settings.svelte';

  async function agree() {
    await settings.update({ consented: true });
    session.go('setup');
  }
  async function leave() {
    session.go('practice');
    session.mode = 'metronome';
    await session.keyMetronome();
  }
</script>

<Stage showArc={false} showEnsemble={false}>
  {#snippet hud()}
    <div class="center">
      <Note title="Before the hall opens" wide testid="consent">
        <div class="cols">
          <div>
            <h3>What the camera measures</h3>
            <ul>
              <li>The breathing motion of your chest (and belly, if in view)</li>
              <li>Your head position — a small chin lift means "ready"</li>
              <li>Whether you are talking, so speech never cues the choir</li>
            </ul>
          </div>
          <div>
            <h3>What it does not</h3>
            <ul>
              <li>No microphone, ever</li>
              <li>No identity, emotions or health judgements</li>
              <li>No video is saved — only numbers you can delete</li>
            </ul>
          </div>
        </div>
        <p class="muted">SmartSpectra processes the video on this computer and checks its licence online; telemetry is turned off.
          The camera is used only on the setup, warm-up, calibration, practice and drill screens, shown by the brass dot.
          Press <kbd>Esc</kbd> at any time to stop the camera and the sound.</p>
        <div class="actions">
          <Button onclick={agree} testid="consent-agree">I agree — open the camera</Button>
          <Button kind="quiet" onclick={leave} testid="consent-leave">Leave — metronome only</Button>
        </div>
      </Note>
    </div>
  {/snippet}
</Stage>

<style>
  .center { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
  ul { margin: 0 0 14px; padding-left: 20px; }
  li { margin-bottom: 4px; }
</style>
