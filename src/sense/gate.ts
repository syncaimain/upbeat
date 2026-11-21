// Quality gate. Decides whether breath data may cue an entry right now.
//
//  • Breathing must be `stable` (SDK confidence ≥ 45; traces inherit it).
//    The SDK needs ~30 s to fill its window, which the app turns into the
//    warm-up "tuning".
//  • Any non-OK validation status blocks cues immediately (large motion gives
//    confident wrong readings). The scene visibly pauses only after the
//    status has persisted 1 s, so brief flickers don't flash the UI;
//    MULTIPLE_FACES_FOUND pauses at once.
//  • Resuming needs 1 s of OK frames.
//  • No new trace sample for 1.5 s → stale → blocked (camera covered, lag).

import { CUE } from '../../config/cue';
import type { Microseconds } from '../engine/timing/units';

/** ValidationCode values from @smartspectra/node-sdk 3.5.0 (index.d.ts). */
export const VC = {
  kOk: 0,
  kNoFaceFound: 1,
  kMultipleFacesFound: 2,
  kFaceNotCentered: 3,
  kFaceSizeOutOfRange: 4,
  kTooDark: 5,
  kTooBright: 6,
  kChestNotVisible: 7,
  kCameraTuning: 10,
  kFrameRateTooLow: 11,
  kExcessiveMotion: 12,
  kFaceTooClose: 13,
  kFaceTooFar: 14,
  kFaceTooHigh: 15,
  kFaceTooLow: 16,
  kFaceNotForward: 17,
} as const;

export type GateState =
  /** No stable breathing yet (warm-up). */
  | 'warming'
  /** Data usable; cues allowed. */
  | 'ok'
  /** Something is wrong: cues blocked, but not long enough to pause. */
  | 'blocked'
  /** The scene is paused with a programme note. */
  | 'paused';

export interface GateView {
  readonly state: GateState;
  readonly cuesAllowed: boolean;
  readonly code: number;
  /** The SDK's hint, shown as-is. */
  readonly hint: string;
  readonly reason: string;
  readonly breathingStable: boolean;
  readonly chestVisible: boolean;
}

export class QualityGate {
  private code: number = VC.kOk;
  private hint = '';
  private badSince: number | null = null;
  // -Infinity: no validation event yet counts as a long OK run.
  private okSince: number | null = -Infinity;
  private paused = false;
  private breathingStable = false;
  private lastTraceAt = -Infinity;
  private everStable = false;
  /** Start of the current uninterrupted run of fresh trace data. */
  private freshSince = -Infinity;

  /** Latest validation status from the SDK. */
  pushValidation(code: number, hint: string, now: Microseconds): void {
    this.code = code;
    this.hint = hint;
    if (code === VC.kOk) {
      this.badSince = null;
      if (this.okSince === null) this.okSince = now;
    } else {
      this.okSince = null;
      if (this.badSince === null) this.badSince = now;
      if (code === VC.kMultipleFacesFound) this.paused = true;
    }
  }

  /** Latest trace sample's stable flag and timestamp. */
  pushTrace(stable: boolean, receivedAt: Microseconds): void {
    this.breathingStable = stable;
    if (stable) this.everStable = true;
    if (receivedAt - this.lastTraceAt > CUE.STALE_TRACE_MS * 1000) this.freshSince = receivedAt;
    this.lastTraceAt = receivedAt;
  }

  /** Breathing-rate stable verdict (confidence ≥ 45). */
  pushRateStable(stable: boolean): void {
    this.breathingStable = stable;
    if (stable) this.everStable = true;
  }

  reset(): void {
    this.code = VC.kOk;
    this.hint = '';
    this.badSince = null;
    this.okSince = -Infinity;
    this.paused = false;
    this.breathingStable = false;
    this.everStable = false;
    this.lastTraceAt = -Infinity;
    this.freshSince = -Infinity;
  }

  view(now: Microseconds): GateView {
    const stale = now - this.lastTraceAt > CUE.STALE_TRACE_MS * 1000;
    const bad = this.code !== VC.kOk;
    if (bad && this.badSince !== null && now - this.badSince >= CUE.PAUSE_DEBOUNCE_MS * 1000) {
      this.paused = true;
    }
    if (stale && this.everStable && now - this.lastTraceAt > (CUE.STALE_TRACE_MS + CUE.PAUSE_DEBOUNCE_MS) * 1000) {
      this.paused = true;
    }
    // Resume after 1 s of OK validation AND 1 s of fresh trace data (the SDK
    // reports validation on change only, so both runs are tracked).
    if (this.paused && !bad && !stale && this.okSince !== null &&
      now - this.okSince >= CUE.RESUME_AFTER_MS * 1000 &&
      now - this.freshSince >= CUE.RESUME_AFTER_MS * 1000) {
      this.paused = false;
    }
    const chestVisible = this.code !== VC.kChestNotVisible;
    const base = { code: this.code, hint: this.hint, breathingStable: this.breathingStable, chestVisible };
    if (this.paused) {
      return { ...base, state: 'paused', cuesAllowed: false, reason: stale && !bad ? 'breathing data stopped' : 'camera check' };
    }
    if (bad) return { ...base, state: 'blocked', cuesAllowed: false, reason: 'camera check' };
    if (stale) return { ...base, state: this.everStable ? 'blocked' : 'warming', cuesAllowed: false, reason: 'waiting for breathing data' };
    if (!this.breathingStable) {
      return { ...base, state: this.everStable ? 'blocked' : 'warming', cuesAllowed: false, reason: 'breathing not yet stable' };
    }
    return { ...base, state: 'ok', cuesAllowed: true, reason: '' };
  }
}
