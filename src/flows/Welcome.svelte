<script lang="ts">
  import Button from '../components/Button.svelte';
  import Logo from '../scene/Logo.svelte';
  import Stage from '../scene/Stage.svelte';
  import { session } from '../stores/session.svelte';
</script>

<Stage showArc={false}>
  {#snippet hud()}
    <div class="welcome">
      <Logo size={88} />
      <h1>Upbeat</h1>
      <p class="lede">A practice room where the choir enters on your breath — at the tempo your breath sets.</p>
      <div class="actions">
        <Button onclick={() => session.enterHall()} testid="enter-hall">Enter the hall</Button>
        <Button kind="quiet" onclick={() => session.startReplay()} testid="hear-replay">Hear a recorded session</Button>
      </div>
      <p class="small muted">
        No camera on this screen. A music practice tool — it measures timing, never health.
        <button class="link" onclick={() => (session.curtain = 'privacy')}>Privacy</button>
        {#if session.flags.probe}· <button class="link" onclick={() => session.go('probe')} data-testid="open-probe">Stage 1 probe</button>{/if}
      </p>
    </div>
  {/snippet}
</Stage>

<style>
  .welcome {
    position: absolute;
    left: 50%;
    top: 46%;
    transform: translate(-50%, -50%);
    text-align: center;
    width: min(760px, 90%);
  }
  h1 { font-size: 72px; line-height: 76px; margin: 8px 0 10px; }
  .lede { font: 500 28px/36px var(--serif); margin-bottom: 30px; }
  .actions { display: flex; gap: 18px; justify-content: center; flex-wrap: wrap; margin-bottom: 28px; }
  .small { font-size: 18px; }
  .link { background: none; border: 0; color: var(--brass); font: inherit; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; padding: 0 2px; }
</style>
