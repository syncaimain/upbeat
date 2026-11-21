<!-- Underlined form field, label in small caps. -->
<script lang="ts">
  interface Props { label: string; value: string; type?: string; placeholder?: string; id: string; autocomplete?: 'off' | 'on'; hint?: string }
  let { label, value = $bindable(), type = 'text', placeholder = '', id, autocomplete = 'off', hint }: Props = $props();
</script>

<div class="field">
  <label class="label" for={id}>{label}</label>
  <input {id} {type} {placeholder} {autocomplete} spellcheck="false" bind:value aria-describedby={hint ? `${id}-hint` : undefined} />
  {#if hint}<p class="hint muted" id="{id}-hint">{hint}</p>{/if}
</div>

<style>
  .field { display: flex; flex-direction: column; gap: 6px; margin: 10px 0 18px; }
  input {
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--brass);
    color: var(--parchment);
    font: var(--body);
    padding: 6px 2px;
    outline: none;
  }
  input:focus-visible { outline: 2px solid var(--parchment); outline-offset: 4px; }
  .hint { font-size: 18px; margin: 0; }
</style>
