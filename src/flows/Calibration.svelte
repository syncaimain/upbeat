<!-- F3: 20 s of resting breath, then 9 prep breaths to a visual metronome at
     60, 90 and 120 bpm. Shows the fit and allows a redo. -->
<script lang="ts">
  import { CUE } from '../../config/cue';
  import { kStability } from '../engine/calibration';
  import Button from '../components/Button.svelte';
  import Note from '../components/Note.svelte';
  import Stage from '../scene/Stage.svelte';
  import { session } from '../stores/session.svelte';
  import Hud from './Hud.svelte';

  const c = $derived(session.calib);
  const o = $derived(c.outcome);
  const stab = $derived(o?.profile ? kStability(o.profile) : undefined);
</script>

<Stage>
  {#snippet hud()}
    <Hud exercise="Calibration" showStrip={false}
      candles={c.phase === 'trials' || c.phase === 'done' || c.phase === 'analysing' ? { total: 9, lit: c.phase === 'trials' ? c.trial : 9 } : null} />
    <div class="panel">
      {#if c.phase === 'intro'}
        <Note title="Calibration" testid="calibration">
          <p>About ninety seconds, once. First 20 seconds of quiet breathing, then nine preparatory breaths to a metronome:
            three each at ♩ = 60, 90 and 120.</p>
          <p>On each count of <strong>1 – 2 – 3</strong>, wait. On <strong>4</strong> (“breathe”), take your preparatory breath — the choir enters on the next downbeat.</p>
          <div class="actions">
            <Button onclick={() => session.startCalibration()} disabled={!session.gate?.cuesAllowed} testid="calib-start">Begin</Button>
            {#if !session.gate?.cuesAllowed}<p class="muted">Waiting — {session.gate?.reason ?? 'no breathing data yet'}</p>{/if}
          </div>
        </Note>
      {:else if c.phase === 'rest'}
        <Note title="Resting breath">
          <p>Breathe normally. <span class="tempo">{c.restLeftS}</span> s</p>
        </Note>
      {:else if c.phase === 'trials'}
        <Note title="Preparatory breaths">
          <p>Breath {c.trial + 1} of 9 at <span class="tempo">♩ = {c.bpm}</span></p>
          <p>Count along: <strong>1 · 2 · 3</strong> — then on <strong>“breathe in”</strong> take one full breath, filling it as the bar fills. The choir comes in when the bar is full.</p>
          {#key session.countLabel}
            {#if session.countLabel === 'breathe in'}
              <div class="pacer" aria-hidden="true"><span style="animation-duration: {Math.round(60000 / c.bpm)}ms"></span></div>
            {:else}
              <div class="pacer idle" aria-hidden="true"></div>
            {/if}
          {/key}
        </Note>
      {:else if c.phase === 'analysing'}
        <Note title="Listening back…"><p>Fitting your tempo.</p></Note>
      {:else if o}
        <Note title={o.ok ? 'Calibrated' : 'Not quite'} testid="calibration-result">
          <p class={o.ok && o.profile?.predictionTrusted ? 'together' : o.ok ? '' : 'ragged'}>{o.message}</p>
          {#if o.breaths.length}
            <table>
              <thead><tr><th>Target</th><th>Rise</th><th>Peak beat</th><th>Depth</th><th></th></tr></thead>
              <tbody>
                {#each o.breaths as b, i (i)}
                  <tr class:muted={!b.valid}>
                    <td>♩ = {b.targetBpm}</td>
                    <td>{b.riseRate !== undefined ? b.riseRate.toFixed(1) : '—'}</td>
                    <td>{b.actualBeat !== undefined ? `${(b.actualBeat * 1000).toFixed(0)} ms` : '—'}</td>
                    <td>{b.depth !== undefined ? `${b.depth.toFixed(1)}×` : '—'}</td>
                    <td>{b.valid ? '' : b.note}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
          {#if stab !== undefined}<p class="muted">k changed {(stab * 100).toFixed(0)} % from your last calibration{stab <= 0.15 ? ' — stable.' : '.'}</p>{/if}
          <div class="actions">
            {#if o.ok}<Button onclick={() => session.saveCalibration()} testid="calib-save">Save and practise</Button>{/if}
            <Button kind="quiet" onclick={() => session.startCalibration()}>Redo</Button>
          </div>
          <p class="muted small">Prediction is trusted below {Math.round(CUE.MAX_TRUSTED_FIT_ERROR * 100)} % fit error.</p>
        </Note>
      {/if}
    </div>
  {/snippet}
</Stage>

<style>
  .panel { position: absolute; right: var(--hud-inset); top: 14%; width: min(36%, 520px); }
  table { width: 100%; border-collapse: collapse; font-size: 18px; margin: 8px 0; font-variant-numeric: lining-nums tabular-nums; }
  th { text-align: left; font-family: var(--smallcaps); font-weight: 600; letter-spacing: 0.08em; text-transform: lowercase; color: var(--muted); }
  td, th { padding: 3px 6px 3px 0; border-bottom: 1px solid #ffffff14; }
  .small { font-size: 18px; }
  .pacer { height: 14px; border: 1px solid var(--brass); margin-top: 10px; }
  .pacer span { display: block; height: 100%; width: 0; background: var(--brass); animation: fill linear forwards; }
  .pacer.idle { opacity: 0.35; }
  /* A timing guide: it runs even with reduced motion. */
  :global(:root[data-motion='reduce']) .pacer span { animation-duration: inherit !important; }
  @keyframes fill { to { width: 100%; } }
</style>
