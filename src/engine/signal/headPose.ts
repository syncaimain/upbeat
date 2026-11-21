// Head pitch from three 2-D face landmarks: nose tip and the two outer eye
// corners (MediaPipe Face Mesh 1, 33, 263 — to be verified on SDK output).
//
// ratio = (nose.y − eyeMid.y) / |eyeR − eyeL|    (image y grows downward)
//
// When the chin lifts by θ, the nose tip (which sits in front of the eye
// plane by depth d) moves up in the image by ≈ d·sin θ, so
//   ratio(θ) ≈ ratio(0) − (d/E)·sin θ,   E = outer-eye distance.
// θ = asin((baseline − ratio) / (d/E)). The ratio is scale-invariant, so
// distance to the camera does not matter; it does need x and y in the same
// units (the decoder converts normalised coordinates to pixels).

import { CUE } from '../../../config/cue';
import type { HeadPoints, PitchSample } from '../types';

export function noseEyeRatio(p: HeadPoints): number {
  const mx = (p.eyeR.x + p.eyeL.x) / 2;
  const my = (p.eyeR.y + p.eyeL.y) / 2;
  const e = Math.hypot(p.eyeR.x - p.eyeL.x, p.eyeR.y - p.eyeL.y);
  if (!(e > 0)) return NaN;
  // Project the nose offset onto the face's vertical axis (perpendicular to
  // the eye line), so head roll does not read as pitch.
  const ux = (p.eyeL.x - p.eyeR.x) / e;
  const uy = (p.eyeL.y - p.eyeR.y) / e;
  // Perpendicular pointing "down the face" in image coordinates.
  let px = -uy;
  let py = ux;
  if (py < 0) { px = -px; py = -py; }
  const dx = p.nose.x - mx;
  const dy = p.nose.y - my;
  return (dx * px + dy * py) / e;
}

export function pitchFromRatio(ratio: number, baselineRatio: number,
  depthRatio: number = CUE.NOSE_DEPTH_RATIO): number {
  const s = (baselineRatio - ratio) / depthRatio;
  const clamped = Math.max(-1, Math.min(1, s));
  return (Math.asin(clamped) * 180) / Math.PI;
}

/** Streams head points into baseline-relative pitch samples with a
 *  3-sample median to suppress landmark jitter. */
export class HeadPitchTracker {
  private readonly win: number[] = [];
  private lastT = -Infinity;

  constructor(private baselineRatio: number | undefined) {}

  setBaseline(r: number | undefined): void {
    this.baselineRatio = r;
  }

  get hasBaseline(): boolean {
    return this.baselineRatio !== undefined && Number.isFinite(this.baselineRatio);
  }

  push(p: HeadPoints): PitchSample | null {
    if (p.t <= this.lastT) return null;
    this.lastT = p.t;
    if (p.reset) this.win.length = 0;
    const r = noseEyeRatio(p);
    if (!Number.isFinite(r) || !this.hasBaseline) return null;
    this.win.push(r);
    if (this.win.length > 3) this.win.shift();
    const sorted = [...this.win].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)]!;
    return { t: p.t, deg: pitchFromRatio(med, this.baselineRatio!) };
  }
}
