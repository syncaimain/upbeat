<!-- F13: timing check — delivery delay (receipt − SDK timestamp) and the
     scheduler's offline-render precision. -->
<script lang="ts">
  import Button from '../components/Button.svelte';
  import Note from '../components/Note.svelte';
  import Stage from '../scene/Stage.svelte';
  import { offlineScheduleCheck } from '../sound/scheduler';
  import { session } from '../stores/session.svelte';

  let offline = $state<{ maxErrMs: number; meanErrMs: number; plans: number } | null>(null);
  let running = $state(false);
  $effect(() => {
    const t = setInterval(() => session.timingSnapshot(), 500);
    return () => clearInterval(t);
  });
  async function runOffline() {
    running = true;
    await session.ensureAudio();
    offline = await offlineScheduleCheck(100);
    running = false;
  }
  const f = (n: number) => (Number.isFinite(n) ? n.toFixed(0) : '—');
</script>

<Stage showEnsemble={false} showArc={false}>
  {#snippet hud()}
    <div class="center">
      <Note title="Timing check" wide testid="timing">
        <p class="muted">Delivery delay = when a chest-trace sample reaches the app minus its SDK timestamp. {session.mode === 'replay' ? 'Replay: these are the recorded delays.' : session.mode === 'live' ? 'Live.' : 'Start sensing or a replay to measure.'}</p>
        <table>
          <thead><tr><th></th><th>samples</th><th>median</th><th>p95</th><th>min</th><th>max</th></tr></thead>
          <tbody>
            {#if session.delays}
              <tr><td>newest sample per packet</td><td>{session.delays.newest.count}</td><td>{f(session.delays.newest.medianMs)} ms</td><td>{f(session.delays.newest.p95Ms)} ms</td><td>{f(session.delays.newest.minMs)}</td><td>{f(session.delays.newest.maxMs)}</td></tr>
              <tr><td>every sample</td><td>{session.delays.samples.count}</td><td>{f(session.delays.samples.medianMs)} ms</td><td>{f(session.delays.samples.p95Ms)} ms</td><td>{f(session.delays.samples.minMs)}</td><td>{f(session.delays.samples.maxMs)}</td></tr>
            {:else}
              <tr><td colspan="6">No data yet.</td></tr>
            {/if}
          </tbody>
        </table>
        <p>Scheduler precision (100 plans rendered offline):
          {#if offline}<strong data-testid="offline-result">max {offline.maxErrMs.toFixed(3)} ms, mean {offline.meanErrMs.toFixed(3)} ms over {offline.plans} plans</strong>{:else}not run{/if}</p>
        <div class="actions">
          <Button onclick={runOffline} disabled={running} testid="run-offline">{running ? 'Rendering…' : 'Run offline render check'}</Button>
          <Button kind="quiet" onclick={() => session.go(session.mode === 'live' || session.mode === 'replay' ? 'practice' : 'welcome')}>Back</Button>
        </div>
      </Note>
    </div>
  {/snippet}
</Stage>

<style>
  .center { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: lining-nums tabular-nums; margin: 10px 0 16px; }
  td, th { text-align: left; padding: 4px 10px 4px 0; border-bottom: 1px solid #ffffff14; }
  th { font-family: var(--smallcaps); text-transform: lowercase; letter-spacing: 0.08em; color: var(--muted); }
</style>
