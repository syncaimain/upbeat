# SmartSpectra SDK notes

Verified against the installed `@smartspectra/node-sdk` **3.5.0** (its `js/index.d.ts`, `js/renderer/index.d.ts`, `js/main/index.d.ts`, `js/messages/index.d.ts`, the generated message typings, its README and `docs/device-readiness.md`) on 20 Nov 2026. Where the package differs from the plan, Upbeat follows the package. The integration lives in one file: [`src/sense/sdk.ts`](../src/sense/sdk.ts); readiness and the IPC binding are in [`electron/main.ts`](../electron/main.ts).

The official Presage agent skill (Claude Code plugin) was **not** installed; everything below comes from the package itself.

## What Upbeat uses

| Piece | Entry point | Used as |
|---|---|---|
| Main-process bridge | `bindSmartSpectraIpc(window, { logger })` from `@smartspectra/node-sdk/main` | Called once for the window; loaded lazily so an unsupported platform still opens the app (metronome and replay keep working) |
| Preload bridge | `@smartspectra/node-sdk/preload` | Imported at the top of `electron/preload.ts`; bundled into the sandboxed preload by electron-vite |
| Renderer SDK | `SmartSpectraSDK` from `@smartspectra/node-sdk/renderer` | `useMediaStream(stream)` with our own `getUserMedia` stream (1280×720, 30 fps, `audio: false`), then `start()` |
| Decoding | `decodeMetrics(buf)` from `@smartspectra/node-sdk/messages` | Converted to plain numbers in `src/sense/decode.ts` |
| Readiness | `SmartSpectraSDK.checkDeviceReadiness()` from `@smartspectra/node-sdk` (main process) | IPC `readiness:check`; verdict compared explicitly |
| Options | `{ apiKey, requestedMetrics: [...breathingMetrics, MetricType.FACE_LANDMARKS, MetricType.TALKING], enableTelemetry: false, enableAccumulatedOutput: false, sendTimeoutMs: 15000 }` | Built in `sdkOptions()`; a unit test asserts telemetry off and the metric list `[0, 1, 2, 11, 13]` |
| Events | `metrics(buf, tsUs)`, `validationStatus(code, tsUs, hint)`, `error(code, message, retryable)`, `processingStatus(status)` | All normalised into `SenseEvent`s |

Never used: `requestInsight` (a test scans the source for calls), `cardioMetrics`, `BLINKING`, `EXPRESSIONS`, the microphone.

## Differences from the plan

1. **Decoded field names are camelCase.** The plan says `breathing.{rate, upper_trace, lower_trace}`; the decoded protobuf message has `breathing.rate`, `breathing.upperTrace` (chest), `breathing.lowerTrace` (abdomen), `face.landmarks[].value` (an array of `{x, y}`), `face.talking[]` (`{detected, stable, timestamp}`). Timestamps are typed `number | Long`; the decoder handles both.
2. **Readiness is main-process only, and needs a native camera.** The renderer `SmartSpectraSDK` has no `checkDeviceReadiness()`. The main-process SDK has it, but only after `useCamera(...)` (file and custom-frame inputs return `inconclusive`). Upbeat creates a short-lived main-process SDK with the same options and telemetry off, `useCamera(CameraSelection.default, {1280, 720, 30})`, checks, then `destroy()`s it **before** the renderer opens its camera. SDK state is process-global, so the two never overlap.
3. **Renderer shutdown is `stop()` + `destroy()`.** The renderer class has `stop(): Promise<void>` (the main process runs `stopAsync()` for it) and a synchronous `destroy(): void`. There is no renderer `stopAsync`. Because Upbeat supplies the stream, Upbeat owns its tracks: Stop stops the camera tracks first (the camera light goes off at once), then awaits `stop()` (raced against 900 ms), then `destroy()`.
4. **The renderer needs the API key in its constructor.** It forwards the options, key included, to the main process over the SDK's private MessagePort. Upbeat keeps the key in the main process (encrypted with `safeStorage`). It hands the key to the renderer over IPC only for that constructor call, holds it in a local variable it nulls straight after, and never writes it to `localStorage`, settings or logs.
5. **Five breathing metrics are "unavailable", not three.** `BREATHING_AMPLITUDE`, `APNEA`, `RESPIRATORY_LINE_LENGTH`, `BASELINE` and `INHALE_EXHALE_RATIO` all make `start()` throw `kConfigurationFailed`. None is requested; inhale features are computed from the traces.
6. **`SmartSpectraLogLevel` is exported at runtime by the renderer entry but not declared in its typings.** Upbeat leaves `logLevel` at its default (`kWarning`) instead of relying on an undeclared export.
7. **Timestamps are wall-clock epoch microseconds.** The Electron renderer anchors each `VideoFrame.timestamp` to `Date.now()` at the first frame, then forces it to keep increasing (`js/renderer/timestamp.js`). SDK timestamps are therefore capture times in the wall clock, which is what lets [docs/TIMING.md](TIMING.md) map them to `performance.now()` and the audio clock.
8. **Validation and error codes** (from `index.d.ts`): `kMultipleFacesFound = 2`, `kChestNotVisible = 7`, `kExcessiveMotion = 12`. New ones: `kFaceTooClose/Far/High/Low (13–16)` and `kFaceNotForward (17)`. There is also `kMetricNotAuthorized = 13` and `kSustainedLowFrameRate = 14`. For `kSustainedLowFrameRate` the docs say: offer a user-initiated fresh start, do not restart automatically. Upbeat follows that and drops capture to 960×540 for the next start.
9. **`sendTimeoutMs`** (renderer only) makes control calls reject with `SMARTSPECTRA_IPC_TIMEOUT` instead of hanging; Upbeat sets 15 s.
10. **Install size.** `npm install` pulls the native runtime for every platform (≈ 344 MB under `node_modules/@smartspectra`), as the README warns.

## Electron requirements followed

- CSP allows `worker-src 'self' blob:` (the renderer helper runs a blob worker) — see `src/index.html`.
- Camera permission is granted only for `media` requests that ask for **video only**, and only from Upbeat's own origin (`app://upbeat` or the dev server). Audio permission checks always fail.
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; navigation and new windows are blocked.
- macOS (not built on this machine): add `NSCameraUsageDescription` and the `com.apple.security.cs.disable-library-validation` entitlement, and ship `node_modules/@smartspectra/node-sdk-darwin-arm64/` as an extra resource (see the SDK README's electron-builder snippet).

## Still to verify on a live session (Stage 1)

Everything here can be checked from the Stage 1 probe (`npx electron . --probe` after a build).

- [ ] Chest-trace sample rate and samples per packet. Do packets overlap? The pipeline de-duplicates by timestamp, so either is safe.
- [ ] Delivery delay median and p95 (receipt − SDK timestamp).
- [ ] Landmark count per set and coordinate space. The decoder handles both normalised 0..1 and pixel coordinates.
- [ ] Whether indices **1, 33, 263** are the nose tip and outer eye corners. The probe draws them in gold.
- [ ] Which way an inhale moves `upperTrace`. Calibration detects it either way and stores `polarity`.
- [ ] When `breathing.rate[].stable` first becomes true. The docs say about 30 s.
- [ ] `checkDeviceReadiness()` verdict on the target machines.
