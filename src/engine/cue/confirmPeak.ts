// Peak confirmation: the inhale's peak is confirmed once the slope has
// stayed at or below zero for 150 ms. The breath's actual beat is
// peak − t0. If the data turns unstable or no peak arrives in time, the
// tempo is reported as "not measured" — never guessed.

import { CUE } from '../../../config/cue';
import { sec, type Microseconds, type Seconds } from '../timing/units';
import type { ProcessedSample } from '../types';

export type PeakOutcome =
  | { kind: 'pending' }
  | { kind: 'confirmed'; peakAt: Microseconds; actualBeat: Seconds; depth: number }
  | { kind: 'unmeasured'; reason: string };

export class PeakTracker {
  private maxV = -Infinity;
  private maxT: Microseconds;
  private fallingSince: Microseconds | null = null;
  private done = false;
  /** Neighbours of the maximum, for sub-sample peak interpolation. */
  private prev: ProcessedSample | null = null;
  private beforeMax: ProcessedSample | null = null;
  private afterMax: ProcessedSample | null = null;

  constructor(
    private readonly t0: Microseconds,
    private readonly v0: number,
    private readonly holdMs: number = CUE.PEAK_HOLD_MS,
    private readonly timeoutMs: number = CUE.PEAK_TIMEOUT_MS,
  ) {
    this.maxT = t0;
  }

  /** Depth reached so far (rest units). */
  get depthSoFar(): number {
    return Number.isFinite(this.maxV) ? this.maxV - this.v0 : 0;
  }

  push(s: ProcessedSample): PeakOutcome {
    if (this.done || s.t < this.t0) return { kind: 'pending' };
    if (!s.stable) {
      this.done = true;
      return { kind: 'unmeasured', reason: 'breathing data became unstable' };
    }
    if (s.r > this.maxV) {
      this.maxV = s.r;
      this.maxT = s.t;
      this.beforeMax = this.prev;
      this.afterMax = null;
    } else if (this.afterMax === null && this.prev?.t === this.maxT) {
      this.afterMax = s;
    }
    this.prev = s;
    if (Number.isFinite(s.slope) && s.slope <= 0) {
      if (this.fallingSince === null) this.fallingSince = s.t;
      if (s.t - this.fallingSince >= this.holdMs * 1000 && this.maxT > this.t0) {
        this.done = true;
        const peakAt = this.interpolatedPeak();
        return {
          kind: 'confirmed',
          peakAt,
          actualBeat: sec((peakAt - this.t0) / 1e6),
          depth: this.maxV - this.v0,
        };
      }
    } else {
      this.fallingSince = null;
    }
    if (s.t - this.t0 > this.timeoutMs * 1000) {
      this.done = true;
      return { kind: 'unmeasured', reason: 'no clear peak' };
    }
    return { kind: 'pending' };
  }

  /** Parabola through the maximum and its two neighbours: the peak time to
   *  a fraction of a sample (the trace arrives at ~30 Hz, 33 ms apart —
   *  about 7 % of a 120 bpm beat). Falls back to the sample time. */
  private interpolatedPeak(): Microseconds {
    const a = this.beforeMax, c = this.afterMax;
    if (!a || !c) return this.maxT;
    const h1 = this.maxT - a.t, h2 = c.t - this.maxT;
    if (h1 <= 0 || h2 <= 0) return this.maxT;
    // Parabola through (−h1, a), (0, b), (h2, c) with p = a − b, q = c − b:
    //   A = (p·h2 + q·h1) / (h1·h2·(h1 + h2)),  B = (q·h1² − p·h2²) / (h1·h2·(h1 + h2))
    //   vertex x = −B / 2A = −(q·h1² − p·h2²) / (2·(p·h2 + q·h1))
    const p = a.r - this.maxV;
    const q = c.r - this.maxV;
    const den = 2 * (p * h2 + q * h1);
    if (!(den < 0)) return this.maxT; // not a maximum (flat or concave up)
    const x = -(q * h1 * h1 - p * h2 * h2) / den;
    const off = Math.max(-h1 / 2, Math.min(h2 / 2, x));
    return (this.maxT + off) as Microseconds;
  }

  /** Called when time passes without samples (camera loss). */
  expire(now: Microseconds): PeakOutcome {
    if (this.done) return { kind: 'pending' };
    if (now - this.t0 > (this.timeoutMs + 1000) * 1000) {
      this.done = true;
      return { kind: 'unmeasured', reason: 'breathing data stopped' };
    }
    return { kind: 'pending' };
  }
}
