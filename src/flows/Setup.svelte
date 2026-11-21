<!-- F1: API key (safeStorage), camera choice, readiness check, framing guide
     with a live oval mirror and the SDK's hints shown as-is. -->
<script lang="ts">
  import Button from '../components/Button.svelte';
  import Field from '../components/Field.svelte';
  import Note from '../components/Note.svelte';
  import Stage from '../scene/Stage.svelte';
  import MirrorMarkers from '../scene/MirrorMarkers.svelte';
  import { SenseClient } from '../sense/sdk';
  import { session } from '../stores/session.svelte';
  import { settings } from '../stores/settings.svelte';
  import type { KeyStatus } from '../env';

  let keyStatus = $state<KeyStatus | null>(null);
  let keyInput = $state('');
  let keyMsg = $state('');
  let cameras = $state<MediaDeviceInfo[]>([]);
  let video: HTMLVideoElement | undefined = $state();

  async function refreshKey() {
    keyStatus = (await window.upbeat?.key.status()) ?? null;
  }
  $effect(() => { void refreshKey(); });
  $effect(() => { if (video) video.srcObject = session.stream; });

  async function saveKey() {
    try {
      const r = await window.upbeat!.key.save(keyInput);
      keyInput = '';
      keyMsg = r.persisted ? 'Saved, encrypted by your operating system.' : 'Kept for this session only (no system keychain available).';
      await refreshKey();
    } catch {
      keyMsg = 'That does not look like an API key.';
    }
  }

  async function check() {
    await session.checkReadiness();
    if (session.readiness?.verdict === 'ready' || session.readiness?.verdict === 'limited') {
      await session.startSensing();
      cameras = await SenseClient.cameras();
    }
  }

  async function chooseCamera(id: string) {
    await settings.update({ cameraId: id, cameraLabel: cameras.find((c) => c.deviceId === id)?.label ?? '' });
    await session.stopSensing();
    await session.startSensing();
  }

  const verdictWords: Record<string, string> = {
    ready: 'Ready — this computer can follow your breathing.',
    limited: 'Limited — it may work, but the camera or computer is near its limit.',
    blocked: 'Blocked — this computer cannot run the measurement.',
    inconclusive: 'Inconclusive — the check could not finish.',
    checking: 'The hall is opening…',
  };
  const hint = $derived(session.gate && session.gate.code !== 0 ? session.gate.hint : '');
</script>

<Stage showArc={false} showEnsemble={false}>
  {#snippet hud()}
    <div class="layout">
      <Note title="Setting the stage" testid="setup">
        {#if !keyStatus?.present}
          <Field id="apikey" label="SmartSpectra API key" type="password" bind:value={keyInput}
            hint="From physiology.presagetech.com. Stored encrypted in the main process; never logged." />
          <div class="actions"><Button onclick={saveKey} disabled={keyInput.trim().length < 8} testid="save-key">Save key</Button></div>
        {:else}
          <p>API key: <span class="together">saved</span> <span class="muted">({keyStatus.source === 'safeStorage' ? 'encrypted' : keyStatus.source === 'env' ? 'from .env, development' : 'this session only'})</span></p>
        {/if}
        {#if keyMsg}<p class="muted" role="status">{keyMsg}</p>{/if}

        <h3>Framing</h3>
        <ul>
          <li>Put the camera somewhere still — not handheld.</li>
          <li>Sit or stand still with your face and chest lit and in view. Singers: your waist too.</li>
          <li>Plain clothing works best; tight stripes confuse the camera.</li>
        </ul>

        {#if session.readiness}
          <p role="status" data-testid="readiness" class:ragged={session.readiness.verdict === 'blocked'}>
            {verdictWords[session.readiness.verdict] ?? session.readiness.verdict}
            {#if session.readiness.verdict !== 'checking' && session.readiness.verdict !== 'ready'}<br /><span class="muted">{session.readiness.reason}</span>{/if}
          </p>
        {/if}
        {#if cameras.length > 1}
          <label class="label" for="cam">camera</label>
          <select id="cam" value={settings.value.cameraId} onchange={(e) => chooseCamera((e.currentTarget as HTMLSelectElement).value)}>
            <option value="">Default camera</option>
            {#each cameras as c (c.deviceId)}<option value={c.deviceId}>{c.label || 'Camera'}</option>{/each}
          </select>
        {/if}
        <div class="actions">
          {#if !session.cameraOn}
            <Button onclick={check} disabled={!keyStatus?.present || session.readiness?.verdict === 'checking' || session.starting} testid="check-hall">Check the hall</Button>
          {:else}
            <Button onclick={() => session.beginWarmup()} testid="begin-warmup">Begin the warm-up</Button>
          {/if}
          <Button kind="quiet" onclick={() => session.go('welcome')}>Back</Button>
        </div>
      </Note>
      <div class="mirror-col">
        <div class="oval" style="--ar: {session.frameSize().w / session.frameSize().h}" aria-label="Framing mirror">
          {#if session.stream}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video bind:this={video} class:blur={settings.value.blurMirror} autoplay muted playsinline></video>
            <MirrorMarkers />
          {:else}
            <p class="muted">The mirror opens after the check.</p>
          {/if}
        </div>
        <p class="hint" role="status" aria-live="polite" data-testid="sdk-hint">{hint ? hint : session.cameraOn ? 'Framing looks fine.' : ''}</p>
        {#if session.cameraOn}
          {@const ok = session.framing().allOk}
          <p class="instruction" class:ok aria-live="polite" data-testid="framing">{session.framingText()}</p>
          <p class="muted legend">Put the dot inside the head. The outline turns green when you are in the right place.</p>
        {/if}
        {#if session.gate?.code === 11}
          <p class="muted">The camera is below 25 frames a second. Add light on your face, close other camera or video apps, or choose 960 × 540 in Settings.</p>
        {/if}
      </div>
    </div>
  {/snippet}
</Stage>

<style>
  .layout { position: absolute; inset: 0; display: grid; grid-template-columns: minmax(360px, 520px) minmax(380px, 1fr); gap: 3%; align-items: center; padding: 3% var(--hud-inset); }
  ul { padding-left: 20px; }
  h3 { margin-top: 22px; }
  select { background: var(--panel); color: var(--parchment); border: 0; border-bottom: 1px solid var(--brass); font: var(--body); padding: 6px 2px; width: 100%; margin-bottom: 10px; }
  .mirror-col { display: flex; flex-direction: column; align-items: center; gap: 16px; }
  .oval { width: min(100%, 460px); max-height: 70vh; aspect-ratio: var(--ar, 1.7778); border-radius: 18px; overflow: hidden; border: 1px solid var(--brass); display: grid; place-items: center; position: relative; background: #0d0709; }
  .oval video { width: 100%; height: 100%; object-fit: contain; transform: scaleX(-1); }
  .oval video.blur { filter: blur(16px) saturate(0.7); }
  .hint { min-height: 28px; text-align: center; }
  .instruction { margin: 0; font: 600 34px/40px var(--serif); color: var(--ragged); text-align: center; }
  .instruction.ok { color: var(--together); }
  .legend { margin: 0; text-align: center; }
</style>
