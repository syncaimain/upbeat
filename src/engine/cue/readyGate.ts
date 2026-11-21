// Ready gate: the ensemble listens for a cue only after a deliberate
// "ready" — a chin lift held ≥ 6° for 300 ms, or the R key. It disarms after
// 6 s without a cue, or immediately when the user talks.

import { CUE } from '../../../config/cue';
import type { Microseconds } from '../timing/units';
import type { PitchSample } from '../types';

export type ReadyState = 'idle' | 'armed';
export type ArmSource = 'gesture' | 'key';
export type DisarmReason = 'timeout' | 'talking' | 'cued' | 'paused' | 'stopped';

export type ReadyEvent =
  | { type: 'armed'; at: Microseconds; source: ArmSource }
  | { type: 'disarmed'; at: Microseconds; reason: DisarmReason }
  /** Gesture-armed, then the head dropped again without any inhale: the
   *  ensemble saw a nod and guesses the entry. */
  | { type: 'nod'; at: Microseconds };

export class ReadyGate {
  private state: ReadyState = 'idle';
  private armedAt: Microseconds | null = null;
  private source: ArmSource | null = null;
  private liftSince: Microseconds | null = null;
  /** After a disarm the head must come down before a lift can re-arm. */
  private needsLower = false;
  private lastTalkAt = -Infinity;
  private peakPitchSinceArm = -Infinity;
  private onsetSeen = false;

  constructor(private readonly gestureEnabled = true) {}

  get current(): ReadyState {
    return this.state;
  }

  get armSource(): ArmSource | null {
    return this.source;
  }

  /** True while talking blocks cues. */
  talkingBlocked(now: Microseconds): boolean {
    return now - this.lastTalkAt <= CUE.TALKING_BLOCK_MS * 1000;
  }

  armByKey(now: Microseconds): ReadyEvent[] {
    if (this.talkingBlocked(now)) return [];
    if (this.state === 'armed') {
      // Pressing R again refreshes the timeout.
      this.armedAt = now;
      return [];
    }
    return this.arm(now, 'key');
  }

  /** The cue engine saw an inhale onset while armed (suppresses 'nod'). */
  noteOnset(): void {
    this.onsetSeen = true;
  }

  /** Disarm because an entry was cued, the scene paused, or Stop. */
  disarm(now: Microseconds, reason: DisarmReason): ReadyEvent[] {
    if (this.state !== 'armed') return [];
    this.state = 'idle';
    this.armedAt = null;
    this.source = null;
    this.liftSince = null;
    this.needsLower = true;
    return [{ type: 'disarmed', at: now, reason }];
  }

  pushTalking(t: Microseconds, detected: boolean): ReadyEvent[] {
    if (!detected) return [];
    this.lastTalkAt = Math.max(this.lastTalkAt, t);
    return this.disarm(t, 'talking');
  }

  pushPitch(p: PitchSample): ReadyEvent[] {
    const out: ReadyEvent[] = [];
    if (p.deg < CUE.READY_REARM_BELOW_DEG) this.needsLower = false;

    if (this.state === 'idle') {
      if (!this.gestureEnabled || this.needsLower || this.talkingBlocked(p.t)) {
        this.liftSince = null;
        return out;
      }
      if (p.deg >= CUE.READY_PITCH_DEG) {
        if (this.liftSince === null) this.liftSince = p.t;
        if (p.t - this.liftSince >= CUE.READY_HOLD_MS * 1000) {
          out.push(...this.arm(p.t, 'gesture'));
          this.peakPitchSinceArm = p.deg;
        }
      } else {
        this.liftSince = null;
      }
      return out;
    }

    // Armed.
    this.peakPitchSinceArm = Math.max(this.peakPitchSinceArm, p.deg);
    if (
      this.source === 'gesture' &&
      !this.onsetSeen &&
      this.peakPitchSinceArm - p.deg >= CUE.NOD_DROP_DEG
    ) {
      out.push({ type: 'nod', at: p.t });
      out.push(...this.disarm(p.t, 'cued'));
    }
    return out;
  }

  /** Advance time: handles the 6 s timeout. */
  tick(now: Microseconds): ReadyEvent[] {
    if (this.state === 'armed' && this.armedAt !== null &&
      now - this.armedAt >= CUE.READY_TIMEOUT_MS * 1000) {
      return this.disarm(now, 'timeout');
    }
    return [];
  }

  private arm(now: Microseconds, source: ArmSource): ReadyEvent[] {
    this.state = 'armed';
    this.armedAt = now;
    this.source = source;
    this.onsetSeen = false;
    this.peakPitchSinceArm = -Infinity;
    return [{ type: 'armed', at: now, source }];
  }
}
