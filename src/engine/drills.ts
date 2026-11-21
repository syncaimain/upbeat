// Drills (P1): Consistency, Tempo ladder, Match the tempo. Scoring uses the
// tempo the breath SET (the tempo the ensemble played) against the target;
// where prediction is off (fixed-tempo mode) it uses the measured tempo.

import { mulberry32 } from './rng';
import type { CueResult } from './types';

export type DrillKind = 'consistency' | 'ladder' | 'match';

export interface DrillDef {
  readonly kind: DrillKind;
  readonly title: string;
  readonly blurb: string;
  readonly targets: readonly number[];
}

export function makeDrill(kind: DrillKind, opts: { tempo?: number; seed?: number } = {}): DrillDef {
  switch (kind) {
    case 'consistency': {
      const t = opts.tempo ?? 72;
      return {
        kind, title: 'Consistency',
        blurb: `Ten cues at ♩ = ${t}. Aim for the same breath every time.`,
        targets: Array.from({ length: 10 }, () => t),
      };
    }
    case 'ladder':
      return {
        kind, title: 'Tempo ladder',
        blurb: 'Seven cues climbing from ♩ = 60 to ♩ = 120.',
        targets: [60, 70, 80, 90, 100, 110, 120],
      };
    case 'match': {
      const rng = mulberry32(opts.seed ?? 7);
      return {
        kind, title: 'Match the tempo',
        blurb: 'Ten cues at tempi you have not chosen. Read the target, then breathe it.',
        targets: Array.from({ length: 10 }, () => 5 * Math.round((56 + rng() * 76) / 5)),
      };
    }
  }
}

export interface DrillScore {
  readonly kind: DrillKind;
  readonly cues: number;
  /** Cues whose tempo could be scored. */
  readonly scored: number;
  /** Mean signed tempo error (bpm): + means faster than target. */
  readonly meanErrorBpm: number;
  /** Standard deviation of the tempo error (bpm). */
  readonly spreadBpm: number;
  readonly meanAbsErrorBpm: number;
  /** Fraction of tight entries (0–1). */
  readonly tightFraction: number;
  /** Mean |measured − set| where both exist: how well prediction tracked
   *  the breath (bpm). */
  readonly predictionErrorBpm?: number;
  readonly results: readonly CueResult[];
}

export function scoredTempo(r: CueResult): number | undefined {
  if (r.cause !== 'breath') return undefined;
  return r.beatSource === 'predicted' ? r.plannedBpm : r.measuredBpm;
}

export function scoreDrill(kind: DrillKind, results: readonly CueResult[]): DrillScore {
  const errs: number[] = [];
  const pred: number[] = [];
  for (const r of results) {
    const t = scoredTempo(r);
    if (t !== undefined && r.targetBpm !== undefined) errs.push(t - r.targetBpm);
    if (r.beatSource === 'predicted' && r.measuredBpm !== undefined) {
      pred.push(Math.abs(r.measuredBpm - r.plannedBpm));
    }
  }
  const mean = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : NaN;
  const sd = errs.length > 1
    ? Math.sqrt(errs.reduce((a, e) => a + (e - mean) ** 2, 0) / (errs.length - 1)) : 0;
  const mae = errs.length ? errs.reduce((a, e) => a + Math.abs(e), 0) / errs.length : NaN;
  const tight = results.filter((r) => r.quality === 'tight').length;
  return {
    kind,
    cues: results.length,
    scored: errs.length,
    meanErrorBpm: mean,
    spreadBpm: sd,
    meanAbsErrorBpm: mae,
    tightFraction: results.length ? tight / results.length : 0,
    ...(pred.length ? { predictionErrorBpm: pred.reduce((a, b) => a + b, 0) / pred.length } : {}),
    results,
  };
}
