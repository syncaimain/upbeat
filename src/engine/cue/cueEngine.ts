// The cue engine: one state machine that turns processed breath samples,
// head pitch, talking and the quality gate into entry plans.
//
//   listening ──(Ready)──► armed ──(onset)──► rising ──(t0+150 ms)──► planned
//        ▲                    │                                        │
//        │                  (nod)──────────────► ragged entry          (commit, 90 ms before)
//        └──── release ◄── sounding ◄──────────────────────────────────┘
//
// Pure and deterministic: time comes in as arguments (SDK µs), randomness
// from a seeded RNG, so a replayed session produces identical entries.

import { CUE } from '../../../config/cue';
import { mulberry32, seedFor } from '../rng';
import { bpmToBeat, beatToBpm, sec, us, type Microseconds, type Seconds } from '../timing/units';
import type {
  CommittedEntry,
  CueResult,
  EntryPlan,
  PeakResult,
  PitchSample,
  ProcessedSample,
} from '../types';
import { classifyEntry, projectDepth, spreadOf, voiceOffsets } from './entryQuality';
import { OnsetDetector, valueAt } from './onset';
import { PeakTracker } from './confirmPeak';
import { predictBeat, riseRate } from './predictTempo';
import { ReadyGate, type ReadyEvent } from './readyGate';
import { ReleaseDetector } from './release';

export type TempoMode =
  | { kind: 'predict'; k: number; targetBpm?: number }
  | { kind: 'fixed'; targetBpm: number };

export interface EngineOptions {
  mode: TempoMode;
  voices: number;
  gesture: boolean;
  seed: number;
  /** When false (no stable breathing yet / paused), no cue may start. */
  initialGateOk?: boolean;
}

export type EngineEvent =
  | ReadyEvent
  | { type: 'onset'; id: number; t0: Microseconds; at: Microseconds }
  | { type: 'plan'; plan: EntryPlan }
  | { type: 'commit'; entry: CommittedEntry }
  | { type: 'count'; id: number; beat: number; at: Microseconds }
  | { type: 'peak'; result: PeakResult }
  | { type: 'result'; result: CueResult }
  | { type: 'release'; id: number; at: Microseconds; cause: 'cue' | 'timeout' | 'stop' }
  | { type: 'cancelled'; id: number; reason: string };

type Phase =
  | { kind: 'listening' }
  | { kind: 'rising'; id: number; t0: Microseconds; v0: number; tCross: Microseconds; vCross: number; peak: PeakTracker; samples: ProcessedSample[]; talking: boolean; dipSince: Microseconds | null; monotonic: boolean }
  | { kind: 'planned'; id: number; plan: EntryPlan; commitAt: Microseconds; t0?: Microseconds; v0: number; peak?: PeakTracker; samples: ProcessedSample[]; talking: boolean; dipSince: Microseconds | null; monotonic: boolean; clicksLeft: Microseconds[] }
  | { kind: 'sounding'; id: number; entry: CommittedEntry; peak?: PeakTracker; peakResult?: PeakResult; release: ReleaseDetector; resultSent: boolean };

export class CueEngine {
  readonly ready: ReadyGate;
  private phase: Phase = { kind: 'listening' };
  private readonly onset = new OnsetDetector();
  private nextId = 1;
  private gateOk: boolean;
  private mode: TempoMode;
  private readonly recent: ProcessedSample[] = [];
  private latestSample: ProcessedSample | null = null;

  constructor(private readonly opts: EngineOptions) {
    this.ready = new ReadyGate(opts.gesture);
    this.gateOk = opts.initialGateOk ?? false;
    this.mode = opts.mode;
  }

  get phaseKind(): Phase['kind'] {
    return this.phase.kind;
  }

  get armed(): boolean {
    return this.ready.current === 'armed';
  }

  setMode(mode: TempoMode): void {
    this.mode = mode;
  }

  get tempoMode(): TempoMode {
    return this.mode;
  }

  /** Next time the engine must be ticked (commit or count-in click). */
  nextDeadline(): Microseconds | null {
    if (this.phase.kind === 'planned') {
      const c = this.phase.clicksLeft[0];
      return c !== undefined && c < this.phase.commitAt ? c : this.phase.commitAt;
    }
    return null;
  }

  // ── Inputs ────────────────────────────────────────────────────────────

  setGateOk(ok: boolean, now: Microseconds): EngineEvent[] {
    if (ok === this.gateOk) return [];
    this.gateOk = ok;
    if (ok) return [];
    const out: EngineEvent[] = [...this.ready.disarm(now, 'paused')];
    this.onset.reset();
    if (this.phase.kind === 'rising' ||
      (this.phase.kind === 'planned' && this.phase.plan.cause === 'breath')) {
      out.push({ type: 'cancelled', id: this.phase.id, reason: 'breath data paused' });
      this.phase = { kind: 'listening' };
    }
    return out;
  }

  /** R: arm. While a chord is sounding, R first cuts it off (a conductor's
   *  next cue), then arms. */
  armKey(now: Microseconds): EngineEvent[] {
    if (!this.gateOk) return [];
    const out: EngineEvent[] = [];
    if (this.phase.kind === 'sounding') out.push(...this.release(now, 'cue'));
    if (this.phase.kind !== 'listening') return out;
    out.push(...this.ready.armByKey(now));
    return out;
  }

  pushTalking(t: Microseconds, detected: boolean): EngineEvent[] {
    const out: EngineEvent[] = [...this.ready.pushTalking(t, detected)];
    if (detected && (this.phase.kind === 'rising' || this.phase.kind === 'planned')) {
      this.phase.talking = true;
    }
    return out;
  }

  pushPitch(p: PitchSample): EngineEvent[] {
    const out: EngineEvent[] = [];
    if (this.phase.kind === 'sounding') {
      const r = this.phase.release.pushPitch(p);
      if (r !== null) out.push(...this.release(r, 'cue'));
      return out;
    }
    if (this.phase.kind !== 'listening') return out;
    for (const e of this.ready.pushPitch(p)) {
      out.push(e);
      if (e.type === 'nod' && this.gateOk) out.push(...this.nodEntry(e.at));
    }
    return out;
  }

  /** Feed one processed (fused) breath sample. */
  pushSample(s: ProcessedSample, now: Microseconds): EngineEvent[] {
    this.latestSample = s;
    this.recent.push(s);
    while (this.recent.length > 0 && this.recent[0]!.t < s.t - 3_000_000) this.recent.shift();
    const out: EngineEvent[] = [];

    switch (this.phase.kind) {
      case 'listening': {
        const o = this.onset.push(s);
        if (o && this.gateOk && this.armed && !this.ready.talkingBlocked(now)) {
          const id = this.nextId++;
          this.phase = {
            kind: 'rising', id, t0: o.t0, v0: o.v0, tCross: o.tCross, vCross: o.vCross, peak: new PeakTracker(o.t0, o.v0),
            samples: this.recent.filter((r) => r.t >= o.t0), talking: false, dipSince: null, monotonic: true,
          };
          for (const r of this.phase.samples) this.phase.peak.push(r);
          out.push(...this.maybePredict(now));
        }
        break;
      }
      case 'rising': {
        this.trackShape(this.phase, s);
        out.push(...this.peakUpdate(this.phase.peak.push(s), this.phase.id));
        if (this.phase.kind === 'rising') out.push(...this.maybePredict(now));
        break;
      }
      case 'planned': {
        this.trackShape(this.phase, s);
        if (this.phase.peak) out.push(...this.peakUpdate(this.phase.peak.push(s), this.phase.id));
        break;
      }
      case 'sounding': {
        if (this.phase.peak && !this.phase.peakResult) {
          out.push(...this.peakUpdate(this.phase.peak.push(s), this.phase.id));
        }
        if (this.phase.kind === 'sounding') {
          const r = this.phase.release.pushTrace(s);
          if (r !== null) out.push(...this.release(r, 'cue'));
        }
        break;
      }
    }
    return out;
  }

  /** Advance time: Ready timeout, count-in clicks, commits, sustain limit. */
  tick(now: Microseconds): EngineEvent[] {
    const out: EngineEvent[] = [...this.ready.tick(now)];
    if (this.phase.kind === 'planned') {
      while (this.phase.clicksLeft.length > 0 && this.phase.clicksLeft[0]! <= now + CUE.COMMIT_LEAD_MS * 1000) {
        const at = this.phase.clicksLeft.shift()!;
        const beatNo = CUE.COUNT_IN_BEATS - this.phase.clicksLeft.length;
        out.push({ type: 'count', id: this.phase.id, beat: beatNo, at });
      }
      if (now >= this.phase.commitAt) out.push(...this.commit(now));
    } else if (this.phase.kind === 'sounding') {
      if (this.phase.peak && !this.phase.peakResult) {
        out.push(...this.peakUpdate(this.phase.peak.expire(now), this.phase.id));
      }
      if (this.phase.kind === 'sounding' &&
        now - this.phase.entry.soundAt >= CUE.MAX_SUSTAIN_MS * 1000) {
        out.push(...this.release(now, 'timeout'));
      }
    }
    return out;
  }

  /** Metronome mode: a count-in entry with no breath (Space). */
  metronome(now: Microseconds, targetBpm: number): EngineEvent[] {
    if (this.phase.kind === 'rising' || this.phase.kind === 'planned') return [];
    const out: EngineEvent[] = [];
    if (this.phase.kind === 'sounding') out.push(...this.release(now, 'stop'));
    out.push(...this.ready.disarm(now, 'cued'));
    const beat = bpmToBeat(targetBpm);
    const beatUs = beat * 1e6;
    // First click a short moment after the key press so it is never clipped.
    const start = now + Math.max(CUE.MIN_LEAD_MS, 200) * 1000;
    const clicks = Array.from({ length: CUE.COUNT_IN_BEATS }, (_, i) => us(start + i * beatUs));
    const entryAt = us(start + CUE.COUNT_IN_BEATS * beatUs);
    const id = this.nextId++;
    const plan: EntryPlan = {
      id, cause: 'metronome', entryAt, beat, beatSource: 'target', tooFast: false,
    };
    this.phase = {
      kind: 'planned', id, plan, commitAt: us(entryAt - CUE.COMMIT_LEAD_MS * 1000), v0: 0,
      samples: [], talking: false, dipSince: null, monotonic: true, clicksLeft: clicks,
    };
    out.push({ type: 'plan', plan });
    return out;
  }

  /** Stop: release anything sounding and drop pending plans. */
  stop(now: Microseconds): EngineEvent[] {
    const out: EngineEvent[] = [...this.ready.disarm(now, 'stopped')];
    if (this.phase.kind === 'sounding') out.push(...this.release(now, 'stop'));
    else if (this.phase.kind !== 'listening') {
      out.push({ type: 'cancelled', id: this.phase.id, reason: 'stopped' });
      this.phase = { kind: 'listening' };
    }
    this.onset.reset();
    return out;
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private targetBeat(): Seconds {
    const bpm = this.mode.kind === 'fixed' ? this.mode.targetBpm : (this.mode.targetBpm ?? 72);
    return bpmToBeat(bpm);
  }

  /** At t0 + 150 ms: measure the early rise. Too gentle → not a cue (a
   *  resting inhale); otherwise plan the entry (predicted or fixed beat). */
  private maybePredict(now: Microseconds): EngineEvent[] {
    if (this.phase.kind !== 'rising') return [];
    const ph = this.phase;
    const due = ph.tCross + CUE.PREDICT_AFTER_MS * 1000;
    const last = ph.samples[ph.samples.length - 1];
    if (!last || last.t < due) return [];
    const r = riseRate(ph.vCross, valueAt(ph.samples, due), CUE.PREDICT_AFTER_MS / 1000);
    if (!(r >= CUE.MIN_CUE_RISE_REST_PER_S)) {
      this.phase = { kind: 'listening' };
      this.onset.rearm();
      return [];
    }
    this.ready.noteOnset();
    const out: EngineEvent[] = [
      { type: 'onset', id: ph.id, t0: ph.t0, at: now },
      ...this.ready.disarm(now, 'cued'),
    ];
    out.push(...this.planFromOnset(now, r));
    return out;
  }

  private planFromOnset(now: Microseconds, r: number | undefined): EngineEvent[] {
    if (this.phase.kind !== 'rising') return [];
    const ph = this.phase;
    const predicted = this.mode.kind === 'predict' && r !== undefined;
    const beat = predicted && this.mode.kind === 'predict' ? predictBeat(r!, this.mode.k) : this.targetBeat();
    const entryAt = us(ph.t0 + beat * 1e6);
    const lead = (entryAt - now) / 1000;
    const tooFast = lead < CUE.MIN_LEAD_MS;
    const plan: EntryPlan = {
      id: ph.id, cause: 'breath', t0: ph.t0, entryAt, beat,
      beatSource: predicted ? 'predicted' : 'target', ...(r !== undefined ? { riseRate: r } : {}), tooFast,
    };
    this.phase = {
      kind: 'planned', id: ph.id, plan, t0: ph.t0, v0: ph.v0, peak: ph.peak,
      commitAt: tooFast ? now : us(entryAt - CUE.COMMIT_LEAD_MS * 1000),
      samples: ph.samples, talking: ph.talking, dipSince: ph.dipSince, monotonic: ph.monotonic, clicksLeft: [],
    };
    const out: EngineEvent[] = [{ type: 'plan', plan }];
    if (tooFast) out.push(...this.commit(now));
    return out;
  }

  private trackShape(ph: Extract<Phase, { kind: 'rising' | 'planned' }>, s: ProcessedSample): void {
    ph.samples.push(s);
    if (!Number.isFinite(s.slope)) return;
    if (s.slope < 0) {
      if (ph.dipSince === null) ph.dipSince = s.t;
    } else if (ph.dipSince !== null) {
      // The rise resumed after a dip: a faltering breath if the dip was long.
      if (s.t - ph.dipSince > CUE.MONOTONIC_DIP_MS * 1000) ph.monotonic = false;
      ph.dipSince = null;
    }
  }

  private nodEntry(at: Microseconds): EngineEvent[] {
    const id = this.nextId++;
    const beat = this.targetBeat();
    // The players see the head drop and come in late and unsure.
    const entryAt = us(at + Math.max(CUE.MIN_LEAD_MS, 150) * 1000);
    const plan: EntryPlan = { id, cause: 'nod', entryAt, beat, beatSource: 'target', tooFast: false };
    this.phase = {
      kind: 'planned', id, plan, commitAt: at, v0: 0, samples: [], talking: false,
      dipSince: null, monotonic: true, clicksLeft: [],
    };
    return [{ type: 'plan', plan }, ...this.commit(at)];
  }

  private commit(now: Microseconds): EngineEvent[] {
    if (this.phase.kind !== 'planned') return [];
    const ph = this.phase;
    const rng = mulberry32(seedFor(this.opts.seed, ph.id));
    let verdict: { quality: CommittedEntry['quality']; reason: string };
    let projected: number | undefined;
    if (ph.plan.cause === 'metronome') {
      verdict = { quality: 'tight', reason: 'metronome count-in' };
    } else if (ph.plan.cause === 'nod') {
      verdict = { quality: 'ragged', reason: 'a nod without a breath' };
    } else {
      const last = ph.samples[ph.samples.length - 1];
      const elapsed = last && ph.t0 !== undefined ? (last.t - ph.t0) / 1e6 : 0;
      const depthSoFar = ph.peak?.depthSoFar ?? 0;
      projected = projectDepth(depthSoFar, elapsed, ph.plan.beat);
      verdict = classifyEntry({ depth: projected, monotonic: ph.monotonic, talking: ph.talking });
    }
    const offsetsMs = voiceOffsets(verdict.quality, this.opts.voices, rng);
    const soundAt = ph.plan.tooFast ? us(now + CUE.AUDIO_SAFETY_MS * 1000) : ph.plan.entryAt;
    const entry: CommittedEntry = {
      ...ph.plan, quality: verdict.quality, offsetsMs, soundAt,
      reason: ph.plan.tooFast ? `${verdict.reason}; too fast to follow` : verdict.reason,
      ...(projected !== undefined ? { projectedDepth: projected } : {}),
      monotonic: ph.monotonic,
    };
    this.phase = {
      kind: 'sounding', id: ph.id, entry, release: new ReleaseDetector(soundAt), resultSent: false,
      ...(ph.peak ? { peak: ph.peak } : {}),
      ...(ph.plan.cause === 'breath' ? {} : { peakResult: { id: ph.id, measured: false } }),
    };
    const out: EngineEvent[] = [{ type: 'commit', entry }];
    // A peak confirmed before the commit (fast tempos) was held back.
    if (this.heldPeak && this.heldPeak.id === ph.id) {
      this.phase.peakResult = this.heldPeak;
      this.heldPeak = null;
    }
    out.push(...this.maybeResult());
    return out;
  }

  private heldPeak: PeakResult | null = null;

  private peakUpdate(o: ReturnType<PeakTracker['push']>, id: number): EngineEvent[] {
    if (o.kind === 'pending') return [];
    const result: PeakResult = o.kind === 'confirmed'
      ? { id, measured: true, peakAt: o.peakAt, actualBeat: o.actualBeat, depth: o.depth }
      : { id, measured: false };
    const out: EngineEvent[] = [{ type: 'peak', result }];
    if (this.phase.kind === 'sounding') {
      this.phase.peakResult = result;
      out.push(...this.maybeResult());
    } else {
      this.heldPeak = result;
    }
    return out;
  }

  private maybeResult(): EngineEvent[] {
    if (this.phase.kind !== 'sounding' || this.phase.resultSent || !this.phase.peakResult) return [];
    const e = this.phase.entry;
    const pk = this.phase.peakResult;
    const target = this.mode.kind === 'fixed' ? this.mode.targetBpm : this.mode.targetBpm;
    const result: CueResult = {
      id: e.id,
      cause: e.cause,
      quality: e.quality,
      ...(target !== undefined ? { targetBpm: target } : {}),
      plannedBpm: beatToBpm(e.beat),
      beatSource: e.beatSource,
      ...(pk.measured && pk.actualBeat && pk.actualBeat > 0
        ? { measuredBpm: beatToBpm(sec(pk.actualBeat)) } : {}),
      spreadMs: spreadOf(e.offsetsMs),
      tooFast: e.tooFast,
      ...(pk.depth !== undefined ? { depth: pk.depth } : e.projectedDepth !== undefined ? { depth: e.projectedDepth } : {}),
    };
    this.phase.resultSent = true;
    return [{ type: 'result', result }];
  }

  private release(at: Microseconds, cause: 'cue' | 'timeout' | 'stop'): EngineEvent[] {
    if (this.phase.kind !== 'sounding') return [];
    const out: EngineEvent[] = [];
    if (!this.phase.peakResult) {
      this.phase.peakResult = { id: this.phase.id, measured: false };
      out.push({ type: 'peak', result: this.phase.peakResult });
      out.push(...this.maybeResult());
    }
    out.push({ type: 'release', id: this.phase.id, at, cause });
    this.phase = { kind: 'listening' };
    this.onset.rearm();
    return out;
  }

  /** Latest processed sample (for UI). */
  get latest(): ProcessedSample | null {
    return this.latestSample;
  }
}
