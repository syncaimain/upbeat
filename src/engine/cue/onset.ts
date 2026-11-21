// Inhale onset: the first sample where the smoothed slope stays above
// 0.5 resting amplitudes per second for 120 ms.
//
// Two times come out of it:
//  • tCross — the first sample of that sustained run. Robust, so the early
//    rise rate (tempo prediction) is measured from here.
//  • t0 — the first rising sample: tCross traced back while the slope stays
//    clearly positive (bounded). That is where the breath actually began, so
//    the entry, the peak-measured beat and calibration are timed from here.
//    Timing from tCross instead made every beat ~100 ms short on tests.

import { CUE } from '../../../config/cue';
import type { Microseconds } from '../timing/units';
import type { ProcessedSample } from '../types';

export interface Onset {
  /** First rising sample (inhale start). */
  readonly t0: Microseconds;
  /** Un-high-passed value at t0. */
  readonly v0: number;
  /** First sample of the sustained above-threshold run. */
  readonly tCross: Microseconds;
  readonly vCross: number;
  /** The sample at which the sustain condition was met. */
  readonly detectedAt: Microseconds;
}

export interface OnsetOptions {
  slopeThreshold?: number;
  sustainMs?: number;
  backtrackMaxMs?: number;
  backtrackSlope?: number;
  /** Sign of the slope that counts (−1 detects exhale onsets for release). */
  direction?: 1 | -1;
}

export class OnsetDetector {
  private readonly history: ProcessedSample[] = [];
  private runStart: ProcessedSample | null = null;
  private readonly thr: number;
  private readonly sustainUs: number;
  private readonly backUs: number;
  private readonly backSlope: number;
  private readonly dir: 1 | -1;

  constructor(o: OnsetOptions = {}) {
    this.thr = o.slopeThreshold ?? CUE.ONSET_SLOPE_REST_PER_S;
    this.sustainUs = (o.sustainMs ?? CUE.ONSET_SUSTAIN_MS) * 1000;
    this.backUs = (o.backtrackMaxMs ?? CUE.ONSET_BACKTRACK_MAX_MS) * 1000;
    this.backSlope = o.backtrackSlope ?? CUE.ONSET_BACKTRACK_SLOPE_REST_PER_S;
    this.dir = o.direction ?? 1;
  }

  reset(): void {
    this.runStart = null;
    this.history.length = 0;
  }

  /** Clears the current run but keeps history (used after a cue). */
  rearm(): void {
    this.runStart = null;
  }

  push(s: ProcessedSample): Onset | null {
    this.history.push(s);
    const horizon = s.t - Math.max(this.backUs, this.sustainUs) - 500_000;
    while (this.history.length > 0 && this.history[0]!.t < horizon) this.history.shift();

    const slope = this.dir * s.slope;
    if (!s.stable || !Number.isFinite(slope) || slope <= this.thr) {
      this.runStart = null;
      return null;
    }
    if (this.runStart === null) this.runStart = s;
    if (s.t - this.runStart.t < this.sustainUs) return null;

    // Sustained. Trace back to the first clearly rising sample.
    const cross = this.runStart;
    const startIdx = this.history.indexOf(cross);
    let first = cross;
    for (let i = startIdx - 1; i >= 0; i--) {
      const h = this.history[i]!;
      if (cross.t - h.t > this.backUs) break;
      if (!h.stable || !(this.dir * h.slope > this.backSlope)) break;
      first = h;
    }
    this.runStart = null;
    return { t0: first.t, v0: first.r, tCross: cross.t, vCross: cross.r, detectedAt: s.t };
  }
}

/** Un-high-passed value (`r`) of the processed trace at time t (linear
 *  interpolation). */
export function valueAt(samples: readonly ProcessedSample[], t: number): number {
  if (samples.length === 0) return NaN;
  if (t <= samples[0]!.t) return samples[0]!.r;
  for (let i = 1; i < samples.length; i++) {
    const b = samples[i]!;
    if (b.t >= t) {
      const a = samples[i - 1]!;
      const f = (t - a.t) / (b.t - a.t || 1);
      return a.r + f * (b.r - a.r);
    }
  }
  return samples[samples.length - 1]!.r;
}
