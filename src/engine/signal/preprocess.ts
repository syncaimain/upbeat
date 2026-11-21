// Chest/abdomen trace preprocessing: de-duplicate, detrend (one-pole
// high-pass), 5-sample median smoothing, normalisation to resting amplitude,
// inhale-positive polarity, and a least-squares slope.

import { CUE } from '../../../config/cue';
import { quantile } from '../timing/delay';
import type { Microseconds } from '../timing/units';
import type { ProcessedSample, TraceSample } from '../types';

interface Buffered {
  t: Microseconds;
  y: number;
  x: number;
  stable: boolean;
}

export interface ProcessorOptions {
  /** Raw-trace units per resting amplitude (1 = leave unnormalised). */
  restAmplitude: number;
  /** +1 if the trace rises on inhale. */
  polarity: 1 | -1;
  highpassTauS?: number;
  medianSamples?: number;
  slopeWindowMs?: number;
}

/** A gap longer than this resets the filters (camera loss, pause). */
const RESET_GAP_US = 1_000_000;

export class TraceProcessor {
  private lastT: number = -Infinity;
  private xPrev = 0;
  private yPrev = 0;
  private primed = false;
  private readonly med: Buffered[] = [];
  private readonly recent: ProcessedSample[] = [];
  private restAmplitude: number;
  private polarity: 1 | -1;
  private readonly tau: number;
  private readonly medianN: number;
  private readonly slopeWindowUs: number;

  constructor(opts: ProcessorOptions) {
    this.restAmplitude = Math.max(opts.restAmplitude, CUE.REST_AMPLITUDE_FLOOR);
    this.polarity = opts.polarity;
    this.tau = opts.highpassTauS ?? CUE.HIGHPASS_TAU_S;
    this.medianN = opts.medianSamples ?? CUE.MEDIAN_SAMPLES;
    this.slopeWindowUs = (opts.slopeWindowMs ?? CUE.SLOPE_WINDOW_MS) * 1000;
  }

  setNormalisation(restAmplitude: number, polarity: 1 | -1): void {
    this.restAmplitude = Math.max(restAmplitude, CUE.REST_AMPLITUDE_FLOOR);
    this.polarity = polarity;
    this.recent.length = 0;
  }

  reset(): void {
    this.lastT = -Infinity;
    this.primed = false;
    this.med.length = 0;
    this.recent.length = 0;
  }

  /** Feed one raw sample. Returns a processed sample once the median window
   *  is full (stamped with the centre sample's timestamp), else null.
   *  Samples not newer than the last accepted one are ignored, so
   *  overlapping packets are safe. */
  push(s: TraceSample): ProcessedSample | null {
    if (!Number.isFinite(s.value) || s.t <= this.lastT) return null;
    if (s.t - this.lastT > RESET_GAP_US) {
      this.primed = false;
      this.med.length = 0;
      this.recent.length = 0;
    }
    const dt = this.primed ? (s.t - this.lastT) / 1e6 : 0;
    this.lastT = s.t;

    let y: number;
    if (!this.primed) {
      y = 0;
      this.primed = true;
    } else {
      const a = this.tau / (this.tau + dt);
      y = a * (this.yPrev + s.value - this.xPrev);
    }
    this.xPrev = s.value;
    this.yPrev = y;

    this.med.push({ t: s.t, y, x: s.value, stable: s.stable });
    if (this.med.length > this.medianN) this.med.shift();
    if (this.med.length < this.medianN) return null;

    const mid = Math.floor(this.medianN / 2);
    const m = this.med.map((b) => b.y).sort((a, b) => a - b)[mid]!;
    const mx = this.med.map((b) => b.x).sort((a, b) => a - b)[mid]!;
    const centre = this.med[mid]!;
    const stable = this.med.every((b) => b.stable);
    const v = (this.polarity * m) / this.restAmplitude;
    const r = (this.polarity * mx) / this.restAmplitude;

    const slope = this.slopeAt(centre.t, r);
    const out: ProcessedSample = { t: centre.t, v, r, slope, stable };
    this.recent.push(out);
    return out;
  }

  private slopeAt(t: Microseconds, r: number): number {
    // Keep samples inside the slope window, ending at t.
    const from = t - this.slopeWindowUs;
    while (this.recent.length > 0 && this.recent[0]!.t < from) this.recent.shift();
    const pts = [...this.recent.map((p) => [p.t, p.r] as const), [t, r] as const];
    if (pts.length < 3) return NaN;
    return lsSlope(pts);
  }
}

/** Least-squares slope (units per second) of [tµs, value] points. */
export function lsSlope(pts: ReadonlyArray<readonly [number, number]>): number {
  const n = pts.length;
  const t0 = pts[0]![0];
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [t, v] of pts) {
    const x = (t - t0) / 1e6;
    sx += x; sy += v; sxx += x * x; sxy += x * v;
  }
  const den = n * sxx - sx * sx;
  return den === 0 ? NaN : (n * sxy - sx * sy) / den;
}

/** Robust resting amplitude: P90 − P10 of detrended values. */
export function restingAmplitude(values: readonly number[]): number {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (s.length < 10) return NaN;
  return quantile(s, CUE.REST_PERCENTILE_HIGH) - quantile(s, CUE.REST_PERCENTILE_LOW);
}

/**
 * Chest/abdomen fusion: average the two normalised (z-score-like) signals
 * when the abdomen sample exists, is stable, matches in time, and the chest
 * is visible. Otherwise the chest sample is used alone.
 */
export class Fuser {
  private readonly abdomen: ProcessedSample[] = [];

  pushAbdomen(s: ProcessedSample): void {
    this.abdomen.push(s);
    if (this.abdomen.length > 64) this.abdomen.shift();
  }

  fuse(chest: ProcessedSample, abdomenUsable: boolean): ProcessedSample {
    if (!abdomenUsable) return chest;
    let best: ProcessedSample | undefined;
    let bestDt = Infinity;
    for (const a of this.abdomen) {
      const d = Math.abs(a.t - chest.t);
      if (d < bestDt) { bestDt = d; best = a; }
    }
    if (!best || bestDt > CUE.FUSION_MATCH_US || !best.stable || !Number.isFinite(best.slope)) {
      return chest;
    }
    return {
      t: chest.t,
      v: (chest.v + best.v) / 2,
      r: (chest.r + best.r) / 2,
      slope: Number.isFinite(chest.slope) ? (chest.slope + best.slope) / 2 : chest.slope,
      stable: chest.stable && best.stable,
    };
  }

  clear(): void {
    this.abdomen.length = 0;
  }
}
