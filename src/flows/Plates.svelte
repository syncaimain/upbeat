<!-- Three engraved "how it works" plates: Ready → Breathe → Enter. H reopens. -->
<script lang="ts">
  import Button from '../components/Button.svelte';
  import { session } from '../stores/session.svelte';
  import { settings } from '../stores/settings.svelte';

  let i = $state(0);
  const plates = [
    { title: 'Ready', body: 'Lift your chin a little and hold it — or press R. The singers straighten: they are watching you.' },
    { title: 'Breathe', body: 'Breathe in on the preparatory beat, the way you would before a downbeat. How quickly the breath rises tells the choir the tempo.' },
    { title: 'Enter', body: 'The choir comes in on the downbeat, at your tempo. A shallow breath — or just a nod — and they come in ragged. The note tells you what your breath said.' },
  ];
  async function close() {
    session.plates = false;
    i = 0;
    await settings.update({ platesSeen: true });
  }
</script>

{#if session.plates}
  <div class="scrim" role="dialog" aria-modal="true" aria-label="How it works" data-testid="plates">
    <div class="plate">
      <svg viewBox="0 0 220 120" width="220" height="120" aria-hidden="true">
        <rect x="4" y="4" width="212" height="112" fill="none" stroke="#d4a93c" stroke-width="1" />
        <rect x="9" y="9" width="202" height="102" fill="none" stroke="#d4a93c" stroke-opacity="0.4" stroke-width="0.75" />
        {#if i === 0}
          <path d="M80 92 v-40 a 30 30 0 0 1 60 0 v 40" fill="none" stroke="#f3e9d2" stroke-width="1.25" />
          <circle cx="110" cy="36" r="13" fill="none" stroke="#f3e9d2" stroke-width="1.25" />
          <path d="M140 30 l 14 -10" stroke="#d4a93c" stroke-width="1.5" />
        {:else if i === 1}
          <path d="M30 90 C 70 90, 90 30, 130 28 S 175 60, 190 90" fill="none" stroke="#d4a93c" stroke-width="2" />
          <line x1="62" y1="80" x2="62" y2="98" stroke="#f3e9d2" />
          <circle cx="130" cy="28" r="5" fill="#d4a93c" />
        {:else}
          {#each [0, 1, 2, 3, 4, 5, 6, 7] as k (k)}
            <rect x={34 + k * 20} y="40" width="10" height="56" rx="5" fill="#f3e9d2" fill-opacity="0.85" />
          {/each}
        {/if}
      </svg>
      <p class="label muted">plate {i + 1} of 3</p>
      <h2>{plates[i]!.title}</h2>
      <p>{plates[i]!.body}</p>
      <div class="actions">
        {#if i > 0}<Button kind="quiet" onclick={() => (i -= 1)}>Back</Button>{/if}
        {#if i < 2}<Button onclick={() => (i += 1)} testid="plate-next">Next</Button>{:else}<Button onclick={close} testid="plate-done">Begin</Button>{/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; background: #0b0609d9; display: grid; place-items: center; z-index: 50; }
  .plate { background: var(--panel); border-top: 2px solid var(--brass); padding: 30px 40px; max-width: 560px; text-align: center; }
  .actions { display: flex; gap: 12px; justify-content: center; margin-top: 18px; }
</style>
