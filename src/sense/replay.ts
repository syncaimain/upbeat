// Replay of a numbers-only recording. Events are re-timed so the recording
// appears to happen now: every receipt time and SDK timestamp is shifted by
// the same amount, preserving the recorded delivery delays exactly.

import { us, type Microseconds } from '../engine/timing/units';
import type { HeadPoints, RateSample, TalkingSample, TraceSample } from '../engine/types';
import type { ReplayHeader, SenseEvent, SenseFrame } from './types';

type Tuple = number[];

export interface ParsedRecording {
  readonly header: ReplayHeader;
  readonly events: readonly SenseEvent[];
  readonly durationUs: number;
}

export function parseRecording(text: string): ParsedRecording {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error('empty recording');
  const header = JSON.parse(lines[0]!) as ReplayHeader;
  if (header.kind !== 'header' || header.format !== 'upbeat-replay') {
    throw new Error('not an Upbeat recording');
  }
  const events: SenseEvent[] = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = JSON.parse(lines[i]!) as Record<string, unknown>;
    events.push(expand(raw));
  }
  const first = events[0]?.recvUs ?? 0;
  const last = events[events.length - 1]?.recvUs ?? 0;
  return { header, events, durationUs: last - first };
}

function expand(raw: Record<string, unknown>): SenseEvent {
  if (raw.kind !== 'metrics') return raw as unknown as SenseEvent;
  const f = raw.frame as Record<string, unknown>;
  const T = (a: unknown) => (a as Tuple[] | undefined) ?? [];
  const trace = (a: unknown): TraceSample[] =>
    T(a).map(([t, v, s]) => ({ t: us(t!), value: v!, stable: s === 1 }));
  const frame: SenseFrame = {
    tsUs: us(f.tsUs as number),
    landmarkCount: (f.landmarkCount as number) ?? 0,
    chest: trace(f.chest),
    abdomen: trace(f.abdomen),
    rate: T(f.rate).map(([t, v, c, s]): RateSample => ({ t: us(t!), value: v!, confidence: c!, stable: s === 1 })),
    talking: T(f.talking).map(([t, d]): TalkingSample => ({ t: us(t!), detected: d === 1 })),
    head: T(f.head).map(([t, nx, ny, rx, ry, lx, ly, s, r]): HeadPoints => ({
      t: us(t!), nose: { x: nx!, y: ny! }, eyeR: { x: rx!, y: ry! }, eyeL: { x: lx!, y: ly! },
      stable: s === 1, reset: r === 1,
    })),
  };
  return { kind: 'metrics', recvUs: us(raw.recvUs as number), frame };
}

/** Shift every time in an event by `d` µs. */
export function shiftEvent(e: SenseEvent, d: number): SenseEvent {
  const S = (t: number): Microseconds => us(t + d);
  switch (e.kind) {
    case 'metrics': {
      const f = e.frame;
      return {
        kind: 'metrics', recvUs: S(e.recvUs),
        frame: {
          ...f,
          tsUs: S(f.tsUs),
          chest: f.chest.map((s) => ({ ...s, t: S(s.t) })),
          abdomen: f.abdomen.map((s) => ({ ...s, t: S(s.t) })),
          rate: f.rate.map((s) => ({ ...s, t: S(s.t) })),
          talking: f.talking.map((s) => ({ ...s, t: S(s.t) })),
          head: f.head.map((h) => ({ ...h, t: S(h.t) })),
        },
      };
    }
    case 'validation':
      return { ...e, recvUs: S(e.recvUs), tsUs: S(e.tsUs) };
    default:
      return { ...e, recvUs: S(e.recvUs) };
  }
}

/**
 * Pull-based replay cursor: `due(now)` returns every event whose (shifted)
 * receipt time has arrived, in order. Driving it from one clock keeps replay
 * deterministic: the same events are delivered in the same order relative to
 * the engine's own deadlines.
 */
export class ReplayCursor {
  private i = 0;
  private readonly shift: number;

  constructor(private readonly rec: ParsedRecording, startAt: Microseconds) {
    const first = rec.events[0]?.recvUs ?? 0;
    this.shift = startAt - first;
  }

  get done(): boolean {
    return this.i >= this.rec.events.length;
  }

  get progress(): number {
    return this.rec.events.length ? this.i / this.rec.events.length : 1;
  }

  /** Receipt time (shifted) of the next event, or null when finished. */
  peekTime(): Microseconds | null {
    const e = this.rec.events[this.i];
    return e ? us(e.recvUs + this.shift) : null;
  }

  next(): SenseEvent | null {
    const e = this.rec.events[this.i];
    if (!e) return null;
    this.i++;
    return shiftEvent(e, this.shift);
  }

  due(now: Microseconds): SenseEvent[] {
    const out: SenseEvent[] = [];
    for (;;) {
      const t = this.peekTime();
      if (t === null || t > now) break;
      out.push(this.next()!);
    }
    return out;
  }
}
