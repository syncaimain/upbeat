// Entry quality and per-voice timing.
//
// A clean preparatory breath (deep, rising steadily, no talking) gives a
// tight entry: voice offsets from N(0, 12 ms). A shallow breath or none gives
// a ragged one: offsets spread 60–250 ms with two voices noticeably late.
// That contrast is the lesson.

import { CUE } from '../../../config/cue';
import { gaussian, type Rng } from '../rng';
import { ms, type Milliseconds } from '../timing/units';
import type { EntryQuality } from '../types';

export interface QualityInput {
  /** Projected inhale depth in resting amplitudes (undefined = no breath). */
  readonly depth?: number;
  readonly monotonic: boolean;
  readonly talking: boolean;
}

export interface QualityVerdict {
  readonly quality: EntryQuality;
  readonly reason: string;
}

export function classifyEntry(q: QualityInput): QualityVerdict {
  if (q.talking) return { quality: 'ragged', reason: 'talking during the cue' };
  if (q.depth === undefined || !Number.isFinite(q.depth)) {
    return { quality: 'ragged', reason: 'no breath' };
  }
  if (q.depth < CUE.RAGGED_DEPTH_X) return { quality: 'ragged', reason: 'shallow breath' };
  if (q.depth >= CUE.CLEAN_DEPTH_X && q.monotonic) return { quality: 'tight', reason: 'clean breath' };
  if (!q.monotonic) return { quality: 'loose', reason: 'the breath faltered' };
  return { quality: 'loose', reason: 'breath a little shallow' };
}

/**
 * Projected depth at commit time. Before the peak the inhale is incomplete,
 * so the depth reached so far is divided by the share of the full depth an
 * inhale of the assumed shape has reached after that fraction of the beat.
 */
export function projectDepth(depthSoFar: number, elapsedS: number, beatS: number,
  shape: 'sine' | 'linear' = CUE.PROJECTION_SHAPE): number {
  const frac = Math.min(1, Math.max(CUE.PROJECTION_MIN_FRACTION, elapsedS / beatS));
  const reached = shape === 'sine' ? Math.sin((Math.PI / 2) * frac) : frac;
  return depthSoFar / reached;
}

/** Per-voice offsets from the downbeat in ms (positive = late). */
export function voiceOffsets(quality: EntryQuality, voices: number, rng: Rng): Milliseconds[] {
  const out: number[] = [];
  if (quality === 'tight' || quality === 'loose') {
    const sigma = quality === 'tight' ? CUE.TIGHT_SIGMA_MS : CUE.LOOSE_SIGMA_MS;
    for (let i = 0; i < voices; i++) {
      // Clip at 3σ so one unlucky draw can't make a tight entry sound ragged.
      out.push(Math.max(-3 * sigma, Math.min(3 * sigma, sigma * gaussian(rng))));
    }
    return out.map(ms);
  }
  // Ragged: choose the total spread, then put two voices near its late end
  // and the rest in its early third.
  const spread = CUE.RAGGED_SPREAD_MIN_MS +
    rng() * (CUE.RAGGED_SPREAD_MAX_MS - CUE.RAGGED_SPREAD_MIN_MS);
  const late = new Set<number>();
  const nLate = Math.min(CUE.RAGGED_LATE_VOICES, voices);
  while (late.size < nLate) late.add(Math.floor(rng() * voices));
  for (let i = 0; i < voices; i++) {
    out.push(late.has(i) ? spread * (0.75 + 0.25 * rng()) : spread * 0.35 * rng());
  }
  // Pin the extremes so the spread is exactly what was drawn.
  const lateIdx = [...late];
  if (lateIdx.length > 0) out[lateIdx[0]!] = spread;
  const early = out.findIndex((_, i) => !late.has(i));
  if (early >= 0) out[early] = 0;
  return out.map(ms);
}

export function spreadOf(offsets: readonly number[]): number {
  if (offsets.length === 0) return 0;
  return Math.max(...offsets) - Math.min(...offsets);
}
