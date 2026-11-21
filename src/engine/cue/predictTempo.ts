// Tempo prediction from the start of the breath.
//
// The entry must sound before the inhale's peak can be confirmed, so the beat
// is predicted from how the inhale begins: the early rise rate r (resting
// amplitudes per second over the first 150 ms). A quicker preparatory breath
// rises faster, so b = k / r, with k fitted per user in calibration.

import { CUE } from '../../../config/cue';
import { sec, type Seconds } from '../timing/units';

export function clampBeat(b: number): Seconds {
  return sec(Math.min(CUE.BEAT_MAX_S, Math.max(CUE.BEAT_MIN_S, b)));
}

/** Predicted beat (s) for an early rise rate r (rest/s). */
export function predictBeat(r: number, k: number): Seconds {
  if (!(r > 0) || !(k > 0)) return clampBeat(CUE.BEAT_MAX_S);
  return clampBeat(k / r);
}

/** Early rise rate: (v(t0 + w) − v(t0)) / w, in rest/s. */
export function riseRate(v0: number, vAfter: number, windowS: number): number {
  return (vAfter - v0) / windowS;
}

export interface FitPoint {
  /** Early rise rate (rest/s). */
  readonly r: number;
  /** Target beat (s). */
  readonly b: number;
}

export interface FitResult {
  readonly k: number;
  /** RMS relative beat error of k / r against b (0.1 = 10 %). */
  readonly fitError: number;
  readonly n: number;
  /** Relative error per point, same order as the input. */
  readonly residuals: readonly number[];
}

/**
 * Least squares on 1/b: minimise Σ (1/bᵢ − c·rᵢ)², c = 1/k
 *   ⇒ c = Σ(rᵢ/bᵢ) / Σ(rᵢ²).
 * Fitting the reciprocal keeps the model linear in its parameter.
 */
export function fitK(points: readonly FitPoint[]): FitResult | null {
  const pts = points.filter((p) => p.r > 0 && p.b > 0 && Number.isFinite(p.r));
  if (pts.length === 0) return null;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += p.r / p.b;
    den += p.r * p.r;
  }
  if (!(num > 0) || !(den > 0)) return null;
  const k = den / num;
  const residuals = points.map((p) =>
    p.r > 0 && p.b > 0 ? (clampBeat(k / p.r) - p.b) / p.b : NaN);
  const finite = residuals.filter(Number.isFinite);
  const fitError = Math.sqrt(finite.reduce((s, e) => s + e * e, 0) / finite.length);
  return { k, fitError, n: pts.length, residuals };
}
