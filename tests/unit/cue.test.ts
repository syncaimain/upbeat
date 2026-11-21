import { describe, expect, test } from 'vitest';
import { CUE } from '../../config/cue';
import { classifyEntry, projectDepth, spreadOf, voiceOffsets } from '../../src/engine/cue/entryQuality';
import { OnsetDetector } from '../../src/engine/cue/onset';
import { PeakTracker } from '../../src/engine/cue/confirmPeak';
import { clampBeat, fitK, predictBeat } from '../../src/engine/cue/predictTempo';
import { ReadyGate } from '../../src/engine/cue/readyGate';
import { mulberry32 } from '../../src/engine/rng';
import { us } from '../../src/engine/timing/units';
import type { ProcessedSample } from '../../src/engine/types';

const T0 = 1_790_000_000_000_000;
const S = (i: number, r: number, slope: number, stable = true): ProcessedSample =>
  ({ t: us(T0 + i * 33_333), v: r, r, slope, stable });

describe('onset', () => {
  test('needs the slope above threshold for the sustain time', () => {
    const d = new OnsetDetector();
    const n = Math.ceil(CUE.ONSET_SUSTAIN_MS / 33.333);
    for (let i = 0; i < n; i++) expect(d.push(S(i, i * 0.1, 3))).toBeNull();
    const o = d.push(S(n, n * 0.1, 3));
    expect(o).not.toBeNull();
    expect(o!.t0).toBe(T0);
  });
  test('a dip below threshold restarts the run', () => {
    const d = new OnsetDetector();
    d.push(S(0, 0, 3)); d.push(S(1, 0, 3)); d.push(S(2, 0, 0.1));
    for (let i = 3; i < 7; i++) d.push(S(i, 0, 3));
    expect(d.push(S(7, 0, 3))!.t0).toBe(T0 + 3 * 33_333);
  });
  test('unstable samples never start an onset', () => {
    const d = new OnsetDetector();
    for (let i = 0; i < 20; i++) expect(d.push(S(i, 0, 5, false))).toBeNull();
  });
});

describe('tempo prediction', () => {
  test('fitK recovers k exactly from noiseless points', () => {
    const k = 3.2;
    const pts = [1, 0.667, 0.5].flatMap((b) => [{ r: k / b, b }, { r: k / b, b }]);
    const f = fitK(pts)!;
    expect(f.k).toBeCloseTo(k, 9);
    expect(f.fitError).toBeCloseTo(0, 9);
  });
  test('fit error reflects scatter', () => {
    const f = fitK([{ r: 3, b: 1 }, { r: 4, b: 1 }, { r: 6, b: 0.5 }])!;
    expect(f.fitError).toBeGreaterThan(0.05);
  });
  test('predicted beat is clamped to 40–170 bpm', () => {
    expect(predictBeat(100, 3)).toBe(CUE.BEAT_MIN_S);
    expect(predictBeat(0.1, 3)).toBe(CUE.BEAT_MAX_S);
    expect(predictBeat(-1, 3)).toBe(CUE.BEAT_MAX_S);
    expect(clampBeat(0.8)).toBe(0.8);
  });
});

describe('entry quality', () => {
  test('classification thresholds', () => {
    expect(classifyEntry({ depth: 2, monotonic: true, talking: false }).quality).toBe('tight');
    expect(classifyEntry({ depth: 1.4, monotonic: true, talking: false }).quality).toBe('loose');
    expect(classifyEntry({ depth: 2, monotonic: false, talking: false }).quality).toBe('loose');
    expect(classifyEntry({ depth: 1.0, monotonic: true, talking: false }).quality).toBe('ragged');
    expect(classifyEntry({ monotonic: true, talking: false }).quality).toBe('ragged');
    expect(classifyEntry({ depth: 3, monotonic: true, talking: true }).quality).toBe('ragged');
  });
  test('tight offsets ~ N(0, 12 ms)', () => {
    const rng = mulberry32(5);
    const all = Array.from({ length: 500 }, () => voiceOffsets('tight', 8, rng)).flat();
    const mean = all.reduce((a, b) => a + b, 0) / all.length;
    const sd = Math.sqrt(all.reduce((a, b) => a + (b - mean) ** 2, 0) / all.length);
    expect(Math.abs(mean)).toBeLessThan(1.5);
    expect(sd).toBeGreaterThan(10);
    expect(sd).toBeLessThan(13);
  });
  test('ragged offsets spread 60–250 ms with two voices late', () => {
    const rng = mulberry32(9);
    for (let i = 0; i < 200; i++) {
      const o = voiceOffsets('ragged', 8, rng);
      const spread = spreadOf(o);
      expect(spread).toBeGreaterThanOrEqual(CUE.RAGGED_SPREAD_MIN_MS - 1e-9);
      expect(spread).toBeLessThanOrEqual(CUE.RAGGED_SPREAD_MAX_MS + 1e-9);
      const late = o.filter((x) => x >= 0.75 * spread - 1e-9);
      expect(late.length).toBeGreaterThanOrEqual(2);
      expect(o.filter((x) => x <= 0.35 * spread + 1e-9).length).toBeGreaterThanOrEqual(6);
    }
  });
  test('depth projection scales an incomplete inhale', () => {
    expect(projectDepth(1, 0.25, 1, 'linear')).toBeCloseTo(1 / CUE.PROJECTION_MIN_FRACTION, 9);
    expect(projectDepth(1, 0.5, 1, 'linear')).toBe(2);
    expect(projectDepth(1, 0.5, 1, 'sine')).toBeCloseTo(Math.SQRT2, 9);
    expect(projectDepth(2, 2, 1)).toBe(2);
  });
});

describe('peak confirmation', () => {
  test('peak = last maximum before 150 ms of non-positive slope', () => {
    const p = new PeakTracker(us(T0), 0);
    let res: ReturnType<PeakTracker['push']> = { kind: 'pending' };
    for (let i = 0; i <= 30; i++) {
      const r = i <= 24 ? i * 0.1 : 2.4 - (i - 24) * 0.1;
      res = p.push(S(i, r, i <= 24 ? 3 : -3));
      if (res.kind !== 'pending') break;
    }
    expect(res.kind).toBe('confirmed');
    if (res.kind === 'confirmed') {
      expect(res.peakAt).toBe(T0 + 24 * 33_333);
      expect(res.actualBeat).toBeCloseTo(0.8, 3);
      expect(res.depth).toBeCloseTo(2.4, 9);
    }
  });
  test('unstable data → not measured', () => {
    const p = new PeakTracker(us(T0), 0);
    p.push(S(1, 0.1, 3));
    expect(p.push(S(2, 0.2, 3, false)).kind).toBe('unmeasured');
  });
});

describe('ready gate', () => {
  const P = (ms: number, deg: number) => ({ t: us(T0 + ms * 1000), deg });
  test('chin lift held 300 ms arms; shorter does not', () => {
    const g = new ReadyGate(true);
    expect(g.pushPitch(P(0, 8))).toEqual([]);
    expect(g.pushPitch(P(200, 8))).toEqual([]);
    expect(g.pushPitch(P(250, 2))).toEqual([]);
    g.pushPitch(P(300, 8));
    const ev = g.pushPitch(P(610, 8));
    expect(ev[0]).toMatchObject({ type: 'armed', source: 'gesture' });
  });
  test('times out after 6 s, then needs the head lowered to re-arm', () => {
    const g = new ReadyGate(true);
    g.pushPitch(P(0, 8)); g.pushPitch(P(400, 8));
    expect(g.tick(us(T0 + 6_500_000))[0]).toMatchObject({ type: 'disarmed', reason: 'timeout' });
    expect(g.pushPitch(P(6600, 8))).toEqual([]);
    expect(g.pushPitch(P(7000, 8))).toEqual([]);
    g.pushPitch(P(7100, 0));
    g.pushPitch(P(7200, 8));
    expect(g.pushPitch(P(7600, 8))[0]).toMatchObject({ type: 'armed' });
  });
  test('talking disarms and blocks arming for 300 ms', () => {
    const g = new ReadyGate(true);
    g.armByKey(us(T0));
    expect(g.pushTalking(us(T0 + 100_000), true)[0]).toMatchObject({ type: 'disarmed', reason: 'talking' });
    expect(g.armByKey(us(T0 + 200_000))).toEqual([]);
    expect(g.armByKey(us(T0 + 500_000))[0]).toMatchObject({ type: 'armed', source: 'key' });
  });
  test('gesture arm then head drop without inhale = nod', () => {
    const g = new ReadyGate(true);
    g.pushPitch(P(0, 9)); g.pushPitch(P(350, 9));
    const ev = g.pushPitch(P(800, 3));
    expect(ev.map((e) => e.type)).toEqual(['nod', 'disarmed']);
  });
  test('gesture disabled → only the key arms', () => {
    const g = new ReadyGate(false);
    g.pushPitch(P(0, 9));
    expect(g.pushPitch(P(400, 9))).toEqual([]);
  });
});

describe('peak interpolation', () => {
  test('finds a peak between samples', () => {
    // Samples of −(t − 0.81)² every 0.1 s around a true peak at 0.81 s.
    const p = new PeakTracker(us(T0), -1);
    let res: ReturnType<PeakTracker['push']> = { kind: 'pending' };
    for (let i = 1; i <= 20 && res.kind === 'pending'; i++) {
      const t = i * 0.1;
      const r = -((t - 0.81) ** 2);
      res = p.push({ t: us(T0 + t * 1e6), v: r, r, slope: t < 0.81 ? 1 : -1, stable: true });
    }
    expect(res.kind).toBe('confirmed');
    if (res.kind === 'confirmed') expect((res.peakAt - T0) / 1e6).toBeCloseTo(0.81, 6);
  });
});
