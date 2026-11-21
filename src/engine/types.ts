// Core data types shared by the sense layer, the cue engine and the sound
// layer. The engine is pure TypeScript: no Svelte, SDK or Tone.js imports.

import type { Microseconds, Milliseconds, Seconds } from './timing/units';

/** One sample of a SmartSpectra breathing trace (chest = upperTrace,
 *  abdomen = lowerTrace). `t` is the SDK timestamp (epoch µs). */
export interface TraceSample {
  readonly t: Microseconds;
  readonly value: number;
  readonly stable: boolean;
}

/** A processed (detrended + median-smoothed) sample in resting-amplitude
 *  units, plus its local slope in resting amplitudes per second. */
export interface ProcessedSample {
  readonly t: Microseconds;
  /** Detrended (2 s high-pass), smoothed value divided by the resting
   *  amplitude, inhale positive. Used for display and resting amplitude. */
  readonly v: number;
  /** Smoothed but NOT high-passed value in the same units. Cue shape
   *  measurements (rise rate, depth, peak) use this, relative to its value
   *  at t0, because the high-pass would shift the peak earlier. */
  readonly r: number;
  /** Least-squares slope of r (rest/s). NaN until enough samples. */
  readonly slope: number;
  readonly stable: boolean;
}

export interface Point2 {
  readonly x: number;
  readonly y: number;
}

/** The three landmarks the head-pitch estimate needs. */
export interface HeadPoints {
  readonly t: Microseconds;
  readonly nose: Point2;
  readonly eyeR: Point2;
  readonly eyeL: Point2;
  readonly stable: boolean;
  readonly reset: boolean;
}

export interface PitchSample {
  readonly t: Microseconds;
  /** Head pitch relative to the calibrated baseline, degrees, chin-up > 0. */
  readonly deg: number;
}

export interface TalkingSample {
  readonly t: Microseconds;
  readonly detected: boolean;
}

export interface RateSample {
  readonly t: Microseconds;
  readonly value: number;
  readonly confidence: number;
  readonly stable: boolean;
}

export type EntryQuality = 'tight' | 'loose' | 'ragged';

export type EntryCause =
  /** A detected inhale cued the entry. */
  | 'breath'
  /** Head lift and nod, but no inhale: the ensemble guessed. */
  | 'nod'
  /** Metronome count-in (no breath involved). */
  | 'metronome';

/** The plan produced by the cue engine and consumed by the scheduler. */
export interface EntryPlan {
  readonly id: number;
  readonly cause: EntryCause;
  /** Inhale onset (SDK µs); undefined for metronome/nod entries. */
  readonly t0?: Microseconds;
  /** Planned downbeat in the SDK clock domain. */
  readonly entryAt: Microseconds;
  /** Beat length used to place the downbeat. */
  readonly beat: Seconds;
  /** Where the beat came from. */
  readonly beatSource: 'predicted' | 'target';
  /** Early rise rate used for the prediction (rest/s). */
  readonly riseRate?: number;
  /** True when the plan was ready less than MIN_LEAD_MS before the downbeat
   *  and the entry is played immediately instead. */
  readonly tooFast: boolean;
}

/** The committed entry: plan + quality + per-voice timing offsets. */
export interface CommittedEntry extends EntryPlan {
  readonly quality: EntryQuality;
  /** Projected inhale depth in resting amplitudes at commit time. */
  readonly projectedDepth?: number;
  readonly monotonic?: boolean;
  /** Per-voice offsets from the downbeat, ms (positive = late). */
  readonly offsetsMs: readonly Milliseconds[];
  /** The time the entry actually sounds (entryAt, or "now" when tooFast). */
  readonly soundAt: Microseconds;
  readonly reason: string;
}

/** Peak confirmation for an entry: the breath's measured beat. */
export interface PeakResult {
  readonly id: number;
  readonly measured: boolean;
  readonly peakAt?: Microseconds;
  /** peakAt − t0, the breath's actual beat. */
  readonly actualBeat?: Seconds;
  readonly depth?: number;
}

/** Per-user calibration profile. Numbers only. */
export interface CalibrationProfile {
  readonly version: 1;
  readonly createdAt: string;
  /** Resting amplitude of the detrended chest trace (raw trace units). */
  readonly restAmplitude: number;
  /** Resting amplitude of the abdomen trace, if it was usable. */
  readonly restAmplitudeAbdomen?: number;
  /** +1 when the chest trace rises on inhale, −1 when it falls. */
  readonly polarity: 1 | -1;
  /** Fitted constant of b = k / r. */
  readonly k: number;
  /** RMS relative beat error of the fit (0.08 = 8 %). */
  readonly fitError: number;
  readonly breathsUsed: number;
  /** Baseline nose/eye-line ratio (head pitch zero), if landmarks worked. */
  readonly headBaselineRatio?: number;
  /** Prediction trusted? false → fixed-tempo exercises (breath times only). */
  readonly predictionTrusted: boolean;
  /** k from the previous calibration, to report stability across runs. */
  readonly previousK?: number;
}

/** One calibration prep breath. */
export interface CalibrationBreath {
  readonly targetBpm: number;
  readonly targetBeat: Seconds;
  readonly t0?: Microseconds;
  readonly riseRate?: number;
  readonly actualBeat?: Seconds;
  readonly depth?: number;
  readonly valid: boolean;
  readonly note: string;
}

/** Outcome of one cue, as kept in drill results and the score strip. */
export interface CueResult {
  readonly id: number;
  readonly cause: EntryCause;
  readonly quality: EntryQuality;
  readonly targetBpm?: number;
  /** Tempo the entry was placed at. */
  readonly plannedBpm: number;
  readonly beatSource: 'predicted' | 'target';
  /** Tempo measured from the confirmed peak; undefined = not measured. */
  readonly measuredBpm?: number;
  readonly spreadMs: number;
  readonly tooFast: boolean;
  readonly depth?: number;
}

export interface Clock {
  /** Current time in the SDK clock domain (epoch µs). */
  nowUs(): Microseconds;
}

export type { Microseconds, Milliseconds, Seconds };
