<!-- Settings / Privacy slide in from the right as a velvet curtain. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  interface Props { open: boolean; title: string; onclose: () => void; children: Snippet }
  let { open, title, onclose, children }: Props = $props();
  let panel: HTMLElement | undefined = $state();
  $effect(() => {
    if (open) queueMicrotask(() => panel?.querySelector<HTMLElement>('button, select, input')?.focus());
  });
</script>

{#if open}
  <div class="scrim" onclick={onclose} aria-hidden="true"></div>
{/if}
<aside class="curtain" class:open bind:this={panel} aria-label={title} aria-hidden={!open} inert={!open} data-testid="curtain">
  <div class="velvet" aria-hidden="true"></div>
  <div class="content">
    <header>
      <h2>{title}</h2>
      <button class="close label" onclick={onclose} aria-label="Close {title}">close <kbd>Esc</kbd></button>
    </header>
    {@render children()}
  </div>
</aside>

<style>
  .scrim { position: fixed; inset: 0; background: rgba(10, 5, 8, 0.45); z-index: 40; }
  .curtain {
    position: fixed;
    top: 0;
    right: 0;
    height: 100%;
    width: min(560px, 92vw);
    transform: translateX(105%);
    transition: transform 420ms var(--ease-curtain);
    z-index: 41;
    display: flex;
  }
  .curtain.open { transform: translateX(0); }
  .velvet {
    width: 34px;
    flex: none;
    background:
      repeating-linear-gradient(90deg, rgba(0,0,0,0.35) 0 3px, transparent 3px 11px),
      linear-gradient(90deg, #4a111b, var(--crimson) 60%, #5e1622);
    box-shadow: inset -6px 0 12px rgba(0, 0, 0, 0.4);
  }
  .content {
    flex: 1;
    background: var(--panel);
    border-left: 1px solid var(--brass-40);
    padding: 28px 32px 40px;
    overflow-y: auto;
  }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .close {
    background: none;
    border: 0;
    color: var(--parchment);
    cursor: pointer;
    padding: 8px;
  }
</style>
