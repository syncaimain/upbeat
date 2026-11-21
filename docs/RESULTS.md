# Results

Two kinds of evidence, kept strictly apart:

1. **Live SmartSpectra sessions.** This is the evidence that counts, and it is **still to be done**: it needs a camera and an API key (Stage 1 and Stage 7 below). The tables are ready to fill in.
2. **Synthetic traces** from a breathing model in `fixtures/synth.ts`, run through the real pipeline and cue engine. These show the logic works end to end and helped catch bugs. They are **not** evidence about the real SDK, real people or the thresholds' real-world accuracy. The model was written by the same person who tuned the thresholds.

## 1. Live session protocol (to run)

Record with the Stage 1 probe (`npm run build && npx electron . --probe`), copy the files into `fixtures/`, then:

```
npm run analyze -- --prep fixtures/prep.jsonl --rest fixtures/rest.jsonl --talk fixtures/talk.jsonl
```

| # | Test (plan §12) | Target | Result | Notes |
|---|---|---|---|---|
| L1 | `checkDeviceReadiness()` verdict | `ready` | — | |
| L2 | No entries before breathing is stable | 0 | — | |
| L3 | 30 prep breaths detected | ≥ 90 % | — | |
| L4 | False entries, 2 min resting breath, Ready on | ≤ 1 | — | |
| L5 | Nod without breath | ragged or none | — | |
| L6 | Covered lens / `EXCESSIVE_MOTION` pauses the scene | pause, no entry | — | |
| L7 | Esc stops the camera | ≤ 1 s | — | |
| L8 | 30 cues at ♩ = 72: tempo error mean / spread, % tight | report | — | |
| L9 | Tempo ladder 60 → 120 errors | report | — | |
| L10 | Delivery delay median / p95 | report (see TIMING.md) | — | |
| L11 | Separability: early rise and depth, prep vs rest | report; decision | — | |
| L12 | Calibration k stable across two runs | within 15 % | — | |
| L13 | 15 min: no audio glitches; 60 fps at 1080p; memory growth < 50 MB in 30 min | pass | — | |

**Decision rule** (plan T1.4, applied automatically per user by calibration):
- If calibration's fit error is ≤ 15 %, the breath sets the tempo.
- Otherwise exercises use a fixed target tempo, the breath only times the entry, and its tempo is reported, not followed. The app says so on the calibration result and in the exercise name.
- If prep and resting breaths cannot be separated, keep Ready mandatory (it already is) and raise `CLEAN_DEPTH_X` / `MIN_CUE_RISE_REST_PER_S`.

## 2. Automated tests: all passing (21 Nov 2026)

| Suite | Count | Command |
|---|---|---|
| Unit (engine, signal processing, gate, replay, privacy, SDK options, scheduler maths, framing) | 70 | `npm test` |
| End-to-end in replay mode (Electron + Playwright) | 11 | `npm run test:e2e` |

The e2e suite covers:
- The welcome screen opens with no camera.
- The bundled replay is labelled and shows captions and feedback.
- A ragged nod, and the covered-lens pause.
- The same replay gives identical results twice (deterministic drill scores).
- Keyboard: H, Esc and Space; count-in with no camera.
- Scheduler offline render: 100/100 plans within 0.021 ms.
- Settings curtain and reduced motion.
- Consent before any camera.
- Deleting the profile and history removes the files.
- No secret in the settings file.

## 3. Synthetic protocol (logic check only)

`npx tsx scripts/synthetic-protocol.ts`. The calibration profile comes from a synthetic calibration session: k = 3.551, fit error 7.2 %, 9/9 breaths.

**A. 30 cues at ♩ = 72** (the modelled student's breath varies ±6 % around 72):
- 30/30 entries, 100 % tight.
- Tempo set vs target: mean −2.3 bpm, SD 8.0 bpm, mean |error| 7.3 bpm.
- Set vs peak-measured: 7.7 bpm mean |difference|.

**B. 2 min resting breath, Ready pressed every 5.5 s:** 0 false entries.

**C. Tempo ladder:**

| target | set by breath | peak-measured | entry |
|---|---|---|---|
| 60 | 62 | 63 | tight |
| 70 | 74 | 77 | tight |
| 80 | 69 | 84 | tight |
| 90 | 79 | 84 | tight |
| 100 | 100 | 90 | tight |
| 110 | 96 | 109 | tight (**too fast** — played at once) |
| 120 | 115 | 124 | tight |

Mean |error| 6.9 bpm; mean −5.2 bpm (prediction tends slow in the middle of the range).

**D.** 5 nods without a breath → 5 entries, all ragged. 5 shallow breaths (0.8–1.1× rest) → 2 entries, both ragged; the other 3 rose too gently to count as cues.

**Separability on synthetic recordings** (`npm run analyze`, 30 prep breaths vs 2.5 min rest):
- Early rise: prep p5 3.17 vs rest p99 1.54 rest/s.
- Depth: prep p5 1.92× vs rest p99 1.16×.
- Prediction vs peak tempo: median error 10.4 %, p90 19.0 %.

## 4. Failures and problems found (and what was done)

Kept here on purpose. All of these were found on synthetic data, before any live session.

| Found | Effect | Change |
|---|---|---|
| A normal resting inhale rises at ≈ 0.7–1.15 rest/s, above the plan's 0.5 rest/s onset threshold | With Ready on, resting inhales could cue (ragged) entries | Added `MIN_CUE_RISE_REST_PER_S`: an onset becomes a cue only if its first 150 ms rise reaches it. At 1.2 rest/s there were still 9 false entries in 2 min of synthetic rest; at 1.6, 0 |
| Measuring rise, depth and peak on the 2 s high-passed trace | The high-pass moves the peak earlier: measured beats ~15 % short | Cue shape is measured on the smoothed, non-high-passed trace relative to t0. The high-pass now only feeds the arc and the resting amplitude |
| Measuring the 150 ms rise from a backtracked t0 | The window started in pre-inhale noise; calibration fit error 76 % | Rise measured from the threshold crossing (fit error 7 %). The entry and peak are timed from the backtracked inhale start |
| Timing everything from the threshold crossing | Every beat ≈ 100 ms short; entries late by the same amount | Two onset times: crossing (for rise) and backtracked start (for timing) |
| Peak at sample resolution (30 Hz, 33 ms) on a flat-topped breath | Peak tempo off by up to 7 % at 120 bpm | Parabolic sub-sample peak: peak error now ±17 ms; t0 is still about one sample late, so measured beats run ≈ 3 % short |
| Linear depth projection at commit time | A shallow (1.0×) breath projected as "loose", not ragged | Projection assumes a decelerating (quarter-sine) inhale; `PROJECTION_SHAPE` is configurable and must be checked on real breaths |
| Pressing R while a chord sounded was ignored | Cues 7 s apart were missed half the time | R now cuts the chord off and arms (a conductor's next cue); sustain limit 4.5 s |
| Fast tempi (≈ 110 bpm and up) | The prediction is ready too late to schedule ahead | Plays at once with "too fast to follow", as specified. The real ceiling depends on the delivery delay (TIMING.md) |
| Prediction depends on breath depth, not only speed | A deeper breath at the same tempo rises faster and predicts faster (synthetic p90 error 19 %) | Inherent to `b = k / r`. Calibration reports the fit error and switches to fixed tempo above 15 %. Live data will tell whether a depth term is worth adding |
