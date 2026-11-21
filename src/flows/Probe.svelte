<!-- Stage 1 probe (run the app with --probe). Logs decoded metrics as
     numbers-only JSON lines, records the fixture protocol, shows delivery
     delay and sample rate live, and draws the landmark layout so the
     head-pitch indices (1, 33, 263) can be confirmed. -->
<script lang="ts">
  import { CUE } from '../../config/cue';
  import Button from '../components/Button.svelte';
  import { session } from '../stores/session.svelte';
  import type { SenseEvent } from '../sense/types';

  let logName = $state<string | null>(null);
  let logFile = $state('');
  let logged = $state(0);
  let buffer: string[] = [];
  let lastFlush = 0;
  let samples: number[] = [];
  let packets: number[] = [];
  let rate = $state(0);
  let packetMs = $state(0);
  let landmarks = $state<{ x: number; y: number }[]>([]);
  let showAll = $state(false);
  let protocol = $state<string | null>(null);
  let hint = $state('');
  let video: HTMLVideoElement | undefined = $state();
  let canvas: HTMLCanvasElement | undefined = $state();

  function sink(e: SenseEvent) {
    if (e.kind === 'metrics') {
      const f = e.frame;
      for (const s of f.chest) samples.push(s.t);
      packets.push(e.recvUs);
      const cut = e.recvUs - 5_000_000;
      samples = samples.filter((t) => t >= cut);
      packets = packets.filter((t) => t >= cut);
      rate = samples.length / 5;
      packetMs = packets.length > 1 ? (packets[packets.length - 1]! - packets[0]!) / 1000 / (packets.length - 1) : 0;
      if (f.allLandmarks) landmarks = [...f.allLandmarks];
    }
    if (e.kind === 'validation') hint = e.code === 0 ? 'OK' : `${e.code}: ${e.hint}`;
    if (logName) {
      const { allLandmarks: _drop, ...frame } = e.kind === 'metrics' ? e.frame : ({} as never);
      void _drop;
      buffer.push(JSON.stringify(e.kind === 'metrics' ? { ...e, frame } : e));
      logged++;
      if (e.recvUs - lastFlush > 2_000_000) flush(e.recvUs);
    }
  }
  function flush(now = Number(session.clock.nowUs())) {
    if (!logName || buffer.length === 0) return;
    const lines = buffer;
    buffer = [];
    lastFlush = now;
    void window.upbeat?.probe.append(logName, lines).then((p) => (logFile = p));
  }

  $effect(() => {
    session.probeSink = sink;
    session.sense.keepAllLandmarks = true;
    return () => {
      flush();
      session.probeSink = null;
      session.sense.keepAllLandmarks = false;
    };
  });
  $effect(() => { if (video) video.srcObject = session.stream; });

  $effect(() => {
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    const pts = landmarks;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!pts.length) return;
    const norm = pts.every((p) => Math.abs(p.x) <= 1.5 && Math.abs(p.y) <= 1.5);
    const sx = norm ? canvas.width : canvas.width / 1280;
    const sy = norm ? canvas.height : canvas.height / 720;
    const key = new Set<number>([CUE.LANDMARK_NOSE, CUE.LANDMARK_EYE_R, CUE.LANDMARK_EYE_L]);
    ctx.font = '12px sans-serif';
    pts.forEach((p, i) => {
      // Mirror horizontally to match the mirrored video.
      const x = canvas!.width - p.x * sx, y = p.y * sy;
      const k = key.has(i);
      ctx.fillStyle = k ? '#d4a93c' : 'rgba(243,233,210,0.5)';
      ctx.fillRect(x - (k ? 3 : 1), y - (k ? 3 : 1), k ? 6 : 2, k ? 6 : 2);
      if (k || showAll) {
        ctx.fillStyle = k ? '#d4a93c' : 'rgba(243,233,210,0.6)';
        ctx.fillText(String(i), x + 4, y - 4);
      }
    });
  });

  async function start() {
    await session.startSensing();
  }
  function toggleLog() {
    if (logName) { flush(); logName = null; return; }
    logName = `probe-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    logged = 0;
  }
  async function record(kind: string) {
    if (session.recording) {
      await session.toggleRecording();
      protocol = null;
      return;
    }
    protocol = kind;
    await session.toggleRecording();
  }
  const d = $derived(session.delays);
  $effect(() => {
    const t = setInterval(() => session.timingSnapshot(), 1000);
    return () => clearInterval(t);
  });
</script>

<div class="probe" data-testid="probe">
  <h2>Stage 1 probe</h2>
  <div class="grid">
    <div>
      <div class="video">
        <!-- svelte-ignore a11y_media_has_caption -->
        <video bind:this={video} autoplay muted playsinline></video>
        <canvas bind:this={canvas} width="640" height="360"></canvas>
      </div>
      <label><input type="checkbox" bind:checked={showAll} /> label every landmark index</label>
      <p class="muted">Gold: indices {CUE.LANDMARK_NOSE} (nose tip), {CUE.LANDMARK_EYE_R}, {CUE.LANDMARK_EYE_L} (outer eye corners). Confirm they sit there.</p>
    </div>
    <div>
      <div class="actions">
        {#if !session.cameraOn}<Button onclick={start}>Start sensing</Button>{:else}<Button kind="quiet" onclick={() => session.stopAll()}>Stop</Button>{/if}
        <Button kind="quiet" onclick={toggleLog} disabled={!session.cameraOn}>{logName ? 'Stop metric log' : 'Log decoded metrics'}</Button>
      </div>
      <table>
        <tbody>
          <tr><td>validation</td><td>{hint || '—'}</td></tr>
          <tr><td>breathing confidence</td><td>{session.rateConfidence.toFixed(0)} {session.gate?.breathingStable ? '(stable)' : ''}</td></tr>
          <tr><td>chest samples / s</td><td>{rate.toFixed(1)}</td></tr>
          <tr><td>packet interval</td><td>{packetMs.toFixed(0)} ms</td></tr>
          <tr><td>delay newest (median / p95)</td><td>{d ? `${d.newest.medianMs.toFixed(0)} / ${d.newest.p95Ms.toFixed(0)} ms (n=${d.newest.count})` : '—'}</td></tr>
          <tr><td>landmarks per set</td><td>{session.landmarkCount}</td></tr>
          <tr><td>head pitch</td><td>{session.pitchDeg === null ? 'no baseline (calibrate)' : `${session.pitchDeg.toFixed(1)}°`}</td></tr>
          <tr><td>log</td><td>{logName ? `${logged} events → ${logFile}` : 'off'}</td></tr>
        </tbody>
      </table>
      <h3>Fixture protocol</h3>
      <p class="muted">Each recording is numbers only. Press <kbd>R</kbd> just before every prep breath so the file marks it.</p>
      <div class="actions">
        {#each [['prep', '30 prep breaths'], ['rest', '2 min resting breath'], ['talk', '1 min talking']] as const as [k, t] (k)}
          <Button kind={protocol === k ? 'primary' : 'quiet'} disabled={!session.cameraOn || (session.recording && protocol !== k)} onclick={() => record(k)}>
            {protocol === k ? `Stop: ${t}` : `Record ${t}`}</Button>
        {/each}
      </div>
      {#if session.lastRecording}<p>Saved: {session.lastRecording} — copy it into <code>fixtures/</code> and run <code>npm run analyze</code>.</p>{/if}
      <Button kind="quiet" onclick={() => session.go('welcome')}>Back</Button>
    </div>
  </div>
</div>

<style>
  .probe { position: fixed; inset: 0; overflow: auto; padding: 28px 40px; background: var(--bg); }
  .grid { display: grid; grid-template-columns: 640px 1fr; gap: 32px; }
  .video { position: relative; width: 640px; height: 360px; background: #000; }
  .video video, .video canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .video video { object-fit: cover; transform: scaleX(-1); }
  table { border-collapse: collapse; margin: 12px 0; }
  td { padding: 3px 14px 3px 0; border-bottom: 1px solid #ffffff14; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 10px 0; }
</style>
