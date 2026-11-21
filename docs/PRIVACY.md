# Privacy, consent and data handling

Upbeat watches only your breathing motion and head position through the camera, to cue a virtual ensemble. It never uses the microphone. It saves only numbers (your tempo profile and drill scores), and you can delete them. SmartSpectra runs locally and checks its licence online; telemetry is off.

Upbeat is a music practice tool. It reports musical timing ("your breath set ♩ = 84") and never makes claims about breathing health, lung function, relaxation or stress.

## Consent

- Before any camera access, a consent note explains what is measured: the breathing motion of the chest (and belly if in view), head position, and whether you are talking.
- It also explains what is not measured: no identity, emotions or health; no microphone; no video saved. It says the SDK checks its licence online and how to stop (Esc).
- **I agree** opens Setup. **Leave** opens metronome-only mode, which never touches the camera.
- The camera is never requested before consent. The e2e test checks that the camera is still off on the consent screen.

## When the camera is on

| Screen | Camera |
|---|---|
| Welcome, Consent, Results, Timing check (outside a session) | off |
| Setup (after "Check the hall"), Warm-up, Calibration, Practice, Drills | on, shown by a brass dot labelled "camera on" in the top-right corner |

The camera mirror is hidden by default after setup; turn it on in Settings.

## Stopping

Esc (from anywhere), the Stop button, closing the window and quitting all run the same path:

1. Stop the camera tracks (the camera light goes off at once).
2. `sdk.stop()` (the main process runs `stopAsync()`), raced against 900 ms.
3. `sdk.destroy()`.
4. Release the ensemble (release time ≤ 0.8 s) and the tuning hum.

On close or quit the main process asks the renderer to do this and waits for it, for at most 1.2 s. The SDK's own IPC binding also tears its session down when the window closes.

## What is stored, and where

All files are in Electron's user-data folder:

- Windows: `%APPDATA%\upbeat`
- macOS: `~/Library/Application Support/upbeat`
- Linux: `~/.config/upbeat`

The Privacy curtain shows the exact path.

| File | Contents | Kept until |
|---|---|---|
| `settings.json` | Ensemble, voicing, volume, target tempo, Ready gesture, camera choice, motion, mirror, consent given, plates seen | You change it |
| `profile.json` | Calibration numbers: resting amplitude, polarity, tempo constant *k*, fit error, head-pitch baseline ratio | Deleted from Privacy |
| `history.json` | Drill summaries: targets, tempi set and measured, entry quality, mean/spread of tempo error (max 200) | Deleted from Privacy |
| `key.bin` | Your API key, encrypted by the OS (`safeStorage`: DPAPI / Keychain / libsecret). Without an OS keychain it is kept in memory for the session only, never in plain text | "Forget API key" |
| `recordings/*.jsonl` | Only when you press **Record numbers**: decoded numbers (trace samples, three face points, talking flags, validation codes, your R/Space presses) | Per-recording delete, or "also delete recordings" |
| `probe/*.jsonl` | Only in the Stage 1 probe (`--probe`), when you press "Log decoded metrics" | Deleted with profile/history |

Never stored: video frames, images, audio, the full face mesh (only three landmark points are kept, and only in recordings).

## Deletion

Privacy curtain → **Delete my profile and history**, optionally with **Also delete recordings**. The e2e test checks the files are gone. **Forget API key** removes `key.bin`.

## Network

- SmartSpectra authenticates the key and accounts usage online when a measurement or readiness check starts; there is no offline mode. Video is processed on this computer.
- Telemetry: `enableTelemetry: false` on every SDK instance (the renderer session and the readiness check). A unit test checks each construction.
- Fonts, samples and the demo replay are bundled; Upbeat makes no other requests.
- No AI services.

## The API key

- It is pasted in Setup and sent to the main process, which encrypts it with `safeStorage`.
- `.env` (`SMARTSPECTRA_API_KEY`) is read in development only and is git-ignored.
- The renderer receives the key only to construct the SmartSpectra renderer helper, which requires it (see [SDK-NOTES.md](SDK-NOTES.md) item 4). It is never put in renderer storage or settings; a unit test checks the renderer code never uses web storage.
- Main-process log lines pass through `redact()`, which removes the key and anything shaped like `apiKey: …` (unit-tested). Info logs are off unless `UPBEAT_DEBUG=1`, and record event names and timings only.

## Draft disclosure for the DEV post

> Upbeat watches only your breathing motion and head position through the camera to cue a virtual ensemble. It never uses the microphone and saves only numbers (your tempo profile and drill scores), which you can delete. SmartSpectra runs locally, checks its licence online, and telemetry is off.
