<!-- Engraved brass button: square corners, 1 px brass border plus an inner
     hairline 3 px inside, small-caps label. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  interface Props {
    onclick?: (e: MouseEvent) => void;
    kind?: 'primary' | 'quiet';
    type?: 'button' | 'submit';
    disabled?: boolean;
    keyHint?: string;
    label?: string;
    testid?: string;
    children: Snippet;
  }
  let { onclick, kind = 'primary', type = 'button', disabled = false, keyHint, label, testid, children }: Props = $props();
</script>

<button class="eng {kind}" {type} {disabled} {onclick} aria-label={label} data-testid={testid}>
  <span class="inner label">{@render children()}{#if keyHint}<span class="key" aria-hidden="true">{keyHint}</span>{/if}</span>
</button>

<style>
  .eng {
    position: relative;
    background: transparent;
    color: var(--parchment);
    border: 1px solid var(--brass);
    border-radius: 0;
    padding: 0;
    cursor: pointer;
    min-height: 48px;
    transition: background 120ms ease;
  }
  .eng::after {
    content: '';
    position: absolute;
    inset: 3px;
    border: 1px solid var(--brass-40);
    pointer-events: none;
  }
  .inner {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    padding: 10px 26px 12px;
  }
  .eng:hover:not(:disabled) { background: var(--brass-15); }
  .eng:disabled { opacity: 0.45; cursor: default; }
  .quiet { border-color: var(--brass-40); }
  .quiet::after { border-color: transparent; }
  .key {
    font-size: 18px;
    color: var(--brass);
    border-left: 1px solid var(--brass-40);
    padding-left: 10px;
  }
</style>
