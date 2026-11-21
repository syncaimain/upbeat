// Session-level behaviour on SYNTHETIC traces (fixtures/synth.ts). These
// mirror the plan's "tests that must pass"; the real-camera versions are in
// docs/RESULTS.md and need a live SmartSpectra session.

import { describe, expect, test } from 'vitest';
import { CUE } from '../../config/cue';
import { makeDrill, scoreDrill } from '../../src/engine/drills';
import { Recorder } from '../../src/sense/record';
import { parseRecording } from '../../src/sense/replay';
import { synthesize, synthHeader, type Script } from '../../fixtures/synth';
import { runEvents, runScript, syntheticCalibration } from './helpers';

const cal = syntheticCalibration();
const profile = cal.profile!;
const predict = { kind: 'predict' as const, k: profile.k, targetBpm: 72 };

describe('calibration (synthetic)', () => {
  test('fits k with a usable error and finds the polarity', () => {
    expect(cal.ok).toBe(true);
    expect(profile.breathsUsed).toBeGreaterThanOrEqual(CUE.MIN_CALIBRATION_BREATHS);
    expect(profile.fitError).toBeLessThan(CUE.MAX_TRUSTED_FIT_ERROR);
    expect(profile.predictionTrusted).toBe(true);
    expect(profile.polarity).toBe(1);
    expect(profile.headBaselineRatio).toBeCloseTo(0.62, 2);
  });
  test('an inverted trace is detected as polarity −1 with the same k', () => {
    const inv = syntheticCalibration(3, -1);
    expect(inv.polarity).toBe(-1);
    expect(inv.profile!.k).toBeCloseTo(profile.k, 6);
  });
  test('k is stable within 15 % across two runs with different noise', () => {
    const other = syntheticCalibration(17).profile!;
    expect(Math.abs(other.k - profile.k) / profile.k).toBeLessThan(0.15);
  });
});

describe('breath-cued entries (synthetic)', () => {
  test('≥ 90 % of 30 prep breaths cue an entry, close to the true onset', () => {
    const script: Script[] = [];
    for (let i = 0; i < 30; i++) {
      const at = 36 + i * 7;
      const bpm = [60, 72, 90, 110][i % 4]!;
      script.push({ kind: 'key', at: at - 1, key: 'ready' });
      script.push({ kind: 'prep', at, beatS: 60 / bpm, depth: 1.9 + (i % 5) * 0.12 });
    }
    const r = runScript(script, 36 + 30 * 7 + 5, profile, predict, 21);
    const breathEntries = r.commits.filter((c) => c.cause === 'breath');
    expect(breathEntries.length).toBeGreaterThanOrEqual(27);
    // Onset latency: t0 within 120 ms of the scripted inhale start.
    for (const c of breathEntries) {
      const nearest = Math.min(...r.truth.map((t) => Math.abs(c.t0! - t.at)));
      expect(nearest).toBeLessThan(120_000);
    }
    expect(breathEntries.filter((c) => c.quality === 'tight').length).toBeGreaterThanOrEqual(25);
  });

  test('a slow and a fast breath give clearly different tempi', () => {
    const r = runScript([
      { kind: 'key', at: 35, key: 'ready' }, { kind: 'prep', at: 36, beatS: 1.0, depth: 2.2 },
      { kind: 'key', at: 45, key: 'ready' }, { kind: 'prep', at: 46, beatS: 0.5, depth: 2.2 },
    ], 55, profile, predict);
    const [slow, fast] = r.results;
    expect(slow!.quality).toBe('tight');
    expect(fast!.quality).toBe('tight');
    expect(slow!.plannedBpm).toBeGreaterThan(50);
    expect(slow!.plannedBpm).toBeLessThan(72);
    expect(fast!.plannedBpm).toBeGreaterThan(95);
    expect(fast!.plannedBpm - slow!.plannedBpm).toBeGreaterThan(30);
    // Measured (peak) tempi are reported for both.
    expect(slow!.measuredBpm).toBeDefined();
    expect(fast!.measuredBpm).toBeDefined();
  });

  test('a nod without a breath gives a ragged entry', () => {
    const r = runScript([{ kind: 'lift', at: 40, deg: 10, holdS: 1.2 }], 50, profile, predict);
    expect(r.commits).toHaveLength(1);
    expect(r.commits[0]!.cause).toBe('nod');
    expect(r.commits[0]!.quality).toBe('ragged');
  });

  test('a shallow breath gives a ragged entry (or none)', () => {
    const r = runScript([{ kind: 'key', at: 39, key: 'ready' }, { kind: 'prep', at: 40, beatS: 0.6, depth: 1.0 }],
      48, profile, predict);
    for (const c of r.commits) expect(c.quality).toBe('ragged');
  });

  test('≤ 1 false entry in 2 min of resting breath with Ready held on', () => {
    const script: Script[] = [];
    for (let t = 32; t < 152; t += 5.5) script.push({ kind: 'key', at: t, key: 'ready' });
    const r = runScript(script, 152, profile, predict, 5);
    expect(r.commits.length).toBeLessThanOrEqual(1);
  });

  test('no entries before breathing is stable', () => {
    const r = runScript([{ kind: 'key', at: 9, key: 'ready' }, { kind: 'prep', at: 10, beatS: 0.8, depth: 2.4 }],
      20, profile, predict);
    expect(r.commits).toHaveLength(0);
  });

  test('talking while Ready → no entry', () => {
    const r = runScript([
      { kind: 'key', at: 39.5, key: 'ready' }, { kind: 'talk', at: 39.8, durS: 3 },
      { kind: 'prep', at: 40.5, beatS: 0.8, depth: 2.2 },
    ], 50, profile, predict);
    expect(r.commits).toHaveLength(0);
  });

  test('covering the lens pauses the scene and cancels nothing into sound', () => {
    const r = runScript([
      { kind: 'key', at: 39, key: 'ready' }, { kind: 'cover', at: 39.5, durS: 4 },
      { kind: 'prep', at: 40, beatS: 0.8, depth: 2.2 },
    ], 50, profile, predict);
    expect(r.commits).toHaveLength(0);
    expect(r.events.some((e) => e.type === 'disarmed' && e.reason === 'paused')).toBe(true);
  });

  test('excessive motion blocks cues', () => {
    const r = runScript([
      { kind: 'sway', at: 39, durS: 4 }, { kind: 'key', at: 40, key: 'ready' },
      { kind: 'prep', at: 40.5, beatS: 0.8, depth: 2.2 },
    ], 50, profile, predict);
    expect(r.commits).toHaveLength(0);
  });

  test('fixed-tempo mode places the entry on the target beat after the onset', () => {
    const r = runScript([{ kind: 'key', at: 39, key: 'ready' }, { kind: 'prep', at: 40, beatS: 0.6, depth: 2.2 }],
      48, profile, { kind: 'fixed', targetBpm: 80 });
    const c = r.commits[0]!;
    expect(c.beatSource).toBe('target');
    expect((c.entryAt - c.t0!) / 1e6).toBeCloseTo(0.75, 6);
  });

  test('too-fast plans play immediately and say so', () => {
    const r = runScript([{ kind: 'key', at: 39, key: 'ready' }, { kind: 'prep', at: 40, beatS: 0.25, depth: 2.4 }],
      48, profile, predict);
    const c = r.commits[0];
    if (c) {
      expect(c.tooFast || c.beat === CUE.BEAT_MIN_S).toBe(true);
      if (c.tooFast) expect(c.reason).toContain('too fast');
    }
  });
});

describe('metronome mode', () => {
  test('Space → 4 count clicks then a tight entry on the next downbeat, no camera needed', () => {
    const r = runEvents([{ kind: 'key', recvUs: 1_000_000 as never, key: 'metronome' }], null,
      { kind: 'fixed', targetBpm: 60 }, { bpm: 60 });
    const counts = r.events.filter((e) => e.type === 'count');
    expect(counts).toHaveLength(4);
    const c = r.commits[0]!;
    expect(c.cause).toBe('metronome');
    expect(c.quality).toBe('tight');
    expect(c.entryAt - (counts[0] as { at: number }).at).toBe(4_000_000);
  });
});

describe('replay determinism', () => {
  const script: Script[] = [];
  for (let i = 0; i < 10; i++) {
    script.push({ kind: 'key', at: 35 + i * 8, key: 'ready' });
    script.push({ kind: 'prep', at: 36 + i * 8, beatS: 60 / 72 * (1 + ((i % 3) - 1) * 0.08), depth: 2.1 });
  }
  const syn = synthesize({ durationS: 120, seed: 8, script });

  test('the same recording gives identical drill scores every run', () => {
    const a = runEvents(syn.events, profile, { kind: 'predict', k: profile.k, targetBpm: 72 });
    const b = runEvents(syn.events, profile, { kind: 'predict', k: profile.k, targetBpm: 72 });
    const sa = scoreDrill('consistency', a.results);
    const sb = scoreDrill('consistency', b.results);
    expect(sa).toEqual(sb);
    expect(sa.cues).toBeGreaterThanOrEqual(9);
    expect(sa.tightFraction).toBeGreaterThan(0.7);
  });

  test('record → file → parse → replay reproduces the entries', () => {
    const rec = new Recorder(synthHeader('test', { profile }));
    rec.start();
    for (const e of syn.events) rec.push(e);
    const parsed = parseRecording(rec.stop());
    expect(parsed.header.synthetic).toBe(true);
    const a = runEvents(syn.events, profile, predict);
    const b = runEvents(parsed.events, profile, predict);
    expect(b.results.map((r) => [r.quality, Math.round(r.plannedBpm)]))
      .toEqual(a.results.map((r) => [r.quality, Math.round(r.plannedBpm)]));
  });

  test('drill definitions', () => {
    expect(makeDrill('consistency', { tempo: 80 }).targets).toEqual(Array(10).fill(80));
    expect(makeDrill('ladder').targets[0]).toBe(60);
    expect(makeDrill('ladder').targets.at(-1)).toBe(120);
    expect(makeDrill('match', { seed: 3 }).targets).toEqual(makeDrill('match', { seed: 3 }).targets);
  });
});
