<!-- Results on a five-line staff, with mean and spread of the tempo error and
     the share of tight entries. Numbers only; deletable from Privacy. -->
<script lang="ts">
  import Button from '../components/Button.svelte';
  import Note from '../components/Note.svelte';
  import Stage from '../scene/Stage.svelte';
  import Staff from '../scene/Staff.svelte';
  import { scoredTempo } from '../engine/drills';
  import { profileStore } from '../stores/profile.svelte';
  import { session } from '../stores/session.svelte';

  const s = $derived(session.lastScore);
  const h = $derived(profileStore.history[0]);
  const fmt = (n: number | undefined, d = 1) => (n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(d));
  const signed = (n: number) => (Number.isFinite(n) ? `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}` : '—');

  function exportSummary() {
    if (!s) return;
    const lines = [
      `# Upbeat drill summary — ${s.kind}`, '',
      `Cues: ${s.cues} · scored: ${s.scored} · tight entries: ${Math.round(s.tightFraction * 100)} %`,
      `Tempo error: mean ${signed(s.meanErrorBpm)} bpm, spread ${fmt(s.spreadBpm)} bpm, mean absolute ${fmt(s.meanAbsErrorBpm)} bpm`, '',
      '| # | target | set | peak | entry |', '|---|---|---|---|---|',
      ...s.results.map((r, i) => `| ${i + 1} | ${r.targetBpm ?? '—'} | ${fmt(scoredTempo(r), 0)} | ${fmt(r.measuredBpm, 0)} | ${r.quality} |`),
      '', 'Numbers only. Upbeat measures musical timing, not breathing health.',
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `upbeat-${s.kind}-summary.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
</script>

<Stage showEnsemble={false} showArc={false}>
  {#snippet hud()}
    <div class="center">
      <Note title="Results" wide testid="results">
        {#if s && h}
          <Staff targets={[...h.targets]} set={[...h.set]} measured={[...h.measured]} qualities={[...h.qualities]} />
          <dl>
            <div><dt class="label">tempo error</dt><dd class="tempo" data-testid="mean-error">{signed(s.meanErrorBpm)}</dd></div>
            <div><dt class="label">spread</dt><dd class="tempo">{fmt(s.spreadBpm)}</dd></div>
            <div><dt class="label">tight entries</dt><dd class="tempo" data-testid="tight-pct">{Math.round(s.tightFraction * 100)} %</dd></div>
            {#if s.predictionErrorBpm !== undefined}<div><dt class="label">set vs peak</dt><dd class="tempo">{fmt(s.predictionErrorBpm)}</dd></div>{/if}
          </dl>
          <p class="muted">Noteheads: the tempo your breath set. Rings: the tempo measured at the breath's peak. Brass line: the target (bpm).</p>
        {:else}
          <p>No finished drill yet.</p>
        {/if}
        <div class="actions">
          <Button onclick={() => session.go('drills')}>Another drill</Button>
          <Button kind="quiet" onclick={exportSummary} disabled={!s}>Export teacher summary</Button>
          <Button kind="quiet" onclick={() => (session.curtain = 'privacy')}>Delete history…</Button>
        </div>
      </Note>
    </div>
  {/snippet}
</Stage>

<style>
  .center { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px; }
  dl { display: flex; gap: 36px; flex-wrap: wrap; margin: 12px 0; }
  dt { color: var(--muted); }
  dd { margin: 4px 0 0; }
</style>
