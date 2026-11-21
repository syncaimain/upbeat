<!-- Full-screen 16:9 scene, letterboxed. The SVG scales; the HUD is real CSS
     pixels positioned over it, so text never shrinks below 18 px. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { session } from '../stores/session.svelte';
  import { settings } from '../stores/settings.svelte';
  import { CHOIR_LABELS, QUARTET_LABELS } from '../sound/voicing';
  import Hall from './Hall.svelte';
  import Singers from './Singers.svelte';
  import BreathArc from './BreathArc.svelte';
  import Podium from './Podium.svelte';
  import MirrorMarkers from './MirrorMarkers.svelte';

  let { hud, showEnsemble = true, showArc = true, tuning = false }: { hud?: Snippet; showEnsemble?: boolean; showArc?: boolean; tuning?: boolean } = $props();

  let box: HTMLDivElement | undefined = $state();
  let video: HTMLVideoElement | undefined = $state();
  let w = $state(1600);
  let h = $state(900);

  $effect(() => {
    const fit = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      if (vw / vh > 16 / 9) { h = vh; w = (vh * 16) / 9; } else { w = vw; h = (vw * 9) / 16; }
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  });

  $effect(() => {
    if (video) video.srcObject = settings.value.showMirror ? session.stream : null;
  });

  const count = $derived(settings.value.ensemble === 'choir' ? 8 : 4);
  const posture = $derived(session.sounding ? 'sing' : session.armed ? 'ready' : 'rest');
  const paused = $derived(!!session.pause);
  const podiumState = $derived(paused ? 'paused' : session.sounding ? 'sounding' : session.armed ? 'ready' : 'idle');
  const arcState = $derived(paused ? 'paused' : tuning ? 'tuning' : session.sounding ? 'sounding' : session.armed ? 'ready' : 'idle');
  const progress = $derived.by(() => {
    const p = session.plan;
    if (!p || p.cause === 'metronome') return null;
    const span = p.downbeatPerf - p.t0Perf;
    return span > 0 ? Math.min(1, Math.max(0, (session.frame - p.t0Perf) / span)) : 1;
  });
</script>

<div class="frame">
  <div class="stage" bind:this={box} style="width:{w}px;height:{h}px" data-testid="stage" data-paused={paused}>
    <svg viewBox="0 0 1600 900" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <Hall dim={paused} />
      {#if showEnsemble}
        <Singers {count} {posture} litAt={session.voiceLitPerf} late={session.voiceLate} now={session.frame}
          reduced={session.reducedMotion} labels={count === 8 ? CHOIR_LABELS : QUARTET_LABELS} tone={session.entryQuality} />
      {/if}
      {#if showArc}
        <BreathArc level={session.level} onsetLevel={session.onset?.level ?? null} {progress} state={arcState} reduced={session.reducedMotion} />
      {/if}
      <Podium state={podiumState} reduced={session.reducedMotion} />
    </svg>
    {#if session.mirrorVisible}
      <!-- svelte-ignore a11y_media_has_caption -->
      <div class="mirror" aria-label="Camera mirror{settings.value.blurMirror ? ' (blurred)' : ''}" data-testid="podium-mirror">
        <video class:blur={settings.value.blurMirror} bind:this={video} autoplay muted playsinline></video>
        <MirrorMarkers compact />
      </div>
    {/if}
    {#if hud}<div class="hud">{@render hud()}</div>{/if}
  </div>
</div>

<style>
  .frame {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: #0b0609;
  }
  .stage { position: relative; overflow: hidden; background: var(--bg); }
  .stage > svg { position: absolute; inset: 0; display: block; }
  .hud { position: absolute; inset: 0; pointer-events: none; }
  .hud > :global(*) { pointer-events: auto; }
  .mirror {
    position: absolute;
    left: 50%;
    top: 91.5%;
    width: 15%;
    aspect-ratio: 16 / 9;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    overflow: hidden;
    border: 1px solid var(--brass);
    background: #0d0709;
  }
  .mirror video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    transform: scaleX(-1);
    opacity: 0.9;
  }
  /* Strong enough that a face is not recognisable; breathing motion and the
     silhouette remain visible. */
  .mirror video.blur { filter: blur(16px) saturate(0.7); }
</style>
