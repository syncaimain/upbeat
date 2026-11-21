// Stage 1 analysis of numbers-only recordings (from the probe or
// Settings → Record numbers). Prints Markdown for docs/RESULTS.md.
//
//   npm run analyze -- --prep fixtures/prep.jsonl --rest fixtures/rest.jsonl \
//                      [--talk fixtures/talk.jsonl] [--profile path/to/profile.json]
//
// Without --profile the profile stored in the recording header is used; if
// there is none, the resting amplitude is taken from the rest recording and
// polarity/k are reported as assumptions.

import { readFileSync } from 'node:fs';
import { CUE } from '../config/cue';
import { PeakTracker } from '../src/engine/cue/confirmPeak';
import { OnsetDetector, valueAt } from '../src/engine/cue/onset';
import { riseRate } from '../src/engine/cue/predictTempo';
import { normalise, processRaw } from '../src/engine/calibration';
import { restingAmplitude } from '../src/engine/signal/preprocess';
import { DelayStats, quantile } from '../src/engine/timing/delay';
import { us, type Microseconds } from '../src/engine/timing/units';
import type { CalibrationProfile, ProcessedSample, TraceSample } from '../src/engine/types';
import { runHeadless } from '../src/sense/driver';
import { Pipeline } from '../src/sense/pipeline';
import { parseRecording, type ParsedRecording } from '../src/sense/replay';
import type { SenseEvent } from '../src/sense/types';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const load = (p?: string) => (p ? parseRecording(readFileSync(p, 'utf8')) : undefined);
const prep = load(opt('prep'));
const rest = load(opt('rest'));
const talk = load(opt('talk'));
if (!prep && !rest && !talk) {
  console.error('usage: npm run analyze -- --prep <file> --rest <file> [--talk <file>] [--profile <json>]');
  process.exit(1);
}
const out: string[] = [];
const p = (s = '') => out.push(s);
const f = (n: number, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : '—');

function chestOf(r: ParsedRecording): TraceSample[] {
  const s: TraceSample[] = [];
  let last = -Infinity;
  for (const e of r.events) if (e.kind === 'metrics') for (const c of e.frame.chest) if (c.t > last) { s.push(c); last = c.t; }
  return s;
}

// ── 1. Shapes, rates and delivery delay ───────────────────────────────────
p('## Stage 1 — signal shapes and delivery delay');
p();
p('| recording | synthetic | duration | packets | packet interval | chest samples/s | samples/packet | landmarks/set | first stable | delay newest median / p95 | delay all samples median / p95 |');
p('|---|---|---|---|---|---|---|---|---|---|---|');
for (const [name, r] of [['prep', prep], ['rest', rest], ['talk', talk]] as const) {
  if (!r) continue;
  const metrics = r.events.filter((e): e is Extract<SenseEvent, { kind: 'metrics' }> => e.kind === 'metrics');
  const newest = new DelayStats(1e6), all = new DelayStats(1e6);
  let last = -Infinity, total = 0, lm = 0, firstStable: number | null = null;
  for (const e of metrics) {
    const fresh = e.frame.chest.filter((c) => c.t > last);
    for (const c of fresh) { all.add(e.recvUs, c.t); if (c.stable && firstStable === null) firstStable = c.t; }
    if (fresh.length) { newest.add(e.recvUs, fresh[fresh.length - 1]!.t); last = fresh[fresh.length - 1]!.t; }
    total += fresh.length;
    lm = Math.max(lm, e.frame.landmarkCount);
  }
  const dur = r.durationUs / 1e6;
  const n = newest.summary(), a = all.summary();
  const t0 = metrics[0]?.recvUs ?? 0;
  p(`| ${name} | ${r.header.synthetic ? 'YES' : 'no'} | ${f(dur, 1)} s | ${metrics.length} | ${f((dur * 1000) / Math.max(1, metrics.length - 1))} ms | ${f(total / dur, 1)} | ${f(total / Math.max(1, metrics.length), 1)} | ${lm} | ${firstStable === null ? 'never' : `${f((firstStable - t0) / 1e6, 1)} s`} | ${f(n.medianMs)} / ${f(n.p95Ms)} ms | ${f(a.medianMs)} / ${f(a.p95Ms)} ms |`);
}
p();

// ── 2. Normalisation ─────────────────────────────────────────────────────
let profile: CalibrationProfile | undefined =
  opt('profile') ? JSON.parse(readFileSync(opt('profile')!, 'utf8')) : (prep?.header.profile ?? rest?.header.profile);
let assumed = false;
if (!profile) {
  if (!rest) { console.error('Need --profile, a header profile, or a rest recording.'); process.exit(1); }
  const raw = processRaw(chestOf(rest)).filter((s) => s.stable);
  const amp = restingAmplitude(raw.slice(0, Math.round(raw.length / 2)).map((s) => s.v));
  profile = { version: 1, createdAt: new Date().toISOString(), restAmplitude: amp, polarity: 1, k: CUE.DEFAULT_K, fitError: 1, breathsUsed: 0, predictionTrusted: false };
  assumed = true;
}
p(`Profile: resting amplitude ${profile.restAmplitude.toPrecision(4)}, polarity ${profile.polarity}, k ${profile.k.toFixed(3)}${assumed ? ' — ASSUMED (no calibration profile; polarity +1 and default k)' : ''}.`);
p();

// ── 3. Separability: every onset, prep vs other ──────────────────────────
interface OnsetStat { t0: Microseconds; r: number; depth: number; afterKey: boolean; latencyMs?: number }
function onsets(r: ParsedRecording): OnsetStat[] {
  const keys = r.events.filter((e) => e.kind === 'key' && e.key === 'ready').map((e) => e.recvUs);
  const norm = normalise(processRaw(chestOf(r)), profile!.restAmplitude, profile!.polarity);
  const det = new OnsetDetector();
  const res: OnsetStat[] = [];
  for (let i = 0; i < norm.length; i++) {
    const o = det.push(norm[i]!);
    if (!o) continue;
    const after = norm.slice(i - 10 < 0 ? 0 : i - 10).filter((s: ProcessedSample) => s.t >= o.t0);
    const rr = riseRate(o.vCross, valueAt(after, o.tCross + CUE.PREDICT_AFTER_MS * 1000), CUE.PREDICT_AFTER_MS / 1000);
    const pk = new PeakTracker(o.t0, o.v0);
    let depth = NaN;
    for (const s of norm.slice(i)) { const x = pk.push(s); if (x.kind === 'confirmed') { depth = x.depth; break; } if (x.kind === 'unmeasured') break; }
    const key = keys.filter((k) => k <= o.t0 && o.t0 - k < 4_000_000).pop();
    res.push({ t0: o.t0, r: rr, depth, afterKey: key !== undefined, ...(key !== undefined ? { latencyMs: (o.detectedAt - o.t0) / 1000 } : {}) });
  }
  return res;
}
const q = (xs: number[], v: number) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return quantile(s, v); };
// One onset per Ready press: the strongest-rising one within 4 s after it
// (the intended preparatory breath, not resting breaths around it).
function perKey(r: ParsedRecording): OnsetStat[] {
  const keys = r.events.filter((e) => e.kind === 'key' && e.key === 'ready').map((e) => e.recvUs);
  const all = onsets(r);
  return keys.flatMap((k) => {
    const c = all.filter((o) => o.t0 >= k && o.t0 - k < 4_000_000 && Number.isFinite(o.r));
    return c.length ? [c.reduce((a, b) => (b.r > a.r ? b : a))] : [];
  });
}
const prepOn = prep ? perKey(prep) : [];
const restOn = rest ? onsets(rest) : [];
p('## Separability (every detected onset)');
p();
p('| set | onsets | early rise p5 / p50 / p95 (rest/s) | depth p5 / p50 / p95 (× rest) |');
p('|---|---|---|---|');
for (const [n, xs] of [['prep (strongest per R)', prepOn], ['rest (all)', restOn]] as const) {
  if (!xs.length) continue;
  const r = xs.map((x) => x.r), d = xs.map((x) => x.depth);
  p(`| ${n} | ${xs.length} | ${f(q(r, 0.05), 2)} / ${f(q(r, 0.5), 2)} / ${f(q(r, 0.95), 2)} | ${f(q(d, 0.05), 2)} / ${f(q(d, 0.5), 2)} / ${f(q(d, 0.95), 2)} |`);
}
if (prepOn.length && restOn.length) {
  const restR = q(restOn.map((x) => x.r), 0.99), prepR = q(prepOn.map((x) => x.r), 0.05);
  p();
  p(`Early-rise gate: rest p99 = ${f(restR, 2)}, prep p5 = ${f(prepR, 2)} → ${restR < prepR ? `separable; a threshold of ${f((restR + prepR) / 2, 2)} sits midway (current MIN_CUE_RISE_REST_PER_S = ${CUE.MIN_CUE_RISE_REST_PER_S})` : 'NOT separable by early rise alone — keep the Ready gate mandatory and raise CLEAN_DEPTH_X (plan decision rule)'}.`);
  const restD = q(restOn.map((x) => x.depth), 0.99), prepD = q(prepOn.map((x) => x.depth), 0.05);
  p(`Depth: rest p99 = ${f(restD, 2)}×, prep p5 = ${f(prepD, 2)}× (CLEAN_DEPTH_X = ${CUE.CLEAN_DEPTH_X}).`);
  const lat = prepOn.map((x) => x.latencyMs!).filter(Number.isFinite);
  p(`Onset detection latency (t0 → sustain met, SDK time): median ${f(q(lat, 0.5))} ms, p95 ${f(q(lat, 0.95))} ms.`);
}
p();

// ── 4. The engine on the recordings ──────────────────────────────────────
function run(r: ParsedRecording, extraReady: boolean) {
  let events = [...r.events];
  if (extraReady) {
    // Hold Ready on: a press every 5.5 s for the whole recording.
    const t0 = events[0]!.recvUs, t1 = events[events.length - 1]!.recvUs;
    for (let t = t0 + 1_000_000; t < t1; t += 5_500_000) events.push({ kind: 'key', recvUs: us(t), key: 'ready' });
    events = events.sort((a, b) => a.recvUs - b.recvUs);
  }
  const mode = profile!.predictionTrusted ? { kind: 'predict' as const, k: profile!.k, targetBpm: 72 } : { kind: 'fixed' as const, targetBpm: 72 };
  const pl = new Pipeline({ profile: profile!, mode, voices: 8, gesture: profile!.headBaselineRatio !== undefined, seed: 1, fuseAbdomen: false });
  const commits: { cause: string; quality: string; bpm: number }[] = [];
  const results: { planned: number; measured?: number }[] = [];
  runHeadless(pl, events, {
    onEngine: (evs) => {
      for (const e of evs) {
        if (e.type === 'commit') commits.push({ cause: e.entry.cause, quality: e.entry.quality, bpm: 60 / e.entry.beat });
        if (e.type === 'result') results.push({ planned: e.result.plannedBpm, ...(e.result.measuredBpm !== undefined ? { measured: e.result.measuredBpm } : {}) });
      }
    },
    metronomeBpm: () => 72,
  });
  return { commits, results, keys: r.events.filter((e) => e.kind === 'key' && e.key === 'ready').length };
}
p('## Engine on the recordings');
p();
if (prep) {
  const x = run(prep, false);
  const breath = x.commits.filter((c) => c.cause === 'breath');
  p(`- Prep breaths: ${x.keys} Ready presses → ${breath.length} breath-cued entries (${f((100 * breath.length) / Math.max(1, x.keys))} %; target ≥ 90 %), ${breath.filter((c) => c.quality === 'tight').length} tight, ${breath.filter((c) => c.quality === 'ragged').length} ragged.`);
  const paired = x.results.filter((r) => r.measured !== undefined);
  if (paired.length) {
    const err = paired.map((r) => Math.abs(r.planned - r.measured!) / r.measured!);
    p(`- Predicted vs peak tempo: median error ${f(100 * q(err, 0.5), 1)} %, p90 ${f(100 * q(err, 0.9), 1)} % over ${paired.length} cues (prediction trusted below ${CUE.MAX_TRUSTED_FIT_ERROR * 100} %).`);
  }
}
if (rest) {
  const x = run(rest, true);
  p(`- Resting breath with Ready held on (${f(rest.durationUs / 6e7, 1)} min): ${x.commits.length} false entries (target ≤ 1 per 2 min).`);
}
if (talk) {
  const x = run(talk, true);
  p(`- Talking with Ready held on: ${x.commits.length} entries (target 0).`);
}
p();
p(`_Generated by scripts/analyze-fixtures.ts with config/cue.ts as of this run.${[prep, rest, talk].some((r) => r?.header.synthetic) ? ' WARNING: at least one input is SYNTHETIC — not evidence about the real SDK.' : ''}_`);
console.log(out.join('\n'));
