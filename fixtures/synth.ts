// SYNTHETIC breathing data for unit tests and the demo replay.
//
// This is a model, not a measurement: a chest trace with resting breaths,
// scripted preparatory breaths, noise, drift, warm-up instability and a
// delivery-delay distribution matching the figures another entrant measured
// (≈105 ms median, ≈260 ms p95). Every file produced from it is marked
// `synthetic: true` and the app labels its replay accordingly. Real
// recordings (Stage 1) replace it.

import { mulberry32, gaussian, type Rng } from '../src/engine/rng';
import { us, type Microseconds } from '../src/engine/timing/units';
import type { HeadPoints, TraceSample } from '../src/engine/types';
import type { InputKey, ReplayHeader, SenseEvent, SenseFrame } from '../src/sense/types';

export const SYNTH_FS = 30; // samples per second (assumed; verify in Stage 1)
export const SYNTH_EPOCH_US = 1_790_000_000_000_000; // a fixed epoch-µs origin

export type Script =
  | { kind: 'prep'; at: number; beatS: number; depth: number }
  | { kind: 'lift'; at: number; deg: number; holdS: number; dropAfterS?: number }
  | { kind: 'key'; at: number; key: InputKey }
  | { kind: 'talk'; at: number; durS: number }
  | { kind: 'cover'; at: number; durS: number }
  | { kind: 'sway'; at: number; durS: number };

export interface SynthOptions {
  durationS: number;
  seed?: number;
  restRatePerMin?: number;
  /** Resting peak-to-trough amplitude in trace units. */
  restAmp?: number;
  /** Breathing becomes stable after this many seconds (SDK window). */
  warmupS?: number;
  noise?: number;
  /** Trace polarity: +1 = inhale raises the trace. */
  polarity?: 1 | -1;
  script?: readonly Script[];
  withHead?: boolean;
  packetMs?: number;
}

/** Quarter-sine inhale to `depth` over `beatS`, then a 1.6 s exhale. */
function prepShape(t: number, beatS: number, depth: number): number {
  if (t < 0) return 0;
  if (t <= beatS) return depth * Math.sin((Math.PI / 2) * (t / beatS));
  const ex = 1.6;
  const u = t - beatS;
  if (u <= ex) return depth * 0.5 * (1 + Math.cos(Math.PI * (u / ex)));
  return 0;
}

export interface SynthResult {
  readonly events: SenseEvent[];
  readonly chest: TraceSample[];
  readonly head: HeadPoints[];
  /** Ground truth for each prep breath: onset and peak (SDK µs). */
  readonly truth: { at: Microseconds; beatS: number; depth: number }[];
}

function lognormalDelayMs(rng: Rng): number {
  // median 105 ms, p95 ≈ 260 ms → σ = ln(260/105)/1.645 ≈ 0.55
  return 105 * Math.exp(0.55 * gaussian(rng));
}

export function synthesize(o: SynthOptions): SynthResult {
  const rng = mulberry32(o.seed ?? 1);
  const fs = SYNTH_FS;
  const n = Math.floor(o.durationS * fs);
  const restRate = o.restRatePerMin ?? 14;
  const amp = o.restAmp ?? 1;
  const warm = o.warmupS ?? 30;
  const noise = o.noise ?? 0.02;
  const pol = o.polarity ?? 1;
  const script = o.script ?? [];
  const preps = script.filter((s): s is Extract<Script, { kind: 'prep' }> => s.kind === 'prep');
  const lifts = script.filter((s): s is Extract<Script, { kind: 'lift' }> => s.kind === 'lift');
  const talks = script.filter((s): s is Extract<Script, { kind: 'talk' }> => s.kind === 'talk');
  const covers = script.filter((s): s is Extract<Script, { kind: 'cover' }> => s.kind === 'cover');
  const sways = script.filter((s): s is Extract<Script, { kind: 'sway' }> => s.kind === 'sway');
  const inAny = (t: number, xs: readonly { at: number; durS: number }[]) =>
    xs.some((x) => t >= x.at && t < x.at + x.durS);

  // Resting phase: integrate a slowly varying rate so breaths are not
  // perfectly periodic. A prep breath replaces the resting cycle around it.
  let phase = 0;
  const chest: TraceSample[] = [];
  const head: HeadPoints[] = [];
  const talking: { t: Microseconds; detected: boolean }[] = [];
  const W = 1280, H = 720;
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const rate = restRate * (1 + 0.08 * Math.sin(2 * Math.PI * t / 37));
    phase += (2 * Math.PI * rate) / 60 / fs;
    // Suppress resting breathing near a prep breath (the leader holds, then
    // takes the prep breath).
    let restGain = 1;
    for (const p of preps) {
      const a = p.at - 0.4;
      const b = p.at + p.beatS + 1.8;
      const ramp = 1.2;
      let g = 1;
      if (t >= a && t <= b) g = 0;
      else if (t < a && t > a - ramp) g = 0.5 * (1 - Math.cos(Math.PI * (a - t) / ramp));
      else if (t > b && t < b + ramp) g = 0.5 * (1 - Math.cos(Math.PI * (t - b) / ramp));
      restGain = Math.min(restGain, g);
    }
    // Inhale/exhale asymmetry: a skewed cycle.
    const c = Math.sin(phase) + 0.25 * Math.sin(2 * phase);
    let v = 0.5 * amp * c * restGain;
    for (const p of preps) v += amp * prepShape(t - p.at, p.beatS, p.depth);
    v += 0.3 * amp * Math.sin(2 * Math.PI * t / 60); // posture drift
    const talkNow = inAny(t, talks);
    const sway = inAny(t, sways);
    v += noise * amp * gaussian(rng) * (talkNow ? 6 : 1) + (sway ? 0.8 * amp * Math.sin(2 * Math.PI * t * 0.7) : 0);
    const covered = inAny(t, covers);
    const stable = t >= warm && !covered && !sway;
    const ts = us(SYNTH_EPOCH_US + Math.round(t * 1e6));
    if (!covered) chest.push({ t: ts, value: pol * v, stable });

    if (o.withHead !== false && !covered) {
      let deg = 0.4 * gaussian(rng);
      for (const l of lifts) {
        const d = t - l.at;
        const drop = l.dropAfterS ?? l.holdS;
        if (d >= 0 && d < 0.2) deg += l.deg * (d / 0.2);
        else if (d >= 0.2 && d < drop) deg += l.deg;
        else if (d >= drop && d < drop + 0.25) deg += l.deg * (1 - (d - drop) / 0.25) - 6 * Math.sin(Math.PI * (d - drop) / 0.25);
      }
      const e = 160; // outer-eye distance in px
      const base = 0.62; // nose below eye line / eye distance
      const ratio = base - 0.38 * Math.sin((deg * Math.PI) / 180);
      const cx = W / 2, cy = H * 0.38;
      head.push({
        t: ts, stable: true, reset: false,
        eyeR: { x: cx - e / 2, y: cy }, eyeL: { x: cx + e / 2, y: cy },
        nose: { x: cx + 0.5 * gaussian(rng), y: cy + ratio * e },
      });
    }
    talking.push({ t: ts, detected: talkNow });
  }

  // Packetise: every packetMs, a metrics event carrying the samples produced
  // since the last packet; receipt = newest sample time + delivery delay.
  const packetMs = o.packetMs ?? 100;
  const events: SenseEvent[] = [];
  const perPacket = Math.max(1, Math.round((packetMs / 1000) * fs));
  let ci = 0, hi = 0, ti = 0;
  let lastRecv = 0;
  for (let i = perPacket; i <= n; i += perPacket) {
    const until = SYNTH_EPOCH_US + Math.round((i / fs) * 1e6);
    const cs: TraceSample[] = [];
    while (ci < chest.length && chest[ci]!.t < until) cs.push(chest[ci++]!);
    const hs: HeadPoints[] = [];
    while (hi < head.length && head[hi]!.t < until) hs.push(head[hi++]!);
    const tk: { t: Microseconds; detected: boolean }[] = [];
    while (ti < talking.length && talking[ti]!.t < until) tk.push(talking[ti++]!);
    const tSec = i / fs;
    if (cs.length === 0 && hs.length === 0) continue;
    const conf = Math.min(80, Math.max(0, (tSec / warm) * 50));
    const frame: SenseFrame = {
      tsUs: us(until),
      chest: cs, abdomen: [],
      rate: [{ t: us(until), value: restRate, confidence: conf, stable: cs.every((s) => s.stable) && cs.length > 0 }],
      head: hs,
      talking: tk.filter((_, j) => j % 3 === 0),
      landmarkCount: hs.length ? 478 : 0,
    };
    const recv = Math.max(lastRecv + 1, until + Math.round(lognormalDelayMs(rng) * 1000));
    lastRecv = recv;
    events.push({ kind: 'metrics', recvUs: us(recv), frame });
  }

  // Validation events: OK at start, NoFaceFound while covered, ExcessiveMotion while swaying.
  events.push({ kind: 'validation', recvUs: us(SYNTH_EPOCH_US + 200_000), tsUs: us(SYNTH_EPOCH_US), code: 0, hint: '' });
  for (const c of covers) {
    const a = SYNTH_EPOCH_US + c.at * 1e6;
    events.push({ kind: 'validation', recvUs: us(a + 150_000), tsUs: us(a), code: 1, hint: 'No face found. Make sure your face is in view.' });
    events.push({ kind: 'validation', recvUs: us(a + (c.durS * 1e6) + 150_000), tsUs: us(a + c.durS * 1e6), code: 0, hint: '' });
  }
  for (const c of sways) {
    const a = SYNTH_EPOCH_US + c.at * 1e6;
    events.push({ kind: 'validation', recvUs: us(a + 150_000), tsUs: us(a), code: 12, hint: 'Too much motion. Please hold still.' });
    events.push({ kind: 'validation', recvUs: us(a + (c.durS * 1e6) + 150_000), tsUs: us(a + c.durS * 1e6), code: 0, hint: '' });
  }
  for (const k of script.filter((s): s is Extract<Script, { kind: 'key' }> => s.kind === 'key')) {
    events.push({ kind: 'key', recvUs: us(SYNTH_EPOCH_US + k.at * 1e6), key: k.key });
  }
  events.sort((a, b) => a.recvUs - b.recvUs);
  return {
    events, chest, head,
    truth: preps.map((p) => ({ at: us(SYNTH_EPOCH_US + p.at * 1e6), beatS: p.beatS, depth: p.depth })),
  };
}

export function synthHeader(description: string, extra: Partial<ReplayHeader> = {}): ReplayHeader {
  return {
    kind: 'header', format: 'upbeat-replay', version: 1,
    createdAt: new Date(SYNTH_EPOCH_US / 1000).toISOString(),
    synthetic: true, description, frameSize: { w: 1280, h: 720 }, ...extra,
  };
}

/** The calibration session: 20 s rest then 9 prep breaths at 60/90/120. */
export function calibrationScript(startS: number): { script: Script[]; trialStarts: { at: number; bpm: number }[] } {
  const tempi = [60, 60, 60, 90, 90, 90, 120, 120, 120];
  const script: Script[] = [];
  const trialStarts: { at: number; bpm: number }[] = [];
  let t = startS;
  const rng = mulberry32(99);
  for (const bpm of tempi) {
    const beat = 60 / bpm;
    trialStarts.push({ at: t, bpm });
    // Inhale begins on beat 4 with human timing jitter (±40 ms) and depth.
    const jitter = (rng() - 0.5) * 0.08;
    script.push({ kind: 'prep', at: t + 3 * beat + jitter, beatS: beat * (1 + (rng() - 0.5) * 0.1), depth: 2.0 + rng() * 0.6 });
    t += 4 * beat + 5;
  }
  return { script, trialStarts };
}
