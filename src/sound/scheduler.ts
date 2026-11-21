// Entry scheduling on the Web Audio clock.
//
// The cue engine plans in SDK time; ClockMap converts the downbeat to
// AudioContext time; each voice is then triggered at downbeat + its offset.
// Attack times are exact Web Audio times, so the UI frame rate never affects
// when the ensemble sounds.

import * as Tone from 'tone';
import type { ClockMap } from '../engine/timing/clocks';
import type { CommittedEntry } from '../engine/types';
import { createChoir, Click, TuningHum, type Ensemble } from './choirSynth';
import { createQuartet } from './quartetSampler';
import { chordFor, type Voicing } from './voicing';

/** Earliest time a voice may be scheduled relative to `now` (s). */
export const MIN_SCHEDULE_AHEAD_S = 0.005;

/**
 * Pure: per-voice audio times from a downbeat (audio s) and offsets (ms).
 * Voices that would land in the past are pulled up to now + margin (and
 * reported late).
 */
export function computeVoiceTimes(base: number, offsetsMs: readonly number[], now: number): { times: number[]; late: number } {
  let late = 0;
  const times = offsetsMs.map((o) => {
    const t = base + o / 1000;
    if (t < now + MIN_SCHEDULE_AHEAD_S) {
      late = Math.max(late, now + MIN_SCHEDULE_AHEAD_S - t);
      return now + MIN_SCHEDULE_AHEAD_S;
    }
    return t;
  });
  return { times, late };
}

export interface ScheduledEntry {
  readonly id: number;
  /** Audio time of each voice's attack. */
  readonly times: readonly number[];
  /** How much later than planned the earliest voice had to be (s). */
  readonly late: number;
}

export class AudioEngine {
  readonly ctx: AudioContext;
  private readonly master: Tone.Volume;
  private readonly limiter: Tone.Limiter;
  private readonly hall: Tone.Reverb;
  private ensemble: Ensemble | null = null;
  private hum: TuningHum | null = null;
  private click: Click | null = null;
  private ensembleKind: 'choir' | 'quartet' = 'choir';
  private voicing: Voicing = 'open';
  private sounding = false;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    Tone.setContext(new Tone.Context(this.ctx));
    Tone.getContext().lookAhead = 0.02;
    // −6 dBFS ceiling so entries are never startling (F6, accessibility).
    this.limiter = new Tone.Limiter(-6).toDestination();
    this.hall = new Tone.Reverb({ decay: 2.4, preDelay: 0.02, wet: 0.24 });
    this.hall.connect(this.limiter);
    this.master = new Tone.Volume(-6);
    this.master.connect(this.hall);
  }

  /** Must follow a user gesture (autoplay policy). */
  async unlock(): Promise<void> {
    await Tone.start();
    if (this.ctx.state !== 'running') await this.ctx.resume();
    this.click ??= new Click(this.master);
    if (!this.ensemble) await this.setEnsemble(this.ensembleKind);
  }

  get running(): boolean {
    return this.ctx.state === 'running';
  }

  get kind(): Ensemble['kind'] | null {
    return this.ensemble?.kind ?? null;
  }

  now(): number {
    return this.ctx.currentTime;
  }

  /** Feed the clock mapping (call every animation frame). */
  stamp(clock: ClockMap): void {
    if (this.ctx.state !== 'running') return;
    const ts = this.ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
      clock.setAudioStamp({ contextTime: ts.contextTime, performanceTime: ts.performanceTime });
    } else {
      // Fallback: current time, corrected by the reported output latency.
      const lat = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
      clock.setAudioStamp({ contextTime: this.ctx.currentTime - lat, performanceTime: performance.now() });
    }
  }

  async setEnsemble(kind: 'choir' | 'quartet'): Promise<Ensemble['kind']> {
    this.ensembleKind = kind;
    const old = this.ensemble;
    this.ensemble = kind === 'choir' ? createChoir(this.master) : await createQuartet(this.master);
    old?.dispose();
    return this.ensemble.kind;
  }

  setVoicing(v: Voicing): void {
    this.voicing = v;
  }

  setVolume(db: number): void {
    this.master.volume.rampTo(db, 0.1);
  }

  get voiceCount(): number {
    return this.ensembleKind === 'choir' ? 8 : 4;
  }

  scheduleEntry(e: CommittedEntry, clock: ClockMap): ScheduledEntry {
    if (!this.ensemble) throw new Error('audio not unlocked');
    const now = this.ctx.currentTime;
    const base = clock.hasAudio() ? clock.sdkToAudio(e.soundAt) : now + 0.03;
    const offsets = e.offsetsMs.slice(0, this.ensemble.voices.length);
    const { times, late } = computeVoiceTimes(base, offsets, now);
    const notes = chordFor(this.ensembleKind, this.voicing);
    const vel = e.quality === 'ragged' ? 0.62 : 0.78;
    this.ensemble.voices.forEach((v, i) => {
      // Ragged entries also wobble in level a little.
      const vv = e.quality === 'ragged' ? vel * (0.8 + 0.4 * ((i * 37) % 10) / 10) : vel;
      v.attack(notes[i] ?? notes[0]!, times[i] ?? base, vv);
    });
    this.sounding = true;
    return { id: e.id, times, late };
  }

  releaseAll(at?: number): void {
    if (!this.ensemble || !this.sounding) return;
    const t = Math.max(at ?? this.ctx.currentTime, this.ctx.currentTime + 0.005);
    this.ensemble.voices.forEach((v) => v.release(t));
    this.sounding = false;
  }

  clickAt(time: number, accent: boolean): void {
    this.click?.tick(Math.max(time, this.ctx.currentTime + 0.002), accent);
  }

  humOn(): void {
    this.hum ??= new TuningHum(this.master);
    this.hum.start();
  }

  humOff(): void {
    this.hum?.stop();
  }

  /** Stop everything; sound is gone within the release time (< 1 s). */
  silence(): void {
    this.releaseAll();
    this.humOff();
  }

  async close(): Promise<void> {
    this.silence();
    await new Promise((r) => setTimeout(r, 300));
    await this.ctx.close();
  }
}

/**
 * Offline precision check (used by the e2e test): renders plans with a probe
 * voice whose gain steps from 0 to 1 at its attack time, then finds each step
 * in the rendered buffer. Returns the worst absolute error in ms.
 */
export async function offlineScheduleCheck(n = 100): Promise<{ maxErrMs: number; meanErrMs: number; plans: number }> {
  const sr = 48_000;
  // Plans 100 ms apart, each probe pulse 20 ms long: with offsets within
  // ±20 ms consecutive pulses can never overlap, so every attack is a
  // distinct rising edge.
  const spacing = 0.1;
  const pulse = 0.02;
  const offsets = [0, 7.3, -11.1, 3.7, 19.9, -5.2, 0.4, 12.8];
  const dur = n * spacing + 0.5;
  const expected: number[] = [];
  const buf = await Tone.Offline(({ transport }) => {
    void transport;
    // A true constant (1.0) gated by the probe gain: the rendered buffer is
    // exactly 0 or 1, so each attack is one clean rising edge.
    const dc = new Tone.Signal(1);
    const g = new Tone.Gain(0).toDestination();
    dc.connect(g);
    for (let i = 0; i < n; i++) {
      const base = 0.1 + i * spacing;
      const { times } = computeVoiceTimes(base, [offsets[i % offsets.length]!], 0);
      const t = times[0]!;
      expected.push(t);
      g.gain.setValueAtTime(1, t);
      g.gain.setValueAtTime(0, t + pulse);
    }
  }, dur, 1, sr);
  const data = buf.getChannelData(0);
  const errs: number[] = [];
  let k = 0;
  for (let i = 1; i < data.length && k < expected.length; i++) {
    if (Math.abs(data[i]!) > 0.5 && Math.abs(data[i - 1]!) <= 0.5) {
      errs.push(Math.abs(i / sr - expected[k]!) * 1000);
      k++;
    }
  }
  return {
    plans: errs.length,
    maxErrMs: errs.length ? Math.max(...errs) : Infinity,
    meanErrMs: errs.reduce((a, b) => a + b, 0) / (errs.length || 1),
  };
}
