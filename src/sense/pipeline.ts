// The sense → engine pipeline. Live sessions and replays both go through
// here, with time passed in explicitly, so a replay driven by its recorded
// receipt times reproduces the same entries (and drill scores) every run.
//
// No SDK, Svelte or Tone imports: unit-testable in Node.

import { CUE } from '../../config/cue';
import { CueEngine, type EngineEvent, type TempoMode } from '../engine/cue/cueEngine';
import { HeadPitchTracker } from '../engine/signal/headPose';
import { Fuser, restingAmplitude, TraceProcessor } from '../engine/signal/preprocess';
import { DelayStats } from '../engine/timing/delay';
import type { Microseconds } from '../engine/timing/units';
import type {
  CalibrationProfile,
  HeadPoints,
  PitchSample,
  ProcessedSample,
  TraceSample,
} from '../engine/types';
import { QualityGate, type GateView } from './gate';
import type { SenseEvent } from './types';

export interface PipelineOptions {
  profile: CalibrationProfile | null;
  mode: TempoMode;
  voices: number;
  gesture: boolean;
  seed: number;
  /** Use the abdomen trace when it is stable and the chest is visible. */
  fuseAbdomen: boolean;
}

export interface PipelineSnapshot {
  readonly gate: GateView;
  /** Latest fused sample in resting amplitudes (inhale positive). */
  readonly level: number;
  readonly levelTime: Microseconds | null;
  readonly pitchDeg: number | null;
  readonly armed: boolean;
  readonly rateConfidence: number;
  readonly landmarkCount: number;
  readonly lastError: { code: number; message: string; retryable: boolean } | null;
}

/** Display-only resting estimate before calibration (rolling 20 s). */
class RollingRest {
  private readonly vals: { t: number; v: number }[] = [];
  push(t: number, v: number): void {
    this.vals.push({ t, v });
    while (this.vals.length && this.vals[0]!.t < t - CUE.REST_WINDOW_S * 1e6) this.vals.shift();
  }
  get amplitude(): number {
    return restingAmplitude(this.vals.map((x) => x.v));
  }
}

export class Pipeline {
  readonly engine: CueEngine;
  readonly gate = new QualityGate();
  readonly delays = new DelayStats();
  readonly sampleDelays = new DelayStats();
  private readonly chest: TraceProcessor;
  private readonly abdomen: TraceProcessor;
  private readonly fuser = new Fuser();
  private readonly pitch: HeadPitchTracker;
  private readonly rolling = new RollingRest();
  private readonly rawChest = new TraceProcessor({ restAmplitude: 1, polarity: 1 });
  private level = 0;
  private levelTime: Microseconds | null = null;
  private pitchDeg: number | null = null;
  private rateConfidence = 0;
  private landmarkCount = 0;
  private lastChestT = -Infinity;
  private lastError: PipelineSnapshot['lastError'] = null;
  /** Newest three face points (for the mirror's guidance markers). */
  lastHead: HeadPoints | null = null;
  private profile: CalibrationProfile | null;

  /** Raw samples kept for calibration analysis (bounded). */
  readonly capture = {
    on: false,
    chest: [] as TraceSample[],
    abdomen: [] as TraceSample[],
    head: [] as HeadPoints[],
  };

  /** Optional listener for every processed sample (breath arc, probes). */
  onSample: ((s: ProcessedSample) => void) | null = null;
  onPitch: ((p: PitchSample) => void) | null = null;

  constructor(private readonly opts: PipelineOptions) {
    this.profile = opts.profile;
    const p = opts.profile;
    this.chest = new TraceProcessor({ restAmplitude: p?.restAmplitude ?? 1, polarity: p?.polarity ?? 1 });
    this.abdomen = new TraceProcessor({
      restAmplitude: p?.restAmplitudeAbdomen ?? 1, polarity: p?.polarity ?? 1,
    });
    this.pitch = new HeadPitchTracker(p?.headBaselineRatio);
    this.engine = new CueEngine({
      mode: opts.mode, voices: opts.voices, gesture: opts.gesture && p?.headBaselineRatio !== undefined,
      seed: opts.seed,
    });
  }

  get calibrated(): boolean {
    return this.profile !== null;
  }

  handle(e: SenseEvent, now: Microseconds): EngineEvent[] {
    const out: EngineEvent[] = [];
    switch (e.kind) {
      case 'validation':
        this.gate.pushValidation(e.code, e.hint, now);
        break;
      case 'error':
        this.lastError = { code: e.code, message: e.message, retryable: e.retryable };
        break;
      case 'status':
        break;
      case 'key':
        if (e.key === 'ready') out.push(...this.engine.armKey(now));
        break;
      case 'metrics':
        out.push(...this.metrics(e.frame, e.recvUs, now));
        break;
    }
    out.push(...this.syncGate(now));
    out.push(...this.engine.tick(now));
    return out;
  }

  /** Metronome entry (Space). Not gated: it works without any camera. */
  metronome(now: Microseconds, bpm: number): EngineEvent[] {
    return this.engine.metronome(now, bpm);
  }

  tick(now: Microseconds): EngineEvent[] {
    return [...this.syncGate(now), ...this.engine.tick(now)];
  }

  stop(now: Microseconds): EngineEvent[] {
    return this.engine.stop(now);
  }

  snapshot(now: Microseconds): PipelineSnapshot {
    return {
      gate: this.gate.view(now),
      level: this.level,
      levelTime: this.levelTime,
      pitchDeg: this.pitchDeg,
      armed: this.engine.armed,
      rateConfidence: this.rateConfidence,
      landmarkCount: this.landmarkCount,
      lastError: this.lastError,
    };
  }

  private syncGate(now: Microseconds): EngineEvent[] {
    const v = this.gate.view(now);
    return this.engine.setGateOk(v.cuesAllowed && this.calibrated, now);
  }

  private metrics(f: import('./types').SenseFrame, recvUs: Microseconds, now: Microseconds): EngineEvent[] {
    const out: EngineEvent[] = [];
    this.landmarkCount = f.landmarkCount || this.landmarkCount;
    const lastRate = f.rate[f.rate.length - 1];
    if (lastRate) {
      this.rateConfidence = lastRate.confidence;
      this.gate.pushRateStable(lastRate.stable);
    }

    // Talking first, so a cue in the same packet is blocked.
    for (const t of f.talking) out.push(...this.engine.pushTalking(t.t, t.detected));

    // Abdomen samples feed the fuser.
    for (const s of f.abdomen) {
      const p = this.abdomen.push(s);
      if (p) this.fuser.pushAbdomen(p);
      if (this.capture.on) this.capture.abdomen.push(s);
    }

    let newest: TraceSample | null = null;
    for (const s of f.chest) {
      if (s.t <= this.lastChestT) continue;
      this.lastChestT = s.t;
      newest = s;
      this.sampleDelays.add(recvUs, s.t);
      if (this.capture.on) this.capture.chest.push(s);
      this.gate.pushTrace(s.stable, recvUs);
      const raw = this.rawChest.push(s);
      if (raw) this.rolling.push(raw.t, raw.v);
      const p = this.chest.push(s);
      if (!p) continue;
      const usable = this.opts.fuseAbdomen && this.profile?.restAmplitudeAbdomen !== undefined &&
        this.gate.view(now).chestVisible;
      const fused = this.fuser.fuse(p, usable);
      if (this.profile) {
        this.level = fused.v;
      } else if (raw) {
        const a = this.rolling.amplitude;
        this.level = Number.isFinite(a) && a > 0 ? raw.v / a : 0;
      }
      this.levelTime = fused.t;
      this.onSample?.(fused);
      out.push(...this.syncGate(now));
      if (this.profile) out.push(...this.engine.pushSample(fused, now));
    }
    if (newest) this.delays.add(recvUs, newest.t);

    for (const h of f.head) {
      if (this.capture.on) this.capture.head.push(h);
      this.lastHead = h;
      const p = this.pitch.push(h);
      if (!p) continue;
      this.pitchDeg = p.deg;
      this.onPitch?.(p);
      out.push(...this.engine.pushPitch(p));
    }
    return out;
  }

  startCapture(): void {
    this.capture.on = true;
    this.capture.chest.length = 0;
    this.capture.abdomen.length = 0;
    this.capture.head.length = 0;
  }

  stopCapture(): void {
    this.capture.on = false;
  }
}
