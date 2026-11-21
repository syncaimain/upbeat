// ═══════════════════════════════════════════════════════════════════════
//  SmartSpectra integration (the one file that talks to the SDK).
//
//  Verified against @smartspectra/node-sdk 3.5.0 typings (js/renderer/
//  index.d.ts, js/index.d.ts, js/messages/index.d.ts); differences from the
//  plan are recorded in docs/SDK-NOTES.md.
//
//  • Renderer helper: SmartSpectraSDK from '@smartspectra/node-sdk/renderer'
//    with a host-owned MediaStream (useMediaStream) from getUserMedia at
//    1280×720 / 30 fps, video only — the microphone is never requested.
//  • requestedMetrics = breathingMetrics (CHEST_BREATHING, ABDOMEN_BREATHING,
//    BREATHING_RATE) + FACE_LANDMARKS (11) + TALKING (13). No cardio,
//    blinking or expressions; none of the unavailable breathing metrics.
//  • enableTelemetry: false. requestInsight is never called.
//  • Shutdown: stop our camera tracks (camera off at once), sdk.stop()
//    (main process runs stopAsync), sdk.destroy().
// ═══════════════════════════════════════════════════════════════════════

import {
  SmartSpectraSDK,
  MetricType,
  breathingMetrics,
} from '@smartspectra/node-sdk/renderer';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';
import type { RendererSmartSpectraOptions } from '@smartspectra/node-sdk/renderer';
import type { ClockMap } from '../engine/timing/clocks';
import { us } from '../engine/timing/units';
import { decodeFrame, type MetricsLike } from './decode';
import type { SenseEvent } from './types';

export const REQUESTED_METRICS: readonly number[] = Object.freeze([
  ...breathingMetrics,
  MetricType.FACE_LANDMARKS,
  MetricType.TALKING,
]);

/** Constructor options, built in one place so a unit test can assert them. */
export function sdkOptions(apiKey: string): RendererSmartSpectraOptions {
  return {
    apiKey,
    requestedMetrics: [...REQUESTED_METRICS],
    enableTelemetry: false,
    enableAccumulatedOutput: false,
    // logLevel left at its default (kWarning). SmartSpectraLogLevel exists at
    // runtime but is not declared by the renderer typings (see SDK-NOTES).
    sendTimeoutMs: 15_000,
  };
}

export interface CaptureSettings {
  deviceId?: string;
  width: number;
  height: number;
  fps: number;
}

export const DEFAULT_CAPTURE: CaptureSettings = { width: 1280, height: 720, fps: 30 };
/** Fallback after kSustainedLowFrameRate. */
export const LOW_CAPTURE: CaptureSettings = { width: 960, height: 540, fps: 30 };

export class NoKeyError extends Error {
  constructor() {
    super('No SmartSpectra API key');
  }
}

export class SenseClient {
  private sdk: SmartSpectraSDK | null = null;
  private stream: MediaStream | null = null;
  private frameW = 1280;
  private frameH = 720;
  private stopping: Promise<void> | null = null;
  /** Stage 1 probe: keep full landmark sets for the index drawing. */
  keepAllLandmarks = false;

  constructor(
    private readonly clock: ClockMap,
    private readonly emit: (e: SenseEvent) => void,
  ) {}

  get running(): boolean {
    return this.sdk !== null;
  }

  get mediaStream(): MediaStream | null {
    return this.stream;
  }

  /** Lists cameras (labels appear only after camera permission). */
  static async cameras(): Promise<MediaDeviceInfo[]> {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'videoinput');
  }

  /** Opens the camera only (Setup framing preview), no SDK. */
  async openPreview(c: CaptureSettings): Promise<MediaStream> {
    if (this.stream) return this.stream;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        ...(c.deviceId ? { deviceId: { exact: c.deviceId } } : {}),
        // Cap the size and rate: virtual cameras (Camo, iVCam…) often offer
        // only 1080p or 60 fps, and every frame is copied to SmartSpectra, so
        // an oversized stream starves it below 25 fps. Chromium scales the
        // camera down in the capture pipeline when it has to.
        width: { ideal: c.width, max: c.width },
        height: { ideal: c.height, max: c.height },
        frameRate: { ideal: c.fps, max: c.fps },
        resizeMode: 'crop-and-scale',
      } as MediaTrackConstraints,
    });
    // If a camera ignored the caps, scale it down explicitly.
    const track = this.stream.getVideoTracks()[0];
    const got = track?.getSettings();
    if (track && got && ((got.width ?? 0) > c.width || (got.frameRate ?? 0) > c.fps + 1)) {
      try {
        await track.applyConstraints({ width: c.width, height: c.height, frameRate: c.fps, resizeMode: 'crop-and-scale' } as MediaTrackConstraints);
      } catch { /* keep what the camera gives */ }
    }
    const s = this.stream.getVideoTracks()[0]?.getSettings();
    this.frameW = s?.width ?? c.width;
    this.frameH = s?.height ?? c.height;
    return this.stream;
  }

  async start(c: CaptureSettings): Promise<MediaStream> {
    if (this.stopping) await this.stopping;
    if (this.sdk) return this.stream!;
    const bridge = window.upbeat;
    if (!bridge) throw new Error('App bridge unavailable');
    // The key lives in this scope only for the constructor call.
    let key: string | null = await bridge.key.forSdk();
    if (!key) throw new NoKeyError();
    const stream = await this.openPreview(c);
    const sdk = new SmartSpectraSDK(sdkOptions(key));
    key = null;

    sdk.on('metrics', (buf, tsUs) => {
      const recvUs = this.clock.nowUs();
      const m = decodeMetrics(buf) as unknown as MetricsLike;
      const frame = decodeFrame(m, tsUs, { frameW: this.frameW, frameH: this.frameH, keepAll: this.keepAllLandmarks });
      this.emit({ kind: 'metrics', recvUs, frame });
    });
    sdk.on('validationStatus', (code, tsUs, hint) => {
      this.emit({ kind: 'validation', recvUs: this.clock.nowUs(), tsUs: us(tsUs), code, hint });
    });
    sdk.on('error', (code, message, retryable) => {
      this.emit({ kind: 'error', recvUs: this.clock.nowUs(), code, message, retryable });
    });
    sdk.on('processingStatus', (status) => {
      this.emit({ kind: 'status', recvUs: this.clock.nowUs(), status });
    });
    sdk.useMediaStream(stream);
    this.sdk = sdk;
    try {
      await sdk.start();
    } catch (err) {
      await this.stop();
      throw err;
    }
    return stream;
  }

  /** Camera off immediately; SDK stopped and destroyed within ~1 s. */
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const sdk = this.sdk;
    const stream = this.stream;
    this.sdk = null;
    this.stream = null;
    stream?.getTracks().forEach((t) => t.stop());
    if (!sdk) return Promise.resolve();
    this.stopping = (async () => {
      try {
        await Promise.race([sdk.stop(), new Promise((r) => setTimeout(r, 900))]);
      } catch {
        /* stopping a failed session can reject; destroy below regardless */
      } finally {
        sdk.destroy();
        this.stopping = null;
      }
    })();
    return this.stopping;
  }

  /** Stops only the preview stream (Setup → leaving the framing guide). */
  closePreview(): void {
    if (this.sdk) return;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
