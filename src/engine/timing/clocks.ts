// Three clocks, one mapping.
//
//  SDK clock    epoch microseconds. The Electron renderer helper anchors each
//               VideoFrame timestamp to Date.now() at the first frame
//               (node-sdk js/renderer/timestamp.js), so SDK timestamps are
//               capture times expressed in the wall clock.
//  UI clock     performance.now() milliseconds (monotonic).
//  Audio clock  AudioContext.currentTime seconds (sample-accurate).
//
// SDK → UI uses the offset between Date.now() and performance.now(),
// re-measured and smoothed so NTP slews cannot jump it. UI → audio uses
// AudioContext.getOutputTimestamp(), which pairs a context time with the
// performance time at which that sample reaches the speakers, so output
// latency is included.

import {
  ms,
  sec,
  us,
  type Microseconds,
  type Milliseconds,
  type Seconds,
} from './units';

export interface ClockSources {
  /** performance.now() */
  perfNow(): number;
  /** Date.now() */
  dateNow(): number;
}

export interface AudioStamp {
  /** AudioContext time (s) of the sample being output... */
  readonly contextTime: number;
  /** ...at this performance.now() time (ms). */
  readonly performanceTime: number;
}

export class ClockMap {
  private epochOffsetMs: number;
  private audio: AudioStamp | null = null;

  /**
   * @param src time sources (injectable for tests and replay)
   * @param biasMs constant correction added to SDK timestamps before
   *   mapping (e.g. a measured capture-anchor bias); 0 by default.
   */
  constructor(
    private readonly src: ClockSources,
    private readonly biasMs = 0,
  ) {
    this.epochOffsetMs = src.dateNow() - src.perfNow();
  }

  /** Re-measure the wall/monotonic offset, smoothed (α = 0.1). Call ~1 Hz. */
  refreshEpochOffset(): void {
    const fresh = this.src.dateNow() - this.src.perfNow();
    // Ignore implausible jumps (> 1 s) entirely; they are clock steps.
    if (Math.abs(fresh - this.epochOffsetMs) > 1000) return;
    this.epochOffsetMs += 0.1 * (fresh - this.epochOffsetMs);
  }

  /** Feed the latest AudioContext.getOutputTimestamp() result. */
  setAudioStamp(stamp: AudioStamp): void {
    if (stamp.performanceTime > 0) this.audio = stamp;
  }

  hasAudio(): boolean {
    return this.audio !== null;
  }

  nowPerf(): Milliseconds {
    return ms(this.src.perfNow());
  }

  /** Current time in the SDK domain. */
  nowUs(): Microseconds {
    return us((this.src.perfNow() + this.epochOffsetMs) * 1000);
  }

  sdkToPerf(t: Microseconds): Milliseconds {
    return ms(t / 1000 - this.epochOffsetMs + this.biasMs);
  }

  perfToSdk(p: Milliseconds): Microseconds {
    return us((p + this.epochOffsetMs - this.biasMs) * 1000);
  }

  perfToAudio(p: Milliseconds): Seconds {
    if (!this.audio) throw new Error('ClockMap: no audio timestamp yet');
    return sec(this.audio.contextTime + (p - this.audio.performanceTime) / 1000);
  }

  audioToPerf(a: Seconds): Milliseconds {
    if (!this.audio) throw new Error('ClockMap: no audio timestamp yet');
    return ms(this.audio.performanceTime + (a - this.audio.contextTime) * 1000);
  }

  sdkToAudio(t: Microseconds): Seconds {
    return this.perfToAudio(this.sdkToPerf(t));
  }

  audioToSdk(a: Seconds): Microseconds {
    return this.perfToSdk(this.audioToPerf(a));
  }
}
