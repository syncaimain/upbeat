# Timing

Musical entries are scheduled on the Web Audio clock, never on a UI timer. This page explains the clock mapping, the latency budget that decides how fast a tempo Upbeat can follow, and what has been measured so far.

**Status:** the scheduler precision is measured. Delivery delay on the real SDK is **not yet measured**: it needs a live session (Stage 1). Until then, the budget below uses the figures another entrant reported (≈105 ms median, ≈261 ms p95), marked as assumed.

## Three clocks, one mapping

| Clock | Unit | Source |
|---|---|---|
| SDK | epoch µs | `metrics` / validation timestamps. The Electron renderer helper anchors each `VideoFrame.timestamp` to `Date.now()` at the first frame and forces it to keep increasing, so these are capture times in the wall clock |
| UI | ms | `performance.now()` |
| Audio | s | `AudioContext.currentTime` |

`src/engine/timing/clocks.ts` (`ClockMap`):

- **SDK → UI**: `perf = sdkUs/1000 − (Date.now() − performance.now())`. The offset is re-measured every second and smoothed (α = 0.1), so NTP slews are tracked. Jumps over 1 s are ignored as clock steps.
- **UI → audio**: from `AudioContext.getOutputTimestamp()`, which pairs a context time with the `performance.now()` at which that sample *reaches the speakers*. Output latency is therefore inside the mapping. It is refreshed every animation frame. If the browser offers no output timestamp, `currentTime − outputLatency − baseLatency` is used.
- Times are distinct branded types (`Seconds`, `Milliseconds`, `Microseconds`), so mixing units is a compile error.

**Delivery delay is not added to entry times.** SDK timestamps are capture times, so the downbeat `t0 + b` maps directly to the audio clock. Delivery delay only eats into the *lead time* available to schedule it; that is what the budget below is about. `ClockMap` has a constant `biasMs` hook for the one unknown offset: how long the first frame took between capture and the `Date.now()` anchor. A loop-back test (camera pointed at the speaker's LED, or a clap) can measure it. Not done yet.

## Scheduling an entry

1. Onset detected: slope > 0.5 rest/s held 120 ms. t0 is the inhale start (backtracked from the crossing).
2. At crossing + 150 ms the early rise rate `r` is known: `b = k / r`, and the downbeat is `t0 + b`.
3. If the downbeat is less than **120 ms** ahead when the prediction is ready, the entry plays at once and the note says "too fast to follow".
4. **90 ms before the downbeat** the entry is committed: the breath received by then decides tight, loose or ragged, and each voice gets its offset.
5. Each voice is triggered at `audio(downbeat) + offset` with `triggerAttack(note, time)`. The envelope starts at exactly that sample.
6. Singer columns light at each voice's own audio time (converted back to UI time), so a ragged entry is *seen* staggered.

Count-in clicks (metronome mode, calibration) go through the same path.

## Latency budget: how fast can a breath be followed?

When does the prediction exist, in SDK time, relative to the inhale start t0?

| Step | Time | Note |
|---|---|---|
| Crossing after true start | ≈ 35–100 ms | Slope is a 100 ms trailing least-squares fit; synthetic tests: t0 one sample (33 ms) late after backtracking |
| Rise window | +150 ms | `PREDICT_AFTER_MS` |
| Median filter | +2 samples ≈ 67 ms | 5-sample median, output stamped at the centre sample (30 Hz assumed; verify) |
| Delivery delay | +105 ms median / +261 ms p95 | **assumed** (another entrant's figures); to be measured |
| Minimum lead | +120 ms | `MIN_LEAD_MS` |

So the downbeat must be at least **≈ 0.48 s after t0 at the median delay, ≈ 0.64 s at p95**. That is ≈ 125 bpm at the median and ≈ 95 bpm when delivery is slow. Faster breaths still get an entry, played at once and flagged "too fast to follow". The synthetic ladder shows this at 110 bpm (see RESULTS.md). If the measured delay is lower, the ceiling rises; `MIN_LEAD_MS` and `PREDICT_AFTER_MS` are the two levers in `config/cue.ts`.

## Measured

### Scheduler precision (offline render): **passes**

`offlineScheduleCheck(100)` in `src/sound/scheduler.ts` renders 100 entry plans with per-voice offsets (−11 to +20 ms) through Tone.js `Offline` at 48 kHz. A probe gain steps from 0 to 1 at each computed attack time; the check finds each step in the rendered buffer.

| Run | Plans found | Max error | Mean error |
|---|---|---|---|
| e2e, Electron 45 / Chromium, 21 Nov 2026 | 100 / 100 | **0.021 ms** (one sample at 48 kHz) | 0.013 ms |

Requirement: within ±1 ms of plan. Reproduce: Settings → Timing check → *Run offline render check*, or `npm run test:e2e`.

This proves the audio-clock half. The end-to-end error (breath → speaker) also depends on the clock mapping and the capture-anchor bias above, and needs the live loop-back test.

### Delivery delay (receipt − SDK timestamp): **pending a live session**

The Timing check view and the Stage 1 probe show it live. It is measured two ways: the newest chest sample in each packet (how fresh the data is on arrival), and every sample. `npm run analyze` computes both from a recording.

| Source | Newest sample median / p95 | All samples median / p95 |
|---|---|---|
| Real SDK (this machine) | — to measure — | — |
| Synthetic model (assumed lognormal, median 105 ms, p95 260 ms, plus up to one 100 ms packet of ageing) | 151 / 316 ms | 186 / 354 ms |

## Not yet done

- Live delivery-delay measurement (Stage 1).
- Loop-back test for the capture-anchor bias (`biasMs`).
- 15-minute audio-glitch check and the 60 fps / memory budgets on a real session.
