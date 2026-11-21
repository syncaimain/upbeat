// Runs the RESULTS.md self-test protocol on SYNTHETIC breathing
// (fixtures/synth.ts) through the real pipeline and cue engine:
//   A. 30 cues at ♩ = 72      B. 2 min resting breath with Ready held on
//   C. tempo ladder 60 → 120  D. nod without breath ×5, shallow breath ×5
// Prints Markdown. This checks the logic end to end; it is not evidence about
// the real SDK — the live protocol in docs/RESULTS.md is.

import { readFileSync } from 'node:fs';
import { scoreDrill } from '../src/engine/drills';
import type { CueResult } from '../src/engine/types';
import { runHeadless } from '../src/sense/driver';
import { Pipeline } from '../src/sense/pipeline';
import { parseRecording } from '../src/sense/replay';
import { mulberry32 } from '../src/engine/rng';
import { synthesize, type Script } from '../fixtures/synth';

const profile = parseRecording(readFileSync('static/fixtures/demo-session.jsonl', 'utf8')).header.profile!;
const rng = mulberry32(2026);

function run(script: Script[], dur: number, targets: (i: number) => number, seed: number) {
  const syn = synthesize({ durationS: dur, seed, script });
  let cue = 0;
  const pl = new Pipeline({ profile, mode: { kind: 'predict', k: profile.k, targetBpm: targets(0) }, voices: 8, gesture: true, seed: 1, fuseAbdomen: false });
  const results: CueResult[] = [];
  const commits: string[] = [];
  runHeadless(pl, syn.events, {
    onEngine: (evs) => {
      for (const e of evs) {
        if (e.type === 'commit') commits.push(`${e.entry.cause}:${e.entry.quality}`);
        if (e.type === 'result') {
          results.push(e.result);
          cue++;
          pl.engine.setMode({ kind: 'predict', k: profile.k, targetBpm: targets(cue) });
        }
      }
    },
    metronomeBpm: () => 72,
  });
  return { results, commits, truth: syn.truth };
}

const f = (n: number | undefined, d = 1) => (n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(d));
const out: string[] = [];
const p = (s = '') => out.push(s);

// A. 30 cues at 72: a "student" whose breath beat varies ±6 % around 72.
{
  const script: Script[] = [];
  for (let i = 0; i < 30; i++) {
    const at = 36 + i * 7;
    script.push({ kind: 'key', at: at - 1, key: 'ready' }, { kind: 'prep', at, beatS: (60 / 72) * (1 + (rng() - 0.5) * 0.12), depth: 1.8 + rng() * 0.7 });
  }
  const r = run(script, 36 + 30 * 7 + 5, () => 72, 101);
  const s = scoreDrill('consistency', r.results.filter((x) => x.cause === 'breath'));
  const detected = r.results.filter((x) => x.cause === 'breath').length;
  p(`**A. 30 cues at ♩ = 72.** Entries: ${detected}/30 (${f((100 * detected) / 30, 0)} %). Tight: ${f(100 * s.tightFraction, 0)} %. Tempo set vs target: mean ${f(s.meanErrorBpm)} bpm, spread (SD) ${f(s.spreadBpm)} bpm, mean |error| ${f(s.meanAbsErrorBpm)} bpm. Set vs peak-measured: ${f(s.predictionErrorBpm)} bpm mean |difference|.`);
}
// B. 2 min resting breath, Ready pressed every 5.5 s.
{
  const script: Script[] = [];
  for (let t = 32; t < 152; t += 5.5) script.push({ kind: 'key', at: t, key: 'ready' });
  const r = run(script, 152, () => 72, 102);
  p(`**B. 2 min resting breath, Ready held on (pressed every 5.5 s).** False entries: ${r.commits.length}.`);
}
// C. Tempo ladder.
{
  const ladder = [60, 70, 80, 90, 100, 110, 120];
  const script: Script[] = [];
  ladder.forEach((bpm, i) => {
    const at = 36 + i * 8;
    script.push({ kind: 'key', at: at - 1, key: 'ready' }, { kind: 'prep', at, beatS: (60 / bpm) * (1 + (rng() - 0.5) * 0.08), depth: 1.9 + rng() * 0.6 });
  });
  const r = run(script, 36 + 7 * 8 + 5, (i) => ladder[Math.min(i, ladder.length - 1)]!, 103);
  p('**C. Tempo ladder 60 → 120.**');
  p();
  p('| target | set by breath | peak-measured | entry |');
  p('|---|---|---|---|');
  r.results.forEach((x) => p(`| ${x.targetBpm} | ${f(x.plannedBpm, 0)} | ${f(x.measuredBpm, 0)} | ${x.quality}${x.tooFast ? ' (too fast)' : ''} |`));
  const s = scoreDrill('ladder', r.results);
  p();
  p(`Ladder: mean |error| ${f(s.meanAbsErrorBpm)} bpm, mean ${f(s.meanErrorBpm)} bpm.`);
}
// D. Nods and shallow breaths.
{
  const script: Script[] = [];
  for (let i = 0; i < 5; i++) script.push({ kind: 'lift', at: 36 + i * 8, deg: 10, holdS: 1.2 });
  for (let i = 0; i < 5; i++) script.push({ kind: 'key', at: 75 + i * 8, key: 'ready' }, { kind: 'prep', at: 76 + i * 8, beatS: 0.6 + rng() * 0.3, depth: 0.8 + rng() * 0.3 });
  const r = run(script, 120, () => 72, 104);
  const nods = r.commits.filter((c) => c.startsWith('nod'));
  const shallow = r.commits.filter((c) => c.startsWith('breath'));
  p(`**D. 5 nods without a breath → ${nods.length} entries, ${nods.filter((c) => c.endsWith('ragged')).length} ragged. 5 shallow breaths (0.8–1.1× rest) → ${shallow.length} entries, ${shallow.filter((c) => c.endsWith('ragged')).length} ragged** (a shallow breath may also produce no entry, which is allowed).`);
}
console.log(out.join('\n'));
