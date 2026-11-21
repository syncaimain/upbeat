import { describe, expect, test } from 'vitest';
import { Fuser, lsSlope, restingAmplitude, TraceProcessor } from '../../src/engine/signal/preprocess';
import { HeadPitchTracker, noseEyeRatio, pitchFromRatio } from '../../src/engine/signal/headPose';
import { us } from '../../src/engine/timing/units';
import type { ProcessedSample } from '../../src/engine/types';

const T0 = 1_790_000_000_000_000;
const feed = (p: TraceProcessor, f: (t: number) => number, seconds: number, fs = 30) => {
  const out: ProcessedSample[] = [];
  for (let i = 0; i < seconds * fs; i++) {
    const r = p.push({ t: us(T0 + Math.round((i / fs) * 1e6)), value: f(i / fs), stable: true });
    if (r) out.push(r);
  }
  return out;
};

describe('TraceProcessor', () => {
  test('high-pass removes a constant offset over a few time constants', () => {
    const out = feed(new TraceProcessor({ restAmplitude: 1, polarity: 1 }), () => 5, 20);
    expect(Math.abs(out[out.length - 1]!.v)).toBeLessThan(1e-6);
    expect(out[out.length - 1]!.r).toBeCloseTo(5, 9); // r is not high-passed
  });

  test('median removes a single-sample spike', () => {
    const out = feed(new TraceProcessor({ restAmplitude: 1, polarity: 1 }), (t) => (Math.abs(t - 2) < 0.01 ? 100 : 0), 4);
    expect(Math.max(...out.map((s) => Math.abs(s.r)))).toBe(0);
  });

  test('slope of a ramp is its rate, normalised and polarity-corrected', () => {
    const out = feed(new TraceProcessor({ restAmplitude: 2, polarity: -1 }), (t) => -3 * t, 3);
    expect(out[out.length - 1]!.slope).toBeCloseTo(1.5, 4); // (-1)·(-3)/2 (µs rounding)
  });

  test('stamps output with the centre sample and ignores duplicates', () => {
    const p = new TraceProcessor({ restAmplitude: 1, polarity: 1 });
    const ts = [0, 1, 2, 2, 3, 4].map((i) => us(T0 + i * 33_333));
    const outs = ts.map((t) => p.push({ t, value: 1, stable: true }));
    expect(outs.filter(Boolean)).toHaveLength(1);
    expect(outs[5]!.t).toBe(ts[2]);
  });

  test('a long gap resets the filters', () => {
    const p = new TraceProcessor({ restAmplitude: 1, polarity: 1 });
    feed(p, () => 1, 2);
    expect(p.push({ t: us(T0 + 10_000_000), value: 9, stable: true })).toBeNull();
  });
});

describe('helpers', () => {
  test('lsSlope', () => {
    expect(lsSlope([[0, 0], [500_000, 1], [1_000_000, 2]])).toBeCloseTo(2, 9);
  });
  test('resting amplitude ≈ peak-to-trough of a sine', () => {
    const v = Array.from({ length: 1000 }, (_, i) => 0.5 * Math.sin((i / 1000) * 2 * Math.PI * 5));
    const a = restingAmplitude(v);
    expect(a).toBeGreaterThan(0.75);
    expect(a).toBeLessThan(1.0);
  });
  test('fuser averages matched, stable abdomen samples only', () => {
    const f = new Fuser();
    const c: ProcessedSample = { t: us(T0), v: 2, r: 2, slope: 1, stable: true };
    f.pushAbdomen({ t: us(T0 + 5000), v: 4, r: 4, slope: 3, stable: true });
    expect(f.fuse(c, true).v).toBe(3);
    expect(f.fuse(c, false).v).toBe(2);
    f.clear();
    f.pushAbdomen({ t: us(T0 + 90_000), v: 4, r: 4, slope: 3, stable: true });
    expect(f.fuse(c, true).v).toBe(2);
  });
});

describe('head pitch', () => {
  const pts = (deg: number, roll = 0) => {
    const e = 160, base = 0.62;
    const ratio = base - 0.38 * Math.sin((deg * Math.PI) / 180);
    const c = Math.cos(roll), s = Math.sin(roll);
    const rot = (x: number, y: number) => ({ x: 640 + x * c - y * s, y: 260 + x * s + y * c });
    return { t: us(T0), stable: true, reset: false, eyeR: rot(-e / 2, 0), eyeL: rot(e / 2, 0), nose: rot(0, ratio * e) };
  };
  test('ratio → degrees inverts the geometric model', () => {
    const base = noseEyeRatio(pts(0));
    expect(pitchFromRatio(noseEyeRatio(pts(8)), base)).toBeCloseTo(8, 6);
    expect(pitchFromRatio(noseEyeRatio(pts(-5)), base)).toBeCloseTo(-5, 6);
  });
  test('head roll does not read as pitch', () => {
    const base = noseEyeRatio(pts(0));
    expect(pitchFromRatio(noseEyeRatio(pts(0, 0.3)), base)).toBeCloseTo(0, 6);
  });
  test('tracker needs a baseline and median-filters', () => {
    const tr = new HeadPitchTracker(undefined);
    expect(tr.push(pts(3))).toBeNull();
    tr.setBaseline(noseEyeRatio(pts(0)));
    const a = tr.push({ ...pts(10), t: us(T0 + 1) })!;
    expect(a.deg).toBeCloseTo(10, 5);
  });
});
