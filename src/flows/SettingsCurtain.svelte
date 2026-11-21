<!-- F14 settings: applied immediately, keyboard reachable. -->
<script lang="ts">
  import Button from '../components/Button.svelte';
  import Curtain from '../components/Curtain.svelte';
  import { session } from '../stores/session.svelte';
  import { settings } from '../stores/settings.svelte';
  import type { Voicing } from '../sound/voicing';

  const v = $derived(settings.value);
  let cams = $state<MediaDeviceInfo[]>([]);
  async function refreshCams() {
    try { cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'); } catch { cams = []; }
  }
  $effect(() => { if (session.curtain === 'settings') void refreshCams(); });
  async function pickCamera(id: string) {
    const c = cams.find((d) => d.deviceId === id);
    await settings.update({ cameraId: id, cameraLabel: c?.label ?? '' });
    if (session.cameraOn) { await session.stopSensing(); await session.startSensing(); }
  }
  async function set<K extends keyof typeof settings.value>(k: K, val: (typeof settings.value)[K]) {
    await settings.update({ [k]: val } as Partial<typeof settings.value>);
    if (k === 'voicing') session.audio?.setVoicing(val as Voicing);
    if (k === 'volumeDb') session.audio?.setVolume(val as number);
    if (k === 'motion') session.applyMotion();
    if (k === 'targetBpm' || k === 'readyGesture' || k === 'fuseAbdomen') session.rebuildPipeline();
  }
</script>

<Curtain open={session.curtain === 'settings'} title="Settings" onclose={() => (session.curtain = null)}>
  <fieldset>
    <legend class="label">ensemble</legend>
    <label><input type="radio" name="ens" checked={v.ensemble === 'choir'} onchange={() => session.setEnsemble('choir')} /> Choir (eight voices)</label>
    <label><input type="radio" name="ens" checked={v.ensemble === 'quartet'} onchange={() => session.setEnsemble('quartet')} /> String quartet{session.ensembleKind === 'strings-synth' ? ' (samples unavailable — synth strings)' : ''}</label>
  </fieldset>
  <fieldset>
    <legend class="label">camera</legend>
    <select value={v.cameraId} onchange={(e) => pickCamera((e.currentTarget as HTMLSelectElement).value)} data-testid="camera-select" aria-label="Camera">
      <option value="">Default camera</option>
      {#each cams as c, i (c.deviceId)}<option value={c.deviceId}>{c.label || `Camera ${i + 1}`}</option>{/each}
    </select>
    <button class="link" onclick={refreshCams}>refresh list</button>
    <p class="muted cam-note">iPhone via Camo or iVCam appears here as its own camera.</p>
  </fieldset>
  <fieldset>
    <legend class="label">voicing</legend>
    {#each ['open', 'close', 'unison'] as const as o (o)}
      <label><input type="radio" name="voicing" checked={v.voicing === o} onchange={() => set('voicing', o)} /> {o}</label>
    {/each}
  </fieldset>
  <label class="row"><span class="label">volume</span>
    <input type="range" min="-30" max="0" step="1" value={v.volumeDb} oninput={(e) => set('volumeDb', +(e.currentTarget as HTMLInputElement).value)} aria-valuetext="{v.volumeDb} decibels" />
    <span>{v.volumeDb} dB</span>
  </label>
  <label class="row"><span class="label">target tempo</span>
    <input type="range" min="40" max="160" step="1" value={v.targetBpm} oninput={(e) => set('targetBpm', +(e.currentTarget as HTMLInputElement).value)} aria-valuetext="{v.targetBpm} beats per minute" />
    <span class="tempo small">♩ = {v.targetBpm}</span>
  </label>
  <fieldset>
    <legend class="label">ready by</legend>
    <label><input type="radio" name="ready" checked={v.readyGesture} onchange={() => set('readyGesture', true)} /> Chin lift or <kbd>R</kbd></label>
    <label><input type="radio" name="ready" checked={!v.readyGesture} onchange={() => set('readyGesture', false)} /> <kbd>R</kbd> key only</label>
  </fieldset>
  <fieldset>
    <legend class="label">camera size</legend>
    <label><input type="radio" name="cap" checked={v.captureSize === '1280x720'} onchange={() => set('captureSize', '1280x720')} /> 1280 × 720</label>
    <label><input type="radio" name="cap" checked={v.captureSize === '960x540'} onchange={() => set('captureSize', '960x540')} /> 960 × 540 — lighter; use it if the frame rate is too low (applies when the camera next starts)</label>
  </fieldset>
  <fieldset>
    <legend class="label">motion</legend>
    {#each [['system', 'Follow the system'], ['reduce', 'Reduced'], ['full', 'Full']] as const as [val, text] (val)}
      <label><input type="radio" name="motion" checked={v.motion === val} onchange={() => set('motion', val)} /> {text}</label>
    {/each}
  </fieldset>
  <label class="check"><input type="checkbox" checked={v.showMirror} onchange={(e) => set('showMirror', (e.currentTarget as HTMLInputElement).checked)} /> Show the camera mirror in the podium</label>
  <label class="check"><input type="checkbox" checked={v.blurMirror} onchange={(e) => set('blurMirror', (e.currentTarget as HTMLInputElement).checked)} /> Blur the camera mirror</label>
  <label class="check"><input type="checkbox" checked={v.fuseAbdomen} onchange={(e) => set('fuseAbdomen', (e.currentTarget as HTMLInputElement).checked)} /> Use the belly trace too (singers, waist in view)</label>

  <div class="actions">
    <Button kind="quiet" onclick={() => session.toggleRecording()} disabled={session.mode !== 'live'} testid="record-toggle">
      {session.recording ? 'Stop recording' : 'Record numbers'}
    </Button>
    <Button kind="quiet" onclick={() => { session.curtain = null; session.go('timing'); }}>Timing check</Button>
    <Button kind="quiet" onclick={() => { session.curtain = null; session.calib = { phase: 'intro', restLeftS: 20, trial: 0, bpm: 60, outcome: null }; session.go('calibration'); }} disabled={session.mode !== 'live'}>Recalibrate</Button>
    <Button kind="quiet" onclick={() => (session.curtain = 'privacy')}>Privacy</Button>
  </div>
  <p class="muted">Keys: <kbd>R</kbd> ready · <kbd>Space</kbd> count-in entry · <kbd>D</kbd> drills · <kbd>H</kbd> how it works · <kbd>Esc</kbd> stop</p>
</Curtain>

<style>
  fieldset { border: 0; padding: 0; margin: 0 0 16px; display: flex; flex-direction: column; gap: 6px; }
  legend { color: var(--muted); margin-bottom: 6px; }
  .row { display: grid; grid-template-columns: 140px 1fr 90px; align-items: center; gap: 12px; margin: 10px 0 16px; }
  .row .label { color: var(--muted); }
  .check { display: block; margin: 8px 0; }
  input[type='range'] { accent-color: var(--brass); }
  input[type='radio'], input[type='checkbox'] { accent-color: var(--brass); width: 18px; height: 18px; }
  .small { font-size: 26px; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 18px 0; }
  select { background: var(--bg); color: var(--parchment); border: 0; border-bottom: 1px solid var(--brass); font: var(--body); padding: 6px 2px; }
  .link { background: none; border: 0; color: var(--brass); font: inherit; cursor: pointer; text-decoration: underline; padding: 0; align-self: flex-start; }
  .cam-note { font-size: 18px; margin: 0; }
</style>
