import { calibrate, trialTiming, type CalibrationOutcome } from '../../src/engine/calibration';
import type { EngineEvent, TempoMode } from '../../src/engine/cue/cueEngine';
import { us } from '../../src/engine/timing/units';
import type { CalibrationProfile, CommittedEntry, CueResult } from '../../src/engine/types';
import { runHeadless } from '../../src/sense/driver';
import { Pipeline } from '../../src/sense/pipeline';
import type { SenseEvent } from '../../src/sense/types';
import { calibrationScript, synthesize, SYNTH_EPOCH_US, type Script } from '../../fixtures/synth';

export function syntheticCalibration(seed = 3, polarity: 1 | -1 = 1): CalibrationOutcome {
  const restFrom = 32, restTo = 52;
  const { script, trialStarts } = calibrationScript(restTo + 1);
  const last = trialStarts[trialStarts.length - 1]!;
  const syn = synthesize({ durationS: last.at + 10, seed, polarity, script });
  const T = (s: number) => us(SYNTH_EPOCH_US + s * 1e6);
  return calibrate({
    chest: syn.chest,
    head: syn.head,
    restFrom: T(restFrom),
    restTo: T(restTo),
    trials: trialStarts.map((t) => trialTiming(T(t.at), t.bpm)),
    now: new Date(0),
  });
}

export interface RunOutput {
  events: EngineEvent[];
  commits: CommittedEntry[];
  results: CueResult[];
  pipeline: Pipeline;
}

export function runEvents(events: readonly SenseEvent[], profile: CalibrationProfile | null,
  mode: TempoMode, opts: { gesture?: boolean; seed?: number; bpm?: number } = {}): RunOutput {
  const pipeline = new Pipeline({
    profile, mode, voices: 8, gesture: opts.gesture ?? true, seed: opts.seed ?? 1, fuseAbdomen: false,
  });
  const all: EngineEvent[] = [];
  runHeadless(pipeline, events, {
    onEngine: (evs) => all.push(...evs),
    metronomeBpm: () => opts.bpm ?? 72,
  });
  return {
    events: all,
    commits: all.flatMap((e) => (e.type === 'commit' ? [e.entry] : [])),
    results: all.flatMap((e) => (e.type === 'result' ? [e.result] : [])),
    pipeline,
  };
}

export function runScript(script: Script[], durationS: number, profile: CalibrationProfile,
  mode: TempoMode, seed = 11, extra: { gesture?: boolean } = {}): RunOutput & { truth: ReturnType<typeof synthesize>['truth'] } {
  const syn = synthesize({ durationS, seed, script, polarity: profile.polarity });
  return { ...runEvents(syn.events, profile, mode, extra), truth: syn.truth };
}
