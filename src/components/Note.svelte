<!-- Programme note: parchment text on #1E1218 with a 2 px brass rule on top. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  interface Props { title?: string; wide?: boolean; role?: string; children: Snippet; testid?: string }
  let { title, wide = false, role, children, testid }: Props = $props();
</script>

<section class="note" class:wide {role} aria-label={title} data-testid={testid}>
  {#if title}<h2>{title}</h2>{/if}
  {@render children()}
</section>

<style>
  .note {
    background: var(--panel);
    border-top: 2px solid var(--brass);
    padding: 28px 36px 30px;
    max-width: 640px;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55);
  }
  .wide { max-width: 920px; }
  .note :global(h2) { margin-bottom: 14px; }
  .note :global(.actions) { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 22px; }
</style>
