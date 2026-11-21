<!-- In-scene corner HUD: exercise name (top-left), score strip (top),
     camera dot + settings + Stop (top-right), programme-note feedback
     (bottom-left), candles (bottom-right), caption line (bottom centre). -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Candles from '../scene/Candles.svelte';
  import ScoreStrip from '../scene/ScoreStrip.svelte';
  import Icon from '../scene/Icon.svelte';
  import { session } from '../stores/session.svelte';
  import { settings } from '../stores/settings.svelte';

  interface Props { exercise: string; candles?: { total: number; lit: number } | null; extra?: Snippet; showStrip?: boolean }
  let { exercise, candles = null, extra, showStrip = true }: Props = $props();

  const status = $derived(
    session.pause ? 'Paused' : session.sounding ? 'Sounding' : session.armed ? 'Ready — breathe in on the preparatory beat'
      : session.mode === 'live' ? (session.gate?.cuesAllowed ? 'Listening — lift your chin or press R' : session.gate?.reason ? `Waiting — ${session.gate.reason}` : 'Listening')
      : session.mode === 'replay' ? 'Replaying recorded numbers'
      : 'Metronome mode — press Space');
</script>

<header class="top">
  <div class="exercise">
    <span class="label muted">exercise</span>
    <h3 data-testid="exercise-name">{exercise}</h3>
  </div>
  {#if showStrip}<ScoreStrip target={session.targetBpm} entries={session.strip} />{/if}
  <div class="controls">
    <span class="cam" class:on={session.cameraOn} data-testid="camera-dot" role="status"
      aria-label={session.cameraOn ? 'Camera on' : 'Camera off'}>
      <span class="dot" aria-hidden="true"></span><span class="label">{session.cameraOn ? 'camera on' : 'camera off'}</span>
    </span>
    {#if session.recording}<span class="rec label" role="status"><Icon name="record" size={18} /> recording numbers</span>{/if}
    <button class="icon" onclick={() => (session.plates = true)} aria-label="How it works (H)"><Icon name="help" /></button>
    <button class="icon" onclick={() => (session.curtain = 'settings')} aria-label="Settings"><Icon name="gear" /></button>
    <button class="stop label" onclick={() => session.stopAll()} data-testid="stop">
      <Icon name="stop" size={18} /> stop <kbd>Esc</kbd>
    </button>
  </div>
</header>

{#if session.replayInfo}
  <div class="replay label" role="status" data-testid="replay-banner">
    {session.replayInfo.synthetic ? 'replay — synthetic demo numbers, not a recording' : 'replay — recorded numbers'}
  </div>
{/if}

<p class="podium-label label" class:beside={session.mirrorVisible} aria-live="off" data-testid="podium-status">{status}</p>

{#if session.countLabel}
  <p class="count" aria-hidden="true" data-testid="count">{session.countLabel}</p>
{/if}

{#if session.mirrorVisible && session.cameraOn && !session.framing().allOk}
  <p class="frame-hint" data-testid="frame-hint">{session.framingText()}</p>
{/if}

<div class="captions" class:above-mirror={session.mirrorVisible} aria-live="polite" data-testid="captions">
  {#each session.captions as c (c.id)}
    <p class={c.tone}>{c.text}</p>
  {/each}
</div>

<section class="feedback" aria-label="Feedback" data-testid="feedback">
  {#if session.feedback.length}
    {#each session.feedback as line, i (i)}
      <p class:lead={i === 0} class={i === 0 ? session.feedbackTone : ''}>{line}</p>
    {/each}
  {:else}
    <p class="muted">Lift your chin (or press <kbd>R</kbd>), then breathe in on the preparatory beat. <kbd>Space</kbd> gives a count-in entry.</p>
  {/if}
</section>

{#if candles}
  <div class="candles"><Candles total={candles.total} lit={candles.lit} reduced={session.reducedMotion} /></div>
{/if}

{#if extra}{@render extra()}{/if}

<style>
  .top {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: grid;
    grid-template-columns: minmax(200px, 1fr) auto minmax(200px, 1fr);
    align-items: center;
    gap: 20px;
    padding: 6px var(--hud-inset) 0;
    min-height: var(--strip-h);
    background: linear-gradient(#140c10ee, #140c1000);
  }
  .exercise h3 { margin: 0; }
  .exercise .label { display: block; font-size: 18px; }
  .controls { display: flex; justify-content: flex-end; align-items: center; gap: 10px; flex-wrap: wrap; }
  .cam { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); }
  .cam .dot { width: 10px; height: 10px; border-radius: 50%; border: 1px solid var(--brass); }
  .cam.on { color: var(--parchment); }
  .cam.on .dot { background: var(--brass); box-shadow: 0 0 10px var(--brass); }
  .rec { display: inline-flex; gap: 6px; align-items: center; color: var(--ragged); }
  .icon, .stop {
    background: none;
    color: var(--parchment);
    border: 1px solid transparent;
    cursor: pointer;
    min-height: 44px;
    min-width: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .icon:hover, .stop:hover { border-color: var(--brass-40); }
  .stop { border-color: var(--brass); padding: 4px 14px; }
  .replay {
    position: absolute;
    top: calc(var(--strip-h) + 14px);
    left: 50%;
    transform: translateX(-50%);
    border: 1px solid var(--ragged);
    color: var(--parchment);
    padding: 4px 16px;
    background: #140c10cc;
  }
  .podium-label {
    position: absolute;
    left: 50%;
    bottom: 2.2%;
    transform: translateX(-50%);
    margin: 0;
    color: var(--muted);
    white-space: nowrap;
  }
  .podium-label.beside { left: 58.5%; transform: none; bottom: 3%; white-space: normal; max-width: 15%; }
  .count {
    position: absolute;
    left: 50%;
    top: 63%;
    transform: translate(-50%, -50%);
    font: 600 64px/1 var(--serif);
    color: var(--brass);
    margin: 0;
    font-variant-numeric: lining-nums;
  }
  .captions {
    position: absolute;
    left: 50%;
    bottom: 13%;
    transform: translateX(-50%);
    text-align: center;
    width: min(34%, 520px);
  }
  .captions.above-mirror { bottom: 19%; }
  .frame-hint { position: absolute; left: 50%; transform: translateX(-50%); bottom: 16.5%; margin: 0; font: 600 22px/26px var(--serif); color: var(--ragged); }
  .captions p { margin: 0 0 2px; font-size: 18px; color: var(--muted); }
  .captions p:last-child { color: var(--parchment); font-size: 20px; }
  .captions p.together:last-child { color: var(--together); }
  .captions p.ragged:last-child { color: var(--ragged); }
  .feedback {
    position: absolute;
    left: var(--hud-inset);
    bottom: 4%;
    width: min(24%, 380px);
    background: #1e1218e6;
    border-top: 2px solid var(--brass);
    padding: 14px 18px 8px;
  }
  .feedback p { margin: 0 0 8px; }
  .feedback .lead { font: 600 24px/30px var(--serif); }
  .candles { position: absolute; right: var(--hud-inset); bottom: 4%; }
</style>
