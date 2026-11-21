// Normalised sense events shared by the live SDK client, the recorder and
// the replay source. Numbers (and the SDK's own short hint strings) only.

import type {
  HeadPoints,
  RateSample,
  TalkingSample,
  TraceSample,
} from '../engine/types';
import type { CalibrationProfile } from '../engine/types';
import type { Microseconds } from '../engine/timing/units';

export interface SenseFrame {
  /** Packet timestamp from the 'metrics' event. */
  readonly tsUs: Microseconds;
  readonly chest: readonly TraceSample[];
  readonly abdomen: readonly TraceSample[];
  readonly rate: readonly RateSample[];
  readonly head: readonly HeadPoints[];
  readonly talking: readonly TalkingSample[];
  /** Number of landmarks in the newest set (for layout verification). */
  readonly landmarkCount: number;
  /** Full newest landmark set — only in the Stage 1 probe, never recorded. */
  readonly allLandmarks?: readonly { x: number; y: number }[];
}

export type InputKey = 'ready' | 'metronome';

export type SenseEvent =
  | { readonly kind: 'metrics'; readonly recvUs: Microseconds; readonly frame: SenseFrame }
  | { readonly kind: 'validation'; readonly recvUs: Microseconds; readonly tsUs: Microseconds; readonly code: number; readonly hint: string }
  | { readonly kind: 'error'; readonly recvUs: Microseconds; readonly code: number; readonly message: string; readonly retryable: boolean }
  | { readonly kind: 'status'; readonly recvUs: Microseconds; readonly status: number }
  /** User inputs are recorded so a replay reproduces the same cues. */
  | { readonly kind: 'key'; readonly recvUs: Microseconds; readonly key: InputKey };

export interface ReplayHeader {
  readonly kind: 'header';
  readonly format: 'upbeat-replay';
  readonly version: 1;
  readonly createdAt: string;
  /** true for generated demo data; false for a real recorded session. */
  readonly synthetic: boolean;
  readonly description: string;
  readonly frameSize: { readonly w: number; readonly h: number };
  readonly profile?: CalibrationProfile;
  readonly targetBpm?: number;
  readonly ensemble?: 'choir' | 'quartet';
}
