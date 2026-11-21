// Deterministic stepping. Replay (in the app and in tests) processes each
// recorded event at its own receipt time and each engine deadline (commit,
// count-in click) at its own time, in time order. Wall-clock timer jitter
// therefore cannot change the outcome.

import type { EngineEvent } from '../engine/cue/cueEngine';
import type { Microseconds } from '../engine/timing/units';
import type { Pipeline } from './pipeline';
import type { ReplayCursor } from './replay';
import type { SenseEvent } from './types';

export interface StepHandler {
  /** Called for every engine event with the (simulated) time it occurred. */
  onEngine(events: EngineEvent[], at: Microseconds): void;
  /** Called for every sense event after the pipeline handled it. */
  onSense?(e: SenseEvent): void;
  /** Target tempo for metronome key presses in a recording. */
  metronomeBpm(): number;
}

export function processEvent(p: Pipeline, e: SenseEvent, h: StepHandler): void {
  const at = e.recvUs;
  const evs = e.kind === 'key' && e.key === 'metronome'
    ? p.metronome(at, h.metronomeBpm())
    : p.handle(e, at);
  h.onSense?.(e);
  if (evs.length) h.onEngine(evs, at);
}

/** Advance a replay cursor to `now`, interleaving engine deadlines. */
export function stepReplay(p: Pipeline, cur: ReplayCursor, now: Microseconds, h: StepHandler): void {
  for (;;) {
    const te = cur.peekTime();
    const td = p.engine.nextDeadline();
    const nextE = te !== null && te <= now ? te : null;
    const nextD = td !== null && td <= now ? td : null;
    if (nextE === null && nextD === null) break;
    if (nextD !== null && (nextE === null || nextD <= nextE)) {
      const evs = p.tick(nextD);
      if (evs.length) h.onEngine(evs, nextD);
      // A deadline that did not advance (should not happen) must not spin.
      if (p.engine.nextDeadline() === td) break;
      continue;
    }
    processEvent(p, cur.next()!, h);
  }
}

/** Run a whole recording headlessly (tests, analysis scripts). */
export function runHeadless(p: Pipeline, events: readonly SenseEvent[], h: StepHandler, tailUs = 8_000_000): void {
  for (const e of events) {
    for (;;) {
      const td = p.engine.nextDeadline();
      if (td === null || td > e.recvUs) break;
      const evs = p.tick(td);
      if (evs.length) h.onEngine(evs, td);
      if (p.engine.nextDeadline() === td) break;
    }
    processEvent(p, e, h);
  }
  const last = events[events.length - 1]?.recvUs ?? 0;
  for (let t = last + 50_000; t <= last + tailUs; t += 50_000) {
    const evs = p.tick(t as Microseconds);
    if (evs.length) h.onEngine(evs, t as Microseconds);
  }
}
