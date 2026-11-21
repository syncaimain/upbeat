<!-- Privacy controls: camera switch, what is stored and where, deletion,
     recordings, telemetry status, SDK network note. -->
<script lang="ts">
  import Button from '../components/Button.svelte';
  import Curtain from '../components/Curtain.svelte';
  import { profileStore } from '../stores/profile.svelte';
  import { session } from '../stores/session.svelte';

  let paths = $state<{ dataDir: string; files: string[] } | null>(null);
  let recs = $state<string[]>([]);
  let msg = $state('');
  let withRecordings = $state(false);

  $effect(() => {
    if (session.curtain === 'privacy') {
      void window.upbeat?.paths().then((p) => (paths = p));
      void window.upbeat?.rec.list().then((r) => (recs = r));
    }
  });

  async function del() {
    await profileStore.deleteAll(withRecordings);
    if (withRecordings) recs = [];
    msg = withRecordings ? 'Profile, history and recordings deleted.' : 'Profile and history deleted.';
    session.announce(msg);
  }
  async function delRec(n: string) {
    await window.upbeat?.rec.remove(n);
    recs = recs.filter((r) => r !== n);
  }
  async function replayRec(n: string) {
    const text = await window.upbeat?.rec.read(n);
    if (text) { session.curtain = null; await session.startReplay(text); }
  }
  async function forgetKey() {
    await session.stopSensing();
    await window.upbeat?.key.clear();
    msg = 'API key removed from this computer.';
  }
</script>

<Curtain open={session.curtain === 'privacy'} title="Privacy" onclose={() => (session.curtain = null)}>
  <p>Camera: <strong>{session.cameraOn ? 'on' : 'off'}</strong>
    {#if session.cameraOn}<button class="link" onclick={() => session.stopAll()}>turn it off</button>{/if}</p>
  <p>Microphone: <strong>never used.</strong></p>
  <p>Telemetry: <strong>off</strong> (<code>enableTelemetry: false</code>). SmartSpectra still contacts Presage to check its licence when a measurement starts — there is no offline mode. Video is processed on this computer.</p>

  <h3>What is stored</h3>
  <ul>
    <li>Your calibration profile: tempo constant <em>k</em>, resting amplitude, head-pitch baseline — {profileStore.profile ? 'saved' : 'none'}</li>
    <li>Drill summaries (tempo errors, tight entries) — {profileStore.history.length} saved</li>
    <li>Settings, and your API key encrypted by the operating system</li>
    <li>Numbers-only replay files, only when you press Record — {recs.length} saved</li>
  </ul>
  <p class="muted">No video, images or sound are ever saved.</p>
  {#if paths}<p class="muted path">Folder: {paths.dataDir}</p>{/if}

  <label class="check"><input type="checkbox" bind:checked={withRecordings} /> Also delete recordings</label>
  <div class="actions">
    <Button onclick={del} testid="delete-data">Delete my profile and history</Button>
    <Button kind="quiet" onclick={forgetKey}>Forget API key</Button>
  </div>
  {#if msg}<p role="status" class="together" data-testid="delete-msg">{msg}</p>{/if}

  {#if recs.length}
    <h3>Recordings</h3>
    <ul class="recs">
      {#each recs as r (r)}
        <li><span>{r}</span>
          <button class="link" onclick={() => replayRec(r)}>replay</button>
          <button class="link" onclick={() => delRec(r)} aria-label="Delete {r}">delete</button></li>
      {/each}
    </ul>
  {/if}
</Curtain>

<style>
  ul { padding-left: 20px; }
  .check { display: block; margin: 10px 0; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 12px 0; }
  .link { background: none; border: 0; color: var(--brass); font: inherit; cursor: pointer; text-decoration: underline; padding: 0 4px; }
  .path { word-break: break-all; }
  .recs li { display: flex; gap: 8px; flex-wrap: wrap; }
  code { font-size: 16px; }
</style>
