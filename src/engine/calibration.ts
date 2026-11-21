// Calibration (≈ 90 s, once): 20 s of resting breath, then 9 prep breaths to
// a visual metronome at 60, 90 and 120 bpm. Produces the resting amplitude,
// the trace polarity (which way an inhale moves the trace), the head-pitch
// baseline and the per-user tempo constant k.
//
// Everything here is offline analysis over recorded numbers, so it is
// deterministic and unit-testable.

import { CUE } from '../../config/cue';
import { OnsetDetector, valueAt } from './cue/onset';
import { PeakTracker } from './cue/confirmPeak';
import { fitK, riseRate } from './cue/predictTempo';
import { noseEyeRatio } from './signal/headPose';
import { restingAmplitude, TraceProcessor } from './signal/preprocess';
import { quantile } from './timing/delay';
import { bpmToBeat, sec, us, type Microseconds, type Seconds } from './timing/units';
import type {
  CalibrationBreath,
  CalibrationProfile,
  HeadPoints,
  ProcessedSample,
  TraceSample,
} from './types';

export const CALIBRATION_TEMPI = [60, 60, 60, 90, 90, 90, 120, 120, 120] as const;

/** Trial timeline: count 1-2-3, inhale on 4 (the preparatory beat), the
 *  choir enters on the next downbeat. */
export interface TrialTiming {
  readonly start: Microseconds;
  readonly bpm: number;
  readonly beat: Seconds;
  /** Beat 4: where the preparatory inhale should begin. */
  readonly prepAt: Microseconds;
  /** The downbeat. */
  readonly downbeatAt: Microseconds;
  /** Analysis window for this trial. */
  readonly windowFrom: Microseconds;
  readonly windowTo: Microseconds;
}

export function trialTiming(start: Microseconds, bpm: number): TrialTiming {
  const beat = bpmToBeat(bpm);
  const b = beat * 1e6;
  const prepAt = us(start + 3 * b);
  const downbeatAt = us(start + 4 * b);
  return {
    start, bpm, beat, prepAt, downbeatAt,
    windowFrom: us(prepAt - 400_000),
    windowTo: us(downbeatAt + Math.max(800_000, b)),
  };
}

/** Raw-unit processing of a whole recording (rest amp 1, polarity +1). */
export function processRaw(samples: readonly TraceSample[]): ProcessedSample[] {
  const p = new TraceProcessor({ restAmplitude: 1, polarity: 1 });
  const out: ProcessedSample[] = [];
  for (const s of samples) {
    const r = p.push(s);
    if (r) out.push(r);
  }
  return out;
}

/** Rescale raw-processed samples to rest units with the given polarity. */
export function normalise(raw: readonly ProcessedSample[], restAmp: number, polarity: 1 | -1): ProcessedSample[] {
  const k = polarity / Math.max(restAmp, CUE.REST_AMPLITUDE_FLOOR);
  return raw.map((s) => ({ t: s.t, v: s.v * k, r: s.r * k, slope: s.slope * k, stable: s.stable }));
}

export interface RestAnalysis {
  readonly restAmplitude: number;
  readonly restAmplitudeAbdomen?: number;
  readonly headBaselineRatio?: number;
  readonly samples: number;
  readonly stableFraction: number;
}

export function analyzeRest(
  chestRaw: readonly ProcessedSample[],
  from: Microseconds,
  to: Microseconds,
  abdomenRaw?: readonly ProcessedSample[],
  head?: readonly HeadPoints[],
): RestAnalysis {
  const inWin = (t: number) => t >= from && t <= to;
  const chest = chestRaw.filter((s) => inWin(s.t));
  const stable = chest.filter((s) => s.stable);
  const restAmplitude = restingAmplitude(stable.map((s) => s.v));
  const abd = abdomenRaw?.filter((s) => inWin(s.t) && s.stable);
  const restAmplitudeAbdomen = abd && abd.length > 10 ? restingAmplitude(abd.map((s) => s.v)) : undefined;
  const ratios = (head ?? []).filter((h) => inWin(h.t) && h.stable).map(noseEyeRatio)
    .filter(Number.isFinite).sort((a, b) => a - b);
  const headBaselineRatio = ratios.length >= 10 ? quantile(ratios, 0.5) : undefined;
  return {
    restAmplitude,
    ...(restAmplitudeAbdomen !== undefined && Number.isFinite(restAmplitudeAbdomen) ? { restAmplitudeAbdomen } : {}),
    ...(headBaselineRatio !== undefined ? { headBaselineRatio } : {}),
    samples: chest.length,
    stableFraction: chest.length ? stable.length / chest.length : 0,
  };
}

/**
 * Which way does an inhale move the trace? For each trial, take the
 * excursion from the prep beat to the downbeat (+ a little): the inhale is
 * the large movement there. Majority vote across trials.
 */
export function detectPolarity(raw: readonly ProcessedSample[], trials: readonly TrialTiming[]): 1 | -1 {
  let votes = 0;
  for (const tr of trials) {
    const from = tr.prepAt - 200_000;
    const to = tr.downbeatAt + 200_000;
    const w = raw.filter((s) => s.t >= from && s.t <= to);
    if (w.length < 5) continue;
    const start = valueAt(w, tr.prepAt);
    let maxUp = 0;
    let maxDown = 0;
    for (const s of w) {
      maxUp = Math.max(maxUp, s.r - start);
      maxDown = Math.max(maxDown, start - s.r);
    }
    if (maxUp === maxDown) continue;
    votes += maxUp > maxDown ? 1 : -1;
  }
  return votes < 0 ? -1 : 1;
}

/** Analyse one prep-breath trial on normalised samples. */
export function analyzeTrial(norm: readonly ProcessedSample[], tr: TrialTiming): CalibrationBreath {
  const base = { targetBpm: tr.bpm, targetBeat: tr.beat };
  const w = norm.filter((s) => s.t >= tr.windowFrom - 600_000 && s.t <= tr.windowTo);
  if (w.length < 10) return { ...base, valid: false, note: 'no breathing data' };
  if (w.some((s) => !s.stable && s.t >= tr.windowFrom)) {
    return { ...base, valid: false, note: 'breathing data unstable' };
  }
  const det = new OnsetDetector();
  let onset: ReturnType<OnsetDetector['push']> = null;
  // A breath may start up to 0.9 of a beat after "breathe in" (people react
  // to the cue; at ♩ = 120 a 0.6-beat window left only 0.3 s).
  const latest = tr.prepAt + 0.9 * tr.beat * 1e6;
  for (const s of w) {
    const o = det.push(s);
    if (o && o.t0 >= tr.windowFrom && o.t0 <= latest) { onset = o; break; }
  }
  if (!onset) return { ...base, valid: false, note: 'no inhale found near beat 4' };
  const due = onset.tCross + CUE.PREDICT_AFTER_MS * 1000;
  const after = w.filter((s) => s.t >= onset!.t0);
  const r = riseRate(onset.vCross, valueAt(after, due), CUE.PREDICT_AFTER_MS / 1000);
  const peak = new PeakTracker(onset.t0, onset.v0);
  let actualBeat: Seconds | undefined;
  let depth: number | undefined;
  for (const s of after) {
    const o = peak.push(s);
    if (o.kind === 'confirmed') { actualBeat = o.actualBeat; depth = o.depth; break; }
    if (o.kind === 'unmeasured') break;
  }
  depth ??= peak.depthSoFar;
  if (!(r > 0)) return { ...base, t0: onset.t0, valid: false, note: 'inhale too slow to measure' };
  if (depth < CUE.RAGGED_DEPTH_X) {
    return { ...base, t0: onset.t0, riseRate: r, depth, valid: false, note: 'breath too shallow' };
  }
  return {
    ...base, t0: onset.t0, riseRate: r, depth,
    ...(actualBeat !== undefined ? { actualBeat } : {}),
    valid: true, note: 'ok',
  };
}

export interface CalibrationOutcome {
  readonly profile?: CalibrationProfile;
  readonly breaths: readonly CalibrationBreath[];
  readonly rest: RestAnalysis;
  readonly polarity: 1 | -1;
  readonly ok: boolean;
  readonly message: string;
}

export function calibrate(input: {
  chest: readonly TraceSample[];
  abdomen?: readonly TraceSample[];
  head?: readonly HeadPoints[];
  restFrom: Microseconds;
  restTo: Microseconds;
  trials: readonly TrialTiming[];
  previousK?: number;
  now?: Date;
}): CalibrationOutcome {
  const raw = processRaw(input.chest);
  const abdRaw = input.abdomen ? processRaw(input.abdomen) : undefined;
  const rest = analyzeRest(raw, input.restFrom, input.restTo, abdRaw, input.head);
  const polarity = detectPolarity(raw, input.trials);
  if (!(rest.restAmplitude > 0) || rest.stableFraction < 0.8) {
    return {
      breaths: [], rest, polarity, ok: false,
      message: 'The resting breath was not steady enough to measure. Sit still, chest in view, and redo.',
    };
  }
  const norm = normalise(raw, rest.restAmplitude, polarity);
  const breaths = input.trials.map((tr) => analyzeTrial(norm, tr));
  const valid = breaths.filter((b) => b.valid);
  const fit = fitK(valid.map((b) => ({ r: b.riseRate!, b: b.targetBeat })));
  if (!fit || valid.length < CUE.MIN_CALIBRATION_BREATHS) {
    return {
      breaths, rest, polarity, ok: false,
      message: `Only ${valid.length} of ${breaths.length} prep breaths were clear enough (need ${CUE.MIN_CALIBRATION_BREATHS}). Redo with a fuller breath on beat four.`,
    };
  }
  // Abdomen polarity follows the chest unless measured otherwise later.
  const profile: CalibrationProfile = {
    version: 1,
    createdAt: (input.now ?? new Date()).toISOString(),
    restAmplitude: rest.restAmplitude,
    ...(rest.restAmplitudeAbdomen !== undefined ? { restAmplitudeAbdomen: rest.restAmplitudeAbdomen } : {}),
    polarity,
    k: fit.k,
    fitError: fit.fitError,
    breathsUsed: valid.length,
    ...(rest.headBaselineRatio !== undefined ? { headBaselineRatio: rest.headBaselineRatio } : {}),
    predictionTrusted: fit.fitError <= CUE.MAX_TRUSTED_FIT_ERROR,
    ...(input.previousK !== undefined ? { previousK: input.previousK } : {}),
  };
  const pct = Math.round(fit.fitError * 100);
  return {
    profile, breaths, rest, polarity, ok: true,
    message: profile.predictionTrusted
      ? `Fit error ${pct} % across ${valid.length} breaths. Your breath can set the tempo.`
      : `Fit error ${pct} % — too loose to predict tempo reliably. Exercises will use a fixed tempo; your breath times the entry and its tempo is reported.`,
  };
}

/** k change between runs, as a fraction (0.12 = 12 %). */
export function kStability(profile: CalibrationProfile): number | undefined {
  if (profile.previousK === undefined) return undefined;
  return Math.abs(profile.k - profile.previousK) / profile.previousK;
}

export { sec };
