// Release cue (P1): while the chord has sounded ≥ 1.5 s, an exhale onset
// (slope < −0.5 rest/s sustained) together with a head-pitch drop ≥ 4°
// (within 600 ms of each other) releases the ensemble together.

import { CUE } from '../../../config/cue';
import type { Microseconds } from '../timing/units';
import type { PitchSample, ProcessedSample } from '../types';
import { OnsetDetector } from './onset';

export class ReleaseDetector {
  private readonly exhale = new OnsetDetector({
    slopeThreshold: CUE.RELEASE_SLOPE_REST_PER_S,
    direction: -1,
    backtrackMaxMs: 0,
  });
  private exhaleAt: Microseconds | null = null;
  private dropAt: Microseconds | null = null;
  private pitchAtEntry: number | null = null;

  constructor(private readonly soundAt: Microseconds) {}

  private sounding(t: Microseconds): boolean {
    return t - this.soundAt >= CUE.RELEASE_MIN_SOUNDING_MS * 1000;
  }

  pushTrace(s: ProcessedSample): Microseconds | null {
    const o = this.exhale.push(s);
    if (o && s.t >= this.soundAt) this.exhaleAt = o.detectedAt;
    return this.check(s.t);
  }

  pushPitch(p: PitchSample): Microseconds | null {
    if (p.t < this.soundAt) {
      this.pitchAtEntry = p.deg;
      return null;
    }
    if (this.pitchAtEntry === null) this.pitchAtEntry = p.deg;
    this.pitchAtEntry = Math.max(this.pitchAtEntry, p.deg);
    if (this.pitchAtEntry - p.deg >= CUE.RELEASE_PITCH_DROP_DEG) this.dropAt = p.t;
    return this.check(p.t);
  }

  private check(t: Microseconds): Microseconds | null {
    if (!this.sounding(t) || this.exhaleAt === null || this.dropAt === null) return null;
    if (Math.abs(this.exhaleAt - this.dropAt) > CUE.RELEASE_PAIR_WINDOW_MS * 1000) return null;
    if (!this.sounding(this.exhaleAt) && !this.sounding(this.dropAt)) return null;
    return t;
  }
}
